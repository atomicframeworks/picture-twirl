// src/admin/lib/api.js
//
// The admin's only way to talk to the Worker (worker/routes/admin.js).
// JSON in/out, cookies same-origin, errors as ApiError. A 401 anywhere fires
// `admin:signed-out` so the app can show the sign-in screen.

export class ApiError extends Error {
    constructor(status, code, message, body = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.body = body;
    }
}

/**
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path
 * @param {object|FormData} [body]
 * @returns {Promise<any>} parsed JSON (or the Response for non-JSON replies)
 */
export async function api(method, path, body) {
    const init = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body instanceof FormData) {
        init.body = body;
    } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    let res;
    try {
        res = await fetch(path, init);
    } catch {
        throw new ApiError(0, 'offline', 'Can’t reach the server — check your connection.');
    }

    const isJson = (res.headers.get('Content-Type') || '').includes('application/json');
    const data = isJson ? await res.json().catch(() => ({})) : null;

    if (res.status === 401 && path !== '/api/admin/login') {
        window.dispatchEvent(new CustomEvent('admin:signed-out'));
    }
    if (!res.ok) {
        throw new ApiError(res.status, data?.error || 'error', data?.message || `Request failed (${res.status}).`, data);
    }
    return isJson ? data : res;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body ?? {});
export const put = (path, body) => api('PUT', path, body);
export const patch = (path, body) => api('PATCH', path, body);
