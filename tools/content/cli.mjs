#!/usr/bin/env node
// tools/content/cli.mjs — `npm run content:sheet` / `npm run content:discover`
// (see COMMANDS.md → Content tools, and tools/content/pipeline.mjs).

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadSettings, ROOT } from './lib/env.mjs';
import { runPipeline } from './pipeline.mjs';

const HELP = `Picture Twirl content tools — find free pictures and build boards that land in /admin as ✨ To review.

  npm run content:sheet    -- [options]   boards from the Content Tracker spreadsheet (content/sources/)
  npm run content:discover -- [options]   brand-new boards; the AI looks for themes on the web

Options
  --live               upload to the site (default: dry run — download + report only)
  --site local|prod    which site --live uploads to (default local = npm run dev; prod after the cutover)
  --boards N           how many boards to plan (sheet: up to 8, discover: 3)
  --theme "…"          discover: a theme to build around ("space", "dogs", "90s toys"…)
  --plan-only          stop after the plan (plan.md) — edit plan.json, then --resume
  --resume <run>       continue a run folder (name under content/runs/, or "last")
  --redo <keys>        with --resume: pick these again — board keys, tiles ("crate-diggers,snack-attack/0-1"),
                       or "missing" (every tile still without a picture)
  --ai claude-code|ollama|none   who plans + checks pictures (default: CONTENT_AI or claude-code)
  --sheet <file.xlsx>  a different spreadsheet export
  --concurrency N      tiles worked on at once (default 3)
  --no-evidence        skip source-page screenshots

Every run writes content/runs/<date>-<kind>/ — plan.md, report.md, the pictures and a log.`;

let args;
try {
    args = parseArgs({
        allowPositionals: true,
        options: {
            live: { type: 'boolean', default: false },
            site: { type: 'string', default: 'local' },
            boards: { type: 'string' },
            theme: { type: 'string' },
            'plan-only': { type: 'boolean', default: false },
            resume: { type: 'string' },
            redo: { type: 'string' },
            ai: { type: 'string' },
            sheet: { type: 'string' },
            concurrency: { type: 'string', default: '3' },
            'no-evidence': { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
} catch (e) {
    console.error(`${e.message}\n\n${HELP}`);
    process.exit(2);
}
const { values: o, positionals } = args;
const kind = positionals[0];
if (o.help || !['sheet', 'discover'].includes(kind)) {
    console.log(HELP);
    process.exit(o.help ? 0 : 2);
}
if (!['local', 'prod'].includes(o.site)) {
    console.error('--site must be local or prod');
    process.exit(2);
}

/** "last" → the newest run folder of this kind. */
function resolveResume(value) {
    if (!value) return null;
    if (value !== 'last') return value;
    const dir = path.join(ROOT, 'content', 'runs');
    const runs = existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith(`-${kind}`)).sort() : [];
    if (!runs.length) throw new Error(`No ${kind} runs to resume yet.`);
    return runs.at(-1);
}

const settings = loadSettings({ site: o.site });
if (o.ai) settings.ai = o.ai;
const defaultBoards = kind === 'sheet' ? 8 : 3;

try {
    await runPipeline({
        kind,
        settings,
        live: o.live,
        planOnly: o['plan-only'],
        resume: resolveResume(o.resume),
        boards: Math.min(Math.max(Number(o.boards) || defaultBoards, 1), 20),
        theme: o.theme?.trim() || null,
        sheet: o.sheet ? path.resolve(o.sheet) : undefined,
        concurrency: Math.min(Math.max(Number(o.concurrency) || 3, 1), 8),
        evidence: !o['no-evidence'],
        redo: o.redo ? o.redo.split(',').map(k => k.trim()).filter(Boolean) : [],
    });
} catch (e) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
}
