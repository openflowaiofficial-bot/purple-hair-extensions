// api/_store.js
// Thin Vercel KV client over its REST API. No dependencies, for the same
// reason _square.js has none: this project has no package.json and adding one
// changes how the whole site deploys.
//
// Never embed credential values here — they come only from process.env at
// request time.
//
// Vercel KV injects KV_REST_API_URL / KV_REST_API_TOKEN. A database connected
// through the newer Upstash integration instead injects UPSTASH_REDIS_REST_URL
// / UPSTASH_REDIS_REST_TOKEN — the same Upstash REST endpoint under a different
// name — so both are accepted and either connection works out of the box.
const BASE = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

function configured() {
  return !!(BASE() && TOKEN());
}

async function command(parts) {
  if (!configured()) throw new Error('kv_not_configured');
  const res = await fetch(BASE(), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(parts)
  });
  if (!res.ok) {
    // Never surface the body: an upstream error can echo the request,
    // bearer token included.
    throw new Error('kv_http_' + res.status);
  }
  const body = await res.json();
  return body ? body.result : null;
}

async function get(key) {
  const raw = await command(['GET', key]);
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function set(key, value) {
  return command(['SET', key, JSON.stringify(value)]);
}

// Seconds, not milliseconds. Used for single-use sign-in tokens so an
// unclaimed one disappears on its own rather than lingering in the store.
async function setWithTtl(key, value, ttlSeconds) {
  return command(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]);
}

async function del(key) {
  return command(['DEL', key]);
}

// Atomic read-and-delete. Returns the value the key held (parsed like get())
// and removes it in the same round trip, so two callers racing the same key
// cannot both observe it live. Used to consume single-use sign-in tokens.
async function getdel(key) {
  const raw = await command(['GETDEL', key]);
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

module.exports = { configured, get, set, setWithTtl, del, getdel, command };
