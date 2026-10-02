// src/game/gmOnboarding.js
// Persists GM onboarding state to localStorage.
// Key: pt.gm.onboarding.v1
// Shape: { dismissed, lobbySeen, boardSeen, adjudicationSeen }

const KEY = 'pt.gm.onboarding.v1';
const DEFAULTS = { dismissed: false, lobbySeen: false, boardSeen: false, adjudicationSeen: false };

function read() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULTS };
    }
}

function write(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function loadGMOnboarding() { return read(); }
export function saveGMOnboarding(patch) { write({ ...read(), ...patch }); }
export function shouldShowLobbyTour() { const s = read(); return !s.dismissed && !s.lobbySeen; }
export function markLobbyComplete() { write({ ...read(), lobbySeen: true }); }
export function dismissGMOnboarding() { write({ ...read(), dismissed: true }); }
