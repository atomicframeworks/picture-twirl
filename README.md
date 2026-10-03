# Picture Twirl

Multiplayer trivia game where players guess images as they gradually "unswirl" from distorted to clear. Built with Vite, vanilla JavaScript, and Firebase Realtime Database — and, on the `cloudflare` branch, a Cloudflare Worker with D1 + R2 that serves the game's content (Boards). The switch-over plan is in [PROPOSAL.md](PROPOSAL.md); tests in [TESTING.md](TESTING.md).

## Prerequisites

- **Node.js 22+** on the host (recommended): macOS 13.5+, Windows 11 or a glibc
  Linux — what the local Cloudflare runtime supports
- Or **Docker Desktop** as a fallback (e.g. on Windows 10) — see below
- A Firebase project with Realtime Database (see [Firebase config](#firebase-config)) — until milestone M4

## Quick start

```bash
npm run dev                       # → http://localhost:3000
npm test                          # lint + unit + API tests
```

Setup is automatic: before `dev`/`share`/`build`/tests, `scripts/ensure-setup.mjs`
runs `npm install` when needed (missing, other OS, or `package-lock.json`
changed), creates `.dev.vars` from `.dev.vars.example`, and installs the e2e
browser when you run `npm run test:e2e`.

`npm run dev` runs Vite **and** the Worker in the local Cloudflare runtime, with
a local D1 database and R2 bucket under `.wrangler/` — migrated and seeded with
the internal test board automatically. No Cloudflare account or login needed.

The **admin** (manage boards, pictures and rights) is at
http://localhost:3000/admin/ — local password `dev-admin-password`. How to use
it: [ADMIN.md](ADMIN.md).

## Quick start (Docker fallback)

```powershell
docker compose up
```

Vite will be available at **http://localhost:3000**.

The container runs `npm install && npm run dev -- --host` on every start. Source files are bind-mounted, so edits on your host hot-reload in the browser. `node_modules` lives in an anonymous volume inside the container — don't expect your host's `node_modules` to match.

To stop:

```powershell
docker compose down
```

To rebuild dependencies (after editing `package.json`), remove the named volume:

```powershell
docker compose down -v
docker compose up
```

### Running commands inside the container

```powershell
docker exec -it picture-twirl-app-1 sh
```

From inside the container you can run `npm install <pkg>`, `npm run build`, etc.

The image is Debian-based (`node:24-bookworm-slim`), not Alpine: the local
Workers runtime needs glibc.

> **Each machine installs its own `node_modules`.** Run `npm install` once per
> environment (Windows host, Linux host, container). They are not interchangeable.

### ⚠️ This repo lives in Dropbox — do not sync `node_modules`

Native dependencies (e.g. Rollup, which powers Vite) ship **per-OS binaries**.
If Dropbox syncs `node_modules` between a Windows host and the Linux/Alpine
container, you'll hit errors like:

```
Cannot find module '@rollup/rollup-win32-x64-msvc'
```

…because the folder holds the *other* platform's binary. Fix / prevention:

1. **Tell Dropbox to ignore `node_modules` and `.wrangler`** on each device
   (keeps a separate local copy per machine, syncs nothing). `.wrangler/` holds
   the local database files — syncing those between machines can corrupt them.

   ```powershell
   # Windows (PowerShell), from the project root:
   Set-Content -Path "$PWD\node_modules:com.dropbox.ignored" -Value 1
   Set-Content -Path "$PWD\.wrangler:com.dropbox.ignored" -Value 1
   ```
   ```bash
   # macOS:
   xattr -w com.dropbox.ignored 1 node_modules
   xattr -w com.dropbox.ignored 1 .wrangler
   # Linux:
   attr -s com.dropbox.ignored -V 1 node_modules
   ```
   (Ignoring a folder that already synced removes it from Dropbox on your
   other devices — they then need their own `npm install`, which they need
   anyway.)

2. **Reinstall for the current OS:** `npm install` (regenerates the correct
   native binary; the committed `package-lock.json` already lists every
   platform, so this is safe on all OSes).

The Docker path is unaffected — it keeps `node_modules` in an anonymous volume
inside the container, never touching the host folder.

## Other scripts

```powershell
npm run build      # production build → dist/
npm run preview    # serve dist/ locally
```

## Firebase config

Copy [`.env.local.example`](./.env.local.example) to `.env.local` and fill in
your project's values (`cp .env.local.example .env.local`).

The app reads config from either:

1. `window.__FIREBASE_CONFIG__` (set in `index.html` or a script), **or**
2. Vite env vars in `.env.local` (gitignored):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

Anonymous auth is required and enforced automatically.

## Working with Claude Code

Project-specific context for Claude lives in [`CLAUDE.md`](./CLAUDE.md) (architecture, data layer, file map). Open Claude Code in this directory and it loads automatically.

Useful commands inside Claude Code:

- `! docker compose up` — start the dev container (interactive, output streams into chat)
- `/model` — switch model (e.g. Opus for harder refactors)
- `/loop 5m <task>` — re-run a task on an interval

## Components & gallery

Reusable UI components live in [`src/components/`](./src/components/) — plain
factory functions that return DOM elements, styled by the app's existing CSS
(`Button`, `IconButton`, `Field`, `Pill`, `Card`, `Heading`, `SectionHeader`,
`GameHeader`, `ActionsTray`, `ScoreboardCard`, `SetCard`, `BoardTile`, …).

```js
import { Button, Field } from './components/index.js';
app.append(Button({ label: 'Start', onClick: go }));
```

A live showcase of every component is at **`/gallery.html`** (run `npm run dev`,
then open http://localhost:3000/gallery.html). It loads no Firebase, so it's a
fast place to build and visually verify components. The Playwright suite
screenshots it (`tests/gallery.spec.js`).

## Project structure

See `CLAUDE.md` for the full file map and architecture notes. Top-level:

```
src/         # app source (flows, game, ui, data, shared rules)
worker/      # Cloudflare Worker: /api/* and /media/* (boards + pictures)
migrations/  # D1 database schema
content/     # content sources (the Google Sheet export) + local seed board
tools/       # content tooling (picture normalizing; AI import tools later)
tests/       # unit + API (node --test) and browser (Playwright) — TESTING.md
public/      # static assets (favicon, home pattern, sounds)
index.html   # entry + templates (tpl-lobby, tpl-game)
```
