// src/admin/lib/router.js
//
// Hash routes so /admin/ is the only server route:
//   #/                 dashboard
//   #/boards?status=…  boards table (filters live in the query)
//   #/boards/brd_…     board editor
//   #/activity         audit log

/** Parse location.hash → { path, segments, query } */
export function currentRoute() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [pathPart, queryPart = ''] = raw.split('?');
    const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    return { path, segments: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

function hashFor(path, query = {}) {
    const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString();
    return `#${path}${q ? `?${q}` : ''}`;
}

/** Go somewhere (adds a history entry, re-renders). */
export function navigate(path, query) {
    location.hash = hashFor(path, query);
}

/** Update the query without re-rendering or adding history (filters, sort). */
export function replaceQuery(query) {
    history.replaceState(null, '', hashFor(currentRoute().path, query));
}

/** Call `onRoute(route)` now and on every hash change. Returns an unsubscribe. */
export function onRouteChange(onRoute) {
    const handler = () => onRoute(currentRoute());
    window.addEventListener('hashchange', handler);
    handler();
    return () => window.removeEventListener('hashchange', handler);
}
