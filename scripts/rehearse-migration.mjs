#!/usr/bin/env node
// scripts/rehearse-migration.mjs — `npm run rehearse:migration [-- --run]`
//
// Rehearses Lu's side of the cutover (PROPOSAL.md §9.3) in a throwaway sandbox,
// outside the repo — nothing here touches your branches or GitHub:
//
//   origin.git  a bare stand-in for GitHub whose main = pre-cloudflare with
//               the current branch merged in (tagged cloudflare-cutover)
//   lu/         "Lu's" clone, still in the Firebase days: branch
//               lu/emoji-reactions = pre-cloudflare + a small feature that hits
//               the hard cases — an import line we also changed, a helper added
//               to the deleted src/firebase.js, an edit to the deleted
//               predefinedGames.js, and a new field players write (which the
//               room's rules refuse until someone allows it)
//
// Then a FRESH Claude Code session merges it, told only what Lu would say. Run
// it again after every docs change and after the final sync on cutover day.
// --run starts that session headless (it uses your Claude subscription: ~5 min);
// without --run the command is printed. --dir <path> picks the sandbox folder.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { run: { type: 'boolean', default: false }, dir: { type: 'string' } } });

const sh = (cmd, args, cwd, extra = {}) => {
    const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', ...extra });
    if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${res.error?.message || ''}\n${res.stdout || ''}\n${res.stderr || ''}`);
    return res.stdout.trim();
};
const git = (args, cwd) => sh('git', args, cwd);
const as = (name, email) => ['-c', `user.name=${name}`, '-c', `user.email=${email}`];

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT);
const dir = o.dir ? path.resolve(o.dir) : mkdtempSync(path.join(os.tmpdir(), 'pt-rehearsal-'));
mkdirSync(dir, { recursive: true });
for (const sub of ['origin.git', 'cutover', 'lu']) rmSync(path.join(dir, sub), { recursive: true, force: true });

console.log(`Sandbox: ${dir}\nCutover = pre-cloudflare + ${branch} (${git(['rev-parse', '--short', 'HEAD'], ROOT)})`);

// 1. A stand-in for GitHub, and cutover day on it.
git(['clone', '-q', '--bare', ROOT, path.join(dir, 'origin.git')], dir);
git(['clone', '-q', path.join(dir, 'origin.git'), 'cutover'], dir);
const cut = path.join(dir, 'cutover');
git(['checkout', '-q', '-B', 'main', 'pre-cloudflare'], cut);
git([...as('Owner (rehearsal)', 'owner@example.invalid'), 'merge', '-q', '--no-ff', `origin/${branch}`, '-m', 'Cloudflare switch-over (cutover rehearsal)'], cut);
git(['tag', '-f', 'cloudflare-cutover'], cut);
git(['push', '-q', '-f', 'origin', 'main', '--tags'], cut);

// 2. Lu's clone, still in the Firebase days, with work on a branch.
git(['clone', '-q', path.join(dir, 'origin.git'), 'lu'], dir);
const lu = path.join(dir, 'lu');
git(['checkout', '-q', '-b', 'lu/emoji-reactions', 'pre-cloudflare'], lu);
git(['branch', '-q', '-f', 'main', 'pre-cloudflare'], lu);                     // Lu hasn't pulled yet
git(['remote', 'set-url', '--push', 'origin', 'no-pushing-in-rehearsal'], lu);  // pushes fail by design

const edit = (file, from, to) => {
    const p = path.join(lu, file);
    const text = readFileSync(p, 'utf8');
    if (!text.includes(from)) throw new Error(`rehearsal patch: "${from.slice(0, 50)}…" not found in ${file}`);
    writeFileSync(p, text.replace(from, to));
};
edit('src/firebase.js', 'export function getCurrentUser() {\n    return _auth?.currentUser || _currentUser || null;\n}\n',
    'export function getCurrentUser() {\n    return _auth?.currentUser || _currentUser || null;\n}\n\n/** True once anonymous auth has a user (used by reactions). */\nexport function isSignedIn() {\n    return !!getCurrentUser();\n}\n');
edit('src/game/renderGame.js', "import { rtdb, getCurrentUser } from '../firebase.js';", "import { rtdb, getCurrentUser, isSignedIn } from '../firebase.js';");
edit('src/game/renderGame.js', '        updateYouBadge();\n', `        updateYouBadge();

        // Emoji reactions: float each player's newest one (players press 1/2/3).
        for (const [uid, p] of Object.entries(participants)) {
            if (p.reactionAt && p.reactionAt !== prev[uid]?.reactionAt) showReaction(p.displayName || 'Player', p.reaction);
        }
`);
edit('src/game/renderGame.js', '    // ─── Buzz button (non-GM) ', `    // ─── Emoji reactions (players press 1 / 2 / 3 during a question) ──────────
    const REACTIONS = { 1: '😮', 2: '😂', 3: '🔥' };
    function showReaction(name, emoji) {
        const el = document.createElement('div');
        el.className = 'reaction-float';
        el.textContent = \`\${emoji} \${name}\`;
        root.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }
    const onReactionKey = (e) => {
        const emoji = REACTIONS[e.key];
        if (!emoji || isGM || !currentQuestion || !isSignedIn()) return;
        update(ref(rtdb, P.participant(gameId, myUid)), { reaction: emoji, reactionAt: serverTimestamp() })
            .catch(err => console.error('Reaction failed:', err));
    };
    window.addEventListener('keydown', onReactionKey);
    track(() => window.removeEventListener('keydown', onReactionKey));

    // ─── Buzz button (non-GM) `);
edit('src/predefinedGames.js', "answer: 'Britney Spears' }", "answer: 'Britney' }");
git([...as('Lu (rehearsal)', 'lu@example.invalid'), 'commit', '-q', '-am', 'Emoji reactions: players press 1/2/3 during a question'], lu);
console.log(`Lu's branch: ${git(['log', '--oneline', '-1'], lu)}`);

// 3. The fresh session.
const prompt = 'The Cloudflare switch-over has landed on origin/main. Please bring it into my branch lu/emoji-reactions so my work keeps working. Follow CLAUDE.md.';
const claudeArgs = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash(git:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)',
    'Bash(find:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(diff:*)', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite',
    '--disallowedTools', 'Bash(git push:*)', 'Bash(npx wrangler deploy:*)', 'Bash(wrangler deploy:*)', 'Bash(rm -rf:*)',
    '--strict-mcp-config', '--max-turns', '150'];
const transcript = path.join(dir, 'session.jsonl');

console.log('\nInstalling Lu\'s Firebase-era dependencies…');
sh('npm', ['install', '--no-audit', '--no-fund'], lu);

const checks = `Check its work (in ${lu}):
  git log --oneline -3 && git status --short
  git grep -n '^<<<<<<<' -- src worker tests        # no conflict markers
  npm run migrate:code -- --check                    # no Firebase left
  git diff origin/main -- worker/rooms/roomCore.js   # reaction / reactionAt allowed for players
  npm test && npm run test:e2e
Expected: firebase.js + predefinedGames.js stay deleted; isSignedIn() → getCurrentUser();
a room rule + unit test for the new fields; the Britney edit raised as a question; nothing pushed.`;

if (!o.run) {
    console.log(`\nNow let a fresh Claude Code session do Lu's merge:\n  cd ${lu}\n  claude ${claudeArgs.map(a => (/[\s()*|]/.test(a) ? JSON.stringify(a) : a)).join(' ')} > ${transcript}\n\n${checks}`);
} else {
    console.log('\nRunning a fresh headless Claude Code session (a few minutes)…');
    const res = spawnSync('claude', claudeArgs, { cwd: lu, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
    writeFileSync(transcript, res.stdout || '');
    const result = (res.stdout || '').split('\n').filter(l => l.includes('"type":"result"')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).pop();
    console.log(result ? `\nSession ${result.subtype} in ${result.num_turns} turns. Its report:\n\n${result.result}\n` : `\nNo result (exit ${res.status}). ${res.stderr?.slice(0, 500)}`);
    console.log(`Transcript: ${transcript}\n\n${checks}`);
}
if (!existsSync(path.join(lu, '.git'))) process.exitCode = 1;
