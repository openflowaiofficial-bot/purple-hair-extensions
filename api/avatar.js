// api/avatar.js
// A professional's own profile picture. POST replaces it, DELETE removes it.
//
// The account is taken from the signed session and nowhere else. Nothing the
// browser sends can name a different account, choose a storage path, or set a
// URL directly — otherwise one professional could overwrite another's picture,
// or point their own at any address they liked.
//
// Fail-closed, in this order:
//   1. store or blob not configured -> 503 not_configured
//   2. no valid session             -> 401 unauthenticated
//   3. session carries no account   -> 403 no_account (the shared login)
//   4. account missing/unapproved   -> 403 no_account
//   5. body absent/too large/not an image by its own bytes -> 400
//   6. success                      -> 200 {avatarUrl}
const store = require('./_store.js');
const blobStore = require('./_blob.js');
const accounts = require('./_accounts.js');
const { inspect, MAX_BYTES } = require('./_image.js');
const { hasSession, sessionSubject, configured: sessionConfigured } = require('./_session.js');

async function readBody(req) {
  // Vercel may have parsed it already. A Buffer is what we want; a parsed
  // object means something upstream mis-typed the request, and is refused
  // rather than coerced.
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  if (req.body && !req.on) return null;

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    // Stop reading rather than buffering an unbounded upload.
    if (total > MAX_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res, deps) {
  const kv = (deps && deps.store) || store;
  const blob = (deps && deps.blob) || blobStore;
  const dir = (deps && deps.accounts) || accounts;

  if (!kv.configured() || !blob.configured() || !sessionConfigured()) {
    return res.status(503).json({ error: 'Profile pictures are unavailable', reason: 'not_configured' });
  }

  if (!hasSession(req)) {
    return res.status(401).json({ error: 'Sign in to update your profile', reason: 'unauthenticated' });
  }

  const id = sessionSubject(req);
  if (!id) {
    return res.status(403).json({ error: 'This session is not linked to a professional account', reason: 'no_account' });
  }

  let account;
  try {
    account = await dir.byId(id);
  } catch (err) {
    console.error('avatar account lookup failed:', err.message);
    return res.status(503).json({ error: 'Profile pictures are unavailable', reason: 'upstream' });
  }
  if (!account || !account.approved) {
    return res.status(403).json({ error: 'This account is not approved', reason: 'no_account' });
  }

  const previous = account.avatarUrl || null;

  if (req.method === 'DELETE') {
    try {
      const updated = await dir.setAvatar(id, null);
      // Best effort. A blob left behind is untidy; a failure here must not
      // stop the professional from removing their picture.
      if (previous) { try { await blob.del(previous); } catch (e) { console.error('avatar cleanup failed:', e.message); } }
      return res.status(200).json({ ok: true, avatarUrl: null, account: dir.publicView(updated) });
    } catch (err) {
      console.error('avatar delete failed:', err.message);
      return res.status(503).json({ error: 'Profile pictures are unavailable', reason: 'upstream' });
    }
  }

  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Use POST', reason: 'bad_request' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    console.error('avatar read failed:', err.message);
    return res.status(400).json({ error: 'That upload could not be read', reason: 'bad_request' });
  }

  if (!body) {
    return res.status(400).json({ error: 'That image is too large. The limit is 4 MB.', reason: 'too_large' });
  }

  // The declared Content-Type is not consulted. Only the bytes are.
  const check = inspect(body);
  if (!check.ok) {
    const message = check.reason === 'too_large'
      ? 'That image is too large. The limit is 4 MB.'
      : 'That file is not a JPEG, PNG or WebP image.';
    return res.status(400).json({ error: message, reason: check.reason });
  }

  // Built here, from the session's account id. Never from the request.
  const pathname = 'avatars/' + encodeURIComponent(id) + '.' + check.ext;

  let url;
  try {
    url = await blob.put(pathname, body, check.type);
  } catch (err) {
    console.error('avatar upload failed:', err.message);
    return res.status(503).json({ error: 'Profile pictures are unavailable', reason: 'upstream' });
  }

  let updated;
  try {
    updated = await dir.setAvatar(id, url);
  } catch (err) {
    console.error('avatar save failed:', err.message);
    return res.status(503).json({ error: 'Profile pictures are unavailable', reason: 'upstream' });
  }

  // Only once the new one is safely recorded. Failing here would otherwise
  // leave the account pointing at a picture that had just been deleted.
  if (previous && previous !== url) {
    try { await blob.del(previous); } catch (e) { console.error('avatar cleanup failed:', e.message); }
  }

  return res.status(200).json({ ok: true, avatarUrl: url, account: dir.publicView(updated) });
};

// Vercel must hand us the raw bytes rather than a parsed JSON body.
module.exports.config = { api: { bodyParser: false } };
