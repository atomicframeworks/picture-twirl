// worker/lib/fetchImage.js
//
// "Paste a link" picture import (PROPOSAL.md §5.6). The Worker downloads the
// picture on the admin's behalf — so we keep OUR copy and never hotlink — and
// hands the bytes back to the admin's browser, which normalizes and uploads
// them like any other file. Pasting a web PAGE works too: we follow its
// og:image / twitter:image.
//
// Guards: http(s) only; no localhost / private / link-local hosts (checked on
// every redirect hop); 10 s timeout; size cap enforced while streaming; the
// bytes must sniff as an image.

import { HttpError } from './http.js';
import { sniffImage } from './media.js';

export const FETCH_LIMITS = {
    maxImageBytes: 15 * 1024 * 1024,
    maxPageBytes: 1024 * 1024,
    timeoutMs: 10_000,
    maxRedirects: 4,
};

const USER_AGENT = 'PictureTwirlBot/1.0 (+admin image import)';

/** True for hosts a server-side fetch must never reach. */
export function isPrivateHost(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (/^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
    if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || h.startsWith('::ffff:')) return true;
    return false;
}

/** Parse + vet a user-supplied URL. */
export function checkUrl(raw) {
    let url;
    try { url = new URL(String(raw || '').trim()); } catch { throw new HttpError(400, 'bad_url', 'That isn’t a valid link.'); }
    if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'bad_url', 'Only http(s) links work.');
    if (isPrivateHost(url.hostname)) throw new HttpError(400, 'bad_host', 'That host isn’t allowed.');
    return url;
}

/** The best "this page's picture" URL in an HTML page, made absolute, or null. */
export function extractPageImage(html, baseUrl) {
    const metas = [...String(html).matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
    const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
    for (const want of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
        for (const tag of metas) {
            const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
            const content = attr(tag, 'content');
            if (key === want && content) {
                try { return new URL(decodeEntities(content), baseUrl).toString(); } catch { /* keep looking */ }
            }
        }
    }
    const link = String(html).match(/<link\b[^>]*rel\s*=\s*(["'])image_src\1[^>]*>/i)?.[0];
    const href = link && attr(link, 'href');
    if (href) {
        try { return new URL(decodeEntities(href), baseUrl).toString(); } catch { /* none */ }
    }
    return null;
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

/** fetch() following redirects by hand so every hop passes the host check. */
async function guardedFetch(url, { signal }) {
    let current = url;
    for (let hop = 0; hop <= FETCH_LIMITS.maxRedirects; hop++) {
        const res = await fetch(current.toString(), {
            redirect: 'manual',
            signal,
            headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,text/html;q=0.8,*/*;q=0.5' },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
            current = checkUrl(new URL(res.headers.get('Location'), current).toString());
            continue;
        }
        return { res, finalUrl: current };
    }
    throw new HttpError(400, 'too_many_redirects', 'That link redirects too many times.');
}

async function readCapped(res, max, tooBigMessage) {
    if (Number(res.headers.get('Content-Length') || 0) > max) throw new HttpError(413, 'too_large', tooBigMessage);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel().catch(() => {});
            throw new HttpError(413, 'too_large', tooBigMessage);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return out;
}

/**
 * Download a picture from a link (or from the page a link points to).
 * @returns {Promise<{ bytes: Uint8Array, contentType: string, sourceFileUrl: string, sourcePageUrl: string|null }>}
 */
export async function fetchImageFromUrl(raw) {
    const start = checkUrl(raw);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_LIMITS.timeoutMs);
    try {
        let { res, finalUrl } = await guardedFetch(start, { signal: ctrl.signal });
        if (!res.ok) throw new HttpError(400, 'fetch_failed', `The link returned HTTP ${res.status}.`);

        let pageUrl = null;
        if ((res.headers.get('Content-Type') || '').includes('text/html')) {
            const html = new TextDecoder().decode(await readCapped(res, FETCH_LIMITS.maxPageBytes, 'That page is too big to read.'));
            const imageUrl = extractPageImage(html, finalUrl);
            if (!imageUrl) throw new HttpError(400, 'no_image', 'That page has no picture we can find. Link to the image itself.');
            pageUrl = finalUrl.toString();
            ({ res, finalUrl } = await guardedFetch(checkUrl(imageUrl), { signal: ctrl.signal }));
            if (!res.ok) throw new HttpError(400, 'fetch_failed', `The page's picture returned HTTP ${res.status}.`);
        }

        const bytes = await readCapped(res, FETCH_LIMITS.maxImageBytes, 'That picture is over 15 MB.');
        const contentType = sniffImage(bytes);
        if (!contentType) throw new HttpError(400, 'not_an_image', 'That link isn’t a picture we can read (JPG, PNG, WebP, GIF, AVIF or SVG).');
        return { bytes, contentType, sourceFileUrl: finalUrl.toString(), sourcePageUrl: pageUrl };
    } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err?.name === 'AbortError') throw new HttpError(504, 'timeout', 'The link took too long to download.');
        throw new HttpError(400, 'fetch_failed', 'Couldn’t download that link.');
    } finally {
        clearTimeout(timer);
    }
}
