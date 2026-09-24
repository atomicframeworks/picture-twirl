// src/ui/confetti.js
//
// Twirl Burst v2 — Picture Twirl branded celebration.
// Three explicitly staged animation: TWIRL → BURST → FLOAT.
//
// TWIRL  (~730ms): particles orbit around the winner area using a real polar model
//                  (angle changes per frame, radius expands). The viewer sees an
//                  orbiting ring — not just particles moving "sort of sideways."
// BURST  (~167ms): particles release outward as the spiral opens up.
// FLOAT  (~1.1s):  gentle gravity, drag, slow rotation, and fade.
//
// Shapes (weighted toward Picture Twirl-specific):
//   40% swirl arc ribbons  — thick curved strokes, 90°–160° span
//   25% 4-point stars      — spark / sparkle silhouette
//   20% tall diamonds      — classic confetti diamond, clearly readable
//   15% circles            — supporting filler
//
// No dependencies. Respects prefers-reduced-motion.

const COLORS = [
    '#7C3AED', // --brand-1 violet
    '#EC4899', // --brand-2 pink
    '#F59E0B', // --accent-amber orange
    '#A855F7', // lighter purple
    '#FDF2F8', // pale blush — contrast accent
];

// Weighted shape picker: arcs dominate because they're the signature shape.
function pickShape() {
    const r = Math.random();
    if (r < 0.40) return 'arc';
    if (r < 0.65) return 'star';
    if (r < 0.85) return 'diamond';
    return 'circle';
}

let canvas = null;
let ctx    = null;
let raf    = null;
let particles = [];

// Reduced-motion fallback: inject once, then add/remove a class.
let cssInjected = false;
function injectFallbackCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const s = document.createElement('style');
    s.textContent = `
        @keyframes pt-winner-pulse {
            0%   { box-shadow: 0 0 0  0   rgba(124,58,237,.00); }
            40%  { box-shadow: 0 0 0 28px rgba(124,58,237,.30); }
            100% { box-shadow: 0 0 0 56px rgba(124,58,237,.00); }
        }
        .is-twirl-burst { animation: pt-winner-pulse 1s ease-out forwards; }
    `;
    document.head.appendChild(s);
}

function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'pt-confetti';
    canvas.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
}

function resize() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}

/**
 * Spawn one wave of Twirl Burst particles.
 *
 * @param {number} count         — number of particles
 * @param {number} originX       — 0..1 viewport fraction
 * @param {number} originY       — 0..1 viewport fraction
 * @param {number} twirlFrames   — frames to spend in orbital phase (controls twirl duration)
 */
function spawnWave({ count = 22, originX = 0.5, originY = 0.35, twirlFrames = 44 } = {}) {
    ensureCanvas();
    const ox = originX * canvas.width;
    const oy = originY * canvas.height;
    const BURST_FRAMES = 10;

    for (let i = 0; i < count; i++) {
        // Evenly distribute starting angles so particles form a visible ring, not a cloud.
        const startAngle  = (i / count) * Math.PI * 2;
        const startRadius = 16 + Math.random() * 18;       // 16–34 px — starts close
        const endRadius   = 70 + Math.random() * 65;       // 70–135 px at burst release

        // Angular velocity giving ~140–210° of orbital travel during the twirl stage.
        // That's clearly perceivable as "orbiting" rather than "moving sideways."
        // Alternating CW / CCW (even/odd i) makes the ring look like a spinning pinwheel.
        const angSpeed   = 0.055 + Math.random() * 0.030;  // 0.055–0.085 rad/frame
        const angularVel = angSpeed * (i % 2 === 0 ? 1 : -1);

        // How much radius grows each frame during TWIRL.
        const radiusGrowth = (endRadius - startRadius) / twirlFrames;

        // Speed at which the particle flies outward after the twirl ends.
        const burstSpeed = 3.0 + Math.random() * 5.0;

        particles.push({
            // Origin used as the orbital pivot.
            ox, oy,

            // Current screen position (starts on the ring at startRadius).
            x: ox + Math.cos(startAngle) * startRadius,
            y: oy + Math.sin(startAngle) * startRadius,

            // Orbital state (used during TWIRL).
            orbitAngle: startAngle,
            angularVel,
            orbitRadius: startRadius,
            radiusGrowth,

            // Phase bookkeeping.
            phase:        'twirl',
            twirl_frame:  0,
            twirlFrames,
            burst_frame:  0,
            BURST_FRAMES,
            burstSpeed,

            // Cartesian velocity (filled in at TWIRL → BURST transition).
            vx: 0,
            vy: 0,

            // Appearance — large enough that shape silhouettes are readable at gameplay scale.
            size:  9 + Math.random() * 10,        // 9–19 px
            color: COLORS[(Math.random() * COLORS.length) | 0],
            rot:   Math.random() * Math.PI * 2,
            vr:    (Math.random() - 0.5) * 0.09,  // slow independent spin
            life:  1,
            shape: pickShape(),

            // Arc-specific: long ribbon span (90°–160°) with random start orientation.
            arcStart: Math.random() * Math.PI * 2,
            arcSpan:  Math.PI * (0.50 + Math.random() * 0.39),
        });
    }

    if (!raf) raf = requestAnimationFrame(tick);
}

function drawParticle(p) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.beginPath();

    switch (p.shape) {
        case 'circle':
            ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            break;

        case 'diamond': {
            const w = p.size * 0.62, h = p.size;
            ctx.moveTo(0, -h);
            ctx.lineTo(w,  0);
            ctx.lineTo(0,  h);
            ctx.lineTo(-w, 0);
            ctx.closePath();
            ctx.fillStyle = p.color;
            ctx.fill();
            break;
        }

        case 'star': {
            // 4-point star / spark — outer:inner ratio of 3:1 gives a sharp, distinct silhouette.
            const r1 = p.size * 0.95, r2 = p.size * 0.30;
            for (let j = 0; j < 8; j++) {
                const a = (j / 8) * Math.PI * 2 - Math.PI / 4;
                const r = j % 2 === 0 ? r1 : r2;
                if (j === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
                else         ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.fillStyle = p.color;
            ctx.fill();
            break;
        }

        case 'arc':
            // Signature "twirl" shape: thick curved ribbon arc with round caps.
            // Radius and lineWidth scale with size so the arc is clearly readable.
            ctx.arc(0, 0, p.size * 1.15, p.arcStart, p.arcStart + p.arcSpan);
            ctx.strokeStyle = p.color;
            ctx.lineWidth   = p.size * 0.62;
            ctx.lineCap     = 'round';
            ctx.stroke();
            break;
    }

    ctx.restore();
}

function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0.02 && p.y < canvas.height + 80);

    for (const p of particles) {
        if (p.phase === 'twirl') {
            // ── TWIRL ──────────────────────────────────────────────────────
            // True polar orbit: advance angle + expand radius each frame.
            p.orbitAngle  += p.angularVel;
            p.orbitRadius += p.radiusGrowth;
            p.x = p.ox + Math.cos(p.orbitAngle) * p.orbitRadius;
            p.y = p.oy + Math.sin(p.orbitAngle) * p.orbitRadius;
            p.rot   += p.vr;
            p.life  -= 0.001;    // barely any fade — shapes stay fully visible during orbit
            p.twirl_frame++;

            if (p.twirl_frame >= p.twirlFrames) {
                // Transition: convert orbital state to Cartesian velocity.
                // Radial component (outward) + tangential component (preserves swirl momentum)
                // so the burst feels like the spiral opening up rather than an abrupt change.
                const s   = Math.sign(p.angularVel);
                const cos = Math.cos(p.orbitAngle);
                const sin = Math.sin(p.orbitAngle);
                p.vx = cos * p.burstSpeed + (-sin) * s * 2.0;
                p.vy = sin * p.burstSpeed + ( cos) * s * 2.0;
                p.phase = 'burst';
            }

        } else if (p.phase === 'burst') {
            // ── BURST ──────────────────────────────────────────────────────
            // Short outward acceleration — the spiral opens up.
            p.x   += p.vx;
            p.y   += p.vy;
            p.rot += p.vr;
            p.life -= 0.006;
            p.burst_frame++;
            if (p.burst_frame >= p.BURST_FRAMES) p.phase = 'float';

        } else {
            // ── FLOAT ──────────────────────────────────────────────────────
            // Gentle gravity + light drag + fade.
            p.vy  += 0.20;
            p.vx  *= 0.986;
            p.vy  *= 0.986;
            p.x   += p.vx;
            p.y   += p.vy;
            p.rot += p.vr;
            p.life -= 0.013;
        }

        drawParticle(p);
    }

    if (particles.length) {
        raf = requestAnimationFrame(tick);
    } else {
        raf = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

/**
 * Single Twirl Burst. Used for mid-game point-award celebrations.
 * Shorter twirl stage (~400ms) so it doesn't linger while gameplay continues.
 *
 * @param {{ count?: number, originX?: number, originY?: number }} [opts]
 */
export function burstConfetti({ count = 20, originX = 0.5, originY = 0.4 } = {}) {
    if (typeof document === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    spawnWave({ count, originX, originY, twirlFrames: 24 }); // ~400ms twirl
}

/**
 * Full Twirl Burst for the finale winner reveal.
 * Three staggered waves: 22 + 12 + 8 = 42 particles total.
 * Each wave runs the full TWIRL → BURST → FLOAT sequence independently.
 *
 * Reduced-motion: skips all particles; pulses a soft glow on the winner card instead.
 *
 * @param {number} [originX=0.5] — 0..1 viewport fraction; caller passes winner's side
 */
export function burstCelebration(originX = 0.5) {
    if (typeof document === 'undefined') return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        injectFallbackCSS();
        const winner = document.querySelector('.finale-s--winner');
        if (winner) {
            winner.classList.remove('is-twirl-burst');
            void winner.offsetWidth;  // force reflow so animation restarts cleanly
            winner.classList.add('is-twirl-burst');
            setTimeout(() => winner.classList.remove('is-twirl-burst'), 1100);
        }
        return;
    }

    // Wave 1 — main burst on the winner's side; longest twirl so it's clearly perceivable.
    spawnWave({ count: 22, originX,          originY: 0.30, twirlFrames: 44 });
    // Wave 2 — counter-side; slightly faster twirl for visual variety.
    setTimeout(() => spawnWave({ count: 12, originX: 1 - originX, originY: 0.22, twirlFrames: 36 }), 500);
    // Wave 3 — small central sparkle; quick twirl so it wraps up cleanly.
    setTimeout(() => spawnWave({ count:  8, originX: 0.5,         originY: 0.40, twirlFrames: 28 }), 950);
}
