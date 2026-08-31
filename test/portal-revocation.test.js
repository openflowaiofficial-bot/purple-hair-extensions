// test/portal-revocation.test.js
//
// The fixes in this branch turn on one distinction: a session that carries an
// account id (an individual professional) is treated differently from the
// subject-less shared wholesale login. These tests pin the consequences —
//
//   * catalog and checkout re-check group membership live for account sessions,
//     so removing someone from the Square group cuts off wholesale pricing and
//     checkout on the next request, not whenever a cookie expires;
//   * a checkout order made on an account session carries that professional's
//     Square customer id, so it shows up in their account history and spend;
//   * the shared login is untouched by both — it has no account to check or
//     attribute;
//   * the certified-invite cron caps emails SENT, not members examined, so a
//     newly-added professional past the cap is still reached;
//   * the account page's spend total pages through every order, not just 100.
const { test } = require('node:test');
const assert = require('node:assert');

const { sign, readToken, COOKIE_NAME } = require('../api/_session.js');
const accountsReal = require('../api/_accounts.js');
const catalog = require('../api/catalog.js');
const checkout = require('../api/checkout.js');
const account = require('../api/account.js');
const invite = require('../api/invite-certified.js');
const authDirect = require('../api/auth-direct.js');

const ENV = {
  SQUARE_ACCESS_TOKEN: 'sq-test-token',
  SHOP_EMAIL: 'owner@example.test',
  SHOP_PASSWORD: 'th-r0waway-pw',
  SESSION_SECRET: 'a-long-random-throwaway-secret',
  SITE_ORIGIN: 'https://example.com',
  CRON_SECRET: 'cron-throwaway'
};

async function withEnv(vars, fn) {
  const prior = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k];
    }
  }
}

function res() {
  const out = { code: null, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; }
  };
}

const cookie = (token) => ({ cookie: `${COOKIE_NAME}=${token}` });
const accountSession = () => sign(Date.now() + 1000000, 'acct_1');
const sharedSession = () => sign(Date.now() + 1000000);

const APPROVED = { id: 'acct_1', email: 'stylist@salon.com', approved: true, squareCustomerId: 'CUST_1', profile: {} };

// Injected straight into deps: _approval.check reads resolveGroupId/customerById/
// inGroup off deps when present, so `inside` toggles group membership.
function approvalDeps(inside) {
  return {
    accounts: { async byId(id) { return id === APPROVED.id ? APPROVED : null; } },
    resolveGroupId: async () => 'GRP',
    customerById: async (id) => ({ id, group_ids: inside ? ['GRP'] : [] }),
    inGroup: (customer, gid) => (customer.group_ids || []).includes(gid)
  };
}

function fakeAccounts(map) {
  return {
    normaliseEmail: accountsReal.normaliseEmail,
    publicView: accountsReal.publicView,
    async byEmail(e) { return map[accountsReal.normaliseEmail(e)] || null; },
    async byId(id) { for (const a of Object.values(map)) if (a.id === id) return a; return null; },
    async create(rec) { map[rec.email] = rec; return rec; }
  };
}

/* -------------------------------------------------------------------------
   Direct sign-in — email in, session out, no emailed link
   ------------------------------------------------------------------------- */

test('auth-direct: an approved professional is signed in directly', async () => {
  await withEnv(ENV, async () => {
    const r = res();
    const dir = fakeAccounts({ [APPROVED.email]: APPROVED });
    await authDirect({ method: 'POST', body: { email: APPROVED.email } }, r,
      Object.assign(approvalDeps(true), { accounts: dir, store: { configured: () => true } }));
    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.ok, true);
    const setCookie = r.out.headers['Set-Cookie'];
    assert.ok(setCookie, 'a session cookie is set');
    const token = setCookie.split(';')[0].split('=')[1];
    assert.equal(readToken(token).sub, APPROVED.id, 'the session names the professional');
  });
});

test('auth-direct: an email not in the professionals group is refused', async () => {
  await withEnv(ENV, async () => {
    const r = res();
    const dir = fakeAccounts({});
    const deps = Object.assign(approvalDeps(false), {
      accounts: dir,
      store: { configured: () => true },
      groups: { resolveGroupId: async () => 'GRP', customerByEmail: async () => null, inGroup: () => false }
    });
    await authDirect({ method: 'POST', body: { email: 'stranger@nowhere.com' } }, r, deps);
    assert.equal(r.out.code, 401);
    assert.equal(r.out.body.reason, 'not_professional');
    assert.ok(!r.out.headers['Set-Cookie'], 'no session for a non-professional');
  });
});

/* -------------------------------------------------------------------------
   Catalog — live revocation for account sessions
   ------------------------------------------------------------------------- */

test('catalog: an account removed from the group is refused, fetcher never runs', async () => {
  await withEnv(ENV, async () => {
    const r = res();
    let fetched = false;
    await catalog({ method: 'GET', headers: cookie(accountSession()) }, r,
      async () => { fetched = true; return { objects: [] }; }, approvalDeps(false));
    assert.equal(r.out.code, 403);
    assert.equal(r.out.body.reason, 'no_account');
    assert.equal(r.out.body.detail, 'not_in_group');
    assert.equal(fetched, false, 'Square catalog must not be fetched for a revoked account');
  });
});

test('catalog: an approved account clears the gate and reaches the catalog', async () => {
  await withEnv(ENV, async () => {
    const fixture = require('./fixtures/square-catalog.json');
    const r = res();
    await catalog({ method: 'GET', headers: cookie(accountSession()) }, r,
      async () => fixture, approvalDeps(true));
    assert.equal(r.out.code, 200);
    assert.ok(Array.isArray(r.out.body.variations) && r.out.body.variations.length > 0);
  });
});

/* -------------------------------------------------------------------------
   Checkout — live revocation, and customer attribution
   ------------------------------------------------------------------------- */

test('checkout: a revoked account cannot mint a payment link', async () => {
  await withEnv(ENV, async () => {
    const r = res();
    let called = false;
    await checkout(
      { method: 'POST', headers: cookie(accountSession()), body: { items: [{ variationId: 'V1', qty: 1 }] } },
      r, async () => { called = true; return { payment_link: { url: 'x' } }; }, approvalDeps(false));
    assert.equal(r.out.code, 403);
    assert.equal(r.out.body.reason, 'no_account');
    assert.equal(called, false, 'Square must not be called for a revoked account');
  });
});

test('checkout: an approved account stamps the order with its Square customer id', async () => {
  await withEnv(ENV, async () => {
    const r = res();
    let sent = null;
    await checkout(
      { method: 'POST', headers: cookie(accountSession()), body: { items: [{ variationId: 'V1', qty: 2 }] } },
      r, async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/pay' } }; },
      approvalDeps(true));
    assert.equal(r.out.code, 200);
    assert.equal(sent.order.customer_id, 'CUST_1', 'the order must be attributed to the professional');
  });
});

test('checkout: the shared login carries no customer id and still checks out', async () => {
  await withEnv(ENV, async () => {
    const r = res();
    let sent = null;
    await checkout(
      { method: 'POST', headers: cookie(sharedSession()), body: { items: [{ variationId: 'V1', qty: 1 }] } },
      r, async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/pay' } }; });
    assert.equal(r.out.code, 200);
    assert.ok(!('customer_id' in sent.order), 'the shared login has no customer to attribute to');
  });
});

/* -------------------------------------------------------------------------
   Account spend — pages through every order, not just the first 100
   ------------------------------------------------------------------------- */

test('account: year-to-date spend sums orders across every page', async () => {
  await withEnv(ENV, async () => {
    const store = { configured: () => true, async get() { return null; }, async set() {}, async setWithTtl() {}, async del() {}, async getdel() { return null; } };
    const accounts = { publicView: (a) => ({ email: a.email, profile: a.profile || {} }), async byId(id) { return id === APPROVED.id ? APPROVED : null; } };
    // Two pages: the cursor on the first must be followed to reach the second.
    const pages = [
      { orders: [{ id: 'o1', state: 'COMPLETED', closed_at: '2026-06-01T00:00:00Z', total_money: { amount: 10000 } }], cursor: 'c1' },
      { orders: [{ id: 'o2', state: 'COMPLETED', closed_at: '2026-06-02T00:00:00Z', total_money: { amount: 20000 } }] }
    ];
    let call = 0;
    // approvalDeps carries a minimal accounts stub; our fuller one (with
    // publicView) must win, so it is assigned last.
    const deps = Object.assign(approvalDeps(true), { store, accounts, call: async () => pages[call++] });
    const r = res();
    await account({ method: 'GET', headers: cookie(accountSession()), query: {} }, r, deps);
    assert.equal(r.out.code, 200);
    assert.equal(call, 2, 'both pages must be fetched');
    assert.equal(r.out.body.ytdCents, 30000, 'both pages must be summed, not just the first');
  });
});

/* -------------------------------------------------------------------------
   Invite cron — the cap is on emails sent, not members examined
   ------------------------------------------------------------------------- */

test('invite: a newly-added professional past the cap is still invited', async () => {
  await withEnv(ENV, async () => {
    const MAX = invite.MAX_PER_RUN;
    // MAX already-invited members, then one fresh member after them.
    const members = [];
    for (let i = 0; i < MAX; i++) members.push({ id: 'C' + i, email_address: 'm' + i + '@s.com' });
    members.push({ id: 'C_NEW', email_address: 'newpro@s.com' });

    const seed = {};
    for (let i = 0; i < MAX; i++) seed[invite.INVITE_KEY('C' + i)] = { at: 'earlier' };
    const data = new Map(Object.entries(seed));
    const store = {
      configured: () => true,
      async get(k) { return data.has(k) ? data.get(k) : null; },
      async set(k, v) { data.set(k, v); },
      async del(k) { data.delete(k); }
    };
    const sent = [];
    const mail = { configured: () => true, async send(m) { sent.push(m); return true; } };
    const groups = {
      resolveGroupId: async () => 'GRP',
      groupName: () => 'Professionals',
      async listGroupMembers() { return members; }
    };

    const r = res();
    await invite({ method: 'POST', headers: { authorization: 'Bearer ' + ENV.CRON_SECRET } }, r,
      { store, mail, groups });

    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.invited, 1, 'exactly the one fresh professional is invited');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'newpro@s.com', 'the fresh professional past the cap is reached');
  });
});
