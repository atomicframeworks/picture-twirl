// worker/index.js
//
// Picture Twirl — the Cloudflare Worker (PROPOSAL.md §3).
// -----------------------------------------------------------------------------
// Static files (the game's index.html, JS, CSS, images) are served by Workers
// Static Assets without running this script. It only runs for the paths listed
// in wrangler.jsonc `assets.run_worker_first`: /api/* and /media/*.
//
// Bindings (wrangler.jsonc): DB (D1), MEDIA (R2), ASSETS (static files).
// -----------------------------------------------------------------------------

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        try {
            if (url.pathname === '/api/health') return await health(env);

            if (url.pathname.startsWith('/api/')) {
                return Response.json({ error: 'not_found' }, { status: 404 });
            }

            return new Response('Not found', { status: 404 });
        } catch (err) {
            console.error('Unhandled error', url.pathname, err);
            return Response.json({ error: 'internal_error' }, { status: 500 });
        }
    },
};

/** Liveness + "is the database migrated?" check. */
async function health(env) {
    const row = await env.DB.prepare('SELECT COUNT(*) AS boards FROM boards').first();
    return Response.json({ ok: true, boards: row?.boards ?? 0 });
}
