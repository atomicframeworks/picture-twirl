// src/admin/ui/tileDrawer.js
//
// Side panel for one tile (PROPOSAL.md §5.7): the big picture, a "preview
// twirl" using the game's own swirl (src/game/swirl.js), answer + notes, and
// the picture's provenance + rights (license, creator, source, flags, credit,
// reviewed). Rights belong to the PICTURE, so saving them affects every board
// that uses it.

import { h, replace } from '../lib/dom.js';
import { patch } from '../lib/api.js';
import { fullDate } from '../lib/format.js';
import { creditFor, LICENSES, RIGHTS_FLAGS } from '../../shared/rights.js';
import { LIMITS } from '../../shared/boards.js';
import { startSwirlAnimation, drawUnswirled } from '../../game/swirl.js';
import { SWIRL } from '../../config.js';
import { rightsBadge } from './chips.js';
import { toast } from './feedback.js';

const USER_FLAGS = ['trademark', 'identifiable_person', 'answer_visible'];
const EXTRA_LICENSES = { 'cc-by-nc-4.0': 'CC BY-NC 4.0 (non-commercial — blocked)', 'cc-by-nd-4.0': 'CC BY-ND 4.0 (no derivatives — blocked)' };

let current = null;

/** Close the open drawer (if any). */
export function closeTileDrawer() {
    current?.close();
}

/**
 * @param {{
 *   where: string,                       // "Creepy Critters · 300"
 *   tile: { answer: string, imageId: string|null, notes: string },
 *   image: object|null,                  // publicImage shape
 *   readOnly?: boolean,
 *   onTileChange: (patch: object) => void,       // answer / notes edits
 *   onImageSaved: (image: object) => void,       // rights saved
 *   onReplace: () => void, onFromLink: (url: string) => Promise<void>, onRemove: () => void,
 * }} opts
 */
export function openTileDrawer(opts) {
    closeTileDrawer();
    const { where, tile, image, readOnly = false } = opts;
    let swirl = null;

    const panel = h('aside', { class: 'ed-drawer', role: 'dialog', 'aria-label': `Tile ${where}`, dataset: { testid: 'tile-drawer' } });
    const close = () => {
        swirl?.cancel();
        panel.remove();
        document.removeEventListener('keydown', onKey);
        current = null;
    };
    const onKey = (e) => { if (e.key === 'Escape' && !e.target.closest('input, textarea, select')) close(); };
    document.addEventListener('keydown', onKey);

    // ── Picture + preview twirl ──────────────────────────────────────────────
    const pic = h('div', { class: 'ed-drawer-pic' });
    if (image) {
        const imgEl = h('img', { src: image.url, alt: `Picture for ${where}`, crossorigin: 'anonymous' });
        const twirlCanvas = h('canvas', { class: 'ed-drawer-twirl', hidden: true, 'aria-label': 'Twirl preview' });
        const progress = h('span', { class: 'adm-muted ed-twirl-progress' });
        const play = h('button', { type: 'button', class: 'a-btn ghost sm', onClick: async () => {
            await imgEl.decode().catch(() => {});
            swirl?.cancel();
            imgEl.hidden = true;
            twirlCanvas.hidden = false;
            swirl = startSwirlAnimation(imgEl, twirlCanvas, 10_000, SWIRL.STRENGTH, 0, (p) => {
                progress.textContent = p >= 1 ? 'Revealed' : `${Math.round(p * 100)}%`;
            });
        } }, '▶ Preview twirl');
        const reveal = h('button', { type: 'button', class: 'a-btn ghost sm', onClick: () => {
            swirl?.cancel();
            swirl = null;
            drawUnswirled(imgEl, twirlCanvas);
            progress.textContent = 'Revealed';
        } }, 'Reveal');
        replace(pic, imgEl, twirlCanvas,
            h('div', { class: 'ed-drawer-pic-actions' }, play, reveal, progress),
            h('p', { class: 'adm-muted' }, `${image.width}×${image.height} · added ${fullDate(image.createdAt)}${image.createdBy ? ` by ${image.createdBy}` : ''}`));
    } else {
        replace(pic, h('div', { class: 'ed-drawer-empty' }, '🖼️ No picture yet'));
    }

    const link = h('input', { class: 'a-input', type: 'url', placeholder: 'Paste a picture or page link…', disabled: readOnly });
    const pictureActions = h('div', { class: 'ed-drawer-row' },
        h('button', { type: 'button', class: 'a-btn ghost sm', disabled: readOnly, onClick: () => opts.onReplace() }, image ? 'Replace…' : 'Choose a file…'),
        h('form', { class: 'ed-drawer-link', onSubmit: async (e) => {
            e.preventDefault();
            if (!link.value.trim()) return;
            await opts.onFromLink(link.value.trim());
        } }, link, h('button', { type: 'submit', class: 'a-btn ghost sm', disabled: readOnly }, 'Use link')),
        image ? h('button', { type: 'button', class: 'a-btn ghost sm danger-text', disabled: readOnly, onClick: () => opts.onRemove() }, 'Remove') : null);

    // ── Answer + notes ───────────────────────────────────────────────────────
    const answer = h('input', {
        class: 'a-input', value: tile.answer, maxlength: LIMITS.ANSWER, disabled: readOnly,
        onInput: () => opts.onTileChange({ answer: answer.value }),
    });
    const notes = h('textarea', {
        class: 'a-input', rows: 3, maxlength: LIMITS.NOTES, disabled: readOnly, placeholder: 'Only admins see this',
        onInput: () => opts.onTileChange({ notes: notes.value }),
    }, tile.notes || '');

    panel.append(
        h('header', { class: 'ed-drawer-head' },
            h('h2', null, where),
            h('button', { type: 'button', class: 'adm-dialog-x', 'aria-label': 'Close', onClick: close }, '×')),
        h('div', { class: 'ed-drawer-body' },
            pic,
            pictureActions,
            h('label', { class: 'a-field' }, h('span', null, 'Answer'), answer),
            h('label', { class: 'a-field' }, h('span', null, 'Notes'), notes),
            image ? rightsForm(image, readOnly, opts.onImageSaved) : null));

    document.body.append(panel);
    current = { close };
    (image ? answer : link).focus();
    return { close };
}

/** The picture's provenance + rights editor. */
function rightsForm(image, readOnly, onSaved) {
    const licenseOptions = { ...Object.fromEntries(Object.entries(LICENSES).map(([k, v]) => [k, v.label])), ...EXTRA_LICENSES };
    if (!licenseOptions[image.license]) licenseOptions[image.license] = image.licenseLabel || image.license;

    const license = h('select', { class: 'a-input', disabled: readOnly },
        Object.entries(licenseOptions).map(([code, label]) => h('option', { value: code, selected: code === image.license }, label)));
    const input = (value, attrs = {}) => h('input', { class: 'a-input', value: value || '', disabled: readOnly, ...attrs });
    const creator = input(image.creator, { maxlength: 200 });
    const creatorUrl = input(image.creatorUrl, { type: 'url' });
    const sourcePageUrl = input(image.sourcePageUrl, { type: 'url', placeholder: 'Where the picture was found' });
    const licenseUrl = input(image.licenseUrl, { type: 'url' });
    const attribution = input(image.attribution, { maxlength: 300, placeholder: 'e.g. “Cat” by Jane Doe, CC BY 4.0' });
    const rightsNote = h('textarea', { class: 'a-input', rows: 2, maxlength: 500, disabled: readOnly }, image.rightsNote || '');
    const flags = USER_FLAGS.map(f => h('label', { class: 'ed-flag', title: RIGHTS_FLAGS[f].reason },
        h('input', { type: 'checkbox', value: f, checked: image.rightsFlags.includes(f), disabled: readOnly }),
        RIGHTS_FLAGS[f].label));
    const reviewed = h('input', { type: 'checkbox', checked: !!image.reviewedBy, disabled: readOnly });
    const credit = h('p', { class: 'ed-credit' });
    const status = h('div', { class: 'ed-rights-status' });

    function preview() {
        const c = creditFor({ license: license.value, attribution: attribution.value.trim(), creator: creator.value.trim() });
        credit.textContent = c ? `Players will see: “${c}”` : 'No credit line needed for this license.';
    }
    function showStatus(img) {
        const reasons = img.rightsFlags.map(f => RIGHTS_FLAGS[f]).filter(Boolean);
        replace(status, rightsBadge({ status: img.rightsStatus, flags: img.rightsFlags }),
            reasons.length ? h('ul', { class: 'ed-reasons' }, reasons.map(r => h('li', null, h('strong', null, r.label), ' — ', r.reason))) : null,
            img.reviewedBy ? h('p', { class: 'adm-muted' }, `Reviewed by ${img.reviewedBy} · ${fullDate(img.reviewedAt)}`) : null);
    }
    [license, attribution, creator].forEach(el => el.addEventListener('input', preview));
    preview();
    showStatus(image);

    const save = h('button', { type: 'submit', class: 'a-btn primary sm', disabled: readOnly }, 'Save rights');
    return h('form', { class: 'ed-rights', onSubmit: async (e) => {
        e.preventDefault();
        save.disabled = true;
        try {
            const { image: saved } = await patch(`/api/admin/images/${image.id}`, {
                license: license.value, creator: creator.value, creatorUrl: creatorUrl.value, sourcePageUrl: sourcePageUrl.value,
                licenseUrl: licenseUrl.value, attribution: attribution.value, rightsNote: rightsNote.value,
                flags: flags.map(l => l.querySelector('input')).filter(i => i.checked).map(i => i.value),
                reviewed: reviewed.checked,
            });
            Object.assign(image, saved);
            showStatus(saved);
            onSaved(saved);
            toast('Rights saved. They apply to every board using this picture; credits reach players on the next publish.', { kind: 'ok', timeout: 6000 });
        } catch (err) {
            toast(err.message, { kind: 'error' });
        } finally {
            save.disabled = readOnly;
        }
    } },
    h('h3', null, 'Picture rights'),
    status,
    h('label', { class: 'a-field' }, h('span', null, 'License'), license),
    h('div', { class: 'ed-drawer-row' },
        h('label', { class: 'a-field adm-grow' }, h('span', null, 'Creator'), creator),
        h('label', { class: 'a-field adm-grow' }, h('span', null, 'Creator link'), creatorUrl)),
    h('label', { class: 'a-field' }, h('span', null, 'Source page'), sourcePageUrl),
    image.sourceFileUrl ? h('p', { class: 'adm-muted ed-source-file' }, 'Downloaded from: ', h('a', { href: image.sourceFileUrl, target: '_blank', rel: 'noopener noreferrer' }, image.sourceFileUrl)) : null,
    h('label', { class: 'a-field' }, h('span', null, 'License link'), licenseUrl),
    h('label', { class: 'a-field' }, h('span', null, 'Credit line (optional)'), attribution),
    credit,
    h('fieldset', { class: 'ed-flags' }, h('legend', null, 'Double-check flags'), flags),
    h('label', { class: 'a-field' }, h('span', null, 'Rights notes'), rightsNote),
    h('label', { class: 'ed-flag' }, reviewed, 'I checked this picture’s rights'),
    save);
}
