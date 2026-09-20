# Picture Twirl — Project Audit (2026-09-13)

> Full read of every source file, stylesheet, template, test, config, doc and the
> git history at `f9401bc`. Companion to [REFACTOR.md](REFACTOR.md) (the plan) and
> [CLAUDE.md](CLAUDE.md) (the map). This file is the **findings**: what the app
> actually does today, where it breaks, and what to fix first.

**Tree health at audit time:** `npm run lint` → 0 problems · `npm run build` → OK
(391 kB JS / 24 kB CSS) · `tests/game.spec.js` → **broken** (see T1).

> **Revision 2026-09-20 (`bd1938f`).** Re-checked against the four commits since
> the audit: `faf3fcd` (turn glow moved to status bar + board top), `4aab9e7`
> (game-screen layout: fixed top region, single scroller, GM compact header),
> `0e9020a` (swirl: server-aligned clock, capped working resolution, single rAF
> loop) and `bd1938f` (REFACTOR.md change-log row). Findings keep their IDs;
> resolved or changed ones carry a *Status* line. Line references were re-pointed
> at `bd1938f`. Two findings added from the tester's 09.13 notes (M14, M15).
>
> **Tree health at revision:** lint 0 · build OK (393 kB JS / 25 kB CSS) ·
> `tests/game.spec.js` still broken (T1) · ≈4,200 lines JS, 1,940 CSS.

---

## 1. TL;DR

The architecture is sound and small (≈4,100 lines of JS, 1,800 of CSS, one HTML
file with two `<template>`s). Session/Firebase/view plumbing is clean. The
problems are concentrated in three places:

1. **Exit / reload / presence** — leaving, ending, kicking and reloading all
   funnel through a `location.reload()` that keeps `#CODE` in the URL, so every
   exit lands on the *Join* screen; and `onDisconnect().remove()` deletes a
   player's row (team included) on any blip. This one cluster explains four of
   the tester's "bugs" (H1, H2).
2. **The swirl pipeline** — *at audit:* a resume leaked a second animation loop
   that `cancel()` couldn't stop (H3); one image is 25 MP and blank on iPhones
   (H4); the phone's clock drove the sync (M5). **H3, the canvas half of H4 and
   M5 are fixed in `0e9020a`** — M5 was confirmed in the field first (a tester's
   PC clock was 3 h ahead → picture arrived already revealed). Still open: the
   2 MB asset itself (H4) and every picture stretched to a square (H5).
3. **Layout** — *at audit:* `min-height: 100vh` roots with an inner
   `overflow-y: auto` that never actually scrolled (M11). **Game screen fixed in
   `4aab9e7`**; the lobby root still has the same defect, and the "Join button
   hidden" case with it.

Top fixes in order (revised 2026-09-20): **H1+H2+M3+M15** (exit/session/
presence/host re-identification, one change set) → **H6** (award guards) →
**M9 (button half) + M10** (GM pause state + answer peek) → **H5 + H4 assets**
(aspect + resize) → **M11 (lobby)** → **M14** (coin-flip race) → **T1 + docs**.

| Severity | At audit | 2026-09-20 | What it means |
|---|---|---|---|
| **High** | 6 | 4 open · 1 partial (H4) · 1 fixed (H3) | Breaks or corrupts gameplay for real users |
| **Medium** | 13 | 15: 12 open (incl. new M14, M15) · 2 partial (M9, M11) · 1 fixed (M5) | Wrong under realistic conditions, or a product gap the tester hit |
| **Low** | 17 | 17 open | Cleanup, dead code, drift, hygiene |

---

## 2. Architecture as-built

```
index.html (#app holds home/create/gameReady/join + <template id=tpl-lobby|tpl-game>)
   │
main.js ─► startup/boot.js
             ├─ initializeFirebase() → waitForAuthReady()          firebase.js
             ├─ byId() ×30 → createViewController()               ui/views.js
             ├─ initCreateFlow({services, els})                    flows/createFlow.js
             ├─ initJoinFlow({services, els})                      flows/joinFlow.js
             └─ #HASH in URL → startJoinFlow(code)   (also on hashchange)
                     │
        createGameShell(id, opts)   gameExists(id)
              createGame.js            firebase.js
                     │                    │
                     ▼                    ▼
              renderLobby(gameId)                                  game/lobby.js
                ├─ ensureParticipant / attachPresence / setTeam    game/participants.js
                ├─ mountTemplate('tpl-lobby') → #app.innerHTML = ''   ui/templates.js
                ├─ createInstructionController()                   game/lobbyInstructions.js
                ├─ 6 onValue listeners (title, settings, teams, me, participants, phase)
                └─ phase==='live' → disposeAll() → renderGameUI(gameId)
                                                                   game/renderGame.js (639 lines)
                       ├─ mountTemplate('tpl-game')
                       ├─ 13 onValue listeners (phase, title, teams, scores, participants,
                       │   currentTurn, selectedTile, currentQuestion, swirlStartTime,
                       │   .info/serverTimeOffset, buzzQueue, swirlPaused, board)
                       ├─ createBoard()          game/createBoard.js   (one-shot get of /board)
                       ├─ startSwirlAnimation()  game/swirl.js         (capped-res canvas loop, server-aligned start)
                       ├─ enqueueBuzz/clearBuzzQueue                   game/buzz.js
                       ├─ initializeStartingTurn/advanceTurn           game/turn.js
                       ├─ leaveGame/endGame/exitToHome                 game/controllerKit.js
                       └─ confetti / sound / modal / copyButton        ui/*
```

Key structural facts:

- **`#app` is wiped** when the lobby mounts (`templates.js:10`). The boot-cached
  Home/Create/Join nodes are gone from that moment, which is why *every* exit path
  is `window.location.reload()` (`controllerKit.js:47`). There is no in-app route
  back to Home.
- **Two UI systems exist.** The app renders from `<template>`s + `innerHTML`
  strings. `src/components/*` (Button, Pill, ScoreboardCard, …) is imported by
  **nothing except `gallery.js`**. They will drift (L2).
- **No Firebase rules in the repo.** The code assumes: host-only writes to the game
  root, players may write their own `participants/{uid}` (incl. the new
  `tileRequest`), players may push `buzzQueue/*`, host may null children. None of
  this is reviewable here (L15).
- **Turn flow (changed 2026-09-02, `257db8d`):** players on the active team click a
  tile → write `participants/{uid}/tileRequest` → the **GM client** promotes it to
  `selectedTile` (`renderGame.js:165-178`) → GM presses OK. Docs still describe
  "GM clicks a tile" (D1).

### Module inventory

| File | Lines | Role | Health |
|---|---|---|---|
| `startup/boot.js` | 241 | Firebase gate, DOM cache, flow wiring, hash routing | OK; no session resume (H1) |
| `firebase.js` | 168 | App/RTDB singleton, anon auth, `gameExists` | good |
| `session.js` | 159 | sessionStorage-backed `{gameId,isGM,displayName}` | good; **never read back on boot** |
| `data/paths.js` | 19 | RTDB path builders | missing 5 paths now in use (L3) |
| `flows/createFlow.js` | 329 | 2-step wizard + Ready screen | OK; small issues (L5, L8, L9, L12) |
| `flows/joinFlow.js` | 189 | Join form | OK; wrong element passed (L6) |
| `game/createGame.js` | 231 | Shell + board materialization | 4 non-atomic writes (M8); stale header |
| `game/lobby.js` | 433 | Lobby controller | OK; presence/exit bugs are upstream |
| `game/lobbyInstructions.js` | 103 | Instruction-line state machine | good, DOM-free |
| `game/participants.js` | 63 | ensureParticipant / presence / setTeam | **`onDisconnect().remove()` (H2)** |
| `game/renderGame.js` | 699 | Live game controller | the hot spot: H1, H6, M2, M9, M10, M14 (M5 fixed) |
| `game/createBoard.js` | 155 | Board DOM | fine; stale header |
| `game/swirl.js` | 181 | Canvas swirl | rewritten `0e9020a`: single loop, 720 px working res, trig table (H3 ✅, H4-canvas ✅) |
| `game/turn.js` | 45 | currentTurn init/advance | fine; stale header |
| `game/buzz.js` | 87 | enqueue / clear | fine |
| `game/controllerKit.js` | 103 | disposer, exitToHome, leave/end | `exitToHome` keeps the hash (H1) |
| `ui/*` (8 files) | ~630 | dom, views, templates, modal, copy, format, confetti, sound | good; `crypto.randomUUID` gate (M1) |
| `components/*` (6 files) | 230 | Factory components | unused by app (L2) |
| CSS (10 files) | 1,937 | Tokens + per-screen sheets | game layout fixed `4aab9e7`, lobby pending (M11); dead rules (L1) |
| `tests/*` | 300 | Playwright e2e + screenshots | game spec broken (T1) |

---

## 3. State model

### 3.1 Client-side state

| Where | What | Lifetime |
|---|---|---|
| `session.js` → `sessionStorage['pt.session.v1']` | `{ gameId, isGM, displayName }` | survives reload, **but boot never reads it to resume** |
| `lobby.js` closure | `selectedPid`, `participantsCache`, `teamNames`, `lastCanStart` | until phase → live |
| `renderGame.js` closure | `teams, participants, scores, currentTurn, selectedTile, currentQuestion, swirlStartTime, serverTimeOffset, swirlCtrl, hasBuzz, firstBuzzerName, swirlPausedByGM, compactObserver, prev*` | until reload |
| `swirl.js` closure | `startTime, pausedAt, animationFrame, cancelled, done` + precomputed geometry (`dxs, dys, distIdx`) | per question |
| URL hash | `#CODE` (written by `renderLobby`, `lobby.js:26`) | until `showView('home')` — which never runs after an exit |

### 3.2 RTDB schema — as the code writes it today

```
/gameIndex/{id}: true                       ← never deleted (M3)
/games/{id}/
  hostUid, isPublic:false, createdAt, title, gmName
  settings:      { setId, teamsEnabled:true }      (teamsEnabled is hard-coded true, createFlow.js:73)
  state:         { phase:'lobby'|'live'|'ended', endedAt? }
  teams:         { A:{name}, B:{name} }
  scores:        { A, B }
  participants/{uid}: { displayName, team:'A'|'B'|'none', joinedAt, isGM,
                        online?, lastSeen?,               ← presence
                        tileRequest?: {id,category,value} } ← NEW (player → GM handoff)
  board/{col-row}: { id, col, row, category, imageUrl, answer, value,
                     opened, answered, answeredBy:'teamA'|'teamB', awardedPoints, locked, lastActionAt }
  currentTurn:    { team }                          ← NOT { uid, team } as CLAUDE.md says
  selectedTile:   { id, category, value }
  currentQuestion:{ id, category, imageUrl, answer, value, showAnswer }   ← answer is world-readable (M7)
  swirlStartTime: serverTimestamp
  swirlPaused:    boolean                           ← NEW, missing from CLAUDE.md
  buzzQueue/{pushId}: { uid, createdAt }
```

### 3.3 One round, end to end (who writes what)

| Step | Actor | Write | Listener reaction |
|---|---|---|---|
| Start | GM (lobby) | `state.phase='live'` | both controllers: dispose lobby → `renderGameUI` |
| Coin flip | GM (once) | `currentTurn.team` random | all: card ring, status text, board glow for that team's players |
| Pick | active-team player | `participants/{me}/tileRequest` | **GM client** promotes → `selectedTile` + clears request |
| Pick | GM | `selectedTile` directly | all: `.tile.selected`, OK enabled (GM) |
| OK | GM | `currentQuestion{…answer…}`, `swirlStartTime`, `swirlPaused:false`, `selectedTile:null`; then `board/{id}.opened` | all: viewer shows, `<img>` loads → `startSwirlAnimation(elapsed = Date.now() + serverTimeOffset − swirlStartTime)` |
| Buzz | player | push `buzzQueue` | all: buzzer sound, swirl **pauses** (`hasBuzz`), first buzzer per team badge |
| Pause | GM | `swirlPaused` toggle | all: pause/resume (`applySwirlPause`) |
| Reveal | GM | `currentQuestion.showAnswer=true` | all: cancel swirl, draw clean image, answer text, chime |
| Award | GM | score (get+update), tile answered/answeredBy/awardedPoints, `currentQuestion:null`, swirl fields null; then clear queue; then `advanceTurn(winner)` | all: confetti + sound on score increase, viewer hides, board reflects ✔ |
| Back | GM | `currentQuestion:null`, …; clear queue; `advanceTurn(null)` → other team | |
| End | GM | `state.phase='ended'` | all: `exitToHome` → reload → **Join screen** (H1) |

---

## 4. Findings

Severity: **High** = breaks/corrupts play · **Medium** = wrong under realistic
conditions or a gap the tester hit · **Low** = cleanup. Each has *where*, *why*,
*fix*.

### HIGH

**H1 — Every exit lands on the Join screen (and can loop).**
*Where:* `lobby.js:26` writes `#CODE`; `controllerKit.js:42-49` `exitToHome` reloads
without clearing it; `boot.js:134-140, 221-224` treats any hash as auto-join.
*Why it matters:* End game, Leave game, kick, phase→ended and a plain reload all
present "Join Game" with the code pre-filled instead of Home. Because `endGame`
only sets `phase='ended'` and `/gameIndex/{id}` is never removed (M3),
re-submitting that form passes `gameExists`, mounts the lobby, sees `ended`,
reloads → Join again. This is the tester's *"End game / Leave game don't work"*
and *"Reloading presents the Join Game screen"*.
*Fix:* (a) `exitToHome`: `history.replaceState(null, '', location.pathname)`
before `reload()`; (b) delete the index on end/delete (multi-path update);
(c) on boot, if `getSession().gameId` is set and the game exists, call
`renderLobby(gameId)` (it already hands off to live) instead of the Join form.

**H2 — A disconnect deletes the player (team and all); reconnect leaves a ghost.**
*Where:* `participants.js:52` `onDisconnect(meRef).remove()`; `participants.js:51`
re-`update`s `{online,lastSeen}` on reconnect; `lobby.js:197-203` exits when the
row vanishes; `renderGame.js` has no such guard.
*Why it matters:* Phones drop the socket on screen-lock, app switch, or a Wi-Fi
blip. In the lobby the player is thrown out. In the live game the row is removed
silently: their team is unknown, `isMyTeamsTurn` is false, their buzz shows as
"Player" with no badge; on reconnect the `update` recreates a row with **no
displayName/team** (a "xxxx" pill). Combined with H1, a reload during a game is
unrecoverable.
*Fix:* `onDisconnect(meRef).update({ online:false, lastSeen })` instead of
`remove()`; keep rows; use `online` for display. Rehydrate from session on boot
(H1c). Kicks stay explicit `remove()`.

**H3 — Swirl leaks a second animation loop after pause→resume; `cancel()` can't stop it.**
*Status (2026-09-20):* **fixed in `0e9020a`.** `pause()` cancels the pending frame,
`resume()` is the only re-scheduler, a `cancelled` flag is checked at loop top.
Verified by a stubbed-canvas check (repeated pause/resume keeps exactly one pending
frame; cancel leaves none). Original finding kept for the record (refs at `f9401bc`).
*Where:* `swirl.js:35-39` (paused branch keeps scheduling frames) + `swirl.js:97-101`
(`resume()` schedules another). After one pause/resume two loops run per frame;
`cancel()` (`:103-106`) cancels only the last id.
*Repro:* GM Pause → Resume → Reveal. The revealed picture is overdrawn by the
surviving loop and re-swirls until the 30 s elapse. The stray loop also keeps
painting the *previous* image onto the canvas of the *next* question — the
"old image flashes" report (`8bad866` cleared the canvas, treating the symptom).
Double CPU cost per resume on phones.
*Fix:* in the paused branch don't reschedule (`return` without rAF); `resume()`
is the only scheduler; add a `cancelled` flag checked at loop top; `cancel()`
sets it and `cancelAnimationFrame`.

**H4 — Image assets break the swirl on phones.**
*Status (2026-09-20):* **canvas half fixed in `0e9020a`** — the swirl now samples
from an offscreen canvas capped at 720 px on the long edge (`swirl.js:17-28`),
precomputes per-pixel geometry once per question and looks cos/sin up from a
per-frame table keyed by whole-pixel distance; the reveal path uses the same cap
(`drawUnswirled`). A 25 MP source no longer exceeds iOS canvas limits or costs
seconds per frame. **Still open:** `rihanna.jpg` is still 2.1 MB to *download*
(slow on a remote phone); the thumbnail upscaling/blockiness is unchanged.
Remaining fix = normalise the assets. Original finding (refs at `f9401bc`):
*Where:* `public/images/rihanna.jpg` = **6000×4269 (25.6 MP, 2.1 MB)**;
`friends.jpeg` = 1000×1471; everything else is a 150–300 px thumbnail.
`swirl.js:58-79` runs sqrt/sin/cos **per pixel per frame** at native resolution.
*Why it matters:* 25.6 M iterations/frame is seconds per frame on a phone; iOS
Safari caps canvases at ~16.7 MP, so that tile renders **blank on iPhones**. The
thumbnails are upscaled to 640 px and look blocky (see `screenshots/09-*.png`).
*Fix:* normalise assets (e.g. 640–800 px longest side, < 150 kB); and/or draw
into a fixed working canvas (≤ 512 px) before `getImageData`; precompute the
polar lookup once per question instead of per frame (REFACTOR §4.5).

**H5 — Every picture is stretched to a square.**
*Status (2026-09-20):* still open. The canvas's intrinsic size is now the capped
working size (`swirl.js:61-62`), which keeps the image's aspect — so it is still
stretched into the square wrap.
*Where:* `gameBoard.css:341-366` `.image-wrap{aspect-ratio:1/1}` and
`.twirl-canvas{width:100%;height:100%}` while the canvas's intrinsic aspect is
the image's.
*Evidence:* `Beta/screenshots/Bug - Hard to Discern…png` — *The Office*
(299×168 landscape) rendered as a square, people visibly elongated.
*Fix:* set the wrap's `aspect-ratio` from `naturalWidth/naturalHeight`, or
letterbox into a square canvas (draw centred with computed offsets).

**H6 — Award / Back-to-board can double-fire.**
*Status (2026-09-20):* still open, re-verified.
*Where:* `renderGame.js:628-666`. `awardTeam` does `get(score)` then `update`
(no transaction) and has **no busy guard** (OK has one at `:577`);
`backToBoardBtn` likewise. Buttons stay enabled until the `currentQuestion`
round-trip.
*Why it matters:* a double-tap awards twice (points doubled) and calls
`advanceTurn` twice (turn flips back). Back-to-board twice returns the turn to
the same team.
*Fix:* `dataset.busy` guard + disable the icon bar on first click; use
`increment(points)` or `runTransaction` for the score.

### MEDIUM

**M1 — Confirm dialogs (and copy/share) silently fail over plain HTTP.**
`modal.js:28-29` uses `crypto.randomUUID()`, which exists only in secure
contexts; `navigator.clipboard`/`share` are gated the same way. The Docker path
runs `--host`, so testing from a phone at `http://<lan-ip>:3000` makes every
End/Leave/"Unassigned players" confirm throw inside an async handler — the
button looks dead. `localhost` and the Cloudflare tunnel (HTTPS) are fine.
*Fix:* fallback id (`Math.random().toString(36)`), guard clipboard with the
alert fallback already in `createFlow.js:308-314`.

**M2 — A stale `tileRequest` can auto-select a tile later.** `renderGame.js:172-181`
only promotes when no tile/question is active; otherwise the request stays on the
player's row and is promoted on the *next participants change* while their team
is up — possibly a round later, with nobody clicking. *Fix:* null all
`tileRequest`s in the award/back multi-path update, or stamp requests with the
turn and ignore mismatches.

**M3 — Games are never cleaned up; deleted games leave a live index.**
`endGame` (`controllerKit.js:98-103`) leaves `/games/{id}` and `/gameIndex/{id}`;
Ready-screen "End game" (`createFlow.js:277`) deletes the game but **not** the
index, so the code still "exists" and `renderLobby → ensureParticipant` recreates
a ghost `participants` node under it. No TTL. *Fix:* one multi-path update that
nulls both; consider a `createdAt`-based prune.

**M4 — Game code generation is unchecked.** `boot.js:148`
`Math.random().toString(36).substring(2,8)`: variable length (can be < 6 chars),
no collision check — `createGame.js:196` uses `set()` on `games/{id}`, so a
collision **overwrites a live game**. Stored lowercase, shown/hashed uppercase.
*Fix:* `crypto.getRandomValues`, fixed alphabet, check `gameIndex` first, store
uppercase.

**M5 — Swirl sync trusts the phone's clock.**
*Status (2026-09-20):* **fixed in `0e9020a`**, and confirmed as a real-world bug
first: a tester's PC (dead BIOS battery, clock ~3 h ahead) saw every picture
arrive fully revealed while the local GM saw it swirl. `renderGame.js:222-224`
now tracks `.info/serverTimeOffset` and `:503-504` computes
`elapsed = Date.now() + offset − swirlStartTime`. This was the only place the
app compared a local clock with a server timestamp (all other temporal fields are
server-vs-server). Original: `Date.now() - swirlStartTime` at `renderGame.js:443-444`
(`f9401bc`).

**M6 — Players without a team in a live game.** A late joiner (or an H2 victim)
enters `renderGameUI` with `team:'none'`: can buzz (appears in the queue, on no
card), can't pick, and the GM has no in-game way to assign them. *Fix:* block
join after `live`, or add in-game team assignment.

**M7 — Answers are readable by every client.** `createBoard.js:35` downloads the
whole board (with `answer`) to everyone; `renderGame.js:531` writes `answer`
into the shared `currentQuestion`. Anyone with devtools can read them. Fine for
friends; if it matters, keep answers under a host-only subtree and copy into
`currentQuestion` only on reveal (needs rules — L15).

**M8 — Game creation is four sequential writes** (`createGame.js:196-221`): a
failure mid-way leaves an indexed game with no board or no host row. *Fix:* one
root-level multi-path `update`.

**M9 — Pause state ignores buzz-pauses** (tester items 7 & 18).
*Status (2026-09-20):* **half fixed in `4aab9e7`** — `refreshSwirlLabel`
(`renderGame.js:299-310`) now writes "Buzzed in — Sam" / "Paused" / "Revealing…"
on the bar (tester item 7 done). The **button** is still wrong: `updatePauseButton`
(`:291-296`) reflects only `swirlPausedByGM`, so it reads "Pause" while a buzz has
the swirl paused (item 18). *Fix:* derive `isPaused = hasBuzz || swirlPausedByGM`
for the button/icon too.

**M10 — The GM can't see the answer before revealing** (tester item 9). The
answer is already on the GM's client (`currentQuestion.answer`) but only
rendered when `showAnswer`. *Fix:* a GM-only peek under `.is-gm` (the CSS hook
exists at `renderGame.js:45`).

**M11 — Layout: nothing scrolls the way the CSS intends.**
*Status (2026-09-20):* **game screen fixed in `4aab9e7`** exactly as prescribed:
`.game-root` is `height:100dvh; overflow:hidden` (`gameBoard.css:6-12`) so
`.game-main` is the single scroller; header + scoreboard + status moved into a
fixed `.game-top` region outside the scroller (`index.html` tpl-game,
`gameBoard.css:27-106`), with a GM-only compact collapse driven by an
IntersectionObserver on a sentinel (`renderGame.js:450-463`). **Lobby still open:**
`.lobby-root` is still `min-height:100vh` (`lobby.css:8`) with an inner
`overflow-y:auto` (`:143`) and the `--tray-h` padding dance (`:7,141`) — the
"Join button hidden" screenshot case is a lobby case and is unchanged.
*Original:* `.game-root` / `.lobby-root` used `min-height:100vh` with an inner
`overflow-y:auto` main. Unconstrained height ⇒ the inner scroller never scrolls;
the *page* scrolls under a sticky header and a sticky tray. Results: header covers
the top of the image, the tray covers the second team card
(`Beta/screenshots/Bug - Join Button hidden.png`), status/scoreboard scroll away
during a question, and "sometimes it scrolls, sometimes not". *Fix (lobby):* the
same `height:100dvh; overflow:hidden` on `.lobby-root`.

**M12 — No end-of-game screen.** `phase='ended'` reloads everyone to Join (H1);
there is no winner/final-scores moment.

**M13 — Single-player / no-teams mode is half-scaffolded.** `teamsEnabled`
exists in settings and `lobby.js` branches on it, but `createFlow.js:73`
hard-codes `true` and the game screen assumes A/B everywhere. Either finish it
or remove the flag (tester question "single player option?").

**M14 — (new 2026-09-20) Coin flip is not shown to players who mount after the
GM's `currentTurn` write** (Notes.txt L84).
*Where:* `renderGame.js:185-198` treats the first `currentTurn` snapshot after
mount as "existing state — no animation" and only shows the flip on a later
null→value transition. `initializeStartingTurn` (`turn.js:18-26`) runs on the
**GM** client after *its* game screen mounts, so the GM always sees null→value.
A player's client first has to see `phase='live'`, dispose the lobby, mount
`tpl-game` and attach listeners; if the GM's write lands before that, the
player's first snapshot already holds `{team}` and the flip is skipped.
*Why it matters:* players miss the "who starts" moment; only the status text
changes.
*Fix:* make the flip data-driven, not transition-driven: write
`currentTurn: { team, startedAt: serverTimestamp(), reason: 'coinflip' }` in
`initializeStartingTurn`; show the overlay whenever a snapshot carries
`reason:'coinflip'` and `serverNow − startedAt` is under ~8 s (the
`.info/serverTimeOffset` value is already tracked at `renderGame.js:222`).
`advanceTurn` writes without `reason`.

**M15 — (new 2026-09-20) A GM who loses their session rejoins as a plain
player** (Notes.txt L86).
*Where:* `isGM` comes only from `getSession()` (`lobby.js:29`,
`renderGame.js:37`); `joinFlow.js:174` always seeds `isGM:false`; nothing
compares `auth.currentUser.uid` with `/games/{id}/hostUid` (written at
`createGame.js:183`, never read by the client).
*Why it matters:* the GM closes the tab (sessionStorage is per-tab) or hits H1
and comes back through Join — the game now has no GM: nobody can post
questions, award points or end it.
*Fix:* in `renderLobby` (or the H1c resume path) read `hostUid` once and set
`isGM = uid === hostUid` into the session before rendering. Anonymous auth is
persisted per browser profile, so the uid survives tab close and reload; it does
**not** survive clearing site data or switching browsers — covering that needs a
`hostKey` stored with the game and in `localStorage`. Belongs to the H1 cluster.

### LOW

- **L1 Dead CSS:** `main.css:483-517` (`.viewer`, `#twirlImage`, `#twirlCanvas`
  — the template uses `.question-viewer`, `.twirl-image`, `.twirl-canvas`);
  `.lobby-title`, `.card-lg`, `.heading-md`, `.with-tray-padding`.
- **L2 Unused component library:** `src/components/*` only feeds
  `gallery.html`. Either migrate `renderList`/`renderSetCards`/coin-flip to it or
  label it "design reference". Two definitions of Pill/SetCard/ScoreboardCard
  will drift.
- **L3 `paths.js` gaps:** `currentTurn`, `selectedTile`, `swirlStartTime`,
  `tileRequest`, `swirlPaused` are built inline (`renderGame.js:177-178,185,200,
  215,644-645`, `turn.js:19,36`); `createGame.js:196,197,208` use raw `games/…`
  strings. (Correction 2026-09-20: `hostUid` was listed here in error — it is only
  written, in `createGame.js`; see M15 for the fact that nobody reads it.)
- **L4 Stale file headers:** `renderGame.js:1-13` ("GM clicks a tile"),
  `turn.js:5-6` ("GM picks on behalf"), `createBoard.js:8-11`,
  `createGame.js:21,27` (`/buzzing`), `buzz.js:7` ("delete a single buzz").
- **L5** Step-2 "Exit" link has no id/handler (`index.html:101`) — does nothing.
- **L6** `boot.js:61` passes the `#joinForm` *div* as `els.joinForm`; the real
  form is `#joinFormInner`, so `.reset()` is a no-op and Cancel doesn't clear
  fields (`joinFlow.js:120,142`).
- **L7** `inputmode="latin-prose"` is not a valid value (`index.html:147`).
- **L8** `startCreateFlow` sets `{gameId, isGM:true}` in the session before
  anything exists (`createFlow.js:322`); exiting the wizard leaves a stale GM
  session (matters once H1c resumes from session).
- **L9** `renderSetCards` interpolates set titles into HTML unescaped
  (`createFlow.js:113-126`); safe only because content is static. `SetCard`
  does this safely.
- **L10** `refs.twirlImage.src = ''` (`renderGame.js:476`) → prefer
  `removeAttribute('src')`.
- **L11** Global `document.querySelector*('.tile…')` (`renderGame.js:414,416,686`)
  — scope to `root`.
- **L12** Duplicate Enter handling on Step 1 (`createFlow.js:160-173`): both a
  `submit` and a `keydown` handler.
- **L13** "Local aliases to avoid bundler/scope quirks" (`joinFlow.js:61-68`) is
  a no-op seven-line duplication.
- **L14** Editor crash artifacts in the working tree: `CLAUDE.md.tmp.*` ×2,
  `REFACTOR.md.tmp.*`, `index.html.tmp.*`, `.claude/settings.local.json.tmp.*` ×4.
  Ignored by git but clutter — delete.
- **L15 Firebase rules are not in the repo.** Add `firebase.json` +
  `database.rules.json` so the write model (host root, player row incl.
  `tileRequest`, buzz push, host nulls) is versioned and reviewable. The
  `buzz.js` header documents rule assumptions nobody can check.
- **L16** Repo weight: `Beta/screenshots/*` (≈19 MB PNG) and
  `ChatGPT Image Apr 25, 2026… 2.png` (590 kB, purpose unclear) are committed.
  Consider Git LFS or keeping design captures out of the repo.
- **L17** `enqueueBuzz` de-dupes by read-then-push (`buzz.js:52-57`) — a fast
  double-tap can enqueue twice before the UI disables the button.

### Tests / tooling

**T1 — `tests/game.spec.js` is broken** since the icon toolbar (`2881568`,
2026-08-16; re-verified unchanged at `bd1938f`): lines 45-47 expect `'▶ Resume Swirl'` / `'⏸ Pause Swirl'`; the
button now says "Pause"/"Resume" in `.gm-icon-btn__label`. The last local run
(`test-results/.last-run.json`, 2026-08-16) failed there; screenshots 11–13 are
from June. Also note the suite creates real games in the production Firebase
project and depends on `.env.local`.

**T2** No unit tests; `lobbyInstructions.js` was verified by a throw-away script
(REFACTOR 2.2) that isn't in the repo. The DOM-free modules
(`lobbyInstructions`, `session`, `paths`, `turn`, a pure swirl mapper) are cheap
to unit-test with `node --test`.

**T3** `gallery.html` is not part of `vite build` (single-input config) — fine,
but document that it's dev-only.

---

## 5. Tester notes (Notes.txt) → root causes

| Notes.txt item | Status | Cause / pointer |
|---|---|---|
| Progress bar says "Revealing" while paused (L7) | **fixed** `4aab9e7` | M9 (label half) — `refreshSwirlLabel` |
| GM doesn't see the answer (L9) | confirmed | M10 |
| Award A/B should show team names (L10) | **fixed** `9f0953a` | `renderGame.js:138-143` |
| Duplicate category/value (L11) | **fixed** `d7a857b` | `renderGame.js:391` hides status during a question |
| Buzz list needs team + order (L15-16) | partial | queue shows names only (`:222-229`); first buzzer per team on cards |
| Pause shows "Pause" while buzz-paused (L18) | confirmed | M9 (button half still open) |
| Reveal → then award; "no team" option (L22-23) | design | `backToBoardBtn` is the de-facto "no team"; award before reveal is allowed |
| Grey line under GM actions (L25) | confirmed | `index.html:396` `<hr>` stays when both links below are hidden |
| After award still shows Award A/B (L28) | not reproducible in current code | award nulls `currentQuestion` → board (`:583`); likely stale |
| Buzzer shown in team card (L42) | **fixed** `c5eaaba` | `updateBuzzDisplay` |
| Team can pick category (L44) | **fixed** `257db8d` | `tileRequest` handoff; see M2 |
| Old image flashes on next question (L46) | symptom fixed `8bad866`, tester confirmed 09.13; **cause (H3) fixed** `0e9020a` | leaked loop repainted old frames |
| Duplicate status div (L48) | **fixed** | `d7a857b` |
| Should the GM join a team? (L52) | GM already can (Join Random is moved into the GM row; e2e test does it) | product decision |
| Single-player option (L54) | scaffolded, not wired | M13 |
| No persistent "who am I / my team" label (L58) | confirmed gap | data is local (`getSession().displayName`, `participants[myUid].team`) — easy add to `tpl-game` header |
| Bottom sheet opaque (L60) | design | `.actions-tray` bg `rgba(255,255,255,.92)` + blur |
| Buzz banner in GM window (L62) | gap | hook: buzz listener `:216` |
| "Code copied" text feedback (L64) | partial | `flashCheckmark` swaps icon 1.5 s, no text |
| Award banner (L66) | gap | hook: scores listener `:152` already detects the winner |
| Scrolling unpredictable (L70) | **fixed (game screen)** `4aab9e7`; lobby pending | M11 |
| End game / Leave game don't work (L72) | confirmed | H1 (+ M1 if tested over http://LAN) |
| Reload exits the game (L74) | confirmed | H1 + H2 |
| GM view not responsive, hides status/player (L76) | **partly fixed** `4aab9e7` — scoreboard + status now live in the fixed `.game-top` and collapse to a compact band during a question | M11 ✅ · H5 (square stretch) still open |
| Move notes to GitHub issues? (L80) | recommended | this file's IDs (H1…) can seed them |
| Glow radius too large (L1, 09.11 tweak) | **fixed** `faf3fcd` | glow moved off the whole board onto `.game-status` + the board's top edge (`gameBoard.css:632-689`) |
| Coin flip not shown on joined player (L84, 09.13) | confirmed | **M14** — first-snapshot gating loses the race with the GM's write |
| GM loses session → rejoins as a player (L86, 09.13) | confirmed | **M15** — `isGM` is session-only; `hostUid` never read. Part of the H1 cluster |
| Remote player sees the picture already unswirled (09.20, live test) | **fixed** `0e9020a` | M5 — tester's clock 3 h ahead |

---

## 6. Documentation drift

**D1 CLAUDE.md** (last real sync 2026-06-13):
- File map omits `components/*`, `controllerKit.js`, `participants.js`,
  `turn.js`, `lobbyInstructions.js`, `ui/{confetti,sound,format,copyButton}.js`,
  `gallery.{html,js}`, `styles/tokens.css`, `tests/`, `playwright.config.js`,
  `eslint.config.js`, `docker-compose.yml`.
- Schema: `currentTurn` is `{ team }` not `{ uid, team }`; missing `swirlPaused`,
  `participants/*/tileRequest`, `isGM`, `online`, `lastSeen`.
- Flow: "GM clicks a tile → selectedTile" — active-team players now request
  tiles; GM promotes.
- No mention of lint, tests, share mode, gallery, or the design tokens.

**D2 REFACTOR.md** (last entry 2026-06-14):
- Change-log hashes (`9086484`, `a86d5a1`, `9a88183`, `11c161d`, `8731620`,
  `592da9b`, `20579e7`, `d2f01c8`, `005f65d`) **do not exist** in this history —
  the repo was re-based/re-authored (`.mailmap` added `ef83684`). Real ones:
  `48d899f`, `26466dc`, `50db8e4`, `83fec24`, `749b172`, `aae0c06`, `d8a46f0`,
  `6f844b9`, `f0ee6a6`.
- Stops before 24 later commits (design overhaul, mechanics, tests, gallery,
  share mode, all of September's gameplay work). *2026-09-20:* one new row with a
  real hash (`0e9020a`, via `bd1938f`) and §4.5 marked fixed; the gap above it
  remains.
- §4.6 "No linter/formatter/tests" and §7 "The build can't run on native
  Windows" are stale — both lint and build pass natively today.
- §2 table: `renderGame.js` is 639 lines (was 510); "2.3 step 2 pending" is
  still the right call but the file has grown, not shrunk.

**D3 In-file headers:** see L4. `createGame.js:21` documents a `/buzzing` node
that never existed in this history.

---

## 7. Security / rules posture (for when rules land in the repo)

- Any authed anon user can read `/games/{id}` if they know the code; codes are
  6 chars of `Math.random` (M4) and world-readable via `/gameIndex`.
- Players must be able to write `participants/{self}/{team,online,lastSeen,tileRequest,displayName}`
  but not `joinedAt`/`isGM` after creation, and not other players' rows.
- Players push `buzzQueue/*` (create-only); host nulls children.
- Host-only: everything else under the game root, plus `/gameIndex/{id}`.
- If M7 matters, split `answer` out of `board/*` and `currentQuestion`.
- The tunnel (`npm run share`) exposes the dev server publicly; documented.

---

## 8. Recommended order of work

*(revised 2026-09-20 — done items struck, new ones slotted)*

1. **Exit/session/presence cluster** — H1 (a,b,c), H2, M3, **M15**, L8. One PR;
   fixes five tester bugs at once. Smoke test: leave, end, kick, reload mid-game,
   close and reopen the GM tab, lock the phone for 60 s.
2. ~~**Swirl loop fix** — H3~~ done `0e9020a`. **M9 (button half)** remains — small.
3. **Image pipeline** — ~~cap working canvas~~ done `0e9020a`; **H4 assets**
   (resize `rihanna.jpg`, normalise the thumbnails) and **H5** (aspect) remain.
4. **Award guards** — H6, plus M2 (clear stale requests in the same update).
5. **GM UX** — M10 (answer peek), identity label, grey `<hr>`, buzz/award
   banners (all tester asks, all small).
6. **Layout** — ~~game screen~~ done `4aab9e7`; **M11 lobby** (same one-line root
   rule on `.lobby-root`), re-check `Bug - Join Button hidden.png`.
7. **Coin flip** — M14 (data-driven flip; reuses the serverTimeOffset now in
   `renderGame.js`).
8. **Tests + docs** — T1, then rewrite CLAUDE.md §File Organization/§Data Layer
   and append the missing REFACTOR.md rows with real hashes.
9. **Rules in repo** — L15, then decide M7.
10. **Backlog** — M4, M6, M8, M12, M13, and the L-list as touch-when-near.
    (~~M5~~ done `0e9020a`.)
