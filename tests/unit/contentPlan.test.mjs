// tests/unit/contentPlan.test.mjs — tools/content/lib/plan.mjs: whatever the AI
// (or a person editing plan.json) proposes becomes a safe 5×5 plan, with every
// fix-up listed; stable external keys; the no-AI spreadsheet fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalKeyFor, fallbackSheetPlan, planMarkdown, sameAnswer, tidyPlan } from '../../tools/content/lib/plan.mjs';
import { checkPrompt, flagsFromCheck } from '../../tools/content/lib/prompts.mjs';

const tile = (answer, itemId = '') => ({ answer, itemId, searchQuery: `${answer} photo` });
const fullCategory = (title, prefix, sourceCategory = '') => ({
    title, sourceCategory, tiles: [1, 2, 3, 4, 5].map(n => tile(`${prefix} ${n}`)),
});
const fullBoard = (title, extra = {}) => ({
    key: 'k', title, emoji: '🎉', description: 'Fun',
    categories: [1, 2, 3, 4, 5].map(n => fullCategory(`Cat ${n}`, `${title} ${n}`)),
    ...extra,
});

test('sameAnswer: plurals, extra words and small typos match; different things do not', () => {
    assert.ok(sameAnswer('Pretzels', 'Soft pretzel'));
    assert.ok(sameAnswer('Cemetery', 'cemetary'));
    assert.ok(sameAnswer('Hot Dogs', 'hot dog'));
    assert.ok(!sameAnswer('Bat', 'Hat'));
    assert.ok(!sameAnswer('Nativity Scene', 'creche'));
    assert.ok(!sameAnswer('', 'x'));
});

test('externalKeyFor: sheet boards keyed by their source categories; discover by title', () => {
    const board = { key: 'snacks', title: 'Snack Attack', categories: [{ sourceCategory: 'Junk Food' }, { sourceCategory: 'Breakfast' }, { sourceCategory: '' }, { sourceCategory: 'Junk Food' }] };
    assert.equal(externalKeyFor('sheet', board), 'sheet:breakfast+junk-food');
    assert.equal(externalKeyFor('sheet', { ...board, categories: [{ sourceCategory: '' }] }), 'sheet:snacks');
    assert.equal(externalKeyFor('discover', board), 'discover:snack-attack');
    const long = { key: 'x', categories: Array.from({ length: 5 }, (_, i) => ({ sourceCategory: `A very long spreadsheet category name ${i}` })) };
    assert.match(externalKeyFor('sheet', long), /^sheet:[0-9a-f]{16}$/);
});

test('tidyPlan: pads to exactly 5×5 and says so', () => {
    const plan = tidyPlan({ boards: [{ title: 'Tiny', emoji: '', categories: [{ title: 'Only', tiles: [tile('One')] }] }] }, { kind: 'discover' });
    const [b] = plan.boards;
    assert.equal(b.categories.length, 5);
    assert.ok(b.categories.every(c => c.tiles.length === 5));
    assert.equal(b.categories[0].tiles[0].answer, 'One');
    assert.equal(b.categories[0].tiles[1].answer, '');
    assert.equal(b.emoji, '🎲');
    assert.ok(plan.fixes.some(f => f.includes('category 2 was missing')));
    assert.ok(plan.fixes.some(f => f.includes('tile 2 was missing')));
});

test('tidyPlan: duplicate answers in a board are blanked; text is clipped to the site limits', () => {
    const raw = fullBoard('X'.repeat(80));
    raw.categories[1].tiles[0] = tile(raw.categories[0].tiles[0].answer.toUpperCase());
    raw.categories[2].title = 'C'.repeat(60);
    const { boards, fixes } = tidyPlan({ boards: [raw] }, { kind: 'discover' });
    assert.equal(boards[0].title.length, 60);
    assert.equal(boards[0].categories[2].title.length, 40);
    assert.equal(boards[0].categories[1].tiles[0].answer, '');
    assert.ok(fixes.some(f => f.includes('appeared twice')));
});

test('tidyPlan: sheet items linked by id — renames inside their category keep the link, copy mistakes drop it', () => {
    const items = new Map([
        ['xmas-9', { itemId: 'xmas-9', category: 'Christmas', answer: 'creche', url: 'https://unsplash.com/photos/a' }],
        ['fruit-1', { itemId: 'fruit-1', category: 'Fruit', answer: 'Lemon', url: 'https://unsplash.com/photos/b' }],
    ]);
    const raw = fullBoard('Holidays');
    raw.categories[0] = { title: 'Christmas', sourceCategory: 'Christmas', tiles: [tile('Nativity Scene', 'xmas-9'), tile('Banana', 'fruit-1'), tile('Elf', 'nope-1'), tile('Star'), tile('Bell')] };
    const { boards, fixes } = tidyPlan({ boards: [raw] }, { kind: 'sheet', itemsById: items });
    const [nativity, banana, elf] = boards[0].categories[0].tiles;
    assert.equal(nativity.item?.url, 'https://unsplash.com/photos/a');
    assert.equal(banana.item, null);
    assert.equal(banana.itemId, '');
    assert.equal(elf.itemId, '');
    assert.ok(fixes.some(f => f.includes('renamed xmas-9')));
    assert.ok(fixes.some(f => f.includes('fruit-1 is “Lemon”')));
    assert.ok(fixes.some(f => f.includes('unknown spreadsheet id nope-1')));
});

test('tidyPlan: unique keys + external keys; warns about names already on the site', () => {
    const { boards, fixes } = tidyPlan({ boards: [fullBoard('Same'), fullBoard('Same')] }, {
        kind: 'discover', existing: [{ title: 'same', external_key: 'something-else' }],
    });
    assert.notEqual(boards[0].key, boards[1].key);
    assert.equal(boards[0].externalKey, 'discover:same');
    assert.equal(boards[1].externalKey, 'discover:same#2');
    assert.ok(fixes.some(f => f.includes('already a board on the site')));

    // Our own earlier import of the same board isn't a clash.
    const again = tidyPlan({ boards: [fullBoard('Same')] }, { kind: 'discover', existing: [{ title: 'Same', external_key: 'discover:same' }] });
    assert.deepEqual(again.fixes, []);
});

test('fallbackSheetPlan: sheet categories in order, big ones split, sorted by difficulty, 5 columns per board', () => {
    const items = (cat, n, withDifficulty = false) => Array.from({ length: n }, (_, i) => ({
        itemId: `${cat}-${i}`, category: cat, answer: `${cat} ${i}`, difficulty: withDifficulty ? (5 - (i % 5)) * 100 : null,
    }));
    const groups = new Map([
        ['A', items('A', 5, true)], ['B', items('B', 12)], ['C', items('C', 2)], ['D', items('D', 5)], ['E', items('E', 5)], ['F', items('F', 5)],
    ]);
    const plan = fallbackSheetPlan(groups, 8);
    const columns = plan.boards.flatMap(b => b.categories.map(c => c.title));
    assert.deepEqual(columns, ['A', 'B', 'B 2', 'D', 'E', 'F']);      // B's last 2 items and C (2 items) are too few for a column
    assert.equal(plan.boards.length, 2);
    assert.deepEqual(plan.boards[0].categories[0].tiles.map(t => t.answer), ['A 4', 'A 3', 'A 2', 'A 1', 'A 0']);
    const tidy = tidyPlan(plan, { kind: 'sheet' });
    assert.equal(tidy.boards[1].categories.length, 5);              // padded
});

test('planMarkdown: one grid per board, new answers marked ✨', () => {
    const plan = tidyPlan({ boards: [fullBoard('Fun Board')], ideas: [{ title: 'Next', pitch: 'Later' }] }, { kind: 'discover' });
    const md = planMarkdown(plan, { title: 'Plan' });
    assert.match(md, /## 🎉 Fun Board/);
    assert.match(md, /\| 100 \| Fun Board 1 1 ✨/);
    assert.match(md, /\*\*Next\*\* — Later/);
});

test('flagsFromCheck: what the AI saw becomes rights flags', () => {
    assert.deepEqual(flagsFromCheck(null), []);
    assert.deepEqual(flagsFromCheck({ answerVisible: true, showsRealPerson: true, isLogo: true }), ['answer_visible', 'identifiable_person', 'trademark']);
    assert.deepEqual(flagsFromCheck({ answerVisible: false, showsRealPerson: false, isLogo: false }), []);
});

test('checkPrompt: the AI gets the tile’s meaning and each candidate’s library title', () => {
    const prompt = checkPrompt({
        board: 'Crate Diggers', category: 'Punk Archaeology', answer: 'Flipper', lookingFor: 'Flipper punk band', points: 200,
        candidates: [{ title: 'Flipper 1969', provider: 'wikimedia' }, { title: 'Flipper band live 1982', provider: 'openverse:flickr' }],
    });
    assert.match(prompt, /Looking for: Flipper punk band/);
    assert.match(prompt, /#0 “Flipper 1969” \(wikimedia\)/);
    assert.match(prompt, /#1 “Flipper band live 1982” \(openverse:flickr\)/);
    assert.match(prompt, /The 2 attached images are/);
    // No "Looking for" line when it adds nothing.
    assert.doesNotMatch(checkPrompt({ board: 'B', category: 'C', answer: 'Bat', lookingFor: 'bat', points: 100, candidates: [{}] }), /Looking for/);
});
