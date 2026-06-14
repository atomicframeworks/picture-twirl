// Flat ESLint config (ESLint 9). Vanilla browser ES modules + Firebase.
import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'node_modules/**'] },

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
        },
    },

    {
        // Build/tooling config files run in Node.
        files: ['vite.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },
];
