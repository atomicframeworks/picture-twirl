// Board configuration
export const CATEGORY_COUNT = 6;
export const ROW_COUNT = 4;
export const POINT_VALUES = [200, 400, 600, 800, 1000];

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

// Development mode
export const DEBUG = import.meta.env.DEV;