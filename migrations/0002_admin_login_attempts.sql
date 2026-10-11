-- migrations/0002_admin_login_attempts.sql
-- Failed /admin sign-ins per client IP per 15-minute window (rate limit).
-- See worker/lib/auth.js. Old windows are pruned as new failures arrive.
CREATE TABLE login_attempts (
    ip              TEXT NOT NULL,
    window_start    INTEGER NOT NULL,   -- epoch ms, floored to the window
    count           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ip, window_start)
);
