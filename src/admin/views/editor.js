// src/admin/views/editor.js
//
// The board editor (PROPOSAL.md §5.6): a 5×5 grid you can rearrange (drag, or
// ▲▼ / ◀▶), pictures by drop / click / paste / link, autosave with conflict
// detection, undo, the publish gate, and a players'-eye preview.
// -----------------------------------------------------------------------------
// State flow: every edit produces a new draft (lib/draftOps.js) → render →
// autosave (debounced PUT with `rev`). The server answers with the new rev and
// the publish check. A 409 "stale" means someone else saved — we stop and
// offer a reload rather than overwrite their work.
// -----------------------------------------------------------------------------

import Sortable from 'sortablejs';
import { debounce, h, replace } from '../lib/dom.js';
import { get, post, put } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { fullDate, plural, timeAgo } from '../lib/format.js';
import { moveCategory, moveTile, sameDraft, setCategoryTitle, setTile, swapTiles } from '../lib/draftOps.js';
import { isImageFile, readTransfer, uploadPicture, uploadPictureFromUrl } from '../lib/imageTools.js';
import { readyBar, rightsBadge, statusChip } from '../ui/chips.js';
import { confirmDialog, openDialog, toast } from '../ui/feedback.js';
import { emojiButton } from '../ui/emojiField.js';
import { closeTileDrawer, openTileDrawer } from '../ui/tileDrawer.js';
import { LIMITS, TILES_PER_CATEGORY } from '../../shared/boards.js';

const AUTOSAVE_MS = 800;
const UNDO_LIMIT = 50;

export function mountEditor(outlet, { boardId }) {
    const s = {
        board: null,        // admin summary row
        draft: null,
        images: {},         // id → publicImage
        validation: null,
        saved: null,        // last saved { title, emoji, description, draft }
        saving: false,
        status: 'saved',    // saved | dirty | saving | error | conflict
        undo: [],
        redo: [],
        uploading: new Set(),   // "cat-row" keys
        hoverTile: null,        // { cat, row } for paste
        sortables: [],
    };
    let alive = true;

    const readOnly = () => s.board?.status === 'archived' || s.status === 'conflict';
    const where = (cat, row) => `${s.draft.categories[cat].title.trim() || `Category ${cat + 1}`} · ${s.draft.points[row]}`;

    // ── Load ─────────────────────────────────────────────────────────────────
    replace(outlet, h('div', { class: 'adm-loading' }, 'Loading board…'));
    get(`/api/admin/boards/${boardId}`).then((data) => {
        if (!alive) return;
        apply(data);
        s.saved = snapshot();
        renderAll();
    }).catch((err) => {
        if (!alive) return;
        replace(outlet, h('div', { class: 'adm-card adm-error' },
            err.status === 404 ? 'That board doesn’t exist (it may have been removed).' : err.message,
            ' ', h('a', { href: '#/boards' }, '← Back to boards')));
    });

    function apply({ board, draft, images, validation }) {
        s.board = board;
        if (draft) s.draft = draft;
        if (images) s.images = { ...s.images, ...images };
        if (validation) s.validation = validation;
    }

    const snapshot = () => ({ title: s.board.title, emoji: s.board.emoji, description: s.board.description || '', draft: s.draft });

    // ── Layout (built once, parts re-rendered) ───────────────────────────────
    const headEl = h('div', { class: 'ed-head' });
    const checkEl = h('div', { class: 'ed-check' });
    const bannerEl = h('div', { class: 'ed-banner', hidden: true, role: 'status' });
    const gridEl = h('div', { class: 'ed-grid', dataset: { testid: 'board-grid' } });
    const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    let pickTarget = null;
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file && pickTarget) addPicture(pickTarget.cat, pickTarget.row, { file });
        fileInput.value = '';
    });

    function renderAll() {
        replace(outlet, headEl, bannerEl, checkEl, gridEl, fileInput);
        renderHead();
        renderCheck();
        renderGrid();
        renderBanner();
    }

    // ── Header: emoji, name, description, status, save state, actions ───────
    let titleInput;
    let descInput;
    let saveEl;
    function renderHead() {
        const b = s.board;
        const emoji = emojiButton({ value: b.emoji, label: 'Board emoji', size: 'xl', onChange: (e) => { b.emoji = e; changed(); } });
        if (readOnly()) emoji.el.disabled = true;
        titleInput = h('input', {
            class: 'ed-title', value: b.title, maxlength: LIMITS.TITLE, 'aria-label': 'Board name', disabled: readOnly(),
            onFocus: () => pushUndo(), onInput: () => { b.title = titleInput.value; titleInput.classList.remove('is-bad'); changed(); },
        });
        descInput = h('input', {
            class: 'ed-desc', value: b.description || '', maxlength: LIMITS.DESCRIPTION, placeholder: 'One-line description players see (optional)',
            'aria-label': 'Board description', disabled: readOnly(),
            onFocus: () => pushUndo(), onInput: () => { b.description = descInput.value; changed(); },
        });
        saveEl = h('span', { class: 'ed-save', role: 'status', 'aria-live': 'polite', dataset: { testid: 'save-state' } });

        const publishLabel = b.status === 'published' ? (b.unpublished_changes ? 'Publish changes' : 'Published ✓') : 'Publish';
        const menu = h('details', { class: 'adm-menu' },
            h('summary', { class: 'a-btn ghost', 'aria-label': 'More actions' }, '⋯'),
            h('div', { class: 'adm-menu-list', role: 'menu' },
                b.status === 'published' ? h('button', { type: 'button', role: 'menuitem', onClick: () => statusAction('unpublish') }, 'Move to draft') : null,
                h('button', { type: 'button', role: 'menuitem', onClick: duplicate }, 'Duplicate'),
                b.status === 'archived'
                    ? h('button', { type: 'button', role: 'menuitem', onClick: () => statusAction('restore') }, 'Restore')
                    : h('button', { type: 'button', role: 'menuitem', onClick: () => statusAction('archive') }, 'Archive')));

        replace(headEl,
            h('a', { class: 'ed-back', href: '#/boards' }, '← Boards'),
            h('div', { class: 'ed-head-main' },
                emoji.el,
                h('div', { class: 'ed-head-text' }, titleInput, descInput)),
            h('div', { class: 'ed-head-side' },
                h('div', { class: 'ed-head-meta' },
                    statusChip(b.status, { unpublishedChanges: b.unpublished_changes }),
                    readyBar(b.tiles_ready),
                    b.flagged_tiles ? rightsBadge({ count: b.flagged_tiles }) : null,
                    saveEl),
                h('div', { class: 'ed-head-actions' },
                    h('button', { type: 'button', class: 'a-btn ghost', onClick: preview }, '👀 Preview'),
                    h('button', {
                        type: 'button', class: 'a-btn primary', dataset: { testid: 'publish' },
                        disabled: readOnly() || (b.status === 'published' && !b.unpublished_changes),
                        onClick: publish,
                    }, publishLabel),
                    menu)),
            h('p', { class: 'adm-muted ed-head-foot' },
                `Updated ${timeAgo(b.updated_at)}${b.updated_by ? ` by ${b.updated_by}` : ''}`,
                b.published_at ? ` · last published ${timeAgo(b.published_at)}` : '',
                ' · ', h('span', { title: 'Use the ▲▼ ◀▶ buttons or drag ⠿ to rearrange. ⌘/Ctrl+Z undoes.' }, 'Tips ⓘ')));
        renderSave();
    }

    function renderSave() {
        if (!saveEl) return;
        const text = { saved: '✓ Saved', dirty: '● Unsaved…', saving: '⟳ Saving…', error: '⚠ Not saved — retrying', conflict: '⛔ Changed elsewhere' }[s.status];
        saveEl.textContent = text;
        saveEl.className = `ed-save is-${s.status}`;
        saveEl.title = s.status === 'saved' && s.board ? `Saved ${fullDate(s.board.updated_at)}` : '';
    }

    function renderBanner() {
        if (s.status === 'conflict') {
            bannerEl.hidden = false;
            replace(bannerEl, '⛔ Someone else changed this board while you were editing. Your last changes were not saved.',
                h('button', { type: 'button', class: 'a-btn sm', onClick: () => location.reload() }, 'Reload the board'));
        } else if (s.board?.status === 'archived') {
            bannerEl.hidden = false;
            replace(bannerEl, '🗄️ This board is archived (read-only). Restore it to edit or publish.',
                h('button', { type: 'button', class: 'a-btn sm', onClick: () => statusAction('restore') }, 'Restore'));
        } else {
            bannerEl.hidden = true;
        }
    }

    // ── Publish check (problems block, warnings don't) ───────────────────────
    function renderCheck() {
        const v = s.validation;
        if (!v) return;
        const item = (p, kind) => h('li', { class: `is-${kind}` },
            p.cat != null
                ? h('button', { type: 'button', class: 'ed-check-link', onClick: () => focusTile(p.cat, p.row) }, p.message)
                : p.message);
        replace(checkEl,
            v.ok
                ? h('p', { class: 'ed-check-ok' }, '✅ Ready to publish', v.warnings.length ? ` · ${plural(v.warnings.length, 'heads-up', 'heads-ups')}` : '')
                : h('p', { class: 'ed-check-bad' }, `🧩 ${plural(v.problems.length, 'thing')} to finish before publishing`),
            (v.problems.length || v.warnings.length)
                ? h('details', { class: 'ed-check-list', open: false },
                    h('summary', null, 'Show details'),
                    h('ul', null, v.problems.map(p => item(p, 'problem')), v.warnings.map(w => item(w, 'warning'))))
                : null);
    }

    function focusTile(cat, row) {
        const el = gridEl.querySelector(`.ed-tile[data-cat="${cat}"][data-row="${row ?? 0}"]`) || gridEl.querySelector(`.ed-col[data-cat="${cat}"] .ed-col-title`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.classList.add('is-flash');
        setTimeout(() => el?.classList.remove('is-flash'), 1200);
        (el?.querySelector?.('input') || el)?.focus?.({ preventScroll: true });
    }

    // ── Grid ─────────────────────────────────────────────────────────────────
    function renderGrid() {
        s.sortables.forEach(x => x.destroy());
        s.sortables = [];
        const ro = readOnly();

        const cols = s.draft.categories.map((cat, c) => {
            const title = h('input', {
                class: 'ed-col-title', value: cat.title, maxlength: LIMITS.CATEGORY_TITLE, placeholder: `Category ${c + 1}`,
                'aria-label': `Category ${c + 1} name`, disabled: ro,
                onFocus: () => pushUndo(),
                onInput: () => { s.draft = setCategoryTitle(s.draft, c, title.value); changed({ rerender: false }); },
            });
            const tiles = h('div', { class: 'ed-tiles', dataset: { cat: c } }, cat.tiles.map((tile, r) => tileCard(tile, c, r, ro)));
            return h('section', { class: 'ed-col', dataset: { cat: c }, 'aria-label': `Category ${c + 1}` },
                h('header', { class: 'ed-col-head' },
                    h('span', { class: 'ed-handle ed-col-handle', title: 'Drag to move this category', 'aria-hidden': 'true' }, '⠿'),
                    title,
                    h('div', { class: 'ed-col-moves' },
                        h('button', { type: 'button', class: 'ed-icon', title: 'Move category left', 'aria-label': `Move category ${c + 1} left`, disabled: ro || c === 0, onClick: () => edit(d => moveCategory(d, c, c - 1)) }, '◀'),
                        h('button', { type: 'button', class: 'ed-icon', title: 'Move category right', 'aria-label': `Move category ${c + 1} right`, disabled: ro || c === s.draft.categories.length - 1, onClick: () => edit(d => moveCategory(d, c, c + 1)) }, '▶'))),
                tiles);
        });
        replace(gridEl, cols);
        if (ro) return;

        s.sortables.push(Sortable.create(gridEl, {
            handle: '.ed-col-handle', draggable: '.ed-col', animation: 150,
            onEnd: (evt) => { if (evt.oldIndex !== evt.newIndex) edit(d => moveCategory(d, evt.oldIndex, evt.newIndex)); else renderGrid(); },
        }));
        gridEl.querySelectorAll('.ed-tiles').forEach((list) => {
            s.sortables.push(Sortable.create(list, {
                group: 'tiles', handle: '.ed-tile-handle', draggable: '.ed-tile', animation: 150,
                onEnd: (evt) => {
                    const from = { cat: Number(evt.from.dataset.cat), row: evt.oldIndex };
                    const to = { cat: Number(evt.to.dataset.cat), row: Math.min(evt.newIndex, TILES_PER_CATEGORY - 1) };
                    if (from.cat === to.cat && from.row === to.row) { renderGrid(); return; }
                    // Same category: insert + shift (points follow the row). Across: swap, so every column keeps 5.
                    edit(d => (from.cat === to.cat ? moveTile(d, from.cat, from.row, to.row) : swapTiles(d, from, to)));
                },
            }));
        });
    }

    function tileCard(tile, c, r, ro) {
        const img = tile.imageId ? s.images[tile.imageId] : null;
        const key = `${c}-${r}`;
        const busy = s.uploading.has(key);
        const answer = h('input', {
            class: 'ed-answer', value: tile.answer, maxlength: LIMITS.ANSWER, placeholder: 'Answer', 'aria-label': `Answer for ${where(c, r)}`,
            disabled: ro,
            onFocus: () => pushUndo(),
            onInput: () => { s.draft = setTile(s.draft, c, r, { answer: answer.value }); changed({ rerender: false }); },
        });

        const pic = h('button', {
            type: 'button', class: `ed-pic${img ? ' has-img' : ''}${busy ? ' is-busy' : ''}`, disabled: ro,
            'aria-label': img ? `Open ${where(c, r)}` : `Add a picture to ${where(c, r)}`,
            onClick: () => (img ? openDrawer(c, r) : pickFile(c, r)),
        },
        img ? h('img', { src: img.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'ed-pic-empty' }, busy ? '⟳' : '＋', h('small', null, busy ? 'Uploading…' : 'Drop, click or paste')),
        busy && img ? h('span', { class: 'ed-pic-busy' }, '⟳') : null);

        const card = h('article', {
            class: 'ed-tile', tabindex: '0', dataset: { cat: c, row: r, testid: `tile-${c}-${r}` },
            onMouseenter: () => { s.hoverTile = { cat: c, row: r }; },
            onFocusin: () => { s.hoverTile = { cat: c, row: r }; },
            onDragover: (e) => { if (!ro && hasDroppable(e)) { e.preventDefault(); card.classList.add('is-drop'); } },
            onDragleave: () => card.classList.remove('is-drop'),
            onDrop: (e) => {
                card.classList.remove('is-drop');
                const got = !ro && readTransfer(e.dataTransfer);
                if (got) { e.preventDefault(); e.stopPropagation(); addPicture(c, r, got); }
            },
        },
        h('div', { class: 'ed-tile-top' },
            h('span', { class: 'ed-points' }, String(s.draft.points[r])),
            img ? rightsBadge({ status: img.rightsStatus, flags: img.rightsFlags }) : null,
            h('span', { class: 'ed-handle ed-tile-handle', title: 'Drag to move this tile', 'aria-hidden': 'true' }, '⠿')),
        pic,
        answer,
        h('div', { class: 'ed-tile-foot' },
            h('button', { type: 'button', class: 'ed-icon', title: 'Move up (easier)', 'aria-label': `Move ${where(c, r)} up`, disabled: ro || r === 0, onClick: () => edit(d => moveTile(d, c, r, r - 1)) }, '▲'),
            h('button', { type: 'button', class: 'ed-icon', title: 'Move down (harder)', 'aria-label': `Move ${where(c, r)} down`, disabled: ro || r === TILES_PER_CATEGORY - 1, onClick: () => edit(d => moveTile(d, c, r, r + 1)) }, '▼'),
            h('button', { type: 'button', class: 'ed-icon ed-more', title: 'Details, rights, preview', 'aria-label': `Details for ${where(c, r)}`, onClick: () => openDrawer(c, r) }, '⋯')));
        return card;
    }

    const hasDroppable = (e) => [...(e.dataTransfer?.types || [])].some(t => t === 'Files' || t === 'text/uri-list');

    // ── Pictures ─────────────────────────────────────────────────────────────
    function pickFile(c, r) {
        pickTarget = { cat: c, row: r };
        fileInput.click();
    }

    async function addPicture(c, r, { file, url }) {
        if (readOnly()) return;
        if (file && !isImageFile(file)) { toast('That file isn’t a picture (JPG, PNG, WebP, GIF, AVIF or SVG).', { kind: 'warn' }); return; }
        const key = `${c}-${r}`;
        s.uploading.add(key);
        renderGrid();
        try {
            const image = file ? await uploadPicture(file, { provider: 'upload' }) : await uploadPictureFromUrl(url);
            s.images[image.id] = image;
            pushUndo();
            s.draft = setTile(s.draft, c, r, { imageId: image.id });
            changed();
            toast(`Picture added to ${where(c, r)}.`, { kind: 'ok', timeout: 2500 });
        } catch (err) {
            toast(err.message, { kind: 'error', timeout: 7000 });
        } finally {
            s.uploading.delete(key);
            renderGrid();
        }
    }

    // Paste a picture (or a link) onto the tile under the mouse / with focus.
    const onPaste = (e) => {
        if (!s.hoverTile || readOnly()) return;
        if (e.target.closest?.('input, textarea') && !(e.clipboardData?.files?.length)) return; // let text pastes into fields be
        const got = readTransfer(e.clipboardData);
        if (!got) return;
        e.preventDefault();
        addPicture(s.hoverTile.cat, s.hoverTile.row, got.file ? { file: got.file } : got);
    };
    document.addEventListener('paste', onPaste);

    function openDrawer(c, r) {
        const tile = s.draft.categories[c].tiles[r];
        openTileDrawer({
            where: where(c, r),
            tile,
            image: tile.imageId ? s.images[tile.imageId] : null,
            readOnly: readOnly(),
            onTileChange: (patch) => { s.draft = setTile(s.draft, c, r, patch); changed(); },
            onImageSaved: (image) => { s.images[image.id] = image; refreshSummary(); },
            onReplace: () => { closeTileDrawer(); pickFile(c, r); },
            onFromLink: async (url) => { closeTileDrawer(); await addPicture(c, r, { url }); },
            onRemove: () => { closeTileDrawer(); edit(d => setTile(d, c, r, { imageId: null })); },
        });
    }

    // ── Editing + undo ───────────────────────────────────────────────────────
    function pushUndo() {
        if (!s.board) return;
        const snap = structuredClone(snapshot());
        const last = s.undo[s.undo.length - 1];
        if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
        s.undo.push(snap);
        if (s.undo.length > UNDO_LIMIT) s.undo.shift();
        s.redo = [];
    }

    /** Apply a structural edit: undo point → new draft → re-render → autosave. */
    function edit(fn) {
        if (readOnly()) return;
        pushUndo();
        s.draft = fn(s.draft);
        changed();
    }

    function restore(snap) {
        s.board.title = snap.title;
        s.board.emoji = snap.emoji;
        s.board.description = snap.description;
        s.draft = snap.draft;
        renderHead();
        changed();
    }

    const onKeydown = (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod || e.key.toLowerCase() !== 'z' || readOnly()) return;
        if (e.target.closest?.('input, textarea') && !e.altKey) return; // native undo inside text fields
        e.preventDefault();
        if (e.shiftKey) {
            const next = s.redo.pop();
            if (next) { s.undo.push(structuredClone(snapshot())); restore(next); }
        } else {
            const prev = s.undo.pop();
            if (prev) { s.redo.push(structuredClone(snapshot())); restore(prev); }
        }
    };
    document.addEventListener('keydown', onKeydown);

    // ── Autosave ─────────────────────────────────────────────────────────────
    const autosave = debounce(save, AUTOSAVE_MS);

    function changed({ rerender = true } = {}) {
        if (readOnly()) return;
        if (rerender) renderGrid();
        s.status = 'dirty';
        renderSave();
        autosave();
    }

    async function save() {
        if (s.saving) { autosave(); return; }   // one request at a time; try again shortly
        const now = snapshot();
        const last = s.saved;
        if (last && last.title === now.title && last.emoji === now.emoji && last.description === now.description && sameDraft(last.draft, now.draft)) {
            s.status = 'saved';
            renderSave();
            return;
        }
        s.saving = true;
        s.status = 'saving';
        renderSave();
        const body = { rev: s.board.rev, emoji: now.emoji, description: now.description, draft: now.draft };
        const titleChanged = now.title.trim() && now.title !== last?.title;
        if (titleChanged) body.title = now.title;
        try {
            const res = await put(`/api/admin/boards/${boardId}`, body);
            s.board = { ...res.board, title: s.board.title, emoji: s.board.emoji, description: s.board.description };
            s.validation = res.validation;
            s.saved = { ...structuredClone(now), title: res.board.title };
            s.status = 'saved';
        } catch (err) {
            if (err.code === 'stale') {
                s.status = 'conflict';
                renderAll();
                return;
            }
            if (err.code === 'title_taken' || err.code === 'title_too_long' || err.code === 'title_required') {
                // Keep everything else saving; flag the name.
                titleInput?.classList.add('is-bad');
                toast(err.message, { kind: 'warn' });
                s.saved = { ...(s.saved || now), title: now.title };   // don't retry the same bad name
                s.status = 'dirty';
                autosave();
            } else if (err.status === 401) {
                s.status = 'error';
            } else {
                s.status = 'error';
                setTimeout(() => alive && autosave(), 4000);
            }
        } finally {
            s.saving = false;
            if (alive) { renderSave(); renderCheck(); refreshHeadMeta(); }
        }
    }

    /** Re-render header badges after a save without touching the inputs being typed in. */
    function refreshHeadMeta() {
        const meta = headEl.querySelector('.ed-head-meta');
        if (!meta || !s.board) return;
        replace(meta,
            statusChip(s.board.status, { unpublishedChanges: s.board.unpublished_changes }),
            readyBar(s.board.tiles_ready),
            s.board.flagged_tiles ? rightsBadge({ count: s.board.flagged_tiles }) : null,
            saveEl);
        const pub = headEl.querySelector('[data-testid="publish"]');
        if (pub) {
            pub.textContent = s.board.status === 'published' ? (s.board.unpublished_changes ? 'Publish changes' : 'Published ✓') : 'Publish';
            pub.disabled = readOnly() || (s.board.status === 'published' && !s.board.unpublished_changes);
        }
    }

    async function refreshSummary() {
        try {
            const data = await get(`/api/admin/boards/${boardId}`);
            s.board = { ...data.board, title: s.board.title, emoji: s.board.emoji, description: s.board.description };
            s.validation = data.validation;
            s.images = { ...s.images, ...data.images };
            renderCheck();
            refreshHeadMeta();
            renderGrid();
        } catch { /* next save will catch up */ }
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    async function flushSave() {
        autosave.cancel();
        await save();
        return s.status === 'saved';
    }

    async function publish() {
        if (!(await flushSave())) { toast('Saving didn’t finish — try again in a moment.', { kind: 'warn' }); return; }
        const v = s.validation;
        if (!v.ok) {
            toast(`Not ready yet: ${v.problems[0].message}`, { kind: 'warn', timeout: 6000 });
            checkEl.querySelector('details')?.setAttribute('open', '');
            focusTile(v.problems[0].cat ?? 0, v.problems[0].row ?? 0);
            return;
        }
        const flagged = v.warnings.filter(w => w.code === 'picture_flagged').length;
        if (flagged && !(await confirmDialog({
            title: 'Publish with ⚠️ rights flags?',
            body: h('div', null,
                h('p', null, `${plural(flagged, 'picture')} on this board ${flagged === 1 ? 'has' : 'have'} rights to double-check (see the ⚠️ badges and each tile’s details).`),
                h('p', { class: 'adm-muted' }, 'That’s allowed — just make sure before running ads or a public launch.')),
            confirmText: 'Publish anyway',
        }))) return;
        try {
            apply(await post(`/api/admin/boards/${boardId}/publish`));
            s.saved = snapshot();
            toast(`🎉 ${s.board.emoji} ${s.board.title} is live — players can pick it now.`, { kind: 'ok', timeout: 5000 });
            renderAll();
        } catch (err) {
            toast(err.message, { kind: err.status === 422 ? 'warn' : 'error', timeout: 7000 });
            refreshSummary();
        }
    }

    async function statusAction(action) {
        if (action === 'archive' && !(await confirmDialog({ title: `Archive ${s.board.title}?`, body: 'Players won’t see it; you can restore it any time.', confirmText: 'Archive', danger: true }))) return;
        if (action !== 'restore' && !(await flushSave())) return;
        try {
            apply(await post(`/api/admin/boards/${boardId}/${action}`));
            s.saved = snapshot();
            toast({ unpublish: 'Moved to draft — players no longer see it.', archive: 'Archived.', restore: 'Restored to draft.' }[action], { kind: 'ok' });
            renderAll();
        } catch (err) {
            toast(err.message, { kind: 'error' });
        }
    }

    async function duplicate() {
        if (!(await flushSave())) return;
        try {
            const { board } = await post(`/api/admin/boards/${boardId}/duplicate`);
            toast(`Made “${board.title}”.`, { kind: 'ok' });
            navigate(`/boards/${board.id}`);
        } catch (err) {
            toast(err.message, { kind: 'error' });
        }
    }

    /** What players see: the board grid with category names and points. */
    function preview() {
        const d = s.draft;
        openDialog({
            title: `${s.board.emoji} ${s.board.title || 'Untitled'}`,
            wide: true,
            body: h('div', { class: 'ed-preview' },
                d.categories.map((cat, c) => h('div', { class: 'ed-preview-col' },
                    h('div', { class: 'ed-preview-cat' }, cat.title || `Category ${c + 1}`),
                    cat.tiles.map((t, r) => {
                        const img = t.imageId ? s.images[t.imageId] : null;
                        return h('div', { class: 'ed-preview-tile', title: t.answer || '(no answer)' },
                            img ? h('img', { src: img.thumb, alt: '' }) : null,
                            h('span', null, String(d.points[r])));
                    })))),
            actions: [{ label: 'Close', variant: 'primary' }],
        });
    }

    // Leaving with unsaved edits → browser asks.
    const onBeforeUnload = (e) => { if (s.status === 'dirty' || s.status === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
        alive = false;
        if (autosave.pending()) autosave.flush();     // save what's typed before leaving the page
        s.sortables.forEach(x => x.destroy());
        closeTileDrawer();
        document.removeEventListener('paste', onPaste);
        document.removeEventListener('keydown', onKeydown);
        window.removeEventListener('beforeunload', onBeforeUnload);
    };
}
