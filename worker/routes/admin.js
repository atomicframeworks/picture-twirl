// worker/routes/admin.js
//
// The admin's JSON API (PROPOSAL.md §5, Appendix A). Everything except
// login/logout requires a signed session (worker/lib/auth.js requireAdmin).
// The admin UI is src/admin/* (served at /admin/).

import {
    adminConfigured, assertLoginAllowed, NAME_MAX, readCookie, recordLoginFailure, requireAdmin,
    safeEqual, SESSION_COOKIE, SESSION_TTL_MS, sessionCookie, signSession, verifySession,
} from '../lib/auth.js';
import {
    adminStats, adminSummary, bulkBoardAction, changeBoardStatus, createBoard, duplicateBoard,
    getBoardForAdmin, listAudit, listBoardsForAdmin, publishBoard, saveBoard, titleAvailable,
} from '../lib/boards.js';
import { checkUpload, publicImage, storeImage, updateImageRights } from '../lib/images.js';
import { fetchImageFromUrl } from '../lib/fetchImage.js';
import { first, now } from '../lib/db.js';
import { HttpError, json } from '../lib/http.js';

/** Wrap a handler so it only runs for a signed-in admin (ctx.session = { name }). */
const admin = (handler) => async (ctx) => {
    ctx.session = await requireAdmin(ctx.request, ctx.env);
    return handler(ctx);
};

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        throw new HttpError(400, 'bad_json', 'Expected a JSON body.');
    }
}

export function registerAdminRoutes(router) {
    // ── Session ──────────────────────────────────────────────────────────────
    router.post('/api/admin/login', async ({ request, env }) => {
        if (!adminConfigured(env)) throw new HttpError(503, 'admin_not_configured', 'The admin is not set up on this server.');
        await assertLoginAllowed(env, request);
        const body = await readJson(request);
        const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
        if (!name) throw new HttpError(400, 'name_required', 'Tell us who’s editing (your name).');
        if (!(await safeEqual(String(body.password ?? ''), env.ADMIN_PASSWORD))) {
            await recordLoginFailure(env, request);
            throw new HttpError(401, 'wrong_password', 'Wrong password.');
        }
        const token = await signSession(env, { name });
        return json({ ok: true, name }, {
            headers: { 'Set-Cookie': sessionCookie(request, token, Math.floor(SESSION_TTL_MS / 1000)) },
        });
    });

    router.post('/api/admin/logout', async ({ request }) => json({ ok: true }, {
        headers: { 'Set-Cookie': sessionCookie(request, '', 0) },
    }));

    // Who am I? 401 when signed out (the UI shows the login form).
    router.get('/api/admin/me', async ({ request, env }) => {
        if (!adminConfigured(env)) throw new HttpError(503, 'admin_not_configured', 'The admin is not set up on this server.');
        const session = await verifySession(env, readCookie(request, SESSION_COOKIE));
        if (!session) throw new HttpError(401, 'signed_out', 'Please sign in.');
        return json({ name: session.name, expiresAt: session.exp });
    });

    // ── Dashboard + activity ─────────────────────────────────────────────────
    router.get('/api/admin/stats', admin(async ({ env }) => json(await adminStats(env))));

    router.get('/api/admin/audit', admin(async ({ env, url }) => json({
        entries: await listAudit(env, { limit: url.searchParams.get('limit'), boardId: url.searchParams.get('board') }),
    })));

    // ── Boards ───────────────────────────────────────────────────────────────
    router.get('/api/admin/boards', admin(async ({ env }) => json({ boards: await listBoardsForAdmin(env) })));

    router.post('/api/admin/boards', admin(async ({ request, env, session }) => {
        const body = await readJson(request);
        const row = await createBoard(env, {
            title: body.title, emoji: body.emoji, description: body.description, actor: session.name,
        });
        return json({ board: adminSummary(row) }, { status: 201 });
    }));

    router.get('/api/admin/titles/check', admin(async ({ env, url }) => json({
        available: await titleAvailable(env, url.searchParams.get('title') || '', url.searchParams.get('except') || null),
    })));

    router.post('/api/admin/boards/bulk', admin(async ({ request, env, session }) => {
        const { action, ids } = await readJson(request);
        if (!['publish', 'unpublish', 'archive', 'restore'].includes(action)) throw new HttpError(400, 'bad_action');
        if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'no_ids', 'Select at least one board.');
        return json(await bulkBoardAction(env, action, ids.map(String), { actor: session.name }));
    }));

    router.get('/api/admin/boards/:id', admin(async ({ env, params }) => json(await getBoardForAdmin(env, params.id))));

    // Autosave (optimistic concurrency on rev).
    router.put('/api/admin/boards/:id', admin(async ({ request, env, params, session }) => {
        const body = await readJson(request);
        return json(await saveBoard(env, params.id, body, session.name));
    }));

    router.post('/api/admin/boards/:id/:action', admin(async ({ env, params, session }) => {
        const opts = { actor: session.name };
        switch (params.action) {
            case 'publish':
                await publishBoard(env, params.id, opts);
                return json(await getBoardForAdmin(env, params.id));
            case 'unpublish':
            case 'archive':
            case 'restore':
                await changeBoardStatus(env, params.id, params.action, opts);
                return json(await getBoardForAdmin(env, params.id));
            case 'duplicate': {
                const copy = await duplicateBoard(env, params.id, opts);
                return json({ board: adminSummary(copy) }, { status: 201 });
            }
            default:
                throw new HttpError(404, 'not_found');
        }
    }));

    // ── Pictures ─────────────────────────────────────────────────────────────
    // Upload a picture the admin's browser already normalized:
    // multipart { display, thumb, archive?, meta? (JSON) } → images row.
    router.post('/api/admin/images', admin(async ({ request, env, session }) => {
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
        const provider = ['upload', 'url', 'paste'].includes(meta.provider) ? meta.provider : 'upload';

        const row = await storeImage(env, {
            display, thumb, archive,
            meta: { ...meta, provider, retrievedAt: meta.sourceFileUrl ? now() : null },
            actor: session.name,
        });
        return json({ image: publicImage(row) }, { status: 201 });
    }));

    // Download a picture from a link (or a page's og:image) and hand the bytes
    // back for the browser to normalize. Source URLs come back in headers.
    router.post('/api/admin/images/fetch', admin(async ({ request }) => {
        const { url } = await readJson(request);
        const got = await fetchImageFromUrl(url);
        return new Response(got.bytes, {
            headers: {
                'Content-Type': got.contentType,
                'Cache-Control': 'no-store',
                'X-Source-File-Url': got.sourceFileUrl,
                ...(got.sourcePageUrl ? { 'X-Source-Page-Url': got.sourcePageUrl } : {}),
            },
        });
    }));

    router.get('/api/admin/images/:id', admin(async ({ env, params }) => {
        const row = await first(env, 'SELECT * FROM images WHERE id = ?', params.id);
        if (!row) throw new HttpError(404, 'not_found');
        return json({ image: publicImage(row) });
    }));

    router.patch('/api/admin/images/:id', admin(async ({ request, env, params, session }) => {
        const row = await updateImageRights(env, params.id, await readJson(request), session.name);
        return json({ image: publicImage(row) });
    }));
}
