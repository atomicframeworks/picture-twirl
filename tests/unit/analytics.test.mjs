// tests/unit/analytics.test.mjs
//
// Unit tests for src/analytics.js.
//
// What can be tested in Node.js (no DOM, no Vite env):
//   - sanitizeUrl: pure function, no dependencies
//   - sanitizeEventProperties: pure function, covers the before_send logic
//   - initAnalytics: no-op when key is absent (natural in Node.js — import.meta.env
//     is undefined, so VITE_POSTHOG_KEY is always undefined here)
//   - capture / capturePageview: no-op when not initialised
//
// What is tested elsewhere:
//   - that window.location.hash/href are never mutated (e2e; window not in Node.js)
//   - PostHog network calls (integration; require a real key)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeUrl,
    sanitizeEventProperties,
    initAnalytics,
    capture,
    capturePageview,
} from '../../src/analytics.js';

// ---------------------------------------------------------------------------
// sanitizeUrl — pure URL stripping
// ---------------------------------------------------------------------------

test('sanitizeUrl strips hash fragment from URL', () => {
    assert.equal(
        sanitizeUrl('https://play.picture-twirl.workers.dev/#ABC123'),
        'https://play.picture-twirl.workers.dev/'
    );
});

test('sanitizeUrl strips game invitation-code fragment', () => {
    assert.equal(
        sanitizeUrl('http://localhost:3000/#FAVYDN'),
        'http://localhost:3000/'
    );
});

test('sanitizeUrl strips query string from URL', () => {
    assert.equal(
        sanitizeUrl('https://play.picture-twirl.workers.dev/?ref=email&code=XYZ'),
        'https://play.picture-twirl.workers.dev/'
    );
});

test('sanitizeUrl strips both hash and query from URL', () => {
    assert.equal(
        sanitizeUrl('https://example.com/path?foo=bar#GAMECODE'),
        'https://example.com/path'
    );
});

test('sanitizeUrl preserves origin and pathname', () => {
    assert.equal(
        sanitizeUrl('https://play.picture-twirl.workers.dev/admin/'),
        'https://play.picture-twirl.workers.dev/admin/'
    );
});

test('sanitizeUrl returns null for an invalid URL', () => {
    assert.equal(sanitizeUrl('not-a-url'), null);
});

test('sanitizeUrl returns null for a relative path', () => {
    assert.equal(sanitizeUrl('/just/a/path'), null);
});

test('sanitizeUrl returns null for non-string input', () => {
    assert.equal(sanitizeUrl(null), null);
    assert.equal(sanitizeUrl(42), null);
    assert.equal(sanitizeUrl(undefined), null);
});

test('sanitizeUrl does not modify its input string', () => {
    const original = 'https://example.com/page#GAMECODE';
    sanitizeUrl(original);
    assert.equal(original, 'https://example.com/page#GAMECODE');
});

// ---------------------------------------------------------------------------
// sanitizeEventProperties — covers the before_send logic exhaustively
//
// This tests the complete set of properties PostHog may include:
//   - $current_url               (the page URL when the event fires)
//   - $referrer                  (document.referrer)
//   - $initial_referrer          (persistent super-property from first visit)
//   - $initial_current_url       (first page URL, stored persistently in localStorage)
//   - $session_entry_url         (SDK name for the session-entry current URL)
//   - $session_entry_current_url (PostHog Cloud may use this name instead)
//   - $session_entry_referrer    (session-entry referring URL)
// ---------------------------------------------------------------------------

const GAME_URL = 'https://play.picture-twirl.workers.dev/#SECRT';
const SAFE_URL = 'https://play.picture-twirl.workers.dev/';
const REFERRER_WITH_CODE = 'https://somewhere.com/page#GAMECODE';
const SAFE_REFERRER = 'https://somewhere.com/page';

test('sanitizeEventProperties strips hash from $current_url', () => {
    const result = sanitizeEventProperties({ $current_url: GAME_URL });
    assert.equal(result.$current_url, SAFE_URL);
});

test('sanitizeEventProperties strips hash from $referrer', () => {
    const result = sanitizeEventProperties({ $referrer: REFERRER_WITH_CODE });
    assert.equal(result.$referrer, SAFE_REFERRER);
});

test('sanitizeEventProperties strips hash from $initial_referrer', () => {
    const result = sanitizeEventProperties({ $initial_referrer: REFERRER_WITH_CODE });
    assert.equal(result.$initial_referrer, SAFE_REFERRER);
});

test('sanitizeEventProperties strips hash from $initial_current_url (persistent super-property)', () => {
    const result = sanitizeEventProperties({ $initial_current_url: GAME_URL });
    assert.equal(result.$initial_current_url, SAFE_URL);
});

test('sanitizeEventProperties strips hash from $session_entry_url (SDK name)', () => {
    const result = sanitizeEventProperties({ $session_entry_url: GAME_URL });
    assert.equal(result.$session_entry_url, SAFE_URL);
});

test('sanitizeEventProperties strips hash from $session_entry_current_url (Cloud name)', () => {
    const result = sanitizeEventProperties({ $session_entry_current_url: GAME_URL });
    assert.equal(result.$session_entry_current_url, SAFE_URL);
});

test('sanitizeEventProperties strips hash from $session_entry_referrer', () => {
    const result = sanitizeEventProperties({ $session_entry_referrer: REFERRER_WITH_CODE });
    assert.equal(result.$session_entry_referrer, SAFE_REFERRER);
});

test('sanitizeEventProperties strips query string from URL properties', () => {
    const result = sanitizeEventProperties({
        $current_url: 'https://example.com/?utm_source=email',
    });
    assert.equal(result.$current_url, 'https://example.com/');
});

test('sanitizeEventProperties strips both hash and query from URL properties', () => {
    const result = sanitizeEventProperties({
        $current_url: 'https://example.com/path?foo=bar#ABC',
    });
    assert.equal(result.$current_url, 'https://example.com/path');
});

test('sanitizeEventProperties sanitizes all URL properties in one event simultaneously', () => {
    const props = {
        $current_url: GAME_URL,
        $referrer: REFERRER_WITH_CODE,
        $initial_referrer: REFERRER_WITH_CODE,
        $session_entry_url: GAME_URL,
        $session_entry_current_url: GAME_URL,
        $session_entry_referrer: REFERRER_WITH_CODE,
    };
    const result = sanitizeEventProperties(props);
    assert.equal(result.$current_url, SAFE_URL);
    assert.equal(result.$referrer, SAFE_REFERRER);
    assert.equal(result.$initial_referrer, SAFE_REFERRER);
    assert.equal(result.$session_entry_url, SAFE_URL);
    assert.equal(result.$session_entry_current_url, SAFE_URL);
    assert.equal(result.$session_entry_referrer, SAFE_REFERRER);
});

test('sanitizeEventProperties preserves $direct (non-URL attribution value)', () => {
    const result = sanitizeEventProperties({ $referrer: '$direct' });
    assert.equal(result.$referrer, '$direct');
});

test('sanitizeEventProperties preserves non-URL string properties', () => {
    const props = {
        $browser: 'Chrome',
        $os: 'Mac OS X',
        $os_version: '14.0',
        $device_type: 'Desktop',
        $lib: 'posthog-js',
        $lib_version: '1.438.12',
        distinct_id: 'anon-uid-xyz',
        $session_id: 'sess-abc',
        environment: 'development',
        analytics_schema_version: '1.1',
        build_version: 'dev',
    };
    const result = sanitizeEventProperties(props);
    assert.deepEqual(result, props);
});

test('sanitizeEventProperties preserves numeric and boolean properties', () => {
    const props = {
        $screen_height: 1080,
        $screen_width: 1920,
        $viewport_height: 900,
        $viewport_width: 1440,
        $is_identified: false,
        score: 300,
    };
    const result = sanitizeEventProperties(props);
    assert.deepEqual(result, props);
});

test('sanitizeEventProperties preserves $referring_domain (domain, not URL)', () => {
    const result = sanitizeEventProperties({ $referring_domain: 'somewhere.com' });
    assert.equal(result.$referring_domain, 'somewhere.com');
});

test('sanitizeEventProperties preserves $pathname (path, not URL)', () => {
    const result = sanitizeEventProperties({ $pathname: '/admin/' });
    assert.equal(result.$pathname, '/admin/');
});

test('sanitizeEventProperties does not mutate the input object', () => {
    const props = { $current_url: GAME_URL };
    const result = sanitizeEventProperties(props);
    assert.equal(props.$current_url, GAME_URL, 'input must not be mutated');
    assert.equal(result.$current_url, SAFE_URL, 'output must be sanitized');
    assert.notEqual(result, props, 'must return a new object');
});

test('sanitizeEventProperties returns null/undefined input unchanged', () => {
    assert.equal(sanitizeEventProperties(null), null);
    assert.equal(sanitizeEventProperties(undefined), undefined);
});

test('sanitizeEventProperties handles a future unknown $session_entry_* URL property', () => {
    // Any future property whose value is an absolute URL must be sanitized,
    // even if its key was not known when this code was written.
    const result = sanitizeEventProperties({
        $session_entry_future_url_prop: GAME_URL,
    });
    assert.equal(result.$session_entry_future_url_prop, SAFE_URL);
});

// ---------------------------------------------------------------------------
// initAnalytics — no-op when VITE_POSTHOG_KEY is absent
// ---------------------------------------------------------------------------

test('initAnalytics returns without error when key is absent', () => {
    assert.doesNotThrow(() => initAnalytics(undefined));
});

test('initAnalytics accepts a uid without error when key is absent', () => {
    assert.doesNotThrow(() => initAnalytics('user-uid-123'));
});

test('initAnalytics can be called multiple times without error', () => {
    assert.doesNotThrow(() => {
        initAnalytics('uid-1');
        initAnalytics('uid-2');
        initAnalytics('uid-3');
    });
});

// ---------------------------------------------------------------------------
// capture / capturePageview — no-op when not initialised
// ---------------------------------------------------------------------------

test('capture returns without error when not initialised', () => {
    assert.doesNotThrow(() => capture('test_event'));
});

test('capture accepts properties without error when not initialised', () => {
    assert.doesNotThrow(() => capture('test_event', { foo: 'bar' }));
});

test('capturePageview returns without error when not initialised', () => {
    assert.doesNotThrow(() => capturePageview());
});

test('capturePageview can be called multiple times without error', () => {
    assert.doesNotThrow(() => {
        capturePageview();
        capturePageview();
        capturePageview();
    });
});
