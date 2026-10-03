// tools/content/pipeline.mjs
//
// The content pipeline (PROPOSAL.md §7.3) behind `npm run content:sheet` and
// `npm run content:discover` (tools/content/cli.mjs):
//
//   1. plan     the AI groups the spreadsheet (or invents themes) into 5×5 boards → plan.json / plan.md
//   2. find     per tile: the sheet's own link when it's a free source, else Commons + Openverse search
//   3. check    the AI looks at up to 4 candidates and picks one; flags answer-visible / real person / logo
//               (pictures a person linked in the sheet are used as-is)
//   4. fetch    download → display/thumb/archive WebP + a screenshot of the source page (license evidence)
//   5. submit   --live only: pictures + boards → the site's /api/import → ✨ To review in /admin
//   6. report   report.md — every tile with its picture, license, flags and why
//
// Each step checkpoints into the run folder (content/runs/<stamp>-<kind>/), so
// `--resume <folder>` continues after a crash or Ctrl-C, uses your edits to
// plan.json, and turns a reviewed dry run into an upload (`--resume … --live`).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DEFAULT_POINTS, LIMITS } from '../../src/shared/boards.js';
import { assessRights, licenseInfo, RIGHTS_FLAGS } from '../../src/shared/rights.js';
import { createAI } from './lib/ai.mjs';
import { openBrowser } from './lib/browser.mjs';
import { ROOT } from './lib/env.mjs';
import { getBytes } from './lib/http.mjs';
import { normalizeImage } from './lib/images.mjs';
import { createImportApi } from './lib/importApi.mjs';
import { fallbackSheetPlan, planMarkdown, tidyPlan } from './lib/plan.mjs';
import { CHECK_SCHEMA, CHECK_SYSTEM, checkPrompt, DISCOVER_SYSTEM, discoverPrompt, flagsFromCheck, PLAN_SCHEMA, PLAN_SYSTEM, sheetPrompt } from './lib/prompts.mjs';
import { openRun } from './lib/run.mjs';
import { byCategory, DEFAULT_SHEET, readContentTracker } from './lib/sheet.mjs';
import { rank, resolveLink, searchFree } from './lib/sources.mjs';

const KIND_LABEL = { sheet: '📊 Spreadsheet import', discover: '🔎 Discovery' };

/**
 * Unsplash pictures are never shown to the AI: Unsplash's terms ask for
 * permission before their content is used for AI/ML (PROPOSAL.md §7.6). A
 * person picked them (sheet links) and a person reviews them in the admin.
 */
const aiMayLook = (candidate) => !/unsplash/i.test(candidate?.provider || '');
const CHECK_BATCH = 4;          // candidates per AI look
const CHECK_MAX = 8;            // candidates considered per tile

/**
 * @param {{ kind: 'sheet'|'discover', settings: object, live?: boolean, planOnly?: boolean, resume?: string|null,
 *           boards?: number, theme?: string, sheet?: string, concurrency?: number, evidence?: boolean,
 *           redo?: string[] }} opts   redo: board keys or tile keys ("board/c-r") to pick again on --resume
 */
export async function runPipeline(opts) {
    const { kind, settings } = opts;
    const run = openRun({ kind, resume: opts.resume });
    if (run.kind !== kind) throw new Error(`${run.dir} is a ${run.kind} run — resume it with content:${run.kind}.`);
    run.state.options ??= { boards: opts.boards, theme: opts.theme || null, sheet: opts.sheet || DEFAULT_SHEET };
    run.save();
    const folder = path.relative(ROOT, run.dir);
    run.log(`${KIND_LABEL[kind]} → ${folder}${opts.resume ? ' (resumed)' : ''}`);

    // What's already on the site, so the plan avoids taken names (needed for --live).
    const api = settings.site && settings.token ? createImportApi(settings) : null;
    if (opts.live && !api) throw new Error(`--live needs the site URL and import token for "${settings.siteName}" (see COMMANDS.md → Content tools).`);
    let existing = [];
    if (api) {
        try {
            existing = await api.existingBoards();
        } catch (e) {
            if (opts.live) throw e;
            run.log(`(Couldn't list the site's boards — ${e.message}. Planning without them.)`);
        }
    }

    const ai = settings.ai === 'none' ? null : createAI(settings);
    const sheet = kind === 'sheet' ? readContentTracker(path.resolve(ROOT, run.state.options.sheet)) : null;
    const itemsById = new Map((sheet?.items || []).map(it => [it.itemId, it]));

    // 1. plan
    let raw = run.readJson('plan.json');
    if (raw) {
        run.log('Using plan.json from the run folder (your edits count).');
    } else {
        raw = await makePlan({ kind, ai, sheet, existing, settings, run, boards: run.state.options.boards, theme: run.state.options.theme });
        run.writeJson('plan.json', raw);
    }
    const plan = tidyPlan(raw, { kind, itemsById, existing });
    run.writeText('plan.md', planMarkdown(plan, { title: `${KIND_LABEL[kind]} plan — ${path.basename(run.dir)}` }));
    run.log(`Plan: ${plan.boards.map(b => `${b.emoji} ${b.title}`).join(' · ') || '(no boards)'}`);
    for (const f of plan.fixes) run.log(`  fix-up: ${f}`);

    if (opts.planOnly) {
        run.log(`Plan only. Read ${folder}/plan.md — edit plan.json if you like — then continue with: --resume ${path.basename(run.dir)}`);
        return { run, plan };
    }

    // 2–4. pictures
    const jobs = [];
    for (const board of plan.boards) {
        board.categories.forEach((cat, c) => cat.tiles.forEach((tile, r) => { if (tile.answer) jobs.push({ board, cat, c, r, tile }); }));
    }
    const browser = opts.evidence === false ? null : await openBrowser().catch((e) => {
        run.log(`(No browser for evidence screenshots: ${e.message}. Run: npx playwright install chromium)`);
        return null;
    });
    let done = 0;
    try {
        await pool(jobs, opts.concurrency || 3, async (job) => {
            const pick = await pickTile(job, { run, ai, browser, redo: new Set(opts.redo || []) });
            done++;
            run.log(`[${done}/${jobs.length}] ${job.board.title} · ${job.cat.title} · ${DEFAULT_POINTS[job.r]} · ${job.tile.answer} → ${describePick(pick)}`);
        });
    } finally {
        await browser?.close().catch(() => {});
    }

    // 5. submit
    const summary = summarize(plan, run.state, { ai, settings, folder });
    if (opts.live) {
        await submit({ plan, run, api, settings, kind, existing, summary });
        await api.finishRun(run.state.runId, summary);
    }

    // 6. report
    run.writeText('report.md', reportMarkdown({ plan, run, kind, settings, summary, live: !!opts.live, sheet }));
    run.log(`Done: ${summary.boards} boards · ${summary.tilesWithPictures}/${summary.tiles} tiles with pictures · ⚠️ ${summary.flagged} flagged · ${summary.missing} without a picture · ${summary.errors} errors`);
    run.log(`Report: ${folder}/report.md`);
    if (opts.live) run.log(`Review them: ${settings.site}/admin#/boards?status=import`);
    else run.log(`Dry run — nothing uploaded. Happy with it? Upload: npm run content:${kind} -- --resume ${path.basename(run.dir)} --live`);
    return { run, plan, summary };
}

async function makePlan({ kind, ai, sheet, existing, settings, run, boards, theme }) {
    const existingTitles = existing.map(b => b.title);
    let raw;
    if (kind === 'sheet') {
        const groups = byCategory(sheet.items);
        if (!ai) {
            run.log('No AI (--ai none): one column per spreadsheet category, in sheet order.');
            return fallbackSheetPlan(groups, boards);
        }
        run.log(`Planning boards from ${sheet.items.length} spreadsheet items with ${ai.name}${ai.name === 'claude-code' ? ` (${settings.modelPlan})` : ''} — a few minutes…`);
        raw = await ai.ask({
            kind: 'plan', system: PLAN_SYSTEM, schema: PLAN_SCHEMA, timeoutMs: 20 * 60_000,
            prompt: sheetPrompt({ groups, existingTitles, boards }),
        });
    } else {
        if (!ai) throw new Error('Discovery needs an AI (CONTENT_AI=claude-code or ollama).');
        run.log(`Looking for ${boards} new board${boards === 1 ? '' : 's'}${theme ? ` about “${theme}”` : ''} with ${ai.name} (web search) — a few minutes…`);
        raw = await ai.ask({
            kind: 'discover', system: DISCOVER_SYSTEM, schema: PLAN_SCHEMA, timeoutMs: 30 * 60_000,
            prompt: discoverPrompt({ theme, boards, existing }), webTools: true,
        });
    }
    return { ...raw, boards: (raw?.boards || []).slice(0, boards) };
}

/** Run fn over items with at most n in flight. */
async function pool(items, n, fn) {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

const tileKey = (board, c, r) => `${board.key}/${c}-${r}`;
const flickrOwner = (cand) => String(cand?.sourcePageUrl || '').match(/flickr\.com\/photos\/([^/]+)/)?.[1] || null;

/** One tile → picked / none / error, checkpointed in state.json (skipped on resume unless its answer or query changed). */
async function pickTile(job, ctx) {
    const { board, c, r, tile } = job;
    const key = tileKey(board, c, r);
    const redo = ctx.redo.has(key) || ctx.redo.has(board.key);
    const prev = redo ? null : ctx.run.state.tiles[key];
    if (prev && prev.answer === tile.answer && prev.searchQuery === tile.searchQuery && prev.status !== 'error') {
        if (prev.status === 'picked' && prev.via === 'sheet link' && !prev.check && ctx.ai && aiMayLook(prev)) return recheckFlags(prev, job, ctx);
        return prev;
    }

    const base = { answer: tile.answer, searchQuery: tile.searchQuery, itemId: tile.itemId || null };
    let result;
    try {
        result = { ...base, ...(await findAndFetch(job, ctx)) };
    } catch (e) {
        result = { ...base, status: 'error', reason: e.message, notes: [] };
    }
    ctx.run.state.tiles[key] = result;
    ctx.run.save();
    return result;
}

async function findAndFetch({ board, cat, c, r, tile }, { run, ai, browser }) {
    const notes = [];
    let candidates = [];
    let via = 'search';
    let personPicked = false;

    const link = tile.item?.url;
    if (link) {
        const host = new URL(link).hostname.replace(/^www\./, '');
        const linked = await resolveLink(link).catch((e) => { notes.push(`The sheet's link failed (${e.message}) — searched instead.`); return undefined; });
        if (linked?.length) {
            candidates = rank(linked);
            via = 'sheet link';
            personPicked = linked.length === 1 && candidates.length === 1;
            if (!candidates.length) notes.push(`The sheet's picture has a license we can't use (${licenseInfo(linked[0].license).label}) — searched instead.`);
        } else if (linked === null) {
            notes.push(`The sheet's link (${host}) isn't a free-license source — searched instead.`);
        } else if (linked) {
            notes.push(host === 'unsplash.com'
                ? 'The sheet links an Unsplash+ (paid) photo — not under the free Unsplash License — so we searched instead. Fix the sheet?'
                : `The sheet's link (${host}) has no usable picture (too small or not an image) — searched instead.`);
        }
    }
    const searchFor = async () => {
        const found = await searchFree(tile.searchQuery);
        return found.length || tile.searchQuery.toLowerCase() === tile.answer.toLowerCase() ? found : searchFree(tile.answer);
    };
    if (!candidates.length) {
        via = 'search';
        candidates = await searchFor();
    }
    if (!candidates.length) return { status: 'none', via, reason: `No free-license pictures found for “${tile.searchQuery}”.`, notes };

    // Choose, then download. A picture that won't download (deleted, made private…) → choose again without it.
    let chosen = null;
    let check = null;
    let reason = '';
    let bytes = null;
    for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
        ({ chosen, check, reason } = await choose(candidates, { ai, personPicked, board, cat, r, tile }));
        if (!chosen) return { status: 'none', via, reason, notes };
        try {
            bytes = await getBytes(chosen.downloadUrl, { maxBytes: 40 * 1024 * 1024, timeoutMs: 90_000 });
        } catch (e) {
            notes.push(`Couldn't download “${chosen.title || chosen.provider}” (${e.message}) — chose again.`);
            // A Flickr account that went private or was deleted takes all its photos with it.
            const owner = flickrOwner(chosen);
            candidates = candidates.filter(x => x !== chosen && !(owner && flickrOwner(x) === owner));
            if (!candidates.length && via === 'sheet link') {
                via = 'search';
                personPicked = false;
                candidates = await searchFor();
            }
        }
    }
    if (!bytes) return { status: 'none', via, reason: 'None of the chosen pictures would download.', notes };

    // Our sizes, plus license evidence.
    const img = await normalizeImage(bytes);
    if (personPicked && ai && aiMayLook(chosen)) {
        check = await flagCheck(img.display.bytes, { ai, board, cat, r, tile, candidate: chosen })
            .catch((e) => { notes.push(`AI flag check failed (${e.message}).`); return null; });
        if (check && check.choice !== 0) reason += ` (The AI wasn't sure it shows “${tile.answer}”: ${String(check.reason).slice(0, 200)})`;
    }
    const dir = run.tileDir(board.key, c, r);
    writeFileSync(path.join(dir, 'display.webp'), img.display.bytes);
    writeFileSync(path.join(dir, 'thumb.webp'), img.thumb.bytes);
    writeFileSync(path.join(dir, 'archive.webp'), img.archive.bytes);
    let evidence = null;
    if (browser && chosen.provider !== 'unsplash') {          // Unsplash refuses automated browsers; its license text is recorded instead
        const shot = await browser.screenshot(chosen.sourcePageUrl);
        if (shot) {
            writeFileSync(path.join(dir, 'evidence.jpg'), shot);
            evidence = 'evidence.jpg';
        }
    }

    const rights = assessRights({ license: chosen.license, flags: [...(chosen.flags || []), ...flagsFromCheck(check)] });
    const pick = {
        status: 'picked', via, reason, notes,
        provider: chosen.provider,
        title: chosen.title,
        sourcePageUrl: chosen.sourcePageUrl,
        sourceFileUrl: chosen.downloadUrl,
        license: chosen.license,
        licenseLabel: licenseInfo(chosen.license).label,
        licenseUrl: chosen.licenseUrl || null,
        creator: chosen.creator || null,
        creatorUrl: chosen.creatorUrl || null,
        attribution: chosen.attribution || null,
        flags: rights.flags,
        rightsStatus: rights.status,
        check: check && { recognizability: check.recognizability, answerVisible: check.answerVisible, showsRealPerson: check.showsRealPerson, isLogo: check.isLogo },
        candidates: candidates.length,
        sha256: img.sha256,
        width: img.display.width,
        height: img.display.height,
        sourceSize: img.source,
        dir: path.relative(run.dir, dir),
        evidence,
        retrievedAt: Date.now(),
    };
    writeFileSync(path.join(dir, 'pick.json'), JSON.stringify(pick, null, 2));
    return pick;
}

/** The AI looks at up to CHECK_MAX candidates, CHECK_BATCH at a time, and picks one (or none). */
async function choose(candidates, { ai, personPicked, board, cat, r, tile }) {
    if (!candidates.length) return { chosen: null, check: null, reason: 'No candidates left.' };
    if (personPicked) return { chosen: candidates[0], check: null, reason: 'Picked by a person in the spreadsheet.' };
    if (!ai) return { chosen: candidates[0], check: null, reason: 'Top search result (no AI check).' };
    if (!candidates.some(aiMayLook)) return { chosen: candidates[0], check: null, reason: 'Top search result (Unsplash pictures are never shown to the AI).' };
    candidates = candidates.filter(aiMayLook);
    const max = Math.min(candidates.length, CHECK_MAX);
    let reason = 'No candidate showed the answer clearly.';
    for (let start = 0; start < max; start += CHECK_BATCH) {
        const looks = [];
        for (const cand of candidates.slice(start, Math.min(start + CHECK_BATCH, max))) {
            const image = await previewOf(cand).catch(() => null);
            if (image) looks.push({ cand, image });
        }
        if (!looks.length) continue;
        const out = await ai.ask({
            kind: 'check', system: CHECK_SYSTEM, schema: CHECK_SCHEMA, timeoutMs: 4 * 60_000,
            prompt: checkPrompt({ board: board.title, category: cat.title, answer: tile.answer, lookingFor: tile.searchQuery, points: DEFAULT_POINTS[r], candidates: looks.map(l => l.cand) }),
            images: looks.map(l => l.image),
        });
        reason = String(out?.reason || reason).slice(0, 300);
        if (Number.isInteger(out?.choice) && out.choice >= 0 && out.choice < looks.length) return { chosen: looks[out.choice].cand, check: out, reason };
    }
    return { chosen: null, check: null, reason: `The AI didn't like any of ${max} candidates: ${reason}` };
}

/**
 * A person chose this picture (a link in the sheet): the AI doesn't overrule
 * them — it only looks for things to flag (logo, real person, answer visible).
 */
async function flagCheck(displayBytes, { ai, board, cat, r, tile, candidate }) {
    const data = await sharp(displayBytes)
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 72 })
        .toBuffer();
    return ai.ask({
        kind: 'check', system: CHECK_SYSTEM, schema: CHECK_SCHEMA, timeoutMs: 4 * 60_000,
        prompt: checkPrompt({ board: board.title, category: cat.title, answer: tile.answer, lookingFor: tile.searchQuery, points: DEFAULT_POINTS[r], candidates: [candidate] }),
        images: [{ data, mediaType: 'image/jpeg' }],
    });
}

/** Resume: a sheet-link pick saved without an AI look gets its flag check from the local file. */
async function recheckFlags(prev, { board, cat, c, r, tile }, { run, ai }) {
    let check;
    try {
        check = await flagCheck(readFileSync(path.join(run.dir, prev.dir, 'display.webp')), { ai, board, cat, r, tile, candidate: prev });
    } catch {
        return prev;            // keep it as it was; the next resume tries again
    }
    const rights = assessRights({ license: prev.license, flags: [...prev.flags, ...flagsFromCheck(check)] });
    const pick = {
        ...prev,
        check: { recognizability: check.recognizability, answerVisible: check.answerVisible, showsRealPerson: check.showsRealPerson, isLogo: check.isLogo },
        flags: rights.flags,
        rightsStatus: rights.status,
        reason: check.choice === 0 ? prev.reason : `${prev.reason} (The AI wasn't sure it shows “${tile.answer}”: ${String(check.reason).slice(0, 200)})`,
    };
    writeFileSync(path.join(run.dir, prev.dir, 'pick.json'), JSON.stringify(pick, null, 2));
    run.state.tiles[`${board.key}/${c}-${r}`] = pick;
    run.save();
    return pick;
}

/** A small JPEG of a candidate for the AI to look at. */
async function previewOf(cand) {
    const bytes = await getBytes(cand.previewUrl || cand.downloadUrl, { maxBytes: 30 * 1024 * 1024, timeoutMs: 45_000 });
    const data = await sharp(bytes, { density: 96 }).rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 72 })
        .toBuffer();
    return { data, mediaType: 'image/jpeg' };
}

function describePick(pick) {
    if (pick.status === 'picked') {
        const flags = pick.flags.length ? ` ⚠️ ${pick.flags.join(', ')}` : '';
        return `${pick.provider} · ${pick.licenseLabel}${flags}`;
    }
    return `${pick.status === 'none' ? '— no picture' : '❌ error'}: ${pick.reason}`;
}

// ── submit ───────────────────────────────────────────────────────────────────

async function submit({ plan, run, api, settings, kind, existing, summary }) {
    if (!run.state.runId) {
        const created = await api.createRun(kind, settings.actor, { ...summary, status: 'uploading' });
        run.state.runId = created.id;
        run.save();
    }
    const byExternalKey = new Map(existing.filter(b => b.external_key).map(b => [b.external_key, b]));
    for (const board of plan.boards) {
        const prior = byExternalKey.get(board.externalKey);
        if (prior && prior.status !== 'import') {
            // A person took it from here (drafted / published / archived it) — never overwrite their work.
            run.state.boards[board.key] = { id: prior.id, action: 'kept', title: prior.title, status: prior.status };
            run.save();
            run.log(`✋ Kept “${prior.title}” as is (it's ${prior.status} now).`);
            continue;
        }
        const categories = [];
        for (const [c, cat] of board.categories.entries()) {
            const tiles = [];
            for (const [r, tile] of cat.tiles.entries()) {
                const pick = tile.answer ? run.state.tiles[tileKey(board, c, r)] : null;
                const imageId = pick?.status === 'picked' ? await uploadPick(pick, { run, api, settings }) : null;
                tiles.push({ answer: tile.answer, imageId, notes: tileNotes(tile, pick) });
            }
            categories.push({ title: cat.title, tiles });
        }
        const res = await api.upsertBoard({
            externalKey: board.externalKey, runId: run.state.runId,
            source: kind === 'sheet' ? 'ai-sheet' : 'ai-discover', actor: settings.actor,
            title: board.title, emoji: board.emoji, description: board.description,
            draft: { points: [...DEFAULT_POINTS], categories },
        });
        run.state.boards[board.key] = { id: res.board.id, action: res.action, title: res.board.title, status: res.board.status };
        run.save();
        run.log(`${{ created: '✨ Created', updated: '🔁 Updated', kept: '✋ Kept' }[res.action] || res.action} “${res.board.title}”`);
    }
}

async function uploadPick(pick, { run, api, settings }) {
    if (run.state.uploads[pick.sha256]) return run.state.uploads[pick.sha256];
    const read = (f) => readFileSync(path.join(run.dir, pick.dir, f));
    const image = await api.uploadImage(
        { display: read('display.webp'), thumb: read('thumb.webp'), archive: read('archive.webp'), evidence: pick.evidence ? read(pick.evidence) : null },
        {
            provider: pick.provider, sourcePageUrl: pick.sourcePageUrl, sourceFileUrl: pick.sourceFileUrl,
            creator: pick.creator, creatorUrl: pick.creatorUrl, license: pick.license, licenseUrl: pick.licenseUrl,
            attribution: pick.attribution, flags: pick.flags, rightsNote: rightsNoteFor(pick),
            retrievedAt: pick.retrievedAt, actor: settings.actor,
            notes: `Content tools · ${path.basename(run.dir)} · ${pick.via}${pick.title ? ` · “${pick.title}”` : ''}`.slice(0, LIMITS.NOTES),
        },
    );
    run.state.uploads[pick.sha256] = image.id;
    run.save();
    return image.id;
}

function rightsNoteFor(pick) {
    const bits = [];
    if (pick.provider === 'unsplash') {
        bits.push(`Unsplash page read ${new Date(pick.retrievedAt).toISOString().slice(0, 10)}: a free photo under the Unsplash License (Unsplash blocks automated screenshots, so there's no evidence image).`);
    }
    const fromCheck = flagsFromCheck(pick.check);
    if (fromCheck.length) bits.push(`The AI picture check flagged: ${fromCheck.map(f => RIGHTS_FLAGS[f].label).join(', ')}.`);
    return bits.join(' ') || null;
}

/** What the admin sees in the tile's notes. */
function tileNotes(tile, pick) {
    const bits = [];
    if (tile.item) bits.push(`Sheet ${tile.item.itemId}${tile.item.notes ? ` (${tile.item.notes})` : ''}${tile.item.url ? ` · ${tile.item.url}` : ''}`);
    if (pick?.status === 'picked') bits.push(`${pick.via === 'sheet link' ? 'From the sheet link' : `Picture search “${tile.searchQuery}”`}: ${pick.reason}`);
    else if (pick) bits.push(`⚠️ No picture yet — ${pick.reason} Try searching “${tile.searchQuery}”.`);
    bits.push(...(pick?.notes || []));
    return bits.join('\n').slice(0, LIMITS.NOTES);
}

// ── summary + report ─────────────────────────────────────────────────────────

function summarize(plan, state, { ai, settings, folder }) {
    const picks = [];
    for (const b of plan.boards) {
        b.categories.forEach((cat, c) => cat.tiles.forEach((t, r) => { if (t.answer) picks.push(state.tiles[tileKey(b, c, r)]); }));
    }
    return {
        boards: plan.boards.length,
        tiles: picks.length,
        tilesWithPictures: picks.filter(p => p?.status === 'picked').length,
        flagged: picks.filter(p => p?.rightsStatus === 'flagged').length,
        missing: picks.filter(p => p?.status === 'none').length,
        errors: picks.filter(p => p?.status === 'error').length,
        ai: ai ? (ai.name === 'claude-code' ? `claude-code (${settings.modelPlan} / ${settings.modelCheck})` : `ollama (${settings.ollamaModel})`) : 'none',
        folder: path.basename(folder),
    };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function reportMarkdown({ plan, run, kind, settings, summary, live, sheet }) {
    const out = [
        `# ${KIND_LABEL[kind]} — ${path.basename(run.dir)}`,
        '',
        `- **Site:** ${settings.siteName} (${settings.site || 'not set'}) — ${live ? 'uploaded ✅' : `not uploaded (dry run). Upload with \`npm run content:${kind} -- --resume ${path.basename(run.dir)} --live\``}`,
        `- **AI:** ${summary.ai}`,
        `- **Totals:** ${summary.boards} boards · ${summary.tilesWithPictures}/${summary.tiles} tiles with pictures · ⚠️ ${summary.flagged} flagged · ${summary.missing} without a picture · ${summary.errors} errors`,
        '',
        'Every picture here is free to use (public domain, CC0, CC BY, CC BY-SA, Unsplash License). ⚠️ flags are allowed but say what to double-check; `NC`/`ND` licenses were never taken.',
        '',
    ];
    for (const b of plan.boards) {
        const sub = run.state.boards[b.key];
        out.push(`## ${b.emoji} ${b.title}`, '', `${b.description || ''}  `,
            `\`${b.externalKey}\`${sub ? ` → **${sub.action}** ${sub.id}` : ''}`, '');
        b.categories.forEach((cat, c) => {
            out.push(`### ${cat.title || `Category ${c + 1}`}${cat.sourceCategory ? ` <sub>from “${cat.sourceCategory}”</sub>` : ''}`, '');
            out.push('| Pts | Answer | Picture | Source · license | ⚠️ | Why |', '|---|---|---|---|---|---|');
            cat.tiles.forEach((t, r) => {
                const p = t.answer ? run.state.tiles[tileKey(b, c, r)] : null;
                const pic = p?.status === 'picked' ? `<img src="${p.dir}/thumb.webp" width="110">` : '—';
                const src = p?.status === 'picked'
                    ? `[${cell(p.provider)}](${p.sourcePageUrl}) · ${cell(p.licenseLabel)}${p.creator ? ` · ${cell(p.creator).slice(0, 60)}` : ''}${p.evidence ? ` · [evidence](${p.dir}/${p.evidence})` : ''}`
                    : '';
                const flags = p?.flags?.map(f => RIGHTS_FLAGS[f]?.label || f).join(', ') || '';
                const why = p ? cell([p.reason, ...(p.notes || [])].filter(Boolean).join(' ')) : '';
                out.push(`| ${DEFAULT_POINTS[r]} | ${cell(t.answer) || '—'}${t.itemId ? ` <sub>${t.itemId}</sub>` : ''} | ${pic} | ${src} | ${cell(flags)} | ${why} |`);
            });
            out.push('');
        });
    }
    // Links in the sheet we couldn't use — worth fixing in the Google Sheet.
    const sheetFixes = [];
    for (const b of plan.boards) {
        b.categories.forEach((cat, c) => cat.tiles.forEach((t, r) => {
            const p = t.item?.url ? run.state.tiles[tileKey(b, c, r)] : null;
            if (p && p.via !== 'sheet link') sheetFixes.push(`- ${t.item.itemId} “${t.item.answer}” — ${t.item.url} — ${(p.notes || []).find(n => /sheet/i.test(n)) || p.reason}`);
        }));
    }
    if (sheetFixes.length) out.push('## Spreadsheet links we couldn’t use (fix them in the Google Sheet?)', '', ...sheetFixes, '');
    if (plan.fixes.length) out.push('## Plan fix-ups', '', ...plan.fixes.map(f => `- ${f}`), '');
    if (plan.skipped.length) out.push('## Skipped spreadsheet items', '', ...plan.skipped.map(s => `- ${s.itemId}: ${s.reason}`), '');
    if (sheet?.duplicates?.length) {
        out.push('## Duplicates in the spreadsheet', '', ...sheet.duplicates.map(d => `- ${d.itemId} “${d.answer}” (${d.category}) repeats ${d.duplicateOf}`), '');
    }
    if (plan.ideas.length) out.push('## More board ideas (for a future run)', '', ...plan.ideas.map(i => `- **${i.title}** — ${i.pitch}`), '');
    if (plan.aiNotes) out.push('## AI notes', '', plan.aiNotes, '');
    return out.join('\n');
}
