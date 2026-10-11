// src/shared/rights.js
//
// Picture rights vocabulary, shared by the Worker, the admin and the content
// tools — ONE place that decides what a license means for us (PROPOSAL.md §7.1).
// -----------------------------------------------------------------------------
// A picture's rights_status is:
//   ok       ✅ usable as-is (maybe with a credit line)
//   flagged  ⚠️ allowed, but someone should double-check — each flag says why
//   blocked  ❌ its license forbids how we use pictures (ads = commercial use;
//              the swirl = a modification), so it can't be published
// -----------------------------------------------------------------------------

/** Why a picture needs a second look. Shown on the tile and counted on the dashboard. */
export const RIGHTS_FLAGS = {
    rights_unknown: {
        label: 'Rights unknown',
        reason: 'We don’t know where this picture came from or its license. Verify or replace it before public beta.',
    },
    share_alike: {
        label: 'Share-alike license',
        reason: 'CC BY-SA: show the credit and license; our swirled version is shared under the same license.',
    },
    trademark: {
        label: 'Logo / trademark',
        reason: 'Trademark law applies even to public-domain logos. Fine for trivia; double-check before running ads.',
    },
    identifiable_person: {
        label: 'Identifiable person',
        reason: 'Real people have publicity rights. Never imply they endorse the game; double-check before running ads.',
    },
    answer_visible: {
        label: 'Answer visible',
        reason: 'The picture shows text that gives the answer away.',
    },
};

const BY_VERSIONS = ['2.0', '2.5', '3.0', '4.0'];

/**
 * License code → what it means for us.
 * attribution: the credit line must be shown to players.
 */
export const LICENSES = {
    'cc0': { label: 'CC0 (public domain)', status: 'ok', attribution: false },
    'pdm': { label: 'Public Domain Mark', status: 'ok', attribution: false },
    'us-gov': { label: 'US government work (public domain)', status: 'ok', attribution: false },
    'unsplash': { label: 'Unsplash License', status: 'ok', attribution: false },
    'pexels': { label: 'Pexels License', status: 'ok', attribution: false },
    'pixabay': { label: 'Pixabay Content License', status: 'ok', attribution: false },
    'permission': { label: 'Written permission (evidence on file)', status: 'ok', attribution: false },
    ...Object.fromEntries(BY_VERSIONS.map(v => [`cc-by-${v}`, { label: `CC BY ${v}`, status: 'ok', attribution: true }])),
    ...Object.fromEntries(BY_VERSIONS.map(v => [`cc-by-sa-${v}`, { label: `CC BY-SA ${v}`, status: 'flagged', attribution: true, flags: ['share_alike'] }])),
    'unknown': { label: 'Unknown', status: 'flagged', attribution: false, flags: ['rights_unknown'] },
};

const BLOCKED_NC = { status: 'blocked', reason: 'Non-commercial only — ads count as commercial use.' };
const BLOCKED_ND = { status: 'blocked', reason: 'No modifications allowed — the swirl modifies the picture.' };

/**
 * What a license code means for us. Any NonCommercial or NoDerivatives
 * Creative Commons variant (cc-by-nc-4.0, cc-by-nc-nd-3.0, …) is blocked;
 * anything unrecognized is treated as "unknown".
 * @param {string} code
 */
export function licenseInfo(code) {
    const c = String(code || '').toLowerCase();
    if (LICENSES[c]) return LICENSES[c];
    if (/^cc-by(-[a-z]+)*-nc\b/.test(c) || /^cc-by-.*-nc-/.test(c)) return { label: c.toUpperCase(), ...BLOCKED_NC };
    if (/^cc-by(-[a-z]+)*-nd\b/.test(c)) return { label: c.toUpperCase(), ...BLOCKED_ND };
    return LICENSES.unknown;
}

const STATUS_RANK = { ok: 0, flagged: 1, blocked: 2 };

/**
 * Combine a license with any extra flags (trademark, person, …) into the
 * picture's rights: { status, flags }.
 * @param {{ license?: string, flags?: string[] }} input
 */
export function assessRights({ license = 'unknown', flags = [] } = {}) {
    const lic = licenseInfo(license);
    const allFlags = [...new Set([...(lic.flags || []), ...flags])].filter(f => RIGHTS_FLAGS[f]);
    let status = lic.status;
    if (allFlags.length && STATUS_RANK[status] < STATUS_RANK.flagged) status = 'flagged';
    return { status, flags: allFlags };
}

/**
 * The credit line players see for a picture, or null when none is needed.
 * Prefers the stored attribution text; falls back to "creator · license".
 * @param {{ license?: string, attribution?: string, creator?: string }} image
 */
export function creditFor(image) {
    const lic = licenseInfo(image?.license);
    if (!lic?.attribution) return null;
    if (image.attribution) return image.attribution;
    return [image.creator, lic.label].filter(Boolean).join(' · ') || null;
}
