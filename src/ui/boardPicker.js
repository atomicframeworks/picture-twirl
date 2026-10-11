// src/ui/boardPicker.js
//
// The "Pick a Board" card list, shared by Create (step 2) and Play Again
// (round setup). Loads the published boards from the API and renders the
// existing .set-card markup (styles: createGame.css).
//
//   const picker = mountBoardPicker(listEl, { onChange: (board|null) => … });
//   picker.load();          // (re)fetch + render; clears the selection
//   picker.getSelected();   // { id, slug, title, emoji, description } | null
//   picker.reset();         // clear list + selection

import { listBoards } from '../data/boardsApi.js';
import { escapeHtml } from './format.js';

export function mountBoardPicker(listEl, { onChange } = {}) {
    let boards = [];
    let selectedId = '';

    function setSelected(id) {
        selectedId = id;
        listEl.querySelectorAll('.set-card').forEach(card => {
            const on = card.dataset.board === id;
            card.classList.toggle('is-selected', on);
            card.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        onChange?.(getSelected());
    }

    function getSelected() {
        return boards.find(b => b.id === selectedId) || null;
    }

    function showStatus(text, { retry = false } = {}) {
        listEl.innerHTML = `
      <div class="board-picker-status">
        <p>${escapeHtml(text)}</p>
        ${retry ? '<button type="button" class="btn secondary board-picker-retry">Try again</button>' : ''}
      </div>`;
    }

    async function load() {
        boards = [];
        setSelected('');
        showStatus('Loading boards…');
        try {
            boards = await listBoards();
        } catch (err) {
            console.error('Could not load boards:', err);
            showStatus('Couldn’t load the boards. Check your connection.', { retry: true });
            return;
        }
        if (!boards.length) {
            showStatus('No boards are published yet.');
            return;
        }
        listEl.innerHTML = boards.map(b => `
      <button class="set-card" data-board="${escapeHtml(b.id)}" type="button" aria-pressed="false">
        <div class="set-ic" aria-hidden="true">${escapeHtml(b.emoji || '🎲')}</div>
        <div>
          <div class="set-title">${escapeHtml(b.title)}</div>
          ${b.description ? `<div class="set-sub">${escapeHtml(b.description)}</div>` : ''}
        </div>
      </button>`).join('');
    }

    listEl.addEventListener('click', (e) => {
        if (e.target.closest('.board-picker-retry')) { load(); return; }
        const card = e.target.closest('.set-card');
        if (card && listEl.contains(card)) setSelected(card.dataset.board || '');
    });

    function reset() {
        boards = [];
        listEl.innerHTML = '';
        setSelected('');
    }

    return { load, getSelected, reset };
}
