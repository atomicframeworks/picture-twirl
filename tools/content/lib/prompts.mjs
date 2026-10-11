// tools/content/lib/prompts.mjs
//
// The AI instructions + JSON schemas for the content tools. Kept in one place
// so every backend (claude-code / ollama) gets the same rules. The rights
// policy itself is enforced in code (src/shared/rights.js), not by the AI.

const BOARD_RULES = `A Picture Twirl board has exactly 5 categories (columns) × 5 picture tiles. Each tile is ONE picture that slowly un-swirls while teams race to guess its ANSWER. Points come from the row: 100 = easiest (instantly recognizable) … 500 = hardest (still fair).

Rules:
- Every answer must be something one clear photo or illustration can show, and that free-license libraries (Wikimedia Commons, Openverse/Flickr Creative Commons, Unsplash) likely have: foods, animals, plants, objects, places, landmarks, nature, holidays and traditions, vehicles, sports gear, instruments, public-domain art, space (NASA), famous public figures (allowed, they get flagged), brand logos (allowed, flagged).
- Never plan answers that need copyrighted characters, TV/film stills, album covers, video-game screenshots or memes.
- Answers are short (1–4 words), unambiguous, and unique within a board.
- Names are fun, game-show style; puns welcome ("Snack Attack", "Spooky Season", "Divine Desserts"). Board names ≤ 40 characters, category names ≤ 24. One emoji per board.
- In every category the 5 tiles go from easiest (first) to hardest (last).
- Family friendly. English.`;

export const PLAN_SYSTEM = `You design boards for Picture Twirl, a family party trivia game.\n\n${BOARD_RULES}\n\nReturn only JSON that matches the schema.`;

export const DISCOVER_SYSTEM = `You design NEW boards for Picture Twirl, a family party trivia game. Use web search to find fresh, broadly appealing, evergreen themes and to sanity-check that each answer is iconic enough for its row.\n\n${BOARD_RULES}\n\nReturn only JSON that matches the schema.`;

export const CHECK_SYSTEM = `You review candidate pictures for ONE tile of Picture Twirl, a picture-guessing party game (the picture un-swirls slowly; teams guess the answer).
Pick the candidate that best shows the answer as a clear, single, recognizable subject, at a difficulty that fits the tile's points.
The answer means what it means in its category and in "Looking for" (a punk band called “Fear” is the band, not the feeling). Use each candidate's library title to tell who or what it shows — you never need to recognize faces; a portrait whose title doesn't name the answer is not the answer.
Never accept a stand-in: a different thing that shares the name (the flower for a band called “Oxeye Daisy”, the town for a band called “Marfa”), a literal pun, or a related-but-different subject. If no candidate shows the actual answer, choose -1 — an empty tile is better than a wrong one.
Prefer photos of the subject itself over album/EP covers, posters, flyers and other designed artwork (logo categories excepted).
Disqualify candidates that: don't actually show the answer; are collages, screenshots, watermarked, low quality or confusing; are not family friendly.
answerVisible = the answer is spelled out in the picture (captions, labels, signs, packaging). For a logo category a wordmark logo is expected — still pick it, but set answerVisible true.
showsRealPerson = one or more identifiable real people are shown (recognizable faces — group shots and crowds in focus count). isLogo = it's a brand logo/trademark.
choice = index of the best candidate, or -1 if none is acceptable. Return only JSON that matches the schema.`;

const TILE = {
    type: 'object',
    properties: {
        answer: { type: 'string' },
        itemId: { type: 'string', description: 'Spreadsheet itemId copied exactly, or "" for a new answer' },
        searchQuery: { type: 'string', description: 'A good free-image search phrase for this answer' },
    },
    required: ['answer', 'itemId', 'searchQuery'],
    additionalProperties: false,
};

const CATEGORY = {
    type: 'object',
    properties: {
        title: { type: 'string' },
        sourceCategory: { type: 'string', description: 'Spreadsheet category it came from, or ""' },
        tiles: { type: 'array', items: TILE, description: 'Exactly 5, easiest first' },
    },
    required: ['title', 'sourceCategory', 'tiles'],
    additionalProperties: false,
};

const BOARD = {
    type: 'object',
    properties: {
        key: { type: 'string', description: 'short-kebab-case id, unique in this plan' },
        title: { type: 'string' },
        emoji: { type: 'string' },
        description: { type: 'string', description: 'One fun line players see (≤ 120 chars)' },
        categories: { type: 'array', items: CATEGORY, description: 'Exactly 5' },
    },
    required: ['key', 'title', 'emoji', 'description', 'categories'],
    additionalProperties: false,
};

export const PLAN_SCHEMA = {
    type: 'object',
    properties: {
        boards: { type: 'array', items: BOARD },
        skipped: {
            type: 'array',
            items: { type: 'object', properties: { itemId: { type: 'string' }, reason: { type: 'string' } }, required: ['itemId', 'reason'], additionalProperties: false },
        },
        ideas: {
            type: 'array',
            description: 'More boards we could build next',
            items: { type: 'object', properties: { title: { type: 'string' }, pitch: { type: 'string' } }, required: ['title', 'pitch'], additionalProperties: false },
        },
        notes: { type: 'string' },
    },
    required: ['boards', 'skipped', 'ideas', 'notes'],
    additionalProperties: false,
};

export const CHECK_SCHEMA = {
    type: 'object',
    properties: {
        choice: { type: 'integer' },
        answerVisible: { type: 'boolean' },
        showsRealPerson: { type: 'boolean' },
        isLogo: { type: 'boolean' },
        recognizability: { type: 'integer', description: '1 = very hard … 5 = instantly recognizable' },
        reason: { type: 'string' },
    },
    required: ['choice', 'answerVisible', 'showsRealPerson', 'isLogo', 'recognizability', 'reason'],
    additionalProperties: false,
};

/** Rights flags a picture check adds on top of the license's own. */
export function flagsFromCheck(check) {
    if (!check) return [];
    return [check.answerVisible && 'answer_visible', check.showsRealPerson && 'identifiable_person', check.isLogo && 'trademark'].filter(Boolean);
}

/** The spreadsheet, compactly, for the planner. */
export function sheetPrompt({ groups, existingTitles, boards }) {
    const lines = [];
    for (const [category, items] of groups) {
        const sub = items.find(i => i.subcategory)?.subcategory;
        lines.push(`- ${category}${sub ? ` (subcategory hint: ${sub})` : ''}`);
        for (const it of items) {
            const bits = [it.itemId, it.answer, it.difficulty ? `difficulty ${it.difficulty}` : 'difficulty ?',
                it.url ? `link: ${new URL(it.url).hostname}` : it.imageHint ? `picture idea: ${it.imageHint}` : 'no picture yet',
                it.notes && !it.subcategory ? `note: ${it.notes}` : null].filter(Boolean);
            lines.push(`  - ${bits.join(' · ')}`);
        }
    }
    return `Turn this team spreadsheet into Picture Twirl boards.

1. Group related spreadsheet categories into themed boards of exactly 5 categories (food with food, holidays together, logos together, music together…). Make as many complete boards as the material supports — up to ${boards}. A category with 10+ good items may become two categories.
2. Use spreadsheet items wherever they fit: copy their itemId exactly. Keep a given difficulty (100 = row 1 … 500 = row 5); otherwise order by how recognizable the answer is.
3. Where a category has fewer than 5 usable items, add NEW answers that fit (itemId "").
4. Skip items that break the rules or duplicate others; list them in "skipped" with a short reason.
5. Give every tile a searchQuery for free-image search, even when it has an itemId.
6. Don't reuse these existing board names: ${existingTitles.length ? existingTitles.join('; ') : '(none)'}.
7. In "ideas", suggest up to 8 more boards this spreadsheet hints at that we could build next (title + one-line pitch).

Spreadsheet (category → itemId · answer · difficulty · picture):
${lines.join('\n')}`;
}

/** @param {{ theme?: string, boards: number, existing: Array<{ title: string, description?: string }> }} args */
export function discoverPrompt({ theme, boards, existing }) {
    const taken = existing.map(b => `- ${b.title}${b.description ? ` — ${b.description}` : ''}`).join('\n') || '(none yet)';
    return `Propose ${boards} new Picture Twirl board${boards === 1 ? '' : 's'}${theme ? ` around this theme: "${theme}"` : ' on themes players would love (mix it up: food, nature, places, history, science, sports, holidays, pop-culture-adjacent topics with free pictures…)'}.
All tiles are new answers (itemId ""), each with a searchQuery for free-image search.
Don't repeat or closely overlap these existing boards (their names must not be reused either):
${taken}
Skipped can be empty. In "ideas", list 10 more board ideas for future runs (title + one-line pitch), different from the boards above.`;
}

/**
 * @param {{ board: string, category: string, answer: string, lookingFor?: string, points: number,
 *           candidates: Array<{ title?: string, provider?: string }> }} args
 */
export function checkPrompt({ board, category, answer, lookingFor, points, candidates }) {
    const list = candidates.map((c, i) => `#${i} “${String(c.title || 'untitled').slice(0, 120)}” (${c.provider || 'unknown source'})`);
    return `Board: ${board}
Category: ${category}
Answer: ${answer}${lookingFor && lookingFor.toLowerCase() !== answer.toLowerCase() ? `\nLooking for: ${lookingFor}` : ''}
Points: ${points} (100 = easiest … 500 = hardest)
The ${candidates.length} attached image${candidates.length === 1 ? ' is' : 's are'}, in order:
${list.join('\n')}
Choose the best one for this tile.`;
}
