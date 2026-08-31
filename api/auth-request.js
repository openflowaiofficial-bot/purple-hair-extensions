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
//   5. no account, and no Square customer in the professionals group
//                                        -> 200, nothing sent
//   6. in the group                      -> 200, link sent (account made on
//                                           first sign-in if there was none)
const crypto = require('node:crypto');
const store = require('./_store.js');
const mail = require('./_mail.js');
const accounts = require('./_accounts.js');
const groups = require('./_groups.js');
const approval = require('./_approval.js');
const { configured: sessionConfigured } = require('./_session.js');

const TOKEN_TTL_SECONDS = 900; // 15 minutes
const OK = { ok: true };

// Only ever the configured origin. The request Host header is attacker-
// controllable, and this builds the single-use sign-in link emailed to the
// professional — a header-derived origin could deliver that link to a domain
// the attacker controls. A missing SITE_ORIGIN is a configuration failure.
function siteOrigin() {
  const configuredOrigin = process.env.SITE_ORIGIN;
  return configuredOrigin ? configuredOrigin.replace(/\/+$/, '') : '';
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

  if (!sessionConfigured() || !siteOrigin()) {
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

  // Nobody here yet. Square is the register of who is a professional, so ask
  // it: a customer with this email who is in the group gets an account made
  // for them on the spot. That is the whole approval process — add someone to
  // the group in Square and they can sign in. No second place to maintain.
  if (!account) {
    try {
      account = await firstSignIn(email, dir, deps);
    } catch (err) {
      console.error('auth-request enrolment failed:', err.message);
      // Still a 200. Whether an email belongs to a customer is exactly the
      // thing this endpoint must not disclose.
      return res.status(200).json(OK);
    }
  }

  // No account, switched off locally, or no longer in the group: say nothing,
  // send nothing, and look identical from the outside.
  if (!account) return res.status(200).json(OK);
  const state = await approval.check(account, deps).catch(() => ({ ok: false }));
  if (!state.ok) return res.status(200).json(OK);

  const token = crypto.randomBytes(32).toString('base64url');
  const link = siteOrigin() + '/api/auth-verify?token=' + encodeURIComponent(token);

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

// Creates the local record for a Square customer who is already in the
// professionals group. It never creates one for a customer who is not: the
// group is the gate, and this is only the paperwork behind it.
async function firstSignIn(email, dir, deps) {
  const g = (deps && deps.groups) || groups;
  const groupId = await g.resolveGroupId(deps);
  if (!groupId) return null;

  const customer = await g.customerByEmail(email, deps);
  if (!customer || !g.inGroup(customer, groupId)) return null;

  return dir.create({
    id: 'acct_' + crypto.randomUUID(),
    email,
    squareCustomerId: customer.id,
    approved: true,
    profile: {
      salonName: customer.company_name || '',
      contactName: [customer.given_name, customer.family_name].filter(Boolean).join(' '),
      phone: customer.phone_number || ''
    }
  });
}

module.exports.firstSignIn = firstSignIn;
module.exports.TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS;
