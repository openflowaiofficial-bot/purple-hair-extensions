// api/auth-direct.js
// Direct professional sign-in. A stylist enters the email on their account and,
// if that email belongs to a Square customer in the professionals group, a
// session is signed on the spot — no emailed link, no mail service required.
//
// This is a deliberate simplification of the emailed-link flow (auth-request +
// auth-verify), chosen by the owner: the portal is trade-only and every account
// is approved by hand in Square, so the email is a lookup key rather than a
// second factor. The tradeoff — no proof the person controls the inbox — is
// accepted for that context.
//
// Approval is still live and authoritative: the customer must be in the Square
// professionals group right now, checked on every sign-in. First sign-in for a
// group member with no local record yet creates it, exactly as auth-request did.
//
// Fail-closed, in this order:
//   1. not POST                     -> 405
//   2. store or session unconfigured-> 503 not_configured
//   3. malformed email              -> 401 invalid
//   4. Square/store unreachable     -> 503 upstream
//   5. not an approved professional -> 401 not_professional
//   6. approved                     -> 200 {ok:true}, session cookie set
const store = require('./_store.js');
const accounts = require('./_accounts.js');
const approval = require('./_approval.js');
const { firstSignIn } = require('./auth-request.js');
const { configured: sessionConfigured, sign, cookieHeader, TTL_SECONDS } = require('./_session.js');

module.exports = async function handler(req, res, deps) {
  const kv = (deps && deps.store) || store;
  const dir = (deps && deps.accounts) || accounts;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST', reason: 'bad_request' });
  }

  if (!kv.configured() || !sessionConfigured()) {
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'not_configured' });
  }

  const email = dir.normaliseEmail((req.body || {}).email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(401).json({ error: 'Enter the email on your professional account', reason: 'invalid' });
  }

  let account;
  try {
    account = await dir.byEmail(email);
    if (!account) account = await firstSignIn(email, dir, deps);
  } catch (err) {
    console.error('auth-direct lookup failed:', err.message);
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'upstream' });
  }

  const state = account
    ? await approval.check(account, deps).catch(() => ({ ok: false, reason: 'upstream' }))
    : { ok: false, reason: 'not_professional' };

  if (!state.ok) {
    // A configuration or connectivity failure is not the stylist's fault, and
    // must not read as "you are not approved". Everything else is a clean 401.
    if (state.reason === 'upstream' || state.reason === 'not_configured') {
      return res.status(503).json({ error: 'We could not confirm your access just now. Please try again shortly.', reason: state.reason });
    }
    return res.status(401).json({
      error: 'That email is not recognised as an approved professional account. If you should have access, contact support@purplecrownextensions.com.',
      reason: 'not_professional'
    });
  }

  const session = sign(Date.now() + TTL_SECONDS * 1000, account.id);
  res.setHeader('Set-Cookie', cookieHeader(session, TTL_SECONDS));
  return res.status(200).json({ ok: true });
};
