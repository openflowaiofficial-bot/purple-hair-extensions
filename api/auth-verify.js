// api/auth-verify.js
// Step two: the link is followed, the token is spent, and a session carrying
// the account id is issued.
//
// The token is consumed atomically (GETDEL) BEFORE the session is signed, so a
// link that is followed twice — by a mail scanner, a prefetcher, a forwarded
// message, or two requests racing at the same instant — cannot yield a second
// session. The read and the delete are one step; one use, then it is gone.
//
// Fail-closed, in this order:
//   1. not GET                        -> 405
//   2. store not configured           -> 503 not_configured
//   3. session signing not configured -> 503 not_configured
//   4. missing / unknown / spent token-> 401 invalid_token
//   5. account gone or not approved   -> 401 invalid_token
//   6. valid                          -> 302 to the account page, cookie set
const store = require('./_store.js');
const accounts = require('./_accounts.js');
const approval = require('./_approval.js');
const { configured, sign, cookieHeader, TTL_SECONDS } = require('./_session.js');

module.exports = async function handler(req, res, deps) {
  const kv = (deps && deps.store) || store;
  const dir = (deps && deps.accounts) || accounts;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Use GET', reason: 'bad_request' });
  }

  if (!kv.configured()) {
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'not_configured' });
  }

  if (!configured()) {
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'not_configured' });
  }

  const token = (req.query && req.query.token) ||
    (deps && deps.token) || '';
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: 'That sign-in link is not valid', reason: 'invalid_token' });
  }

  const key = 'signin:' + token;
  let record;
  try {
    // Read and delete in one atomic step. Two requests racing the same link
    // cannot both come away with the record, so at most one session is issued.
    // If anything below fails the link is still consumed, which is the safe
    // direction to fail in.
    record = await kv.getdel(key);
  } catch (err) {
    console.error('auth-verify lookup failed:', err.message);
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'upstream' });
  }

  if (!record || !record.accountId) {
    return res.status(401).json({ error: 'That sign-in link has expired or has already been used', reason: 'invalid_token' });
  }

  let account;
  try {
    account = await dir.byId(record.accountId);
  } catch (err) {
    console.error('auth-verify account lookup failed:', err.message);
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'upstream' });
  }

  // Re-checked here, not just when the link was sent. Someone removed from the
  // group in the fifteen minutes since must not be able to spend the link.
  const state = account
    ? await approval.check(account, deps).catch(() => ({ ok: false }))
    : { ok: false };
  if (!state.ok) {
    return res.status(401).json({ error: 'That sign-in link is not valid', reason: 'invalid_token' });
  }

  const session = sign(Date.now() + TTL_SECONDS * 1000, account.id);
  res.setHeader('Set-Cookie', cookieHeader(session, TTL_SECONDS));
  res.setHeader('Location', '/account.html');
  return res.status(302).json({ ok: true });
};
