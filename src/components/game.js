// src/components/game.js — game-specific components
import { el } from '../ui/dom.js';

/**
 * A team scoreboard card (`.scoreboard-card.is-a|is-b`).
 * @param {object} o
 * @param {'A'|'B'} [o.team='A']
 * @param {string} [o.name]
 * @param {number|string} [o.score=0]
 * @param {string} [o.icon]    defaults to 🐕 (A) / 🐈 (B)
 * @param {string} [o.player]  active player name (shown in corner)
 */
export function ScoreboardCard({ team = 'A', name, score = 0, icon = '', player = '' } = {}) {
    return el('div', { class: `scoreboard-card ${team === 'B' ? 'is-b' : 'is-a'}` },
        el('div', { class: 'scoreboard-content' }, [
            el('div', { class: 'scoreboard-icon' }, icon || (team === 'B' ? '🐈' : '🐕')),
            el('div', { class: 'scoreboard-info' }, [
                el('div', { class: 'scoreboard-name' }, name || `Team ${team}`),
                el('div', { class: 'scoreboard-score' }, String(score)),
            ]),
            el('div', { class: 'scoreboard-player' }, player),
        ]));
}

/**
 * A selectable question-set card (`.set-card`), used in the create wizard.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.title
 * @param {string} [o.subtitle]
 * @param {string} [o.icon='🃏']
 * @param {boolean} [o.selected=false]
 * @param {(e: Event) => void} [o.onClick]
 * @returns {HTMLButtonElement}
 */
export function SetCard({ id, title, subtitle = '', icon = '🃏', selected = false, onClick } = {}) {
    return /** @type {HTMLButtonElement} */ (el('button', {
        class: ['set-card', selected && 'is-selected'].filter(Boolean).join(' '),
        'data-set': id,
        type: 'button',
        'aria-pressed': selected ? 'true' : 'false',
        onClick,
    }, [
        el('div', { class: 'set-ic', 'aria-hidden': 'true' }, icon),
        el('div', {}, [
            el('div', { class: 'set-title' }, title || id),
            subtitle && el('div', { class: 'set-sub' }, subtitle),
        ].filter(Boolean)),
    ]));
}

/**
 * A board value tile (`.tile`), with optional state.
 * @param {object} o
 * @param {number|string} [o.value]
 * @param {''|'opened'|'answered'|'disabled'} [o.state='']
 */
export function BoardTile({ value = '', state = '' } = {}) {
    return el('div', {
        class: ['tile', state].filter(Boolean).join(' '),
        role: 'button',
    }, state === 'answered' ? '✔' : String(value));
}

/** A board category header cell (`.category`). */
export function CategoryCell({ name } = {}) {
    return el('div', { class: 'category' }, name);
}
