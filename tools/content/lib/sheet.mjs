// tools/content/lib/sheet.mjs
//
// The Content Tracker spreadsheet (content/sources/, an export of the team's
// Google Sheet) → normalized items the planner can use.
//
// Columns are matched by header text, so re-ordered or extra columns are fine:
//   Category · Item ID · Answer · Image File / URL · Difficulty · Status ·
//   Source / License · Notes          ("Subcategory: …" notes = column-name hints)

import { readXlsx } from './xlsx.mjs';

export const DEFAULT_SHEET = 'content/sources/Picture Twirl Content Tracker.xlsx';

const HEADERS = {
    category: /^category$/i,
    itemId: /^item\s*id$/i,
    answer: /^answer(\s*text)?$/i,
    image: /^image\s*(file\s*\/\s*url|source\s*url)$/i,
    difficulty: /^difficulty$/i,
    status: /^status$/i,
    source: /^source\s*\/\s*license$/i,
    notes: /^notes$/i,
};

/** Find the tab that has Category + Answer columns (prefer "Content Library"). */
function pickSheet(sheets) {
    const scored = sheets.map(s => {
        const header = s.rows[0] || {};
        const titles = Object.values(header).map(String);
        const ok = titles.some(t => HEADERS.category.test(t.trim())) && titles.some(t => HEADERS.answer.test(t.trim()));
        return { s, score: (ok ? 10 : 0) + (/content\s*l?ibrary/i.test(s.name) ? 5 : 0) + Math.min(s.rows.length, 999) / 1000 };
    }).sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 10) throw new Error('No tab with Category + Answer columns found in the spreadsheet.');
    return scored[0].s;
}

const normalize = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

/**
 * @param {string} file
 * @returns {{ sheetName: string, items: object[], duplicates: object[] }}
 */
export function readContentTracker(file = DEFAULT_SHEET) {
    const { sheets } = readXlsx(file);
    const sheet = pickSheet(sheets);
    const [header, ...rows] = sheet.rows;
    const col = {};
    for (const [letter, title] of Object.entries(header)) {
        for (const [key, re] of Object.entries(HEADERS)) if (re.test(String(title).trim()) && !col[key]) col[key] = letter;
    }

    const items = [];
    const duplicates = [];
    const seen = new Map();
    for (const r of rows) {
        const answer = normalize(r[col.answer]);
        const category = normalize(r[col.category]);
        if (!answer || !category) continue;
        const imageCell = normalize(r[col.image]);
        const link = sheet.links[`${col.image}${r._row}`] || (/^https?:\/\//i.test(imageCell) ? imageCell : '');
        const diff = Number(String(r[col.difficulty] ?? '').replace(/[^\d.]/g, ''));
        const notes = normalize(r[col.notes]);
        const item = {
            itemId: normalize(r[col.itemId]) || `row-${r._row}`,
            category,
            answer,
            url: link || null,
            imageHint: link ? null : (imageCell || null),         // e.g. "Band portrait"
            difficulty: [100, 200, 300, 400, 500].includes(diff) ? diff : null,
            status: normalize(r[col.status]) || null,
            sourceNote: normalize(r[col.source]) || null,
            notes: notes || null,
            subcategory: notes.match(/sub\s*category:\s*(.+)/i)?.[1]?.trim() || null,
            row: r._row,
        };
        const key = `${category.toLowerCase()}|${answer.toLowerCase().replace(/s$/, '')}`;
        if (seen.has(key)) duplicates.push({ ...item, duplicateOf: seen.get(key) });
        else { seen.set(key, item.itemId); items.push(item); }
    }
    return { sheetName: sheet.name, items, duplicates };
}

/** Items grouped by category, in sheet order. */
export function byCategory(items) {
    const map = new Map();
    for (const it of items) {
        if (!map.has(it.category)) map.set(it.category, []);
        map.get(it.category).push(it);
    }
    return map;
}
