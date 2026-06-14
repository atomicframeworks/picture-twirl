// src/components/buttons.js — reusable button components
import { el } from '../ui/dom.js';

/**
 * A standard button. Mirrors the app's `.btn` + variant classes.
 * @param {object} o
 * @param {string} o.label
 * @param {'primary'|'secondary'|'ghost'|'danger'|'buzz-btn'|''} [o.variant='primary']
 * @param {'button'|'submit'} [o.type='button']
 * @param {boolean} [o.disabled=false]
 * @param {(e: Event) => void} [o.onClick]
 * @param {string} [o.className='']
 * @returns {HTMLButtonElement}
 */
export function Button({ label, variant = 'primary', type = 'button', disabled = false, onClick, className = '' } = {}) {
    return /** @type {HTMLButtonElement} */ (el('button', {
        class: ['btn', variant, className].filter(Boolean).join(' '),
        type,
        disabled,
        onClick,
    }, label));
}

/**
 * An icon button (`.icon-btn`). `icon` is an inline SVG/HTML string.
 * @param {object} o
 * @param {string} o.icon   inline SVG markup
 * @param {string} [o.title]
 * @param {boolean} [o.large=false]   adds `.is-lg`
 * @param {(e: Event) => void} [o.onClick]
 * @returns {HTMLButtonElement}
 */
export function IconButton({ icon = '', title = '', large = false, onClick } = {}) {
    return /** @type {HTMLButtonElement} */ (el('button', {
        class: ['icon-btn', large ? 'is-lg' : ''].filter(Boolean).join(' '),
        type: 'button',
        title,
        html: icon,
        onClick,
    }));
}
