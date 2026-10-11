// scripts/lib/localSecrets.mjs — gives each machine its own local Worker secrets.
//
// .dev.vars starts as a copy of .dev.vars.example, and the example is public (the
// repo is public). A dev server shared with `npm run share` is reachable by anyone
// with the link, so its SESSION_SECRET (signs player + admin sessions) and
// IMPORT_TOKEN (the content tools' key) must not be the published values:
// ensure-setup replaces them with random ones. Values someone set themselves are
// never touched, and ADMIN_PASSWORD is left alone (the team sets the real one).
// Node built-ins only: ensure-setup runs before anything is installed.

export const OWN_PER_MACHINE = ['SESSION_SECRET', 'IMPORT_TOKEN'];

const LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*?)\s*$/;

/** KEY → value from .env-style text. */
export const envValues = (text) => Object.fromEntries(String(text).split(/\r?\n/)
    .map(l => l.match(LINE)).filter(Boolean).map(m => [m[2], m[4]]));

/**
 * @param {string} text  .dev.vars as it is
 * @param {string} exampleText  .dev.vars.example
 * @param {() => string} random  a fresh random value
 * @returns {{ text: string, changed: string[] }}  `changed` = keys that got a random value
 */
export function withOwnSecrets(text, exampleText, random) {
    const example = envValues(exampleText);
    const changed = [];
    const out = String(text).split(/\r?\n/).map((line) => {
        const m = line.match(LINE);
        if (!m || line.trim().startsWith('#') || !OWN_PER_MACHINE.includes(m[2])) return line;
        if (m[4] && m[4] !== example[m[2]]) return line;              // someone's own value — keep it
        changed.push(m[2]);
        return `${m[1]}${m[2]}${m[3]}${random()}`;
    });
    return { text: out.join('\n'), changed };
}
