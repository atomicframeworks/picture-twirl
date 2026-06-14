/**
 * Starts a swirl animation on a canvas from a given image.
 *
 * @param {HTMLImageElement} imgEl - Source image
 * @param {HTMLCanvasElement} canvasEl - Canvas to draw on
 * @param {number} duration - Total swirl duration in ms
 * @param {number} maxSwirl - Swirl strength, 1 (gentle) to 10 (extreme)
 * @param {number} [elapsedStart=0] - Optional elapsed time in ms to sync animation progress
 * @returns {{pause: Function, resume: Function, cancel: Function, isPaused: Function}} Control object for the animation
 */
export function startSwirlAnimation(imgEl, canvasEl, duration = 7000, maxSwirl = 3.0, elapsedStart = 0) {
    const ctx = canvasEl.getContext('2d');
    const width = imgEl.naturalWidth;
    const height = imgEl.naturalHeight;
    canvasEl.width = width;
    canvasEl.height = height;

    ctx.drawImage(imgEl, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const originalData = new Uint8ClampedArray(imageData.data);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2;

    let startTime = null;
    let pauseTime = null;
    let paused = false;
    let animationFrame = null;

    const swirlStrength = Math.max(1, Math.min(10, maxSwirl));
    const swirlBaseAngle = swirlStrength * Math.PI;

    function swirlEffect(timestamp) {
        if (paused) {
            animationFrame = requestAnimationFrame(swirlEffect);
            return;
        }

        if (startTime === null) {
            // Offset start time to account for sync delay
            startTime = timestamp - elapsedStart;
        }

        if (pauseTime !== null) {
            startTime += timestamp - pauseTime;
            pauseTime = null;
        }

        const elapsed = timestamp - startTime;
        const progress = Math.min(1, elapsed / duration);

        const output = ctx.createImageData(width, height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const swirlAmount = swirlBaseAngle * (1 - progress) * (1 - distance / radius);

                const angle = swirlAmount;
                const sx = Math.floor(centerX + dx * Math.cos(angle) - dy * Math.sin(angle));
                const sy = Math.floor(centerY + dx * Math.sin(angle) + dy * Math.cos(angle));

                const srcIndex = (sy * width + sx) * 4;
                const destIndex = (y * width + x) * 4;

                if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                    output.data[destIndex] = originalData[srcIndex];
                    output.data[destIndex + 1] = originalData[srcIndex + 1];
                    output.data[destIndex + 2] = originalData[srcIndex + 2];
                    output.data[destIndex + 3] = 255;
                }
            }
        }

        ctx.putImageData(output, 0, 0);

        if (progress < 1) {
            animationFrame = requestAnimationFrame(swirlEffect);
        }
    }

    animationFrame = requestAnimationFrame(swirlEffect);

    return {
        pause() {
            if (!paused) {
                paused = true;
                pauseTime = performance.now();
            }
        },
        resume() {
            if (paused) {
                paused = false;
                animationFrame = requestAnimationFrame(swirlEffect);
            }
        },
        cancel() {
            cancelAnimationFrame(animationFrame);
            ctx.putImageData(imageData, 0, 0); // Fully unswirled
        },
        isPaused() {
            return paused;
        }
    };
}
