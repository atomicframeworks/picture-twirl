// worker/lib/media.js
//
// Byte-level picture helpers: what type is this file really (magic bytes —
// never trust a declared Content-Type), and how big is it (read from the
// header, no decoding). Pure functions; used by uploads and URL imports.

/** 'image/webp' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/avif' | 'image/svg+xml' | null */
export function sniffImage(bytes) {
    const b = bytes;
    if (!b || b.length < 12) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
    if (ascii(b, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 4))) return 'image/avif';
    const head = new TextDecoder().decode(b.slice(0, 512)).trimStart().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
    return null;
}

function ascii(b, start, len) {
    let s = '';
    for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
}

const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

/** { width, height } from a WebP / JPEG / PNG header, or null. */
export function imageSize(bytes) {
    const b = bytes;
    switch (sniffImage(b)) {
        case 'image/png':
            return b.length >= 24 ? { width: u32be(b, 16), height: u32be(b, 20) } : null;
        case 'image/webp': {
            const chunk = ascii(b, 12, 4);
            if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
            if (chunk === 'VP8L' && b.length >= 25) {
                const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
                return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
            }
            if (chunk === 'VP8 ' && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
            return null;
        }
        case 'image/jpeg': {
            let i = 2;
            while (i + 9 < b.length) {
                if (b[i] !== 0xff) { i++; continue; }
                const marker = b[i + 1];
                // SOF0–SOF15 carry the frame size (except DHT C4, JPG C8, DAC CC).
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                    return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
                }
                if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
                i += 2 + u16be(b, i + 2);
            }
            return null;
        }
        default:
            return null;
    }
}
