// tests/api/_harness.mjs — run the real Worker (worker/index.js) in Node
// against a throwaway local D1/R2, without starting a server.
//
//   const t = await startTestEnv();   // fresh, migrated, empty database
//   const res = await t.fetch('/api/boards');
//   … t.env.DB / t.env.MEDIA for direct checks …
//   await t.dispose();                // closes bindings + deletes the state
//
// Each test FILE gets its own state folder under .wrangler/ (gitignored and
// Dropbox-ignored), so files never see each other's data.

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { getPlatformProxy } from 'wrangler';
import worker from '../../worker/index.js';
import { normalizeImage } from '../../tools/content/lib/images.mjs';
import { storeImage } from '../../worker/lib/images.js';
import { toolsConfig } from '../../scripts/lib/wranglerConfig.mjs';
import { parseEnvFile } from '../../tools/content/lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = path.join(root, 'wrangler.jsonc');
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

export async function startTestEnv() {
    const stateDir = await mkdtemp(path.join(root, '.wrangler', 'test-state-'));

    // Apply the real migrations to this state folder (same command as predev).
    const migrate = spawnSync(process.execPath,
        [wranglerBin, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir, '--config', configPath],
        { cwd: root, env: { ...process.env, CI: '1' }, encoding: 'utf8' });
    if (migrate.status !== 0) {
        throw new Error(`migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
    }

    // `--persist-to X` stores state under X/v3; getPlatformProxy takes that v3 folder.
    // The config without the GameRoom Durable Objects (live games are tested in
    // tests/realtime/); its copy can't see .dev.vars, so the secrets come along as vars.
    const vars = { ...parseEnvFile(path.join(root, '.dev.vars.example')), ...parseEnvFile(path.join(root, '.dev.vars')) };
    const tools = toolsConfig(root, { vars });
    let proxy;
    try {
        proxy = await getPlatformProxy({ configPath: tools.configPath, persist: { path: path.join(stateDir, 'v3') } });
    } finally {
        tools.cleanup();
    }
    const { env, dispose } = proxy;
    const ctx = { waitUntil() {}, passThroughOnException() {} };

    return {
        env,
        /** Call the Worker like a browser would. */
        fetch: (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), env, ctx),
        async dispose() {
            await dispose();
            await rm(stateDir, { recursive: true, force: true });
        },
    };
}

/**
 * Store a generated solid-color picture (distinct per `seed`) and return its
 * images row. `meta` is passed to storeImage (license, flags, …).
 */
export async function storeTestImage(env, seed, meta = {}) {
    const png = await sharp({
        create: { width: 64 + seed, height: 48, channels: 3, background: { r: (seed * 37) % 256, g: (seed * 91) % 256, b: (seed * 53) % 256 } },
    }).png().toBuffer();
    const img = await normalizeImage(png);
    return storeImage(env, { sha256: img.sha256, display: img.display, thumb: img.thumb, archive: img.archive, meta, actor: 'test' });
}

/** A full 5×5 draft whose tiles use the given image ids (cycled). */
export function fullDraft(imageIds) {
    return {
        points: [100, 200, 300, 400, 500],
        categories: Array.from({ length: 5 }, (_, c) => ({
            title: `Category ${c + 1}`,
            tiles: Array.from({ length: 5 }, (_, r) => ({
                answer: `Answer ${c}-${r}`,
                imageId: imageIds[(c * 5 + r) % imageIds.length],
                notes: '',
            })),
        })),
    };
}
