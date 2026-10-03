// src/admin/views/boards.js
//
// The boards table (PROPOSAL.md §5.4): status filter chips with counts, quick
// search, sortable columns, multi-select + bulk actions, a ⋮ menu per row, and
// "+ New board". Filters/sort live in the URL (#/boards?status=draft&sort=…)
// and are remembered per browser.

import { debounce, h, replace } from '../lib/dom.js';
import { get, post } from '../lib/api.js';
import { replaceQuery, navigate } from '../lib/router.js';
import { fullDate, plural, SOURCE_LABELS, STATUS_LABELS, timeAgo } from '../lib/format.js';
import { readyBar, rightsBadge, statusChip } from '../ui/chips.js';
import { confirmDialog, openDialog, toast } from '../ui/feedback.js';
import { emojiButton } from '../ui/emojiField.js';
import { LIMITS } from '../../shared/boards.js';

const VIEW_KEY = 'pt.admin.boards.view';
const FILTERS = ['all', 'published', 'draft', 'import', 'archived'];
const STATUS_ORDER = { import: 0, draft: 1, published: 2, archived: 3 };

const COLUMNS = [
    { key: 'title', label: 'Board', sort: (b) => b.title.toLowerCase() },
    { key: 'status', label: 'Status', sort: (b) => STATUS_ORDER[b.status] ?? 9 },
    { key: 'ready', label: 'Ready', sort: (b) => b.tiles_ready },
    { key: 'flags', label: 'Rights', sort: (b) => b.flagged_tiles },
    { key: 'source', label: 'Source', sort: (b) => b.source },
    { key: 'updated', label: 'Updated', sort: (b) => b.updated_at },
];

function savedView() {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { return {}; }
}

export function mountBoards(outlet, { route }) {
    const q0 = Object.keys(route.query).length ? route.query : savedView();
    const state = {
        boards: [],
        filter: FILTERS.includes(q0.status) ? q0.status : 'all',
        q: q0.q || '',
        sort: COLUMNS.some(c => c.key === q0.sort) ? q0.sort : 'updated',
        dir: q0.dir === 'asc' ? 'asc' : 'desc',
        onlyFlags: q0.flags === '1',
        onlyChanges: q0.changes === '1',
        selected: new Set(),
    };
    let alive = true;

    // ── Static layout ────────────────────────────────────────────────────────
    const chipsEl = h('div', { class: 'adm-filter-chips', role: 'tablist', 'aria-label': 'Filter by status' });
    const search = h('input', {
        class: 'a-input adm-search', type: 'search', placeholder: 'Search boards…', value: state.q,
        'aria-label': 'Search boards by name', onInput: debounce(() => { state.q = search.value.trim(); sync(); }, 120),
    });
    const extraFilters = h('div', { class: 'adm-extra-filters' });
    const tbody = h('tbody');
    const headRow = h('tr');
    const selectAll = h('input', { type: 'checkbox', 'aria-label': 'Select all shown boards', onChange: () => {
        const rows = visible();
        if (selectAll.checked) rows.forEach(b => state.selected.add(b.id));
        else rows.forEach(b => state.selected.delete(b.id));
        render();
    } });
    const bulkBar = h('div', { class: 'adm-bulkbar', hidden: true, role: 'region', 'aria-label': 'Bulk actions' });
    const empty = h('div', { class: 'adm-empty', hidden: true });

    replace(outlet,
        h('div', { class: 'adm-page-head' },
            h('h1', null, 'Boards'),
            h('button', { class: 'a-btn primary', type: 'button', onClick: () => openNewBoard() }, '+ New board')),
        h('section', { class: 'adm-card adm-table-card' },
            h('div', { class: 'adm-toolbar' }, chipsEl, search),
            extraFilters,
            h('div', { class: 'adm-table-wrap' },
                h('table', { class: 'adm-table adm-boards', dataset: { testid: 'boards-table' } },
                    h('thead', null, headRow),
                    tbody)),
            empty),
        bulkBar);

    // ── Data ─────────────────────────────────────────────────────────────────
    async function load() {
        try {
            const { boards } = await get('/api/admin/boards');
            if (!alive) return;
            state.boards = boards;
            const ids = new Set(boards.map(b => b.id));
            for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
            render();
        } catch (err) {
            if (alive) toast(err.message, { kind: 'error' });
        }
    }

    function visible() {
        const col = COLUMNS.find(c => c.key === state.sort);
        const q = state.q.toLowerCase();
        return state.boards
            .filter(b => (state.filter === 'all' ? b.status !== 'archived' : b.status === state.filter))
            .filter(b => !q || b.title.toLowerCase().includes(q) || b.slug.includes(q))
            .filter(b => !state.onlyFlags || b.flagged_tiles > 0)
            .filter(b => !state.onlyChanges || b.unpublished_changes)
            .sort((a, b) => {
                const x = col.sort(a);
                const y = col.sort(b);
                const cmp = x < y ? -1 : x > y ? 1 : a.title.localeCompare(b.title);
                return state.dir === 'asc' ? cmp : -cmp;
            });
    }

    function sync() {
        const query = { status: state.filter === 'all' ? '' : state.filter, q: state.q, sort: state.sort, dir: state.dir,
            flags: state.onlyFlags ? '1' : '', changes: state.onlyChanges ? '1' : '' };
        replaceQuery(query);
        try { localStorage.setItem(VIEW_KEY, JSON.stringify(query)); } catch { /* private mode */ }
        render();
    }

    // ── Render ───────────────────────────────────────────────────────────────
    function render() {
        const counts = { all: 0, published: 0, draft: 0, import: 0, archived: 0 };
        for (const b of state.boards) {
            counts[b.status]++;
            if (b.status !== 'archived') counts.all++;
        }
        replace(chipsEl, FILTERS.map(f => h('button', {
            type: 'button', role: 'tab', class: `adm-filter-chip is-${f}${state.filter === f ? ' is-on' : ''}`,
            'aria-selected': state.filter === f ? 'true' : 'false', dataset: { filter: f },
            onClick: () => { state.filter = f; sync(); },
        }, f === 'all' ? 'All' : STATUS_LABELS[f], h('span', { class: 'adm-count' }, String(counts[f])))));

        replace(extraFilters,
            state.onlyFlags ? h('button', { type: 'button', class: 'adm-pill-filter', onClick: () => { state.onlyFlags = false; sync(); } }, '⚠️ Only boards with rights flags ×') : null,
            state.onlyChanges ? h('button', { type: 'button', class: 'adm-pill-filter', onClick: () => { state.onlyChanges = false; sync(); } }, '📝 Only unpublished changes ×') : null);

        replace(headRow,
            h('th', { class: 'adm-col-check' }, selectAll),
            COLUMNS.map(c => h('th', { 'aria-sort': state.sort === c.key ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
                h('button', { type: 'button', class: 'adm-sort', onClick: () => {
                    if (state.sort === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
                    else { state.sort = c.key; state.dir = c.key === 'updated' || c.key === 'ready' ? 'desc' : 'asc'; }
                    sync();
                } }, c.label, h('span', { class: 'adm-sort-arrow', 'aria-hidden': 'true' }, state.sort === c.key ? (state.dir === 'asc' ? '▲' : '▼') : '')))),
            h('th', { class: 'adm-col-menu' }, h('span', { class: 'adm-sr' }, 'Actions')));

        const rows = visible();
        replace(tbody, rows.map(row));
        const shownSelected = rows.filter(b => state.selected.has(b.id)).length;
        selectAll.checked = rows.length > 0 && shownSelected === rows.length;
        selectAll.indeterminate = shownSelected > 0 && shownSelected < rows.length;

        empty.hidden = rows.length > 0;
        empty.textContent = state.boards.length ? 'No boards match these filters.' : 'No boards yet — click “+ New board” to make the first one.';
        renderBulkBar();
    }

    function row(b) {
        const checked = state.selected.has(b.id);
        const open = () => navigate(`/boards/${b.id}`);
        return h('tr', {
            class: `adm-row${checked ? ' is-selected' : ''}`, dataset: { id: b.id, status: b.status },
            onClick: (e) => { if (!e.target.closest('input, button, a, details, summary')) open(); },
        },
        h('td', { class: 'adm-col-check' }, h('input', {
            type: 'checkbox', checked, 'aria-label': `Select ${b.title}`,
            onChange: (e) => { e.target.checked ? state.selected.add(b.id) : state.selected.delete(b.id); render(); },
        })),
        h('td', { class: 'adm-col-title', 'data-label': 'Board' },
            h('a', { class: 'adm-board-link', href: `#/boards/${b.id}` },
                h('span', { class: 'adm-board-emoji', 'aria-hidden': 'true' }, b.emoji),
                h('span', null, h('span', { class: 'adm-board-title' }, b.title), h('small', { class: 'adm-muted' }, b.slug)))),
        h('td', { 'data-label': 'Status' }, statusChip(b.status, { unpublishedChanges: b.unpublished_changes })),
        h('td', { 'data-label': 'Ready' }, readyBar(b.tiles_ready)),
        h('td', { 'data-label': 'Rights' }, rightsBadge({ count: b.flagged_tiles })),
        h('td', { 'data-label': 'Source' }, SOURCE_LABELS[b.source] || b.source),
        h('td', { 'data-label': 'Updated', class: 'adm-nowrap', title: fullDate(b.updated_at) },
            timeAgo(b.updated_at), b.updated_by ? h('small', { class: 'adm-muted' }, ` · ${b.updated_by}`) : null),
        h('td', { class: 'adm-col-menu' }, rowMenu(b)));
    }

    function rowMenu(b) {
        const items = [
            ['Open', () => navigate(`/boards/${b.id}`)],
            b.status !== 'archived' && [b.status === 'published' ? (b.unpublished_changes ? 'Publish changes' : 'Republish') : 'Publish', () => runOne(b, 'publish')],
            b.status === 'published' && ['Move to draft', () => runOne(b, 'unpublish')],
            ['Duplicate', () => duplicate(b)],
            b.status !== 'archived' ? ['Archive', () => runOne(b, 'archive')] : ['Restore', () => runOne(b, 'restore')],
        ].filter(Boolean);
        const menu = h('details', { class: 'adm-menu' },
            h('summary', { class: 'a-btn ghost sm', 'aria-label': `Actions for ${b.title}` }, '⋮'),
            h('div', { class: 'adm-menu-list', role: 'menu' }, items.map(([label, fn]) => h('button', {
                type: 'button', role: 'menuitem', onClick: () => { menu.open = false; fn(); },
            }, label))));
        return menu;
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    async function runOne(b, action) {
        if (action === 'archive' && !(await confirmDialog({
            title: `Archive ${b.title}?`, body: 'Players won’t see it. You can restore it any time from the Archived filter.', confirmText: 'Archive', danger: true,
        }))) return;
        try {
            await post(`/api/admin/boards/${b.id}/${action}`);
            toast(`${b.emoji} ${b.title}: ${{ publish: 'published', unpublish: 'moved to draft', archive: 'archived', restore: 'restored' }[action]}.`, { kind: 'ok' });
        } catch (err) {
            toast(err.message, { kind: err.status === 422 ? 'warn' : 'error', timeout: 7000 });
        }
        load();
    }

    async function duplicate(b) {
        try {
            const { board } = await post(`/api/admin/boards/${b.id}/duplicate`);
            toast(`Made “${board.title}”.`, { kind: 'ok' });
            navigate(`/boards/${board.id}`);
        } catch (err) {
            toast(err.message, { kind: 'error' });
        }
    }

    function renderBulkBar() {
        const n = state.selected.size;
        bulkBar.hidden = n === 0;
        if (!n) return;
        const act = (action, label, variant = 'ghost') => h('button', { type: 'button', class: `a-btn ${variant} sm`, onClick: () => bulk(action) }, label);
        replace(bulkBar,
            h('strong', null, `${n} selected`),
            act('publish', '🟢 Publish', 'primary'),
            act('unpublish', '✏️ Move to draft'),
            act('archive', '🗄️ Archive'),
            act('restore', '↩️ Restore'),
            h('button', { type: 'button', class: 'a-btn ghost sm', onClick: () => { state.selected.clear(); render(); } }, 'Clear'));
    }

    async function bulk(action) {
        const ids = [...state.selected];
        if (action === 'archive' && !(await confirmDialog({
            title: `Archive ${plural(ids.length, 'board')}?`, body: 'Players won’t see them. You can restore them any time.', confirmText: 'Archive', danger: true,
        }))) return;
        try {
            const { done, skipped } = await post('/api/admin/boards/bulk', { action, ids });
            const verb = { publish: 'Published', unpublish: 'Moved to draft', archive: 'Archived', restore: 'Restored' }[action];
            const title = (id) => state.boards.find(b => b.id === id)?.title || id;
            const msg = `${verb} ${done.length}${skipped.length ? ` · Skipped ${skipped.length}: ${skipped.slice(0, 3).map(s => `${title(s.id)} (${s.message.replace(/^.*?: /, '')})`).join('; ')}` : ''}`;
            toast(msg, { kind: skipped.length ? 'warn' : 'ok', timeout: skipped.length ? 9000 : 4000 });
            done.forEach(id => state.selected.delete(id));
        } catch (err) {
            toast(err.message, { kind: 'error' });
        }
        load();
    }

    // ── New board ────────────────────────────────────────────────────────────
    function openNewBoard() {
        let emoji = '🎲';
        const title = h('input', { class: 'a-input', id: 'adm-new-title', maxlength: LIMITS.TITLE, required: true, autocomplete: 'off', placeholder: 'e.g. Spooky Season' });
        const hint = h('small', { class: 'adm-field-hint', 'aria-live': 'polite' }, 'Names must be unique.');
        const description = h('input', { class: 'a-input', id: 'adm-new-desc', maxlength: LIMITS.DESCRIPTION, placeholder: 'Optional one-liner players see' });
        const emojiField = emojiButton({ value: emoji, onChange: (e) => { emoji = e; }, label: 'Board emoji', size: 'lg' });

        // Live "is this name free?" hint (the create call re-checks anyway).
        const check = debounce(async () => {
            const t = title.value.trim();
            if (!t) { hint.textContent = 'Names must be unique.'; hint.className = 'adm-field-hint'; return; }
            try {
                const { available } = await get(`/api/admin/titles/check?title=${encodeURIComponent(t)}`);
                hint.textContent = available ? '✓ Name is free' : '✗ Another board already uses that name';
                hint.className = `adm-field-hint ${available ? 'is-ok' : 'is-bad'}`;
            } catch { /* ignore */ }
        }, 250);
        title.addEventListener('input', check);

        const create = async () => {
            check.flush();
            try {
                const { board } = await post('/api/admin/boards', { title: title.value, emoji, description: description.value });
                toast(`Created ${board.emoji} ${board.title}.`, { kind: 'ok' });
                navigate(`/boards/${board.id}`);
                return true;
            } catch (err) {
                hint.textContent = `✗ ${err.message}`;
                hint.className = 'adm-field-hint is-bad';
                title.focus();
                return false; // keep the dialog open
            }
        };

        openDialog({
            title: 'New board',
            body: h('form', { class: 'adm-new-board', onSubmit: (e) => { e.preventDefault(); create(); } },
                h('div', { class: 'adm-new-board-row' },
                    h('div', { class: 'a-field' }, h('span', null, 'Emoji'), emojiField.el),
                    h('label', { class: 'a-field adm-grow', for: 'adm-new-title' }, h('span', null, 'Name'), title, hint)),
                h('label', { class: 'a-field', for: 'adm-new-desc' }, h('span', null, 'Description'), description),
                h('button', { type: 'submit', hidden: true })),
            actions: [
                { label: 'Cancel', variant: 'ghost' },
                { label: 'Create board', variant: 'primary', onClick: create },
            ],
        });
        title.focus();
    }

    load();
    if (route.query.new === '1') {
        replaceQuery({ ...route.query, new: '' });
        openNewBoard();
    }
    return () => { alive = false; };
}
