// src/analytics.js
//
// Centralised PostHog wrapper for Picture Twirl.
// All telemetry goes through this module — nothing imports posthog-js directly.
//
// Exports (public API):
//   initAnalytics(uid)               — call once after waitForAuthReady(); no-op if key absent
//   capture(event, properties)       — send a named event; no-op if not initialised
//   capturePageview()                — send one explicit $pageview; no-op on repeated calls
//   sanitizeUrl(raw)                 — exported for unit tests
//   sanitizeEventProperties(props)   — exported for unit tests
//
// Privacy guarantees enforced here:
//   - autocapture / session recording / heatmaps / web vitals all disabled
//   - anonymous identity via bootstrap.distinctID (no $identify event)
//   - disable_capture_url_hashes: true — PostHog strips URL fragments before
//     storing session-entry properties (first line of defence)
//   - before_send scans EVERY property value in every captured event; any value
//     that is an absolute HTTP/HTTPS URL is stripped of its hash and query string
//     before leaving the browser (covers $current_url, $referrer, $initial_referrer,
//     $session_entry_url, $session_entry_current_url, $session_entry_referrer,
//     $initial_current_url, and any future URL-bearing properties PostHog adds)
//   - window.location is never modified

/* global __BUILD_VERSION__ */

import posthog from 'posthog-js';

let initialized = false;
let pageviewSent = false;

// ---------------------------------------------------------------------------
// URL sanitisation — two exported helpers, one private event sanitiser
// ---------------------------------------------------------------------------

/**
 * Return origin + pathname from a URL string, discarding hash and query.
 * Returns null for non-strings or values that don't parse as absolute URLs.
 * Exported for unit tests.
 */
export function sanitizeUrl(raw) {
    if (typeof raw !== 'string') return null;
    try {
        const u = new URL(raw);
        return u.origin + u.pathname;
    } catch {
        return null;
    }
}

/**
 * Return true when val is an absolute HTTP/HTTPS URL string.
 * Non-URL attribution values such as '$direct' are not URLs.
 */
function isAbsoluteUrl(val) {
    if (typeof val !== 'string') return false;
    return val.startsWith('http://') || val.startsWith('https://');
}

/**
 * Sanitize all URL-valued properties in a PostHog properties object.
 * Any value that looks like an absolute URL has its hash and query stripped.
 * Non-URL values (browser name, OS, country, '$direct', session IDs, numbers…)
 * are returned unchanged.
 *
 * Returns a NEW object — the input is not mutated.
 * Exported for unit tests; used internally by beforeSend.
 *
 * @param {Record<string, unknown>} props
 * @returns {Record<string, unknown>}
 */
export function sanitizeEventProperties(props) {
    if (!props || typeof props !== 'object') return props;
    const out = {};
    for (const [key, val] of Object.entries(props)) {
        out[key] = isAbsoluteUrl(val) ? (sanitizeUrl(val) ?? val) : val;
    }
    return out;
}

/**
 * PostHog before_send callback. Sanitizes every URL-valued property on every
 * event before it leaves the browser. This is the centralised privacy gate.
 */
function beforeSend(event) {
    if (!event) return null;
    if (event.properties && typeof event.properties === 'object') {
        event.properties = sanitizeEventProperties(event.properties);
    }
    return event;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise PostHog with privacy-safe defaults.
 * No-op when VITE_POSTHOG_KEY is absent or when called more than once.
 * Safe to call on every boot() — the guard prevents duplicate initialisation.
 *
 * @param {string|undefined} uid  Anonymous player UID from realtime/client.js
 */
export function initAnalytics(uid) {
    // import.meta.env is undefined in Node.js (unit tests); ?. makes this
    // return undefined instead of throwing, so initAnalytics() is naturally
    // a no-op in the test runner.
    const key = import.meta.env?.VITE_POSTHOG_KEY;
    if (!key || initialized) return;
    initialized = true;

    try {
        posthog.init(key, {
            api_host: import.meta.env?.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',
            // disable_capture_url_hashes tells PostHog's own capture layer to strip
            // URL fragments from $current_url when it records the session entry
            // properties — first line of defence before before_send runs.
            disable_capture_url_hashes: true,
            capture_pageview: false,
            capture_pageleave: false,
            autocapture: false,
            disable_session_recording: true,
            capture_heatmaps: false,
            web_vitals: false,
            ...(uid ? { bootstrap: { distinctID: uid, isIdentifiedID: false } } : {}),
            before_send: beforeSend,
        });

        posthog.register({
            analytics_schema_version: '1.1',
            build_version: __BUILD_VERSION__,
            environment: import.meta.env?.VITE_APP_ENV ?? 'development',
        });
    } catch (err) {
        console.warn('[analytics] init failed:', err);
        initialized = false;
    }
}

/**
 * Capture a named event. No-op when analytics is not initialised.
 * Never throws — safe to call from any gameplay code.
 *
 * @param {string} event
 * @param {object} [properties]
 */
export function capture(event, properties = {}) {
    if (!initialized) return;
    try {
        posthog.capture(event, properties);
    } catch { /* never propagate into gameplay */ }
}

/**
 * Send one explicit $pageview for the current page.
 * Hash and query are stripped before the URL is sent to PostHog;
 * window.location itself is never modified.
 *
 * No-op after the first call — prevents duplicate pageviews when
 * window.PictureTwirl.boot() is called more than once during a session.
 */
export function capturePageview() {
    if (!initialized || pageviewSent) return;
    pageviewSent = true;
    try {
        posthog.capture('$pageview', {
            $current_url: sanitizeUrl(window.location.href) ?? window.location.origin + '/',
        });
    } catch { /* never propagate into boot */ }
}
