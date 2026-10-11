// worker/routes/import.js
//
// The content tools' door into the site (PROPOSAL.md §7.3, the carWashCrawler
// pattern): `Authorization: Bearer <IMPORT_TOKEN>`. Tools never touch the
// database directly. Everything they create lands as status `import`
// (✨ To review) for a person to check and publish in /admin.
//
//   GET   /api/import/boards          → { boards: [{ id, title, emoji, description, status, source, external_key }] }
//   POST  /api/import/runs            { kind, actor, summary? } → { run }
//   PATCH /api/import/runs/:id        { summary?, finished? }   → { run }
//   POST  /api/import/images          multipart display, thumb, archive?, evidence?, meta → { image }
//   POST  /api/import/boards          { externalKey, runId?, source, title, emoji, description, draft, actor? }
//                                     → { board, action: 'created' | 'updated' | 'kept' }

import { safeEqual } from '../lib/auth.js';
import { adminSummary, createBoard, saveBoard } from '../lib/boards.js';
import { all, audit, first, newId, now } from '../lib/db.js';
import { HttpError, json } from '../lib/http.js';
import { checkUpload, publicImage, storeImage } from '../lib/images.js';
import { sniffImage } from '../lib/media.js';
import { LIMITS, titleKey } from '../../src/shared/boards.js';

const EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
const EVIDENCE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** 404 when imports are off (no IMPORT_TOKEN), 401 on a wrong token. */
async function requireImportToken(request, env) {
    if (!env.IMPORT_TOKEN) throw new HttpError(404, 'not_found');
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !(await safeEqual(token, env.IMPORT_TOKEN))) throw new HttpError(401, 'bad_token', 'Wrong import token.');
}

const importer = (handler) => async (ctx) => {
    await requireImportToken(ctx.request, ctx.env);
    return handler(ctx);
};

async function readJson(request) {
    try { return await request.json(); } catch { throw new HttpError(400, 'bad_json', 'Expected a JSON body.'); }
}

const cleanActor = (a) => (String(a || '').trim().slice(0, 60) || 'AI import');

/** A title nobody uses yet: "Snack Attack", "Snack Attack (2)", … */
async function freeTitle(env, title, exceptId = null) {
    const base = String(title || '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.TITLE) || 'Imported board';
    for (let n = 1; n < 100; n++) {
        const candidate = n === 1 ? base : `${base.slice(0, LIMITS.TITLE - 5)} (${n})`;
        const row = await first(env, 'SELECT id FROM boards WHERE title_key = ?', titleKey(candidate));
        if (!row || row.id === exceptId) return candidate;
    }
    throw new HttpError(409, 'title_taken');
}

export function registerImportRoutes(router) {
    router.post('/api/import/runs', importer(async ({ request, env }) => {
        const body = await readJson(request);
        const kind = ['sheet', 'discover', 'verify'].includes(body.kind) ? body.kind : 'sheet';
        const id = newId('run');
        await env.DB.prepare('INSERT INTO import_runs (id, kind, actor, started_at, summary_json) VALUES (?, ?, ?, ?, ?)')
            .bind(id, kind, cleanActor(body.actor), now(), body.summary ? JSON.stringify(body.summary) : null).run();
        return json({ run: await first(env, 'SELECT * FROM import_runs WHERE id = ?', id) }, { status: 201 });
    }));

    router.patch('/api/import/runs/:id', importer(async ({ request, env, params }) => {
        const body = await readJson(request);
        const run = await first(env, 'SELECT * FROM import_runs WHERE id = ?', params.id);
        if (!run) throw new HttpError(404, 'not_found');
        await env.DB.prepare('UPDATE import_runs SET summary_json = ?, finished_at = ? WHERE id = ?').bind(
            body.summary !== undefined ? JSON.stringify(body.summary) : run.summary_json,
            body.finished ? now() : run.finished_at,
            params.id,
        ).run();
        return json({ run: await first(env, 'SELECT * FROM import_runs WHERE id = ?', params.id) });
    }));

    router.post('/api/import/images', importer(async ({ request, env }) => {
        let form;
        try { form = await request.formData(); } catch { throw new HttpError(400, 'bad_form', 'Expected a multipart upload.'); }
        const bytesOf = async (field) => {
            const f = form.get(field);
            return f && typeof f.arrayBuffer === 'function' ? new Uint8Array(await f.arrayBuffer()) : null;
        };
        const display = checkUpload('display', await bytesOf('display'));
        const thumb = checkUpload('thumb', await bytesOf('thumb'));
        const archiveBytes = await bytesOf('archive');
        const archive = archiveBytes ? checkUpload('archive', archiveBytes) : null;
        let meta;
        try { meta = JSON.parse(form.get('meta') || '{}') || {}; } catch { throw new HttpError(400, 'bad_meta', 'meta must be JSON.'); }

        const row = await storeImage(env, {
            display, thumb, archive,
            meta: { ...meta, provider: String(meta.provider || 'import').slice(0, 30), retrievedAt: Number(meta.retrievedAt) || now() },
            actor: cleanActor(meta.actor),
        });

        // License evidence: a screenshot of the source page when the picture was taken.
        const evidence = await bytesOf('evidence');
        if (evidence && !row.evidence_key) {
            const type = sniffImage(evidence);
            if (!EVIDENCE_TYPES[type]) throw new HttpError(400, 'bad_evidence', 'Evidence must be a PNG, JPEG or WebP screenshot.');
            if (evidence.byteLength > EVIDENCE_MAX_BYTES) throw new HttpError(413, 'evidence_too_large');
            const key = `evidence/${row.sha256}.${EVIDENCE_TYPES[type]}`;
            await env.MEDIA.put(key, evidence, { httpMetadata: { contentType: type } });
            await env.DB.prepare('UPDATE images SET evidence_key = ? WHERE id = ?').bind(key, row.id).run();
            row.evidence_key = key;
        }
        return json({ image: publicImage(row) }, { status: 201 });
    }));

    // What exists already (all statuses) so tools don't plan duplicates.
    router.get('/api/import/boards', importer(async ({ env }) => json({
        boards: await all(env, 'SELECT id, title, emoji, description, status, source, external_key FROM boards ORDER BY title COLLATE NOCASE'),
    })));

    router.post('/api/import/boards', importer(async ({ request, env }) => {
        const body = await readJson(request);
        const externalKey = String(body.externalKey || '').trim().slice(0, 120);
        if (!externalKey) throw new HttpError(400, 'external_key_required', 'externalKey makes re-runs update instead of duplicate.');
        const source = ['ai-sheet', 'ai-discover'].includes(body.source) ? body.source : 'ai-sheet';
        const actor = cleanActor(body.actor);
        const runId = body.runId ? String(body.runId) : null;

        const existing = await first(env, 'SELECT * FROM boards WHERE external_key = ?', externalKey);
        if (existing && existing.status !== 'import') {
            // A person already took it from here (published, drafted or archived it) — never overwrite their work.
            return json({ board: adminSummary(existing), action: 'kept' });
        }
        if (existing) {
            const title = await freeTitle(env, body.title, existing.id);
            const saved = await saveBoard(env, existing.id,
                { rev: existing.rev, title, emoji: body.emoji, description: body.description, draft: body.draft }, actor);
            if (runId) await env.DB.prepare('UPDATE boards SET import_run_id = ? WHERE id = ?').bind(runId, existing.id).run();
            await audit(env, { actor, action: 'board.import_update', boardId: existing.id, detail: { title, runId } });
            return json({ board: saved.board, action: 'updated' });
        }
        const row = await createBoard(env, {
            title: await freeTitle(env, body.title), emoji: body.emoji, description: body.description, draft: body.draft,
            status: 'import', source, externalKey, importRunId: runId, actor,
        });
        return json({ board: adminSummary(row), action: 'created' }, { status: 201 });
    }));
}

/** Admin side: list runs (dashboard) — registered from routes/admin.js. */
export async function listImportRuns(env, limit = 20) {
    const rows = await all(env, `SELECT r.*, (SELECT COUNT(*) FROM boards b WHERE b.import_run_id = r.id) AS boards
        FROM import_runs r ORDER BY r.started_at DESC LIMIT ?`, Math.min(Math.max(Number(limit) || 20, 1), 100));
    return rows.map(r => ({ ...r, summary: r.summary_json ? JSON.parse(r.summary_json) : null, summary_json: undefined }));
}
