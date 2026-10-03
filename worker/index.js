// worker/index.js
//
// Picture Twirl — the Cloudflare Worker (PROPOSAL.md §3).
// -----------------------------------------------------------------------------
// Static files (the game's index.html, the admin at /admin/, JS, CSS) are
// served by Workers Static Assets without running this script. It only runs
// for the paths listed in wrangler.jsonc `assets.run_worker_first`:
// /api/* and /media/*.
//
// Bindings (wrangler.jsonc): DB (D1), MEDIA (R2), ASSETS (static files).
// Secrets (.dev.vars locally): ADMIN_PASSWORD, SESSION_SECRET, IMPORT_TOKEN.
// Routes live in worker/routes/*; shared rules in src/shared/*.
// -----------------------------------------------------------------------------

import { createRouter, errorResponse, HttpError, json, notFound } from './lib/http.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerImportRoutes } from './routes/import.js';

const router = createRouter();

// Liveness + "is the database migrated?"
router.get('/api/health', async ({ env }) => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS boards FROM boards').first();
    return json({ ok: true, boards: row?.boards ?? 0 });
});

registerPublicRoutes(router);
registerAdminRoutes(router);
registerImportRoutes(router);

export default {
    async fetch(request, env, ctx) {
        try {
            return (await router.handle(request, env, ctx)) ?? notFound();
        } catch (err) {
            if (err instanceof HttpError) return errorResponse(err);
            console.error('Unhandled error', request.method, new URL(request.url).pathname, err);
            return json({ error: 'internal_error' }, { status: 500 });
        }
    },
};
