# Picture Twirl

Multiplayer trivia game where players guess images as they gradually "unswirl" from distorted to clear. Built with Vite, vanilla JavaScript, and Firebase Realtime Database.

## Prerequisites

- **Docker Desktop** (recommended dev path) — running before you start
- Or **Node.js 24+** if you'd rather run Vite directly on the host
- A Firebase project with Realtime Database (see [Firebase config](#firebase-config))

## Quick start (Docker)

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

## Quick start (without Docker)

```powershell
npm install
npm run dev
```

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

1. **Tell Dropbox to ignore `node_modules`** on each device (keeps a separate
   local copy per machine, syncs nothing):

   ```powershell
   # Windows (PowerShell), from the project root:
   Set-Content -Path "$PWD\node_modules:com.dropbox.ignored" -Value 1
   ```
   ```bash
   # macOS/Linux:
   attr -s com.dropbox.ignored -V 1 node_modules
   ```

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

## Project structure

See `CLAUDE.md` for the full file map and architecture notes. Top-level:

```
src/         # app source (flows, game, ui, data)
public/      # static assets (game images)
index.html   # entry + templates (tpl-lobby, tpl-game)
```
