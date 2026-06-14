// src/gallery.js
//
// Live showcase of every reusable component in src/components/. This page does
// NOT touch Firebase — it just renders components so we can develop and
// visually verify them in isolation (and screenshot them via Playwright).
//
// Dev: http://localhost:3000/gallery.html

import { byId, el } from './ui/dom.js';
import { modal } from './ui/modal.js';
import { attachCopyButton } from './ui/copyButton.js';
import {
    Button, IconButton, Field, Card, Heading,
    SectionHeader, GameHeader, ActionsTray, Pill,
    ScoreboardCard, SetCard, BoardTile, CategoryCell,
} from './components/index.js';

const COPY_SVG =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

// ── tiny layout helpers for the gallery ───────────────────────────────────
const section = (title, rows) => el('section', { class: 'gallery-section' }, [el('h2', {}, title), ...rows]);
const row = (label, ...nodes) => el('div', { class: 'gallery-row' }, [el('div', { class: 'gallery-label' }, label), ...nodes]);
const frame = (...nodes) => el('div', { class: 'gallery-frame' }, nodes);

const sections = [
    section('Buttons', [
        row('variants',
            Button({ label: 'Primary' }),
            Button({ label: 'Secondary', variant: 'secondary' }),
            Button({ label: 'Ghost', variant: 'ghost' }),
            Button({ label: 'Danger', variant: 'danger' }),
        ),
        row('states',
            Button({ label: 'Disabled', disabled: true }),
            Button({ label: 'BUZZ IN', variant: 'buzz-btn' }),
        ),
        row('icon button (click to copy "PT-DEMO")',
            (() => {
                const b = IconButton({ icon: COPY_SVG, title: 'Copy code' });
                attachCopyButton(b, () => 'PT-DEMO');
                return b;
            })(),
            IconButton({ icon: COPY_SVG, title: 'Large', large: true }),
        ),
    ]),

    section('Form fields', [
        row('with hint', frame(Field({ id: 'g-name', label: 'Your Screen Name', placeholder: 'e.g., Kevin', hint: 'Visible to all players' }))),
        row('with value', frame(Field({ id: 'g-game', label: 'Game Name', value: 'Friday Funnies' }))),
        row('with error', frame(Field({ id: 'g-code', label: 'Enter game code', placeholder: '1XJHQ', error: 'Sorry, game not found. Please check with your host.' }))),
    ]),

    section('Pills', [
        row('states',
            Pill({ label: 'Sam' }),
            Pill({ label: 'You (me)', isMe: true }),
            Pill({ label: 'Clickable', clickable: true }),
            Pill({ label: 'Selected', clickable: true, selected: true }),
        ),
    ]),

    section('Cards & headings', [
        row('headings', el('div', {}, [Heading({ text: 'Heading XL', size: 'xl' }), Heading({ text: 'Heading LG', size: 'lg' })])),
        row('card', frame(Card({
            center: true,
            children: [Heading({ text: 'Picture Twirl', size: 'lg' }), el('p', { class: 'text-muted' }, 'A game of swirling images.')],
        }))),
    ]),

    section('Headers', [
        row('section header', frame(SectionHeader({ title: 'Assign Players' }))),
        row('game header (with code)', frame(GameHeader({ title: 'Friday Funnies', code: '2KVMR' }))),
    ]),

    section('Scoreboard', [
        row('team cards',
            frame(el('div', { class: 'scoreboard' }, [
                ScoreboardCard({ team: 'A', name: 'Team Puppers', score: 600, player: 'SAM' }),
                ScoreboardCard({ team: 'B', name: 'Team Kat Fever', score: 400 }),
            ])),
        ),
    ]),

    section('Question set cards', [
        row('selectable',
            SetCard({ id: 'pop', title: 'Pop Culture Icons', subtitle: '90s & 00s', icon: '🎬', selected: true }),
            SetCard({ id: 'misc', title: 'Another Set', subtitle: 'Coming soon', icon: '🃏' }),
        ),
    ]),

    section('Board tiles', [
        row('category + tile states',
            frame(el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap; align-items:center' }, [
                CategoryCell({ name: '90s Stars' }),
                BoardTile({ value: 200 }),
                BoardTile({ value: 400, state: 'opened' }),
                BoardTile({ value: 600, state: 'answered' }),
                BoardTile({ value: '—', state: 'disabled' }),
            ])),
        ),
    ]),

    section('Action tray', [
        row('sticky bottom tray (shown inline here)',
            frame(ActionsTray({
                children: [
                    Button({ label: 'Start Game' }),
                    el('hr'),
                    el('a', { href: '#', class: 'exit-link' }, 'End game'),
                ],
            })),
        ),
    ]),

    section('Modal (existing ui/modal.js)', [
        row('promise-based dialogs',
            Button({
                label: 'Open confirm…', variant: 'secondary',
                onClick: () => modal.confirm({ title: 'End game?', body: 'This will end the game for everyone.', confirmText: 'End game', variant: 'danger' }),
            }),
            Button({
                label: 'Open alert…', variant: 'ghost',
                onClick: () => modal.alert({ title: 'Heads up', body: 'This is the alert component.' }),
            }),
        ),
    ]),
];

const root = byId('gallery');
root.append(
    el('div', { class: 'gallery-title' }, 'Picture Twirl — Component Gallery'),
    el('p', { class: 'gallery-intro' }, 'Live showcase of the reusable components in src/components/. Styled by the app’s own CSS.'),
    ...sections,
);
