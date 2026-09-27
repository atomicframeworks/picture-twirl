// src/ui/diceButton.js
//
// Shared "roll a new name" button behaviour.
// - spinDice(button): play the CSS dice-roll animation once.
// - attachDiceButton(button, onRoll): click → spin + onRoll().
//
// Markup contract (see .btn-dice in main.css):
//   <button type="button" class="btn-dice" aria-label="…">
//     <span class="btn-dice-face" aria-hidden="true">🎲</span>
//   </button>

import { on } from './dom.js';

/**
 * Spin the dice glyph once. Restarting the animation needs a reflow between
 * removing and re-adding the class, or rapid clicks show nothing.
 * (CSS honours prefers-reduced-motion and skips the spin.)
 * @param {HTMLElement|null|undefined} button
 */
export function spinDice(button) {
    if (!button) return;
    button.classList.remove('is-rolling');
    void button.offsetWidth;
    button.classList.add('is-rolling');
}

/**
 * Wire a dice button to a roll handler, with the spin animation attached.
 * @param {HTMLButtonElement|null|undefined} button
 * @param {() => void} onRoll  Called at click time to produce + apply a new name
 * @returns {() => void} unsubscribe
 */
export function attachDiceButton(button, onRoll) {
    if (!button || typeof onRoll !== 'function') return () => { };
    return on(button, 'click', (e) => {
        e.preventDefault();
        spinDice(button);
        onRoll();
    });
}
