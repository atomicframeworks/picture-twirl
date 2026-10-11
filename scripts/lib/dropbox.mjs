// scripts/lib/dropbox.mjs — keeps per-machine folders out of Dropbox sync.
//
// The repo lives in Dropbox and is used from macOS and Windows. node_modules
// (native binaries per OS), .wrangler (the local database) and dist (build
// output) must never sync between machines. ensure-setup marks them "ignored"
// on THIS machine — Dropbox's own mechanism (help.dropbox.com → "ignored files"):
//   macOS   xattr  com.dropbox.ignored = 1
//   Windows NTFS alternate data stream  <folder>:com.dropbox.ignored = 1
//   Linux   attr   com.dropbox.ignored = 1
// Node built-ins only: ensure-setup runs before anything is installed.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PER_MACHINE = ['node_modules', '.wrangler', 'dist'];

/** The Dropbox folder this path is inside (it holds a `.dropbox` file), or null. */
export function findDropboxRoot(start, exists = existsSync) {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
        if (exists(path.join(dir, '.dropbox'))) return dir;
        if (path.dirname(dir) === dir) return null;
    }
}

const ok = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

/** Is this folder already ignored by Dropbox on this machine? */
export function isIgnored(dir, platform = process.platform) {
    if (platform === 'win32') {
        try { return readFileSync(`${dir}:com.dropbox.ignored`, 'utf8').trim() === '1'; } catch { return false; }
    }
    const res = platform === 'darwin'
        ? ok('xattr', ['-p', 'com.dropbox.ignored', dir])
        : ok('attr', ['-q', '-g', 'com.dropbox.ignored', dir]);
    return res.status === 0 && res.stdout.trim() === '1';
}

/** Tell Dropbox to ignore this folder on this machine (throws if it can't). */
export function markIgnored(dir, platform = process.platform) {
    if (platform === 'win32') { writeFileSync(`${dir}:com.dropbox.ignored`, '1'); return; }
    const res = platform === 'darwin'
        ? ok('xattr', ['-w', 'com.dropbox.ignored', '1', dir])
        : ok('attr', ['-q', '-s', 'com.dropbox.ignored', '-V', '1', dir]);
    if (res.status !== 0) throw new Error((res.stderr || res.error?.message || 'failed').trim());
}
