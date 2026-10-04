# Picture Twirl

A multiplayer trivia game: a picture starts swirled and slowly "unswirls"; teams
buzz in to name it. A host (GM) picks tiles from a **Board** (5 categories × 5
pictures, 100–500 points), players join from their phones with a game code.

| | |
|---|---|
| **Play (live)** | https://play.picture-twirl.workers.dev |
| **Admin (live)** | https://play.picture-twirl.workers.dev/admin/ — team password; guide: [ADMIN.md](ADMIN.md) |
| **Staging** | https://staging-play.picture-twirl.workers.dev (staging data — [WORKFLOW.md](WORKFLOW.md)) |
| **Code** | https://github.com/atomicframeworks/picture-twirl — pushing to `main` deploys |

## Docs

| Read | For |
|---|---|
| **README** (this) | what it is, tech stack, getting started, the commands you'll use daily |
| [WORKFLOW.md](WORKFLOW.md) | **how we work:** local → staging → live, branches + pull requests, what triggers a deploy, database changes, rollbacks, secrets, who can do what |
| [COMMANDS.md](COMMANDS.md) | every command, with options |
| [CLAUDE.md](CLAUDE.md) | architecture, data model, file map (Claude Code loads it automatically) |
| [ADMIN.md](ADMIN.md) | using `/admin/`: boards, pictures, rights, publishing |
| [TESTING.md](TESTING.md) | the test layers and when to run which |
| [MIGRATION.md](MIGRATION.md) | bringing work from before the Cloudflare switch-over (Firebase days) over |
| [PROPOSAL.md](PROPOSAL.md) | the switch-over plan, decisions and as-built notes |
| [REFACTOR.md](REFACTOR.md) / [AUDIT.md](AUDIT.md) | change log / code audit |

## Tech stack

| Part | What | Where |
|---|---|---|
| Game + admin UI | Vite 7, vanilla JavaScript (ES modules), CSS design tokens; the swirl is a Canvas animation | `index.html`, `src/`, `admin/` + `src/admin/` |
| Server | **one Cloudflare Worker**: serves the static site, `/api/*` and `/media/*` | `worker/`, `wrangler.jsonc` |
| Boards + pictures | **D1** (SQLite: boards, revisions, pictures + rights, audit log) and **R2** (picture files) | `migrations/`, `worker/lib/` |
| Live games | **Durable Objects** — one GameRoom per game, WebSockets with hibernation; the browser uses a Firebase-shaped API | `worker/rooms/`, `src/realtime/` |
| Content tools | Node scripts + headless Claude Code (your subscription): boards from the team spreadsheet or the web, free-license pictures (Wikimedia Commons, Openverse), `sharp` | `tools/content/` |
| Tests | `node --test` (unit, API and live-game tests on the real Workers runtime) + Playwright (browser) | `tests/`, [TESTING.md](TESTING.md) |
| Hosting + deploys | Cloudflare Workers (free plan), Workers Builds from GitHub: `main` → production, other branches → staging previews | [WORKFLOW.md](WORKFLOW.md) |
| Local dev | `@cloudflare/vite-plugin` runs the Worker, D1, R2 and Durable Objects on your machine — no account needed | `vite.config.js`, `.wrangler/` |

## Getting started

**You need:** Node.js 22+ and git, on macOS 13.5+, Windows 11 or a glibc Linux
(what the local Cloudflare runtime supports) — or Docker Desktop (below). No
accounts or cloud services to run, test or play locally.

```bash
git clone https://github.com/atomicframeworks/picture-twirl.git
cd picture-twirl
npm run dev            # → http://localhost:3000
```

That's all: setup is automatic. Before `dev`, `share`, `build` and the tests,
`scripts/ensure-setup.mjs` runs `npm install` when needed (missing, another
OS, or `package-lock.json` changed), creates `.dev.vars` (local secrets — with
this machine's own random keys) and, for browser tests, installs Chromium.
`npm run dev` runs the Worker with a local database and picture bucket under
`.wrangler/`, migrated and seeded with an internal test board.

- **Admin locally:** http://localhost:3000/admin/ — put the team password in
  `.dev.vars` as `ADMIN_PASSWORD=…` (gitignored; never commit it).
- **Try it on phones:** `npm run share` → a temporary public HTTPS link.
- **Before committing:** `npm test` (~25 s).
- **Next:** [WORKFLOW.md](WORKFLOW.md) — how a change gets to the live game.

## Daily commands

```bash
npm run dev                # the app on http://localhost:3000 (admin: /admin/, components: /gallery.html)
npm run share              # same + a public HTTPS link for phones / other computers
npm test                   # lint + unit + API + live-game tests + docs check (~25 s) — before every commit
npm run test:e2e           # browser tests (Playwright) — when you changed something people click
npm run build              # production build → dist/ (Cloudflare does this on deploy)

git switch -c my-change    # work on a branch …
git push -u origin my-change   # … → a staging preview: https://my-change-play.picture-twirl.workers.dev
                               # merge the pull request into main → live in ~1 min
```
Everything else — content tools, the Cloudflare commands, database migrations,
latency checks — is in [COMMANDS.md](COMMANDS.md).

## Docker (fallback, e.g. Windows 10)

```powershell
docker compose up              # → http://localhost:3000 (npm install + npm run dev -- --host inside)
docker compose down            # stop
docker compose down -v; docker compose up   # rebuild dependencies after editing package.json
docker exec -it picture-twirl-app-1 sh      # a shell inside the container
```
Source files are bind-mounted (edits hot-reload); `node_modules` lives in a
volume inside the container. The image is Debian (`node:24-bookworm-slim`), not
Alpine — the local Workers runtime needs glibc.

## ⚠️ This repo lives in Dropbox — don't sync `node_modules` or `.wrangler`

Native dependencies (Rollup, `sharp`, the Workers runtime) ship **per-OS
binaries**, `.wrangler/` holds the local database files and `dist/` the build.
Synced between machines, they break (`Cannot find module '@rollup/rollup-win32-x64-msvc'`)
or corrupt. **Setup handles this:** the first `npm run dev` (or `npm run setup`)
on a machine marks all three as Dropbox-ignored there, before anything fills
them. If it can't, it says so — then do it by hand, once per device:

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
attr -s com.dropbox.ignored -V 1 .wrangler
```
Then `npm install` on each machine (setup does it for you when it notices).
Each machine therefore has its **own local database** — the boards in your Mac's
local `/admin/` aren't on the PC; the shared ones live on staging and production.

Line endings are pinned to LF (`.gitattributes`), so a Windows checkout in the
shared folder doesn't make every file look changed on the Mac. With one working
copy on two computers: let Dropbox finish syncing before switching machines,
and don't run git on both at the same time.

## Configuration

- `.dev.vars` (gitignored, created automatically): the local Worker's secrets —
  `ADMIN_PASSWORD`, `SESSION_SECRET`, `IMPORT_TOKEN`.
- `.env.local` (gitignored, optional): content-tool settings and the staging /
  production import keys — `.env.local.example`.
- `cloudflare-token.txt` (gitignored, owner): the Picture Twirl Cloudflare API
  token for setup and maintenance commands (`npm run cf …`).
- Where each secret lives in staging and production: [WORKFLOW.md](WORKFLOW.md).

## Working with Claude Code

[CLAUDE.md](CLAUDE.md) holds the project context (architecture, data model,
file map); Claude Code loads it automatically. **Coming from the Firebase days**
(a branch from before the switch-over)? Ask Claude: "bring `main` into my
branch, follow CLAUDE.md" — it walks you through [MIGRATION.md](MIGRATION.md).

## Components & gallery

Reusable UI components live in `src/components/` — factory functions that
return DOM elements (`Button`, `Field`, `Card`, `ScoreboardCard`, `BoardTile`, …):

```js
import { Button, Field } from './components/index.js';
app.append(Button({ label: 'Start', onClick: go }));
```
A live showcase is at http://localhost:3000/gallery.html (`npm run dev`); the
browser tests screenshot it (`tests/gallery.spec.js`).

## Project structure

```
index.html   # the game: entry + templates (lobby, game)
admin/       # the admin page (/admin/) → src/admin/
src/         # browser code: flows, game, realtime (live games), ui, admin, shared rules
worker/      # the Cloudflare Worker: API, pictures, admin, content import, GameRoom
migrations/  # database schema (D1)
content/     # the team spreadsheet export + the local test board
tools/       # content tools (npm run content:*)
scripts/     # dev, setup, Cloudflare and migration helpers
tests/       # unit, API, live-game and browser tests — TESTING.md
public/      # static files (favicon, sounds, background)
```
Full file map: [CLAUDE.md](CLAUDE.md).
