// tools/content/lib/env.mjs
//
// Settings for the content tools. Order: real environment variables, then
// .env.local, then .dev.vars (local Worker secrets — has the local IMPORT_TOKEN).
//
//   CONTENT_SITE_LOCAL   http://localhost:3000        (--site local, the default)
//   CONTENT_SITE_STAGING https://staging-play.…       (--site staging: staging data, WORKFLOW.md)
//   CONTENT_SITE_PROD    https://play.…               (--site prod: the live site)
//   IMPORT_TOKEN         local token (.dev.vars)       IMPORT_TOKEN_STAGING / IMPORT_TOKEN_PROD
//                        (npm run cf:secrets [-- --previews] writes those two)
//   CONTENT_AI           claude-code (default) | ollama
//   CONTENT_AI_MODEL_PLAN   opus   (planning / discovery — few, important calls)
//   CONTENT_AI_MODEL_CHECK  sonnet (picture checks — many, quick calls)
//   OLLAMA_URL / OLLAMA_MODEL   for CONTENT_AI=ollama (a vision model, e.g. qwen2.5vl:7b)
//   CONTENT_ACTOR        name shown in the admin's Activity (default: your OS user)

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** KEY=VALUE lines → object (comments and blanks ignored, surrounding quotes stripped). */
export function parseEnvFile(file) {
    if (!existsSync(file)) return {};
    const out = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m || line.trim().startsWith('#')) continue;
        out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return out;
}

export function loadSettings({ site = 'local' } = {}) {
    const files = { ...parseEnvFile(path.join(ROOT, '.dev.vars')), ...parseEnvFile(path.join(ROOT, '.env.local')) };
    const get = (key, fallback = undefined) => process.env[key] ?? files[key] ?? fallback;
    const name = ['staging', 'prod'].includes(site) ? site : 'local';
    const KEY = name.toUpperCase();
    return {
        siteName: name,
        site: (name === 'local' ? get('CONTENT_SITE_LOCAL', 'http://localhost:3000') : get(`CONTENT_SITE_${KEY}`, '')).replace(/\/$/, ''),
        token: name === 'local' ? get('IMPORT_TOKEN') : get(`IMPORT_TOKEN_${KEY}`),
        ai: get('CONTENT_AI', 'claude-code'),
        modelPlan: get('CONTENT_AI_MODEL_PLAN', 'opus'),
        modelCheck: get('CONTENT_AI_MODEL_CHECK', 'sonnet'),
        ollamaUrl: get('OLLAMA_URL', 'http://localhost:11434').replace(/\/$/, ''),
        ollamaModel: get('OLLAMA_MODEL', 'qwen2.5vl:7b'),
        pixabayKey: get('PIXABAY_KEY'),
        pexelsKey: get('PEXELS_KEY'),
        actor: `AI · ${get('CONTENT_ACTOR', os.userInfo().username || 'content tools')}`,
    };
}
