// tools/content/lib/importApi.mjs — HTTP client for the site's /api/import/*
// (worker/routes/import.js). The tools never touch the database directly.

export function createImportApi({ site, token }) {
    if (!site) throw new Error('No site URL (CONTENT_SITE_LOCAL / CONTENT_SITE_PROD).');
    if (!token) throw new Error('No import token (IMPORT_TOKEN in .dev.vars for local, IMPORT_TOKEN_PROD for prod).');

    async function call(method, path, body) {
        const headers = { Authorization: `Bearer ${token}` };
        let payload = body;
        if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
        let res;
        try {
            res = await fetch(`${site}${path}`, { method, headers, body: payload });
        } catch (e) {
            throw new Error(`Can't reach ${site} (${e.cause?.code || e.message}). Is the dev server running (npm run dev)?`, { cause: e });
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.error || ''}: ${data.message || ''}`.trim());
        return data;
    }

    return {
        existingBoards: async () => (await call('GET', '/api/import/boards')).boards,
        createRun: async (kind, actor, summary) => (await call('POST', '/api/import/runs', { kind, actor, summary })).run,
        finishRun: (id, summary) => call('PATCH', `/api/import/runs/${id}`, { summary, finished: true }),
        /** files: { display, thumb, archive?, evidence? } Buffers; meta: provenance + license. */
        async uploadImage(files, meta) {
            const form = new FormData();
            form.append('display', new Blob([files.display], { type: 'image/webp' }), 'display.webp');
            form.append('thumb', new Blob([files.thumb], { type: 'image/webp' }), 'thumb.webp');
            if (files.archive) form.append('archive', new Blob([files.archive], { type: 'image/webp' }), 'archive.webp');
            if (files.evidence) form.append('evidence', new Blob([files.evidence], { type: 'image/jpeg' }), 'evidence.jpg');
            form.append('meta', JSON.stringify(meta));
            return (await call('POST', '/api/import/images', form)).image;
        },
        upsertBoard: (board) => call('POST', '/api/import/boards', board),
    };
}
