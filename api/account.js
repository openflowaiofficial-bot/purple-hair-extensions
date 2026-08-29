// api/account.js
// The professional's own account: their profile, their orders, and their spend
// so far this year.
//
// Square is the system of record for money. Nothing financial is stored on our
// side, so nothing here can drift out of step with Square — the totals below
// are computed from Square's own orders on every request.
//
// An account with no Square customer linked reports linked:false rather than a
// zero. A zero would read as "you have spent nothing this year", which is a
// different and possibly false statement.
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
const { hasSession, sessionSubject, configured: sessionConfigured } = require('./_session.js');
const { call, LOCATION_ID, token } = require('./_square.js');

const MAX_ORDERS = 100;

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
  const body = {
    location_ids: [LOCATION_ID],
    limit: MAX_ORDERS,
    query: {
      filter: { customer_filter: { customer_ids: [customerId] } },
      // Sorted by creation so open orders — which have no closed_at — are
      // included. Filtering on closed_at would silently drop them.
      sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
    }
  };
  const result = await (caller || call)('/v2/orders/search', { method: 'POST', body });
  return (result && result.orders) || [];
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

  if (!account || !account.approved) {
    return res.status(403).json({ error: 'This account is not approved', reason: 'no_account' });
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

  // No Square customer linked: report that plainly rather than inventing a
  // zero balance and an empty order list that look like facts.
  if (!account.squareCustomerId || !token()) {
    return res.status(200).json({
      account: view, linked: false, ytdCents: null, open: [], history: []
    });
  }

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
