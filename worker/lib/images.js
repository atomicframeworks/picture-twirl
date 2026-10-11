// worker/lib/images.js
//
// Stored pictures: bytes in R2 (env.MEDIA), provenance + rights in D1 `images`.
// Keys are content hashes, so a stored object never changes and can be cached
// forever. Callers hand in already-normalized files (WebP/JPEG display + thumb,
// made in the admin's browser or by the content tools) — the Worker never
// resizes (that would blow the Free plan's CPU limit; PROPOSAL.md §8.1).

import { assessRights, LICENSES, licenseInfo, RIGHTS_FLAGS } from '../../src/shared/rights.js';
import { boardStats, imageIdsOf, mediaUrl } from '../../src/shared/boards.js';
import { all, first, newId, now, sha256Hex } from './db.js';
import { HttpError } from './http.js';
import { imageSize, sniffImage } from './media.js';

/** Players may fetch these prefixes through /media/*; archive/ and evidence/ stay private. */
export const PUBLIC_MEDIA_PREFIXES = ['display/', 'thumb/'];

const IMMUTABLE = 'public, max-age=31536000, immutable';
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Upload rules for the admin + import APIs (bytes, long edge px, types). */
export const UPLOAD_LIMITS = {
    display: { maxBytes: 4 * 1024 * 1024, maxEdge: 1600, types: ['image/webp', 'image/jpeg'] },
    thumb: { maxBytes: 512 * 1024, maxEdge: 400, types: ['image/webp', 'image/jpeg'] },
    archive: { maxBytes: 12 * 1024 * 1024, maxEdge: 2600, types: ['image/webp', 'image/jpeg', 'image/png'] },
};

/**
 * Check one uploaded file against UPLOAD_LIMITS[kind].
 * @returns {{ bytes: Uint8Array, contentType: string, width: number, height: number }}
 */
export function checkUpload(kind, bytes) {
    const rule = UPLOAD_LIMITS[kind];
    if (!bytes?.byteLength) throw new HttpError(400, 'file_missing', `The ${kind} file is missing.`);
    if (bytes.byteLength > rule.maxBytes) throw new HttpError(413, 'file_too_large', `The ${kind} file is too large.`);
    const contentType = sniffImage(bytes);
    if (!rule.types.includes(contentType)) throw new HttpError(400, 'bad_file_type', `The ${kind} file must be ${rule.types.join(' or ')}.`);
    const size = imageSize(bytes);
    if (!size?.width || !size?.height) throw new HttpError(400, 'bad_image', `Couldn’t read the ${kind} picture's size.`);
    if (Math.max(size.width, size.height) > rule.maxEdge) throw new HttpError(400, 'image_too_big', `The ${kind} picture is larger than ${rule.maxEdge}px.`);
    return { bytes, contentType, ...size };
}

/**
 * Store a picture (idempotent per display-file hash) and return its images row.
 * @param {object} env  bindings: DB, MEDIA
 * @param {{
 *   sha256?: string,                                  // hex of display.bytes (computed if absent)
 *   display: { bytes: Uint8Array, width: number, height: number, contentType?: string },
 *   thumb: { bytes: Uint8Array, contentType?: string },
 *   archive?: { bytes: Uint8Array, contentType?: string },
 *   meta?: { provider?, sourcePageUrl?, sourceFileUrl?, creator?, creatorUrl?,
 *            license?, licenseUrl?, attribution?, flags?: string[], rightsNote?,
 *            retrievedAt?, notes? },
 *   actor?: string,
 * }} input
 */
export async function storeImage(env, { sha256, display, thumb, archive, meta = {}, actor = null }) {
    const hash = sha256 || await sha256Hex(display.bytes);
    const existing = await first(env, 'SELECT * FROM images WHERE sha256 = ?', hash);
    if (existing) return existing;

    const displayType = display.contentType || 'image/webp';
    const thumbType = thumb.contentType || 'image/webp';
    const displayKey = `display/${hash}.${EXT[displayType] || 'webp'}`;
    const thumbKey = `thumb/${hash}.${EXT[thumbType] || 'webp'}`;
    const archiveKey = archive ? `archive/${hash}` : null;

    await env.MEDIA.put(displayKey, display.bytes, { httpMetadata: { contentType: displayType, cacheControl: IMMUTABLE } });
    await env.MEDIA.put(thumbKey, thumb.bytes, { httpMetadata: { contentType: thumbType, cacheControl: IMMUTABLE } });
    if (archive) {
        await env.MEDIA.put(archiveKey, archive.bytes, { httpMetadata: { contentType: archive.contentType || 'image/webp' } });
    }

    const license = normalizeLicense(meta.license);
    const rights = assessRights({ license, flags: meta.flags });
    const t = now();
    await env.DB.prepare(`
        INSERT INTO images (id, sha256, display_key, thumb_key, archive_key, width, height, bytes,
            provider, source_page_url, source_file_url, creator, creator_url,
            license, license_url, attribution, rights_status, rights_flags, rights_note,
            retrieved_at, created_at, created_by, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (sha256) DO NOTHING`).bind(
        newId('img'), hash, displayKey, thumbKey, archiveKey,
        display.width ?? null, display.height ?? null, display.bytes.byteLength,
        meta.provider || 'upload', cleanUrl(meta.sourcePageUrl), cleanUrl(meta.sourceFileUrl),
        cleanText(meta.creator, 200), cleanUrl(meta.creatorUrl),
        license, cleanUrl(meta.licenseUrl), cleanText(meta.attribution, 300),
        rights.status, JSON.stringify(rights.flags), cleanText(meta.rightsNote, 500),
        meta.retrievedAt ?? null, t, actor, cleanText(meta.notes, 500),
    ).run();

    return first(env, 'SELECT * FROM images WHERE sha256 = ?', hash);
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

/** The camelCase shape the admin UI works with. */
export function publicImage(row) {
    if (!row) return null;
    return {
        id: row.id,
        url: mediaUrl(row.display_key),
        thumb: mediaUrl(row.thumb_key),
        width: row.width,
        height: row.height,
        bytes: row.bytes,
        hasArchive: !!row.archive_key,
        hasEvidence: !!row.evidence_key,
        provider: row.provider,
        sourcePageUrl: row.source_page_url,
        sourceFileUrl: row.source_file_url,
        creator: row.creator,
        creatorUrl: row.creator_url,
        license: row.license,
        licenseLabel: licenseInfo(row.license).label,
        licenseUrl: row.license_url,
        attribution: row.attribution,
        rightsStatus: row.rights_status,
        rightsFlags: safeArray(row.rights_flags),
        rightsNote: row.rights_note,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        retrievedAt: row.retrieved_at,
        createdAt: row.created_at,
        createdBy: row.created_by,
        notes: row.notes,
    };
}

/**
 * Edit a picture's provenance / rights (the tile drawer). Rights are per
 * picture, so this applies to every board that uses it; their ⚠️ counts are
 * recomputed. Credits in already-published snapshots update on next publish.
 */
export async function updateImageRights(env, id, patch, actor) {
    const row = await first(env, 'SELECT * FROM images WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found');

    const next = {
        license: 'license' in patch ? normalizeLicense(patch.license) : row.license,
        license_url: 'licenseUrl' in patch ? cleanUrl(patch.licenseUrl) : row.license_url,
        creator: 'creator' in patch ? cleanText(patch.creator, 200) : row.creator,
        creator_url: 'creatorUrl' in patch ? cleanUrl(patch.creatorUrl) : row.creator_url,
        attribution: 'attribution' in patch ? cleanText(patch.attribution, 300) : row.attribution,
        source_page_url: 'sourcePageUrl' in patch ? cleanUrl(patch.sourcePageUrl) : row.source_page_url,
        rights_note: 'rightsNote' in patch ? cleanText(patch.rightsNote, 500) : row.rights_note,
        notes: 'notes' in patch ? cleanText(patch.notes, 500) : row.notes,
    };
    // Flags the user can set; license-implied flags (share_alike, rights_unknown) are re-derived.
    const userFlags = 'flags' in patch
        ? (Array.isArray(patch.flags) ? patch.flags : []).filter(f => RIGHTS_FLAGS[f])
        : safeArray(row.rights_flags);
    const rights = assessRights({ license: next.license, flags: userFlags.filter(f => !['share_alike', 'rights_unknown'].includes(f)) });

    let reviewedBy = row.reviewed_by;
    let reviewedAt = row.reviewed_at;
    if ('reviewed' in patch) {
        reviewedBy = patch.reviewed ? actor : null;
        reviewedAt = patch.reviewed ? now() : null;
    }

    await env.DB.prepare(`UPDATE images SET license = ?, license_url = ?, creator = ?, creator_url = ?,
        attribution = ?, source_page_url = ?, rights_note = ?, notes = ?, rights_status = ?, rights_flags = ?,
        reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind(
        next.license, next.license_url, next.creator, next.creator_url, next.attribution, next.source_page_url,
        next.rights_note, next.notes, rights.status, JSON.stringify(rights.flags), reviewedBy, reviewedAt, id,
    ).run();

    await recountBoardsUsing(env, id);
    return first(env, 'SELECT * FROM images WHERE id = ?', id);
}

/** Recompute tiles_ready / flagged_tiles for every board whose draft uses `imageId`. */
export async function recountBoardsUsing(env, imageId) {
    const boards = await all(env, 'SELECT id, draft_json FROM boards WHERE draft_json LIKE ?', `%"${imageId}"%`);
    for (const b of boards) {
        const draft = JSON.parse(b.draft_json);
        const stats = boardStats(draft, await imagesByIds(env, imageIdsOf(draft)));
        await env.DB.prepare('UPDATE boards SET tiles_ready = ?, flagged_tiles = ? WHERE id = ?')
            .bind(stats.tilesReady, stats.flaggedTiles, b.id).run();
    }
}

/** Known license code, a CC NC/ND variant (kept so it reads as blocked), or 'unknown'. */
function normalizeLicense(code) {
    const c = String(code || '').trim().toLowerCase();
    if (LICENSES[c]) return c;
    if (/^cc-by(-(sa|nc|nd))*(-\d\.\d)?$/.test(c)) return c;
    return 'unknown';
}

function cleanText(v, max) {
    const s = v == null ? '' : String(v).trim();
    return s ? s.slice(0, max) : null;
}

function cleanUrl(v) {
    const s = cleanText(v, 2000);
    if (!s) return null;
    try {
        const u = new URL(s);
        return /^https?:$/.test(u.protocol) ? u.toString() : null;
    } catch {
        return null;
    }
}

function safeArray(text) {
    try {
        const v = JSON.parse(text ?? '[]');
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}
