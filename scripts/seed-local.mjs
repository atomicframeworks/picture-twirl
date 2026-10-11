// scripts/seed-local.mjs
//
// Local dev seed: makes sure your local D1/R2 (under .wrangler/) hold the
// internal test board "Pop Culture Icons" (content/seed/). Runs automatically
// before `npm run dev` and `npm run share` (package.json "predev"/"preshare"),
// right after the local migrations. Does nothing if the board already exists.
//
// It writes through the same functions the Worker uses (worker/lib/*), on the
// local bindings from wrangler's getPlatformProxy() — no server, no Cloudflare
// login. Run it while the dev server is stopped (both use the same files).
//
// Start over:  delete .wrangler/state, then `npm run dev`.
// PT_STATE_DIR=<dir> seeds a different local state folder (the e2e server uses
// .wrangler/e2e-state).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { normalizeImage } from '../tools/content/lib/images.mjs';
import { storeImage } from '../worker/lib/images.js';
import { createBoard, publishBoard } from '../worker/lib/boards.js';
import { DEFAULT_POINTS } from '../src/shared/boards.js';
import { toolsConfig } from './lib/wranglerConfig.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = path.join(root, 'content', 'seed');
const SEEDS = ['pop-icons'];

const stateDir = process.env.PT_STATE_DIR || path.join('.wrangler', 'state');
// The config without the GameRoom Durable Objects (the seed only needs D1/R2):
// see scripts/lib/wranglerConfig.mjs.
const tools = toolsConfig(root);
const { env, dispose } = await getPlatformProxy({
    configPath: tools.configPath,
    // Same layout as `wrangler … --persist-to <dir>`: state lives in <dir>/v3.
    persist: { path: path.join(root, stateDir, 'v3') },
});
try {
    for (const name of SEEDS) await seedBoard(name);
} finally {
    await dispose();
    tools.cleanup();
}

async function seedBoard(name) {
    const seed = JSON.parse(await readFile(path.join(SEED_DIR, `${name}.json`), 'utf8'));
    const existing = await env.DB.prepare('SELECT id FROM boards WHERE slug = ?').bind(seed.slug).first();
    if (existing) {
        console.log(`seed: "${seed.title}" already in the local database`);
        return;
    }

    console.log(`seed: adding "${seed.title}" to the local database…`);
    const categories = [];
    for (const cat of seed.categories) {
        const tiles = [];
        for (const tile of cat.tiles) {
            const file = await readFile(path.join(SEED_DIR, name, tile.file));
            const img = await normalizeImage(file);
            const row = await storeImage(env, {
                sha256: img.sha256,
                display: img.display,
                thumb: img.thumb,
                archive: img.archive,
                meta: {
                    provider: 'seed',
                    license: seed.rights.license,
                    flags: seed.rights.flags,
                    rightsNote: seed.rights.note,
                    notes: `Seeded from content/seed/${name}/${tile.file}`,
                },
                actor: 'seed',
            });
            tiles.push({ answer: tile.answer, imageId: row.id, notes: '' });
        }
        categories.push({ title: cat.title, tiles });
    }

    const board = await createBoard(env, {
        title: seed.title,
        emoji: seed.emoji,
        description: seed.description,
        slug: seed.slug,
        source: 'seed',
        draft: { points: [...DEFAULT_POINTS], categories },
        actor: 'seed',
    });
    await publishBoard(env, board.id, { actor: 'seed' });
    console.log(`seed: "${seed.title}" published (${board.id})`);
}
