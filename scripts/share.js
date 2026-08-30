/**
 * Share mode: run the dev server on this machine and expose it through a
 * Cloudflare quick tunnel so another device can load the app over HTTPS.
 *
 *   npm run share
 *
 * Quick tunnels need no Cloudflare account. The URL is random and lives only
 * as long as this process does.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bin, install, Tunnel } from 'cloudflared';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const LOCAL_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

/** The binary ships via postinstall, but Dropbox can sync the wrong OS build. */
async function ensureBinary() {
    if (existsSync(bin)) return;
    console.log('[share] cloudflared binary missing for this platform, downloading…');
    await mkdir(dirname(bin), { recursive: true });
    await install(bin);
    console.log('[share] cloudflared installed.');
}

function startVite() {
    const child = spawn(
        process.execPath,
        [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
        {
            cwd: ROOT,
            stdio: 'inherit',
            // Read by vite.config.js to relax host checks and point HMR at the tunnel.
            env: { ...process.env, SHARE_MODE: '1' },
        }
    );
    child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
            console.error(`[share] vite exited with code ${code}`);
            shutdown(code);
        }
    });
    return child;
}

async function waitForServer() {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(LOCAL_URL, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return;
        } catch {
            // Not listening yet — keep polling.
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Dev server never became ready on ${LOCAL_URL}`);
}

function banner(publicUrl) {
    const line = '─'.repeat(Math.max(publicUrl.length, 34) + 4);
    console.log(`\n┌${line}┐`);
    console.log('│  Share mode is live.');
    console.log(`│  Local:  ${LOCAL_URL}`);
    console.log(`│  Public: ${publicUrl}`);
    console.log('│  Gallery: append /gallery.html');
    console.log('│  Ctrl+C stops the server and the tunnel.');
    console.log(`└${line}┘\n`);
}

let vite = null;
let tunnel = null;
let shuttingDown = false;

function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
        tunnel?.stop();
    } catch {
        // Already gone.
    }
    if (vite && vite.exitCode === null) vite.kill();
    process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => shutdown(0));
}

await ensureBinary();
vite = startVite();
await waitForServer();

tunnel = Tunnel.quick(LOCAL_URL);

/**
 * cloudflared prints the URL well before it resolves — the random hostname
 * still has to propagate. Announcing on the `url` event (or even on the first
 * edge connection) hands you a link that fails for several seconds, so probe
 * the public URL and only print the banner once it actually answers.
 */
async function announceWhenRoutable(url) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !shuttingDown) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (res.status < 500) {
                banner(url);
                return;
            }
        } catch {
            // Hostname not resolving yet.
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
    if (shuttingDown) return;
    console.warn('[share] tunnel is slow to come up — the URL may need another moment:');
    banner(url);
}

tunnel.on('url', (url) => {
    console.log('[share] tunnel assigned, waiting for it to go routable…');
    announceWhenRoutable(url);
});
tunnel.on('error', (err) => console.error('[share] tunnel error:', err.message));
tunnel.on('exit', (code) => {
    if (!shuttingDown) {
        console.error(`[share] tunnel closed (code ${code}).`);
        shutdown(code ?? 1);
    }
});
