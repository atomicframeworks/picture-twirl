// tools/content/lib/run.mjs
//
// One folder per run under content/runs/ (gitignored):
//   content/runs/2026-10-03-1530-sheet/
//     state.json      checkpoints (re-running with --resume skips finished work)
//     plan.json       the AI's plan — edit it, then --resume to use your edits
//     plan.md         the same, readable
//     tiles/<board>/<c>-<r>/  display.webp thumb.webp archive.webp evidence.jpg pick.json
//     report.md       what happened, tile by tile (pictures, licenses, flags)
//     run.log

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';

const RUNS = path.join(ROOT, 'content', 'runs');

export function openRun({ kind, resume = null }) {
    let dir;
    if (resume) {
        dir = path.isAbsolute(resume) ? resume : path.join(RUNS, path.basename(resume));
        if (!existsSync(path.join(dir, 'state.json'))) throw new Error(`No run to resume at ${dir}`);
    } else {
        const d = new Date();
        const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
        dir = path.join(RUNS, `${stamp}-${kind}`);
        mkdirSync(dir, { recursive: true });
    }
    const file = (...p) => path.join(dir, ...p);
    const state = existsSync(file('state.json'))
        ? JSON.parse(readFileSync(file('state.json'), 'utf8'))
        : { kind, createdAt: new Date().toISOString(), tiles: {}, uploads: {}, boards: {} };

    const run = {
        dir,
        kind: state.kind,
        state,
        file,
        save() { writeFileSync(file('state.json'), JSON.stringify(state, null, 2)); },
        writeJson(name, data) { writeFileSync(file(name), JSON.stringify(data, null, 2)); },
        readJson(name) { return existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : null; },
        writeText(name, text) { writeFileSync(file(name), text); },
        tileDir(boardKey, c, r) {
            const d = file('tiles', boardKey, `${c}-${r}`);
            mkdirSync(d, { recursive: true });
            return d;
        },
        log(msg) {
            const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
            console.log(line);
            appendFileSync(file('run.log'), `${line}\n`);
        },
    };
    run.save();
    return run;
}
