// src/components/forms.js — form field components
import { el } from '../ui/dom.js';

/**
 * A labelled input with optional hint and inline error row.
 * Mirrors the `.field` / `.input` / `.field-hint` / `.error-row` markup.
 * @param {object} o
 * @param {string} [o.id]
 * @param {string} [o.label]
 * @param {string} [o.hint]
 * @param {string} [o.type='text']
 * @param {string} [o.placeholder]
 * @param {string} [o.value]
 * @param {string} [o.error]   when set, renders the inline error row
 * @returns {HTMLDivElement}
 */
export function Field({ id, label, hint = '', type = 'text', placeholder = '', value = '', error = '' } = {}) {
    const children = [];
    if (label) children.push(el('label', { class: 'field-label', for: id }, label));
    children.push(el('input', { id, class: 'input', type, placeholder, value }));
    if (hint) children.push(el('div', { class: 'field-hint' }, hint));
    if (error) {
        children.push(el('div', { class: 'error-row' }, [
            el('span', { class: 'x' }, '✖'),
            el('span', {}, error),
        ]));
    }
    return /** @type {HTMLDivElement} */ (el('div', { class: 'field' }, children));
}
