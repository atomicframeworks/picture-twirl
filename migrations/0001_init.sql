-- migrations/0001_init.sql
-- Picture Twirl content database (Cloudflare D1). Design: PROPOSAL.md §4.
-- Timestamps are Unix epoch milliseconds (Date.now()).

-- A Board is what players pick ("Pop Culture Icons"): 5 categories × 5 tiles.
-- The grid lives in draft_json (what admins edit; autosaved) and
-- published_json (the immutable snapshot players get).
CREATE TABLE boards (
    id              TEXT PRIMARY KEY,                 -- 'brd_…'
    slug            TEXT NOT NULL UNIQUE,             -- stable id for URLs and live rooms ('pop-icons')
    title           TEXT NOT NULL,
    title_key       TEXT NOT NULL UNIQUE,             -- normalized title: no two boards share a name (archived included)
    emoji           TEXT NOT NULL DEFAULT '🎲',
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'import', 'archived')),
    source          TEXT NOT NULL DEFAULT 'manual',   -- manual | seed | ai-sheet | ai-discover
    import_run_id   TEXT,
    external_key    TEXT UNIQUE,                      -- makes content-tool re-runs update instead of duplicate
    draft_json      TEXT NOT NULL,
    rev             INTEGER NOT NULL DEFAULT 1,       -- bumps on every save; autosave sends it back (409 if stale)
    tiles_ready     INTEGER NOT NULL DEFAULT 0,       -- tiles with a picture and an answer (0–25)
    flagged_tiles   INTEGER NOT NULL DEFAULT 0,       -- tiles whose picture carries a ⚠️ rights flag
    published_json  TEXT,
    published_rev   INTEGER,
    published_at    INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    updated_by      TEXT,
    archived_at     INTEGER
);
CREATE INDEX boards_status_updated ON boards (status, updated_at DESC);

-- One row per publish: instant rollback, and "which version did that game play?"
CREATE TABLE board_revisions (
    board_id        TEXT NOT NULL REFERENCES boards (id),
    rev             INTEGER NOT NULL,
    published_json  TEXT NOT NULL,
    published_at    INTEGER NOT NULL,
    published_by    TEXT,
    PRIMARY KEY (board_id, rev)
);

-- Pictures and where they came from. Shared across boards; bytes live in R2.
CREATE TABLE images (
    id              TEXT PRIMARY KEY,                 -- 'img_…'
    sha256          TEXT NOT NULL UNIQUE,             -- of the display file: the same picture twice = one row
    display_key     TEXT NOT NULL,                    -- R2 key: 1280 px WebP, served at /media/<key>
    thumb_key       TEXT NOT NULL,                    -- R2 key: 320 px WebP
    archive_key     TEXT,                             -- R2 key: private 2560 px copy, never served to players
    evidence_key    TEXT,                             -- R2 key: screenshot of the source/license page at retrieval
    width           INTEGER,
    height          INTEGER,
    bytes           INTEGER,
    provider        TEXT NOT NULL DEFAULT 'upload',   -- upload | url | wikimedia | openverse | unsplash | pexels | pixabay | nasa | seed
    source_page_url TEXT,
    source_file_url TEXT,
    creator         TEXT,
    creator_url     TEXT,
    license         TEXT NOT NULL DEFAULT 'unknown',  -- cc0 | pdm | cc-by-4.0 | cc-by-sa-4.0 | unsplash | pexels | pixabay | permission | unknown | …
    license_url     TEXT,
    attribution     TEXT,                             -- credit line shown to players when the license requires one
    rights_status   TEXT NOT NULL DEFAULT 'flagged'   -- ok ✅ | flagged ⚠️ (allowed, with reasons) | blocked ❌
                    CHECK (rights_status IN ('ok', 'flagged', 'blocked')),
    rights_flags    TEXT NOT NULL DEFAULT '[]',       -- JSON array of flag codes; their reasons live in one shared module
    rights_note     TEXT,
    reviewed_by     TEXT,
    reviewed_at     INTEGER,
    retrieved_at    INTEGER,
    created_at      INTEGER NOT NULL,
    created_by      TEXT,
    notes           TEXT
);
CREATE INDEX images_rights ON images (rights_status);

-- Who did what (admin and import actions).
CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    at              INTEGER NOT NULL,
    actor           TEXT,
    action          TEXT NOT NULL,
    board_id        TEXT,
    detail          TEXT
);
CREATE INDEX audit_log_at ON audit_log (at DESC);

-- One row per content-tool run (npm run content:*).
CREATE TABLE import_runs (
    id              TEXT PRIMARY KEY,                 -- 'run_…'
    kind            TEXT NOT NULL,                    -- sheet | discover | verify
    actor           TEXT,
    started_at      INTEGER NOT NULL,
    finished_at     INTEGER,
    summary_json    TEXT
);
