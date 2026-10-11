// worker/routes/rooms.js
//
// The live game's doors into its GameRoom Durable Objects (PROPOSAL.md §8.4;
// the room itself: worker/rooms/GameRoom.js). Client: src/realtime/client.js.
//
//   POST /api/player                → { uid, token }       a new anonymous player identity
//   POST /api/rooms                 → { code }             a fresh game code, reserved for you
//                                     (Authorization: Bearer <player token>)
//   GET  /api/rooms/:code           → { exists, phase, host }   for the join screen
//                                     (host = "you are its host" when a token is sent)
//   GET  /api/rooms/:code/ws?token=…&cid=…   → WebSocket into the room
//
// Game codes: 6 characters from an alphabet without look-alikes (no 0/o, 1/l/i),
// stored lowercase, shown uppercase. The room checks a code is free before
// handing it out — a new game can never land on a live one (AUDIT M4).

import { gameConfigured, issuePlayer, verifyPlayer } from '../lib/auth.js';
import { HttpError, json } from '../lib/http.js';

export const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
export const CODE_LENGTH = 6;
const CODE_RE = /^[a-z0-9]{4,12}$/;

/** A random game code (rejection sampling, so every character is equally likely). */
export function newGameCode() {
    let out = '';
    const limit = 256 - (256 % CODE_ALPHABET.length);
    while (out.length < CODE_LENGTH) {
        for (const b of crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))) {
            if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
        }
    }
    return out;
}

const roomStub = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));

function refuseSocket(code, reason) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.close(code, reason);
    return new Response(null, { status: 101, webSocket: client });
}

function requireGame(env) {
    if (!gameConfigured(env)) throw new HttpError(503, 'not_configured', 'Live games need SESSION_SECRET (see .dev.vars.example).');
}

function codeParam(params) {
    const code = String(params.code || '').toLowerCase();
    if (!CODE_RE.test(code)) throw new HttpError(404, 'not_found', 'No game with that code.');
    return code;
}

async function playerFrom(request, env) {
    const header = request.headers.get('Authorization') || '';
    return header.startsWith('Bearer ') ? verifyPlayer(env, header.slice(7)) : null;
}

export function registerRoomRoutes(router) {
    router.post('/api/player', async ({ env }) => {
        requireGame(env);
        return json(await issuePlayer(env), { status: 201 });
    });

    router.post('/api/rooms', async ({ request, env }) => {
        requireGame(env);
        const uid = await playerFrom(request, env);
        if (!uid) throw new HttpError(401, 'signed_out', 'Missing or invalid player token.');
        for (let attempt = 0; attempt < 8; attempt++) {
            const code = newGameCode();
            const res = await roomStub(env, code).fetch('https://room/reserve', { method: 'POST', headers: { 'x-pt-uid': uid } });
            if (res.ok) return json({ code }, { status: 201 });
        }
        throw new HttpError(503, 'no_codes', 'Couldn’t find a free game code — try again.');
    });

    router.get('/api/rooms/:code', async ({ request, env, params }) => {
        requireGame(env);
        const code = codeParam(params);
        const uid = await playerFrom(request, env);
        const res = await roomStub(env, code).fetch('https://room/info', { headers: uid ? { 'x-pt-uid': uid } : {} });
        return json(await res.json());
    });

    router.get('/api/rooms/:code/ws', async ({ request, env, params, url }) => {
        requireGame(env);
        if (request.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'websocket_required', 'Connect with a WebSocket.');
        // A browser can't read the HTTP status of a refused upgrade, so refusals are close
        // codes on an accepted socket: 4404 = no such game code, 4401 = get a new identity,
        // 4400 = bad request.
        const code = String(params.code || '').toLowerCase();
        if (!CODE_RE.test(code)) return refuseSocket(4404, 'No game with that code.');
        const uid = await verifyPlayer(env, url.searchParams.get('token'));
        if (!uid) return refuseSocket(4401, 'Missing or invalid player token.');
        const cid = url.searchParams.get('cid') || '';
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(cid)) return refuseSocket(4400, 'Missing connection id.');
        const headers = new Headers(request.headers);
        headers.set('x-pt-uid', uid);
        headers.set('x-pt-cid', cid);
        return roomStub(env, code).fetch(new Request('https://room/ws', { headers }));
    });
}
