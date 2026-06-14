// Picture Twirl – Modal Kit (vanilla JS)
// Promise-based API with queueing, focus-trap, ESC/backdrop dismiss.

const state = { open: null, q: [] };

function build({ title, body, actions }) {
    const wrap = document.createElement('div');
    wrap.className = 'pt-modal-backdrop';
    wrap.dataset.open = 'false';

    const dlg = document.createElement('div');
    dlg.className = 'pt-modal';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');

    // Body
    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'pt-m-body';

    const h = document.createElement('h2');
    h.className = 'pt-m-title';
    h.textContent = title || '';

    const p = document.createElement('p');
    p.className = 'pt-m-desc';
    p.textContent = body || '';

    if (title) { h.id = `mt-${crypto.randomUUID()}`; dlg.setAttribute('aria-labelledby', h.id); }
    if (body) { p.id = `md-${crypto.randomUUID()}`; dlg.setAttribute('aria-describedby', p.id); }

    bodyWrap.append(h, p);

    // Actions
    const act = document.createElement('div');
    act.className = 'pt-m-actions';

    (actions && actions.length ? actions : [{ id: 'ok', label: 'OK', variant: 'primary' }])
        .forEach(a => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `pt-m-btn ${a.variant || 'primary'}`;
            btn.textContent = a.label || a.id || 'OK';
            btn.addEventListener('click', () => close(a.id || a.label));
            act.appendChild(btn);
        });

    // Assemble
    dlg.append(bodyWrap, act);
    wrap.append(dlg);

    // Backdrop click dismiss
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close('dismiss'); });

    // Focus trap
    const focusables = () => wrap.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])');
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close('dismiss'); return; }
        if (e.key !== 'Tab') return;
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    wrap.addEventListener('keydown', onKey);

    // Initial focus helper
    const focus = () => (focusables()[0] || wrap).focus({ preventScroll: true });

    return { wrap, focus };
}

function next() {
    if (state.open || state.q.length === 0) return;
    const { cfg, resolve } = state.q.shift();
    const { wrap, focus } = build(cfg);
    document.body.appendChild(wrap);
    state.open = { wrap, resolve };
    requestAnimationFrame(() => { wrap.dataset.open = 'true'; focus(); });
}

function close(result) {
    if (!state.open) return;
    const { wrap, resolve } = state.open;
    wrap.dataset.open = 'false';
    setTimeout(() => wrap.remove(), 160);
    state.open = null;
    resolve(result);
    next();
}

function open(cfg) {
    return new Promise((resolve) => {
        state.q.push({ cfg, resolve });
        next();
    });
}

// Convenience helpers
function confirm({ title = 'Are you sure?', body = '', confirmText = 'Confirm', cancelText = 'Cancel', variant = 'primary' } = {}) {
    return open({
        title, body,
        actions: [
            { id: 'cancel', label: cancelText, variant: 'secondary' },
            { id: 'confirm', label: confirmText, variant }
        ]
    });
}

function alert({ title = 'Heads up', body = '', buttonText = 'OK', variant = 'primary' } = {}) {
    return open({ title, body, actions: [{ id: 'ok', label: buttonText, variant }] });
}

export const modal = { open, confirm, alert };
export default modal;
