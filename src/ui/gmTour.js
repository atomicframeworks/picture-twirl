// src/ui/gmTour.js
// GM Quick Start — spotlight tour engine.
// openGMTour({ steps, scrollContainer, onComplete, onSkip }) → close()
//
// step shape:
//   {
//     targetEl?:         Element | Element[],  // spotlight + anchor (legacy / single-target)
//     spotlightTargets?: Element[],            // explicit multi-hole targets (overrides targetEl for holes)
//     anchorEl?:         Element,              // card positions toward this; defaults to first spotlight target
//     title, body, caution?, isPillStep?, gmUid?
//   }

import { el } from './dom.js';

const SVG_NS  = 'http://www.w3.org/2000/svg';
const MASK_ID = 'gmt-scrim-mask'; // one tour at a time — no id collision risk
const PAD     = 8;   // px padding around each spotlight hole
const GAP     = 14;  // px gap from spotlight edge to card
const MARGIN  = 12;  // min px from viewport edge to card

export function openGMTour({ steps, scrollContainer, onComplete, onSkip }) {
    if (!steps || !steps.length) return () => {};

    let stepIndex      = 0;
    let liveSteps      = steps.slice();
    let pillObserver   = null;
    let resizeObserver = null;
    let scrollTimer    = null;
    let rafId          = null;
    let closed         = false;
    let cardHasAppeared = false;
    let scrollFrozen    = false;

    const prevFocus = document.activeElement;
    const lobbyRoot = document.querySelector('.lobby-root');

    // ── Block lobby interaction ──────────────────────────────────────────────
    const inertSupported  = 'inert' in HTMLElement.prototype;
    const savedTabIndices = [];
    if (lobbyRoot) {
        if (inertSupported) {
            lobbyRoot.inert = true;
        } else {
            lobbyRoot
                .querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')
                .forEach(node => {
                    savedTabIndices.push({ node, ti: node.getAttribute('tabindex') });
                    node.setAttribute('tabindex', '-1');
                });
        }
    }

    // ── Overlay ──────────────────────────────────────────────────────────────
    const overlay = el('div', { class: 'gmt-overlay', 'aria-hidden': 'true' });

    // ── SVG scrim — multiple independent spotlight holes via mask ────────────
    // Technique: mask is white everywhere (scrim opaque) with black rects cut
    // out where targets are (black = transparent in SVG mask).
    const scrimSvg  = document.createElementNS(SVG_NS, 'svg');
    scrimSvg.setAttribute('class', 'gmt-scrim');
    scrimSvg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS(SVG_NS, 'defs');
    const mask = document.createElementNS(SVG_NS, 'mask');
    mask.setAttribute('id', MASK_ID);

    const maskBg = document.createElementNS(SVG_NS, 'rect');
    maskBg.setAttribute('width', '100%');
    maskBg.setAttribute('height', '100%');
    maskBg.setAttribute('fill', 'white');
    mask.appendChild(maskBg);

    const scrimFill = document.createElementNS(SVG_NS, 'rect');
    scrimFill.setAttribute('width', '100%');
    scrimFill.setAttribute('height', '100%');
    scrimFill.setAttribute('fill', '#1e1b2e');
    scrimFill.setAttribute('fill-opacity', '0.72');
    scrimFill.setAttribute('mask', `url(#${MASK_ID})`);

    defs.appendChild(mask);
    scrimSvg.appendChild(defs);
    scrimSvg.appendChild(scrimFill);
    overlay.appendChild(scrimSvg);

    // ── Card ─────────────────────────────────────────────────────────────────
    const card = el('div', {
        class:             'gmt-card',
        role:              'dialog',
        'aria-modal':      'true',
        'aria-labelledby': 'gmt-heading',
    });
    card.style.opacity = '0'; // fades in on first appearance

    // Header: chip (left) + skip (right)
    const headerRow     = el('div',    { class: 'gmt-card-header' });
    const chipEl        = el('div',    { class: 'gmt-step-chip' });
    const skipHeaderBtn = el('button', { class: 'gmt-skip-header', type: 'button' });
    skipHeaderBtn.textContent = 'Skip tour';
    headerRow.append(chipEl, skipHeaderBtn);

    // Content
    const titleEl   = el('h3', { class: 'gmt-title', id: 'gmt-heading' });
    const bodyEl    = el('p',  { class: 'gmt-body' });
    const cautionEl = el('p',  { class: 'gmt-caution' });
    cautionEl.hidden = true;

    // Nav: [Back?] [spacer flex:1] [Next/Got it!]
    const navRow  = el('div',    { class: 'gmt-nav' });
    const backBtn = el('button', { class: 'gmt-btn is-ghost',   type: 'button' });
    backBtn.textContent = 'Back';
    const nextBtn = el('button', { class: 'gmt-btn is-primary', type: 'button' });
    nextBtn.textContent = 'Next';

    // Caret — absolute child, points toward anchor spotlight
    const caretEl = el('div', { class: 'gmt-caret' });
    caretEl.hidden = true;

    card.append(headerRow, titleEl, bodyEl, cautionEl, navRow, caretEl);
    overlay.appendChild(card);

    // Live region for screen readers (in body, not overlay)
    const announcer = el('div', {
        class:         'gmt-announce',
        role:          'status',
        'aria-live':   'polite',
        'aria-atomic': 'true',
    });

    document.body.appendChild(overlay);
    document.body.appendChild(announcer);

    // ── Button handlers ──────────────────────────────────────────────────────
    backBtn.addEventListener('click', () => {
        if (stepIndex > 0) activateStep(stepIndex - 1);
    });

    skipHeaderBtn.addEventListener('click', () => {
        onSkip?.();
        close();
    });

    nextBtn.addEventListener('click', () => {
        if (stepIndex >= liveSteps.length - 1) {
            onComplete?.();
            close();
        } else {
            activateStep(stepIndex + 1);
        }
    });

    // ── Keyboard ─────────────────────────────────────────────────────────────
    function onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            onComplete?.();
            close();
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const focusables = Array.from(card.querySelectorAll('button:not([disabled])'));
            if (!focusables.length) return;
            const cur  = focusables.indexOf(document.activeElement);
            const next = e.shiftKey
                ? (cur <= 0 ? focusables.length - 1 : cur - 1)
                : (cur >= focusables.length - 1 ? 0 : cur + 1);
            focusables[next].focus();
        }
    }
    document.addEventListener('keydown', onKeyDown);

    // ── Freeze actual scroll surfaces ────────────────────────────────────────
    // Freeze the lobby's real scroll containers at the CSS level.
    // Event-based preventDefault is not reliable for GPU-composited scroll
    // containers on macOS Chrome/Safari; overflow:hidden is compositor-aware
    // and works uniformly across platforms and scroll owners.
    const lobbyMain          = scrollContainer || document.querySelector('.lobby-main');
    const savedLobbyOverflow = lobbyMain ? lobbyMain.style.overflowY : null;
    const savedDocOverflow   = document.documentElement.style.overflowY;
    if (lobbyMain) lobbyMain.style.overflowY = 'hidden';
    document.documentElement.style.overflowY = 'hidden';
    scrollFrozen = true;

    // ── Close ────────────────────────────────────────────────────────────────
    function close() {
        if (closed) return;
        closed = true;

        disconnectPillObserver();
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        window.removeEventListener('orientationchange', onOrientationChange);
        document.removeEventListener('keydown', onKeyDown);
        scrollFrozen = false;
        if (lobbyMain && savedLobbyOverflow !== null) lobbyMain.style.overflowY = savedLobbyOverflow;
        document.documentElement.style.overflowY = savedDocOverflow;
        clearTimeout(scrollTimer);
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

        overlay.remove();
        announcer.remove();

        if (lobbyRoot) {
            if (inertSupported) {
                lobbyRoot.inert = false;
            } else {
                savedTabIndices.forEach(({ node, ti }) => {
                    if (ti === null) node.removeAttribute('tabindex');
                    else node.setAttribute('tabindex', ti);
                });
            }
        }

        try {
            if (prevFocus && prevFocus !== document.body && document.contains(prevFocus)) {
                prevFocus.focus({ preventScroll: true });
            } else {
                const fallback =
                    document.querySelector('.lobby-root [data-ref="helpBtn"]') ||
                    document.querySelector('.lobby-root [data-ref="gmStart"]');
                if (fallback) fallback.focus({ preventScroll: true });
            }
        } catch (_) {}
    }

    // ── Step shape helpers ────────────────────────────────────────────────────
    // Which elements get spotlight holes (may be multiple)
    function getSpotlightTargets(step) {
        const raw = step.spotlightTargets
            ? step.spotlightTargets
            : (Array.isArray(step.targetEl) ? step.targetEl : [step.targetEl]);
        return raw.filter(t => t && document.contains(t));
    }

    // Which rect the card and caret orient toward (always one element)
    function getAnchorRect(step) {
        const anchor = step.anchorEl;
        if (anchor && document.contains(anchor)) return flatRect(anchor.getBoundingClientRect());
        const targets = getSpotlightTargets(step);
        if (targets.length) return flatRect(targets[0].getBoundingClientRect());
        return null;
    }

    function flatRect(r) {
        return { top: r.top, left: r.left, bottom: r.bottom, right: r.right,
                 width: r.width, height: r.height };
    }

    // ── Step activation ──────────────────────────────────────────────────────
    function activateStep(i) {
        if (closed) return;
        disconnectPillObserver();

        if (!liveSteps.length) { close(); return; }
        i = Math.max(0, Math.min(i, liveSteps.length - 1));
        stepIndex = i;

        const step = liveSteps[i];

        // Guard: if this is a dynamic pill step whose target is no longer in the
        // document, retarget first — never render UI for a zombie step.
        if (step.isPillStep) {
            const pillEl = Array.isArray(step.targetEl) ? step.targetEl[0] : step.targetEl;
            if (!pillEl || !document.contains(pillEl)) {
                retargetOrRemovePillStep();
                return;
            }
        }

        const isFirst = i === 0;
        const isLast  = i === liveSteps.length - 1;

        chipEl.textContent  = `Step ${i + 1} of ${liveSteps.length}`;
        titleEl.textContent = step.title;
        bodyEl.textContent  = step.body;

        if (step.caution) {
            cautionEl.textContent = step.caution;
            cautionEl.hidden = false;
        } else {
            cautionEl.hidden = true;
        }

        // Skip: visible in header on all steps except the final one
        skipHeaderBtn.hidden = isLast;

        // Nav: spacer always present so Next stays right-aligned on step 1
        navRow.innerHTML = '';
        if (!isFirst) navRow.appendChild(backBtn);
        const sp = document.createElement('span');
        sp.style.flex = '1';
        navRow.appendChild(sp);
        nextBtn.textContent = isLast ? 'Got it!' : 'Next';
        navRow.appendChild(nextBtn);

        announcer.textContent = '';
        requestAnimationFrame(() => {
            announcer.textContent =
                `GM Quick Start — Step ${i + 1} of ${liveSteps.length}: ${step.title}`;
        });

        scrollIfNeeded(step, () => {
            updateGeometry(step);
            nextBtn.focus();
            if (step.isPillStep) watchPill(step);
        });
    }

    // ── Spotlight holes ───────────────────────────────────────────────────────
    // Each target element gets its own black rect in the SVG mask.
    // The scrim is opaque where mask is white; transparent where mask is black.
    function updateSpotlightHoles(targets) {
        Array.from(mask.querySelectorAll('.gmt-hole')).forEach(r => r.remove());

        // Usable bottom boundary = top of sticky actions tray, not window.innerHeight.
        // Team cards inside .lobby-main can be partially covered by the tray on small
        // viewports; holes that extend below trayTop would punch through it visually.
        const trayEl  = document.querySelector('.actions-tray');
        const trayTop = trayEl ? trayEl.getBoundingClientRect().top : window.innerHeight;

        targets.forEach(el => {
            const r = el.getBoundingClientRect();
            // Team cards: only spotlight if the entire card (plus PAD) sits above the tray.
            if (el.classList.contains('team-card')) {
                if (!(r.top >= 0 && r.bottom + PAD <= trayTop)) return;
            }
            const hole = document.createElementNS(SVG_NS, 'rect');
            hole.setAttribute('class',  'gmt-hole');
            hole.setAttribute('x',      String(r.left   - PAD));
            hole.setAttribute('y',      String(r.top    - PAD));
            hole.setAttribute('width',  String(r.width  + PAD * 2));
            hole.setAttribute('height', String(r.height + PAD * 2));
            hole.setAttribute('rx',     '10');
            hole.setAttribute('fill',   'black');
            mask.appendChild(hole);
        });
    }

    // ── Geometry ─────────────────────────────────────────────────────────────
    function updateGeometry(step) {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

        // Holes update synchronously (paint this frame)
        updateSpotlightHoles(getSpotlightTargets(step));

        // Card positions relative to the anchor only
        const anchorRect = getAnchorRect(step);
        if (!anchorRect) {
            caretEl.hidden = true;
            return;
        }

        card.style.top  = '-9999px';
        card.style.left = '-9999px';

        rafId = requestAnimationFrame(() => {
            rafId = null;
            const cw = card.offsetWidth;
            const ch = card.offsetHeight;

            const below = anchorRect.bottom + PAD + GAP;
            const above = anchorRect.top    - PAD - GAP - ch;

            let cardTop, placement;
            if (below + ch + MARGIN <= window.innerHeight) {
                cardTop   = below;
                placement = 'below';
            } else if (above >= MARGIN) {
                cardTop   = above;
                placement = 'above';
            } else {
                cardTop   = Math.max(MARGIN, window.innerHeight - ch - MARGIN);
                placement = 'fallback';
            }

            let cardLeft = anchorRect.left + anchorRect.width / 2 - cw / 2;
            cardLeft = Math.max(MARGIN, Math.min(cardLeft, window.innerWidth - cw - MARGIN));

            card.style.top  = `${cardTop}px`;
            card.style.left = `${cardLeft}px`;

            positionCaret(anchorRect, cardTop, cardLeft, cw, ch, placement);

            if (!cardHasAppeared) {
                cardHasAppeared = true;
                requestAnimationFrame(() => { card.style.opacity = '1'; });
            }
        });
    }

    // ── Caret ────────────────────────────────────────────────────────────────
    const CARET_W            = 16;
    const CARET_H            = 9;
    const CARET_CORNER_CLEAR = 22;

    function positionCaret(anchorRect, cardTop, cardLeft, cardW, cardH, placement) {
        if (placement === 'fallback') { caretEl.hidden = true; return; }

        caretEl.hidden = false;
        caretEl.removeAttribute('data-dir');

        if (placement === 'above') {
            caretEl.dataset.dir  = 'down';
            caretEl.style.top    = '';
            caretEl.style.bottom = `-${CARET_H}px`;
        } else {
            caretEl.dataset.dir  = 'up';
            caretEl.style.bottom = '';
            caretEl.style.top    = `-${CARET_H}px`;
        }

        const anchorMidX = anchorRect.left + anchorRect.width / 2;
        const halfW      = CARET_W / 2;
        const idealLeft  = anchorMidX - cardLeft - halfW;
        const minLeft    = CARET_CORNER_CLEAR - halfW;
        const maxLeft    = cardW - CARET_CORNER_CLEAR - halfW;
        caretEl.style.left = `${Math.max(minLeft, Math.min(idealLeft, maxLeft))}px`;
    }

    // ── Scroll ───────────────────────────────────────────────────────────────
    // Scroll toward the anchor only, not the union of all spotlight targets.
    // On mobile this avoids large scroll jumps when Step 2 has three tall cards.
    function scrollIfNeeded(step, callback) {
        clearTimeout(scrollTimer);
        // While the lobby is frozen all elements are stationary — measure
        // geometry immediately rather than attempting a background scroll.
        if (scrollFrozen) { callback(); return; }
        const rect = getAnchorRect(step);
        if (!rect) { callback(); return; }

        const margin = 80;
        const needsScroll = rect.top < margin || rect.bottom > window.innerHeight - margin;
        if (!needsScroll) { callback(); return; }

        const reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const behavior = reduced ? 'instant' : 'smooth';
        const delta    = (rect.top + rect.height / 2) - window.innerHeight / 2;

        const sc = resolveScrollContainer();
        if (sc === window) {
            window.scrollBy({ top: delta, behavior });
        } else {
            sc.scrollBy({ top: delta, behavior });
        }

        scrollTimer = setTimeout(callback, reduced ? 16 : 320);
    }

    function resolveScrollContainer() {
        if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight) {
            return scrollContainer;
        }
        const lm = document.querySelector('.lobby-main');
        if (lm && lm.scrollHeight > lm.clientHeight) return lm;
        return window;
    }

    // ── Pill observer (step 3 conditional) ───────────────────────────────────
    function watchPill(step) {
        const pillEl = Array.isArray(step.targetEl) ? step.targetEl[0] : step.targetEl;
        if (!pillEl) return;
        // If renderList replaced the pill DOM node between buildLobbySteps() and
        // this call, the stored reference is already orphaned. Retarget immediately
        // rather than silently returning with no observer.
        if (!document.contains(pillEl)) {
            disconnectPillObserver();
            retargetOrRemovePillStep();
            return;
        }
        const parent = pillEl.parentElement;
        if (!parent) return;
        pillObserver = new MutationObserver(() => {
            if (!document.contains(pillEl)) {
                disconnectPillObserver();
                retargetOrRemovePillStep();
            }
        });
        pillObserver.observe(parent, { childList: true });
    }

    function retargetOrRemovePillStep() {
        if (closed) return;
        const step3idx = liveSteps.findIndex(s => s.isPillStep);
        if (step3idx === -1) return;

        const gmUid  = liveSteps[step3idx].gmUid;
        const newPill = findNonGmPill(gmUid);

        if (newPill) {
            liveSteps[step3idx] = { ...liveSteps[step3idx], targetEl: newPill };
            if (stepIndex === step3idx) {
                updateGeometry(liveSteps[step3idx]);
                watchPill(liveSteps[step3idx]);
            }
        } else {
            liveSteps.splice(step3idx, 1);
            // Normalize stepIndex after splice:
            //   step removed before current → shift current index down by 1
            //   step removed at current     → stay at same position (now points to next step)
            //   step removed after current  → current is unaffected
            const targetIdx = step3idx < stepIndex ? stepIndex - 1 : stepIndex;
            activateStep(targetIdx);
        }
    }

    function findNonGmPill(gmUid) {
        const root  = lobbyRoot || document;
        const pills = root.querySelectorAll('.pill.is-clickable[data-pid]');
        for (const pill of pills) {
            if (pill.getAttribute('data-pid') !== gmUid) return pill;
        }
        return null;
    }

    function disconnectPillObserver() {
        if (pillObserver) { pillObserver.disconnect(); pillObserver = null; }
    }

    // ── Resize / orientation ─────────────────────────────────────────────────
    resizeObserver = new ResizeObserver(debounce(() => {
        if (!closed && liveSteps[stepIndex]) updateGeometry(liveSteps[stepIndex]);
    }, 100));
    resizeObserver.observe(document.body);

    function onOrientationChange() {
        setTimeout(() => {
            if (!closed && liveSteps[stepIndex]) updateGeometry(liveSteps[stepIndex]);
        }, 350);
    }
    window.addEventListener('orientationchange', onOrientationChange);

    // ── Go ───────────────────────────────────────────────────────────────────
    activateStep(0);

    return close;
}

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
