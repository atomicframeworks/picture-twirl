// src/admin/main.js
//
// Picture Twirl admin (served at /admin/; PROPOSAL.md §5). Signed out → the
// sign-in screen; signed in → the shell + hash-routed views. Talks only to
// /api/admin/* (worker/routes/admin.js).

import { get } from './lib/api.js';
import { h, replace } from './lib/dom.js';
import { onRouteChange } from './lib/router.js';
import { renderLogin } from './views/login.js';
import { renderShell } from './views/shell.js';
import { mountDashboard } from './views/dashboard.js';
import { mountBoards } from './views/boards.js';
import { mountEditor } from './views/editor.js';
import { mountActivity } from './views/activity.js';
import { closeEmojiPopover } from './ui/emojiField.js';
import { closeTileDrawer } from './ui/tileDrawer.js';

const root = document.getElementById('admin');
let stopRoutes = null;
let cleanupView = null;
let signedIn = false;

function teardownView() {
    cleanupView?.();
    cleanupView = null;
    closeEmojiPopover();
    closeTileDrawer();
}

function showLogin(notice = '') {
    signedIn = false;
    stopRoutes?.();
    stopRoutes = null;
    teardownView();
    document.title = 'Sign in · Picture Twirl Admin';
    renderLogin(root, { onSignedIn: start, notice });
}

function showMessage(text) {
    replace(root, h('main', { class: 'adm-login' }, h('div', { class: 'adm-login-card' },
        h('div', { class: 'adm-login-logo' }, h('span', { class: 'adm-logo-text' }, 'Picture Twirl'), h('span', { class: 'adm-logo-pill' }, 'Admin')),
        h('p', null, text))));
}

function start(me) {
    signedIn = true;
    const shell = renderShell(root, { me, onSignOut: () => showLogin('Signed out. See you soon!') });
    stopRoutes?.();
    stopRoutes = onRouteChange((route) => {
        teardownView();
        shell.setActive(route.path);
        const [section, id] = route.segments;
        if (section === 'boards' && id) {
            document.title = 'Board · Picture Twirl Admin';
            cleanupView = mountEditor(shell.outlet, { route, boardId: id });
        } else if (section === 'boards') {
            document.title = 'Boards · Picture Twirl Admin';
            cleanupView = mountBoards(shell.outlet, { route });
        } else if (section === 'activity') {
            document.title = 'Activity · Picture Twirl Admin';
            cleanupView = mountActivity(shell.outlet);
        } else {
            document.title = 'Dashboard · Picture Twirl Admin';
            cleanupView = mountDashboard(shell.outlet);
        }
        window.scrollTo(0, 0);
    });
}

// Any 401 from the API (expired/cleared session) → back to sign-in, once.
window.addEventListener('admin:signed-out', () => {
    if (signedIn) showLogin('Your session ended — please sign in again.');
});

async function boot() {
    root.classList.remove('adm-boot');
    try {
        start(await get('/api/admin/me'));
    } catch (err) {
        if (err.status === 401) showLogin();
        else if (err.status === 503) showMessage('The admin isn’t set up on this server yet (missing ADMIN_PASSWORD / SESSION_SECRET).');
        else showMessage(err.message);
    }
}

boot();
