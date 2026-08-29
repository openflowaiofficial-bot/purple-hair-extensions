// api/auth-verify.js
// Step two: the link is followed, the token is spent, and a session carrying
// the account id is issued.
//
// The token is deleted BEFORE the session is signed, so a link that is
// followed twice — by a mail scanner, a prefetcher, or a forwarded message —
// cannot yield a second session. One use, then it is gone.
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
    record = await kv.get(key);
    // Spend it first. If anything below fails the link is still consumed,
    // which is the safe direction to fail in.
    if (record) await kv.del(key);
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

  // Approval is re-checked here, not just when the link was sent. An account
  // suspended in between must not be able to spend a link issued earlier.
  if (!account || !account.approved) {
    return res.status(401).json({ error: 'That sign-in link is not valid', reason: 'invalid_token' });
  }

  const session = sign(Date.now() + TTL_SECONDS * 1000, account.id);
  res.setHeader('Set-Cookie', cookieHeader(session, TTL_SECONDS));
  res.setHeader('Location', '/account.html');
  return res.status(302).json({ ok: true });
};
