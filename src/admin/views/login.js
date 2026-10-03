// src/admin/views/login.js — sign in with the shared password + your name.

import { h, replace } from '../lib/dom.js';
import { post } from '../lib/api.js';

const NAME_KEY = 'pt.admin.name';

function rememberedName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

/**
 * @param {HTMLElement} root
 * @param {{ onSignedIn: (me: { name: string }) => void, notice?: string }} opts
 */
export function renderLogin(root, { onSignedIn, notice = '' }) {
    const name = h('input', { class: 'a-input', id: 'adm-login-name', autocomplete: 'nickname', maxlength: 40, required: true, value: rememberedName() });
    const password = h('input', { class: 'a-input', id: 'adm-login-password', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'adm-login-error', role: 'alert', hidden: !notice }, notice);
    const submit = h('button', { class: 'a-btn primary wide', type: 'submit' }, 'Sign in');

    const form = h('form', {
        class: 'adm-login-card',
        onSubmit: async (e) => {
            e.preventDefault();
            submit.disabled = true;
            error.hidden = true;
            try {
                const me = await post('/api/admin/login', { name: name.value, password: password.value });
                try { localStorage.setItem(NAME_KEY, me.name); } catch { /* private mode */ }
                onSignedIn(me);
            } catch (err) {
                error.textContent = err.message;
                error.hidden = false;
                password.select();
            } finally {
                submit.disabled = false;
            }
        },
    },
    h('div', { class: 'adm-login-logo' },
        h('span', { class: 'adm-logo-text' }, 'Picture Twirl'),
        h('span', { class: 'adm-logo-pill' }, 'Admin')),
    h('h1', null, 'Welcome back! 👋'),
    h('p', { class: 'adm-muted' }, 'Sign in to manage boards and pictures.'),
    h('label', { class: 'a-field', for: 'adm-login-name' }, h('span', null, 'Your name'), name,
        h('small', null, 'Shown in the activity log next to what you change.')),
    h('label', { class: 'a-field', for: 'adm-login-password' }, h('span', null, 'Password'), password),
    error,
    submit);

    replace(root, h('main', { class: 'adm-login' }, form));
    (name.value ? password : name).focus();
}
