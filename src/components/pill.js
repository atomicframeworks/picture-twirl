// src/components/pill.js — player pill chip
import { el } from '../ui/dom.js';

/**
 * A player pill (`.pill`), as used in the lobby player lists.
 * @param {object} o
 * @param {string} o.label
 * @param {boolean} [o.isMe=false]      adds `.is-me`
 * @param {boolean} [o.clickable=false] adds `.is-clickable`
 * @param {boolean} [o.selected=false]  adds `.is-selected`
 * @param {string} [o.pid]              data-pid attribute
 * @param {(e: Event) => void} [o.onClick]
 * @returns {HTMLButtonElement}
 */
export function Pill({ label, isMe = false, clickable = false, selected = false, pid, onClick } = {}) {
    return /** @type {HTMLButtonElement} */ (el('button', {
        class: ['pill', isMe && 'is-me', clickable && 'is-clickable', selected && 'is-selected']
            .filter(Boolean).join(' '),
        'data-pid': pid,
        title: label,
        onClick,
    }, label));
}
