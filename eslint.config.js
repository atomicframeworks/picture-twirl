// Flat ESLint config (ESLint 9). Vanilla browser ES modules, a Cloudflare Worker, Node tooling.
import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'node_modules/**', '.wrangler/**'] },

    js.configs.recommended,

    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        rules: {
            // Unused vars are a strong signal of dead code / botched refactors.
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            // Catches references to names that aren't in scope/imported — the
            // exact failure mode of splitting a shared closure across files.
            'no-undef': 'error',
            'no-empty': ['warn', { allowEmptyCatch: true }],
            // Firebase is gone (PROPOSAL.md §8.4): live games use src/realtime/. Code merged
            // from an older branch gets its imports rewritten by `npm run migrate:code`.
            'no-restricted-imports': ['error', {
                paths: [{ name: 'firebase', message: 'Firebase was replaced by src/realtime/ — run `npm run migrate:code` (MIGRATION.md §5).' }],
                patterns: [
                    { group: ['firebase/*'], message: 'Firebase was replaced by src/realtime/db.js — run `npm run migrate:code` (MIGRATION.md §5).' },
                    { group: ['**/firebase.js'], message: 'src/firebase.js was replaced by src/realtime/client.js — run `npm run migrate:code` (MIGRATION.md §5).' },
                ],
            }],
        },
    },

    {
        // The Cloudflare Worker (API) runs in workerd: web-standard globals.
        files: ['worker/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.serviceworker, HTMLRewriter: 'readonly', WebSocketPair: 'readonly' },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            'no-undef': 'error',
        },
    },

    {
        // Build/tooling config, scripts, content tools and tests run in Node.
        files: [
            'vite.config.js', 'eslint.config.js', 'playwright.config.js',
            'tests/**/*.js', 'tests/**/*.mjs', 'scripts/**/*.js', 'scripts/**/*.mjs', 'tools/**/*.mjs',
        ],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },
];
