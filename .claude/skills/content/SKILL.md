---
name: content
description: Run Picture Twirl's AI content tools — import boards from the team spreadsheet or discover new board ideas with free-to-use pictures, review the dry-run report, then upload them to the local admin as ✨ To review. Use when asked to import the spreadsheet, find new boards/pictures, or re-run/resume a content run.
---

# Picture Twirl content tools

Background: CLAUDE.md → "Content tools"; commands: COMMANDS.md → "Content tools".
Code: `tools/content/` (cli.mjs → pipeline.mjs → lib/*).

## Ground rules
- Tools never publish. Everything lands as **✨ To review** (status `import`) for
  a person to check in `/admin/`.
- Default is a **dry run**. Only add `--live` after reading the run's `report.md`
  (or when the user explicitly asks to upload).
- `--site local` only (the default) until the Cloudflare cutover. Never `--site prod`
  unless the user asks and `CONTENT_SITE_PROD` / `IMPORT_TOKEN_PROD` exist.
- Unsplash pictures are never sent to the AI (Unsplash's terms ask for
  permission for AI/ML use) — keep it that way (`aiMayLook` in pipeline.mjs).
- Rights are decided in code (`src/shared/rights.js`); never hand-edit a
  license to make a picture pass. NC/ND licenses are never used. ⚠️ flags are
  allowed — they tell a person what to double-check.
- Runs use the developer's Claude usage (headless `claude -p`) and real web APIs.
  Don't start large runs (`--boards` > 3 for discovery) without saying so.

## Spreadsheet import
1. The spreadsheet export lives in `content/sources/` (replace the .xlsx with a
   fresh export from the Google Sheet to update it).
2. `npm run content:sheet -- --plan-only` (~3 min) → read
   `content/runs/<run>/plan.md`. Edit `plan.json` there if names, groupings or
   answers need fixing.
3. `npm run content:sheet -- --resume last` → finds, checks and downloads
   pictures (~15–30 min; run it in the background). Read `report.md`.
4. Make sure `npm run dev` is running, then
   `npm run content:sheet -- --resume last --live`.
5. Tell the user: how many boards/tiles, ⚠️ counts, tiles without pictures, and
   the review link `http://localhost:3000/admin/#/boards?status=import`.

## Discovery (new boards)
`npm run content:discover -- --boards 2` (or `--theme "…" --boards 1`), then the
same resume / review / `--live` steps. The plan's "More board ideas" list is a
good source of themes for the next run.

## When something fails
- A run stops or crashes → `--resume last` continues; finished tiles are kept,
  failed ones are retried.
- `Can't reach http://localhost:3000` → start `npm run dev`.
- `401 bad_token` → `IMPORT_TOKEN` in `.dev.vars` doesn't match the running dev
  server (restart `npm run dev` after editing `.dev.vars`).
- `Couldn't start Claude Code` → `claude` must be installed and signed in; or
  use `--ai ollama` (local) / `--ai none` (sheet only).
- Lots of "no picture" tiles for one category → edit those tiles' `searchQuery`
  in the run's `plan.json` and `--resume` (only changed tiles are redone).
