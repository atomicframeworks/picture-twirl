// src/admin/lib/format.js — small display helpers for the admin.

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(ms, nowMs = Date.now()) {
    if (!ms) return '—';
    const s = Math.max(0, Math.round((nowMs - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Full local date-time for tooltips. */
export const fullDate = (ms) => (ms ? new Date(ms).toLocaleString() : '');

/** 1536 → "1.5 KB". */
export function bytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** plural(3, 'board') → "3 boards". */
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const STATUS_LABELS = {
    published: 'Published',
    draft: 'Draft',
    import: 'To review',
    archived: 'Archived',
};

export const STATUS_ICONS = {
    published: '🟢',
    draft: '✏️',
    import: '✨',
    archived: '🗄️',
};

export const SOURCE_LABELS = {
    manual: 'Manual',
    seed: 'Seed',
    'ai-sheet': 'AI · sheet',
    'ai-discover': 'AI · discover',
};
