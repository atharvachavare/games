'use strict';
// Room storage. Works with whichever Redis you connect from the Vercel dashboard
// (Storage → Create Database):
//   • Upstash for Redis — REST settings such as KV_REST_API_URL / KV_REST_API_TOKEN
//     (any custom prefix works, e.g. STORAGE_REST_API_URL), or UPSTASH_REDIS_REST_URL/TOKEN
//   • Redis (Redis Cloud) or any other Redis — a connection string such as REDIS_URL or KV_URL
// Locally, with none of these set, rooms live in memory.

const TTL_SECONDS = 6 * 60 * 60; // rooms expire 6 hours after their last change
const env = process.env;
const names = Object.keys(env);

// Find "<PREFIX>_REST_API_URL" + "<PREFIX>_REST_API_TOKEN" (Vercel's Upstash integration),
// or "<PREFIX>_REDIS_REST_URL" + "<PREFIX>_REDIS_REST_TOKEN" (Upstash's own naming).
function findRest() {
  for (const n of names) {
    let m = n.match(/^(.*)_REST_API_URL$/);
    if (m && env[m[1] + '_REST_API_TOKEN']) return { url: env[n], token: env[m[1] + '_REST_API_TOKEN'] };
    m = n.match(/^(.*)_REST_URL$/);
    if (m && env[m[1] + '_REST_TOKEN']) return { url: env[n], token: env[m[1] + '_REST_TOKEN'] };
  }
  return null;
}
function findRedisUrl() {
  const n = ['REDIS_URL', 'KV_URL'].find(k => env[k]) || names.find(k => /(REDIS|KV)_URL$/.test(k) && /^rediss?:\/\//.test(env[k]));
  return n ? env[n] : null;
}

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

function redisStore(run, kind) {
  return {
    kind,
    async get(code) { return decode(await run(['GET', key(code)])); },
    async put(code, expectedV, state) {
      return Number(await run(['EVAL', CAS_SCRIPT, '1', key(code), String(expectedV), encode(state), String(TTL_SECONDS)])) === 1;
    },
  };
}

function restRunner({ url, token }) {
  return async cmd => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error('Storage error: ' + (body.error || res.status));
    return body.result;
  };
}

function tcpRunner(url) {
  let client = null;
  return async cmd => {
    if (!client) {
      const { createClient } = require('redis');
      client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: n => Math.min(n * 200, 2000) } });
      client.on('error', e => console.error('Redis error:', e.message));
      client.connectPromise = client.connect().catch(e => { client = null; throw e; });
    }
    const c = client;
    await c.connectPromise;
    return c.sendCommand(cmd);
  };
}

function memoryStore() {
  const memory = new Map();
  return {
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
}

const rest = findRest();
const redisUrl = !rest && findRedisUrl();
const store = rest ? redisStore(restRunner(rest), 'redis-rest')
  : redisUrl ? redisStore(tcpRunner(redisUrl), 'redis-tcp')
  : memoryStore();

// Names (never values) of settings that look storage-related, to help diagnose setup.
store.relatedSettingNames = names.filter(n => /REDIS|KV|UPSTASH|REST_API/.test(n));

module.exports = store;
