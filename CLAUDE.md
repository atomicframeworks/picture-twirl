# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Refactor in progress.** See [REFACTOR.md](REFACTOR.md) for the audit, the
> phased cleanup plan, and the rationale behind structural changes. Keep this
> file and REFACTOR.md in sync — documentation drift is a known past problem here.

> ⚠️ **Cloudflare switch-over — Firebase is gone.** The game, its content
> (Boards: D1 + R2) and every live game (one GameRoom Durable Object per game,
> over WebSockets) run on one Cloudflare Worker. Built on branch `cloudflare`
> (milestones M0–M5, [PROPOSAL.md](PROPOSAL.md) §9) and merged into `main` as
> tag `cloudflare-cutover`.
> **Claude: before writing code, read [MIGRATION.md](MIGRATION.md) and help the
> user through it.** If the user has work from before the switch-over (Firebase
> imports, `predefinedGames.js`, `public/images`, …) and isn't ready to bring it
> over, follow MIGRATION.md §2 and don't merge `main` into it yet. Nobody runs
> `wrangler deploy` by hand — `main` deploys through Workers Builds, and before
> cutover nothing is deployed at all. Testing rules: [TESTING.md](TESTING.md).
> *(Remove this banner about a month after cutover.)*

## Project Overview

Picture Twirl is a multiplayer trivia game where players guess images as they gradually "unswirl" from distorted to clear. Built with Vite and vanilla JavaScript on one Cloudflare Worker: the static site, the content API (D1 + R2) for **Boards**, and live games on **GameRoom Durable Objects** (one per game, pushed to every player over WebSockets). The game features team-based gameplay with a host (GM) who controls game flow and awards points. (Live games used Firebase's Realtime Database until M4.)

**Vocabulary:** a **Board** (e.g. "Pop Culture Icons 🎤") is what a GM picks; it has 5 **Categories** (columns) × 5 **Tiles** (picture + answer + 100–500 points). A **Game** is the live session with a code.

## Development Commands

```bash
# Development server (port 3000): Vite + the Worker (worker/index.js) in the
# local Workers runtime, with local D1/R2 under .wrangler/ (no Cloudflare
# login). `predev` first applies migrations and seeds the test board.
npm run dev

# Tests — see TESTING.md
npm test             # lint + unit + API + realtime (no browser, ~25 s)
npm run test:e2e     # Playwright browser flows (GM + players, all local)
npm run test:all     # both

# Live games (Durable Objects) — see "Realtime" below
npm run measure:realtime                 # latency through a GameRoom (local; --url for a deployed site)
npm run migrate:code                     # rewrite Firebase imports (code from before M4) to src/realtime/
npm run rehearse:migration [-- --run]    # rehearse an old branch's merge in a sandbox (MIGRATION.md)

# Cloudflare, Picture Twirl account — NEVER `wrangler login`/`logout` on this machine
# (its login belongs to another project). A per-command API token instead:
npm run cf:token                         # check the token in cloudflare-token.txt (gitignored; COMMANDS.md → Cloudflare)
npm run cf -- whoami                     # wrangler against the Picture Twirl account only
npm run cf:secrets                       # production Worker secrets in one go (never printed)

# Local database
npm run db:setup:local     # migrate + seed (runs automatically before dev/share)
# Start fresh: stop the dev server, delete .wrangler/state, npm run dev

# Content tools (AI import; dry run unless --live) — COMMANDS.md → Content tools
npm run content:sheet            # boards from content/sources/*.xlsx → content/runs/<run>/report.md
npm run content:discover         # new board ideas from the web
npm run content:sheet -- --resume last --live   # upload a reviewed dry run to the local site

# Production build (site → dist/client, Worker → dist/picture_twirl)
npm run build

# Preview production build
npm run preview

# Dev server + public HTTPS URL via Cloudflare quick tunnel
# (dev on this machine, test on a phone or another computer)
npm run share
```

Local Worker secrets: `.dev.vars` (gitignored; created from `.dev.vars.example`
automatically, and keys added to the example later are appended). The team uses
its real admin password there locally — it must never appear in a committed
file; tests read it from `.dev.vars` (`tests/devVars.mjs`).

### Machine setup is self-healing (read this before "fixing" install errors)
- `node_modules/` and `.wrangler/` are **per machine** and **Dropbox-ignored**
  (the repo lives in Dropbox and is used from Mac and Windows). Never copy them
  between machines.
- `scripts/ensure-setup.mjs` runs before `dev`, `share`, `build`, `test` and
  `test:e2e` (npm `pre*` scripts). It runs `npm install` when `node_modules` is
  missing, was installed for another OS/CPU, or is older than
  `package-lock.json` (marker: `node_modules/.picture-twirl-install.json`);
  creates `.dev.vars` if missing (or appends keys it lacks); and (e2e) installs
  Playwright's Chromium.
  Run it by hand with `npm run setup`.
- If a command still fails with "Cannot find module …", a missing
  `@rollup/rollup-*` / `@img/sharp-*` / `@cloudflare/workerd-*` binary, or a
  platform mismatch: run `npm install` (or `npm run setup`) and retry.

## Architecture

### Bootstrap Flow
Entry: `main.js` → `startup/boot.js`

1. Set up the realtime client (`src/realtime/client.js`): the anonymous player
   identity is read from localStorage (created on first create/join)
2. Create view controller (manages Home/Create/Join screens)
3. Wire up Create and Join flows
4. Wait for the identity before enabling UI interactions

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

**Realtime (`src/realtime/`) — live games, replacing Firebase (PROPOSAL.md §8.4)**
- `client.js` (replaces `src/firebase.js`): the anonymous player identity
  `{ uid, token }` from `POST /api/player`, kept in localStorage `pt.player.v1`
  (it survives tab close, so the host stays the host — AUDIT M15);
  `requireAuth()`, `getCurrentUser()`, `rtdb`; HTTP helpers `getRoomInfo(code)` →
  `{ exists, phase, host }`, `gameExists()`, `reserveGameCode()`; one WebSocket
  per game room holding a local mirror of its tree, reconnecting by itself
  (writes the room hadn't confirmed are re-sent; the room ignores duplicates by
  per-page sequence number), clock sync by ping/pong. Debug:
  `window.PictureTwirl.realtime.stats()` / `.simulateDrop()`.
- `db.js`: the **Firebase-Realtime-Database-shaped API** the game calls —
  `ref, onValue, get, set, update, remove, push, serverTimestamp, increment,
  onDisconnect(ref).set/update/remove/cancel`, `.info/connected`,
  `.info/serverTimeOffset`. The game kept its logic; only import lines changed.
  `npm run migrate:code` rewrites old `firebase/database` / `firebase.js`
  imports; ESLint refuses them (`no-restricted-imports`).
- Paths: `games/<code>/…` live in that game's room (the room's tree is the old
  `/games/<code>` node); `gameIndex/<code>` writes are accepted and ignored.
- Semantics are Firebase's: listeners fire with the current value, then when
  their location changes; a write resolves after the room confirms it (and has
  already pushed the change to everyone, this page included); refused writes
  reject with `PERMISSION_DENIED: …`.

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
   - Gets a collision-free 6-character code from the server (`reserveGameCode()`, AUDIT M4)
   - Calls `createGameShell()`, which creates the whole game — settings, teams,
     board, host row — in ONE write (AUDIT M8)
   - Calls `renderLobby()` to show pre-game lobby
   - Sets session: `{ gameId, isGM: true, displayName }`

**Join Flow (`flows/joinFlow.js`)**
1. `getRoomInfo(code)` → `{ exists, phase, host }` (one HTTP call)
2. Collect player display name
3. On confirm:
   - The game's own host (same browser identity) gets the GM seat back:
     session `isGM: true` → lobby, which forwards to the live game or finale (AUDIT M15)
   - Otherwise sets session `{ gameId, isGM: false, displayName }`; lobby phase →
     `renderLobby()` (registers the participant via `ensureParticipant()`); live
     phase → `renderLateJoin()` (waits for the GM's approval)

**Lobby (`game/lobby.js`)**
- Real-time sync of participants and team assignments
- Players can join teams, GM can move/kick players
- GM can start game when teams are ready
- Uses `<template id="tpl-lobby">` from index.html

**Live Game (`game/renderGame.js`)**
- Single controller: mounts `tpl-game`, attaches ~10 room listeners, builds the
  board via `createBoard.js`, and owns all GM adjudication writes inline
  (no separate service/state module). Award = atomic `increment()`s + a busy
  guard; Back-to-board has a busy guard (AUDIT H6).
- GM clicks a tile → `selectedTile`; GM clicks OK → posts `currentQuestion` +
  `swirlStartTime`
- Image starts swirling via `swirl.js` (Canvas-based animation)
- Players buzz in via `buzz.js` (writes to `buzzQueue`; the room stamps arrival)
- Buzz pauses swirl animation automatically (first buzz)
- GM reveals answer (cancels swirl) and awards points to a team
- Tile state tracked: `opened` (revealed) vs `answered` (finalized with checkmark)

### Data Layer

**Game state — one GameRoom per game (`worker/rooms/`)**
The room's tree (what used to be Firebase's `/games/{gameId}`):
```
games/{code}/
  ├─ hostUid, isPublic, title, gmName, createdAt
  ├─ settings: { boardId, boardRev, teamsEnabled }   # boardId = board slug; boardRev = its published revision
  ├─ state: { phase, endedAt? }         # lobby | live | ended | roundSetup | sessionEnded
  ├─ teams: { A: {name}, B: {name} }
  ├─ scores: { A: number, B: number }   # increment() on award
  ├─ participants/{uid}: { displayName, team: 'A'|'B'|'none', joinedAt, isGM,
  │                        online?, lastSeen?, status?: 'pending'|'active' (late join),
  │                        tileRequest?, eligibleFromQuestionId?, playAgainVote?,
  │                        pointsEarned?, correctAnswers? }
  ├─ board/{col-row}: { id, col, row, category, imageUrl, answer, value, opened,
  │                     answered, answeredBy, awardedPoints, locked, lastActionAt, doubleTake? }
  ├─ currentTurn: { team }              # which team picks next
  ├─ startingTeamReveal: { team, revealAt: serverTimestamp }  # written once at game start; drives synchronized coin-flip phase
  ├─ selectedTile: { id, category, value }   # GM picked, not yet posted
  ├─ currentQuestion: { id, category, imageUrl, answer, value, showAnswer, doubleTake?, awardedTeam? }
  ├─ swirlStartTime: serverTimestamp
  ├─ swirlPaused: boolean
  └─ buzzQueue/{pushId}: { uid, createdAt }
```

Note: `phase` is `lobby | live | ended | roundSetup | sessionEnded`. Writes go
directly through `update()`/`set()` in the controllers using path builders from
`data/paths.js` (via `src/realtime/db.js`) — there is intentionally **no**
service-abstraction module. The room applies each write atomically (multi-path),
resolves `serverTimestamp()` / `increment()` itself, and pushes the change to
every connected page before confirming it to the writer. Players never receive
`board/*/answer`, `board/*/imageUrl`, or `currentQuestion/answer` before
`showAnswer` (AUDIT M7) — see "Room rules" below.

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

**Admin UI** (`/admin/` → `admin/index.html` + `src/admin/`; user guide: [ADMIN.md](ADMIN.md)):
- Vanilla ES modules like the game, styled by `src/admin/admin.css` on the
  game's `tokens.css`. Hash routes (`#/`, `#/boards`, `#/boards/:id`,
  `#/activity`) so `/admin/` is the only page. Libraries: `sortablejs` (drag),
  `emoji-picker-element` (+ self-hosted `emoji-picker-element-data`).
- `lib/dom.js` `h()` builds DOM; **strings are always text, never HTML** (keep
  it that way — board/picture data comes from the database). `lib/api.js` is
  the only fetch path (401 → sign-in). `lib/draftOps.js` = pure board moves
  (unit-tested). `lib/imageTools.js` = in-browser resize to display/thumb/
  archive WebP (JPEG fallback) + upload; links go through the Worker's fetch.
- `views/editor.js`: every edit makes a new draft → re-render → debounced
  autosave `PUT` with `rev` (stale → "Changed elsewhere" banner, never
  overwrite); text inputs update state without re-render (keeps focus);
  ▲▼ = move within a category (points follow the row), ◀▶ = move a category,
  drag a tile by its picture or ⠿ (Sortable `forceFallback` — pointer-based, so
  the browser never drops an image link) — across categories = swap; ⌘/Ctrl+Z
  undo outside text fields; paste targets the tile under the mouse. A dropped
  or pasted link to one of OUR pictures (`/media/display|thumb/<sha>…`) is
  reused via `GET /api/admin/images?sha=` (`ownPictureSha` in `imageTools.js`);
  the link importer refuses this site's own (private) address. `ui/tileDrawer.js`: big picture, preview
  twirl (reuses `src/game/swirl.js`), answer/notes, rights form.

**Admin API** (`worker/routes/admin.js`):
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

**Content tools** (`tools/content/`, PROPOSAL.md §7; how to run: COMMANDS.md → Content tools):
- `npm run content:sheet` (the Content Tracker spreadsheet in `content/sources/`)
  and `npm run content:discover` (new themes; the AI may web-search) share one
  pipeline (`tools/content/pipeline.mjs`): **plan** (AI → 5×5 boards →
  `plan.json`/`plan.md`, made safe by `lib/plan.mjs` `tidyPlan`) → **find** (the
  sheet's own link when it's a free source — Commons file/category or an
  Unsplash photo page — else Wikimedia Commons + Openverse search,
  `lib/sources.mjs`) → **check** (the AI looks at ≤4 previews at a time, picks
  one, flags answer-visible / real person / logo; a picture a person linked in
  the sheet is kept as is and only checked for flags; **Unsplash pictures are
  never shown to the AI** — their terms ask for permission for AI/ML use, so a
  person reviews them) → **fetch** (download; a picture that won't download →
  choose again; normalize with sharp; screenshot the source page as license
  evidence) → **submit** (`--live` only) → **report** (`report.md`).
- Dry run by default. A run is a folder `content/runs/<stamp>-<kind>/`
  (gitignored) checkpointed in `state.json`: `--resume <folder|last>` continues
  after a crash, picks up edits to `plan.json` (changed tiles are redone),
  `--redo <board|board/c-r,…|missing>` re-picks chosen boards/tiles (or every
  tile still without a picture), and
  `--resume … --live` uploads a reviewed dry run without redoing work.
- Everything lands as status `import` (✨ To review); tools never publish.
  Re-runs update their own earlier import via `external_key` (sheet: its
  source categories; discover: its title) **only while it's still `import`** —
  once a person drafts/publishes/archives a board, tools leave it alone ('kept').
- Rights are decided in code, never by the AI: `lib/license.mjs` maps each
  source's license metadata to our codes, `src/shared/rights.js` rates them,
  `rank()` drops NC/ND before anything is downloaded. Commons
  "trademarked"/"personality" restrictions and what the AI check sees
  (logo, real person, answer text) become ⚠️ flags with reasons.
- AI (`lib/ai.mjs`): default `claude-code` = headless `claude -p` on the
  developer's own subscription — strict `--json-schema`, our short system
  prompt, no tools (WebSearch/WebFetch only for discovery), run from an empty
  temp dir so no project context loads (~1.3k tokens + images per check).
  `CONTENT_AI=ollama` = local model; `--ai none` = no AI (sheet only).
- Manners (`lib/http.mjs`): named bot user-agent (never a disguised browser),
  ≥2 s between requests per host, official APIs, Unsplash only for links a
  person put in the sheet (read over plain HTTP; Unsplash+ refused; no
  screenshot — Unsplash blocks automated browsers, so the license text is
  recorded). Picture downloads use `node:https`: Flickr's CDN answers
  `fetch()` (its automatic `Sec-Fetch-Mode: cors`) with 403, and refuses our
  named bot for some photos — `isServed()` probes Openverse originals with a
  ranged GET before the AI looks (a refusal is a "no"; never disguise the bot).
  Wikimedia thumbnails exist only in standard widths (500 px previews, 1920 px
  downloads; other widths are HTTP 400) — keep `sources.mjs` on those.
- **Import API** (`worker/routes/import.js`, `Authorization: Bearer IMPORT_TOKEN`;
  404 when the secret isn't set): `GET /api/import/boards` (all boards + external
  keys, for de-duplication), `POST /api/import/runs`, `PATCH /api/import/runs/:id`,
  `POST /api/import/images` (multipart display/thumb/archive/evidence + meta JSON),
  `POST /api/import/boards` (upsert by `externalKey` → `created|updated|kept`).
  The dashboard lists runs (`GET /api/admin/import-runs`).
- Never run in CI/tests (network + AI). The pure parts are tested:
  `tests/unit/contentPlan.test.mjs`, `tests/unit/contentSources.test.mjs`,
  `tests/api/import.test.mjs`.

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
- Lobby (`participants.js attachPresence`): on `.info/connected` → `{ online: true,
  lastSeen }` + `onDisconnect(row).remove()`. Live game (`attachLivePresence`):
  `onDisconnect(row).update({ online: false, lastSeen })` instead — losing the
  connection mid-game doesn't remove the player.
- The room runs a page's disconnect actions **at once** when the page closes
  (WebSocket close 1000/1001, or the `bye` sent on `pagehide`) — the lobby drops
  the player immediately — and after a **30 s grace period** when the connection
  merely drops, cancelled if the same page reconnects in time (Wi-Fi blips and
  phones waking up don't kick anyone).

### Animation System

**Swirl Effect (`game/swirl.js`)**
- Canvas-based progressive reveal over 30s
- Server-aligned elapsed time: `swirlStartTime` (stamped by the room's clock) is
  compared against `Date.now() + .info/serverTimeOffset` (from ping/pong with the
  room — the fastest of the last 12 round trips), never raw `Date.now()`, so a
  device with a skewed clock still shows the same progress as everyone else
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
- Players push to `buzzQueue` with `{ uid, createdAt: serverTimestamp() }`
- The room stamps `createdAt` with a strictly increasing clock, so ordering by
  it is arrival order — the same on every screen; one buzz per player per open
  question (room rule)
- GM clears queue after awarding points

## Live games: GameRoom (`worker/rooms/`, `worker/routes/rooms.js`)

- One **GameRoom Durable Object** per game code (`ROOMS.idFromName(code)`),
  SQLite-backed, WebSocket Hibernation API (idle rooms cost nothing). The room
  is the single authoritative copy of the game's tree.
- Routes: `POST /api/player` (identity), `POST /api/rooms` (reserve a fresh code
  for 10 min — 6 characters from `23456789abcdefghjkmnpqrstuvwxyz`, checked free),
  `GET /api/rooms/:code` (`{ exists, phase, host }`; host when a Bearer token is
  sent), `GET /api/rooms/:code/ws?token=…&cid=…` (the socket; a browser can't
  read an upgrade's HTTP status, so refusals are close codes: 4401 bad token →
  the client gets a new identity, 4404 not a game code, 4400 bad request).
- Protocol (JSON frames; header of `GameRoom.js`): client → `w` (write ops
  `[{p, v}]` + `seq`), `od` (onDisconnect add/cancel), `ping`, `bye`; room →
  `init` (the viewer's whole view; again when the room is created/deleted),
  `patch` (changed subtrees, per viewer role), `ack`, `pong`.
- Timers: disconnect grace 30 s, idle rooms (no change for 24 h, nobody
  connected) delete themselves (AUDIT M3), reserved codes 10 min. Tests shorten
  them with Worker vars `ROOM_GRACE_MS`, `ROOM_IDLE_MS`, `ROOM_CLAIM_MS`.
- **Room rules** (`worker/rooms/roomCore.js` — pure, unit-tested; ported from and
  tighter than the old Firebase rules, kept for reference in
  `worker/rooms/firebase-rules.legacy.jsonc` until cutover):
  - creating: only into an empty room, as its host (`hostUid` = you), and not a
    code reserved for someone else
  - the host: anything except giving the game away (deleting it is allowed)
  - players: only their own `participants/<uid>` row — `displayName` (≤ 40),
    `team` (lobby only), `online`, `lastSeen`, `joinedAt` (once), `isGM: false`,
    `status: 'pending'` (late join; never self-approve), `tileRequest`,
    `playAgainVote`, clearing `eligibleFromQuestionId` — and one buzz
    `{ uid: self, createdAt }` per open question; joining after the lobby
    requires `status: 'pending'`
  - views: the host sees everything; players get no answers / upcoming pictures
    until the reveal

## Configuration

- **Production:** https://picture-twirl.k-m-mcginty.workers.dev (admin: `/admin/`; workers.dev until a
  custom domain). Account, D1 database id and R2 bucket are pinned in
  `wrangler.jsonc`; pushes to `main` deploy via Workers Builds.
- Live games need `SESSION_SECRET` (signs player identities; `.dev.vars` locally,
  a Worker secret in production). The admin also needs `ADMIN_PASSWORD`; content
  imports `IMPORT_TOKEN` (`.dev.vars.example`).
- No Firebase config anymore — `VITE_FIREBASE_*` lines in an old `.env.local`
  can be deleted. `.env.local` now only holds optional content-tool settings
  (`.env.local.example`).

## File Organization

```
index.html                     # App shell: Home/Create/Ready/Join views + <template>s (lobby, game)
admin/index.html               # The admin page (/admin/) → src/admin/main.js
gallery.html                   # Dev-only component showcase (src/gallery.js)
public/_headers                # Production response headers (noindex/no-frame for /admin)
wrangler.jsonc                 # Cloudflare Worker config: assets, D1 (DB), R2 (MEDIA)
vite.config.js                 # Vite + @cloudflare/vite-plugin (runs the Worker in dev)

src/
├── main.js                    # Entry point
├── config.js                  # App-level constants (limits, swirl, Double Take, teams)
├── session.js                 # Client-side session state (sessionStorage)
├── prefs.js                   # Durable device prefs (localStorage): remembered names
├── names.js                   # Random player/game/team name generators (puns)
├── gallery.js                 # Component gallery page logic
├── realtime/                  # Live games (replaced Firebase in M4) — see "Realtime" above
│   ├── client.js              # Player identity, room sockets + mirror, reconnect, clock sync, room HTTP helpers
│   └── db.js                  # Firebase-RTDB-shaped API: ref/onValue/get/set/update/remove/push/onDisconnect…
├── startup/
│   └── boot.js                # App initialization + flow wiring
├── flows/
│   ├── createFlow.js          # Create wizard: details → Pick a Board → Game Ready
│   └── joinFlow.js            # Join game flow
├── data/
│   ├── paths.js               # Game-state path helpers (games/<code>/…)
│   └── boardsApi.js           # Boards from the Worker: listBoards, getBoard, toBoardSet
├── shared/                    # Imported by the game, the Worker AND Node scripts
│   ├── boards.js              # Board shape, slugs/title keys, stats, buildSnapshot
│   ├── tree.js                # The live-game JSON tree model (paths, writes, sentinels) — room + browser
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
│   ├── createGame.js          # Creates a game in one write + board materialization (loadBoardForGame)
│   ├── lobby.js               # Pre-game lobby controller (listeners + UI + presence)
│   ├── lobbyInstructions.js   # Lobby instruction-line state machine (DOM-free)
│   ├── participants.js        # Participant row + presence helpers
│   ├── gmOnboarding.js        # GM tour state (localStorage pt.gm.onboarding.v1)
│   ├── renderGame.js          # Live game controller (listeners + UI + adjudication)
│   ├── createBoard.js         # Builds board DOM from the game's board
│   ├── turn.js                # Team turn management
│   ├── buzz.js                # Buzz queue helpers (enqueueBuzz, clearBuzzQueue)
│   ├── swirl.js               # Canvas swirl animation
│   ├── controllerKit.js       # Disposer, exit/leave/end helpers
│   ├── renderLateJoin.js      # Late joiner "waiting for GM" screen
│   ├── renderFinale.js        # End-game finale (winner, scores, MVP, Play Again)
│   └── renderRoundSetup.js    # Play Again: GM picks the next board
├── admin/                     # The admin app (see "Admin UI" above)
│   ├── main.js                # Boot: signed out → login; else shell + hash routes
│   ├── admin.css              # Admin styles (on the game's tokens)
│   ├── lib/                   # dom (h), api, router, format, draftOps, imageTools
│   ├── ui/                    # feedback (toasts/dialogs), chips, emojiField, tileDrawer
│   └── views/                 # login, shell, dashboard, boards (table), editor, activity
├── components/                # Factory components (used by the gallery)
├── styles/tokens.css          # Design tokens (Playful Party theme)
└── *.css                      # Per-screen stylesheets (linked from index.html)

worker/                        # Cloudflare Worker (runs only for /api/* and /media/*)
├── index.js                   # Entry: router + error handling
├── routes/public.js           # /api/boards, /api/boards/:id, /media/*
├── routes/admin.js            # /api/admin/* (sign-in, boards, pictures, stats, audit, import runs)
├── routes/import.js           # /api/import/* for the content tools (Bearer IMPORT_TOKEN)
├── routes/rooms.js            # /api/player, /api/rooms (codes, info, WebSocket into a GameRoom)
├── lib/http.js                # json(), HttpError(+details), errorResponse, createRouter()
├── lib/db.js                  # D1 helpers, ids, audit(), sha256Hex()
├── lib/auth.js                # Admin password + session cookie + login rate limit; signed player identities
├── lib/boards.js              # Boards: public reads, admin list/get, create, autosave, publish gate, status machine, bulk, stats, audit
├── lib/images.js              # Pictures: upload checks, storeImage (R2 + D1), rights edits + recount
├── lib/media.js               # Magic-byte type sniffing + header dimensions (WebP/JPEG/PNG)
├── lib/fetchImage.js          # "Paste a link" download: SSRF guards, size cap, og:image
└── rooms/
    ├── GameRoom.js            # The Durable Object: storage, sockets (hibernation), disconnects, alarms
    ├── roomCore.js            # Room rules + player views + patches (pure, unit-tested)
    └── firebase-rules.legacy.jsonc  # The old Firebase rules (reference; delete at cutover)

migrations/0001_init.sql       # D1 schema (applied by `npm run db:migrate:local`)
migrations/0002_admin_login_attempts.sql  # login rate-limit table
content/
├── sources/Picture Twirl Content Tracker.xlsx  # Export of the team's Google Sheet (content:sheet reads it)
├── seed/pop-icons.json + pop-icons/            # Internal test board (local seed)
└── runs/                                       # Content-tool run folders (gitignored)
tools/content/                 # Content tools — npm run content:sheet / content:discover
├── cli.mjs                    # Options → pipeline (--live, --resume, --plan-only, --ai, …)
├── pipeline.mjs               # plan → find → check → fetch → submit → report
└── lib/
    ├── env.mjs                # Settings (env > .env.local > .dev.vars)
    ├── xlsx.mjs, sheet.mjs    # Dependency-free .xlsx reader → Content Tracker items
    ├── prompts.mjs            # AI instructions + JSON schemas (+ flagsFromCheck)
    ├── ai.mjs                 # claude-code (headless claude -p) / ollama backends
    ├── plan.mjs               # tidyPlan, external keys, no-AI fallback, plan.md
    ├── sources.mjs            # Wikimedia Commons, Openverse, sheet links (Commons/Unsplash), rank
    ├── license.mjs            # Source license metadata → our license codes + flags
    ├── http.mjs               # Polite fetching (bot UA, per-host gap, retry), getBytes via node:https
    ├── browser.mjs            # Headless Chromium: source-page screenshots (license evidence)
    ├── images.mjs             # Picture normalizing (sharp): display/thumb/archive WebP
    ├── importApi.mjs          # Client for /api/import/*
    └── run.mjs                # Run folders + state.json checkpoints
scripts/
├── share.js                   # Dev server + Cloudflare quick tunnel (npm run share)
├── ensure-setup.mjs           # Self-healing setup (npm install / .dev.vars / e2e browser)
├── seed-local.mjs             # Seeds the local D1/R2 (runs before dev/share; PT_STATE_DIR for others)
├── e2e-server.mjs             # Isolated server for Playwright: :3100, fresh .wrangler/e2e-state
├── migrate-code.mjs           # npm run migrate:code — Firebase imports → src/realtime/ (--check)
├── measure-realtime.mjs       # npm run measure:realtime — latency through a GameRoom
├── rehearse-migration.mjs     # npm run rehearse:migration — Lu's cutover merge in a sandbox (fresh Claude session)
├── cf.mjs, cf-token.mjs, cf-secrets.mjs  # npm run cf / cf:token / cf:secrets — the Picture Twirl Cloudflare account (COMMANDS.md)
├── lib/cloudflare.mjs         # token from cloudflare-token.txt (gitignored), wrangler env, which secrets to set
└── lib/wranglerConfig.mjs     # wrangler.jsonc from Node; a no-Durable-Objects copy for getPlatformProxy tools
tests/                         # See TESTING.md
├── unit/*.test.mjs            # node --test: pure logic
├── api/*.test.mjs             # node --test: real Worker + throwaway local D1/R2
├── realtime/*.test.mjs        # node --test: real Worker + GameRoom DOs over WebSockets (createTestHarness)
└── *.spec.js                  # Playwright browser flows (+ helpers.js, fixtures.js)
```

## Common Patterns

**Adding / Changing Boards**
- Boards are content, not code: they live in D1/R2 and are served by the Worker.
- By hand: `/admin/` (ADMIN.md). In bulk: `npm run content:sheet` /
  `content:discover` → ✨ To review, then check + publish in `/admin/`.
  Built-in local test data: a seed file `content/seed/<slug>.json` (+ pictures
  in `content/seed/<slug>/`), listed in `SEEDS` in `scripts/seed-local.mjs`.
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
  using path builders from `data/paths.js` and functions from `src/realtime/db.js`
- Always use `serverTimestamp()` for temporal fields; `increment(n)` for counters
  (scores, stats) — the room applies it atomically
- Multi-path updates preferred for atomic state changes
- A new field players write themselves (in their own participant row) must be
  added to `PLAYER_FIELDS` in `worker/rooms/roomCore.js` (+ a unit test), or the
  room refuses it. Anything answer-like goes to players only via `redact()`.

**Adding UI Elements**
1. Define in `index.html` (either inline or in templates)
2. Cache in `boot.js` via `byId()`
3. Pass to flow initializers or controllers
4. Wire events with `on()` helper

**Debugging**
- `window.PictureTwirl.boot()` available for manual reboots
- Session changes emit `app:session-changed` CustomEvent
- View changes emit `app:view-changed` CustomEvent
- Live games: `window.PictureTwirl.realtime.stats()` (connected, round trips,
  clock offset, reconnects, pending writes); `.simulateDrop()` cuts the
  connection like a Wi-Fi drop; `npm run measure:realtime` for latency numbers
- Worker: `curl localhost:3000/api/health`; local D1 queries:
  `npx wrangler d1 execute DB --local --command "SELECT slug, status FROM boards"`;
  the dev server also prints a local explorer at `/cdn-cgi/local/explorer/api`

## Testing

See [TESTING.md](TESTING.md). `npm test` (lint + unit + API + realtime, no browser) before
every commit; `npm run test:e2e` for browser flows. New behavior ships with a
test at the lowest layer that can see it; bug fixes ship with a test that
failed before the fix.
