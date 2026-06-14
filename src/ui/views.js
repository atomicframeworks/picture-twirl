// src/ui/views.js
//
// Picture Twirl — View Controller (Home / Create / Join)
// -----------------------------------------------------------------------------
// Responsibilities
// - Single source of truth for which root view is visible.
// - Toggle visibility using the native [hidden] attribute (no global CSS).
// - Optionally toggle sub-elements inside Home (siteTitle, startingOptions).
// - Emit a "app:view-changed" CustomEvent for observability/router hooks.
//
// API
//   const { showView, getCurrentView, dispose } = createViewController(opts)
//   showView('home' | 'create' | 'join')
//   getCurrentView() → string | null
//   dispose() → currently no-op; reserved for future listeners
//
// Notes
// - Null-safe: missing elements are ignored without throwing.
// - Extensible: add more root views later by passing them in `opts`.
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} ViewControllerOptions
 * @property {HTMLElement|null|undefined} home            - Root element for the Home screen
 * @property {HTMLElement|null|undefined} create          - Root element for the Create screen
 * @property {HTMLElement|null|undefined} gameReady       - Root element for the Game Ready screen
 * @property {HTMLElement|null|undefined} join            - Root element for the Join screen
 * @property {HTMLElement|null|undefined} siteTitle       - (Optional) Home sub-element to show only on Home
 * @property {HTMLElement|null|undefined} startingOptions - (Optional) Home sub-element to show only on Home
 */

/**
 * Safely show/hide an element via [hidden].
 * @param {HTMLElement|null|undefined} el
 * @param {boolean} shouldShow
 */
function setVisible(el, shouldShow) {
    if (!el) return;
    if (shouldShow) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
}

/**
 * Create a tiny controller that manages which view is visible.
 * @param {ViewControllerOptions} opts
 */
export function createViewController(opts) {
    const {
        home,
        create,
        gameReady,
        join,
        siteTitle,
        startingOptions,
    } = opts || {};

    /** @type {Record<string, HTMLElement|undefined|null>} */
    const views = { home, create, gameReady, join };

    /** @type {keyof typeof views | null} */
    let current = null;

    /**
     * Show the requested view and hide others.
     * Emits a "app:view-changed" CustomEvent with { detail: { view } }.
     * @param {'home'|'create'|'gameReady'|'join'} view
     */
    function showView(view) {
        // Hide all known root views
        for (const [name, el] of Object.entries(views)) {
            setVisible(/** @type {HTMLElement|null|undefined} */(el), name === view);
        }

        // Optional: sub-elements inside Home
        const isHome = view === 'home';
        setVisible(siteTitle, isHome);
        setVisible(startingOptions, isHome);

        // Clear URL hash when returning to home
        if (isHome && window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname);
        }

        current = view;

        // Broadcast for diagnostics or a future router
        try {
            const evt = new CustomEvent('app:view-changed', { detail: { view } });
            window.dispatchEvent(evt);
        } catch {
            // no-op in environments without CustomEvent
        }
    }

    /** @returns {'home'|'create'|'gameReady'|'join'|null} */
    function getCurrentView() {
        return current;
    }

    /** Currently a no-op; placeholder in case we add internal listeners later. */
    function dispose() {
        // Nothing to clean up right now.
    }

    return { showView, getCurrentView, dispose };
}
