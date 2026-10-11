// scripts/e2e-server.mjs  (npm run dev:e2e — Playwright starts it)
//
// A dev server just for browser tests: port 3100 and its own local database
// under .wrangler/e2e-state, wiped + migrated + seeded on every start. Your
// normal `npm run dev` data (.wrangler/state) is never touched.

import { rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = '.wrangler/e2e-state';                    // keep in sync with vite.config.js E2E_STATE_DIR
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const env = { ...process.env, PT_E2E: '1', PT_STATE_DIR: stateDir };

function step(args, label) {
    const res = spawnSync(process.execPath, args, { cwd: root, env: { ...env, CI: '1' }, stdio: 'inherit' });
    if (res.status !== 0) {
        console.error(`e2e-server: ${label} failed`);
        process.exit(res.status ?? 1);
    }
}

rmSync(path.join(root, stateDir), { recursive: true, force: true });
step([wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], 'migrations');
step([path.join(root, 'scripts', 'seed-local.mjs')], 'seed');

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => vite.kill(sig));
vite.on('exit', (code) => process.exit(code ?? 0));
