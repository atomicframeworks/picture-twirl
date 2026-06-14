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
// -----------------------------------------------------------------------------

/** @param {string} id */
export const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

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
