// src/prefs.js
//
// Picture Twirl — Durable device preferences (localStorage)
// -----------------------------------------------------------------------------
// Purpose
// - Remember the names a person actually liked, across sessions and reloads:
//   their screen name, the game title, and the last two team names they typed
//   or rolled.
//
// Design
// - localStorage (durable, per-device) — the deliberate counterpart to
//   session.js, which uses sessionStorage (ephemeral, per-tab).
// - Every access is wrapped: private mode / quota / disabled storage must
//   degrade to "no remembered value", never throw.
// - The resolve* helpers are the one place that stitch storage together with
//   names.js: remembered value if we have one, otherwise generate and remember
//   it so the suggestion sticks from then on.
// -----------------------------------------------------------------------------

import { LIMITS } from './config.js';
import { randomGameName, randomPlayerName, randomTeamName } from './names.js';

const KEY_PLAYER_NAME = 'pt.prefs.playerName';
const KEY_GAME_NAME = 'pt.prefs.gameName';
const KEY_TEAM_NAME = { A: 'pt.prefs.teamName.A', B: 'pt.prefs.teamName.B' };

/** Read a string from localStorage, or '' if unavailable/empty. */
function read(storageKey) {
    try {
        return (localStorage.getItem(storageKey) || '').trim();
    } catch {
        return '';
    }
}

/** Write a string to localStorage; silently ignore storage failures. */
function write(storageKey, value) {
    try {
        if (value) localStorage.setItem(storageKey, value);
        else localStorage.removeItem(storageKey);
    } catch {
        // private mode / quota / storage disabled — remembering is best-effort
    }
}

/** Trim + clamp to a field limit. */
function clean(value, max) {
    return String(value ?? '').trim().slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen name (shared by the GM's create form and the player's join form —
// it's "my name on this device", regardless of which role I take)
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {string} the remembered screen name, or '' if none. */
export function loadPlayerName() {
    return clean(read(KEY_PLAYER_NAME), LIMITS.DISPLAY_NAME);
}

/** Remember a screen name (blank clears it). @param {string} name */
export function savePlayerName(name) {
    write(KEY_PLAYER_NAME, clean(name, LIMITS.DISPLAY_NAME));
}

/**
 * The name to prefill a screen-name field with: remembered if we have one,
 * otherwise a fresh generated one — which is then remembered, so the same
 * playful name greets them next time.
 * @returns {string}
 */
export function resolvePlayerName() {
    const stored = loadPlayerName();
    if (stored) return stored;

    const generated = clean(randomPlayerName(), LIMITS.DISPLAY_NAME);
    savePlayerName(generated);
    return generated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game title (the name of tonight's game — a recurring host tends to reuse it)
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {string} the remembered game title, or '' if none. */
export function loadGameName() {
    return clean(read(KEY_GAME_NAME), LIMITS.GAME_TITLE);
}

/** Remember a game title (blank clears it). @param {string} name */
export function saveGameName(name) {
    write(KEY_GAME_NAME, clean(name, LIMITS.GAME_TITLE));
}

/** Remembered game title, else a generated one (which is then remembered). */
export function resolveGameName() {
    const stored = loadGameName();
    if (stored) return stored;

    const generated = clean(randomGameName(), LIMITS.GAME_TITLE);
    saveGameName(generated);
    return generated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Team names
// ─────────────────────────────────────────────────────────────────────────────

/** @param {'A'|'B'} teamKey @returns {string} remembered team name, or ''. */
export function loadTeamName(teamKey) {
    const storageKey = KEY_TEAM_NAME[teamKey];
    return storageKey ? clean(read(storageKey), LIMITS.TEAM_NAME) : '';
}

/** Remember a team name (blank clears it). @param {'A'|'B'} teamKey @param {string} name */
export function saveTeamName(teamKey, name) {
    const storageKey = KEY_TEAM_NAME[teamKey];
    if (storageKey) write(storageKey, clean(name, LIMITS.TEAM_NAME));
}

/**
 * The pair to prefill the two team-name fields with. Remembered names win;
 * anything missing is filled from a freshly generated, distinct pair and
 * remembered.
 * @returns {[string, string]}
 */
export function resolveTeamNames() {
    const storedA = loadTeamName('A');
    const storedB = loadTeamName('B');
    if (storedA && storedB) return [storedA, storedB];

    // Generate only what's missing, never colliding with the name beside it.
    const a = storedA || clean(randomTeamName([storedB]), LIMITS.TEAM_NAME);
    const b = storedB || clean(randomTeamName([a]), LIMITS.TEAM_NAME);

    saveTeamName('A', a);
    saveTeamName('B', b);
    return [a, b];
}
