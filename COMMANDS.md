# Commands

<!-- repo: github.com/atomicframeworks/picture-twirl -->

```bash
npm install            # first time on each machine (Windows + Linux separately)
```

## Run the app
```bash
npm run dev            # → http://localhost:3000
                       #   gallery: http://localhost:3000/gallery.html
npm run build          # production build → dist/
npm run preview        # serve the build
```

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

## Tests (Playwright — auto-starts the dev server)
```bash
npm run test:e2e                       # run all
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
Build error `Cannot find module @rollup/rollup-win32-...`? → `node_modules` got
synced across OSes via Dropbox. Just re-run `npm install` on this machine.
