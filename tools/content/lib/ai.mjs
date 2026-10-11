// tools/content/lib/ai.mjs
//
// One small AI adapter for the content tools (PROPOSAL.md §7.6). Prompts and
// JSON schemas are shared, so picks look the same whichever backend runs:
//
//   claude-code (default)  headless Claude Code on YOUR subscription:
//                          `claude -p --input-format stream-json …` with a
//                          strict JSON schema, our own short system prompt, no
//                          tools (or only WebSearch/WebFetch for discovery),
//                          run from an empty folder so no CLAUDE.md/MCP context
//                          is loaded (~1.3k tokens per picture check, not ~18k).
//   ollama                 a local model (free, offline); use a vision model
//                          (e.g. qwen2.5vl:7b) for picture checks.
//
//   const ai = createAI(settings);
//   const out = await ai.ask({ kind: 'check', system, prompt, schema, images: [{ data, mediaType }] });

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Find the Claude Code executable (claude.exe on Windows avoids cmd.exe quoting). */
function claudeCommand() {
    if (process.platform !== 'win32') return 'claude';
    const found = spawnSync('where', ['claude'], { encoding: 'utf8' }).stdout?.split(/\r?\n/).map(s => s.trim()).filter(Boolean) || [];
    return found.find(p => p.toLowerCase().endsWith('.exe')) || found[0] || 'claude';
}

export function createAI(settings) {
    if (settings.ai === 'ollama') return ollamaBackend(settings);
    if (settings.ai === 'claude-code') return claudeCodeBackend(settings);
    throw new Error(`Unknown CONTENT_AI backend "${settings.ai}" (use claude-code or ollama).`);
}

function claudeCodeBackend(settings) {
    const cmd = claudeCommand();
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'picture-twirl-ai-'));   // empty: no CLAUDE.md, no project context

    return {
        name: 'claude-code',
        /**
         * @param {{ kind: 'plan'|'check'|'discover', system: string, prompt: string, schema: object,
         *           images?: Array<{ data: Buffer, mediaType: string }>, webTools?: boolean, timeoutMs?: number }} req
         */
        ask({ kind, system, prompt, schema, images = [], webTools = false, timeoutMs }) {
            const model = kind === 'check' ? settings.modelCheck : settings.modelPlan;
            const args = [
                '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
                '--json-schema', JSON.stringify(schema),
                '--system-prompt', system,
                '--strict-mcp-config', '--no-session-persistence',
                '--model', model,
                ...(webTools ? ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch', 'WebFetch'] : ['--tools', '']),
            ];
            const message = {
                type: 'user',
                message: {
                    role: 'user',
                    content: [
                        ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data.toString('base64') } })),
                        { type: 'text', text: prompt },
                    ],
                },
            };
            return new Promise((resolve, reject) => {
                const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: cmd.endsWith('.cmd') });
                let out = '';
                let err = '';
                const timer = setTimeout(() => { child.kill(); reject(new Error(`claude timed out after ${(timeoutMs || 600_000) / 1000}s`)); }, timeoutMs || 600_000);
                child.stdout.on('data', d => { out += d; });
                child.stderr.on('data', d => { err += d; });
                child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Couldn't start Claude Code ("${cmd}"): ${e.message}. Is it installed and signed in?`)); });
                child.on('close', () => {
                    clearTimeout(timer);
                    const result = out.split('\n').filter(l => l.includes('"type":"result"')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).pop();
                    if (!result) return reject(new Error(`No result from Claude Code. ${err.slice(0, 400)}`));
                    if (result.is_error || result.subtype !== 'success') return reject(new Error(`Claude Code: ${result.subtype} ${String(result.result || '').slice(0, 300)}`));
                    if (result.structured_output) return resolve(result.structured_output);
                    try { resolve(JSON.parse(result.result)); } catch { reject(new Error('Claude Code returned no structured output.')); }
                });
                child.stdin.end(`${JSON.stringify(message)}\n`);
            });
        },
    };
}

function ollamaBackend(settings) {
    return {
        name: 'ollama',
        async ask({ system, prompt, schema, images = [], timeoutMs = 600_000 }) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const res = await fetch(`${settings.ollamaUrl}/api/chat`, {
                    method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: settings.ollamaModel, stream: false, format: schema, options: { temperature: 0.2 },
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: prompt, ...(images.length && { images: images.map(i => i.data.toString('base64')) }) },
                        ],
                    }),
                });
                if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
                return JSON.parse((await res.json()).message.content);
            } catch (e) {
                if (e.name === 'AbortError') throw new Error('Ollama timed out', { cause: e });
                if (e.cause?.code === 'ECONNREFUSED') throw new Error(`Can't reach Ollama at ${settings.ollamaUrl} — is \`ollama serve\` running?`, { cause: e });
                throw e;
            } finally {
                clearTimeout(timer);
            }
        },
    };
}
