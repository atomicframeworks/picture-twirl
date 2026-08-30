// Share mode (`npm run share`) tunnels the dev server through Cloudflare, so the
// browser loads the app from a *.trycloudflare.com origin instead of localhost.
const share = process.env.SHARE_MODE === '1';

export default {
    root: '.',
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
        outDir: 'dist'
    }
};
