// src/components/layout.js — structural / layout components
import { el } from '../ui/dom.js';

/**
 * A card surface (`.card`, optional `.card-sm`, `.text-center`).
 * @param {object} o
 * @param {Node|Node[]|string} [o.children]
 * @param {'sm'|''} [o.size='']
 * @param {boolean} [o.center=false]
 * @param {string} [o.className='']
 */
export function Card({ children = [], size = '', center = false, className = '' } = {}) {
    return el('div', {
        class: ['card', size === 'sm' ? 'card-sm' : '', center ? 'text-center' : '', className]
            .filter(Boolean).join(' '),
    }, children);
}

/**
 * A page heading. `size` maps to `.heading-xl` (h1) or `.heading-lg` (h2).
 * @param {object} o
 * @param {string} o.text
 * @param {'xl'|'lg'} [o.size='xl']
 */
export function Heading({ text, size = 'xl', className = '' } = {}) {
    const tag = size === 'lg' ? 'h2' : 'h1';
    return el(tag, { class: [`heading-${size}`, className].filter(Boolean).join(' ') }, text);
}

/** A section header bar (`.section-header`). */
export function SectionHeader({ title } = {}) {
    return el('header', { class: 'section-header' },
        el('h2', { class: 'section-header-title' }, title));
}

/**
 * A game header (`.game-header`) with title and optional game-code row.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.code]   when set, renders the "Game Code: XXXX" row
 */
export function GameHeader({ title, code = '' } = {}) {
    const kids = [el('h1', { class: 'game-header-title' }, title)];
    if (code) {
        kids.push(el('div', { class: 'game-code-row' }, [
            el('span', { class: 'game-code-label' }, 'Game Code:'),
            el('code', { class: 'game-code-value' }, code),
        ]));
    }
    return el('header', { class: 'game-header' }, kids);
}

/** A sticky bottom action tray (`.actions-tray`). */
export function ActionsTray({ children = [] } = {}) {
    return el('footer', { class: 'actions-tray' }, children);
}
