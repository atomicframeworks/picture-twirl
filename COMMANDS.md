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
                       #   gallery: http://localhost:3000/gallery.html
                       #   API:     http://localhost:3000/api/health, /api/boards
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
- Firebase anonymous auth works from the tunnel origin as-is (authorized-domain
  checks only apply to popup/redirect sign-in, which this app doesn't use).
- Port 3000 must be free — share mode uses `strictPort` so a shifted port can't
  leave the tunnel pointing at nothing.

## Tests (details: TESTING.md)
```bash
npm test                               # lint + unit + API — no browser, ~10 s; run before committing
npm run test:unit                      # node --test tests/unit (pure logic)
npm run test:api                       # node --test tests/api (real Worker + throwaway D1/R2)
npm run test:all                       # npm test + e2e

# Playwright — auto-starts the dev server (or reuses one on :3000)
npm run test:e2e                       # run all browser flows
npm run test:e2e -- gallery.spec.js    # one file (no Firebase needed)
npm run test:e2e -- --headed           # watch in a real browser
npm run test:e2e -- --ui               # interactive debug UI
npm run test:e2e:report                # open last HTML report
```
Screenshots → `screenshots/`

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
