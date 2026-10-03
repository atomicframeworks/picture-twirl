# Testing

> How Picture Twirl is tested, what each layer covers, and the rules for keeping
> it that way. Started 2026-10-03 with the Cloudflare switch-over (PROPOSAL.md
> §9). If a change breaks a test, fix the code or update the test **in the same
> commit**, never later.

## TL;DR

```bash
npm test             # lint + unit + API (no browser, ~10 s) — run before every commit
npm run test:e2e     # browser flows in Chromium (~35 s, needs .env.local for Firebase)
npm run test:all     # both
```

Setup is automatic (`scripts/ensure-setup.mjs` runs first): dependencies are
installed/refreshed when needed, `.dev.vars` is created, and `npm run test:e2e`
downloads Playwright's Chromium (~90 MB, outside the repo) on first use.

## The layers

| Layer | Command | Runs in | Speed | Covers |
|---|---|---|---|---|
| **Lint** | `npm run lint` | ESLint | 2 s | Undefined names, unused code. Must be **0 errors** (warnings are tolerated, but don't add new ones) |
| **Unit** | `npm run test:unit` | `node --test` | 1 s | Pure logic: board shape + snapshot (`src/shared/boards.js`), license rules (`src/shared/rights.js`), the Worker router, snapshot → live board (`toBoardSet` + `buildBoardFromSet`) |
| **API** | `npm run test:api` | `node --test` + real local D1/R2 | 5 s | The real Worker (`worker/index.js`) answering real requests against a throwaway database: routes, status codes, cache headers, media privacy, uniqueness, rights, revisions, audit log |
| **E2E** | `npm run test:e2e` | Playwright + Chromium (Pixel 7 emulation) | 35 s | Whole flows in a browser: create → pick a board → lobby → join → start → swirl → buzz → award → reveal; board picker states; GM tour; component gallery |

### Unit — `tests/unit/*.test.mjs`
Plain functions with no I/O. Use `node:test` + `node:assert/strict`, nothing else.
Put a unit test next to any rule that decides something (validation, rights,
shapes, math). Fast enough to run on every save.

### API — `tests/api/*.test.mjs`
`tests/api/_harness.mjs` does the heavy lifting:

```js
const t = await startTestEnv();          // fresh folder under .wrangler/, real migrations applied
const res = await t.fetch('/api/boards'); // calls worker/index.js directly — no server
await t.env.DB.prepare('SELECT …').all(); // direct checks on D1 / R2 (t.env.MEDIA)
await t.dispose();                        // closes bindings, deletes the folder
```

- Each test **file** gets its own database, so files are independent; tests
  inside a file share it (create what you need in `before()` or per test).
- Helpers: `storeTestImage(env, seed, meta)` makes a distinct generated picture
  and stores it through the real code; `fullDraft(imageIds)` builds a 5×5 draft.
- Runs with `--test-concurrency=1` (one local runtime at a time keeps it calm on
  laptops).

### E2E — `tests/*.spec.js`
- `playwright.config.js` starts `npm run dev` (or reuses one already running on
  :3000). `npm run dev` migrates + seeds the local database first, so the
  internal test board **Pop Culture Icons** is always published.
- Shared flows live in `tests/helpers.js` (`createGameAsGM`, `joinAsPlayer`, …);
  `tests/fixtures.js` provides a `gm` fixture (a fresh game per test, ended in
  teardown).
- The `gm` fixture starts with the **GM onboarding tour dismissed**
  (`skipGMTour`), because its overlay would block lobby clicks. The tour itself
  is tested in `tour.spec.js`.
- `gallery.spec.js` runs at desktop size (the gallery is a desktop dev page).
- Screenshots land in `screenshots/` (gitignored) for eyeballing.

**Caveat until milestone M4:** the live game still runs on Firebase, so e2e
games are created in the real Firebase project (that's how it has always
worked). They're ended in teardown. After M4 the whole suite is local.

## Specs and what they protect

| File | Protects |
|---|---|
| `tests/unit/boards.test.mjs` | Title uniqueness key, slugs, blank 5×5 drafts, "tile ready" rule, counts, snapshot URLs + credits |
| `tests/unit/rights.test.mjs` | License decisions: free = ok, CC BY = credit, BY-SA = flagged, NC/ND = blocked, unknown = flagged; flag reasons exist |
| `tests/unit/router.test.mjs` | `:params`, `*` rest, HEAD → GET, literal dots, JSON no-store default |
| `tests/unit/boardsApi.test.mjs` | Snapshot → live game board (25 tiles keyed `col-row`, points by row) |
| `tests/api/public.test.mjs` | `/api/health`, `/api/boards` (published only, no-store), `/api/boards/:id` (id or slug, 404s), `/media/*` (WebP, immutable cache, 304, HEAD, private prefixes 404) |
| `tests/api/content.test.mjs` | Picture dedupe, rights assessment on store, unique titles (case/space-insensitive) + slugs, counts, publish → snapshot + revision + audit |
| `tests/smoke.spec.js` | Home loads; entry buttons enable after auth |
| `tests/create.spec.js` | Create wizard end to end |
| `tests/boards.spec.js` | Board list comes from the API; Next gated on selection; error + retry; titles rendered as text (no HTML injection) |
| `tests/lobby.spec.js` | GM lobby code; a player joins and picks a team |
| `tests/tour.spec.js` | First-time GM sees the lobby tour; Skip dismisses it for good |
| `tests/game.spec.js` | Live game: board, picture served from `/media`, swirl + pause/resume, buzz, award (score + confetti), continue, reveal-without-award |
| `tests/gallery.spec.js` | Component gallery renders; modal opens |

## Rules (definition of done)

Every change — and every switch-over milestone — ships with:

1. `npm test` green and `npm run test:e2e` green (or a written reason in the
   commit message if a flow can't run here).
2. **New behavior → new test** at the lowest layer that can see it: a rule →
   unit; an endpoint/DB behavior → API; a user flow → e2e.
3. **Bug fix → a test that failed before the fix.**
4. Changed UI text or flow → update the affected spec in the same commit. Prefer
   stable hooks (`data-ref`, `data-*` state attributes like `data-paused`) over
   visible wording.
5. Docs updated: CLAUDE.md (architecture/file map), COMMANDS.md (commands),
   this file (new layers/specs), REFACTOR.md change log.

## Troubleshooting

- **`Executable doesn't exist … ms-playwright`** → `npm run setup -- --e2e`
  (or `npx playwright install chromium`).
- **"Cannot find module" / platform binary errors** → `npm run setup` (or
  `npm install`); `node_modules` is per machine.
- **E2E hangs on the lobby** → a new overlay/tour is covering controls; dismiss it
  in the fixture (see `skipGMTour`) and test it separately.
- **API tests: `no such table`** → the harness applies migrations itself; if you
  added a migration, make sure it's in `migrations/` and valid SQL.
- **Port 3000 busy** → e2e reuses whatever answers on :3000; stop stray dev
  servers if results look stale.
- **Local data looks wrong** → stop the dev server, delete `.wrangler/state`,
  `npm run dev` (migrates + reseeds).
