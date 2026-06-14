# Commands

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

## Gotcha
Build error `Cannot find module @rollup/rollup-win32-...`? → `node_modules` got
synced across OSes via Dropbox. Just re-run `npm install` on this machine.
