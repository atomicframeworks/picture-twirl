// tools/content/lib/http.mjs
//
// Polite HTTP for the content tools (carWashCrawler manners): a named bot
// user-agent (never a disguised browser), ≥ 2 s between requests to the same
// host, a timeout, one retry on 429/5xx, and 403/429 respected as "no".
// Picture downloads use node:https rather than fetch(): some image CDNs
// (Flickr's) answer fetch()'s automatic `Sec-Fetch-Mode: cors` with 403.

import http from 'node:http';
import https from 'node:https';

export const USER_AGENT = 'PictureTwirlContentBot/1.0 (+https://github.com/atomicframeworks/picture-twirl; content import tools)';
const MIN_GAP_MS = 2000;            // PROPOSAL.md §7.3
const lastHit = new Map();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitTurn(host) {
    const wait = (lastHit.get(host) || 0) + MIN_GAP_MS - Date.now();
    lastHit.set(host, Date.now() + Math.max(0, wait));
    if (wait > 0) await sleep(wait);
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: object, accept?: string }} [opts]
 * @returns {Promise<Response>}
 */
export async function politeFetch(url, { timeoutMs = 20_000, headers = {}, accept = '*/*' } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; attempt < 2; attempt++) {
        await waitTurn(host);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers }, signal: ctrl.signal, redirect: 'follow' });
            if ((res.status === 429 || res.status >= 500) && attempt === 0) {
                await sleep(Number(res.headers.get('Retry-After')) * 1000 || 5000);
                continue;
            }
            return res;
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Gave up on ${url}`);
}

export async function getJson(url, opts) {
    const res = await politeFetch(url, { ...opts, accept: 'application/json' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}

/** Plain GET via node:http(s), following redirects, with a size cap. */
function rawGet(url, { headers, timeoutMs, maxBytes }, redirects = 0) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = (u.protocol === 'http:' ? http : https).get(u, { headers, timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirects >= 5) return reject(new Error(`Too many redirects: ${url}`));
                return resolve(rawGet(new URL(res.headers.location, u).href, { headers, timeoutMs, maxBytes }, redirects + 1));
            }
            const chunks = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes) req.destroy(new Error(`Too large (over ${maxBytes} bytes): ${url}`));
                else chunks.push(chunk);
            });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error(`Timed out: ${url}`)));
        req.on('error', reject);
    });
}

/** Download bytes (with a size cap). */
export async function getBytes(url, { maxBytes = 25 * 1024 * 1024, timeoutMs = 30_000 } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; attempt < 2; attempt++) {
        await waitTurn(host);
        const res = await rawGet(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*;q=0.5' }, timeoutMs, maxBytes });
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
            await sleep(Number(res.headers['retry-after']) * 1000 || 5000);
            continue;
        }
        if (res.status !== 200) throw new Error(`HTTP ${res.status} downloading ${url}`);
        return res.body;
    }
    throw new Error(`Gave up on ${url}`);
}
