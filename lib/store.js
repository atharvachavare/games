'use strict';
// Room storage. On Vercel this is Upstash Redis (added from the Vercel dashboard:
// Storage → Upstash Redis → connect to project), reached over its REST API.
// Locally, without those variables, rooms live in memory.

const TTL_SECONDS = 6 * 60 * 60; // rooms expire 6 hours after their last change
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const key = code => 'mafia:room:' + code;

// Values are stored as "<version>|<json>" so a write can check the version atomically.
const encode = state => state.v + '|' + JSON.stringify(state);
const decode = raw => (raw ? JSON.parse(raw.slice(raw.indexOf('|') + 1)) : null);

// Write only if the stored version still matches (0 = room must not exist yet).
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
local curv = '0'
if cur then curv = string.match(cur, '^(%d+)|') end
if curv == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0`;

async function redis(cmd) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error('Storage error: ' + (body.error || res.status));
  return body.result;
}

const memory = new Map();

const store = URL_ && TOKEN ? {
  kind: 'redis',
  async get(code) { return decode(await redis(['GET', key(code)])); },
  async put(code, expectedV, state) {
    return (await redis(['EVAL', CAS_SCRIPT, '1', key(code), String(expectedV), encode(state), String(TTL_SECONDS)])) === 1;
  },
} : {
  kind: 'memory',
  async get(code) { const e = memory.get(key(code)); return e && e.exp > Date.now() ? decode(e.raw) : null; },
  async put(code, expectedV, state) {
    const e = memory.get(key(code));
    const cur = e && e.exp > Date.now() ? decode(e.raw).v : 0;
    if (cur !== expectedV) return false;
    memory.set(key(code), { raw: encode(state), exp: Date.now() + TTL_SECONDS * 1000 });
    return true;
  },
};

module.exports = store;
