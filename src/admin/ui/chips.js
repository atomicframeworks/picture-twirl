// src/admin/ui/chips.js — status chips, readiness bars, rights badges.

import { h } from '../lib/dom.js';
import { STATUS_ICONS, STATUS_LABELS } from '../lib/format.js';
import { RIGHTS_FLAGS } from '../../shared/rights.js';

/** 🟢 Published · ✏️ Draft · ✨ To review · 🗄️ Archived (+ "changes" dot). */
export function statusChip(status, { unpublishedChanges = false } = {}) {
    return h('span', { class: `adm-chip is-${status}`, title: unpublishedChanges ? 'Published, with unpublished changes' : null },
        h('span', { 'aria-hidden': 'true' }, STATUS_ICONS[status] || ''),
        STATUS_LABELS[status] || status,
        unpublishedChanges ? h('span', { class: 'adm-chip-dot', 'aria-label': 'unpublished changes' }) : null);
}

/** "23/25" with a little bar. */
export function readyBar(ready, total = 25) {
    const pct = Math.round((Math.min(ready, total) / total) * 100);
    return h('span', { class: `adm-ready${ready >= total ? ' is-full' : ''}`, title: `${ready} of ${total} tiles have a picture and an answer` },
        h('span', { class: 'adm-ready-track' }, h('span', { class: 'adm-ready-fill', style: { width: `${pct}%` } })),
        h('span', { class: 'adm-ready-text' }, `${ready}/${total}`));
}

/** ✅ / ⚠️ n / ❌ for a board or a picture. */
export function rightsBadge({ status, flags = [], count = null }) {
    if (status === 'blocked') {
        return h('span', { class: 'adm-rights is-blocked', title: 'License doesn’t allow how we use pictures' }, '❌ blocked');
    }
    if (status === 'flagged' || (count ?? 0) > 0) {
        const reasons = flags.map(f => RIGHTS_FLAGS[f]?.label).filter(Boolean).join(', ');
        return h('span', { class: 'adm-rights is-flagged', title: reasons || 'Rights to double-check' },
            '⚠️', count != null ? ` ${count}` : reasons ? ` ${reasons}` : ' check');
    }
    return h('span', { class: 'adm-rights is-ok', title: 'No rights flags' }, '✅');
}
