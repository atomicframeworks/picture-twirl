/**
 * Cryptographically secure random ID generator for analytics correlation.
 *
 * Identifiers are non-secret opaque values used to correlate telemetry events
 * across clients without exposing game invitation codes. They are never derived
 * from game codes, participant UIDs, names, or timestamps.
 *
 * Uses crypto.randomUUID() where available (all modern browsers and Workers);
 * falls back to crypto.getRandomValues() for older runtimes.
 *
 * @returns {string}
 */
export function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
