// api/catalog.js
const { fetchCatalog, LOCATION_ID, token } = require('./_square.js');
const { shape } = require('./_shape.js');
const { validate } = require('./_contract.js');
const { hasSession, sessionSubject, configured } = require('./_session.js');
const accountsModule = require('./_accounts.js');
const approval = require('./_approval.js');

// The third argument is a fetcher seam for tests; the fourth carries account /
// approval stubs. Vercel calls the handler with two. Fail-closed, in order:
//   1. Square token missing            -> 503 not_configured
//   2. session gate not configured     -> 503 not_configured
//   3. no valid session cookie         -> 401 unauthenticated (no `variations` key)
//   4. account session no longer a professional -> 403 no_account
//   5. upstream Square failure         -> 503 upstream
//   6. contract violation              -> 503 contract (problems logged server-side only)
//   7. success                         -> 200 {variations}, cached
//
// Two kinds of session reach this endpoint. The shared wholesale login carries
// no account id and is governed by the shared password alone. A per-professional
// session carries an account id, and that professional's group membership is
// re-checked live here on every request — removing them from the Square group
// revokes their wholesale pricing on their next request, not whenever their
// cookie happens to expire.
module.exports = async function handler(req, res, fetcher, deps) {
  if (!token()) {
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'not_configured' });
  }

  if (!configured()) {
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'not_configured' });
  }

  if (!hasSession(req)) {
    return res.status(401).json({ error: 'Sign in to view the catalogue', reason: 'unauthenticated' });
  }

  const subject = sessionSubject(req);
  if (subject) {
    const dir = (deps && deps.accounts) || accountsModule;
    let account;
    try {
      account = await dir.byId(subject);
    } catch (err) {
      console.error('catalog account lookup failed:', err.message);
      return res.status(503).json({ error: 'Catalog unavailable', reason: 'upstream' });
    }
    const state = await approval.check(account, deps).catch(() => ({ ok: false, reason: 'upstream' }));
    if (!state.ok) {
      return res.status(403).json({
        error: 'This account does not currently have professional access',
        reason: 'no_account', detail: state.reason
      });
    }
  }

  let body;
  try {
    body = await (fetcher || fetchCatalog)();
  } catch (err) {
    console.error('catalog upstream failed:', err.message);
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'upstream' });
  }

  const variations = shape(body, LOCATION_ID);
  const check = validate(variations);
  if (!check.ok) {
    console.error('catalog contract broken:', check.problems.join('; '));
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'contract' });
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=60');
  return res.status(200).json({ variations });
};
