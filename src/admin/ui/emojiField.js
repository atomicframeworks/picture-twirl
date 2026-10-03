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

        const rect = el.getBoundingClientRect();
        Object.assign(pop.style, {
            top: `${Math.min(window.scrollY + rect.bottom + 6, window.scrollY + window.innerHeight - 420)}px`,
            left: `${Math.max(8, Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - 360))}px`,
        });

        const onDocDown = (e) => { if (!pop.contains(e.target) && e.target !== el) closeEmojiPopover(); };
        const onKey = (e) => { if (e.key === 'Escape') { closeEmojiPopover(); el.focus(); } };
        picker.addEventListener('emoji-click', (e) => {
            set(e.detail.unicode);
            onChange?.(current);
            closeEmojiPopover();
            el.focus();
        });

        document.body.append(pop);
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
