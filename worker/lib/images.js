// worker/lib/images.js
//
// Stored pictures: bytes in R2 (env.MEDIA), provenance + rights in D1 `images`.
// Keys are content hashes, so a stored object never changes and can be cached
// forever. Callers hand in already-normalized files (WebP display/thumb, made
// in the admin's browser or by the content tools) — the Worker never resizes
// (that would blow the Free plan's CPU limit; PROPOSAL.md §8.1).

import { assessRights } from '../../src/shared/rights.js';
import { first, newId, now } from './db.js';

/** Players may fetch these prefixes through /media/*; archive/ and evidence/ stay private. */
export const PUBLIC_MEDIA_PREFIXES = ['display/', 'thumb/'];

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Store a picture (idempotent per display-file hash) and return its images row.
 * @param {object} env  bindings: DB, MEDIA
 * @param {{
 *   sha256: string,                                   // hex of display.bytes
 *   display: { bytes: Uint8Array, width: number, height: number },
 *   thumb: { bytes: Uint8Array },
 *   archive?: { bytes: Uint8Array, contentType?: string },
 *   meta?: { provider?, sourcePageUrl?, sourceFileUrl?, creator?, creatorUrl?,
 *            license?, licenseUrl?, attribution?, flags?: string[], rightsNote?,
 *            retrievedAt?, notes? },
 *   actor?: string,
 * }} input
 */
export async function storeImage(env, { sha256, display, thumb, archive, meta = {}, actor = null }) {
    const existing = await first(env, 'SELECT * FROM images WHERE sha256 = ?', sha256);
    if (existing) return existing;

    const displayKey = `display/${sha256}.webp`;
    const thumbKey = `thumb/${sha256}.webp`;
    const archiveKey = archive ? `archive/${sha256}` : null;

    await env.MEDIA.put(displayKey, display.bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE } });
    await env.MEDIA.put(thumbKey, thumb.bytes, { httpMetadata: { contentType: 'image/webp', cacheControl: IMMUTABLE } });
    if (archive) {
        await env.MEDIA.put(archiveKey, archive.bytes, { httpMetadata: { contentType: archive.contentType || 'image/webp' } });
    }

    const rights = assessRights({ license: meta.license, flags: meta.flags });
    const t = now();
    await env.DB.prepare(`
        INSERT INTO images (id, sha256, display_key, thumb_key, archive_key, width, height, bytes,
            provider, source_page_url, source_file_url, creator, creator_url,
            license, license_url, attribution, rights_status, rights_flags, rights_note,
            retrieved_at, created_at, created_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (sha256) DO NOTHING`).bind(
        newId('img'), sha256, displayKey, thumbKey, archiveKey,
        display.width ?? null, display.height ?? null, display.bytes.byteLength,
        meta.provider || 'upload', meta.sourcePageUrl || null, meta.sourceFileUrl || null,
        meta.creator || null, meta.creatorUrl || null,
        meta.license || 'unknown', meta.licenseUrl || null, meta.attribution || null,
        rights.status, JSON.stringify(rights.flags), meta.rightsNote || null,
        meta.retrievedAt ?? null, t, actor, meta.notes || null,
    ).run();

    return first(env, 'SELECT * FROM images WHERE sha256 = ?', sha256);
}

/** Map<imageId, row> for the given ids (one query). */
export async function imagesByIds(env, ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    const map = new Map();
    if (!unique.length) return map;
    const { results } = await env.DB
        .prepare(`SELECT * FROM images WHERE id IN (${unique.map(() => '?').join(',')})`)
        .bind(...unique).all();
    for (const row of results ?? []) map.set(row.id, row);
    return map;
}
