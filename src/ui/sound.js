// src/ui/sound.js
//
// Lightweight sound effects via the Web Audio API — no asset files, works
// offline. Browsers require a user gesture before audio can play; call
// unlockAudio() from a gesture (we wire it to the first pointerdown).

let ctx = null;

function ac() {
    if (typeof window === 'undefined') return null;
    if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (C) ctx = new C();
    }
    return ctx;
}

/** Resume the audio context (call from a user gesture). */
export function unlockAudio() {
    const c = ac();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function tone(freq, startOffset, dur, type = 'sine', gain = 0.18) {
    const c = ac();
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = c.currentTime + startOffset;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

/** Buzzer: punchy low square blip. */
export function playBuzz() {
    unlockAudio();
    tone(180, 0, 0.22, 'square', 0.16);
    tone(120, 0.04, 0.28, 'square', 0.12);
}

/** Reveal chime: two rising sine notes. */
export function playReveal() {
    unlockAudio();
    tone(660, 0, 0.18, 'sine', 0.16);
    tone(990, 0.12, 0.22, 'sine', 0.14);
}

/** Correct/celebration: quick ascending arpeggio. */
export function playCorrect() {
    unlockAudio();
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.24, 'triangle', 0.15));
}
