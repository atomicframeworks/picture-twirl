// scripts/lib/wranglerConfig.mjs — wrangler.jsonc, read from Node.
//
// readWranglerConfig(root)  the config as an object (comments + trailing commas removed)
// toolsConfig(root, opts)   a throwaway copy for tools that only need the
//                           database and pictures — the seed step and the API
//                           tests (getPlatformProxy). It drops the Durable
//                           Objects: getPlatformProxy can't host the Worker's own
//                           GameRoom and would print alarming-but-harmless
//                           warnings ("…will fail at runtime"). Binding names stay
//                           the same, so the local D1/R2 data is the same one
//                           `npm run dev` uses. Pass `persist` explicitly — the
//                           copy lives in .wrangler/tools/, not the project root.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** wrangler.jsonc → object. Strips // comments (not inside strings) and trailing commas. */
export function readWranglerConfig(root) {
    const raw = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
    let out = '';
    let inString = false;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            out += ch;
            if (ch === '\\') out += raw[++i];
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
            out += ch;
        } else if (ch === '/' && raw[i + 1] === '/') {
            while (i < raw.length && raw[i] !== '\n') i++;
            out += '\n';
        } else {
            out += ch;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Write a config for getPlatformProxy(): no static assets, no Durable Objects.
 * @param {string} root  project root
 * @param {{ vars?: Record<string, string> }} [opts]  e.g. the secrets from .dev.vars (the copy can't see that file)
 * @returns {{ configPath: string, cleanup: () => void }}
 */
export function toolsConfig(root, { vars } = {}) {
    const cfg = readWranglerConfig(root);
    for (const key of ['$schema', 'assets', 'durable_objects', 'migrations']) delete cfg[key];
    cfg.main = path.join(root, cfg.main);
    cfg.d1_databases = (cfg.d1_databases || []).map(d => ({ ...d, migrations_dir: path.join(root, d.migrations_dir) }));
    if (vars) cfg.vars = { ...(cfg.vars || {}), ...vars };
    const dir = path.join(root, '.wrangler', 'tools');
    mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, `wrangler.${process.pid}.${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return { configPath, cleanup: () => rmSync(configPath, { force: true }) };
}
