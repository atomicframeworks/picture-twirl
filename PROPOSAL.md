# Picture Twirl: Boards, Admin & Cloudflare (Proposal)

> **Status: v3, approved to start** · 2026-10-03 · prepared with Claude Code from
> a full read of this repo (code, AUDIT.md, REFACTOR.md, Notes, the Content
> Tracker spreadsheet), the sister projects (charitycarwashmap.com,
> kinkyorvanilla.com, ai/carWashCrawler) and current Cloudflare / image-source
> documentation. Decisions are logged in §11:
> - "Board" is the name.
> - Beta comes after the Firebase replacement.
> - Ads are likely, so non-commercial licenses are out.
> - Gray-zone pictures are allowed but flagged with the reason.
> - *Pop Culture Icons* is an internal test board.
> - The spreadsheet is a Google Sheet export.
> - AI runs through your Claude subscriptions.
> - Everything ships as **one documented switch-over** on the `cloudflare`
>   branch (§9).

---

## 0. TL;DR

1. **The top-level thing is a "Board"** (decided). A Board ("Pop Culture Icons
   🎤") has 5 **Categories** (the columns), each with 5 **Tiles** (picture +
   answer + 100–500 points). "Game" stays the live session with a code.
2. **Content moves into a database with an admin.** Boards live in **Cloudflare D1**,
   pictures in **R2**, served from our own domain. Players only ever see a board's
   **published snapshot**. Admins edit a draft that autosaves and push it live
   with *Publish*.
3. **`/admin`** is password-gated. It has a dashboard, a boards table (filters,
   sort, search, bulk publish/archive) and a 5×5 board editor (drag or arrow-key
   reordering of tiles and columns, autosave, emoji picker, drag/drop/paste/URL
   image intake). Every picture records its source and license. It uses the game's
   own light "Playful Party" design tokens, not the dark sister-site admin.
4. **Rights come first.** Ads are likely, so non-commercial licenses are out.
   Every image carries provenance (source page, creator, license, credit line,
   retrieval date, screenshot evidence), and the publish gate enforces the
   policy. The current *Pop Culture Icons* images and parts of the spreadsheet
   (logos, artist photos, cpr.org, official brand assets) **don't meet the "free
   to use" bar** (§7.1, Appendix B).
5. **AI content tools run locally** via `npm run content:sheet` and
   `npm run content:discover`. For the AI steps they call **headless Claude Code
   on your existing subscriptions**, with local Ollama as an optional free
   backend. They use official image APIs plus headless Chrome (Playwright,
   already installed) for license evidence, and talk to the site **only through
   an import API** (the carWashCrawler pattern). Results land as **`import`**
   status for human review.
6. **Everything moves to Cloudflare in one switch-over.**
   - It's built on a `cloudflare` branch in milestones: platform, admin, content
     tools, then **Durable Objects replacing Firebase** behind a Firebase-shaped
     shim.
   - The branch is kept in sync with `main`, then merged once.
   - The merge brings a migration guide written for Lu's Claude, a CLAUDE.md
     banner, a codemod and a lint guard (§9).
7. **Cost:** $0 on free tiers while building. Workers Paid ($5/mo) is recommended
   at beta. AI runs use your subscriptions, not a per-token bill. Firebase's free
   plan (what you're on) caps at **100 simultaneous connections**, about 12
   eight-player games, which is why beta waits for the replacement.
8. **Lu needs no Cloudflare account to develop.** The local runtime needs no
   login. Deploys happen on push via **Workers Builds**, with a preview URL per
   branch or PR. An optional invite gives dashboard and log access (§8.5).

---

## 1. What exists today (and why it matters here)

### 1.1 Where boards live now
- Content is `src/predefinedGames.js`: **one** board (`pop-icons`, 5×5), bundled
  into the JS. Images are in `public/images/` (25 pictures plus the home pattern).
  Most are 150–300 px thumbnails; `rihanna.jpg` is 2.1 MB / 25 MP (AUDIT H4).
- It is read in **three places**: `flows/createFlow.js` (step 2 "Select
  Category" cards), `game/createGame.js` (`buildBoardFromSet`), and
  `game/renderRoundSetup.js` (Play Again, which picks the next round's board).
- The `.set-ic` emoji is `s.icon || '🃏'`. The current set has no icon, so 🃏
  always shows.

### 1.2 The seam we can use
At game start `buildBoardFromSet()` **copies** the chosen board into
`/games/{id}/board` in Firebase. After that the live game never looks at the
content source again. So:
- Swapping `predefinedGames.js` for an API call touches only those three files.
  Gameplay code is untouched.
- Publishing, unpublishing or archiving a board can never disturb a game in
  progress.
- `buildBoardFromSet` already accepts the `{ categories[], board[][] }` shape, so a
  published snapshot can be served in exactly that shape.

### 1.3 Hosting and realtime
- There is no public hosting. Today it runs locally, in Docker, or through a
  quick tunnel (`npm run share`).
- Firebase RTDB + anonymous auth power the live game: **84 `ref(rtdb…)` call
  sites in 14 files**, 33 of them in `renderGame.js` (1,314 lines, under active
  daily development by Lu).
- Firebase **security rules are not in the repo** (AUDIT L15). Answers are
  readable by every client (M7). Award/turn guards are client-side (H6).
- **Firebase Spark (free) limits RTDB to 100 simultaneous connections.**

### 1.4 The Content Tracker spreadsheet
- 5 tabs. *Content LIbrary* and *Content Submissions - Current* hold **170 rows**
  across **28 column-level categories**. *Archive* holds an older 24-row food set.
  *Image Library* and *Category Overview* are empty templates. Their columns
  (license type, attribution, last used, # of images, "average recognition")
  describe what the admin should track, so the admin absorbs them.
- There are **no top-level boards** in the sheet (notes2.txt says the same). The
  importer must group categories into boards.
- Image links: Unsplash photo pages (94 rows), Wikimedia Commons (41: logos
  plus artist *category* pages), cpr.org homepage (5), official brand sites (2:
  Starbucks, Taco Bell), a Google Form (1), none (2), and **25 rows that only
  describe the wanted picture** ("Band portrait"). About **32 music rows have no
  usable picture yet**.
- Quality issues: duplicates (Lemon ×2, cat ×2, witch ×2, turkey ×2, green beans
  ×2, hot dogs / fireworks across categories), likely picture/answer mismatches
  (e.g. *Lemon* → "sliced-orange-fruit", *Garlic* → "red-onion", *pecans* →
  "coffee-beans"), 23 rows without difficulty, and one image link that is a
  Google Form. Full list in Appendix B.

### 1.5 Sister projects: what we reuse, what we don't
Their "family engine" (Cloudflare Pages + Functions + D1 + KV + R2, Vite
multi-page vanilla JS) has proven pieces worth porting:

| Reuse | From | For |
|---|---|---|
| `enhancedList` UX: filters, sort, quick search, page size remembered per list, bulk bar, ⋮ row menu, card/table toggle | charitycarwashmap `src/server/admin/layout.js` (ported from kinkyorvanilla) | Boards table |
| `fetchRemoteImage` (SSRF guards, 10 s timeout, streaming size cap) + `sniffImage` (magic bytes) | charitycarwashmap `src/server/media.js` | "Paste a URL" image import |
| Constant-time secret compare, HttpOnly/SameSite cookie admin, audit log, "never hard-delete, change status" | charitycarwashmap admin + DECISIONS.md | Admin auth, archive semantics |
| `POST /api/import` with a Bearer `IMPORT_TOKEN`, imports land *pending* for human review | charitycarwashmap ↔ carWashCrawler | Content tools → `import` status |
| Crawler manners: dry-run default, `--site local\|prod`, official search APIs only, named bot UA, ≥2 s per host | ai/carWashCrawler | Content tools |

What we **don't** copy:
- **Pages.** Cloudflare now steers new full-stack projects to Workers with static
  assets. Workers also gets Durable Objects, previews and better observability.
- **Server-rendered form-POST admin.** Our editor needs drag-and-drop and
  autosave, so the admin is a small JS app on a JSON API.
- **The dark admin skin.** We use the game's own tokens instead.

### 1.6 Coordination reality
Lu has made ~50 commits since August, mostly in `renderGame.js`, the lobby and
the finale. Everything here is built on a separate branch and lands in one
switch-over (§9), so Lu keeps shipping on `main` undisturbed. The cost is keeping
the branch in sync with `main`, which falls on the migration side, not on Lu. The
realtime milestone touches the files Lu works in most. The Firebase-shaped shim
(§8.4) keeps those edits to import lines, so syncing stays cheap.

---

## 2. Naming (decided 2026-10-03: **Board**)

| Concept | Today (UI / code) | New |
|---|---|---|
| Top-level content unit ("Pop Culture Icons") | "Select **Category**" / `set`, `setId`, `predefinedGames` | **Board** / `board`, `boardId` |
| A column ("90s Stars") | "category" / `categories[]`, `qCategory` | **Category** (unchanged) |
| A cell (picture + answer + points) | tile | **Tile** (unchanged) |
| The live play session with a code | game / `gameId`, *Game Name*, *game code* | **Game** (unchanged) |

**Why not "Game":** the create flow would read *"Game Name → pick a Game"*, and
Play Again would say *"pick a game for the next round"* inside a game. "Board"
matches what players actually see (a Jeopardy-style board). It also already
appears in code as the live copy (`/games/{id}/board`), which really is a copy of
a Board. Admin copy follows: "Boards", "New board", "Publish board".

Rename plan:
- UI text ("Select Category" → "Pick a Board", Play Again copy) and code names
  (`set`/`setId`/`predefinedGames` → `board`/`boardId`/boards API) change on the
  branch.
- Live rooms store `settings.boardId`.
- There is no Firebase data to stay compatible with after the switch-over:
  rooms are ephemeral, and old Firebase games simply stay in the old project.

---

## 3. Target architecture

```
  Players / GM (phones, TV)        Admins (desktop)              Content tools (your Mac)
  index.html (Vite)                /admin (Vite page)            npm run content:*
        │                                │                              │  Bearer IMPORT_TOKEN
        ▼                                ▼                              ▼
 ┌──────────────────── Cloudflare Worker "picture-twirl" ──────────────────────────────┐
 │ static assets (free) · /api/boards (public, published snapshots)                    │
 │ /api/admin/* (session cookie) · /api/import/* (token) · /media/* (R2, immutable)     │
 │ /api/rooms/* + WebSocket ──► Durable Object "GameRoom" (one per game code)           │
 └───────────────┬───────────────────────────┬───────────────────────────┬─────────────┘
                 ▼                           ▼                           ▼
        D1: boards, images,          R2: display + thumb + archival     GameRoom (SQLite DO)
        revisions, audit, runs       + license evidence screenshots      (replaces Firebase RTDB)

  This is the state after the switch-over (§9). On the branch, Firebase keeps
  running the live game until milestone M4 replaces it. Nothing else needs Firebase.
```

Key choices:
- **One Worker** serves the built site and the API. Static asset requests are free
  and don't count against Worker limits.
- **`@cloudflare/vite-plugin`** keeps `npm run dev` as the single command. It runs
  the app, the API and local D1/R2 (and later DO) with no Cloudflare login, and
  should keep `npm run share` working.
- **Same-origin media** (`/media/<hash>.webp`). The swirl reads pixels with
  `getImageData`, which fails on cross-origin images unless CORS is set up
  perfectly. Serving pictures from our own origin avoids that class of bug.
  Content-hash keys mean `Cache-Control: immutable`.
- **Admin is a second Vite entry** (`admin/index.html`) in the same vanilla-JS
  style as the game, plus two small libraries (§5.9). The Worker gates `/admin`
  and `/api/admin/*`.
- **Shared rules module** (`src/shared/boardRules.js`) holds the publish checks
  and limits. It is used by the admin UI and the Worker, so there is one source
  of truth.

---

## 4. Data model

### 4.1 A board (the JSON the editor and the game use)
```jsonc
{
  "title": "Spooky Season", "emoji": "🎃", "description": "Things that go bump",
  "points": [100, 200, 300, 400, 500],          // fixed for now; editable later
  "categories": [                                // exactly 5 to publish
    { "title": "Creepy Critters",
      "tiles": [                                 // exactly 5; index = row = points
        { "answer": "Bat", "imageId": "img_9f2c…", "notes": "" },
        …
      ] },
    …
  ]
}
```
The published snapshot adds the resolved image URLs (`/media/…`), width/height,
and a `credit` string for pictures whose license requires attribution.

### 4.2 D1 schema (sketch)
> The real schema is **`migrations/0001_init.sql`**, which supersedes this sketch:
> `archive_key` instead of `original_key`; `rights_status` = `ok | flagged |
> blocked` plus `rights_flags` codes; `flagged_tiles` on boards.
```sql
CREATE TABLE boards (
  id             TEXT PRIMARY KEY,            -- 'brd_…' random
  slug           TEXT NOT NULL UNIQUE,        -- 'pop-icons' (stable; written into live games)
  title          TEXT NOT NULL,
  title_key      TEXT NOT NULL UNIQUE,        -- lower/trim/collapsed spaces → "no two boards share a name"
  emoji          TEXT NOT NULL DEFAULT '🎲',
  description    TEXT,
  status         TEXT NOT NULL CHECK (status IN ('draft','published','import','archived')),
  source         TEXT NOT NULL DEFAULT 'manual', -- manual | seed | ai-sheet | ai-discover
  import_run_id  TEXT, external_key TEXT UNIQUE,  -- idempotent re-imports
  draft_json     TEXT NOT NULL,               -- §4.1
  rev            INTEGER NOT NULL DEFAULT 1,  -- bumps on every save (autosave conflict check)
  tiles_ready    INTEGER NOT NULL DEFAULT 0,  -- denormalized for the table/dashboard
  rights_flags   INTEGER NOT NULL DEFAULT 0,
  published_json TEXT, published_rev INTEGER, published_at INTEGER,
  created_at INTEGER, updated_at INTEGER, updated_by TEXT, archived_at INTEGER
);
CREATE TABLE board_revisions (board_id TEXT, rev INTEGER, published_json TEXT, at INTEGER, actor TEXT,
  PRIMARY KEY (board_id, rev));              -- one row per publish → instant rollback
CREATE TABLE images (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE,             -- same picture uploaded twice = one row
  display_key TEXT NOT NULL, thumb_key TEXT NOT NULL,
  original_key TEXT,                -- private archival copy (capped at 2560 px), never served to players
  evidence_key TEXT,                -- screenshot of the source/license page at retrieval time
  width INTEGER, height INTEGER, bytes INTEGER,
  provider TEXT,                    -- upload | url | wikimedia | openverse | unsplash | pexels | pixabay | nasa | …
  source_page_url TEXT, source_file_url TEXT,
  creator TEXT, creator_url TEXT,
  license TEXT NOT NULL DEFAULT 'unknown',   -- cc0 | pdm | cc-by-4.0 | cc-by-sa-4.0 | unsplash | pexels | pixabay | permission | unknown …
  license_url TEXT, attribution TEXT,        -- the credit line players see when required
  rights_status TEXT NOT NULL DEFAULT 'unreviewed', -- ok | needs_review | rejected | unreviewed
  flags TEXT,                                -- JSON: ["trademark","identifiable_person","answer_visible"]
  retrieved_at INTEGER, created_at INTEGER, created_by TEXT, notes TEXT
);
CREATE TABLE audit_log   (id INTEGER PRIMARY KEY, at INTEGER, actor TEXT, action TEXT, board_id TEXT, detail TEXT);
CREATE TABLE import_runs (id TEXT PRIMARY KEY, kind TEXT, actor TEXT, started_at INTEGER, finished_at INTEGER, summary_json TEXT);
```
**Why the grid is one JSON column instead of tile rows:** a board is always
edited as one 5×5 unit on one screen. Reordering becomes an array move, a save is
atomic, and nothing needs a join. The document is a few KB. Images *are* their
own table because they're shared, searchable, and carry the legal metadata.

### 4.3 Statuses

| From ↓ / action → | Publish | Move to draft | Archive | Restore |
|---|---|---|---|---|
| **import** (AI-made) | ✓ if it passes the gate | ✓ | ✓ | – |
| **draft** | ✓ if it passes the gate | – | ✓ | – |
| **published** | "Publish changes" (if valid) | ✓ hides it from players | ✓ | – |
| **archived** | – | – | – | ✓ → draft |

- **Publish gate** (shared rules): title + emoji; 5 named categories; 25 tiles
  each with an answer and a picture; no picture whose license is known to
  forbid our use (❌ in §7.1). **⚠️ flagged pictures don't block publishing**
  (decided 2026-10-03). Each one carries the *reason* it needs a second look, and
  the editor, table and dashboard show it. The gate also warns, without
  blocking, on duplicate answers and pictures under 480 px.
- **Archive is the delete.** Nothing is hard-deleted. Archived boards stay visible
  to admins and keep their name, so names stay unique across all statuses. To
  reuse a name, rename the archived board.

### 4.4 Draft vs published
Autosave always writes the **draft**. Players always get the last **published
snapshot**, so a half-edited board can never reach a game. A published board
with newer edits shows **"Unpublished changes"** (`rev > published_rev`) and a
*Publish changes* button. Each publish stores a revision for rollback.

---

## 5. Admin (`/admin`)

### 5.1 Access and security
- **Shared password**, as requested. It is stored only as a Worker secret
  (`ADMIN_PASSWORD`), never in the repo or the JS bundle. Login sets an
  HttpOnly, Secure, SameSite=Strict, HMAC-signed session cookie (default 7 days;
  *Log out* clears it). The password is compared in constant time.
- A **"Who's editing?" name** at login is stored in the cookie. The audit log then
  says *who* published or archived a board, which a shared password otherwise
  can't tell you.
- **Login rate limit** per IP. Mutating requests require a same-origin `Origin`
  header. `/admin` is `noindex`, sends no-store headers, and 404s when the secret
  isn't set (family rule).
- **Later, optional:** Cloudflare Access (Zero Trust, free for small teams) for
  per-person email login in front of `/admin`.
- ⚠️ The password currently sits in plaintext in `prompt-samples/admin-page.txt`
  (untracked). Keep that folder out of git. Consider a longer password before the
  admin goes public.

### 5.2 Look and feel
Reuse `src/styles/tokens.css`: Fredoka headings, Poppins body, the violet→pink
brand gradient, lavender surfaces, rounded cards. Admin-only additions are
pastel **status chips** (🟢 Published mint · ✏️ Draft sunshine · ✨ Import
lavender · 🗄 Archived gray), friendly empty states and emoji tab icons.
Desktop-first. On tablets the editor shows one column at a time and the table
turns into cards, so quick fixes from a phone work.

### 5.3 Dashboard
```
┌ 🎨 Picture Twirl · Admin ─────────────── [Open game ↗]   Signed in as ▾ ┐
│  📊 Dashboard   🧩 Boards   ✨ Imports   📜 Activity                    │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │ 🟢 12     │ │ ✏️ 4      │ │ ✨ 7      │ │ 🗄 3      │   ← click = filter │
│  │ Published│ │ Drafts   │ │ To review│ │ Archived │                    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                    │
│  Needs attention                                                        │
│   ✨ 7 AI imports waiting for review                       → Review      │
│   ⚠️ 11 pictures need a rights check (3 boards)             → Show        │
│   📝 2 published boards have unpublished changes           → Show        │
│   🧩 3 drafts are ≥ 20/25 tiles ready                       → Show        │
│  Recently edited                     Latest import runs                 │
│   🎃 Spooky Season · draft · 2m ago   Sheet import · Oct 3 · 6 boards    │
│   🏷️ Logo Loco · import · 1h ago      Discover "90s toys" · 2 boards     │
│  Totals: 26 boards · 650 tiles · 702 pictures · 412 MB in R2            │
└─────────────────────────────────────────────────────────────────────────┘
```
After cutover (beta polish), the dashboard gains play stats per board: times
played, % answered, and average reveal progress at the correct buzz. The
GameRoom can report these directly. They fill the spreadsheet's "Average
Recognition" idea and help tune difficulty.

### 5.4 Boards table
```
 [All 26] [🟢 Published 12] [✏️ Draft 4] [✨ Import 7] [🗄 Archived 3]   🔍 Search boards…   [+ New board]
 ┌──┬───────────────────────┬─────────────┬───────┬───────────┬────────┬──────────┬───┐
 │☐ │ Board ▲               │ Status      │ Ready │ Source    │ Rights │ Updated  │   │
 ├──┼───────────────────────┼─────────────┼───────┼───────────┼────────┼──────────┼───┤
 │☐ │ 🎤 Pop Culture Icons   │ 🟢 Published │ 25/25 │ Seed      │ ⚠️ 25   │ 3d ago   │ ⋮ │
 │☑ │ 🎃 Spooky Season       │ ✨ Import    │ 25/25 │ AI · sheet│ ✅      │ 1h ago   │ ⋮ │
 │☑ │ 🏷️ Logo Loco           │ ✨ Import    │ 23/25 │ AI · sheet│ ⚠️ 25   │ 1h ago   │ ⋮ │
 └──┴───────────────────────┴─────────────┴───────┴───────────┴────────┴──────────┴───┘
  2 selected  [🟢 Publish] [✏️ Move to draft] [🗄 Archive]              Rows 25 ▾  ‹ 1 2 ›
```
- Status chips work as filters and show live counts. "All" hides archived unless
  you pick that chip. **Quick search** matches the board name. **Sort** works on
  every column. Filters, sort, search and page size live in the URL (shareable)
  and are remembered per browser.
- **Bulk actions:** Publish, Move to draft, Archive, Restore. Bulk publish runs the
  gate per board and reports *"Published 4 · Skipped 2 — Logo Loco: 2 tiles
  missing pictures"*. Archive asks for confirmation.
- Row click opens the editor. The ⋮ menu has Open, Duplicate, Publish/Unpublish,
  Archive/Restore.

### 5.5 New board
A small dialog asks for the **Title** (required, with a live "name already
taken" check), an **Emoji** (picker, default 🎲) and an optional one-line
description. *Create* makes the draft and opens the editor. No untitled drafts
can exist.

### 5.6 Board editor
```
 ← Boards  [🎃] Spooky Season ✎      ✨ Import    ● Saved ✓   Ready 23/25   [▶ Preview] [Publish ▾]
 ┌──────┬─────────────────┬─────────────────┬─────────────────┬─────────────────┬─────────────────┐
 │      │ ⠿ Trick or Treat│ ⠿ Creepy Critters│ ⠿ Haunted Places│ ⠿ Costumes      │ ⠿ Sweet Treats  │
 │      │     ◀  ▶        │     ◀  ▶         │     ◀  ▶        │     ◀  ▶        │     ◀  ▶        │
 ├──────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┼─────────────────┤
 │ 100  │ [pic] Bat   ✅ ⠿ │ [pic] Spider ✅  │ [pic] …         │                 │                 │
 │      │ ▲▼              │ ▲▼              │                 │                 │                 │
 │ 200  │ [pic] Ghost  ⚠️  │ ┌ Drop, click, ┐ │                 │                 │                 │
 │      │                 │ │ paste or URL │ │                 │                 │                 │
 │ 300… │                 │ └──────────────┘ │                 │                 │                 │
 └──────┴─────────────────┴─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```
- **Reorder tiles:** drag a tile within its column, or use ▲▼. Points follow
  the row, so dragging the 500 tile to the 300 slot makes it worth 300 and shifts
  the others down. Dragging a tile **to another column swaps** the two tiles, so
  the board always stays 5×5.
- **Reorder columns:** drag the ⠿ header handle, or use ◀ ▶. The whole column
  moves with its tiles.
- **Pictures:** drop a file, click to browse, **paste** an image (⌘/Ctrl+V), or
  paste a link. For links the Worker downloads the picture with the ported SSRF
  guard and records where it came from. Links to known sources (Commons, Openverse,
  Unsplash, Pexels, Pixabay pages) also auto-fill creator and license.
- **Autosave:** about 0.8 s after the last change. The status pill shows *Saving…
  / Saved ✓ / Offline: retrying / Changed elsewhere: reload*. Saves send `rev`,
  so two people editing the same board can't silently overwrite each other.
  ⌘/Ctrl+Z undoes recent edits.
- **Readiness meter:** the editor shows what still blocks publishing, e.g.
  "Creepy Critters 200: missing picture".
- **▶ Preview** shows the board as players see it, and **Preview twirl** on any
  tile reuses `swirl.js`, so you can judge difficulty.

### 5.7 Tile drawer (click a tile)
```
 ┌ Creepy Critters · 200 ───────────────────────────────────────┐
 │ [ large picture ]                         [▶ Preview twirl]   │
 │ Answer  [Spider                 ]                             │
 │ Picture [Replace ▾ upload · paste · from URL]  [Remove]       │
 │ Rights  ✅ CC0 · Openverse → Flickr · creator: J. Doe          │
 │         Source page ↗ · Original file ↗ · Evidence 🖼 · Oct 3  │
 │         Credit shown in game: — (none required)               │
 │ Flags   ☐ trademark/logo ☐ identifiable person ☐ answer visible│
 │ Notes   [admins only…]                                        │
 └───────────────────────────────────────────────────────────────┘
```
Rights fields are editable for hand uploads: license dropdown, source URL,
creator, and upload evidence (e.g. a permission email PDF). This is also where a
reviewer marks *Rights reviewed ✓*.

### 5.8 Other tabs
- **✨ Imports:** one row per content-tool run (what it did, boards created,
  skipped items, rights flags), each linking to its boards in `import` status.
- **📜 Activity:** the audit log (who did what, when).
- **🖼 Image library (beta polish, after cutover):** every stored picture, searchable by answer, tag
  or license, with "used in" links and reuse in other boards.

### 5.9 Admin tech
Vanilla ES modules in the game's style, with two dependencies:
**SortableJS** (drag and drop, touch support, swap mode) and
**emoji-picker-element** (a small web component; its emoji data is self-hosted).
It uses a hash router (`/admin#/boards/brd_…`), so only `/admin` is a server
route. A client-side `dataTable.js` reimplements the family `enhancedList`
behaviors.

---

## 6. How the game reads boards (minimal gameplay change)

1. Create step 2 and Play Again call `GET /api/boards`, the published list
   (title, emoji, description). This replaces the `predefinedGames` import.
2. On selection, `GET /api/boards/:id` returns the snapshot in the
   `{categories, board}` shape. `buildBoardFromSet()` copies it into the live
   room's `board` **exactly as today**: into Firebase until M4, into the
   GameRoom after. We also write `settings.boardId` and the board's revision so
   a game always knows which version it played.
3. `imageUrl` becomes `/media/<hash>.webp`: same origin, 1280 px, typically
   ~100–250 KB. That's sharper than today's thumbnails and ~10× smaller than
   `rihanna.jpg`, which fixes AUDIT H4 for good.
4. **Credits:** when a picture's license requires attribution, its `credit`
   travels with the tile. The reveal shows a one-line credit (small text), and a
   `/credits` page lists everything. This is the only visible game-screen change,
   and the reveal UI is Lu's area, so we'd design it together.
5. `predefinedGames.js` and `public/images/*` become a **seed** for local and
   production D1/R2, then get deleted. `npm run dev` seeds local D1 automatically,
   so a fresh clone works offline.

With 20+ boards, step 2 may later want search or sections ("New", "Featured").
That's out of scope here and noted in §11.

---

## 7. Getting content

### 7.1 Rights policy (enforced by the tools and the publish gate)
The swirl **modifies** the picture, so licenses that forbid changes don't work.
Ads are likely (decided 2026-10-03), which counts as commercial use, so
**non-commercial (NC) licenses are out**. **⚠️ rows are allowed but flagged**
(decided 2026-10-03). Each flag stores a plain-language reason, e.g. "Logo:
trademark; fine for trivia, double-check before ads"; "Identifiable person:
publicity rights; don't imply endorsement"; "CC BY-SA: credit + share-alike
notice required"; "Rights unknown: verify or replace before public beta". The
admin shows the reason on the tile and counts flags on the dashboard. Only ❌
blocks publishing.

| License / situation | Decision | What we must do |
|---|---|---|
| CC0 · Public Domain Mark · US-gov (e.g. NASA) · Smithsonian/Met Open Access (CC0) | ✅ OK | Record source; credit appreciated |
| Unsplash License (free photos) · Pexels License · Pixabay Content License | ✅ OK | Record creator; a courtesy credit (not legally required; Pexels' API asks for one) |
| CC BY 2.0–4.0 | ✅ OK with credit | Show "Title/Creator · CC BY x.0 · source" (TASL) on reveal + credits page |
| CC BY-SA | ⚠️ Allowed, flagged | Credit + share-alike notice; our swirled version shares the license |
| Logos / trademarks (even "PD-textlogo" on Commons) | ⚠️ Allowed, flagged | Trademark law still applies; double-check before ads |
| Identifiable people (celebrities, musicians) | ⚠️ Allowed, flagged | Copyright may be fine (CC BY) but publicity rights apply; never imply endorsement |
| Rights unknown (e.g. the *Pop Culture Icons* test board) | ⚠️ Allowed, flagged | Verify or replace before public beta |
| Written permission (e.g. an artist or station) | ✅ OK with evidence | Upload the permission (email/PDF) as evidence |
| CC BY-NC / NC-SA | ❌ (ads = commercial) | — |
| CC BY-ND / any "no derivatives" | ❌ | The swirl is a derivative |
| Unsplash+ (premium), press kits / "media library" assets, album art, TV/film stills, cartoon characters | ❌ for new content | Replace |

> Not legal advice. A short consult before a commercial launch is worth it,
> especially for logos and celebrity boards.

**What this means for current content:** *Pop Culture Icons* is an **internal
test board** (decided 2026-10-03). It's seeded **published, with all 25 pictures
flagged "Rights unknown: test content"**, so the game keeps working while we
build. You update or retire it later from the admin. If it's ever rebuilt for
real, celebrity and place categories can come from Commons photos. Cartoon
characters, TV stills and meme photos can't be sourced freely.

### 7.2 Image sources the tools use

| Source | How | Key? | Store a copy? | Notes |
|---|---|---|---|---|
| **Wikimedia Commons** | MediaWiki API (`imageinfo` + `extmetadata`) | No | ✅ | Best for named people/places/logos; per-file license + "trademarked"/"personality" restriction tags |
| **Openverse** | `api.openverse.org` with `license_type=commercial,modification` | No (rate-limited; free registration for more) | ✅ | Aggregates Flickr CC etc.; returns license + ready attribution; verify at source page |
| **Pixabay** | API | Free key | ✅ **required** ("download to your server") | 100 req/min, cache 24 h; no brands/recognizable people for commercial use |
| **Pexels** | API | Free key | ✅ | 200/h, 20k/mo; credit photographer + link Pexels |
| **NASA / Smithsonian / Met** | Their open-access APIs | Mostly no | ✅ | Space, history, art boards |
| **Unsplash** | **No API.** Only human-picked links (spreadsheet, admin paste); the tool downloads them like a person would | — | ✅ | API terms require hotlinking, so we don't use the API; skip Unsplash+; record photographer |

**Search for ideas** goes through official channels only: the AI model's built-in
web search, or a search API like Brave (the crawler already has a key). We
**don't** drive Google in headless Chrome, which breaks its terms and hits
CAPTCHAs. That matches the crawler rule "official search APIs only". **Headless
Chrome (Playwright) is used where it actually helps:** visiting each picture's
source page to confirm the license (e.g. that an Unsplash photo isn't Unsplash+),
pulling metadata from pages without an API, and saving a **screenshot of the
license as evidence** at retrieval time.

### 7.3 The pipeline
Both commands share the same back half. Each stage writes to
`content/runs/<timestamp>/`, so a rerun resumes and never pays twice:

1. **Ingest:** read the spreadsheet (or, for discover, a theme prompt) into
   normalized items: category, answer, difficulty, source link, notes,
   "Subcategory:" hints.
2. **Plan (AI):** group categories into boards of 5 with fun names and an emoji,
   pick 5 tiles per category with a 100→500 difficulty ramp (keeping sheet
   difficulty where given), dedupe, and list gaps. Output is **`plan.json` plus a
   readable `plan.md`**. This is a checkpoint you can edit before continuing.
3. **Find pictures:** use the sheet link when present. Otherwise query the
   sources in §7.2 for 3–5 candidates.
4. **Check rights:** normalize the license, apply the §7.1 policy, open the
   source page in headless Chrome, and save `evidence.png`.
5. **Check the picture (AI vision):** "Does it clearly show *X*? Is the answer
   written in it? Family-friendly? How recognizable (1–5)?" Then pick the best
   candidate and adjust row order to match difficulty.
6. **Prepare:** download, rasterize SVG, and make a 1280 px WebP for display, a
   320 px thumbnail and a private 2560 px archival copy (`sharp`). Hash
   everything.
7. **Submit (`--live` only):** `POST /api/import/images` then
   `POST /api/import/boards` with status **`import`**. Submits are idempotent
   (`external_key`), so reruns update instead of duplicating.
8. **Report:** `report.md` in the run folder plus an *Imports* row in the admin.

Defaults follow the crawler's habits: **dry run unless `--live`**,
`--site local|prod`, a named bot user-agent, ≥2 s between requests to one host,
and 403/429 treated as "no".

### 7.4 Commands
```bash
npm run content:sheet                                  # dry run: plan + pictures + report, submits nothing
npm run content:sheet -- --live --site local           # → your local dev admin (Imports)
npm run content:sheet -- --live --site prod            # → production admin, status "import"
npm run content:discover -- --theme "90s toys" --boards 2      # AI ideation → same pipeline
npm run content:discover -- --auto --boards 3                  # AI picks themes not already covered
npm run content:verify -- --board brd_123              # re-check links + licenses of an existing board
```
The tools need only `IMPORT_TOKEN` (site) in `.env.local`, plus a logged-in
`claude` CLI (your subscription). Pixabay/Pexels keys are optional extras.
**No Cloudflare credentials are needed.**

### 7.5 What the spreadsheet likely becomes (the AI planner decides; example)
| Board | Categories | Rights |
|---|---|---|
| 🍕 Snack Attack | Junk Food · Breakfast · Baked Goods · Cakes & Pies · Fruit | ✅ (Unsplash) |
| 🥣 Second Helpings | Soups & Stews · Nuts · Vegetables · Fruit (part 2) · *1 AI-filled* | ✅ |
| 🎉 Holiday Hoopla | Halloween · Thanksgiving · Christmas · New Years · 4th of July | ✅ |
| 🎃 Spooky Season | Halloween overflow (17 items → 3 categories) · *2 AI-filled* | ✅ |
| 🏷️ Logo Loco | Food & Drink · Retail · Tech & Apps · Auto · Entertainment logos | ⚠️ trademarks; replace 2 brand-site files |
| 🎧 Indie Ear / 🎸 Deep Cuts | the 10 music categories | ⚠️ people; ~32 need pictures; Colorado artists likely need permission |

### 7.6 AI backend (decided: your Claude subscriptions; Ollama optional)
One small adapter (`tools/content/lib/ai.mjs`) gives the pipeline three
interchangeable backends. Prompts and JSON schemas are shared, so picks look the
same whichever one runs.

| `CONTENT_AI=` | How | Cost | Notes |
|---|---|---|---|
| **`claude-code`** (default) | Spawns headless Claude Code per step: `claude -p … --output-format json --json-schema <schema>`, limited with `--tools` to just what the step needs (`Read` to look at a downloaded picture; `WebSearch`/`WebFetch` for discovery), `--no-session-persistence` | Your existing subscription; no API bill | Uses the runner's normal Claude login. Big runs can hit subscription limits; the pipeline checkpoints and resumes. Verified flags on Claude Code 2.1.288 |
| `ollama` (nice-to-have) | Local model via Ollama's HTTP API, like carWashCrawler | Free, offline | Good for planning text; weaker picture checks, so it marks low-confidence picks for review |
| `api` (optional later) | Anthropic SDK with an API key | ~$1–3 per board | Only if you ever want unattended or batch runs without a subscription |

There's also a small Claude Code **project skill** (`.claude/skills/content/`).
Either of you can say "import the spreadsheet" in Claude Code and it runs the
same npm commands, then walks you through `plan.md` before anything is
submitted.
- Unsplash's API terms ask for permission before their content is used for AI/ML.
  We don't use their API, but to stay clearly on the right side we'll skip the AI
  vision check for Unsplash pictures (a human reviews them anyway) unless you
  decide otherwise.

### 7.7 Where things live
```
content/
  sources/Picture Twirl Content Tracker.xlsx   ← an export of the team's Google Sheet; moved from the repo root, committed
                                                (re-export + re-run any time: the sheet's "Item ID" column is the stable
                                                 import key, so re-runs update boards instead of duplicating them)
  runs/                                        ← gitignored work folders (downloads, evidence, reports)
tools/content/                                 ← the local pipeline (Node, ESM)
  cli.mjs sheet.mjs discover.mjs verify.mjs
  sources/{wikimedia,openverse,pixabay,pexels,unsplash,nasa}.mjs
  lib/{ai,browser,images,rights,plan,api}.mjs
```

---

## 8. Moving to Cloudflare

### 8.1 Services and free-tier fit (checked against current docs, Oct 2026)

| Need | Service | Free tier | Our expected use |
|---|---|---|---|
| Site + API | Workers + static assets | 100k Worker requests/day, **10 ms CPU** per request; static assets free | Tiny. Pictures go through the Worker (~25/player/game, browser-cached) |
| Content DB | D1 | 5M rows read / 100k written per day (**enforced since 2026-09-01**), 500 MB/db | Tiny; the board list is edge-cached |
| Pictures + evidence | R2 | 10 GB-month, 1M writes, 10M reads/month, **free egress** | ~1–2 MB per tile incl. the archival copy → hundreds of boards |
| Realtime (M4) | Durable Objects (SQLite) | 100k requests/day; incoming WebSocket messages billed 20:1, outgoing free | Thousands of games/day |

- **Workers Paid ($5/mo) at beta:** it removes the daily request cap and the 10 ms
  CPU ceiling, which matters for large uploads and future server work. Free is
  fine while building.
- Resizing runs in the browser (admin) and in Node (tools), not in the Worker.
  The car-wash site learned that image work blows the free CPU limit, and this
  way we avoid paying for Cloudflare Images.

### 8.2 Environments
- **Local:** `npm run dev`, with local D1/R2/DO simulated by the Vite plugin.
  Seeded automatically. No login.
- **Previews (from cutover on):** every branch or PR gets a URL via Workers Builds. Durable Objects
  are isolated per preview automatically, but **D1/R2 are shared unless we bind
  previews to a separate staging DB and bucket**, which we will, so previews
  never touch production content.
- **Production:** custom domain (TBD), `account_id` pinned in `wrangler.jsonc`.

### 8.3 Secrets
| Secret | Where | Notes |
|---|---|---|
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Worker secrets; local `.dev.vars` (gitignored, with `.dev.vars.example`) | |
| `IMPORT_TOKEN` | Worker secret + your `.env.local` | Lets content tools submit to `import` only |
| `CONTENT_AI` (+ Ollama URL or API key only if those backends are used), `PIXABAY_KEY`, `PEXELS_KEY` | `.env.local` on the machine running tools | Never in the Worker; the default backend uses your `claude` login |
| Firebase config | `.env.local` on the branch until M4, then deleted | Public by design; gone after the switch-over |

### 8.4 Realtime: Firebase → Durable Objects (milestone M4; owner: you)
**Why bother:**
- Firebase Spark's **100-connection cap** (or a Blaze bill on a second vendor).
- Rules that live only in the Firebase console.
- Answers visible in devtools (M7).
- Client-side award guards (H6).
- The GM losing host status after a tab close (M15).
- Unchecked game codes (M4).
- Games never cleaned up (M3).

A Durable Object is one tiny authoritative server per game, which addresses all
of these.

**It stays a realtime game, and gets more accurate** (requirement, 2026-10-03):
- **Push, never poll.** Every player keeps one WebSocket open to the game's
  GameRoom. A change is applied once by the room and broadcast to every socket
  in the same instant, which is the same "everyone sees it live" behavior as
  Firebase today.
- **Fast:** a GameRoom lives in one Cloudflare location near where the game was
  created (the GM). A party in one place therefore talks to a nearby server;
  same-region round trips are typically tens of milliseconds. The room
  hibernates between messages, so idle games cost nothing.
- **Fair buzzing:** the room decides buzz order by when *it* receives each buzz,
  with one authoritative clock. Today two clients can race their own writes into
  Firebase.
- **Synced swirl:** each client measures its offset to the room's clock (ping on
  connect and periodically), replacing `.info/serverTimeOffset`, so every screen
  shows the same reveal progress.
- **Resilient:** sockets reconnect automatically and resume from the room's
  current state. Disconnects show as "offline" instead of deleting the player.
- **M4 acceptance:**
  - Two-device and five-device play-throughs.
  - Buzz order matches arrival order.
  - Swirl progress agrees across screens.
  - Kill Wi-Fi mid-question → the player rejoins seamlessly.
  - Measured message round-trip times are logged in the M4 notes.

**How, with minimal churn:**
1. **Firebase-shaped shim** `src/realtime/db.js`. It exports the subset this code
   uses: `ref`, `onValue`, `get`, `set`, `update`, `remove`, `push`,
   `serverTimestamp`, `onDisconnect(…).update/remove/cancel`, plus
   `.info/connected` and `.info/serverTimeOffset`. Game files change their
   *import line*, not their logic. That keeps syncing `main` into the branch
   cheap and makes Lu's merge mostly mechanical (§9.3). While building, a dev
   flag can still point the shim at Firebase, so behavior can be compared side
   by side.
2. **`GameRoom` Durable Object** (one per code, SQLite, WebSocket Hibernation).
   It holds the room's JSON tree, applies multi-path updates, resolves
   `serverTimestamp` with its own clock, runs a client's registered
   `onDisconnect` ops when its socket closes, and broadcasts changes. An alarm
   deletes idle rooms after ~24 h.
3. **Rules in code:** the host can write anything. Players write only their own
   participant fields, push buzzes, and send the few player actions (late join,
   rematch votes).
   - Today's Firebase rules were exported on 2026-10-03 to
     `worker/rooms/firebase-rules.legacy.jsonc`, so nothing is lost.
   - The port tightens what they leave open: reads are scoped to room members
     (not any signed-in user), players can no longer set fields like `isGM` on
     their own row, and answers stay hidden until reveal.
4. **Identity:** a Worker-issued signed anonymous player token in localStorage
   replaces Firebase anonymous auth. The host keeps host status after a tab
   close (fixes M15).
5. **Then tighten:** answers are sent to non-hosts only on reveal (M7), awards
   become one server action (H6), and game codes are allocated collision-free (M4).
6. **Ship Cloudflare-only.** Once e2e (two browser contexts: GM + player) and
   manual multi-device play match the Firebase behavior, the Firebase adapter,
   `src/firebase.js`, the `firebase` package and its env vars are deleted
   **before** the merge. Lu gets one system, not two.

**Effort:** the largest milestone. Because it lives on the branch, it never
interrupts Lu's work. The only shared touchpoint is the import lines, handled
by the codemod (§9.3).

### 8.5 Deploys and team access (your question about Lu)
**Short answer: Lu needs nothing from Cloudflare to keep coding, and doesn't
deploy with wrangler.**
- **Local development needs no Cloudflare account or login.** `npm install`,
  copy `.dev.vars.example`, then `npm run dev`; local D1/R2/Durable Objects are
  simulated.
  - The local Workers runtime runs natively on macOS 13.5+, Windows 11 and
    glibc Linux. Our machines: your Mac (macOS 26, Apple silicon) and Windows,
    plus Lu's Windows. All native, so **Docker is just an optional fallback**
    (decided 2026-10-03). It was only ever a containerized `npm run dev` (not
    Ollama). It stays, moved from `node:24-alpine` to Debian-based
    `node:24-bookworm-slim`, because the runtime doesn't support Alpine. That's
    handy for a Windows 10 machine, which the runtime doesn't officially support.
- **Workers Builds** (Cloudflare's GitHub integration): a push to `main` deploys
  production, and every branch or PR gets a preview URL commented on the PR.
  Neither of you runs `wrangler deploy` day to day.
- **Optional seat on the new account for Lu.** Lu signs up for a free Cloudflare
  login, and you send the per-Worker **Invite** with **Editor** access (update
  and deploy, can't delete; only a Super Administrator can send it). That's only
  for seeing logs, previews and D1 data in the dashboard.
- **`wrangler login` with Lu's own Cloudflare user** is needed only for
  occasional remote commands (`d1 execute --remote`, `tail`, `secret put`).
  Local dev needs no login at all.
- **No shared personal keys.** Don't use your personal token
  (`~/.cloudflare-token`, the sister sites' `secrets.local.txt`) here. If
  something ever needs a token (DNS automation, CI outside Cloudflare), create a
  narrowly scoped one in the new account.
- **Pin `account_id`** in `wrangler.jsonc`. Your login sees several accounts, and
  this prevents a deploy to the wrong one.

---

## 9. Delivery: one switch-over

Decided 2026-10-03:
- You own the Cloudflare account and the Firebase replacement.
- Lu keeps shipping gameplay on `main`.
- Everything lands in **one merge**, documented well enough that Lu's Claude
  can handle the rest.

This works well here because **nothing is publicly hosted yet**. The switch-over
changes the dev setup, not a live service, so the risk is mostly merge friction.
The plan below is built to keep that friction low.

### 9.1 Branch and milestones
At the start, tag the then-current `main` as **`pre-cloudflare`** and branch
**`cloudflare`** from it (done 2026-10-03 at `e2b1f83`). Milestones are commits
*into that branch*, and each one leaves the branch working.

**Local-only until cutover** (decided 2026-10-03): the wrangler login on your
machine is your *personal* Cloudflare account. So every milestone is built and
verified with the local runtime (`npm run dev`: local D1/R2/Durable Objects),
and nothing touches any Cloudflare account until the cutover runbook (§9.2)
switches to the new account.

| # | Milestone (on `cloudflare`) | Done when | Size |
|---|---|---|---|
| **M0** | Setup: `wrangler.jsonc`, Cloudflare Vite plugin, Worker skeleton, D1 schema (`migrations/`), `.dev.vars.example`, Docker image → Debian, spreadsheet → `content/sources/`; today's Firebase rules exported for reference (needs you: Firebase console) | `npm run dev` serves the game + `/api/health` from local D1. **Done 2026-10-03** | S |
| **M1** | Platform: D1 schema, `/media`, public boards API, seed *Pop Culture Icons*, create flow + Play Again read the API, "Board" wording | Full game playable (still on Firebase) with boards from the API. **Done 2026-10-03:** `npm test` (lint, 23 unit, 13 API) + 10/10 e2e green | M |
| **M2** | Admin (§5): login, dashboard, table, new board, editor, images + provenance, publish snapshots, audit | Create → edit → publish a board in staging admin; it shows up in the game | L |
| **M3** | Content tools (§7): import API, `content:sheet`, `content:discover`, `content:verify`, project skill | Spreadsheet boards sitting in staging *Imports*, reviewed | L |
| **M4** | Realtime (§8.4): shim, GameRoom, identity, rules; Firebase deleted | e2e (GM + player contexts) and multi-device play pass with no Firebase anywhere | XL |
| **M5** | Handoff (§9.3): MIGRATION.md, CLAUDE.md banner + rewrite, README/COMMANDS/REFACTOR updates, codemod, lint guard, rehearsal | A fresh clone and a simulated "Lu branch" both migrate cleanly by following the doc cold | M |

**Staying in sync:** merge `main` into `cloudflare` at least weekly and before
each milestone. That's on the migration side (you + your Claude), never on Lu.
Because the shim keeps Firebase's function names, most of Lu's game-file
changes merge cleanly; the predictable conflicts are import lines.

### 9.2 Cutover day (runbook)
1. **Heads-up, not a freeze:** tell Lu the time. Lu pushes whatever is ready
   before it. The final sync and merge take about an hour. Anything pushed after
   that comes over through MIGRATION.md like any in-progress work.
2. **Final sync:** merge `main` into `cloudflare`, then run `npm run lint`,
   `npm run build`, the e2e suite (now fully local, no production Firebase), and
   multi-device play on the branch preview.
3. **Switch accounts and set up production** (the first time anything touches
   Cloudflare):
   - `npx wrangler logout`, then `npx wrangler login` into the **new Picture
     Twirl account**, then `npx wrangler whoami` to confirm.
   - Pin `account_id` in `wrangler.jsonc`.
   - Create production + staging D1/R2 and write their ids into the config.
   - Apply D1 migrations remotely, seed, and set the secrets (`ADMIN_PASSWORD`,
     `SESSION_SECRET`, `IMPORT_TOKEN`).
   - First deploy, then connect GitHub in the dashboard (Workers Builds, with
     previews bound to staging).
   - Run `content:sheet --site prod` (boards land in *Imports* for review).
   - Then switch your login back to your personal account if you like. Day to
     day, nobody needs the new login (deploys come from Workers Builds).
4. **Merge** `cloudflare` → `main` as one merge commit, tagged
   **`cloudflare-cutover`**. Workers Builds deploys production.
5. **Smoke test production:** create a game, join from two phones, play a few
   tiles, and publish a board in the admin.
6. **Tell Lu:** "Pull `main` when you're ready. Your Claude will see the CLAUDE.md
   banner and walk you through MIGRATION.md."
7. **Firebase:** leave the project untouched for ~2 weeks as a reference, then
   delete it (you own it).

**Rollback:** there's no public deployment to break, so rolling back is a `git
revert` of the merge commit. `pre-cloudflare` marks the old world.

### 9.3 Handoff to Lu (and Lu's Claude)
What ships inside the merge:

- **CLAUDE.md banner** at the very top. Claude Code loads CLAUDE.md
  automatically, so Lu's Claude sees it on the first prompt after pulling:
  > ⚠️ *Cloudflare switch-over landed (`cloudflare-cutover`). Firebase is gone.
  > Before writing code, read **MIGRATION.md** and help the user through it. If
  > the user has unmerged work and isn't ready, follow §2 of MIGRATION.md and
  > don't merge `main` yet.*

  The banner is removed about a month later. The rest of CLAUDE.md is rewritten
  for the new architecture in the same merge, since docs drift has bitten before.
- **MIGRATION.md**, written for Lu *and* Lu's Claude:
  1. **What changed:** a before/after diagram and an old→new map (`firebase.js` →
     `realtime/` + `identity.js`; `predefinedGames.js` → boards API;
     `public/images` → R2; Firebase rules → GameRoom rules).
  2. **Not ready? Don't merge yet.** Keep committing on your branch (or your
     local `main`), with the exact git commands for it. Nothing breaks for you
     until you merge. Come back to §5 when you're ready. *(You can't partly
     accept it: it's one merge.)*
  3. **First run after pulling:** `npm install` (each OS separately, as today),
     `cp .dev.vars.example .dev.vars`, `npm run dev`, open two tabs to play,
     `npm run share` for phones. Delete the Firebase `.env.local`. No Cloudflare
     login needed. Docker users: rebuild (the image changed).
  4. **Cloudflare access (optional):** free Cloudflare login → accept the invite →
     dashboard, logs, previews. Deploys happen by pushing to `main`; PRs get a
     preview URL.
  5. **Bringing in-flight work over:** `git merge main`, then resolve conflicts
     with the old→new map, then `npm run migrate:code`, then `npm run lint`, then
     `npm test`. The codemod rewrites `firebase/database` and `../firebase.js`
     imports to the shim. It's idempotent, so run it any time. The lint guard
     (`no-restricted-imports` on `firebase*`) catches anything left over.
  6. **The shim vs Firebase:** same calls (`ref`, `onValue`, `update`, `push`,
     `serverTimestamp`, `onDisconnect`, `.info/*`). The one real difference is
     that writes are checked by the room's rules, so a new kind of player write
     needs a one-line rule (and the error says so).
  7. **Troubleshooting:** port 3000 busy, missing `.dev.vars`, Alpine/old OS vs
     the local runtime, Dropbox-synced `node_modules` (and the new native `sharp`),
     "blocked by room rules", how to wipe the local database.
  8. **Who owns what** and where to ask.
- **`npm run migrate:code`** (the codemod) and the **lint guard**, as above.
- **Rehearsal before cutover (part of M5):**
  - A fresh clone on Windows and on Mac.
  - A throwaway branch made from `main` with a fake gameplay edit in
    `renderGame.js`, merged with `cloudflare` by a fresh Claude Code session that
    only gets "follow CLAUDE.md". Fix the docs until that works without help.

### 9.3b Definition of done for every milestone (decided 2026-10-03)
Every milestone ships with tests and docs, or it isn't done:
- `npm test` green: lint (0 errors), unit, and API tests. `npm run test:e2e` is
  green too.
- New behavior gets a test at the lowest layer that can see it (unit → API →
  e2e). A bug fix gets a test that failed before the fix.
- Docs are updated in the same commit: CLAUDE.md (architecture + file map),
  COMMANDS.md, TESTING.md (new specs/layers), README when setup changes, and the
  REFACTOR.md change log.
- The rules live in [TESTING.md](TESTING.md).

### 9.4 After cutover (beta polish)
Credits page, play/recognition stats, image library, optional Cloudflare Access,
monitoring, Workers Paid ($5/mo), and the custom domain if it isn't attached
yet. Then beta.

### Repo layout after the switch-over
```
admin/index.html            Vite entry → /admin
src/admin/…                 admin app (views, dataTable, editor, imageIntake, emojiField)
src/realtime/…              Firebase-shaped shim over the GameRoom WebSocket
src/identity.js             signed anonymous player identity (replaces Firebase auth)
src/shared/boardRules.js    publish gate + limits (browser + Worker)
src/data/boardsApi.js       game-side fetch of boards
worker/…                    API, media, admin gate, import, rooms/GameRoom.js
migrations/0001_init.sql    D1 schema (wrangler d1 migrations)
tools/content/…  content/…  §7.7
.claude/skills/content/     "import the spreadsheet" helper for Claude Code
scripts/migrate-code.mjs    the codemod for in-flight branches
MIGRATION.md  wrangler.jsonc  .dev.vars.example
```

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Rights problems (pop culture, logos, musicians) | §7.1 policy in code; evidence screenshots; review flags; legal check before monetizing |
| Realtime rewrite regressions | Shim with the same API; side-by-side comparison against Firebase while building; e2e with GM + player contexts; multi-device play before the merge |
| Long-lived branch drifts from `main` | Merge `main` → `cloudflare` weekly and per milestone (migration side does it); shim keeps game-file diffs to import lines |
| Lu's merge goes badly | One-day freeze; MIGRATION.md + CLAUDE.md banner; codemod + lint guard; cold rehearsal with a fresh Claude session; "not ready? don't merge yet" path; `git revert` rollback (nothing public yet) |
| Free-plan CPU/D1 limits | Resize outside the Worker; cache board list; $5 Paid plan at beta |
| AI picks wrong/unsafe pictures | Vision check, then `import` status, then human review; editable `plan.json`; dry-run default |
| Wrong-account deploys / leaked keys | Pinned `account_id`, Workers Builds, scoped invites, secrets only in `.dev.vars`/`.env.local` |
| Dropbox syncing native deps (`sharp`, like Rollup) | Same Dropbox-ignore guidance as `node_modules` today |

---

## 11. Decisions

### Resolved (2026-10-03)
| Topic | Decision |
|---|---|
| Name | **Board** (Categories and Tiles inside; "Game" stays the live session) |
| Beta timing | **After the Firebase replacement.** Firebase is on the free Spark plan today |
| AI backend | **Your Claude subscriptions via headless Claude Code** (default); local Ollama as an optional free backend; API key only if ever needed (§7.6) |
| Ads | Likely eventually, so **NC licenses are out** |
| Rights gray zone | CC BY-SA, logos, identifiable people, unknown rights: **allowed but flagged with the reason**; only ❌ blocks publishing (§7.1) |
| Pop Culture Icons | **Internal test board.** Seeded published with "Rights unknown: test content" flags; updated or retired later via the admin |
| Spreadsheet | **An export of the team's Google Sheet.** Moves to `content/sources/` and is committed; re-export and re-run any time (§7.7) |
| Ownership & delivery | **You** own Firebase and its replacement. Lu is OK with deploy-on-push. Ship as **one documented switch-over** with a guide for Lu's Claude (§9) |
| Branch / cutover | Branch **`cloudflare`**, tags `pre-cloudflare` / `cloudflare-cutover`. **No freeze**, just a heads-up to Lu on cutover day (§9.2) |
| Dev machines / Docker | You: Mac + Windows; Lu: Windows. All native; **Docker stays as an optional fallback** on a Debian image (§8.5) |

### Defaults I'm going with (my recommendation; change any time)
- **Unique names** include archived boards; rename an archived board to reuse
  its name.
- **Editing a published board** edits a draft; players see changes after
  *Publish changes*.
- **Dragging a tile to another column** swaps the two tiles.
- **Admin login:** shared password (a Worker secret) plus a "who's editing" name
  for the audit log. Pick a longer password before the admin is public.
  Cloudflare Access can come later.
- **Pictures:** 1280 px WebP display, 320 px thumbnail, private 2560 px archival
  copy.
- **Board picker:** stays a simple list for now; search and sections once there
  are 20+ boards.

### Still open (none of these block the early milestones)
1. **Domain**, i.e. the web address players type, like `picturetwirl.com`.
   - Until there is one, the app lives at a free
     `picture-twirl.<your-subdomain>.workers.dev` address.
   - A real domain can be attached any time before beta.
   - `picturetwirl.com` looked unregistered in a quick `whois` check on
     2026-10-03. Cloudflare Registrar sells at cost (~$10/yr for .com). Buying
     it is your call.
2. **Music boards:** is there a CPR / Indie 102.3 relationship that could grant
   photo permission? Otherwise those boards depend on Commons photos.
3. **Lu's Windows version:** Windows 11 runs the local Cloudflare runtime
   natively. On Windows 10, use the Docker fallback.

---

## Appendix A: API sketch

**Public**
- `GET /api/boards` → published list `[{id, slug, title, emoji, description}]` (edge-cached)
- `GET /api/boards/:id` → published snapshot `{id, slug, rev, title, emoji, categories:[{title, tiles:[{answer, image:{url,w,h}, credit?}]}]}`
- `GET /media/:key` → R2 object, `immutable`
- `GET /credits` → page listing every published picture's credit

**Admin** (session cookie; JSON)
- `POST /api/admin/login {password, name}` · `POST /api/admin/logout` · `GET /api/admin/me`
- `GET /api/admin/stats` · `GET /api/admin/boards` · `GET /api/admin/titles/check?title=`
- `POST /api/admin/boards {title, emoji, description}` → draft
- `GET /api/admin/boards/:id` · `PUT /api/admin/boards/:id {rev, …}` → `{rev}`; 409 on stale `rev` or taken title
- `POST /api/admin/boards/:id/{publish|unpublish|archive|restore|duplicate}`
- `POST /api/admin/boards/bulk {action, ids}` → `{done:[…], skipped:[{id, reasons}]}`
- `POST /api/admin/images` (multipart: display, thumb, original?, metadata) → image
- `POST /api/admin/images/from-url {url}` → bytes + resolved metadata (known sources)
- `PATCH /api/admin/images/:id {rights fields}` · `GET /api/admin/audit` · `GET /api/admin/import-runs`

**Import** (Bearer `IMPORT_TOKEN`)
- `POST /api/import/runs` · `PATCH /api/import/runs/:id`
- `POST /api/import/images` · `POST /api/import/boards {externalKey, runId, board}` → status `import`

**Rooms (M4)**
- `POST /api/identity` → signed anonymous token
- `POST /api/rooms` → `{code}` · `GET /api/rooms/:code` · `GET /api/rooms/:code/ws` (WebSocket → GameRoom)

## Appendix B: Spreadsheet audit (tab "Content LIbrary", 170 rows)

- **Duplicates:** Fruit: Lemon ×2 · Vegetables: Green Beans ×2 · Halloween: cat ×2, witch ×2 · Thanksgiving: turkey ×2 · across categories: hot dogs (Junk Food, 4th of July), fireworks (New Years, 4th of July).
- **Likely picture/answer mismatches** (from the Unsplash URL description; Unsplash's auto-captions can be wrong, so the vision check decides): Lemon → "sliced-orange-fruit" · Green Beans → "green-chili" · Garlic → "red-onion" · pecans → "brown-coffee-beans" · bread → "white-and-gray-stone-fragments" · broccoli → "green-and-white-flower-bouquet" · wishbone → "wooden-heart-shaped-wall-decor" · turkey (200) → "roasted-chicken" · cocoa → "mug-with-happy-new-year-print" · muffin → "baked-cupcake" · thanksgiving → "logo-…".
- **Not an image:** Bagel links to a Google Form · Colorado 303 links to the cpr.org homepage · Commons `Category:` links (most Singer/Songwriter, Indie Pop, Genre Benders rows) point to a *folder* of photos, so a specific file must be chosen and license-checked.
- **No picture yet:** King Tuff, Jean Dawson, and all 25 rows of Punk Archaeology, Indie Time Machine, Beyond the Algorithm, Indie Cred, Colorado Deep Cuts.
- **Missing difficulty:** 23 rows (mostly the first food batch).
- **Rights flags:** official brand-site files (Starbucks, Taco Bell) ❌ → swap for Commons versions (still ⚠️ trademark) · all 25 logo rows ⚠️ · ~50 music rows ⚠️ identifiable people · cpr.org ❌ without permission.
