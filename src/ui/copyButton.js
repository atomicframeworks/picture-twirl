// src/ui/copyButton.js
//
// Shared clipboard helpers with visual feedback.
// - flashCheckmark(button): swap inner SVG to a checkmark for 1.5s, then restore.
// - attachCopyButton(button, getText): click → clipboard write + flashCheckmark.

import { on } from './dom.js';

const CHECK_SVG_24 = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const CHECK_SVG_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

/**
 * Briefly replace a button's inner HTML with a checkmark, then restore it.
 * Auto-picks 20px or 24px based on the button's existing SVG size.
 * @param {HTMLButtonElement|null|undefined} button
 * @param {number} [ms=1500]
 */
export function flashCheckmark(button, ms = 1500) {
    if (!button) return;
    const isLarge = !!button.querySelector('svg[width="24"]');
    const originalHTML = button.innerHTML;
    button.innerHTML = isLarge ? CHECK_SVG_24 : CHECK_SVG_20;
    setTimeout(() => { button.innerHTML = originalHTML; }, ms);
}

/**
 * Wire a button to copy text to clipboard with checkmark feedback.
 * @param {HTMLButtonElement|null|undefined} button
 * @param {() => string} getText  Called at click time to produce the text to copy
 * @returns {() => void} unsubscribe
 */
export function attachCopyButton(button, getText) {
    if (!button) return () => { };
    return on(button, 'click', async () => {
        try {
            await navigator.clipboard.writeText(getText());
            flashCheckmark(button);
        } catch (err) {
            console.error('Clipboard failed:', err);
        }
    });
}
