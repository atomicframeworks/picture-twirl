// src/admin/views/activity.js — the audit log: who did what, when.

import { h, replace } from '../lib/dom.js';
import { get } from '../lib/api.js';
import { fullDate, timeAgo } from '../lib/format.js';

const VERBS = {
    'board.create': 'created',
    'board.rename': 'renamed',
    'board.publish': 'published',
    'board.unpublish': 'moved to draft',
    'board.archive': 'archived',
    'board.restore': 'restored',
};

/** "Kim published 🎃 Spooky Season" as a DOM fragment (board name links to the editor). */
export function describeAudit(entry) {
    const verb = VERBS[entry.action] || entry.action;
    const board = entry.board_id
        ? h('a', { href: `#/boards/${entry.board_id}` }, `${entry.board_emoji || ''} ${entry.board_title || entry.detail?.title || 'a board'}`.trim())
        : null;
    const extra = entry.action === 'board.rename' && entry.detail
        ? ` (was “${entry.detail.from}”)`
        : entry.action === 'board.publish' && entry.detail?.rev ? ` (version ${entry.detail.rev})` : '';
    return h('span', { class: 'adm-audit-line' },
        h('strong', null, entry.actor || 'Someone'), ` ${verb} `, board, extra);
}

export function mountActivity(outlet) {
    replace(outlet, h('div', { class: 'adm-loading' }, 'Loading activity…'));
    let alive = true;
    get('/api/admin/audit?limit=300').then(({ entries }) => {
        if (!alive) return;
        replace(outlet,
            h('div', { class: 'adm-page-head' }, h('h1', null, 'Activity')),
            h('section', { class: 'adm-card' },
                entries.length
                    ? h('table', { class: 'adm-table adm-audit' },
                        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'What'))),
                        h('tbody', null, entries.map(e => h('tr', null,
                            h('td', { class: 'adm-nowrap', title: fullDate(e.at) }, timeAgo(e.at)),
                            h('td', null, describeAudit(e))))))
                    : h('p', { class: 'adm-empty' }, 'Nothing has happened yet.')));
    }).catch((err) => {
        if (alive) replace(outlet, h('div', { class: 'adm-card adm-error' }, err.message));
    });
    return () => { alive = false; };
}
