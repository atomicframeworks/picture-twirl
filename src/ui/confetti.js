// src/ui/confetti.js
//
// Tiny dependency-free confetti burst on a fixed full-screen canvas.
// Respects prefers-reduced-motion. Call burstConfetti() to celebrate.

let canvas = null;
let ctx = null;
let raf = null;
let particles = [];

const COLORS = ['#7C3AED', '#EC4899', '#06B6D4', '#F59E0B', '#84CC16', '#A855F7'];

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
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

/**
 * Fire a confetti burst.
 * @param {{ count?: number, originX?: number, originY?: number }} [opts]
 *        originX/Y are 0..1 fractions of the viewport.
 */
export function burstConfetti({ count = 130, originX = 0.5, originY = 0.4 } = {}) {
    if (typeof document === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    ensureCanvas();

    const ox = originX * canvas.width;
    const oy = originY * canvas.height;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 9;
        particles.push({
            x: ox, y: oy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 5,
            size: 5 + Math.random() * 7,
            color: COLORS[(Math.random() * COLORS.length) | 0],
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.3,
            life: 1,
        });
    }
    if (!raf) raf = requestAnimationFrame(tick);
}

function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0 && p.y < canvas.height + 40);
    for (const p of particles) {
        p.vy += 0.25;          // gravity
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.011;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
    }
    if (particles.length) {
        raf = requestAnimationFrame(tick);
    } else {
        raf = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}
