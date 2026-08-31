// api/account.js
// The professional's own account: their profile, their orders, and their spend
// so far this year.
//
// Square is the system of record for money. Nothing financial is stored on our
// side, so nothing here can drift out of step with Square — the totals below
// are computed from Square's own orders on every request.
//
// Every account that reaches the money branch has a linked Square customer:
// approval.check refuses an unlinked account (reason 'unlinked') before we get
// there. When Square itself cannot be reached, ordersAvailable:false is sent
// and the total is shown as unknown ("—"), never as a zero — a zero would read
// as "you have spent nothing this year", a different and possibly false claim.
//
// Fail-closed, in this order:
//   1. store not configured        -> 503 not_configured
//   2. no valid session            -> 401 unauthenticated
//   3. session has no account id   -> 403 no_account (the shared login)
//   4. account missing/unapproved  -> 403 no_account
//   5. GET   -> 200 {account, linked, ytdCents, open[], history[]}
//      PATCH -> 200 {account}
//      other -> 405
const store = require('./_store.js');
const accounts = require('./_accounts.js');
const approval = require('./_approval.js');
const { hasSession, sessionSubject, configured: sessionConfigured } = require('./_session.js');
const { call, LOCATION_ID } = require('./_square.js');

const MAX_ORDERS = 100;   // page size Square returns per request
const MAX_PAGES = 20;     // safety bound: at most 2000 orders pulled per load

function startOfYearIso() {
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString();
}

// Square returns money as integer minor units. Everything below stays in
// cents; the browser formats it. No float arithmetic touches a total.
function totalCents(order) {
  const money = order && order.total_money;
  return money && Number.isInteger(money.amount) ? money.amount : 0;
}

function shapeOrder(order) {
  return {
    id: order.id,
    state: order.state || null,
    createdAt: order.created_at || null,
    closedAt: order.closed_at || null,
    totalCents: totalCents(order),
    lineItems: (order.line_items || []).slice(0, 50).map((li) => ({
      name: li.name || null,
      variationName: li.variation_name || null,
      quantity: li.quantity || null
    }))
  };
}

async function searchOrders(customerId, caller) {
  const c = caller || call;
  const query = {
    filter: { customer_filter: { customer_ids: [customerId] } },
    // Sorted by creation so open orders — which have no closed_at — are
    // included. Filtering on closed_at would silently drop them.
    sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
  };

  // Page through the cursor. A single page caps at 100 orders, so a salon that
  // orders more than that in a year would otherwise get a spend total that is
  // silently short and presented as authoritative. Bounded by MAX_PAGES so a
  // very large history cannot turn one page load into an unbounded fan-out.
  const all = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = { location_ids: [LOCATION_ID], limit: MAX_ORDERS, query };
    if (cursor) body.cursor = cursor;
    const result = await c('/v2/orders/search', { method: 'POST', body });
    if (result && Array.isArray(result.orders)) all.push(...result.orders);
    cursor = result && result.cursor;
    if (!cursor) break;
  }
  return all;
}

module.exports = async function handler(req, res, deps) {
  const kv = (deps && deps.store) || store;
  const dir = (deps && deps.accounts) || accounts;
  const caller = deps && deps.call;

  if (!kv.configured() || !sessionConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable', reason: 'not_configured' });
  }

  if (!hasSession(req)) {
    return res.status(401).json({ error: 'Sign in to view your account', reason: 'unauthenticated' });
  }

  // The shared wholesale login carries no account id. It can shop; it has no
  // account to show. This is deliberately not a 401: the stylist IS signed in.
  const id = sessionSubject(req);
  if (!id) {
    return res.status(403).json({ error: 'This session is not linked to a professional account', reason: 'no_account' });
  }

  let account;
  try {
    account = await dir.byId(id);
  } catch (err) {
    console.error('account lookup failed:', err.message);
    return res.status(503).json({ error: 'Accounts are unavailable', reason: 'upstream' });
  }

  // Live, on every request. Removing someone from the Square group takes
  // effect on their next page load rather than whenever a session expires.
  const state = await approval.check(account, deps).catch(() => ({ ok: false, reason: 'upstream' }));
  if (!state.ok) {
    return res.status(403).json({
      error: 'This account does not currently have professional access',
      reason: 'no_account', detail: state.reason
    });
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    const input = (req.body && req.body.profile) || {};
    let updated;
    try {
      updated = await dir.updateProfile(id, input);
    } catch (err) {
      console.error('profile update failed:', err.message);
      return res.status(503).json({ error: 'Accounts are unavailable', reason: 'upstream' });
    }
    return res.status(200).json({ ok: true, account: dir.publicView(updated) });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', reason: 'bad_request' });
  }

  const view = dir.publicView(account);

  // ?brief=1 is what the portal bar asks for on every signed-in page: the
  // account itself and nothing else. It deliberately skips the Square call —
  // searching a stylist's orders on every page load, to draw a 26px avatar,
  // would be an absurd amount of work for a picture.
  if (req.query && (req.query.brief === '1' || req.query.brief === 'true')) {
    return res.status(200).json({ account: view, brief: true });
  }

  // No unlinked branch here: approval already required a Square customer in
  // the professionals group, so both the id and the token are present by now.
  // An account without them never reaches this line — it is refused above.

  let orders;
  try {
    orders = await searchOrders(account.squareCustomerId, caller);
  } catch (err) {
    console.error('order search failed:', err.message);
    // The profile is still true even when Square is unreachable, so it is
    // returned. ordersAvailable:false stops the page claiming no orders exist.
    return res.status(200).json({
      account: view, linked: true, ordersAvailable: false,
      ytdCents: null, open: [], history: []
    });
  }

  const since = startOfYearIso();
  const shaped = orders.map(shapeOrder);
  const open = shaped.filter((o) => o.state === 'OPEN');
  const history = shaped.filter((o) => o.state !== 'OPEN');

  const ytdCents = shaped
    .filter((o) => o.state === 'COMPLETED' && (o.closedAt || o.createdAt) >= since)
    .reduce((sum, o) => sum + o.totalCents, 0);

  return res.status(200).json({
    account: view,
    linked: true,
    ordersAvailable: true,
    year: new Date().getUTCFullYear(),
    ytdCents,
    open,
    history
  });
};

module.exports.shapeOrder = shapeOrder;
module.exports.startOfYearIso = startOfYearIso;
