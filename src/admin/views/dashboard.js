// src/admin/views/dashboard.js — counts, what needs attention, recent work.

import { h, replace } from '../lib/dom.js';
import { get } from '../lib/api.js';
import { bytes, fullDate, plural, STATUS_ICONS, STATUS_LABELS, timeAgo } from '../lib/format.js';
import { statusChip } from '../ui/chips.js';
import { describeAudit } from './activity.js';

export function mountDashboard(outlet) {
    replace(outlet, h('div', { class: 'adm-loading' }, 'Loading dashboard…'));
    let alive = true;

    Promise.all([get('/api/admin/stats'), get('/api/admin/import-runs?limit=5')]).then(([stats, { runs }]) => {
        if (!alive) return;
        render(outlet, stats, runs);
    }).catch((err) => {
        if (alive) replace(outlet, h('div', { class: 'adm-card adm-error' }, err.message));
    });

    return () => { alive = false; };
}

const RUN_KINDS = { sheet: '📊 Spreadsheet import', discover: '🔎 Discovery', verify: '🔁 Rights re-check' };

/** One content-tool run: kind, when, who, what it made. */
function runItem(run) {
    const s = run.summary || {};
    const bits = [
        run.boards ? plural(run.boards, 'board') : null,
        s.tilesWithPictures != null ? `${s.tilesWithPictures} pictures` : null,
        s.flagged ? `⚠️ ${s.flagged}` : null,
        !run.finished_at ? 'still running / interrupted' : null,
    ].filter(Boolean);
    return h('li', null,
        h('span', { class: 'adm-todo-icon', 'aria-hidden': 'true' }, (RUN_KINDS[run.kind] || '🤖').split(' ')[0]),
        h('span', { class: 'adm-todo-text' },
            h('strong', null, (RUN_KINDS[run.kind] || run.kind).replace(/^\S+ /, '')),
            ` · ${run.actor || 'AI'} · `,
            h('span', { title: fullDate(run.started_at) }, timeAgo(run.started_at)),
            bits.length ? h('small', { class: 'adm-muted' }, ` — ${bits.join(' · ')}`) : null),
        run.boards ? h('a', { class: 'a-btn ghost sm', href: '#/boards?status=import' }, 'Review →') : null);
}

function render(outlet, { counts, attention, totals, recent, activity }, runs = []) {
    const card = (status) => h('a', { class: `adm-stat is-${status}`, href: `#/boards?status=${status}`, dataset: { testid: `stat-${status}` } },
        h('span', { class: 'adm-stat-icon', 'aria-hidden': 'true' }, STATUS_ICONS[status]),
        h('span', { class: 'adm-stat-num' }, String(counts[status] ?? 0)),
        h('span', { class: 'adm-stat-label' }, STATUS_LABELS[status]));

    const todo = [
        attention.imports && { icon: '✨', text: `${plural(attention.imports, 'AI import')} waiting for review`, href: '#/boards?status=import', cta: 'Review' },
        attention.unpublishedChanges && { icon: '📝', text: `${plural(attention.unpublishedChanges, 'published board')} with unpublished changes`, href: '#/boards?status=published&changes=1', cta: 'Show' },
        attention.flaggedTiles && { icon: '⚠️', text: `${plural(attention.flaggedTiles, 'picture')} with rights to double-check (${plural(attention.boardsWithFlags, 'board')})`, href: '#/boards?flags=1', cta: 'Show' },
        attention.blockedPictures && { icon: '❌', text: `${plural(attention.blockedPictures, 'picture')} with a license we can’t use`, href: '#/boards', cta: 'Show' },
        attention.nearlyReady && { icon: '🧩', text: `${plural(attention.nearlyReady, 'board')} almost ready (20+ of 25 tiles)`, href: '#/boards?status=draft', cta: 'Show' },
    ].filter(Boolean);

    replace(outlet,
        h('div', { class: 'adm-page-head' },
            h('h1', null, 'Dashboard'),
            h('a', { class: 'a-btn primary', href: '#/boards?new=1' }, '+ New board')),

        h('section', { class: 'adm-stats', 'aria-label': 'Boards by status' },
            ['published', 'draft', 'import', 'archived'].map(card)),

        h('div', { class: 'adm-grid-2' },
            h('section', { class: 'adm-card' },
                h('h2', null, 'Needs attention'),
                todo.length
                    ? h('ul', { class: 'adm-todo' }, todo.map(t => h('li', null,
                        h('span', { class: 'adm-todo-icon', 'aria-hidden': 'true' }, t.icon),
                        h('span', { class: 'adm-todo-text' }, t.text),
                        h('a', { class: 'a-btn ghost sm', href: t.href }, `${t.cta} →`))))
                    : h('p', { class: 'adm-empty' }, '🎉 All caught up.')),

            h('section', { class: 'adm-card' },
                h('h2', null, 'Recently edited'),
                recent.length
                    ? h('ul', { class: 'adm-recent' }, recent.map(b => h('li', null,
                        h('a', { href: `#/boards/${b.id}` }, h('span', { 'aria-hidden': 'true' }, b.emoji), ' ', b.title),
                        statusChip(b.status, { unpublishedChanges: b.unpublished_changes }),
                        h('span', { class: 'adm-muted', title: fullDate(b.updated_at) }, `${timeAgo(b.updated_at)}${b.updated_by ? ` · ${b.updated_by}` : ''}`))))
                    : h('p', { class: 'adm-empty' }, 'No boards yet — create the first one!'))),

        runs.length ? h('section', { class: 'adm-card', dataset: { testid: 'import-runs' } },
            h('h2', null, '🤖 Content tool runs'),
            h('ul', { class: 'adm-todo' }, runs.map(runItem))) : null,

        h('section', { class: 'adm-card' },
            h('div', { class: 'adm-card-head' }, h('h2', null, 'Activity'), h('a', { class: 'a-btn ghost sm', href: '#/activity' }, 'All activity →')),
            activity.length
                ? h('ul', { class: 'adm-activity' }, activity.map(a => h('li', null,
                    h('span', { class: 'adm-muted', title: fullDate(a.at) }, timeAgo(a.at)),
                    describeAudit(a))))
                : h('p', { class: 'adm-empty' }, 'Nothing yet.')),

        h('p', { class: 'adm-totals' },
            `${plural(totals.boards, 'board')} · ${plural(totals.tilesReady, 'ready tile')} · ${plural(totals.pictures, 'picture')} · ${bytes(totals.bytes)} of pictures`),
    );
}
