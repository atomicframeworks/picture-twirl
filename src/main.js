// src/main.js
//
// Picture Twirl — App Entry
// -----------------------------------------------------------------------------
// Responsibilities
// - Call boot() once the DOM is ready.
// - Keep global state minimal; expose boot on window for debugging.
// - Log helpful errors without crashing the page.
// -----------------------------------------------------------------------------
//
// Depends on: src/startup/boot.js (which wires Firebase + flows/views)

import { boot } from './startup/boot.js';

// Run once DOM is interactive
function start() {
  try {
    boot();
  } catch (err) {
    console.error('Fatal: boot() threw before catching:', err);
    alert('Initialization failed. See console for details.');
  }
}

// Prefer DOMContentLoaded; if already loaded, start immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

// Optional: expose for manual reboots during development
// (e.g., in devtools: window.PictureTwirl.boot())
if (typeof window !== 'undefined') {
  window.PictureTwirl = Object.assign(window.PictureTwirl || {}, { boot });
}
