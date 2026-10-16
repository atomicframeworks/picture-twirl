// String length limits
export const LIMITS = {
    DISPLAY_NAME: 40,
    GAME_TITLE: 60,
    GAME_ID: 20,
    TEAM_NAME: 40,
};

// Swirl animation settings
export const SWIRL = {
    DURATION_MS: 14000,    // 14 seconds total reveal duration
    STRENGTH: 2.0,         // Swirl intensity (1=gentle, 10=extreme)
    // Piecewise easing keyframes [t, p] — both normalized 0..1.
    // t = elapsed / DURATION_MS; p = fraction unswirled (0=fully distorted, 1=clear).
    // Edit these to tune the slow→accelerate→settle feel without touching swirl.js.
    EASE: [
        [0.000, 0.00],  // 0 s  — start fully distorted
        [0.143, 0.10],  // 2 s  — slow anticipation
        [0.357, 0.30],  // 5 s  — building speed
        [0.571, 0.55],  // 8 s  — fast discovery
        [0.786, 0.82],  // 11 s — recognition phase
        [0.929, 0.96],  // 13 s — settling
        [1.000, 1.00],  // 14 s — fully revealed
    ],
};

// Starting-team reveal: how long the coin-flip overlay stays visible (all clients)
export const STARTING_REVEAL = {
    DURATION_MS: 3500,
};

// Team identifiers
export const TEAM = {
    A: 'A',
    B: 'B',
    NONE: 'none',
};

// Team answer identifiers (for RTDB answeredBy field)
export const TEAM_ANSWER = {
    A: 'teamA',
    B: 'teamB',
};

// Helper to convert team key to answer identifier
export function teamToAnswer(teamKey) {
    return teamKey === TEAM.A ? TEAM_ANSWER.A : TEAM_ANSWER.B;
}

// Double Take — random bonus mechanic
export const DOUBLE_TAKE = {
    ELIGIBILITY: {
        MIN_COMPLETED: 4,       // questions completed before Double Take is eligible
        MAX_PER_GAME:  2,       // maximum Double Takes per board
        COOLDOWN_QUESTIONS: 3,  // minimum questions between Double Takes
    },
    // Probability tiers — ordered highest-gap-first; first match wins.
    PROBABILITY: [
    { minGap: 0.50, p: 0.15 },
    { minGap: 0.30, p: 0.10 },
    { minGap: 0.15, p: 0.06 },
    { minGap: 0,    p: 0.03 },
    ],
};