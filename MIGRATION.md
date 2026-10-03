# MIGRATION.md — Picture Twirl moved to Cloudflare (Firebase is gone)

> **For Lu and Lu's Claude.** The switch-over landed on `main` as one merge,
> tagged **`cloudflare-cutover`** (the old world is tagged `pre-cloudflare`).
>
> **Claude:** read this whole file before changing code in this repo, then walk
> the user through it: ask whether they have unmerged work (§2), get their
> machine running (§3), and if they have in-flight work, bring it over with
> them step by step (§5). Explain what you're doing in plain words; never run
> `wrangler deploy`, never force-push, never delete branches.

**Contents:** 1. What changed · 2. Not ready? Don't merge yet · 3. First run
after pulling · 4. Cloudflare access (optional) · 5. Bringing in-flight work
over · 6. The realtime layer vs Firebase · 7. Troubleshooting · 8. Who owns what

---

## 1. What changed

```
BEFORE  (main up to pre-cloudflare)              AFTER  (cloudflare-cutover)

Browser ─┬─► Firebase Realtime Database          Browser ──► ONE Cloudflare Worker (one URL)
         └─► Firebase anonymous auth                          ├─ the game + /admin/ (static files)
Boards:  src/predefinedGames.js + public/images               ├─ /api/boards, /media/*  ← D1 (database) + R2 (pictures)
Rules:   Firebase console (not in git)                        ├─ /api/admin/*           ← the admin app
Hosting: (local only)                                         ├─ /api/import/*          ← AI content tools
                                                              └─ /api/rooms/:code/ws    ← one GameRoom Durable Object
                                                                                          per live game (WebSockets)
```

The game itself plays the same. Under the hood:

| Before | After | Notes |
|---|---|---|
| `src/firebase.js` (init, anonymous auth, `gameExists`) | `src/realtime/client.js` | Same names: `rtdb`, `requireAuth`, `getCurrentUser`, `waitForAuthReady`, `gameExists` (+ `getRoomInfo`, `reserveGameCode`). `initializeFirebase` still works (renamed `initializeRealtime`). |
| `firebase/database` (`ref`, `onValue`, `update`, …) | `src/realtime/db.js` | Same function names and behavior (§6). `npm run migrate:code` rewrites the imports. |
| Firebase anonymous uid | player uid `p_…` | From `POST /api/player`, signed by the Worker, kept in localStorage `pt.player.v1`. `getCurrentUser().uid` as before. The same browser stays the same player — and the host stays the host. |
| `/games/{code}` in Firebase | that game's **GameRoom** (`worker/rooms/`) | Same tree, same paths (`games/<code>/…`, `src/data/paths.js`). |
| `/gameIndex/{code}` | gone | `GET /api/rooms/:code` → `{ exists, phase, host }`. Writes to `gameIndex/…` are ignored. |
| Firebase rules (console) | `worker/rooms/roomCore.js` | In git, unit-tested, **stricter** for players (§6). Old rules for reference: `worker/rooms/firebase-rules.legacy.jsonc`. |
| `generateGameId()` in the browser | `reserveGameCode()` (server) | 6 characters, never collides with a live game. |
| `src/predefinedGames.js` | Boards in the database | Made and published in **`/admin/`** (ADMIN.md); the game lists them from `/api/boards` (`data/boardsApi.js`, `ui/boardPicker.js`). |
| `public/images/*` | R2: `/media/display/<hash>.webp` | Uploaded through the admin. The old test board lives in `content/seed/` (seeded locally). |
| `.env.local` with `VITE_FIREBASE_*` | not needed | Local secrets are in `.dev.vars` (created automatically). |
| e2e tests against the real Firebase | all local | `npm run test:e2e` needs no account. |

More: CLAUDE.md (architecture + file map), PROPOSAL.md (why, and the
decisions), REFACTOR.md (change log), TESTING.md, COMMANDS.md, ADMIN.md.

---

## 2. Not ready? Don't merge yet

**Nothing changes for you until you bring `main` into your work.** Keep going on
your own branch, and come back to §5 when you're ready.

```bash
git status                      # commit (or stash) what you have first
git switch -c lu/wip            # if you were working on main: your commits move to lu/wip
git fetch origin                # always safe — downloads, changes nothing in your files
# … keep committing on lu/wip; DON'T `git pull` on main / `git merge origin/main` yet
```

- It's **one merge** — you can't take part of it.
- After cutover, pushing to `main` **deploys the live site**. git won't let you
  push old work over the new `main` (it isn't a fast-forward) — don't
  `--force` it; merge first (§5).
- Pulled by accident?
  - Merge stopped with conflicts → `git merge --abort` puts you back.
  - Merge finished and you haven't committed anything since →
    `git reset --keep ORIG_HEAD` undoes it.
  - Anything else → ask Claude to look at `git reflog` with you; nothing is lost.

---

## 3. First run after pulling (each machine, each OS)

1. **`npm run dev`** — that's it. Setup is automatic
   (`scripts/ensure-setup.mjs`): `npm install` when `node_modules` is missing,
   stale or from the other OS (Dropbox!), `.dev.vars` from `.dev.vars.example`,
   then the local database is migrated and seeded. Needs **Node 22+**.
   The local Cloudflare runtime runs on macOS 13.5+, Windows 11 and glibc Linux
   (on anything else use Docker, below).
2. **Play:** http://localhost:3000 in two windows (one normal + one private, or
   two browsers) — one creates the game (GM), the other joins.
3. **Admin:** http://localhost:3000/admin/ — the password is `ADMIN_PASSWORD` in
   your `.dev.vars` (a fresh checkout has the throwaway `dev-admin-password`;
   ask the project owner for the team password if you want the same one as the
   live site — put it only in `.dev.vars`, never in a committed file).
4. **Phones:** `npm run share` → a public HTTPS link for a real multi-device
   game.
5. **Delete** the old Firebase `.env.local` (or keep only content-tool settings
   — see `.env.local.example`).
6. **Check the machine:** `npm test` (~25 s) and `npm run test:e2e` (~1 min,
   downloads Playwright's Chromium the first time). Both fully local.
7. **No Cloudflare login** is needed for any of this.
8. **Docker users:** the image is Debian now (the local runtime doesn't run on
   Alpine): `docker compose down -v && docker compose up`.

Dropbox: `node_modules/` and `.wrangler/` (the local database) must not sync —
see README → "This repo lives in Dropbox".

---

## 4. Cloudflare access (optional)

- Make a free Cloudflare account and accept the invite to the Picture Twirl
  account. You get the dashboard: logs, deploys, preview links.
- **Deploys happen by pushing to `main`** (Workers Builds); every pull request
  gets its own **preview URL** (on staging data).
- Day to day you never need `wrangler login`, and nobody runs `wrangler deploy`
  by hand.

---

## 5. Bringing in-flight work over (the merge)

Claude: do these one at a time with the user, explaining each.

1. **Commit everything** on your branch (`git status` clean).
2. **Merge:** `git fetch origin && git merge origin/main`
3. **Resolve conflicts** with the table in §1. The usual ones:
   - **Import lines** in game files (`src/game/*.js`, `src/flows/*.js`,
     `src/startup/boot.js`): take `main`'s `../realtime/…` imports, keep the
     rest of your change.
   - **`src/firebase.js` deleted on `main`, changed on your side** → keep it
     **deleted**; move your change to `src/realtime/client.js` (identity,
     connection) or to the game file that needed it.
   - **`src/predefinedGames.js` / `public/images/*` deleted** → keep them
     deleted. New boards are made in `/admin/` (ADMIN.md); for test data, a
     seed file in `content/seed/` (CLAUDE.md → "Adding / Changing Boards").
   - `src/game/createGame.js`, `src/flows/createFlow.js`,
     `src/flows/joinFlow.js`, `src/startup/boot.js` changed on `main` beyond
     imports (one-write game creation, server game codes, host rejoin): keep
     `main`'s logic, re-apply your change on top.
4. **`npm run migrate:code`** — rewrites any `firebase/database` / `firebase.js`
   imports left in your code (safe to run again and again). It lists anything
   it can't convert under "Needs a human" → §6.
5. **`npm run lint`** — must be 0 errors. The lint guard refuses any Firebase
   import that's still around.
6. **`npm test`**, then **`npm run test:e2e`**.
7. **Play it:** `npm run dev`, two windows. If something you added doesn't
   sync or shows `PERMISSION_DENIED` in the console → §6.
8. **Commit the merge**, push your branch, open a pull request (it gets a
   preview URL). Merge to `main` when it's green — that deploys.

---

## 6. The realtime layer vs Firebase

**Same calls, same behavior** (`src/realtime/db.js`): `ref`, `child`, `onValue`
(returns its unsubscribe function), `get`, `set`, `update` (multi-path),
`remove`, `push`, `serverTimestamp`, `onDisconnect(ref).set/update/remove/cancel`,
`.info/connected`, `.info/serverTimeOffset`. New: **`increment(n)`** — atomic
counters; use it for scores and stats instead of read-then-write.

**Not there** (none of the game used them): `query`/`orderBy…`/`limitTo…`,
`onChildAdded/Changed/Removed`, `runTransaction`, `off`. If you need one, add it
to `src/realtime/db.js` (most can be built on `onValue`) with a test in
`tests/realtime/client.test.mjs`.

**Writes are checked by the room's rules** (`worker/rooms/roomCore.js`):
- The **host** may change anything in the game.
- **Players** may only change **their own `participants/<uid>` row** — and only
  these fields: `displayName`, `team` (in the lobby), `online`, `lastSeen`,
  `joinedAt` (once), `isGM: false`, `status: 'pending'` (late join),
  `tileRequest`, `playAgainVote`, clearing `eligibleFromQuestionId` — plus **one
  buzz per open question**.
- A refused write rejects with a clear error in the console, e.g.
  `PERMISSION_DENIED: Players can’t set “emojiReaction” like that.`
- **Your feature adds a field players write?** Add one line to `PLAYER_FIELDS`
  in `worker/rooms/roomCore.js` (what values are allowed) and a test in
  `tests/unit/roomCore.test.mjs`.
- **A player action outside their own row** (like picking a tile): write a
  request into the player's own row and let the host's browser act on it — see
  `tileRequest` in `src/game/renderGame.js`.

**Players don't receive answers.** `board/*/answer`, `board/*/imageUrl` and
`currentQuestion/answer` (until `showAnswer` is true) are removed from what
players' browsers get — devtools can't spoil the game. Anything that shows an
answer to players must wait for the reveal.

**Also different:**
- Game codes come from the server (`reserveGameCode()`), 6 characters, stored
  lowercase, shown uppercase.
- Closing a tab runs its `onDisconnect` actions at once; a dropped connection
  gets **30 s** to come back first (Wi-Fi blips don't kick anyone).
- The room stamps `serverTimestamp()` with its own clock — buzz order is arrival
  order, the same on every screen.
- Debug in the browser console: `PictureTwirl.realtime.stats()` (connected,
  round trips, clock offset) and `PictureTwirl.realtime.simulateDrop()`.

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 3000 is in use` | Another dev server is running — stop it (Ctrl+C in its terminal). `npm run share` needs 3000 free. |
| `Cannot find module …` / an `@rollup/rollup-…`, `@img/sharp-…` or `@cloudflare/workerd-…` binary for the wrong OS | `node_modules` came from the other OS (Dropbox): `npm run setup` (or delete `node_modules` and `npm install`). Then set Dropbox to ignore it (README). |
| Admin says "not configured" (503), or games won't start | `.dev.vars` is missing secrets: `npm run setup` recreates it from `.dev.vars.example`; restart `npm run dev`. |
| Changed `.dev.vars` but nothing changed | Restart `npm run dev` (it reads the file at start). |
| `PERMISSION_DENIED: …` in the console | A write the room's rules refuse — §6. |
| "Can't reach the game right now" | The dev server isn't running, or the network dropped (the game reconnects by itself). |
| A Firebase import error / lint error mentioning `firebase` | `npm run migrate:code`, then `npm run lint`. |
| `src/firebase.js` came back after a merge | Delete it (§5 step 3). `npm run migrate:code -- --check` reports it. |
| The local runtime won't start (old macOS, Windows 10, Alpine) | Use Docker (README → Docker fallback). |
| Start the local database over | Stop the dev server, delete `.wrangler/state`, `npm run dev` (migrates + seeds again). |
| First `npm run test:e2e` is slow | It downloads Playwright's Chromium (~90 MB) once. |
| Still stuck | Ask Claude to read CLAUDE.md, this file and the exact error together. |

---

## 8. Who owns what

- **Project owner:** the Cloudflare account (Picture Twirl), the domain, and the
  secrets — admin password, `SESSION_SECRET`, `IMPORT_TOKEN` (set as Worker
  secrets; never in git). The old Firebase project stays untouched for about
  two weeks after cutover as a reference, then gets deleted.
- **Lu:** game features — branches, pull requests (preview URLs), merging to
  `main` (deploys).
- **Both:** boards in `/admin/` (ADMIN.md) and the content tools
  (`npm run content:*`, COMMANDS.md).
- **Where things are written down:** CLAUDE.md (architecture, file map),
  TESTING.md (how to test; every change ships with tests), COMMANDS.md,
  ADMIN.md, PROPOSAL.md (decisions), REFACTOR.md (change log), this file.
- Questions → the project owner; Claude can answer most "where is …" ones from
  CLAUDE.md.
