// String length limits
export const LIMITS = {
    DISPLAY_NAME: 40,
    GAME_TITLE: 60,
    GAME_ID: 20,
    TEAM_NAME: 40,
};

// Swirl animation settings
export const SWIRL = {
    DURATION_MS: 30000,    // 30 seconds
    STRENGTH: 2.0,         // Swirl intensity
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
        { minGap: 0.50, p: 1.0 },
        { minGap: 0.30, p: 1.0 },
        { minGap: 0.15, p: 1.0 },
        { minGap: 0,    p: 1.0 },
    ],
};