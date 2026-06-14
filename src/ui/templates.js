// src/ui/templates.js
//
// Helpers for cloning <template> and grabbing [data-ref] handles.

export function mountTemplate(container, tplId) {
    const tpl = document.getElementById(tplId);
    if (!tpl || !('content' in tpl)) {
        throw new Error(`Template not found: ${tplId}`);
    }
    container.innerHTML = '';
    const frag = tpl.content.cloneNode(true);
    container.appendChild(frag);
    // Return the mounted root (first element child inside the fragment)
    return container.firstElementChild;
}

export function collectRefs(root) {
    /** @type {Record<string, HTMLElement>} */
    const refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
        const name = el.getAttribute('data-ref');
        if (name) refs[name] = /** @type {HTMLElement} */ (el);
    });
    return refs;
}
