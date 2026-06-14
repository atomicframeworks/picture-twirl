// src/ui/format.js
//
// Small formatting/escaping helpers for safe DOM rendering.

/**
 * Escape a string for safe interpolation into innerHTML.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
