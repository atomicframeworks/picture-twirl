// worker/routes/public.js
//
// What players' browsers call: the published boards and the pictures.

import { getPublishedBoard, listPublishedBoards } from '../lib/boards.js';
import { PUBLIC_MEDIA_PREFIXES } from '../lib/images.js';
import { json, notFound } from '../lib/http.js';

export function registerPublicRoutes(router) {
    // Published boards for the "Pick a Board" lists.
    router.get('/api/boards', async ({ env }) => {
        return json({ boards: await listPublishedBoards(env) });
    });

    // One board's published snapshot (by id or slug).
    router.get('/api/boards/:id', async ({ env, params }) => {
        const snapshot = await getPublishedBoard(env, params.id);
        return snapshot ? json(snapshot) : notFound();
    });

    // Pictures from R2. Keys are content hashes → cache forever. Same origin as
    // the game on purpose: the swirl reads pixels from a canvas, which only
    // works for same-origin (or perfectly CORS-configured) images.
    router.get('/media/*', async ({ request, env, params }) => {
        const key = params.rest;
        if (!PUBLIC_MEDIA_PREFIXES.some(p => key.startsWith(p)) || key.includes('..')) return notFound();

        const object = await env.MEDIA.get(key, { onlyIf: request.headers });
        if (!object) return notFound();

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('ETag', object.httpEtag);
        if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        // A failed precondition (If-None-Match hit) returns metadata without a body.
        if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });
        return new Response(request.method === 'HEAD' ? null : object.body, { headers });
    });
}
