# Picture Twirl — Refactor Log & Plan

> **Purpose of this file.** This is the durable record of the maintainability
> refactor: what we found, what we changed, *why* we changed it, and what is
> still planned. It is meant to be ingested in future sessions to guide
> decisions so we don't re-derive context or repeat mistakes. Update it as work
> progresses. If this file and [CLAUDE.md](CLAUDE.md) ever disagree, fix one of
> them — drift is what got us here.

**Started:** 2026-06-13
**Goal:** Make the codebase simpler to maintain, easier to edit, and faster to
develop in — without changing player-facing behavior (except bug fixes).

---

## 1. Guiding principles

1. **Reversibility first.** Everything happens on git now (Phase 0). No change
   lands without a commit, so anything can be undone or bisected.
2. **Behavior-preserving unless it's a bug.** Phase 1 is pure deletion and
   doc fixes — the running app must behave identically. Bug fixes are called
   out explicitly.
3. **Delete before you abstract.** Dead code is the cheapest thing to remove and
   the most expensive thing to refactor around. Kill it first.
4. **One source of truth.** RTDB paths live in `data/paths.js`. Config constants
   live in `config.js`. Docs describe what the code *actually does*. Where we
   found three competing definitions of the board shape, we collapse to one.
5. **Small, reviewable steps.** Each phase is its own commit (or set of commits)
   with a clear message, so a human can review the diff in one sitting.

---

## 2. Architecture as-built (the real flow)

```
main.js → boot.js
            ├─ initializeFirebase() + waitForAuthReady()        [firebase.js]
            ├─ caches ~30 DOM nodes by id
            ├─ createViewController({home,create,gameReady,join}) [ui/views.js]
            ├─ initCreateFlow(deps)   — 26 injected deps          [flows/createFlow.js]
            └─ initJoinFlow(deps)     — 12 injected deps          [flows/joinFlow.js]
                                            │
          createGameShell() / gameExists() ┤
                                            ▼
                            renderLobby(gameId)                   [game/lobby.js]
                              ├─ mountTemplate('tpl-lobby') + collectRefs
                              ├─ ~8 onValue listeners
                              └─ phase==='live' → renderGameUI(gameId)
                                    renderGameUI(gameId)          [game/renderGame.js]
                                    ├─ mountTemplate('tpl-game') + collectRefs
                                    ├─ ~10 onValue listeners
                                    ├─ createBoard()              [game/createBoard.js]
                                    ├─ startSwirlAnimation()      [game/swirl.js]
                                    └─ enqueueBuzz/clearBuzzQueue [game/buzz.js]
```

### Module roles (kept)

| File | Role | Health |
|---|---|---|
| `main.js` | DOM-ready entry, exposes `window.PictureTwirl.boot` | good |
| `startup/boot.js` | Firebase init + DOM caching + flow wiring | works; over-large DI bags |
| `config.js` | Constants (limits, teams, swirl) | had dead constants (Phase 1) |
| `session.js` | Observable ephemeral session (sessionStorage) | good, well-built |
| `firebase.js` | Firebase/RTDB singleton + anon auth gate | good |
| `data/paths.js` | Central RTDB path builders | good — keep using it |
| `flows/createFlow.js` | Create-game wizard (details → set → ready) | works |
| `flows/joinFlow.js` | Join-game form + validation | works |
| `game/createGame.js` | Materializes game shell + board into RTDB | had a shadowing bug (Phase 1) |
| `game/lobby.js` | Lobby controller (553 lines) | **Phase 2 split target** |
| `game/renderGame.js` | Live-game controller (510 lines) | **Phase 2 split target** |
| `game/createBoard.js` | Builds board DOM from RTDB snapshot | had dead imports (Phase 1) |
| `game/swirl.js` | Canvas swirl animation | **Phase 3 perf target** |
| `game/buzz.js` | Buzz queue helpers | 2 dead exports (Phase 1) |
| `ui/dom.js` | DOM helpers | several unused (Phase 1) |
| `ui/views.js` | View visibility controller | good |
| `ui/templates.js` | `<template>` clone + `data-ref` collection | good |
| `ui/modal.js` | Promise-based modal kit | good, self-contained |
| `ui/copyButton.js` | Clipboard + checkmark feedback | good |
| `predefinedGames.js` | Game content (currently 1 set, 5×5) | good |

---

## 3. Data model (authoritative)

RTDB structure as the code actually uses it:

```
/gameIndex/{gameId}: true                 # public existence flag (join validation)
/games/{gameId}/
  ├─ hostUid, isPublic, createdAt, title, gmName
  ├─ settings:   { setId, teamsEnabled }
  ├─ state:      { phase: 'lobby' | 'live' | 'ended', endedAt? }
  ├─ teams:      { A: {name}, B: {name} }
  ├─ scores:     { A: number, B: number }
  ├─ participants/{uid}: { displayName, team: 'A'|'B'|'none', joinedAt, isGM, online?, lastSeen? }
  ├─ board/{col-row}: { id, col, row, category, imageUrl, answer, value,
  │                     opened, answered, answeredBy, awardedPoints, locked, lastActionAt }
  ├─ currentTurn:    { uid, team }         # "who is up" (display only)
  ├─ selectedTile:   { id, category, value }  # GM picked, not yet posted
  ├─ currentQuestion:{ id, category, imageUrl, answer, value, showAnswer }
  ├─ swirlStartTime: serverTimestamp       # server-aligned swirl sync
  └─ buzzQueue/{pushId}: { uid, createdAt }
```

**Phase values are `lobby | live | ended`** (not `lobby | playing` as old docs
claimed). **Tile keys are `"col-row"`** (e.g. `"0-3"`). **Point values are
`(row+1)*100` → 100–500**, materialized in `createGame.js`; there is no separate
point-value config in use.

---

## 4. Findings (the audit)

### 4.1 Dead files (removed in Phase 1)
- `src/game/services/gameService.js` — never imported. Its functions were
  reimplemented inline in `lobby.js` / `renderGame.js`. The whole `services/`
  folder goes.
- `src/game/teams.js` — never imported (`assignToTeam`, `setUserTeam`).
- `src/game/renderGame.js.tmp.*` ×2, `src/startup/boot.js.tmp.*` ×2 — editor
  crash artifacts.
- `src/javascript.svg`, `public/vite.svg` — leftover Vite scaffold assets.

### 4.2 Dead code (trimmed in Phase 1)
- `config.js`: `CATEGORY_COUNT`, `ROW_COUNT`, `POINT_VALUES`, `DEBUG` — never read.
- `ui/dom.js`: `qs`, `qsa`, `el`, `show`, `hide`, `setText`, `setHTML` — never used
  (only `byId`, `enable`, `disable`, `on` are). *Decision: keep `dom.js` lean — see Phase 1 notes.*
- `game/buzz.js`: `deleteBuzz`, `onBuzzQueue` — never imported.
- `game/createBoard.js`: imports `getSession` and `clearBuzzQueue` but uses neither.

### 4.3 Bugs / correctness risks
- **`createGame.js` variable shadowing** *(fixed Phase 1)*: `const set = predefinedGames.find(...)`
  shadowed the imported Firebase `set` function. Harmless today only because no
  `set()` call follows in that scope — a latent trap. Renamed to `gameSet`.
- **Point-value inconsistency**: `config.POINT_VALUES = [200..1000]` contradicted the
  real `(r+1)*100` → 100–500 used at materialization. Resolved by deleting the
  unused config (code wins; it's the source of truth).
- **Lobby instruction state machine** (`lobby.js` ~150–322): juggles
  `lastAssignedTeam`, `playerJoinTimeout`, `lastPlayerTeam`, `selectedPid` across
  two observers + timeouts. Fragile. **Deferred to Phase 2** (needs real
  restructure, not a quick fix).

### 4.4 Documentation drift (fixed Phase 1 — CLAUDE.md rewrite)
- CLAUDE.md referenced `game/board.js` and `game/gameState.js` — **neither exists.**
- Claimed board is "5×5" while `config.js` said 6×4 and content is 5×5.
- Claimed phases `lobby|playing`; real is `lobby|live|ended`.
- Claimed GM writes go through `gameService.js` (dead file).

### 4.5 Performance (deferred to Phase 3)
- `swirl.js` runs a per-pixel double loop with `sqrt/sin/cos` **every frame** for
  30s. Millions of trig ops/frame on the full-res image → jank on phones (the
  target device). Options: precompute a displacement map, downscale the working
  canvas, or move to CSS/WebGL distortion.

### 4.6 Tooling / structure (Phase 3)
- `package-lock.json` **is** committed (good). No linter/formatter/tests.
- `vite.config.js` is bare; no committed `.env.local` example despite CLAUDE.md
  referencing one.
- 8 global CSS files (~1,350 lines) linked from `index.html`. No scoping. Fine
  now; collision risk as it grows.
- `docker-compose.yml` exists (node:24-alpine dev container on port 3000).

---

## 5. Phased plan

### Phase 0 — Safety net ✅ DONE
- `git init`, extend `.gitignore` (`*.tmp.*`, `desktop.ini`, `Thumbs.db`),
  baseline commit of the untouched app.

### Phase 1 — Free cleanup (zero behavior change) — IN PROGRESS
- Delete dead files (4.1) and dead code (4.2).
- Fix `set` shadowing bug (4.3).
- Rewrite CLAUDE.md to match reality (4.4).
- One commit, reviewable as "deletions + docs."

### Phase 2 — Structural (the maintainability payoff) — PLANNED
- Split `lobby.js` and `renderGame.js` along three seams:
  *(a)* RTDB-listener layer, *(b)* render/refs layer, *(c)* event-handler layer.
- Untangle the lobby instruction state machine (4.3) during the split.
- Decide the service-layer question **once**: either reintroduce a thin,
  *used* service module over `paths.js`, or standardize on direct `paths.js`
  calls everywhere. Do not leave both patterns half-present.
- Collapse `boot.js`'s 26-/12-arg dependency bags into small grouped objects.

### Phase 3 — Polish — PLANNED
- Swirl perf (4.5).
- Single CSS strategy / bundling.
- Add lint + format (and minimal tests around session/paths/buzz logic).
- `vite.config.js` hardening + `.env.local.example`.

---

## 6. Change log

| Date | Phase | Change | Commit |
|---|---|---|---|
| 2026-06-13 | 0 | Baseline snapshot before refactor | `9086484` |
| 2026-06-13 | 1 | (recorded on commit) | _pending_ |

> Append a row per commit. Keep the newest at the bottom.
