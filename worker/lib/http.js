// worker/lib/http.js
//
// Response helpers + a tiny path router for the Worker.

/** JSON response; API data is never cached by browsers or the edge. */
export function json(data, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
    return Response.json(data, { ...init, headers });
}

/** Throw from any handler to answer with a JSON error. */
export class HttpError extends Error {
    constructor(status, code, message = code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export const notFound = () => json({ error: 'not_found' }, { status: 404 });

/**
 * Minimal router: patterns like '/api/boards/:id' or '/media/*'.
 * `*` captures the rest of the path as params.rest. HEAD is served by GET routes.
 */
export function createRouter() {
    const routes = [];

    function add(method, pattern, handler) {
        const names = [];
        const regex = new RegExp('^' + pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)'; })
            .replace(/\*$/, () => { names.push('rest'); return '(.+)'; }) + '$');
        routes.push({ method, regex, names, handler });
    }

    return {
        get: (pattern, handler) => add('GET', pattern, handler),
        post: (pattern, handler) => add('POST', pattern, handler),
        put: (pattern, handler) => add('PUT', pattern, handler),
        patch: (pattern, handler) => add('PATCH', pattern, handler),
        delete: (pattern, handler) => add('DELETE', pattern, handler),

        /** Returns the handler's Response, or null when nothing matches. */
        async handle(request, env, ctx) {
            const url = new URL(request.url);
            const method = request.method === 'HEAD' ? 'GET' : request.method;
            for (const route of routes) {
                if (route.method !== method) continue;
                const m = url.pathname.match(route.regex);
                if (!m) continue;
                const params = {};
                route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
                return route.handler({ request, env, ctx, url, params });
            }
            return null;
        },
    };
}
