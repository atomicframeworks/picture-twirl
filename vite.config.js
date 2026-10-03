import { cloudflare } from '@cloudflare/vite-plugin';

// Share mode (`npm run share`) tunnels the dev server through Cloudflare, so the
// browser loads the app from a *.trycloudflare.com origin instead of localhost.
const share = process.env.SHARE_MODE === '1';

export default {
    root: '.',
    // Runs worker/index.js (the API) inside the real Workers runtime alongside
    // the Vite dev server, with local D1/R2 under .wrangler/ — no Cloudflare
    // login needed. Config: wrangler.jsonc.
    plugins: [cloudflare()],
    server: {
        port: 3000,
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
    }
};
