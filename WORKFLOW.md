# How we work — from an idea to the live game

Picture Twirl runs in three places. Changes move left to right, and **nothing
reaches the live game until it's merged into `main`**.

| | **Local** — your computer | **Staging** — Cloudflare Previews | **Production** — the live game |
|---|---|---|---|
| Address | http://localhost:3000 (`npm run share` → a temporary public link for phones) | https://staging-play.picture-twirl.workers.dev, plus one `https://<branch>-play.picture-twirl.workers.dev` per pushed branch | https://play.picture-twirl.workers.dev |
| Boards + pictures | your own copy under `.wrangler/` | the **staging** database + bucket (shared by every preview) | the **production** database + bucket |
| Live games | on your computer | each preview has its own | production |
| Updated by | saving a file (the page reloads) | pushing a branch | merging into `main` (~1 min) |
| Admin (`/admin/`) | `ADMIN_PASSWORD` in your `.dev.vars` | the team password | the team password |

Boards are **data**, not code: publishing or editing a board in a site's
`/admin/` changes that site at once — no deploy, no commit.

---

## The everyday loop

1. **Start from the latest `main`:** `git switch main && git pull`
2. **Make a branch:** `git switch -c better-buzzer` — any short name; it becomes
   the preview's address.
3. **Run it:** `npm run dev` → http://localhost:3000. On phones: `npm run share`.
4. **Commit as often as you like.** A commit never deploys anything — it stays
   on your computer until you push. Stage files by name (`git add src/game/buzz.js`)
   or check `git status` first: `git add -A` sweeps in stray personal files too.
5. **Check:** `npm test` before every commit (~25 s: lint, unit, API, live-game
   tests and a docs check); `npm run test:e2e` too when you changed something
   people click.
6. **Push the branch:** `git push -u origin better-buzzer` → Cloudflare builds a
   staging preview at `https://better-buzzer-play.picture-twirl.workers.dev`
   with **staging data** — try it on phones, send the link around.
7. **Open a pull request** on GitHub (Cloudflare comments the preview link on
   it). The other person takes a look.
8. **Merge into `main`** → production deploys by itself in about a minute.
   Check https://play.picture-twirl.workers.dev.

Docs and other tiny fixes can go straight to `main` (`git push` on `main`). A
branch costs nothing, though, and gets you a staging link.

## What triggers what

| You do | What happens |
|---|---|
| Save a file | `npm run dev` reloads the page — on your computer only |
| `git commit` | Nothing outside your computer |
| Push a branch (not `main`) | A staging preview builds: `https://<branch>-play.picture-twirl.workers.dev` |
| Merge or push to `main` | Production rebuilds and deploys (~1 min) |
| Push that only changes docs | Nothing — once the build watch paths below are set; before that, a harmless rebuild of the same code |
| Publish / edit a board in `/admin/` | That site changes at once (data, not code) |
| `npm run cf:secrets` | Updates the live passwords / keys (`-- --previews`: staging's) |
| `npm run db:migrate:prod` | Changes the live database's structure — see "Database changes" |

### Pushing docs without a rebuild
Pushes that only touch docs don't rebuild: the Worker's **Build watch paths**
(Cloudflare dashboard → Workers & Pages → **play** → Settings → Builds) are set
to Include `*`, Exclude `*.md`, `screenshots/*`, `content/sources/*` (since
2026-10-04). A push that also changes code still builds — and so a branch that
changes only docs gets no staging preview either. Rebuilds are
harmless anyway: same code, about a minute, and the free plan includes 3,000
build minutes a month.

---

## Staging in detail

- **Two kinds of staging link.** Every pushed branch gets its own preview. One
  long-lived preview named `staging` —
  https://staging-play.picture-twirl.workers.dev — is the stable place to try the
  admin and the content tools against staging data.
- **Staging data:** D1 database `picture-twirl-staging` + R2 bucket
  `picture-twirl-media-staging`, bound in `wrangler.jsonc` → `previews`. Every
  preview shares them; production never sees them. Staging started with the same
  11 imported boards (✨ To review) — publish one in staging's `/admin/` to play
  there.
- **Live games** in a preview are its own (Cloudflare gives each preview fresh
  Durable Objects).
- **Passwords + keys:** the Preview base config, set with
  `npm run cf:secrets -- --previews` (the admin password is the team's; the other
  keys differ from production's).
- **Branch previews are on** (since 2026-10-04): dashboard → **play** →
  Settings → Builds → **Builds for Preview branches** (Preview command
  `npx wrangler preview`) — switch them off there if ever needed.
- **Refresh the `staging` site with your current code** (needs the Cloudflare
  token): `npm run build && npm run cf -- preview --name staging`. Pushing a branch
  named `staging` does the same.
- **Content tools → staging:** `npm run content:sheet -- --resume <run> --live --site staging`.
- **Not in staging:** production's boards as people edit them. Staging is for
  trying code; copy a board by hand (or re-run a content run) when you need one.

## Database changes (migrations)

Cloudflare deploys code on push, **not database changes**. To add a table or column:

1. Add `migrations/<000N_what>.sql` (the next number; never edit one that's already applied). Keep
   it **additive** — new tables, nullable columns or columns with defaults — so
   the code already running keeps working.
2. Locally: `npm run dev` applies it (so do the tests' throwaway databases).
3. Staging: `npm run db:migrate:staging` before pushing the branch that needs it.
4. Production: `npm run db:migrate:prod` **before** merging the code that needs it.

Steps 3–4 need the Cloudflare token (`cloudflare-token.txt`, owner).

## Something broke in production

1. **Roll back first:** dashboard → Workers & Pages → **play** → Deployments →
   the last good one → **Rollback** (Lu's Editor role can do this too). Or
   `git revert -m 1 <merge commit>` and push.
2. **Read the logs:** dashboard → **play** → Logs (Workers Logs are on), or a
   live stream: `npm run cf -- tail` (owner).
3. **Fix it on a branch**, check the preview, merge.

A content mistake (wrong answer, bad picture) is fixed in `/admin/`: edit or
unpublish the board. No deploy.

## Where the secrets live

| Secret | Local | Staging | Production |
|---|---|---|---|
| `ADMIN_PASSWORD` (the team's) | `.dev.vars` | Preview base config | Worker secret |
| `SESSION_SECRET` | `.dev.vars` (random per machine) | Preview base config | Worker secret |
| `IMPORT_TOKEN` (content tools) | `.dev.vars` | base config + `IMPORT_TOKEN_STAGING` in `.env.local` | Worker secret + `IMPORT_TOKEN_PROD` in `.env.local` |
| Cloudflare API token (setup + maintenance) | `cloudflare-token.txt` (owner; shared by Dropbox) | — | — |

All of these files are gitignored and none of the values is in the git history
(audited 2026-10-04 — the repo is public). `npm run setup` gives every machine
its own random local `SESSION_SECRET` / `IMPORT_TOKEN`, because the example
file's values are public. **Changing the team password:** edit `ADMIN_PASSWORD`
in `.dev.vars`, then `npm run cf:secrets` and `npm run cf:secrets -- --previews`.

## Who can do what

| | Owner | Lu |
|---|---|---|
| GitHub: branches, pull requests, merging (= deploying) | ✅ | ✅ |
| `/admin/` on every site (team password) | ✅ | ✅ |
| Cloudflare dashboard for the `play` Worker: logs, builds, deployments, rollback | ✅ Super Administrator | ✅ Editor (can't delete it) |
| Database migrations, secrets, refreshing `staging` (the Cloudflare token) | ✅ | via the owner, or with the token from the shared Dropbox folder |
| Billing, members, the account | ✅ | — |

## Costs — no surprise bills

Everything runs on Cloudflare's free plans; the only pay-as-you-go piece is R2
(pictures), and it stays inside its free tier because every picture goes through
the Worker, which the free plan caps at 100k requests a day. Never give a
bucket a public link (r2.dev or its own domain). A **$1 budget alert** emails the
owner if anything is ever billed. Upgrading to Workers Paid ($5/mo) is the
owner's decision. Details: PROPOSAL.md §8.1.

## First day on the project

1. `git clone https://github.com/atomicframeworks/picture-twirl.git && cd picture-twirl`
2. `npm run dev` — setup is automatic (README → Getting started).
3. Put the team password in `.dev.vars` (`ADMIN_PASSWORD=…`) for the local `/admin/`.
4. `npm test` — all green.
5. Read: README (overview) → this file → [CLAUDE.md](CLAUDE.md) (architecture) →
   [ADMIN.md](ADMIN.md) (boards) → [TESTING.md](TESTING.md).
6. Optional: accept the Cloudflare invite (logs + rollbacks).

Work from before the Cloudflare switch-over (Firebase imports)? [MIGRATION.md](MIGRATION.md).
