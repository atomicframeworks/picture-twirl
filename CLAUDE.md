# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Refactor in progress.** See [REFACTOR.md](REFACTOR.md) for the audit, the
> phased cleanup plan, and the rationale behind structural changes. Keep this
> file and REFACTOR.md in sync — documentation drift is a known past problem here.

> **Cloudflare switch-over in progress on branch `cloudflare`** (plan + decisions:
> [PROPOSAL.md](PROPOSAL.md) §9). Milestones land on that branch and merge into
> `main` once, with a migration guide. Done so far: **M0** (local Worker + D1/R2
> setup) and **M1** (Boards come from the Worker API instead of bundled JS).
> Still Firebase: the live game (until M4). Everything Cloudflare runs
> **locally only** until cutover — never `wrangler deploy` from this branch.
> Testing rules: [TESTING.md](TESTING.md).

## Project Overview

Picture Twirl is a multiplayer trivia game where players guess images as they gradually "unswirl" from distorted to clear. Built with Vite, vanilla JavaScript, and Firebase Realtime Database, plus (switch-over branch) a Cloudflare Worker with D1 + R2 serving the game's content — **Boards**. The game features team-based gameplay with a host (GM) who controls game flow and awards points.

**Vocabulary:** a **Board** (e.g. "Pop Culture Icons 🎤") is what a GM picks; it has 5 **Categories** (columns) × 5 **Tiles** (picture + answer + 100–500 points). A **Game** is the live session with a code.

## Development Commands

```bash
# Development server (port 3000): Vite + the Worker (worker/index.js) in the
# local Workers runtime, with local D1/R2 under .wrangler/ (no Cloudflare
# login). `predev` first applies migrations and seeds the test board.
npm run dev

# Tests — see TESTING.md
npm test             # lint + unit + API (no browser, ~10 s)
npm run test:e2e     # Playwright browser flows
npm run test:all     # both

# Local database
npm run db:setup:local     # migrate + seed (runs automatically before dev/share)
# Start fresh: stop the dev server, delete .wrangler/state, npm run dev

# Production build (site → dist/client, Worker → dist/picture_twirl)
npm run build

# Preview production build
npm run preview

# Dev server + public HTTPS URL via Cloudflare quick tunnel
# (dev on this machine, test on a phone or another computer)
npm run share
```

Local Worker secrets: `.dev.vars` (throwaway dev values, created from
`.dev.vars.example` automatically).

### Machine setup is self-healing (read this before "fixing" install errors)
- `node_modules/` and `.wrangler/` are **per machine** and **Dropbox-ignored**
  (the repo lives in Dropbox and is used from Mac and Windows). Never copy them
  between machines.
- `scripts/ensure-setup.mjs` runs before `dev`, `share`, `build`, `test` and
  `test:e2e` (npm `pre*` scripts). It runs `npm install` when `node_modules` is
  missing, was installed for another OS/CPU, or is older than
  `package-lock.json` (marker: `node_modules/.picture-twirl-install.json`);
  creates `.dev.vars` if missing; and (e2e) installs Playwright's Chromium.
  Run it by hand with `npm run setup`.
- If a command still fails with "Cannot find module …", a missing
  `@rollup/rollup-*` / `@img/sharp-*` / `@cloudflare/workerd-*` binary, or a
  platform mismatch: run `npm install` (or `npm run setup`) and retry.

## Architecture

### Bootstrap Flow
Entry: `main.js` → `startup/boot.js`

1. Initialize Firebase with anonymous auth
2. Create view controller (manages Home/Create/Join screens)
3. Wire up Create and Join flows
4. Wait for auth ready before enabling UI interactions

### Core Modules

**Session Management (`session.js`)**
- Ephemeral client state: `{ gameId, isGM, displayName }`
- Persists to sessionStorage (survives refreshes, not cross-session)
- Observable pattern: `setSession()`, `getSession()`, `onSessionChange()`
- Cross-tab sync via storage events

**Device Preferences (`prefs.js`) + Name Suggestions (`names.js`)**
- `names.js`: pure content + generators. `randomPlayerName()` builds
  `<Adjective> <Noun> <3 digits>` ("Lucky Buzzer 407"); `randomTeamName()` and
  `randomGameName()` pick from hand-written lists of game-show tropes and puns
  ("Sultans of Swirl", "Focus Pocus"). All three take an `exclude` list, so a
  re-roll always changes and the two teams never match.
- `prefs.js`: durable **localStorage** prefs — the counterpart to `session.js`
  (ephemeral sessionStorage). Keys: `pt.prefs.playerName`, `pt.prefs.gameName`,
  `pt.prefs.teamName.A|B`. All access is try/catch-wrapped; private mode simply
  means "nothing remembered".
- `resolvePlayerName()` / `resolveGameName()` / `resolveTeamNames()` are the
  stitch point: return the remembered value if there is one, otherwise generate
  **and persist** it — so the first suggestion sticks from then on.
- Every name field — Create (GM screen name, Game Name, Team 1, Team 2) and the
  Join screen name — is prefilled this way, and re-saved whenever the user edits
  or re-rolls. Those inputs deliberately have **no `placeholder`**: they are
  never empty, so Create step 1 is valid the moment it opens.
- Each one carries a 🎲 button wired through `ui/diceButton.js`
  (`attachDiceButton(btn, onRoll)` — click → spin animation → roll). A roll
  always differs from the name it replaces, teams never collide, and the result
  is saved immediately so a good roll survives to the next game.

**Firebase Integration (`firebase.js`)**
- Config discovery: `window.__FIREBASE_CONFIG__` (priority) or `import.meta.env.VITE_FIREBASE_*`
- Anonymous auth automatically enforced via `requireAuth()`
- Exports singleton `rtdb` instance after `initializeFirebase()`
- Helper: `gameExists(gameId)` checks `/gameIndex/{gameId}` for join flow

**View Switching (`ui/views.js`)**
- Single source of truth for screen visibility
- Uses native `[hidden]` attribute (no global CSS)
- Emits `app:view-changed` event for observability
- API: `showView('home'|'create'|'gameReady'|'join')`

### Game Flow

**Create Flow (`flows/createFlow.js`)**
1. Step 1: Collect GM name, game name, team names
2. Step 2: "Pick a Board" — `ui/boardPicker.js` loads published boards from
   `/api/boards` (loading / empty / error-with-retry states) and renders the
   `.set-card` list; Next is enabled once one is picked. Play Again
   (`game/renderRoundSetup.js`) uses the same picker.
3. On completion:
   - Generates 6-character game code
   - Calls `createGameShell()` to initialize RTDB game node
   - Calls `renderLobby()` to show pre-game lobby
   - Sets session: `{ gameId, isGM: true, displayName }`

**Join Flow (`flows/joinFlow.js`)**
1. Validate game code exists via `gameExists(gameId)`
2. Collect player display name
3. On confirm:
   - Sets session: `{ gameId, isGM: false, displayName }`
   - Calls `renderLobby()`, which registers the participant via its own
     `ensureParticipant()` (no separate service module)

**Lobby (`game/lobby.js`)**
- Real-time sync of participants and team assignments
- Players can join teams, GM can move/kick players
- GM can start game when teams are ready
- Uses `<template id="tpl-lobby">` from index.html

**Live Game (`game/renderGame.js`)**
- Single controller: mounts `tpl-game`, attaches ~10 RTDB listeners, builds the
  board via `createBoard.js`, and owns all GM adjudication writes inline
  (no separate service/state module).
- GM clicks a tile → `selectedTile`; GM clicks OK → posts `currentQuestion` +
  `swirlStartTime`
- Image starts swirling via `swirl.js` (Canvas-based animation)
- Players buzz in via `buzz.js` (writes to `/buzzQueue`)
- Buzz pauses swirl animation automatically (first buzz)
- GM reveals answer (cancels swirl) and awards points to a team
- Tile state tracked: `opened` (revealed) vs `answered` (finalized with checkmark)

### Data Layer

**Firebase RTDB Structure**
```
/gameIndex/{gameId}: true             # Public existence flag
/games/{gameId}/
  ├─ hostUid, isPublic, title, gmName, createdAt
  ├─ settings: { boardId, boardRev, teamsEnabled }   # boardId = board slug; boardRev = its published revision
  ├─ state: { phase: 'lobby'|'live'|'ended', endedAt? }
  ├─ teams: { A: {name}, B: {name} }
  ├─ scores: { A: number, B: number }
  ├─ participants/{uid}: { displayName, team: 'A'|'B'|'none', joinedAt, isGM, online?, lastSeen? }
  ├─ board/{col-row}: { id, col, row, category, imageUrl, answer, value,
  │                     opened, answered, answeredBy, awardedPoints, locked, lastActionAt }
  ├─ currentTurn: { uid, team }         # display-only "who is up"
  ├─ startingTeamReveal: { team, revealAt: serverTimestamp }  # written once at game start; drives synchronized coin-flip phase
  ├─ selectedTile: { id, category, value }   # GM picked, not yet posted
  ├─ currentQuestion: { id, category, imageUrl, answer, value, showAnswer }
  ├─ swirlStartTime: serverTimestamp
  └─ buzzQueue/{pushId}: { uid, createdAt }
```

Note: `phase` is `lobby | live | ended` (not `playing`). RTDB writes go directly
through `update()`/`set()` in the controllers using path builders from
`data/paths.js` — there is intentionally **no** service-abstraction module.

**Board Materialization (`game/createGame.js`)**
- `loadBoardForGame(boardId, now)` fetches the board's published snapshot
  (`data/boardsApi.js getBoard`), converts it with `toBoardSet()` and returns
  `{ board, boardMeta }`. `createGameShell()` calls it **before** writing
  anything, so an API failure can't leave a half-created game.
- `buildBoardFromSet()` accepts two shapes:
  - `{ columns: [{ title, rows: [{ imageUrl, answer, value }] }] }` (what `toBoardSet()` produces)
  - `{ categories: string[], board: Tile[][] }` (old bundled shape, still handled)
- Output keyed by `"col-row"` (e.g., `"0-3"`) with content + live-state fields
- Tile `value` comes from the board's `points` by row → 100–500

### Boards: content from the Worker (`worker/`, `src/shared/`, D1 + R2)

Boards are content in a database, not code (PROPOSAL.md §4):
- **D1** (`migrations/0001_init.sql`): `boards` (draft_json = what admins edit,
  published_json = the snapshot players get, status `draft|published|import|archived`,
  unique `title_key`), `board_revisions` (one row per publish), `images`
  (provenance + rights), `audit_log`, `import_runs`.
- **R2**: pictures under content-hash keys — `display/<sha256>.webp` (≤1280 px),
  `thumb/<sha256>.webp` (≤320 px) are public via `/media/*`; `archive/` (≤2560 px
  private copy) and `evidence/` never are.
- **Worker** (`worker/index.js`, routes in `worker/routes/`, logic in
  `worker/lib/`): `GET /api/boards` (published list), `GET /api/boards/:id|slug`
  (snapshot), `GET /media/*` (immutable cache, 304s), `GET /api/health`. Only
  `/api/*` and `/media/*` run the Worker (`wrangler.jsonc run_worker_first`);
  everything else is a static asset. Pictures are same-origin on purpose: the
  swirl reads canvas pixels, which cross-origin images would block.
- **Shared rules** (`src/shared/boards.js`, `src/shared/rights.js`) are imported
  by the game, the Worker and the Node scripts — one definition of board shape,
  snapshot, slugs/title uniqueness, and what each license means (ok ✅ /
  flagged ⚠️ with a reason / blocked ❌).
- **Seed**: `npm run dev` runs `scripts/seed-local.mjs`, which loads the
  internal test board *Pop Culture Icons* from `content/seed/` into the local
  D1/R2 (pictures normalized by `tools/content/lib/images.mjs` with sharp). Its
  pictures are flagged "Rights unknown" — it's a test board.

**Admin API** (`worker/routes/admin.js`; UI at `/admin/` from M2):
- Auth (`worker/lib/auth.js`): one shared password (secret `ADMIN_PASSWORD`) +
  a "who's editing" name → HMAC-signed session cookie `pt_admin` (secret
  `SESSION_SECRET`, HttpOnly, SameSite=Strict, 7 days). Failed logins are
  rate-limited per IP (10 / 15 min, D1 `login_attempts`). Writes with a foreign
  `Origin` are refused. Admin returns 503 unless both secrets are set. The
  name is the `actor` in the audit log.
- Boards: list, create (blank 5×5 draft), get (draft + pictures + publish
  check), **autosave** `PUT` with optimistic concurrency (`rev`; stale → 409
  `{error:'stale', rev}`), publish (the **gate**: `validateForPublish` in
  `src/shared/boards.js` — missing pictures/answers/names or a ❌ blocked
  picture block; ⚠️ flags, small pictures, duplicate answers only warn),
  unpublish/archive/restore (status machine at the top of `worker/lib/boards.js`),
  duplicate, bulk (never stops at the first failure), title check, stats, audit.
- Pictures: `POST /api/admin/images` takes browser-normalized WebP/JPEG files
  (type sniffed + size read from the header: `worker/lib/media.js`);
  `POST /api/admin/images/fetch` downloads a link (or a page's og:image) with
  SSRF guards (`worker/lib/fetchImage.js`) and returns the bytes for the
  browser to normalize; `PATCH /api/admin/images/:id` edits rights (re-assessed,
  ⚠️ counts of boards using it recomputed).
- Errors are JSON `{ error, message, ...details }` via `HttpError(status, code, message, details)`.

Snapshot shape (what `/api/boards/:id` returns):
```javascript
{ id, slug, rev, title, emoji, description, points: [100, 200, 300, 400, 500],
  categories: [ { title, tiles: [ { answer, image: { url, thumb, width, height }, credit } ] } ] }
```

### UI Patterns

**DOM Helpers (`ui/dom.js`)**
- `byId(id)`: querySelector with null safety
- `enable(el)`, `disable(el)`: button state management
- `on(el, event, handler)`: event listener attachment

**Templates (`index.html`)**
- Lobby: `<template id="tpl-lobby">`
- Game: `<template id="tpl-game">`
- Cloned via `template.content.cloneNode(true)` and injected into `#app`

**Presence Tracking**
- Client-side: `lobby.js` (`attachPresence`) writes `{ online: true, lastSeen: serverTimestamp() }` on connect
- Uses `.info/connected` ref and `onDisconnect().remove()` hook
- On disconnect the participant node is removed so the lobby updates immediately

### Animation System

**Swirl Effect (`game/swirl.js`)**
- Canvas-based progressive reveal over 30s
- Server-aligned elapsed time: `swirlStartTime` (RTDB server timestamp) is
  compared against `Date.now() + .info/serverTimeOffset`, never raw `Date.now()`,
  so a device with a skewed clock still starts at the same point as everyone else
- Runs at a capped working resolution (`MAX_WORKING_PX` = 720 on the long edge)
  from an offscreen source canvas — the visible canvas never flashes the clear
  picture, and huge source images (one set ships 6000×4269) stay cheap on phones
- Per-pixel geometry is precomputed; cos/sin come from a per-frame table keyed by
  whole-pixel distance from centre (not two trig calls per pixel per frame)
- Pauses automatically when buzzQueue is non-empty (pause stops the rAF loop;
  resume restarts exactly one — no stacked loops)
- Cancels on answer reveal; `drawUnswirled()` draws the clear image at the same
  capped size
- Returns control object: `{ pause(), resume(), cancel(), isPaused() }`

**Buzz Queue (`game/buzz.js`)**
- Players push to `/buzzQueue` with `{ uid, createdAt: serverTimestamp() }`
- Ordered by `createdAt` for FIFO display
- GM clears queue after awarding points

## Firebase Rules Expectations

The deployed rules (copied from the Firebase console on 2026-10-03) are in
`worker/rooms/firebase-rules.legacy.jsonc` for reference; M4 ports them into the
GameRoom Durable Object. The code assumes:
- `/gameIndex/{gameId}` is world-readable (for join validation)
- `/games/{gameId}` reads require auth
- Host-only writes: game metadata, board state, currentQuestion, scores
- Player writes: own participant fields (online, lastSeen), buzzQueue pushes
- `joinedAt` is immutable after first write

## Configuration

Firebase config via `window.__FIREBASE_CONFIG__` (set in index.html or via script) or Vite env vars:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Example: Store actual config in `.env.local` (gitignored).

## File Organization

```
index.html                     # App shell: Home/Create/Ready/Join views + <template>s (lobby, game)
gallery.html                   # Dev-only component showcase (src/gallery.js)
wrangler.jsonc                 # Cloudflare Worker config: assets, D1 (DB), R2 (MEDIA)
vite.config.js                 # Vite + @cloudflare/vite-plugin (runs the Worker in dev)

src/
├── main.js                    # Entry point
├── config.js                  # App-level constants (limits, swirl, Double Take, teams)
├── firebase.js                # Firebase bootstrap + anonymous auth (live game, until M4)
├── session.js                 # Client-side session state (sessionStorage)
├── prefs.js                   # Durable device prefs (localStorage): remembered names
├── names.js                   # Random player/game/team name generators (puns)
├── gallery.js                 # Component gallery page logic
├── startup/
│   └── boot.js                # App initialization + flow wiring
├── flows/
│   ├── createFlow.js          # Create wizard: details → Pick a Board → Game Ready
│   └── joinFlow.js            # Join game flow
├── data/
│   ├── paths.js               # RTDB path helpers
│   └── boardsApi.js           # Boards from the Worker: listBoards, getBoard, toBoardSet
├── shared/                    # Imported by the game, the Worker AND Node scripts
│   ├── boards.js              # Board shape, slugs/title keys, stats, buildSnapshot
│   └── rights.js              # License meanings + rights flags (ok/flagged/blocked), credits
├── ui/
│   ├── dom.js                 # DOM utilities
│   ├── views.js               # View controller
│   ├── templates.js           # <template> clone + data-ref collection
│   ├── modal.js               # Promise-based modal dialogs
│   ├── boardPicker.js         # "Pick a Board" list (Create step 2 + Play Again)
│   ├── diceButton.js          # "Roll a new name" button (spin + handler)
│   ├── copyButton.js          # Clipboard + checkmark feedback
│   ├── format.js              # escapeHtml
│   ├── confetti.js            # Branded celebration burst
│   ├── sound.js               # Web Audio sound effects
│   ├── howToPlay.js           # "How to Play" overlay
│   └── gmTour.js              # GM Quick Start spotlight tour engine
├── game/
│   ├── createGame.js          # RTDB game shell + board materialization (loadBoardForGame)
│   ├── lobby.js               # Pre-game lobby controller (listeners + UI + presence)
│   ├── lobbyInstructions.js   # Lobby instruction-line state machine (DOM-free)
│   ├── participants.js        # Participant row + presence helpers
│   ├── gmOnboarding.js        # GM tour state (localStorage pt.gm.onboarding.v1)
│   ├── renderGame.js          # Live game controller (listeners + UI + adjudication)
│   ├── createBoard.js         # Builds board DOM from RTDB snapshot
│   ├── turn.js                # Team turn management
│   ├── buzz.js                # Buzz queue helpers (enqueueBuzz, clearBuzzQueue)
│   ├── swirl.js               # Canvas swirl animation
│   ├── controllerKit.js       # Disposer, exit/leave/end helpers
│   ├── renderLateJoin.js      # Late joiner "waiting for GM" screen
│   ├── renderFinale.js        # End-game finale (winner, scores, MVP, Play Again)
│   └── renderRoundSetup.js    # Play Again: GM picks the next board
├── components/                # Factory components (used by the gallery)
├── styles/tokens.css          # Design tokens (Playful Party theme)
└── *.css                      # Per-screen stylesheets (linked from index.html)

worker/                        # Cloudflare Worker (runs only for /api/* and /media/*)
├── index.js                   # Entry: router + error handling
├── routes/public.js           # /api/boards, /api/boards/:id, /media/*
├── lib/http.js                # json(), HttpError, createRouter()
├── lib/db.js                  # D1 helpers, ids, audit(), sha256Hex()
├── lib/boards.js              # Boards: list/get published, createBoard, publishBoard
├── lib/images.js              # Pictures: storeImage (R2 + D1), imagesByIds
└── rooms/firebase-rules.legacy.jsonc  # Firebase rules as deployed (reference for M4)

migrations/0001_init.sql       # D1 schema (applied by `npm run db:migrate:local`)
content/
├── sources/Picture Twirl Content Tracker.xlsx  # Export of the team's Google Sheet
└── seed/pop-icons.json + pop-icons/            # Internal test board (local seed)
tools/content/lib/images.mjs   # Picture normalizing (sharp): display/thumb/archive WebP
scripts/
├── share.js                   # Dev server + Cloudflare quick tunnel (npm run share)
└── seed-local.mjs             # Seeds the local D1/R2 (runs before dev/share)
tests/                         # See TESTING.md
├── unit/*.test.mjs            # node --test: pure logic
├── api/*.test.mjs             # node --test: real Worker + throwaway local D1/R2
└── *.spec.js                  # Playwright browser flows (+ helpers.js, fixtures.js)
```

## Common Patterns

**Adding / Changing Boards**
- Boards are content, not code: they live in D1/R2 and are served by the Worker.
- Until the admin (M2) exists, the only way to add one locally is a seed file:
  `content/seed/<slug>.json` (+ pictures in `content/seed/<slug>/`), listed in
  `SEEDS` in `scripts/seed-local.mjs`; then delete `.wrangler/state` and
  `npm run dev`. From M2 on: `/admin`. From M3 on: `npm run content:*`.
- Board structure: 5 categories × 5 tiles; points by row from `points`
  (default 100–500). Shape + rules: `src/shared/boards.js`.
- Changing the D1 schema = a new numbered file in `migrations/` (never edit an
  applied one) + update `worker/lib/*` + tests in `tests/api/`.

**Adding an API route**
1. Handler in `worker/routes/*.js` (register it in `worker/index.js`); logic in `worker/lib/*`
2. Path must start with `/api/` or `/media/` (only those run the Worker — `wrangler.jsonc`)
3. Throw `HttpError(status, code)` for expected failures; anything else becomes a 500
4. Add an API test (`tests/api/`) — see TESTING.md

**Adding / Editing Name Suggestions**
1. Screen-name words → `PLAYER_ADJECTIVES` / `PLAYER_NOUNS` in `names.js`
2. Team names → `TEAM_NAMES` (keep each under `LIMITS.TEAM_NAME` = 40 chars)
3. Game titles → `GAME_NAMES` (under `LIMITS.GAME_TITLE` = 60 chars)
4. No wiring needed — `prefs.js` and both flows read the lists at call time

**Modifying Game State**
- Host-only writes are direct `update()`/`set()` calls in `lobby.js` / `renderGame.js`,
  using path builders from `data/paths.js`
- Always use `serverTimestamp()` for temporal fields
- Multi-path updates preferred for atomic state changes

**Adding UI Elements**
1. Define in `index.html` (either inline or in templates)
2. Cache in `boot.js` via `byId()`
3. Pass to flow initializers or controllers
4. Wire events with `on()` helper

**Debugging**
- `window.PictureTwirl.boot()` available for manual reboots
- Session changes emit `app:session-changed` CustomEvent
- View changes emit `app:view-changed` CustomEvent
- RTDB writes logged in Firebase console
- Worker: `curl localhost:3000/api/health`; local D1 queries:
  `npx wrangler d1 execute DB --local --command "SELECT slug, status FROM boards"`;
  the dev server also prints a local explorer at `/cdn-cgi/local/explorer/api`

## Testing

See [TESTING.md](TESTING.md). `npm test` (lint + unit + API, no browser) before
every commit; `npm run test:e2e` for browser flows. New behavior ships with a
test at the lowest layer that can see it; bug fixes ship with a test that
failed before the fix.
