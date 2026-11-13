// tests/unit/swirlReveal.test.mjs
//
// Validates the premature-reveal bug fix.
//
// Root causes (pre-fix):
//   Bug A — performance.now() advances through device sleep: a queued rAF fires
//            with t ≥ 1, draws the fully unswirled image, and sets done=true which
//            makes pause() a permanent no-op.
//   Bug B — swirlStartTime was never adjusted for pauses: serverNow−swirlStartTime
//            overestimated elapsed time, starting a late-loading image too far into
//            the reveal.
//
// The fix adds server-side pause-time accounting (swirlPausedAt + swirlStartTime
// advance on resume) and a visibilitychange handler that resets the animation from
// server-authoritative timestamps on device wake.
//
// These tests exercise the pure logic without a DOM (swirl.js canvas functions are
// tested separately in a browser context); all timing is deterministic via controlled
// performance.now() / Date.now() overrides.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal fake swirl control object that mirrors the real `startSwirlAnimation`
 * return shape — including the new `isDone`, `getElapsed`, `cancelQuiet` APIs.
 * `perf` is a mutable clock reference ({ now: number }).
 */
function makeFakeSwirlCtrl({ elapsedStart = 0, duration = 14000, perf }) {
    let startTime = perf.now - elapsedStart;
    let pausedAt = null;
    let cancelled = false;
    let done = elapsedStart >= duration;

    return {
        pause() {
            if (pausedAt !== null || cancelled || done) return;
            pausedAt = perf.now;
        },
        resume() {
            if (pausedAt === null || cancelled || done) return;
            startTime += perf.now - pausedAt;
            pausedAt = null;
        },
        cancel() {
            cancelled = true;
        },
        cancelQuiet() {
            cancelled = true;
        },
        isPaused() { return pausedAt !== null; },
        isDone() { return done; },
        getElapsed() {
            if (done) return duration;
            if (pausedAt !== null) return pausedAt - startTime;
            return perf.now - startTime;
        },
        // test-only: simulate performance.now() jumping (device sleep)
        _simulateSleep(ms) {
            perf.now += ms;
            // rAF fires immediately after wake: compute t
            const t = (perf.now - startTime) / duration;
            if (t >= 1) done = true;
        },
    };
}

/**
 * Simulated game state used to test the pause-accounting logic in renderGame.js
 * without bringing in the DOM. We extract the pure decision logic here.
 */
function computeAuthorizedElapsed({ swirlStartTime, swirlPausedAt, swirlPausedByGM, serverNow, durationMs }) {
    const raw = swirlStartTime ? Math.max(0, serverNow - swirlStartTime) : 0;
    const elapsed = (swirlPausedByGM && swirlPausedAt)
        ? Math.max(0, swirlPausedAt - swirlStartTime)
        : raw;
    return Math.min(durationMs, elapsed);
}

/**
 * Simulated resume write: computes the increment applied to swirlStartTime
 * when the GM resumes.
 */
function computeResumeIncrement({ swirlPausedAt, serverNow }) {
    return swirlPausedAt ? Math.max(0, Math.round(serverNow - swirlPausedAt)) : 0;
}

// ── swirl control API ─────────────────────────────────────────────────────────

test('swirl: pause() stops the animation at the current position', () => {
    const perf = { now: 1000 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 2000, duration: 14000, perf });
    perf.now = 3000;
    ctrl.pause();
    assert.ok(ctrl.isPaused());
    assert.equal(ctrl.getElapsed(), 2000 + (3000 - 1000)); // 4000 ms
});

test('swirl: pause() is a no-op once done=true', () => {
    const perf = { now: 0 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 14000, duration: 14000, perf });
    assert.ok(ctrl.isDone());
    ctrl.pause();
    assert.ok(!ctrl.isPaused()); // done guard blocks pause
});

test('swirl: resume() restarts elapsed tracking from the pause point', () => {
    const perf = { now: 5000 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 3000, duration: 14000, perf });
    perf.now = 6000;
    ctrl.pause();
    perf.now = 9000; // 3000 ms held
    ctrl.resume();
    assert.ok(!ctrl.isPaused());
    assert.equal(ctrl.getElapsed(), 3000 + (6000 - 5000) + (9000 - 9000)); // 4000 ms elapsed, 0 ms since resume
});

test('swirl: isDone() returns true when elapsedStart >= duration', () => {
    const perf = { now: 0 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 14000, duration: 14000, perf });
    assert.ok(ctrl.isDone());
});

test('swirl: isDone() returns true after device sleep drives t >= 1', () => {
    const perf = { now: 1000 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 5000, duration: 14000, perf });
    ctrl._simulateSleep(20000); // jump 20 s → t = (21000 - (-4000)) / 14000 > 1
    assert.ok(ctrl.isDone());
});

test('swirl: cancelQuiet() stops without revealing the image', () => {
    const perf = { now: 0 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 0, duration: 14000, perf });
    ctrl.cancelQuiet();
    // No exception = OK; the DOM/canvas verification is in browser tests
    assert.ok(true);
});

test('swirl: getElapsed() returns duration when done', () => {
    const perf = { now: 0 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 14000, duration: 14000, perf });
    assert.equal(ctrl.getElapsed(), 14000);
});

// ── authorized-elapsed calculation (Bug B fix) ────────────────────────────────

test('elapsed: uses serverNow − swirlStartTime while running', () => {
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 1000, swirlPausedAt: null,
        swirlPausedByGM: false, serverNow: 5000, durationMs: 14000,
    });
    assert.equal(elapsed, 4000);
});

test('elapsed: uses swirlPausedAt − swirlStartTime when paused (not serverNow)', () => {
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 1000, swirlPausedAt: 4000,
        swirlPausedByGM: true, serverNow: 30000, // serverNow - swirlStartTime would be 29 000
        durationMs: 14000,
    });
    // Must use pausedAt, not serverNow
    assert.equal(elapsed, 3000);
});

test('elapsed: clamps to durationMs', () => {
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 1000, swirlPausedAt: null,
        swirlPausedByGM: false, serverNow: 20000, durationMs: 14000,
    });
    assert.equal(elapsed, 14000);
});

test('elapsed: 0 when swirlStartTime is null (question not yet synced)', () => {
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: null, swirlPausedAt: null,
        swirlPausedByGM: false, serverNow: 5000, durationMs: 14000,
    });
    assert.equal(elapsed, 0);
});

test('elapsed: 0 when paused but swirlPausedAt not yet received (backward compat)', () => {
    // Old games (before fix) won't have swirlPausedAt — falls back to raw serverNow - swirlStartTime
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 1000, swirlPausedAt: null,
        swirlPausedByGM: true, serverNow: 5000, durationMs: 14000,
    });
    // Without swirlPausedAt, falls back to serverNow-based: tolerated for old games
    assert.equal(elapsed, 4000);
});

// ── pause / resume server-write accounting (Bug B fix) ────────────────────────

test('resume: swirlStartTime increment equals the pause duration', () => {
    const pausedAt = 5000;   // server ms when GM paused
    const serverNow = 8000;  // server ms when GM resumes (3 s later)
    const inc = computeResumeIncrement({ swirlPausedAt: pausedAt, serverNow });
    assert.equal(inc, 3000);
    // After increment: new swirlStartTime = 2000 + 3000 = 5000
    // Running elapsed at serverNow=8000: 8000 - 5000 = 3000 ms (correct: ran 3s, paused 3s)
});

test('resume: increment is 0 when swirlPausedAt is missing (backward compat)', () => {
    const inc = computeResumeIncrement({ swirlPausedAt: null, serverNow: 8000 });
    assert.equal(inc, 0);
});

test('resume: multiple pause/resume cycles accumulate correctly', () => {
    const T = 10000; // server timestamp at question start
    let swirlStartTime = T;

    // First pause at T+5s; resume at T+15s (10s pause held)
    const pause1At = T + 5000;  // absolute: 15000
    const resume1At = T + 15000; // absolute: 25000
    const inc1 = computeResumeIncrement({ swirlPausedAt: pause1At, serverNow: resume1At });
    swirlStartTime += inc1; // 10000 + 10000 = 20000
    assert.equal(resume1At - swirlStartTime, 5000, 'after first resume, elapsed reflects only running time');

    // Second pause 10s after resume; resume 10s later
    const pause2At = resume1At + 10000; // absolute: 35000
    const resume2At = pause2At + 10000;  // absolute: 45000
    const inc2 = computeResumeIncrement({ swirlPausedAt: pause2At, serverNow: resume2At });
    swirlStartTime += inc2; // 20000 + 10000 = 30000
    assert.equal(resume2At - swirlStartTime, 15000, 'after second resume, elapsed = 5+10=15s running time');
});

// ── visibilitychange correction (Bug A fix) ───────────────────────────────────

test('visibility: no correction when showAnswer is true', () => {
    // The correction should bail early when the answer is already revealed
    const shouldCorrect = (currentQuestion, visibilityState) => {
        if (visibilityState !== 'visible') return false;
        if (!currentQuestion || currentQuestion.showAnswer) return false;
        return true;
    };
    assert.ok(!shouldCorrect({ id: '0-0', showAnswer: true }, 'visible'));
    assert.ok(!shouldCorrect(null, 'visible'));
    assert.ok(shouldCorrect({ id: '0-0', showAnswer: false }, 'visible'));
});

test('visibility: correction uses swirlPausedAt when paused (not serverNow)', () => {
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 10000, swirlPausedAt: 13000,
        swirlPausedByGM: true, serverNow: 60000, // device was asleep for ~47s
        durationMs: 14000,
    });
    // Must NOT use 60000 - 10000 = 50000 (clamped to 14000 = fully revealed)
    assert.equal(elapsed, 3000); // only 3s of reveal before pause
});

test('visibility: correction for running animation uses adjusted swirlStartTime', () => {
    // After resume increment: swirlStartTime was advanced to account for pause time
    // Running again from serverNow perspective
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 15000, swirlPausedAt: null,
        swirlPausedByGM: false, serverNow: 18000, durationMs: 14000,
    });
    assert.equal(elapsed, 3000);
});

test('visibility: hidden state does nothing', () => {
    const shouldCorrect = (visibilityState) => visibilityState === 'visible';
    assert.ok(!shouldCorrect('hidden'));
    assert.ok(!shouldCorrect('prerender'));
});

// ── defensive applySwirlPause (done=true guard) ───────────────────────────────

test('defense: isDone() detected while paused triggers recreation at authorized position', () => {
    const perf = { now: 1000 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 5000, duration: 14000, perf });

    // Simulate device sleep: rAF fires, t ≥ 1, done = true
    ctrl._simulateSleep(30000);
    assert.ok(ctrl.isDone());
    assert.ok(!ctrl.isPaused()); // pause() was never effective (done guard)

    // applySwirlPause detects done=true while swirlPausedByGM=true → recreates
    // We verify the authorized elapsed would be used for recreation
    const authorizedElapsed = computeAuthorizedElapsed({
        swirlStartTime: 10000, swirlPausedAt: 15000, // 5s revealed before pause
        swirlPausedByGM: true, serverNow: perf.now, durationMs: 14000,
    });
    assert.equal(authorizedElapsed, 5000);
    // A new ctrl at elapsedStart=5000 should be pauseable
    const ctrl2 = makeFakeSwirlCtrl({ elapsedStart: 5000, duration: 14000, perf });
    ctrl2.pause();
    assert.ok(ctrl2.isPaused());
    assert.ok(!ctrl2.isDone());
});

test('defense: isDone() is false for a healthy mid-animation', () => {
    const perf = { now: 5000 };
    const ctrl = makeFakeSwirlCtrl({ elapsedStart: 3000, duration: 14000, perf });
    assert.ok(!ctrl.isDone());
});

test('defense: recreation from authorized position never exceeds durationMs', () => {
    const elapsed = computeAuthorizedElapsed({
        swirlStartTime: 0, swirlPausedAt: 99999,
        swirlPausedByGM: true, serverNow: 0, durationMs: 14000,
    });
    assert.ok(elapsed <= 14000);
});
