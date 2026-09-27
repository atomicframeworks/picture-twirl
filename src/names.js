// src/names.js
//
// Picture Twirl — Playful name generators
// -----------------------------------------------------------------------------
// Purpose
// - Suggest a screen name for a player/GM: <Adjective> <Noun> <3 digits>,
//   e.g. "Lucky Buzzer 407".
// - Suggest a team name from a hand-written list of game-show tropes and puns,
//   e.g. "Sultans of Swirl".
// - Suggest a game (night) title in the same voice, e.g. "Focus Pocus".
//
// Design
// - Pure content + pure functions. No DOM, no storage, no Firebase.
// - Persistence (remember what the user liked) lives in prefs.js.
// - Keep every entry inside LIMITS.DISPLAY_NAME / LIMITS.TEAM_NAME (40 chars)
//   and LIMITS.GAME_TITLE (60).
// -----------------------------------------------------------------------------

/** Adjectives for generated screen names. Game-show energy, kid-safe. */
export const PLAYER_ADJECTIVES = [
    'Lucky', 'Buzzy', 'Snappy', 'Dizzy', 'Swirly', 'Twirly',
    'Sparkly', 'Flashy', 'Zippy', 'Giddy', 'Peppy', 'Sassy',
    'Cheeky', 'Plucky', 'Jolly', 'Groovy', 'Rowdy', 'Speedy',
    'Scrappy', 'Clutch', 'Wild', 'Grand', 'Turbo', 'Fuzzy',
    'Blurry', 'Squinty', 'Hasty', 'Eager', 'Nimble', 'Dazzling',
    'Bold', 'Sneaky', 'Jumpy', 'Bonus', 'Golden', 'Mighty',
];

/** Nouns for generated screen names. Mostly game-show props and tropes. */
export const PLAYER_NOUNS = [
    'Buzzer', 'Podium', 'Wheel', 'Spinner', 'Gong', 'Confetti',
    'Jackpot', 'Streak', 'Showcase', 'Whammy', 'Lifeline', 'Applause',
    'Curtain', 'Spotlight', 'Trophy', 'Tiebreak', 'Pixel', 'Swirl',
    'Twirl', 'Clue', 'Guess', 'Hunch', 'Wager', 'Chime',
    'Bell', 'Prize', 'Kazoo', 'Encore', 'Finale', 'Champ',
    'Rookie', 'Contestant', 'Ribbon', 'Streamer', 'Zonk', 'Blur',
];

/** Ready-made team names: game-show tropes + puns (Family Feud house style). */
export const TEAM_NAMES = [
    'Quiz Khalifa',
    'Sultans of Swirl',
    'Twirl Power',
    'Blur Necessities',
    'Swirled Champions',
    'Trivia and Error',
    'Les Quizerables',
    "Let's Get Quizzical",
    'The Quizzy Bees',
    'Agatha Quiztie',
    'Buzzed and Confused',
    'The Buzzer Beaters',
    'Buzz Lightyears',
    'Wheel of Misfortune',
    'The Spin Doctors',
    'Whirled Peace',
    'The Whammy Whackers',
    'Survey Says',
    'Feuding Fam',
    'The Podium Pals',
    'Bonus Round Bandits',
    'Confetti Cannons',
    'Curtain Callers',
    'Showcase Showdown',
    'The Lifeliners',
    'Phone a Friends',
    'Final Answer Finalists',
    'The Tiebreakers',
    'Team Zonk',
    'Gong Show Goons',
    'Smarty Pints',
    'Fuzzy Logic',
    'No Clue Crew',
    'The Hunch Bunch',
    'Wager Wizards',
    'Out of Focus Group',
    'The Squint Squad',
    'Pixel Pushers',
    'Applause Cause',
    'The Encore Corps',
    'Prize Fighters',
    'Ding Dong Dynasty',
    'Lightning Rounders',
    'The Great Unblurrables',
    "Guess Who's Back",
    'Swirl Interrupted',
    'Jackpot Janitors',
    'The Spin Cycle',
    'Riddle Me Timbers',
    'Whirl Tour',
    'Double Takers',
    'Swirl Next Door',
    'The Wild Guessers',
    'Optical Illusionists',
];

/** Ready-made game-night titles: same voice as the team names, one per night. */
export const GAME_NAMES = [
    'Friday Funnies',
    'Swirl Night Live',
    'Twirl of Fortune',
    'Focus Pocus',
    'Name That Blur',
    'Now You See It',
    'The Big Reveal',
    'The Big Blur',
    'Picture This',
    'Twirls Just Want to Have Fun',
    'Blur Night Out',
    'The Swirl Series',
    'The Whirl Cup',
    'Family Blurd',
    'Guess Who’s Twirling',
    'The Great Guess-Off',
    'Swirl Power Hour',
    'Eyes on the Prize',
    'Rounds of Applause',
    'The Unswirling',
    'Twirlpool',
    'Twirlmania',
    'Blur-day Party',
    'Squint & Shout',
    'Squint Night',
    'Hazy Days',
    'Fuzzy Friday',
    'The Fuzz Buzz',
    'Blurry Business',
    'Blurred Vision Night',
    'Pixel Panic',
    'Spin to Win Night',
    'Spin Cycle Sunday',
    'Game Night Gone Swirl',
    'Clearly Confused',
    'Couch Contestants',
    'Snack & Guess',
    'Guess Fest',
    'Vision Quest',
    'Unswirl Yourself',
];

/** Random element of a non-empty array. */
function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

/** Normalize for "is this the same name?" comparisons. */
function key(value) {
    return String(value ?? '').trim().toLowerCase();
}

/**
 * Generate a screen name like "Lucky Buzzer 407". Pass the name currently on
 * screen as `exclude` so a re-roll always visibly changes something.
 * @param {Array<string|null|undefined>} [exclude]
 * @returns {string}
 */
export function randomPlayerName(exclude = []) {
    const taken = new Set(exclude.map(key).filter(Boolean));
    let name = '';
    // 1296 word pairs × 900 numbers — a repeat is vanishingly rare, so a few
    // tries is plenty; the last one stands either way.
    for (let i = 0; i < 8; i++) {
        const digits = 100 + Math.floor(Math.random() * 900); // always 3 digits
        name = `${pick(PLAYER_ADJECTIVES)} ${pick(PLAYER_NOUNS)} ${digits}`;
        if (!taken.has(key(name))) break;
    }
    return name;
}

/**
 * Pick a team name, avoiding any names already in play (e.g. the other team's,
 * or the one currently shown — so a re-roll always visibly changes something).
 * @param {Array<string|null|undefined>} [exclude]
 * @returns {string}
 */
export function randomTeamName(exclude = []) {
    const taken = new Set(exclude.map(key).filter(Boolean));
    const pool = TEAM_NAMES.filter(n => !taken.has(key(n)));
    return pick(pool.length ? pool : TEAM_NAMES);
}

/**
 * Pick a game-night title, avoiding the one currently shown so a re-roll always
 * changes something.
 * @param {Array<string|null|undefined>} [exclude]
 * @returns {string}
 */
export function randomGameName(exclude = []) {
    const taken = new Set(exclude.map(key).filter(Boolean));
    const pool = GAME_NAMES.filter(n => !taken.has(key(n)));
    return pick(pool.length ? pool : GAME_NAMES);
}
