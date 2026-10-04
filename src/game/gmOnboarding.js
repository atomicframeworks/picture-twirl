// src/game/gmOnboarding.js
// Persists GM onboarding state to localStorage.
// Key: pt.gm.onboarding.v1
// Shape: { dismissed, lobbySeen, boardSeen, adjudicationSeen, endingSeen }

const KEY = 'pt.gm.onboarding.v1';
const DEFAULTS = {
    dismissed:        false,
    lobbySeen:        false,
    boardSeen:        false,
    adjudicationSeen: false,
    endingSeen:       false,
};

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
export function dismissGMOnboarding() { write({ ...read(), dismissed: true }); }

// ── Lobby Phase 1 ─────────────────────────────────────────────────────────────
export function shouldShowLobbyTour() { const s = read(); return !s.dismissed && !s.lobbySeen; }
export function markLobbyComplete()   { write({ ...read(), lobbySeen: true }); }

// ── Running the Game Phase 2 ──────────────────────────────────────────────────
export function shouldShowBoardIntro()      { const s = read(); return !s.dismissed && !s.boardSeen; }
export function markBoardIntroComplete()    { write({ ...read(), boardSeen: true }); }
export function shouldShowAdjudication()    { const s = read(); return !s.dismissed && !s.adjudicationSeen; }
export function markAdjudicationComplete()  { write({ ...read(), adjudicationSeen: true }); }
export function shouldShowEnding()          { const s = read(); return !s.dismissed && !s.endingSeen; }
export function markEndingComplete()        { write({ ...read(), endingSeen: true }); }
