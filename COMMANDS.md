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
git pull                               # fetch + merge (needs an upstream, see below)
git pull origin main                   # explicit — always works
git fetch origin                       # download only, change nothing locally
git log --oneline HEAD..origin/main    # what would come in (run after fetch)
```
If `git pull` says *"no tracking information for the current branch"*, set the
upstream once and plain `git pull` works from then on:
```bash
git branch --set-upstream-to=origin/main main
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
