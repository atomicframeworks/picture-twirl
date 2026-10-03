// src/admin/views/shell.js — top bar + navigation + the outlet views render into.

import { h, replace } from '../lib/dom.js';
import { post } from '../lib/api.js';

const NAV = [
    { path: '/', label: 'Dashboard', icon: '📊', match: (p) => p === '/' },
    { path: '/boards', label: 'Boards', icon: '🧩', match: (p) => p.startsWith('/boards') },
    { path: '/activity', label: 'Activity', icon: '📜', match: (p) => p.startsWith('/activity') },
];

/**
 * @param {HTMLElement} root
 * @param {{ me: { name: string }, onSignOut: () => void }} opts
 * @returns {{ outlet: HTMLElement, setActive: (path: string) => void }}
 */
export function renderShell(root, { me, onSignOut }) {
    const links = NAV.map(item => h('a', { class: 'adm-nav-link', href: `#${item.path}`, dataset: { path: item.path } },
        h('span', { 'aria-hidden': 'true' }, item.icon), item.label));

    const outlet = h('main', { class: 'adm-main', id: 'adm-main', tabindex: '-1' });
    const top = h('header', { class: 'adm-top' },
        h('a', { class: 'adm-logo', href: '#/' },
            h('span', { class: 'adm-logo-text' }, 'Picture Twirl'),
            h('span', { class: 'adm-logo-pill' }, 'Admin')),
        h('nav', { class: 'adm-nav', 'aria-label': 'Admin sections' }, links),
        h('div', { class: 'adm-top-right' },
            h('a', { class: 'a-btn ghost sm', href: '/', target: '_blank', rel: 'noopener' }, 'Open game ↗'),
            h('span', { class: 'adm-user', title: 'Signed in' }, h('span', { 'aria-hidden': 'true' }, '🙂'), me.name),
            h('button', {
                class: 'a-btn ghost sm', type: 'button',
                onClick: async () => { await post('/api/admin/logout').catch(() => {}); onSignOut(); },
            }, 'Sign out')));

    replace(root, top, outlet);

    return {
        outlet,
        setActive(path) {
            for (const [i, item] of NAV.entries()) {
                links[i].classList.toggle('is-active', item.match(path));
                if (item.match(path)) links[i].setAttribute('aria-current', 'page');
                else links[i].removeAttribute('aria-current');
            }
        },
    };
}
