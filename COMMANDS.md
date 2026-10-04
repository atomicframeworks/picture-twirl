# Commands

<!-- repo: github.com/atomicframeworks/picture-twirl -->

```bash
npm run dev                     # that's it — setup runs automatically first
```
`npm run dev` (and `share`, `build`, `test`, `test:e2e`) first runs
`scripts/ensure-setup.mjs`: `npm install` if `node_modules` is missing / from
another OS / older than `package-lock.json`, `.dev.vars` from the example if
missing, and (for e2e) Playwright's Chromium. Run it alone with `npm run setup`.

Needs Node ≥ 22 (wrangler). The local Cloudflare runtime runs natively on
macOS 13.5+, Windows 11 and glibc Linux (not Alpine — see docker-compose.yml).

## Run the app
```bash
npm run dev            # → http://localhost:3000  (Vite + local Worker/D1/R2)
                       #   first migrates + seeds the local database
                       #   admin:   http://localhost:3000/admin/  (password: ADMIN_PASSWORD in your .dev.vars)
                       #   gallery: http://localhost:3000/gallery.html
                       #   API:     http://localhost:3000/api/health, /api/boards
npm run dev:e2e        # the browser tests' own server: :3100, fresh database each start
npm run build          # production build → dist/client (site) + dist/picture_twirl (Worker)
npm run preview        # serve the build
```

## Local database (Cloudflare D1/R2, simulated under .wrangler/)
```bash
npm run db:setup:local          # migrate + seed (automatic before dev/share)
npm run db:migrate:local        # apply migrations/*.sql
npm run db:seed:local           # add the test board if missing (dev server stopped)
npx wrangler d1 execute DB --local --command "SELECT slug, status FROM boards"
```
Start fresh: stop the dev server, delete `.wrangler/state`, run `npm run dev`.
No Cloudflare login is needed for any of this. **Don't run `wrangler deploy`**
on the `cloudflare` branch before cutover (PROPOSAL.md §9.2).

## Content tools (AI import → ✨ To review in /admin)
```bash
npm run content:sheet                          # dry run: plan boards from the spreadsheet, find + download pictures, write a report
npm run content:sheet -- --plan-only           # just the plan (≈3 min) → content/runs/<run>/plan.md
npm run content:sheet -- --resume last         # continue the newest run (after Ctrl-C, or after editing its plan.json)
npm run content:sheet -- --resume last --redo crate-diggers,snack-attack/0-2   # pick a board's (or one tile's) pictures again
npm run content:sheet -- --resume last --redo missing   # retry every tile still without a picture
npm run content:sheet -- --resume last --live  # upload that reviewed dry run to the local site (npm run dev must be running)
npm run content:discover -- --boards 3         # brand-new boards; the AI searches the web for themes
npm run content:discover -- --theme "space" --boards 1 --live
npm run content:sheet -- --help                # every option
```
- Each run is a folder in `content/runs/` (not in git): `plan.md`, `report.md`
  (every tile with its picture, license, ⚠️ flags and why), the pictures,
  license-evidence screenshots and `run.log`. Read `report.md` before `--live`.
- `--live` uploads to the site in `.dev.vars` (`IMPORT_TOKEN`) at
  `http://localhost:3000`. Boards arrive as **✨ To review**; nothing is ever
  published by a tool. Re-running updates its own earlier imports while they're
  still ✨ To review — boards a person has touched are left alone.
- AI: your own Claude Code subscription by default (headless `claude -p`; be
  signed in to `claude`). Optional local model: `CONTENT_AI=ollama` with
  `OLLAMA_MODEL` (a vision model, e.g. `qwen2.5vl:7b`). `--ai none` = no AI
  (spreadsheet categories in order + top search result). Models:
  `CONTENT_AI_MODEL_PLAN` (default `opus`), `CONTENT_AI_MODEL_CHECK` (`sonnet`).
- A spreadsheet run takes ~15–30 min (≈7 boards, 175 tiles); a discovery run
  ~5–10 min per board. Uses your Claude usage: ~1 planning call plus one
  short picture check per tile (Unsplash pictures are never shown to the AI).
- `--site prod` = the live site (https://picture-twirl.k-m-mcginty.workers.dev): `CONTENT_SITE_PROD` +
  `IMPORT_TOKEN_PROD` in `.env.local` (`npm run cf:secrets` writes the token).
  A run remembers what it uploaded **per site**, so a reviewed run can go to the
  local site first and to production later: `--resume <run> --live --site prod`.

## Share mode (dev here, test on another device)
```bash
npm run share          # dev server + public HTTPS URL via Cloudflare
```
Prints a `https://<random>.trycloudflare.com` URL once it's actually routable —
open it on a phone, tablet, or the other machine. Ctrl+C stops both the server
and the tunnel.

- No Cloudflare account needed. The URL is random and dies with the process,
  so a fresh one every run — don't bake it into anything.
- HMR works over the tunnel (wss on 443). While sharing, use the tunnel URL on
  this machine too; `localhost:3000` still serves but its HMR socket won't connect.
- Anyone with the link reaches your dev server, so treat it as public.
- Live games work over the tunnel too (their WebSockets ride the same HTTPS
  URL) — the easy way to try a real multi-device game: open the URL on two to
  five phones and play. `window.PictureTwirl.realtime.stats()` in a browser's
  devtools shows each device's round-trip time.
- Port 3000 must be free — share mode uses `strictPort` so a shifted port can't
  leave the tunnel pointing at nothing.

## Tests (details: TESTING.md)
```bash
npm test                               # lint + unit + API + realtime — no browser, ~25 s; run before committing
npm run test:unit                      # node --test tests/unit (pure logic)
npm run test:api                       # node --test tests/api (real Worker + throwaway D1/R2)
npm run test:realtime                  # node --test tests/realtime (GameRoom Durable Objects over real WebSockets)
npm run test:all                       # npm test + e2e

# Playwright — auto-starts the dev server (or reuses one on :3000)
npm run test:e2e                       # run all browser flows
npm run test:e2e -- realtime.spec.js   # one file (here: the live-game acceptance tests)
npm run test:e2e -- --headed           # watch in a real browser
npm run test:e2e -- --ui               # interactive debug UI
npm run test:e2e:report                # open last HTML report
```
Screenshots → `screenshots/`

## Cloudflare (the Picture Twirl account) — never `wrangler login`/`logout` here
This machine's own wrangler login belongs to another project that deploys from
it. Picture Twirl commands carry their own **API token** instead (wrangler uses
`CLOUDFLARE_API_TOKEN` over its login, for that one command) and the account
pinned in `wrangler.jsonc` (`account_id`). The token lives in
`cloudflare-token.txt` in the project folder: **gitignored, never committed**
(GitHub refuses pushes that contain Cloudflare tokens); Dropbox shares it between
the team's machines. Day to day nobody needs it: pushing to `main` deploys
through Workers Builds.
```bash
npm run cf:token                       # check the token: active? which account? the pinned one? workers.dev subdomain?
npm run cf -- whoami                   # wrangler against the Picture Twirl account only
npm run cf -- <any wrangler command>   # e.g. d1 list, deploy, secret put … (never the machine's own login)
npm run cf:secrets                     # production secrets in one go, never printed: ADMIN_PASSWORD (the team's,
                                       # from .dev.vars), IMPORT_TOKEN (saved as IMPORT_TOKEN_PROD in .env.local),
                                       # SESSION_SECRET (made once; --new-session-secret signs everyone out)
```
Making the token (works from a phone browser): dash.cloudflare.com → log in to
the **Picture Twirl** account → Manage Account → **Account API Tokens** (or My
Profile → API Tokens) → Create Token → template **Edit Cloudflare Workers** →
add **Account · D1 · Edit**, **Account · Workers R2 Storage · Edit**,
**Account · Account Settings · Read** → Create → copy. Save it as a plain text
file `cloudflare-token.txt` in the `picture-twirl` folder (the Dropbox app works;
pasting everything Cloudflare shows — token, R2 keys, endpoint — is fine too, the
scripts pick the API token), then `npm run cf:token`. If it ever leaks beyond the
team: dashboard → the token → Roll, and replace the file.

## Live games (GameRoom Durable Objects)
```bash
npm run measure:realtime               # latency through a room: ping / write confirmed / delivered to another player
npm run measure:realtime -- --url https://<site> --n 300   # against a deployed site (after cutover)
npm run migrate:code                   # code written against Firebase (older branches) → src/realtime/ imports
npm run migrate:code -- --check        # exit 1 if any Firebase import is left
npm run rehearse:migration             # sandbox: "Lu's" Firebase-era branch + a simulated cutover (prints the Claude command)
npm run rehearse:migration -- --run    # …and let a fresh headless Claude session do the merge (~5 min, your Claude usage)
```
In a browser's devtools: `PictureTwirl.realtime.stats()` (connection, round
trips, clock offset) and `PictureTwirl.realtime.simulateDrop()` (cut this tab's
connection like a Wi-Fi drop — it reconnects by itself).

## Lint
```bash
npm run lint           # must be 0
npm run lint:fix       # auto-fix
```

## Git — get the latest from GitHub
```bash
git pull                               # fetch + merge from origin/main
git pull origin main                   # same thing, spelled out
git fetch origin                       # download only, change nothing locally
git log --oneline HEAD..origin/main    # what would come in (run after fetch)
```
Local edits in the way? Stash, pull, restore:
```bash
git stash && git pull && git stash pop
```
Re-run `npm install` after a pull that changed `package.json`.

## Git — first time on a new machine
```bash
git clone https://github.com/atomicframeworks/picture-twirl.git
cd picture-twirl
npm install
```

## Git — send changes up
```bash
git status                             # what's changed
git diff                               # review before staging
git add -A                             # stage everything
git commit -m "message"                # commit
git push                               # push (first push: git push -u origin main)
```

## Gotcha
Build error `Cannot find module @rollup/rollup-win32-...` (or a `sharp` /
`workerd` platform error)? → `node_modules` got synced across OSes via Dropbox.
Just re-run `npm install` on this machine — and tell Dropbox to ignore
`node_modules` and `.wrangler` on each device (README).
