# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Picture Twirl is a multiplayer trivia game where players guess images as they gradually "unswirl" from distorted to clear. Built with Vite, vanilla JavaScript, and Firebase Realtime Database. The game features team-based gameplay with a host (GM) who controls game flow and awards points.

## Development Commands

```bash
# Development server (runs on port 3000)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

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

**Firebase Integration (`firebase.js`)**
- Config discovery: `window.__FIREBASE_CONFIG__` (priority) or `import.meta.env.VITE_FIREBASE_*`
- Anonymous auth automatically enforced via `requireAuth()`
- Exports singleton `rtdb` instance after `initializeFirebase()`
- Helper: `gameExists(gameId)` checks `/gameIndex/{gameId}` for join flow

**View Switching (`ui/views.js`)**
- Single source of truth for screen visibility
- Uses native `[hidden]` attribute (no global CSS)
- Emits `app:view-changed` event for observability
- API: `showView('home'|'create'|'join')`

### Game Flow

**Create Flow (`flows/createFlow.js`)**
1. Step 1: Collect GM name, game name, team names
2. Step 2: Select game set from predefined options (renders card UI)
3. On completion:
   - Generates 6-character game code
   - Calls `createGameShell()` to initialize RTDB game node
   - Calls `renderLobby()` to show pre-game lobby
   - Sets session: `{ gameId, isGM: true, displayName }`

**Join Flow (`flows/joinFlow.js`)**
1. Validate game code exists via `gameExists(gameId)`
2. Collect player display name
3. On confirm:
   - Calls `upsertParticipant()` to register player
   - Calls `renderLobby()` to join lobby
   - Sets session: `{ gameId, isGM: false, displayName }`

**Lobby (`game/lobby.js`)**
- Real-time sync of participants and team assignments
- Players can join teams, GM can move/kick players
- GM can start game when teams are ready
- Uses `<template id="tpl-lobby">` from index.html

**Live Game (`game/gameState.js` + `game/renderGame.js`)**
- GM clicks tiles to reveal questions (`postCurrentQuestion()`)
- Image starts swirling via `swirl.js` (Canvas-based animation)
- Players buzz in via `buzz.js` (writes to `/buzzQueue`)
- Buzz pauses swirl animation automatically
- GM reveals answer (cancels swirl) and awards points to team
- Tile state tracked: `opened` (revealed) vs `answered` (finalized with checkmark)

### Data Layer

**Firebase RTDB Structure**
```
/gameIndex/{gameId}: true             # Public existence flag
/games/{gameId}/
  ├─ hostUid, title, gmName, createdAt
  ├─ settings: { setId, teamsEnabled }
  ├─ state: { phase: 'lobby'|'playing' }
  ├─ teams: { A: {name}, B: {name} }
  ├─ scores: { A: number, B: number }
  ├─ participants/{uid}: { displayName, team, joinedAt, online?, lastSeen? }
  ├─ board/{tileId}: { id, col, row, category, imageUrl, answer, value, opened, answered, ... }
  ├─ currentQuestion: { id, category, imageUrl, value, showAnswer }
  ├─ swirlStartTime: serverTimestamp
  └─ buzzQueue/{pushId}: { uid, createdAt }
```

**Game Service (`game/services/gameService.js`)**
- Abstracts RTDB operations: `getTitle()`, `upsertParticipant()`, `postCurrentQuestion()`, `markTileOpened()`, `markTileAnswered()`
- Uses path helpers from `data/paths.js`

**Board Materialization (`game/createGame.js`)**
- Converts predefined game sets into stable RTDB board snapshot
- Supports two input shapes:
  - `{ categories: string[], board: Tile[][] }` (current structure)
  - `{ columns: [{ title, rows: [] }] }` (legacy)
- Output: keyed by `"col-row"` (e.g., `"0-3"`) with content + live-state fields

### Predefined Games (`predefinedGames.js`)

Game sets define content structure:
```javascript
{
  id: 'pop-icons',
  title: 'Pop Culture Icons',
  categories: ['90s Stars', '00s TV', 'Viral Memes', 'Music Legends', 'Animated'],
  board: [
    [ // row 0 ($100)
      { image: '/images/britney.jpeg', answer: 'Britney Spears' },
      { image: '/images/friends.jpeg', answer: 'Friends' },
      // ... 5 tiles total (one per category)
    ],
    // ... rows 1-4 ($200-$500)
  ]
}
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
- Client-side: `gameState.js` writes `{ online: true, lastSeen: serverTimestamp() }` on connect
- Uses `.info/connected` ref and `onDisconnect()` hook
- Safe attach: waits for participant row to exist before updating (satisfies node-level validators)

### Animation System

**Swirl Effect (`game/swirl.js`)**
- Canvas-based progressive reveal over 30s
- Server-aligned elapsed time (uses `swirlStartTime` from RTDB)
- Pauses automatically when buzzQueue is non-empty
- Cancels on answer reveal
- Returns control object: `{ pause(), resume(), cancel() }`

**Buzz Queue (`game/buzz.js`)**
- Players push to `/buzzQueue` with `{ uid, createdAt: serverTimestamp() }`
- Ordered by `createdAt` for FIFO display
- GM clears queue after awarding points

## Firebase Rules Expectations

While rules are not in this repo, the code assumes:
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
src/
├── main.js                    # Entry point
├── config.js                  # App-level constants
├── firebase.js                # Firebase bootstrap + auth
├── session.js                 # Client-side session state
├── predefinedGames.js         # Game content definitions
├── startup/
│   └── boot.js               # App initialization
├── flows/
│   ├── createFlow.js         # Create game wizard
│   └── joinFlow.js           # Join game flow
├── ui/
│   ├── dom.js                # DOM utilities
│   ├── views.js              # View controller
│   ├── templates.js          # Template helpers
│   └── modal.js              # Modal dialogs
├── game/
│   ├── createGame.js         # RTDB game initialization
│   ├── lobby.js              # Pre-game lobby
│   ├── renderGame.js         # Live game rendering
│   ├── gameState.js          # Real-time game listeners
│   ├── board.js              # Board rendering
│   ├── createBoard.js        # Board initialization
│   ├── teams.js              # Team management
│   ├── buzz.js               # Buzz queue logic
│   ├── swirl.js              # Swirl animation
│   └── services/
│       └── gameService.js    # RTDB operations
└── data/
    └── paths.js              # RTDB path helpers
```

## Common Patterns

**Adding a New Predefined Game**
1. Add entry to `predefinedGames.js` with id, title, categories, board
2. Place images in `/public/images/`
3. Board structure: 5 rows x 5 columns (categories), values $100-$500

**Modifying Game State**
- Host-only writes go through `gameService.js` or direct `update()` calls in `gameState.js`
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
