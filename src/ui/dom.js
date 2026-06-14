// src/ui/dom.js
//
// Picture Twirl — Minimal DOM helpers
// -----------------------------------------------------------------------------
// Goals
// - Tiny, safe wrappers to keep UI code DRY and readable.
// - Null-safe: all helpers tolerate missing elements and return no-ops.
// - Small surface: only what the app actually uses.
//
// Exports
// - byId(id): HTMLElement|null
// - enable(el), disable(el)      → toggles .disabled
// - on(el, event, handler, opts) → adds listener; returns () => off()
// - el(tag, attrs?, children?)   → element factory (used by src/components/*)
// -----------------------------------------------------------------------------

/** @param {string} id */
export const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

/**
 * Tiny element factory used by the reusable components in src/components/.
 *   el('button', { class: 'btn primary', onClick: fn, disabled: true }, 'Go')
 * Attr conventions:
 *  - class → className
 *  - text  → textContent
 *  - html  → innerHTML
 *  - onX (function) → addEventListener('x', fn)  (e.g. onClick → 'click')
 *  - value === true → boolean attribute; value == null/false → skipped
 *  - else → setAttribute(key, value)
 * Children: a node, a string, or an array of those (null/false skipped).
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {any} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = String(v);
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'html') node.innerHTML = String(v);
        else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
            node.setAttribute(k, '');
        } else {
            node.setAttribute(k, String(v));
        }
    }
    const kids = Array.isArray(children) ? children : [children];
    for (const c of kids) {
        if (c == null || c === false) continue;
        node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
}

/** Enable/disable any control that supports the .disabled property. */
export const enable = (el) => { if (el && 'disabled' in el) el.disabled = false; };
export const disable = (el) => { if (el && 'disabled' in el) el.disabled = true; };

/**
 * Safe event binding.
 * - Works with null elements (returns a no-op off()) so callers can skip guards.
 * - Returns an unsubscribe function to remove the listener.
 * @template {Element | Document | Window | null | undefined} T
 * @param {T} el
 * @param {string} type
 * @param {(e: Event) => any} handler
 * @param {boolean|AddEventListenerOptions} [opts]
 * @returns {() => void} off
 */
export function on(el, type, handler, opts) {
    if (!el || !el.addEventListener) return () => { };
    el.addEventListener(type, handler, opts);
    let called = false;
    return () => {
        if (!called && el && el.removeEventListener) {
            el.removeEventListener(type, handler, opts);
            called = true;
        }
    };
}
