// tools/content/lib/plan.mjs
//
// A plan is what the AI (or the no-AI fallback) proposes:
//   { boards: [{ key, title, emoji, description,
//                categories: [{ title, sourceCategory, tiles: [{ answer, itemId, searchQuery }] }] }],
//     skipped: [{ itemId, reason }], ideas: [{ title, pitch }], notes }
//
// tidyPlan() makes any plan safe to use — exact 5×5 shape, text limits, unique
// keys and answers, spreadsheet items linked by itemId — and lists every fix-up
// so the report can say what changed. Pure functions (unit-tested).

import { createHash } from 'node:crypto';
import { CATEGORY_COUNT, LIMITS, TILES_PER_CATEGORY, slugify, titleKey } from '../../../src/shared/boards.js';

const clip = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max).trim();
const words = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .split(' ').map(w => w.replace(/s$/, '')).join(' ');

/** Edit distance (small strings only). */
function distance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

/** Does an answer still name the spreadsheet item it cites? ("Pretzels" ≈ "Soft pretzel", "cemetary" ≈ "Cemetery") */
export function sameAnswer(a, b) {
    const x = words(a);
    const y = words(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x) || distance(x, y) <= Math.floor(Math.min(x.length, y.length) / 5);
}

/**
 * Stable identity for a planned board, so re-runs update their earlier import
 * (while it's still ✨ To review) instead of piling up duplicates.
 *   sheet     sheet:<source categories, sorted>   e.g. sheet:christmas+halloween+thanksgiving
 *   discover  discover:<title slug>
 */
export function externalKeyFor(kind, board) {
    if (kind === 'discover') return `discover:${slugify(board.title)}`;
    const sources = [...new Set(board.categories.map(c => c.sourceCategory).filter(Boolean).map(slugify))].sort();
    const id = sources.length ? sources.join('+') : board.key;
    return `sheet:${id.length > 110 ? createHash('sha256').update(id).digest('hex').slice(0, 16) : id}`;   // the site keeps 120 chars
}

/**
 * @param {object} raw  the plan as the AI returned it (or as a person edited plan.json)
 * @param {{ kind: 'sheet'|'discover', itemsById?: Map<string, object>, existing?: Array<{ title: string, external_key?: string }> }} ctx
 * @returns {{ boards: object[], skipped: object[], ideas: object[], aiNotes: string, fixes: string[] }}
 */
export function tidyPlan(raw, { kind, itemsById = new Map(), existing = [] }) {
    const fixes = [];
    const keys = new Set();
    const externalKeys = new Set();

    const boards = (Array.isArray(raw?.boards) ? raw.boards : []).map((b, i) => {
        const title = clip(b?.title, LIMITS.TITLE) || `Board ${i + 1}`;
        let key = slugify(b?.key || title);
        for (let n = 2; keys.has(key); n++) key = `${slugify(b?.key || title)}-${n}`;
        keys.add(key);

        const seenAnswers = new Set();
        const categories = Array.from({ length: CATEGORY_COUNT }, (_, c) => {
            const cat = Array.isArray(b?.categories) ? b.categories[c] : null;
            if (!cat) fixes.push(`${title}: category ${c + 1} was missing — left blank.`);
            const catTitle = clip(cat?.title, LIMITS.CATEGORY_TITLE);
            const tiles = Array.from({ length: TILES_PER_CATEGORY }, (_, r) => {
                const t = Array.isArray(cat?.tiles) ? cat.tiles[r] : null;
                if (cat && !t) fixes.push(`${title} · ${catTitle || `category ${c + 1}`}: tile ${r + 1} was missing — left blank.`);
                let answer = clip(t?.answer, LIMITS.ANSWER);
                const norm = words(answer);
                if (answer && seenAnswers.has(norm)) {
                    fixes.push(`${title}: “${answer}” appeared twice — the second one was left blank.`);
                    answer = '';
                }
                if (answer) seenAnswers.add(norm);

                let itemId = clip(t?.itemId, 40);
                let item = itemId ? itemsById.get(itemId) || null : null;
                if (itemId && !item) {
                    fixes.push(`${title}: unknown spreadsheet id ${itemId} (“${answer}”) — treated as a new answer.`);
                    itemId = '';
                } else if (item && answer && !sameAnswer(answer, item.answer)) {
                    // A rename inside the item's own sheet category is the AI tidying up ("creche" → "Nativity Scene");
                    // an id from somewhere else is a copy mistake — don't attach that picture.
                    if (sameAnswer(item.category, cat?.sourceCategory)) {
                        fixes.push(`${title}: renamed ${itemId} “${item.answer}” → “${answer}” (kept its picture link).`);
                    } else {
                        fixes.push(`${title}: ${itemId} is “${item.answer}” from ${item.category}, not “${answer}” — kept the answer, dropped the link.`);
                        item = null;
                        itemId = '';
                    }
                }
                if (!answer) { item = null; itemId = ''; }
                return { answer, itemId, searchQuery: clip(t?.searchQuery, 120) || answer, item };
            });
            return { title: catTitle, sourceCategory: clip(cat?.sourceCategory, 80), tiles };
        });

        const board = {
            key,
            title,
            emoji: clip(b?.emoji, LIMITS.EMOJI) || '🎲',
            description: clip(b?.description, LIMITS.DESCRIPTION),
            categories,
        };
        let ext = externalKeyFor(kind, board);
        for (let n = 2; externalKeys.has(ext); n++) ext = `${externalKeyFor(kind, board)}#${n}`;
        externalKeys.add(ext);
        board.externalKey = ext;
        return board;
    });

    // Name clashes with boards already on the site (the site adds " (2)" — unless it's our own earlier import).
    const taken = new Map(existing.map(e => [titleKey(e.title), e]));
    for (const b of boards) {
        const other = taken.get(titleKey(b.title));
        if (other && other.external_key !== b.externalKey) fixes.push(`“${b.title}” is already a board on the site — this one will be saved as “${b.title} (2)”. Rename it in plan.json or in the admin.`);
    }

    return {
        boards,
        skipped: Array.isArray(raw?.skipped) ? raw.skipped : [],
        ideas: Array.isArray(raw?.ideas) ? raw.ideas : [],
        aiNotes: clip(raw?.notes, 2000),
        fixes,
    };
}

/**
 * The no-AI plan for the spreadsheet (--ai none): its categories in sheet
 * order, 5 per board; categories with 10+ items are split; tiles sorted by the
 * sheet's difficulty. Names stay plain — rename them in the admin.
 * @param {Map<string, object[]>} groups  byCategory(items)
 */
export function fallbackSheetPlan(groups, maxBoards = 8) {
    const cats = [];
    for (const [category, items] of groups) {
        const sorted = [...items].sort((a, b) => (a.difficulty ?? 999) - (b.difficulty ?? 999));
        for (let i = 0; i + 3 <= sorted.length; i += TILES_PER_CATEGORY) {   // a column needs at least 3 real items
            const chunk = sorted.slice(i, i + TILES_PER_CATEGORY);
            cats.push({
                title: clip(i ? `${category} ${i / TILES_PER_CATEGORY + 1}` : category, LIMITS.CATEGORY_TITLE),
                sourceCategory: category,
                tiles: chunk.map(it => ({ answer: it.answer, itemId: it.itemId, searchQuery: it.answer })),
            });
        }
    }
    const boards = [];
    for (let i = 0; i < cats.length && boards.length < maxBoards; i += CATEGORY_COUNT) {
        const columns = cats.slice(i, i + CATEGORY_COUNT);
        boards.push({
            key: `sheet-${boards.length + 1}`,
            title: `Spreadsheet Mix ${boards.length + 1}`,
            emoji: '🎲',
            description: columns.map(c => c.title).join(' · ').slice(0, 120),
            categories: columns,
        });
    }
    return { boards, skipped: [], ideas: [], notes: 'Planned without AI: spreadsheet categories in order.' };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** plan.json → plan.md (a readable grid per board). */
export function planMarkdown(plan, { title = 'Plan', points = [100, 200, 300, 400, 500] } = {}) {
    const out = [`# ${title}`, ''];
    if (plan.aiNotes) out.push(`> ${cell(plan.aiNotes)}`, '');
    for (const b of plan.boards) {
        out.push(`## ${b.emoji} ${b.title}`, '', `${b.description || '_(no description)_'}  `, `\`${b.externalKey}\``, '');
        out.push(`| Pts | ${b.categories.map(c => cell(c.title || '_(blank)_')).join(' | ')} |`);
        out.push(`|---|${b.categories.map(() => '---').join('|')}|`);
        for (let r = 0; r < TILES_PER_CATEGORY; r++) {
            out.push(`| ${points[r]} | ${b.categories.map(c => {
                const t = c.tiles[r];
                return t.answer ? `${cell(t.answer)}${t.itemId ? ` <sub>${t.itemId}</sub>` : ' ✨'}` : '—';
            }).join(' | ')} |`);
        }
        out.push('');
    }
    out.push('✨ = new answer (not from the spreadsheet)', '');
    if (plan.fixes.length) out.push('## Fix-ups', '', ...plan.fixes.map(f => `- ${f}`), '');
    if (plan.skipped.length) out.push('## Skipped', '', ...plan.skipped.map(s => `- ${s.itemId}: ${s.reason}`), '');
    if (plan.ideas.length) out.push('## More board ideas', '', ...plan.ideas.map(i => `- **${i.title}** — ${i.pitch}`), '');
    return out.join('\n');
}
