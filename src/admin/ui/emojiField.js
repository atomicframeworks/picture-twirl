// src/admin/ui/emojiField.js
//
// An emoji button that opens a searchable picker (emoji-picker-element, data
// self-hosted from emoji-picker-element-data — no CDN). The picker code loads
// on first open so the admin's first paint stays light.
//
//   const field = emojiButton({ value: '🎃', onChange: (emoji) => … });
//   parent.append(field.el); field.set('🎉');

import { h } from '../lib/dom.js';

let pickerModules = null;
function loadPicker() {
    pickerModules ||= Promise.all([
        import('emoji-picker-element'),
        import('emoji-picker-element-data/en/emojibase/data.json?url'),
    ]).then(([mod, data]) => ({ Picker: mod.Picker, dataSource: data.default }));
    return pickerModules;
}

let openPopover = null;

/** Close whichever emoji popover is open. */
export function closeEmojiPopover() {
    openPopover?.();
    openPopover = null;
}

export function emojiButton({ value = '🎲', onChange, label = 'Choose an emoji', size = 'md' }) {
    let current = value || '🎲';
    const el = h('button', {
        type: 'button', class: `adm-emoji-btn is-${size}`, title: label, 'aria-label': `${label} (current: ${current})`,
        'aria-haspopup': 'dialog', dataset: { testid: 'emoji-button' },
    }, current);

    function set(next) {
        current = next || '🎲';
        el.textContent = current;
        el.setAttribute('aria-label', `${label} (current: ${current})`);
    }

    el.addEventListener('click', async () => {
        if (openPopover) { closeEmojiPopover(); return; }
        const { Picker, dataSource } = await loadPicker();
        const picker = new Picker({ dataSource });
        picker.classList.add('light');
        const pop = h('div', { class: 'adm-emoji-pop', role: 'dialog', 'aria-label': 'Pick an emoji' }, picker);

        // In a modal <dialog> (New board) the picker must live inside it: a modal
        // dialog sits in the browser's top layer, above any z-index, and makes
        // everything outside it inert. There it's placed against the viewport.
        const host = el.closest('dialog[open]');
        const rect = el.getBoundingClientRect();
        const [x0, y0] = host ? [0, 0] : [window.scrollX, window.scrollY];
        Object.assign(pop.style, {
            position: host ? 'fixed' : 'absolute',
            top: `${Math.min(y0 + rect.bottom + 6, y0 + window.innerHeight - 420)}px`,
            left: `${Math.max(8, Math.min(x0 + rect.left, x0 + window.innerWidth - 360))}px`,
        });

        const onDocDown = (e) => { if (!pop.contains(e.target) && e.target !== el) closeEmojiPopover(); };
        // preventDefault: Escape closes the picker only, not a dialog around it.
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeEmojiPopover(); el.focus(); } };
        picker.addEventListener('emoji-click', (e) => {
            set(e.detail.unicode);
            onChange?.(current);
            closeEmojiPopover();
            el.focus();
        });

        (host || document.body).append(pop);
        setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
        document.addEventListener('keydown', onKey);
        openPopover = () => {
            pop.remove();
            document.removeEventListener('mousedown', onDocDown);
            document.removeEventListener('keydown', onKey);
        };
        // Focus the picker's search box for quick typing.
        requestAnimationFrame(() => picker.shadowRoot?.querySelector('input')?.focus());
    });

    return { el, set, get: () => current };
}
