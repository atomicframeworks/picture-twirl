// tools/content/lib/license.mjs
//
// Turn each source's license metadata into OUR license codes + rights flags
// (src/shared/rights.js decides what those mean: ok / flagged / blocked).

import { assessRights } from '../../../src/shared/rights.js';

export const stripHtml = (s) => String(s ?? '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** "CC BY-SA 4.0", "cc-by-sa-4.0", "Public domain", "CC0" … → our code. */
export function licenseCode(raw) {
    const s = String(raw ?? '').toLowerCase().replace(/[_\s]+/g, '-');
    if (!s) return 'unknown';
    if (/^(cc0|cc-zero)/.test(s) || s.includes('cc0')) return 'cc0';
    if (/(^|-)pd($|-)|public-domain|pdm/.test(s)) return 'pdm';
    const m = s.match(/cc-?by(-(sa|nc|nd))*(-(\d\.\d))?/);
    if (m) {
        const parts = m[0].replace(/^cc-?/, 'cc-').match(/cc-by((?:-(?:sa|nc|nd))*)(?:-(\d\.\d))?/);
        const mods = parts[1] || '';
        const ver = parts[2] || '4.0';
        return `cc-by${mods}-${ver}`;
    }
    return 'unknown';
}

/** The rights summary we attach to a candidate. */
export function rightsOf(candidate) {
    return assessRights({ license: candidate.license, flags: candidate.flags || [] });
}

/** Wikimedia Commons extmetadata → license fields. */
export function fromCommons(ext = {}) {
    const v = (k) => ext[k]?.value;
    const restrictions = String(v('Restrictions') || '').toLowerCase();
    const flags = [];
    if (restrictions.includes('trademark')) flags.push('trademark');
    if (restrictions.includes('personality')) flags.push('identifiable_person');
    const license = licenseCode(v('License') || v('LicenseShortName'));
    const creator = stripHtml(v('Artist')) || null;
    const creatorUrl = String(v('Artist') || '').match(/href="([^"]+)"/)?.[1] || null;
    return {
        license,
        licenseLabel: stripHtml(v('LicenseShortName')) || null,
        licenseUrl: v('LicenseUrl') || null,
        creator: creator?.slice(0, 200) || null,
        creatorUrl: creatorUrl?.startsWith('//') ? `https:${creatorUrl}` : creatorUrl,
        attribution: v('AttributionRequired') === 'true' && creator
            ? `${creator} · ${stripHtml(v('LicenseShortName')) || license.toUpperCase()} · Wikimedia Commons`.slice(0, 300)
            : null,
        flags,
    };
}

/** Openverse image result → license fields. */
export function fromOpenverse(item = {}) {
    const lic = String(item.license || '').toLowerCase();
    const license = lic === 'cc0' ? 'cc0' : lic === 'pdm' ? 'pdm' : licenseCode(`cc-${lic}-${item.license_version || '4.0'}`);
    return {
        license,
        licenseLabel: `${lic.toUpperCase()} ${item.license_version || ''}`.trim(),
        licenseUrl: item.license_url || null,
        creator: item.creator ? String(item.creator).slice(0, 200) : null,
        creatorUrl: item.creator_url || null,
        attribution: item.attribution ? String(item.attribution).slice(0, 300) : null,
        flags: [],
    };
}
