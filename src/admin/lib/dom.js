// src/admin/lib/dom.js
//
// Tiny DOM builder for the admin. Strings always become TEXT (never HTML), so
// content from the database can't inject markup.
//
//   h('button', { class: 'a-btn', onClick: save, disabled: busy }, 'Save')
//   h('ul', null, items.map(i => h('li', null, i.name)))

/**
 * @param {string} tag
 * @param {object|null} props  class, dataset, style (object), on<Event> handlers,
 *                             DOM properties (value, checked, disabled…) or attributes
 * @param {...any} children    strings, nodes, arrays; null/false/undefined skipped
 */
export function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value == null || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (['value', 'checked', 'disabled', 'indeterminate', 'selected', 'hidden'].includes(key)) el[key] = value;
        else if (value === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(value));
    }
    append(el, children);
    return el;
}

/** Append children (same rules as h). */
export function append(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false || child === true) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

/** Replace all children of `el`. */
export function replace(el, ...children) {
    el.replaceChildren();
    return append(el, children);
}

/** Debounce: run fn after `ms` of quiet. `.flush()` runs it now; `.cancel()` drops it. */
export function debounce(fn, ms) {
    let timer = null;
    let lastArgs = [];
    const run = () => { timer = null; fn(...lastArgs); };
    const d = (...args) => { lastArgs = args; clearTimeout(timer); timer = setTimeout(run, ms); };
    d.flush = () => { if (timer) { clearTimeout(timer); run(); } };
    d.cancel = () => { clearTimeout(timer); timer = null; };
    d.pending = () => timer !== null;
    return d;
}
