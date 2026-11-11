'use strict';
// Single API endpoint for the game.
//   GET  /api/room?code=ABCD&secret=...&v=N   → poll: { view } or { same: true } if nothing changed
//   POST /api/room { action: 'create' | 'join' | 'act', ... } → { view } or { error }
const game = require('../lib/game');
const store = require('../lib/store');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const cleanSecret = s => { s = String(s || ''); return /^[A-Za-z0-9-]{16,64}$/.test(s) ? s : null; };

// Read-modify-write with optimistic locking, retried if another phone wrote first.
async function update(code, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const G = await store.get(code);
    if (!G) throw new game.GameError('Room not found. It may have expired — create a new one.');
    const before = G.v, snapshot = JSON.stringify(G);
    fn(G);
    if (JSON.stringify(G) === snapshot) return G; // nothing changed (e.g. a repeated tap)
    G.v = before + 1;
    if (await store.put(code, before, G)) return G;
    await new Promise(r => setTimeout(r, 20 + Math.random() * 60));
  }
  throw new Error('The room is busy, please try again.');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

module.exports = async function handler(req, res) {
  if (process.env.VERCEL && store.kind === 'memory') {
    const seen = store.relatedSettingNames;
    return send(res, 503, { error: 'Game storage is not set up yet. In Vercel: Storage → create a Redis database → connect it to this project → Deployments → Redeploy. '
      + (seen.length ? `(This deployment can see: ${seen.join(', ')})` : '(This deployment can\'t see any database settings — it may need a redeploy after connecting.)') });
  }
  try {
    if (req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const code = cleanCode(q.get('code')), secret = cleanSecret(q.get('secret'));
      if (!secret) return send(res, 400, { error: 'Bad request.' });
      const G = await store.get(code);
      if (!G) return send(res, 404, { error: 'Room not found. It may have expired.', gone: true });
      const view = game.viewFor(G, secret);
      if (!view) return send(res, 404, { error: 'You are no longer in this room.', gone: true });
      if (String(G.v) === q.get('v')) return send(res, 200, { same: true });
      return send(res, 200, { view });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
    const body = await readBody(req);
    const secret = cleanSecret(body.secret);
    if (!secret) return send(res, 400, { error: 'Bad request.' });

    if (body.action === 'create') {
      for (let i = 0; i < 10; i++) {
        const code = game.randCode();
        const G = game.newGame(code, secret, body.name);
        if (await store.put(code, 0, G)) return send(res, 200, { view: game.viewFor(G, secret) });
      }
      throw new Error('Could not create a room, please try again.');
    }

    const code = cleanCode(body.code);
    if (code.length !== 4) return send(res, 400, { error: 'Enter the 4-letter room code.' });

    if (body.action === 'join') {
      const G = await update(code, G => game.join(G, secret, body.name));
      return send(res, 200, { view: game.viewFor(G, secret) });
    }

    if (body.action === 'act') {
      const msg = body.msg && typeof body.msg === 'object' ? body.msg : {};
      const G = await update(code, G => game.act(G, secret, msg));
      return send(res, 200, { view: game.viewFor(G, secret) });
    }

    return send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    if (e instanceof game.GameError) return send(res, 400, { error: e.message });
    console.error(e);
    return send(res, 500, { error: e.message || 'Server error.' });
  }
};
