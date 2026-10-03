// tests/devVars.mjs — the local Worker secrets that the dev/e2e servers and the
// API test harness run with: .dev.vars (gitignored; created from
// .dev.vars.example by scripts/ensure-setup.mjs). Tests read the admin password
// and import token from here instead of hard-coding them, so a developer can use
// the team's real admin password locally without it ever landing in git.
import path from 'node:path';
import { parseEnvFile, ROOT } from '../tools/content/lib/env.mjs';

const vars = { ...parseEnvFile(path.join(ROOT, '.dev.vars.example')), ...parseEnvFile(path.join(ROOT, '.dev.vars')) };

export const ADMIN_PASSWORD = vars.ADMIN_PASSWORD;
export const IMPORT_TOKEN = vars.IMPORT_TOKEN;
