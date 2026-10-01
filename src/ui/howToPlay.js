// src/ui/howToPlay.js
//
// Picture Twirl — "How to Play" overlay
// -----------------------------------------------------------------------------
// API: openHowToPlay({ context, onStartNewGame, onJoinGame })
//   context: 'home' | 'game'
//   onStartNewGame, onJoinGame: callbacks for home final-step CTAs
//
// Lifecycle: create DOM on open, remove DOM on close.
// Every open starts on step 1.
// -----------------------------------------------------------------------------

import { el } from './dom.js';

// ─── Step definitions ────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;

function buildIllustration(step) {
    // Returns an SVG string for each step
    switch (step) {
        case 0: return illBoard();
        case 1: return illSwirl();
        case 2: return illBuzz();
        case 3: return illAward();
        case 4: return illComplete();
        default: return '';
    }
}

const STEPS = [
    {
        title: 'Pick a picture',
        body: 'Choose a category and point value. Tougher pictures are worth more.',
    },
    {
        title: 'Watch it untwirl',
        body: "The picture slowly comes into focus. Think you know what it is? Don't wait too long.",
    },
    {
        title: 'Buzz in!',
        body: 'First buzz gets the guess. The reveal pauses while the GM checks the answer.',
    },
    {
        title: 'Score points',
        body: 'Right answer? Your team gets the points. Wrong answer? The other players are still in it.',
    },
    {
        title: 'Win the game',
        body: 'Clear the board. Score the most points. Win MVP, and earn bragging rights.',
    },
];

// ─── Illustrations ───────────────────────────────────────────────────────────

function illBoard() {
    // A 5x3 tile grid with one tile highlighted
    const cols = 5, rows = 3;
    const tW = 32, tH = 24, gap = 5;
    const totalW = cols * tW + (cols - 1) * gap;
    const totalH = rows * tH + (rows - 1) * gap;
    const vW = totalW + 20, vH = totalH + 44;

    let tiles = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = 10 + c * (tW + gap);
            const y = 36 + r * (tH + gap);
            const isHot = (c === 2 && r === 1);
            const fill = isHot ? '#7C3AED' : '#EDE9FE';
            const stroke = isHot ? '#5B21B6' : '#C4B5FD';
            tiles += `<rect x="${x}" y="${y}" width="${tW}" height="${tH}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
            if (!isHot) {
                // Value label
                const val = (r + 1) * 100;
                const textColor = '#8B5CF6';
                tiles += `<text x="${x + tW / 2}" y="${y + tH / 2 + 4}" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="10" font-weight="600" fill="${textColor}">$${val}</text>`;
            }
        }
    }

    // Tap indicator on the highlighted tile
    const hx = 10 + 2 * (tW + gap) + tW / 2;
    const hy = 36 + 1 * (tH + gap) + tH / 2;

    return `<svg class="htp-ill" viewBox="0 0 ${vW} ${vH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Category headers -->
  ${Array.from({ length: cols }, (_, c) => {
        const cx = 10 + c * (tW + gap) + tW / 2;
        return `<rect x="${10 + c * (tW + gap)}" y="10" width="${tW}" height="18" rx="4" fill="#F5F3FF"/>
    <text x="${cx}" y="22" text-anchor="middle" font-family="Poppins, sans-serif" font-size="7" font-weight="600" fill="#6B7280">Cat ${c + 1}</text>`;
    }).join('')}
  ${tiles}
  <!-- Tap ripple -->
  <circle cx="${hx}" cy="${hy}" r="18" fill="#7C3AED" opacity="0.12"/>
  <circle cx="${hx}" cy="${hy}" r="12" fill="#7C3AED" opacity="0.18"/>
  <!-- Finger icon -->
  <text x="${hx + 11}" y="${hy - 9}" font-size="15" text-anchor="middle" font-family="sans-serif">👆</text>
  <!-- Value on hot tile -->
  <text x="${hx}" y="${hy + 5}" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="11" font-weight="700" fill="#fff">$200</text>
</svg>`;
}

function illSwirl() {
    return `<svg class="htp-ill" viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Image frame -->
  <rect x="30" y="14" width="140" height="105" rx="10" fill="#EDE9FE"/>
  <!-- Swirl arcs (concentric, offset from centre) -->
  <g transform="translate(100,66)" fill="none" stroke-linecap="round">
    <path d="M-48,0 A48,48 0 1,1 48,0" stroke="#C4B5FD" stroke-width="7" opacity="0.5"/>
    <path d="M-36,0 A36,36 0 1,1 36,0" stroke="#A78BFA" stroke-width="6" opacity="0.6"/>
    <path d="M-24,0 A24,24 0 1,1 24,0" stroke="#7C3AED" stroke-width="5" opacity="0.75"/>
    <path d="M-14,0 A14,14 0 1,1 14,0" stroke="#5B21B6" stroke-width="4" opacity="0.9"/>
    <circle cx="0" cy="0" r="4" fill="#5B21B6" opacity="0.85"/>
  </g>
  <!-- Progress bar -->
  <rect x="30" y="128" width="140" height="7" rx="3.5" fill="#EDE9FE"/>
  <rect x="30" y="128" width="60" height="7" rx="3.5" fill="#7C3AED"/>
  <!-- Label -->
  <text x="100" y="150" text-anchor="middle" font-family="Poppins, sans-serif" font-size="11" font-weight="500" fill="#6B7280">Revealing…</text>
</svg>`;
}

function illBuzz() {
    return `<svg class="htp-ill" viewBox="0 0 200 155" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Glow behind button -->
  <ellipse cx="100" cy="95" rx="70" ry="22" fill="#7C3AED" opacity="0.10"/>
  <!-- Buzz button body -->
  <rect x="20" y="60" width="160" height="60" rx="16" fill="url(#buzzGrad)"/>
  <defs>
    <linearGradient id="buzzGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7C3AED"/>
      <stop offset="100%" stop-color="#EC4899"/>
    </linearGradient>
  </defs>
  <!-- Button label -->
  <text x="100" y="97" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="24" font-weight="700" fill="#fff" letter-spacing="1">BUZZ IN</text>
  <!-- Tap hint -->
  <text x="100" y="140" text-anchor="middle" font-family="Poppins, sans-serif" font-size="11" fill="#6B7280">Tap the moment you know!</text>
  <!-- Lightning bolts -->
  <text x="34" y="72" font-size="14" font-family="sans-serif" opacity="0.7">⚡</text>
  <text x="152" y="72" font-size="14" font-family="sans-serif" opacity="0.7">⚡</text>
  <!-- Finger pressing -->
  <text x="100" y="52" text-anchor="middle" font-size="22" font-family="sans-serif">👇</text>
</svg>`;
}

function illAward() {
    return `<svg class="htp-ill" viewBox="0 0 200 155" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Team A card (dimmed) -->
  <rect x="10" y="30" width="82" height="68" rx="12" fill="#EDE9FE"/>
  <text x="51" y="58" text-anchor="middle" font-family="Poppins, sans-serif" font-size="10" font-weight="600" fill="#8B5CF6">Team A</text>
  <text x="51" y="77" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="22" font-weight="700" fill="#7C3AED">200</text>
  <!-- Team B card (winner highlight) -->
  <rect x="108" y="22" width="82" height="76" rx="12" fill="#7C3AED"/>
  <rect x="108" y="22" width="82" height="76" rx="12" fill="none" stroke="#5B21B6" stroke-width="2"/>
  <text x="149" y="52" text-anchor="middle" font-family="Poppins, sans-serif" font-size="10" font-weight="600" fill="#EDE9FE">Team B</text>
  <text x="149" y="72" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="22" font-weight="700" fill="#fff">350</text>
  <!-- +points badge -->
  <rect x="122" y="10" width="54" height="22" rx="11" fill="#EC4899"/>
  <text x="149" y="25" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="13" font-weight="700" fill="#fff">+150</text>
  <!-- GM star badge -->
  <text x="100" y="123" text-anchor="middle" font-family="Poppins, sans-serif" font-size="11" fill="#6B7280">GM awards the points ⭐</text>
</svg>`;
}

function illComplete() {
    const cols = 5, rows = 3;
    const tW = 32, tH = 24, gap = 5;
    const totalW = cols * tW + (cols - 1) * gap;
    const vW = totalW + 20, vH = rows * tH + (rows - 1) * gap + 58;

    let tiles = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = 10 + c * (tW + gap);
            const y = 36 + r * (tH + gap);
            tiles += `<rect x="${x}" y="${y}" width="${tW}" height="${tH}" rx="5" fill="#DCFCE7" stroke="#86EFAC" stroke-width="1.2"/>`;
            const cx = x + tW / 2, cy = y + tH / 2 + 4;
            tiles += `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="12">✓</text>`;
        }
    }

    return `<svg class="htp-ill" viewBox="0 0 ${vW} ${vH}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  ${Array.from({ length: cols }, (_, c) => {
        const cx = 10 + c * (tW + gap) + tW / 2;
        return `<rect x="${10 + c * (tW + gap)}" y="10" width="${tW}" height="18" rx="4" fill="#F5F3FF"/>
    <text x="${cx}" y="22" text-anchor="middle" font-family="Poppins, sans-serif" font-size="7" font-weight="600" fill="#6B7280">Cat ${c + 1}</text>`;
    }).join('')}
  ${tiles}
  <text x="${vW / 2}" y="${vH - 6}" text-anchor="middle" font-family="Poppins, sans-serif" font-size="11" font-weight="600" fill="#16A34A">Board complete! 🏆</text>
</svg>`;
}

// ─── Open ────────────────────────────────────────────────────────────────────

export function openHowToPlay({ context = 'game', onStartNewGame, onJoinGame } = {}) {
    let step = 0;
    const prevFocus = document.activeElement;

    // iOS-safe scroll lock: position:fixed trick prevents momentum scroll on body
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    // ─── Build shell ──────────────────────────────────────────────────────────

    const overlay = el('div', {
        class: 'htp-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'How to Play',
    });

    const card = el('div', { class: 'htp-card' });
    overlay.appendChild(card);

    // Header
    const header = el('div', { class: 'htp-header' });
    const headerTitle = el('h2', { class: 'htp-header-title', text: 'How to Play' });
    const closeBtn = el('button', {
        class: 'htp-close',
        type: 'button',
        'aria-label': 'Close How to Play',
    }, [
        svgX(),
    ]);
    header.append(headerTitle, closeBtn);
    card.appendChild(header);

    // Body
    const body = el('div', { class: 'htp-body' });
    card.appendChild(body);

    // Dots
    const dotsRow = el('div', { class: 'htp-dots', 'aria-hidden': 'true' });
    for (let i = 0; i < TOTAL_STEPS; i++) {
        const dot = el('button', { class: 'htp-dot', type: 'button', 'aria-label': `Step ${i + 1}` });
        dot.dataset.step = String(i);
        dotsRow.appendChild(dot);
    }
    card.appendChild(dotsRow);

    // Footer
    const footer = el('div', { class: 'htp-footer' });
    const navRow = el('div', { class: 'htp-nav' });
    const backBtn = el('button', { class: 'htp-btn is-ghost', type: 'button', text: 'Back' });
    const nextBtn = el('button', { class: 'htp-btn is-primary', type: 'button', text: 'Next' });
    navRow.append(backBtn, nextBtn);
    footer.appendChild(navRow);
    card.appendChild(footer);

    // ─── Render a step ────────────────────────────────────────────────────────

    function renderStep() {
        const data = STEPS[step];

        // Illustration + text
        body.innerHTML = '';
        const illWrap = el('div', { class: 'htp-illustration', 'aria-hidden': 'true' });
        illWrap.innerHTML = buildIllustration(step);
        const title = el('h3', { class: 'htp-step-title', text: data.title });
        const desc = el('p', { class: 'htp-step-body', text: data.body });
        body.append(illWrap, title, desc);

        // Dots
        dotsRow.querySelectorAll('.htp-dot').forEach((dot, i) => {
            dot.classList.toggle('is-active', i === step);
        });

        const isLast = step === TOTAL_STEPS - 1;
        backBtn.disabled = (step === 0);
        backBtn.className = 'htp-btn is-ghost';
        backBtn.textContent = 'Back';

        // Rebuild nav row contents for this step
        navRow.style.flexDirection = '';
        navRow.innerHTML = '';  // detaches children; we re-append what's needed below

        if (!isLast) {
            navRow.append(backBtn, nextBtn);
        } else if (context === 'home') {
            const startBtn = el('button', { class: 'htp-btn is-primary', type: 'button', text: 'Start New Game' });
            const joinBtn  = el('button', { class: 'htp-btn is-secondary', type: 'button', text: 'Join Game' });
            startBtn.addEventListener('click', () => { close(); onStartNewGame?.(); });
            joinBtn.addEventListener('click',  () => { close(); onJoinGame?.(); });
            navRow.style.flexDirection = 'column';
            navRow.append(startBtn, joinBtn, backBtn);
            backBtn.className = 'htp-btn is-ghost';
        } else {
            const doneBtn = el('button', { class: 'htp-btn is-primary', type: 'button', text: 'Back to Game' });
            doneBtn.addEventListener('click', close);
            navRow.append(backBtn, doneBtn);
        }
    }

    // ─── Navigation ───────────────────────────────────────────────────────────

    function goTo(n) {
        step = Math.max(0, Math.min(TOTAL_STEPS - 1, n));
        renderStep();
    }

    nextBtn.addEventListener('click', () => goTo(step + 1));
    backBtn.addEventListener('click', () => goTo(step - 1));

    dotsRow.addEventListener('click', (e) => {
        const dot = e.target.closest('.htp-dot');
        if (dot) goTo(Number(dot.dataset.step));
    });

    // ─── Close ────────────────────────────────────────────────────────────────

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onKeyDown);
        // Restore scroll (matches iOS-safe lock applied on open)
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
        try { if (prevFocus?.focus) prevFocus.focus(); } catch (_) {}
    }

    closeBtn.addEventListener('click', close);

    // Click backdrop to close
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // ─── Keyboard ─────────────────────────────────────────────────────────────

    function onKeyDown(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); goTo(step + 1); }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(step - 1); }
    }
    document.addEventListener('keydown', onKeyDown);

    // ─── Swipe ────────────────────────────────────────────────────────────────

    let touchStartX = 0;
    card.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
    }, { passive: true });
    card.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 48) goTo(dx < 0 ? step + 1 : step - 1);
    }, { passive: true });

    // ─── Mount ────────────────────────────────────────────────────────────────

    renderStep();
    document.body.appendChild(overlay);
    closeBtn.focus();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function svgX() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const l1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l1.setAttribute('x1', '18'); l1.setAttribute('y1', '6'); l1.setAttribute('x2', '6'); l1.setAttribute('y2', '18');
    const l2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l2.setAttribute('x1', '6'); l2.setAttribute('y1', '6'); l2.setAttribute('x2', '18'); l2.setAttribute('y2', '18');
    svg.append(l1, l2);
    return svg;
}
