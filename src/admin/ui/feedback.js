// src/admin/ui/feedback.js
//
// Toasts and dialogs for the admin.
//   toast('Published 🎃 Spooky Season', { kind: 'ok' })
//   const ok = await confirmDialog({ title, body, confirmText, danger: true })
//   openDialog({ title, body: node, actions: [...] }) → { close }

import { h } from '../lib/dom.js';

/** Short-lived message in the corner. kind: 'ok' | 'warn' | 'error' | 'info' */
export function toast(message, { kind = 'info', timeout = 4000 } = {}) {
    const host = document.getElementById('adm-toasts');
    if (!host) return;
    const icon = { ok: '✅', warn: '⚠️', error: '⛔', info: 'ℹ️' }[kind] || '';
    const el = h('div', { class: `adm-toast is-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
        h('span', { class: 'adm-toast-icon', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'adm-toast-text' }, message),
        h('button', { class: 'adm-toast-close', type: 'button', 'aria-label': 'Dismiss', onClick: () => el.remove() }, '×'));
    host.append(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
}

/**
 * Modal dialog on a native <dialog>.
 * @param {{ title: string, body: Node|string, actions?: Array<{ label: string, variant?: string,
 *           onClick?: () => any|Promise<any>, closes?: boolean }>, wide?: boolean, onClose?: () => void }} opts
 */
export function openDialog({ title, body, actions = [], wide = false, onClose }) {
    const dialog = h('dialog', { class: `adm-dialog${wide ? ' is-wide' : ''}`, 'aria-label': title });
    const close = () => { if (dialog.open) dialog.close(); };
    dialog.addEventListener('close', () => { dialog.remove(); onClose?.(); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); }); // backdrop click

    const footer = h('div', { class: 'adm-dialog-actions' }, actions.map(a => h('button', {
        type: 'button',
        class: `a-btn ${a.variant || 'ghost'}`,
        onClick: async (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            btn.disabled = true;
            try {
                const result = await a.onClick?.();
                if (a.closes !== false && result !== false) close();
            } finally {
                btn.disabled = false;
            }
        },
    }, a.label)));

    dialog.append(
        h('header', { class: 'adm-dialog-head' },
            h('h2', null, title),
            h('button', { type: 'button', class: 'adm-dialog-x', 'aria-label': 'Close', onClick: close }, '×')),
        h('div', { class: 'adm-dialog-body' }, body),
        actions.length ? footer : null,
    );
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, close };
}

/** Yes/no question. Resolves true when confirmed. */
export function confirmDialog({ title, body, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
        let answered = false;
        openDialog({
            title,
            body: typeof body === 'string' ? h('p', null, body) : body,
            actions: [
                { label: 'Cancel', variant: 'ghost', onClick: () => { answered = true; resolve(false); } },
                { label: confirmText, variant: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
            ],
            onClose: () => { if (!answered) resolve(false); },
        });
    });
}
