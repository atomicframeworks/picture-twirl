// tools/content/lib/sources.mjs
//
// Where pictures come from (PROPOSAL.md §7.2) — official APIs, not scraping:
//   Wikimedia Commons  MediaWiki API (per-file license + "trademarked" /
//                      "personality" restriction tags)      — no key
//   Openverse          CC search, filtered to commercial + modification — no key
//   Unsplash           ONLY links a person picked (the spreadsheet) — read via
//                      the browser like a person would; Unsplash+ is refused;
//                      never the Unsplash API (its terms require hotlinking)
// Every candidate carries its license fields; rightsOf() rates them.
//
// Candidate shape:
//   { provider, title, sourcePageUrl, downloadUrl, previewUrl, width, height,
//     license, licenseLabel, licenseUrl, creator, creatorUrl, attribution, flags[] }

import { getJson, politeFetch } from './http.mjs';
import { fromCommons, fromOpenverse, rightsOf } from './license.mjs';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia serves thumbnails only in standard widths (250, 330, 500, 960,
// 1280, 1920, 3840 — anything else is HTTP 400 or rounded up), so ask for those.
const COMMONS_DOWNLOAD_WIDTH = 1920;     // ≥ the 1280 px players see; big originals come down at this size
const COMMONS_PREVIEW_WIDTH = 500;       // what the AI picture check looks at
const MIN_EDGE = 500;            // smaller originals look blurry on a TV

// ── Wikimedia Commons ────────────────────────────────────────────────────────

function commonsQuery(params) {
    const qs = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(COMMONS_DOWNLOAD_WIDTH), ...params,
    });
    return getJson(`${COMMONS_API}?${qs}`);
}

/** Commons API response → candidates (pure; exported for tests). */
export function commonsCandidates(data) {
    return (data?.query?.pages || [])
        .map((p) => {
            const ii = p.imageinfo?.[0];
            if (!ii || !/^image\/(jpeg|png|webp|gif|svg\+xml|tiff)$/.test(ii.mime || '')) return null;
            const isSvg = ii.mime === 'image/svg+xml';
            return {
                provider: 'wikimedia',
                title: String(p.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
                sourcePageUrl: ii.descriptionurl,
                // A standard-width render for big originals and for SVGs (rasterized by Commons).
                downloadUrl: isSvg || ii.width > COMMONS_DOWNLOAD_WIDTH ? (ii.thumburl || ii.url) : ii.url,
                previewUrl: ii.thumburl ? ii.thumburl.replace(/\/\d+px-/, `/${COMMONS_PREVIEW_WIDTH}px-`) : ii.url,
                width: isSvg ? Math.max(ii.thumbwidth || 0, ii.width) : ii.width,
                height: isSvg ? Math.max(ii.thumbheight || 0, ii.height) : ii.height,
                ...fromCommons(ii.extmetadata),
            };
        })
        .filter(Boolean)
        .filter(c => Math.max(c.width, c.height) >= MIN_EDGE);
}

export async function commonsSearch(query, limit = 8) {
    return commonsCandidates(await commonsQuery({
        generator: 'search', gsrsearch: `${query} filetype:bitmap|drawing`, gsrnamespace: '6', gsrlimit: String(limit),
    }));
}

export async function commonsCategory(name, limit = 12) {
    return commonsCandidates(await commonsQuery({
        generator: 'categorymembers', gcmtitle: name.startsWith('Category:') ? name : `Category:${name}`,
        gcmtype: 'file', gcmlimit: String(limit),
    }));
}

export async function commonsFile(fileTitle) {
    return commonsCandidates(await commonsQuery({ titles: fileTitle.startsWith('File:') ? fileTitle : `File:${fileTitle}` }));
}

// ── Openverse ────────────────────────────────────────────────────────────────

export async function openverseSearch(query, limit = 8) {
    const qs = new URLSearchParams({
        q: query, license_type: 'commercial,modification', page_size: String(limit), mature: 'false',
    });
    const data = await getJson(`https://api.openverse.org/v1/images/?${qs}`);
    return (data.results || [])
        .filter(r => r.url && (!r.width || Math.max(r.width, r.height) >= MIN_EDGE))
        .map(r => ({
            provider: `openverse:${r.source || r.provider || 'unknown'}`,
            title: r.title || '',
            sourcePageUrl: r.foreign_landing_url || r.detail_url,
            downloadUrl: r.url,
            previewUrl: r.thumbnail || r.url,
            width: r.width || null,
            height: r.height || null,
            ...fromOpenverse(r),
        }));
}

// ── Links from the spreadsheet ───────────────────────────────────────────────

/**
 * Candidates for a link someone put in the sheet, or null if we don't support
 * that kind of link (then the pipeline searches by answer instead).
 * @param {string} url
 * (Unsplash pages are read over plain HTTP; no browser needed.)
 */
export async function resolveLink(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const host = u.hostname.replace(/^www\./, '');
    const page = decodeURIComponent(u.pathname);

    if (host === 'commons.wikimedia.org') {
        const filePath = page.match(/\/wiki\/Special:FilePath\/(.+)$/)?.[1];
        if (filePath) return commonsFile(filePath);
        const file = page.match(/\/wiki\/(File:.+)$/)?.[1];
        if (file) return commonsFile(file);
        const cat = page.match(/\/wiki\/(Category:.+)$/)?.[1];
        if (cat) return commonsCategory(cat);
        return null;
    }
    if (host === 'upload.wikimedia.org') {
        const name = page.split('/').filter(Boolean).find((seg, i, all) => i === all.length - 1 && !/^\d+px-/.test(seg))
            || page.match(/\/thumb\/.+?\/.+?\/([^/]+)\//)?.[1];
        return name ? commonsFile(name) : null;
    }
    if (host === 'unsplash.com' && /^\/photos\//.test(page)) {
        return unsplashPhoto(url);
    }
    return null;   // brand sites, news sites, forms… → not a free-license source; search instead
}

/**
 * An Unsplash photo page a person chose → one candidate, or [] for Unsplash+
 * (premium, not under the free license). Read over plain HTTP with our named
 * bot UA (their pages allow it; robots.txt permits). The page's own structured
 * data tells us the license and photographer.
 */
async function unsplashPhoto(url) {
    const res = await politeFetch(url, { accept: 'text/html' });
    if (!res.ok) return null;
    const html = await res.text();
    const title = decodeHtml(html.match(/<title>([^<]*)<\/title>/i)?.[1] || '');
    const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(m => { try { return JSON.parse(m[1]); } catch { return null; } })
        .flatMap(x => (Array.isArray(x) ? x : [x])).filter(Boolean)
        .find(x => x.license || x.contentUrl);
    const licenseUrl = ld?.license || null;
    const free = /free photo on unsplash/i.test(title) || licenseUrl === 'https://unsplash.com/license';
    const premium = /unsplash\+|premium/i.test(title) || /plus\/license/i.test(licenseUrl || '');
    if (!free || premium) return [];

    const og = decodeHtml(html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] || '');
    if (!og) return null;
    const base = og.split('?')[0];                       // drop the watermark/size params
    const creator = ld?.copyrightNotice || ld?.creator?.name || ld?.author?.name || null;
    return [{
        provider: 'unsplash',
        title: title.replace(/\s*-\s*free photo on unsplash\s*$/i, '').trim(),
        sourcePageUrl: url,
        downloadUrl: `${base}?w=2560&fit=max&fm=jpg&q=85`,
        previewUrl: `${base}?w=512&fit=max&fm=jpg&q=70`,
        width: 2560,
        height: null,
        license: 'unsplash',
        licenseLabel: 'Unsplash License',
        licenseUrl: 'https://unsplash.com/license',
        creator: creator ? String(creator).slice(0, 200) : null,
        creatorUrl: null,
        attribution: creator ? `Photo by ${creator} on Unsplash` : null,
        flags: [],
    }];
}

const decodeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ── Search across providers ──────────────────────────────────────────────────

/** Search free sources for an answer; usable candidates only, best first. */
export async function searchFree(query, { limit = 6 } = {}) {
    const results = [];
    for (const fn of [commonsSearch, openverseSearch]) {
        try {
            results.push(...(await fn(query, limit)));
        } catch (err) {
            results.push({ error: `${fn.name}: ${err.message}` });
        }
    }
    return rank(results.filter(r => !r.error));
}

/** Drop blocked licenses; ok before flagged; bigger first. */
export function rank(candidates) {
    const order = { ok: 0, flagged: 1 };
    return candidates
        .map(c => ({ ...c, rights: rightsOf(c) }))
        .filter(c => c.rights.status !== 'blocked')
        .sort((a, b) => (order[a.rights.status] - order[b.rights.status])
            || (Math.max(b.width || 0, b.height || 0) - Math.max(a.width || 0, a.height || 0)));
}
