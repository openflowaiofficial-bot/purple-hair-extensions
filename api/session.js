// api/session.js
// A yes/no on the current session, and nothing else. The portal resource pages
// ask this before they show themselves, the way the shop pages ask
// /api/catalog. It exists so they do not have to pull the whole catalogue down
// just to find out whether someone is signed in.
//
// It returns no data about the session beyond whether one exists: no email, no
// expiry, no token. Fail-closed, in this order:
//   1. session gate not configured -> 503 not_configured
//   2. no valid session cookie     -> 401 unauthenticated
//   3. valid session               -> 200 {ok: true}
const { hasSession, configured } = require('./_session.js');

module.exports = async function handler(req, res) {
  if (!configured()) {
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'not_configured' });
  }

  if (!hasSession(req)) {
    return res.status(401).json({ error: 'Sign in to continue', reason: 'unauthenticated' });
  }

  // Never cached: a signed-out browser must not be handed a stored 200.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
};
