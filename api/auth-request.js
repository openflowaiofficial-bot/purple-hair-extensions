// api/auth-request.js
// Step one of signing in: a professional gives their email and, if an approved
// account exists for it, receives a single-use link.
//
// This endpoint answers the same way whether or not the email belongs to an
// account, and whether or not that account is approved. Anything else turns it
// into a directory of who The Purple Crown works with — which is exactly the
// thing wholesale access is meant to keep private. The only responses that
// differ are configuration failures, which say nothing about any email.
//
// Fail-closed, in this order:
//   1. not POST                          -> 405
//   2. store or mail not configured      -> 503 not_configured
//   3. session signing not configured    -> 503 not_configured
//   4. malformed email                   -> 200 (indistinguishable)
//   5. no account, or not approved       -> 200, nothing sent
//   6. approved account                  -> 200, link sent
const crypto = require('node:crypto');
const store = require('./_store.js');
const mail = require('./_mail.js');
const accounts = require('./_accounts.js');
const { configured: sessionConfigured } = require('./_session.js');

const TOKEN_TTL_SECONDS = 900; // 15 minutes
const OK = { ok: true };

function siteOrigin(req) {
  const configuredOrigin = process.env.SITE_ORIGIN;
  if (configuredOrigin) return configuredOrigin.replace(/\/+$/, '');
  const host = req && req.headers && req.headers.host;
  return host ? 'https://' + host : '';
}

module.exports = async function handler(req, res, deps) {
  const sender = (deps && deps.mail) || mail;
  const kv = (deps && deps.store) || store;
  const dir = (deps && deps.accounts) || accounts;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST', reason: 'bad_request' });
  }

  if (!kv.configured() || !sender.configured()) {
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'not_configured' });
  }

  if (!sessionConfigured()) {
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'not_configured' });
  }

  const email = dir.normaliseEmail((req.body || {}).email);
  // Shape check only. A malformed address gets the same 200 as a valid one.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(200).json(OK);
  }

  let account;
  try {
    account = await dir.byEmail(email);
  } catch (err) {
    console.error('auth-request lookup failed:', err.message);
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'upstream' });
  }

  // No account, or one that has not been approved yet: say nothing, send
  // nothing, and look identical from the outside.
  if (!account || !account.approved) {
    return res.status(200).json(OK);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const link = siteOrigin(req) + '/api/auth-verify?token=' + encodeURIComponent(token);

  try {
    // The token is the key. Only the account id is stored against it, and it
    // expires on its own whether or not anyone uses it.
    await kv.setWithTtl('signin:' + token, { accountId: account.id }, TOKEN_TTL_SECONDS);
    await sender.send({
      to: account.email,
      subject: 'Your Purple Crown sign-in link',
      text: [
        'Here is your sign-in link for The Purple Crown professional portal.',
        '',
        link,
        '',
        'It can be used once and expires in 15 minutes.',
        'If you did not ask to sign in, you can ignore this message.'
      ].join('\n')
    });
  } catch (err) {
    console.error('auth-request send failed:', err.message);
    return res.status(503).json({ error: 'Sign-in is unavailable', reason: 'upstream' });
  }

  return res.status(200).json(OK);
};

module.exports.TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;
