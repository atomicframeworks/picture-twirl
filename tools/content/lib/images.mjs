// tools/content/lib/images.mjs
//
// Turn any source picture into the files we store (PROPOSAL.md §6/§7.3):
//   display  ≤ 1280 px long edge, WebP — what players see (the swirl works at
//            ≤ 720 px, so this leaves headroom for big screens)
//   thumb    ≤ 320 px, WebP — admin grids and pickers
//   archive  ≤ 2560 px, WebP — private copy kept for provenance, never served
// Never upscales; honors EXIF orientation; rasterizes SVG crisply; takes the
// first frame of animations. Node only (sharp).

import sharp from 'sharp';
import { createHash } from 'node:crypto';

export const SIZES = { display: 1280, thumb: 320, archive: 2560 };

/**
 * @param {Buffer|Uint8Array} input  any format sharp reads (JPEG/PNG/WebP/GIF/AVIF/SVG…)
 * @returns {Promise<{ sha256: string,
 *   display: { bytes: Buffer, width: number, height: number },
 *   thumb: { bytes: Buffer, width: number, height: number },
 *   archive: { bytes: Buffer, width: number, height: number, contentType: string },
 *   source: { format: string, width: number, height: number } }>}
 */
export async function normalizeImage(input) {
    const meta = await sharp(input).metadata();
    // SVGs rasterize at 72 dpi by default — tiny. Render at a density that
    // lands the long edge around the archive size.
    const density = meta.format === 'svg'
        ? Math.min(2400, Math.max(72, Math.round(72 * SIZES.archive / Math.max(meta.width || 1, meta.height || 1))))
        : undefined;

    const render = async (size, quality) => {
        const { data, info } = await sharp(input, density ? { density } : {})
            .rotate()                                                         // apply EXIF orientation
            .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
            .webp({ quality })
            .toBuffer({ resolveWithObject: true });
        return { bytes: data, width: info.width, height: info.height };
    };

    const display = await render(SIZES.display, 82);
    const thumb = await render(SIZES.thumb, 75);
    const archive = await render(SIZES.archive, 90);

    return {
        sha256: createHash('sha256').update(display.bytes).digest('hex'),
        display,
        thumb,
        archive: { ...archive, contentType: 'image/webp' },
        source: { format: meta.format, width: meta.width, height: meta.height },
    };
}
