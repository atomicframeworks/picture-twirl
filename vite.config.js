import { cloudflare } from '@cloudflare/vite-plugin';

// Share mode (`npm run share`) tunnels the dev server through Cloudflare, so the
// browser loads the app from a *.trycloudflare.com origin instead of localhost.
const share = process.env.SHARE_MODE === '1';

// E2E mode (`npm run dev:e2e`, started by Playwright): its own port and its own
// throwaway local database, so browser tests never touch your dev data.
const e2e = process.env.PT_E2E === '1';
export const E2E_STATE_DIR = '.wrangler/e2e-state';

export default {
    root: '.',
    // Runs worker/index.js (the API) inside the real Workers runtime alongside
    // the Vite dev server, with local D1/R2 under .wrangler/ — no Cloudflare
    // login needed. Config: wrangler.jsonc.
    plugins: [cloudflare(e2e ? { persistState: { path: E2E_STATE_DIR } } : {})],
    server: {
        port: e2e ? 3100 : 3000,
        ...(e2e && { strictPort: true }),
        ...(share && {
            // Bind all interfaces so cloudflared (and the LAN) can reach it.
            host: true,
            // A shifted port would leave the tunnel pointing at nothing.
            strictPort: true,
            // Vite rejects unknown Host headers by default.
            allowedHosts: ['.trycloudflare.com'],
            // HMR rides the tunnel on 443/wss, not the raw dev port.
            hmr: { protocol: 'wss', clientPort: 443 },
        }),
    },
    build: {
        // The Cloudflare plugin writes the site to dist/client and the Worker
        // (plus its generated wrangler.json) to dist/picture_twirl.
        outDir: 'dist'
    },
    environments: {
        // Two pages: the game (/) and the admin (/admin/). gallery.html stays dev-only.
        client: {
            build: {
                rollupOptions: {
                    input: {
                        main: 'index.html',
                        admin: 'admin/index.html',
                    },
                },
            },
        },
    },
};
