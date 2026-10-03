// src/admin/lib/imageTools.js
//
// Picture intake in the admin's browser (PROPOSAL.md §5.6): any image the
// admin drops, picks, pastes or links becomes the files we store —
//   display ≤ 1280 px · thumb ≤ 320 px · archive ≤ 2560 px (only when bigger)
// — encoded as WebP (JPEG where the browser can't encode WebP), then uploaded.
// Resizing happens HERE, not in the Worker (Free-plan CPU limit; §8.1).
// EXIF orientation is honored; SVGs are rasterized; animations → first frame.

import { api } from './api.js';

export const SIZES = { display: 1280, thumb: 320, archive: 2560 };
const QUALITY = { display: 0.82, thumb: 0.75, archive: 0.9 };
const ACCEPT = /^image\/(jpeg|png|webp|gif|avif|svg\+xml|bmp)$/;

/** True when a File/Blob looks like a picture we can read. */
export const isImageFile = (file) => !!file && (ACCEPT.test(file.type) || /\.(jpe?g|png|webp|gif|avif|svg|bmp)$/i.test(file.name || ''));

/** Decode a Blob into something drawable + its natural size. */
async function decode(blob) {
    if (blob.type !== 'image/svg+xml') {
        try {
            const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
        } catch { /* fall back to <img> (SVG, some AVIF) */ }
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        // SVGs without an intrinsic size report 0 — render them big.
        const width = img.naturalWidth || SIZES.display;
        const height = img.naturalHeight || SIZES.display;
        return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
    } catch {
        URL.revokeObjectURL(url);
        throw new Error('That file isn’t a picture this browser can read. Try JPG, PNG or WebP.');
    }
}

function canvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

/** Draw `src` scaled so its long edge is ≤ maxEdge, halving in steps for quality. */
function drawScaled(src, srcW, srcH, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));
    let cur = src;
    let curW = srcW;
    let curH = srcH;
    while (curW / 2 >= outW && curH / 2 >= outH) {           // step down by halves
        const step = canvas(Math.round(curW / 2), Math.round(curH / 2));
        const ctx = step.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, 0, 0, step.width, step.height);
        cur = step;
        curW = step.width;
        curH = step.height;
    }
    const out = canvas(outW, outH);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, outW, outH);
    return out;
}

async function encode(c, quality) {
    const toBlob = (type) => (c.convertToBlob
        ? c.convertToBlob({ type, quality })
        : new Promise((resolve) => c.toBlob(resolve, type, quality)));
    const webp = await toBlob('image/webp');
    if (webp && webp.type === 'image/webp') return webp;
    return toBlob('image/jpeg');                             // e.g. older Safari can't encode WebP
}

/**
 * Make the upload files for one picture.
 * @param {Blob} blob
 * @returns {Promise<{ display: Blob, thumb: Blob, archive: Blob|null, width: number, height: number }>}
 */
export async function prepareImage(blob) {
    const img = await decode(blob);
    try {
        const display = drawScaled(img.source, img.width, img.height, SIZES.display);
        const thumb = drawScaled(img.source, img.width, img.height, SIZES.thumb);
        const bigger = Math.max(img.width, img.height) > SIZES.display;
        const archive = bigger ? drawScaled(img.source, img.width, img.height, SIZES.archive) : null;
        return {
            display: await encode(display, QUALITY.display),
            thumb: await encode(thumb, QUALITY.thumb),
            archive: archive ? await encode(archive, QUALITY.archive) : null,
            width: display.width,
            height: display.height,
        };
    } finally {
        img.close();
    }
}

/**
 * Prepare + upload a picture; returns the stored image (publicImage shape).
 * @param {Blob} blob
 * @param {{ provider?: 'upload'|'url'|'paste', sourceFileUrl?: string, sourcePageUrl?: string }} meta
 */
export async function uploadPicture(blob, meta = {}) {
    const files = await prepareImage(blob);
    const form = new FormData();
    form.append('display', files.display, 'display');
    form.append('thumb', files.thumb, 'thumb');
    if (files.archive) form.append('archive', files.archive, 'archive');
    form.append('meta', JSON.stringify(meta));
    const { image } = await api('POST', '/api/admin/images', form);
    return image;
}

/**
 * Download a picture from a link through the Worker (it keeps our own copy and
 * guards against unsafe hosts), then prepare + upload it.
 */
export async function uploadPictureFromUrl(url) {
    const res = await api('POST', '/api/admin/images/fetch', { url });
    const blob = await res.blob();
    return uploadPicture(blob, {
        provider: 'url',
        sourceFileUrl: res.headers.get('X-Source-File-Url') || url,
        sourcePageUrl: res.headers.get('X-Source-Page-Url') || null,
    });
}

/** Pull a picture (file) or a link (text) out of a paste / drop. */
export function readTransfer(dt) {
    if (!dt) return null;
    const file = [...(dt.files || [])].find(isImageFile)
        || [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).find(isImageFile);
    if (file) return { file };
    const text = (dt.getData?.('text/uri-list') || dt.getData?.('text/plain') || '').split('\n').find(l => /^https?:\/\//i.test(l.trim()));
    return text ? { url: text.trim() } : null;
}
