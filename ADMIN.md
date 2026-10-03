# Admin guide — managing Boards

> For the people running Picture Twirl. The admin lives at **`/admin/`**
> (locally: http://localhost:3000/admin/). Technical details: CLAUDE.md
> ("Admin API"), PROPOSAL.md §5.

## Signing in
- Enter **your name** (it appears in the Activity log next to everything you
  change) and the shared **password**.
  - Local dev password: `dev-admin-password` (from `.dev.vars`).
  - Production password: a Cloudflare secret, set at cutover — never in git.
- You stay signed in for 7 days on that browser. **Sign out** (top right) ends it.
- 10 wrong passwords from one network → a 15-minute pause.

## Words we use
- **Board** — what a GM picks for a game ("Pop Culture Icons 🎤").
- **Category** — a column (5 per board).
- **Tile** — a picture + its answer; its **points** come from its row
  (100 at the top … 500 at the bottom).

## Statuses
| | Meaning | Players see it? |
|---|---|---|
| ✏️ **Draft** | Being worked on | No |
| ✨ **To review** (`import`) | Made by the AI content tools — check it, then publish | No |
| 🟢 **Published** | Live in "Pick a Board" | Yes — the last *published* version |
| 🗄️ **Archived** | Retired ("deleted", but kept and restorable) | No |

A published board you keep editing shows a **dot** and **"Publish changes"**:
players keep seeing the previous version until you publish again. Games already
in progress are never affected by any change here.

## Dashboard
Counts per status (click one to filter the table), **Needs attention** (boards
to review, unpublished changes, pictures with rights to double-check, boards
that are almost ready), recently edited boards, and the latest activity.

## Boards table
- **Filter** with the chips (All hides archived), **search** by name, **sort**
  by any column. Your view is remembered and is in the URL (shareable).
- **Select** rows (or the header box for everything shown) → **bulk**
  Publish / Move to draft / Archive / Restore. Boards that can't be published
  yet are skipped and the message says why.
- **⋮** on a row: Open, Publish, Move to draft, Duplicate, Archive/Restore.
- **+ New board**: a name (must be unique — the dialog tells you live), an
  emoji and an optional one-line description players see.

## Editing a board
Everything **saves automatically** (top right: *Saving… / ✓ Saved*).
- **Name, emoji, description** — click to edit. The 🎲-style button opens an
  emoji picker with search.
- **Category names** — the purple bar on each column.
- **Add a picture** to a tile, any of these ways:
  - click the empty tile and choose a file,
  - **drag a file** onto the tile,
  - **paste** (⌘/Ctrl+V) a copied picture while the mouse is over the tile,
  - paste a **link** (to a picture, or to a page that has one) — in the tile's
    **⋯** details or by pasting it over the tile. We download it and keep our
    own copy; the link is recorded as the picture's source.
  Pictures are resized automatically (crisp 1280 px versions, fast to load).
- **Answer** — type under the picture.
- **Rearrange**:
  - **▲ / ▼** moves a tile up/down its category (points follow the row: moving
    the 500 tile up to 300 makes it worth 300; the others shift).
  - **◀ / ▶** moves a whole category left/right with all its tiles.
  - Or **drag** the ⠿ handles. Dropping a tile on another category **swaps**
    the two tiles (every category keeps 5).
- **Undo / redo**: ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z (outside text boxes).
- **👀 Preview** shows the board the way players see it.
- If someone else saves the same board while you're editing, you'll see
  **"Changed elsewhere"** — reload to get their version (nothing is overwritten).

## Publishing
The box under the header says what's left: every board needs a name, an emoji,
5 named categories and 25 tiles with a picture and an answer. Click an item to
jump to that tile. **Publish** stays blocked until it's ✅; heads-ups (⚠️ rights
flags, small pictures, duplicate answers) don't block — you'll just be asked
to confirm when rights flags are present.

## Picture rights (please read)
Every picture records **where it came from and its license**. Open a tile's
**⋯** to see and edit it:
- **License** — CC0 / public domain / Unsplash / Pexels / Pixabay → ✅;
  **CC BY** → ✅ with a credit line players see on reveal; **CC BY-SA** → ⚠️;
  **non-commercial or no-derivatives** licenses → ❌ blocked (we plan ads, and
  the swirl modifies the picture).
- **Flags** (⚠️, allowed but flagged — the reason is shown): logo/trademark,
  identifiable person, answer visible in the picture, rights unknown.
- **Credit line** — what players see; previewed as you type.
- **"I checked this picture's rights"** records who reviewed it and when.
- Rights belong to the *picture*, so a change applies to every board using it.
  Credit lines reach players the next time each board is published.
- The **Pop Culture Icons** board is an internal test board — its pictures are
  flagged "Rights unknown" on purpose. Replace or retire it before public beta.

## Activity
Every create / rename / publish / move-to-draft / archive / restore is logged
with who and when (Activity tab, and on the dashboard).
