/**
 * Canvas swirl animation: progressively "unswirls" an image over `duration` ms.
 *
 * Device-independence guarantees (see REFACTOR.md §4.5):
 *  - All pixel work happens at a capped *working* resolution (long edge ≤
 *    MAX_WORKING_PX). Source images can be anything — one set ships a
 *    6000×4269 jpeg — and running the per-pixel loop at native size takes
 *    seconds per frame on a phone and can blow past mobile canvas memory limits.
 *  - The visible canvas never shows the clear picture before the first swirled
 *    frame: pixels are sampled from an offscreen canvas and the first frame is
 *    drawn synchronously at `elapsedStart`.
 *  - Exactly one animation loop runs at a time. pause() stops requesting frames
 *    and resume() restarts the loop, so cancel() always cancels everything.
 */

/** Long-edge cap for the working canvas. The canvas is CSS-scaled to the stage anyway. */
export const MAX_WORKING_PX = 720;

/** Working canvas size for an image: scaled down (never up) so the long edge ≤ MAX_WORKING_PX. */
export function workingSize(imgEl) {
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    const scale = Math.min(1, MAX_WORKING_PX / Math.max(w, h));
    return {
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
    };
}

/**
 * Layout for a square working canvas with the image drawn `contain`-style.
 * The canvas side equals the long edge of the working size (never exceeds MAX_WORKING_PX).
 * Letterbox offsets center the image; transparent pixels outside it show the container bg.
 */
function containLayout(imgEl) {
    const { width: iw, height: ih } = workingSize(imgEl);
    const size = Math.max(iw, ih); // square side = long edge (already ≤ MAX_WORKING_PX)
    const offsetX = Math.round((size - iw) / 2);
    const offsetY = Math.round((size - ih) / 2);
    return { size, drawW: iw, drawH: ih, offsetX, offsetY };
}

/** Draw the clear image onto a square canvas with contain-style letterboxing (answer reveal). */
export function drawUnswirled(imgEl, canvasEl) {
    if (!imgEl?.naturalWidth || !canvasEl) return;
    const { size, drawW, drawH, offsetX, offsetY } = containLayout(imgEl);
    canvasEl.width = size;
    canvasEl.height = size;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(imgEl, offsetX, offsetY, drawW, drawH);
}

/**
 * Starts a swirl animation on a canvas from a given image.
 *
 * @param {HTMLImageElement} imgEl - Source image (must be loaded)
 * @param {HTMLCanvasElement} canvasEl - Canvas to draw on
 * @param {number} duration - Total swirl duration in ms
 * @param {number} maxSwirl - Swirl strength, 1 (gentle) to 10 (extreme)
 * @param {number} [elapsedStart=0] - Elapsed time in ms already spent (server-aligned sync)
 * @param {(progress: number) => void} [onProgress] - Called each frame with progress 0..1
 * @returns {{pause: Function, resume: Function, cancel: Function, isPaused: Function}} Control object
 */
export function startSwirlAnimation(imgEl, canvasEl, duration = 7000, maxSwirl = 3.0, elapsedStart = 0, onProgress) {
    const { size, drawW, drawH, offsetX, offsetY } = containLayout(imgEl);

    // Sample source pixels offscreen so the visible canvas never flashes the clear image.
    // Canvas is square (size × size); image is drawn centered with contain-style letterboxing.
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = size;
    srcCanvas.height = size;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(imgEl, offsetX, offsetY, drawW, drawH);
    const imageData = srcCtx.getImageData(0, 0, size, size);

    canvasEl.width = size;
    canvasEl.height = size;
    const ctx = canvasEl.getContext('2d');
    const output = ctx.createImageData(size, size); // reused every frame

    // Whole-pixel (RGBA) copies: 4× fewer writes, and PNG transparency is preserved.
    const src32 = new Uint32Array(imageData.data.buffer);
    const out32 = new Uint32Array(output.data.buffer);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2;

    // Per-pixel geometry is fixed for the whole animation; only the angle changes.
    // The angle depends solely on distance from centre, so quantise distance to
    // whole pixels and look cos/sin up from a small per-frame table instead of
    // calling Math.cos/Math.sin for every pixel.
    const count = size * size;
    const dxs = new Float32Array(count);
    const dys = new Float32Array(count);
    const distIdx = new Uint16Array(count);
    let maxDist = 0;
    for (let y = 0, i = 0; y < size; y++) {
        for (let x = 0; x < size; x++, i++) {
            const dx = x - centerX;
            const dy = y - centerY;
            dxs[i] = dx;
            dys[i] = dy;
            const d = Math.round(Math.sqrt(dx * dx + dy * dy));
            distIdx[i] = d;
            if (d > maxDist) maxDist = d;
        }
    }
    const cosT = new Float32Array(maxDist + 1);
    const sinT = new Float32Array(maxDist + 1);

    const swirlStrength = Math.max(1, Math.min(10, maxSwirl));
    const swirlBaseAngle = swirlStrength * Math.PI;

    function drawFrame(progress) {
        const k = swirlBaseAngle * (1 - progress);
        for (let d = 0; d <= maxDist; d++) {
            const angle = k * (1 - d / radius);
            cosT[d] = Math.cos(angle);
            sinT[d] = Math.sin(angle);
        }

        for (let i = 0; i < count; i++) {
            const dx = dxs[i];
            const dy = dys[i];
            const c = cosT[distIdx[i]];
            const s = sinT[distIdx[i]];
            const sx = Math.floor(centerX + dx * c - dy * s);
            const sy = Math.floor(centerY + dx * s + dy * c);

            out32[i] = (sx >= 0 && sx < size && sy >= 0 && sy < size)
                ? src32[sy * size + sx]
                : 0; // transparent — outside the source image
        }

        ctx.putImageData(output, 0, 0);
        if (typeof onProgress === 'function') onProgress(progress);
    }

    // Timeline (performance.now() based; rAF timestamps share the same origin).
    let startTime = performance.now() - elapsedStart;
    let pausedAt = null;
    let animationFrame = null;
    let cancelled = false;
    let done = false;

    function tick() {
        animationFrame = null;
        if (cancelled || pausedAt !== null) return;

        const progress = Math.min(1, (performance.now() - startTime) / duration);
        drawFrame(progress);

        if (progress < 1) {
            animationFrame = requestAnimationFrame(tick);
        } else {
            done = true;
        }
    }

    // First frame now, at the synced position — never a clear flash, never a blank gap.
    drawFrame(Math.min(1, elapsedStart / duration));
    if (elapsedStart < duration) {
        animationFrame = requestAnimationFrame(tick);
    } else {
        done = true;
    }

    return {
        pause() {
            if (pausedAt !== null || cancelled || done) return;
            pausedAt = performance.now();
            if (animationFrame !== null) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
        },
        resume() {
            if (pausedAt === null || cancelled || done) return;
            startTime += performance.now() - pausedAt;
            pausedAt = null;
            animationFrame = requestAnimationFrame(tick);
        },
        cancel() {
            cancelled = true;
            if (animationFrame !== null) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }
            ctx.putImageData(imageData, 0, 0); // Fully unswirled
        },
        isPaused() {
            return pausedAt !== null;
        }
    };
}
