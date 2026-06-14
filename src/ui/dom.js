// src/ui/dom.js
//
// Picture Twirl — Minimal DOM helpers
// -----------------------------------------------------------------------------
// Goals
// - Tiny, safe wrappers to keep UI code DRY and readable.
// - Null-safe: all helpers tolerate missing elements and return no-ops.
// - Small surface: only stuff we actually use + a couple of well-chosen extras.
//
// Exports
// - byId(id): HTMLElement|null
// - qs(rootOrSelector, [selector]): Element|null
// - qsa(rootOrSelector, [selector]): Element[]
// - show(el), hide(el)           → toggles [hidden]
// - enable(el), disable(el)      → toggles .disabled
// - on(el, event, handler, opts) → adds listener; returns () => off()
// - el(tag, attrs?, children?)   → small element factory
// - setText(el, text), setHTML(el, html)
// -----------------------------------------------------------------------------

/** @param {string} id */
export const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

/**
 * Query helper:
 *  - qs('.selector') or qs(rootEl, '.selector')
 *  - Returns first match or null
 */
export function qs(rootOrSelector, selector) {
    if (typeof document === 'undefined') return null;
    if (typeof rootOrSelector === 'string') return document.querySelector(rootOrSelector);
    if (!rootOrSelector) return null;
    return rootOrSelector.querySelector(selector);
}

/**
 * Query-all helper:
 *  - qsa('.selector') or qsa(rootEl, '.selector')
 *  - Always returns an array (possibly empty)
 */
export function qsa(rootOrSelector, selector) {
    if (typeof document === 'undefined') return [];
    if (typeof rootOrSelector === 'string') return Array.from(document.querySelectorAll(rootOrSelector));
    if (!rootOrSelector) return [];
    return Array.from(rootOrSelector.querySelectorAll(selector));
}

/** Show/hide via the native [hidden] attribute (no global CSS required). */
export const show = (el) => { if (el && el.removeAttribute) el.removeAttribute('hidden'); };
export const hide = (el) => { if (el && el.setAttribute) el.setAttribute('hidden', ''); };

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

/**
 * Small element factory:
 *   el('div', { class: 'card', id: 'x', html: '<b>Hi</b>' }, [child1, 'text'])
 * - Attr keys:
 *   - class → sets className
 *   - html  → sets innerHTML (use sparingly)
 *   - text  → sets textContent (preferred)
 *   - anything else → setAttribute(k, v)
 */
export function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null) continue;
        if (k === 'class') n.className = String(v);
        else if (k === 'html') n.innerHTML = String(v);
        else if (k === 'text') n.textContent = String(v);
        else n.setAttribute(k, String(v));
    }
    const kids = Array.isArray(children) ? children : [children];
    for (const c of kids) {
        if (c == null) continue;
        if (c.nodeType) n.appendChild/** @type {Node} */(c);
        else n.appendChild(document.createTextNode(String(c)));
    }
    return n;
}

/** Convenience setters (null-safe). */
export const setText = (el, text) => { if (el) el.textContent = text ?? ''; };
export const setHTML = (el, html) => { if (el) el.innerHTML = html ?? ''; };
