// api/checkout.js
const { call, LOCATION_ID, token } = require('./_square.js');
const { hasSession, sessionSubject, configured } = require('./_session.js');
const accountsModule = require('./_accounts.js');
const approval = require('./_approval.js');

const MAX_QTY = 99;
const MAX_ITEMS = 50;

// The third argument is a caller seam for tests; the fourth carries account /
// approval stubs. Vercel calls the handler with two. Fail-closed, in order:
//   1. Square token missing        -> 503 not_configured
//   2. session gate not configured -> 503 not_configured
//   3. no valid session cookie     -> 401 unauthenticated (Square never called)
//   4. account session not a professional -> 403 no_account
//   5. method not POST             -> 405 bad_request
//   6. empty/all-invalid items     -> 400 empty (Square never called)
//   7. upstream failure/no url     -> 503 upstream
//   8. success                     -> 200 {url}
//
// Price-integrity guarantee: the browser sends only {variationId, qty}. Any
// `price` (or similarly-named money field) it sends is never read, let alone
// forwarded — Square prices catalog_object_id line items itself from the
// catalog at LOCATION_ID, so no price crosses the wire in either direction.
//
// A per-professional session (one carrying an account id) has its group
// membership re-checked live here, so a revoked professional cannot mint a
// wholesale-priced payment link on a still-valid cookie; and its order is
// stamped with the professional's Square customer id, so it appears in their
// account history and year-to-date spend. The shared wholesale login carries
// no account id and neither check applies to it.
module.exports = async function handler(req, res, caller, deps) {
  if (!token()) {
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'not_configured' });
  }

  if (!configured()) {
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'not_configured' });
  }

  if (!hasSession(req)) {
    return res.status(401).json({ error: 'Sign in to check out', reason: 'unauthenticated' });
  }

  let customerId = null;
  const subject = sessionSubject(req);
  if (subject) {
    const dir = (deps && deps.accounts) || accountsModule;
    let account;
    try {
      account = await dir.byId(subject);
    } catch (err) {
      console.error('checkout account lookup failed:', err.message);
      return res.status(503).json({ error: 'Checkout unavailable', reason: 'upstream' });
    }
    const state = await approval.check(account, deps).catch(() => ({ ok: false, reason: 'upstream' }));
    if (!state.ok) {
      return res.status(403).json({
        error: 'This account does not currently have professional access',
        reason: 'no_account', detail: state.reason
      });
    }
    customerId = account.squareCustomerId || null;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST', reason: 'bad_request' });
  }

  const raw = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];
  const items = raw
    .filter((i) => i && typeof i.variationId === 'string' && i.variationId.length > 0)
    .map((i) => ({
      variationId: i.variationId,
      qty: Math.min(Math.max(parseInt(i.qty, 10) || 0, 0), MAX_QTY)
    }))
    .filter((i) => i.qty > 0)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    return res.status(400).json({ error: 'Your order is empty', reason: 'empty' });
  }

  const order = {
    location_id: LOCATION_ID,
    line_items: items.map((i) => ({ catalog_object_id: i.variationId, quantity: String(i.qty) }))
  };
  // Stamp the order with the professional's Square customer id so it lands in
  // their order history and counts toward their year-to-date spend. Absent for
  // the shared wholesale login, which has no customer to attribute to.
  if (customerId) order.customer_id = customerId;

  const payload = {
    idempotency_key: (globalThis.crypto || require('node:crypto').webcrypto).randomUUID(),
    order,
    checkout_options: { ask_for_shipping_address: true }
  };

  let result;
  try {
    result = await (caller || call)('/v2/online-checkout/payment-links',
      { method: 'POST', body: payload });
  } catch (err) {
    console.error('checkout upstream failed:', err.message);
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'upstream' });
  }

  const url = result && result.payment_link && result.payment_link.url;
  if (!url) {
    console.error('checkout returned no payment link url');
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'upstream' });
  }
  return res.status(200).json({ url });
};
