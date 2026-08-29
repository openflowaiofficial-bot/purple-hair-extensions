// test/account.test.js
//
// The account layer touches two things that must not go wrong: who a session
// belongs to, and what a page is allowed to say about money. So the tests below
// lean on three properties in particular —
//
//   * asking for a sign-in link never reveals whether an account exists;
//   * a sign-in link works exactly once;
//   * a spend total that is not known is never reported as zero.
const { test } = require('node:test');
const assert = require('node:assert');

const authRequest = require('../api/auth-request.js');
const authVerify = require('../api/auth-verify.js');
const account = require('../api/account.js');
const accountsReal = require('../api/_accounts.js');
const { sign, readToken, COOKIE_NAME } = require('../api/_session.js');

function res() {
  const out = { code: null, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; }
  };
}

const CONFIGURED = {
  SHOP_EMAIL: 'pro@example.com',
  SHOP_PASSWORD: 'correct horse',
  SESSION_SECRET: 'a-test-secret-value',
  SQUARE_ACCESS_TOKEN: 'sq-test-token'
};

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// A store that records what it was asked to do, so single-use can be asserted.
function fakeStore(seed) {
  const data = new Map(Object.entries(seed || {}));
  const log = [];
  return {
    data, log,
    configured: () => true,
    async get(k) { log.push(['get', k]); return data.has(k) ? data.get(k) : null; },
    async set(k, v) { log.push(['set', k]); data.set(k, v); },
    async setWithTtl(k, v, ttl) { log.push(['setWithTtl', k, ttl]); data.set(k, v); },
    async del(k) { log.push(['del', k]); data.delete(k); }
  };
}

function fakeMail() {
  const sent = [];
  return { sent, configured: () => true, async send(m) { sent.push(m); return true; } };
}

function fakeAccounts(map) {
  return {
    normaliseEmail: accountsReal.normaliseEmail,
    publicView: accountsReal.publicView,
    sanitiseProfile: accountsReal.sanitiseProfile,
    async byEmail(e) { return map[accountsReal.normaliseEmail(e)] || null; },
    async byId(id) {
      for (const a of Object.values(map)) if (a.id === id) return a;
      return null;
    },
    async updateProfile(id, input) {
      const a = await this.byId(id);
      if (!a) return null;
      a.profile = { ...(a.profile || {}), ...accountsReal.sanitiseProfile(input) };
      return a;
    }
  };
}

const APPROVED = {
  id: 'acct_1', email: 'stylist@salon.com', approved: true,
  squareCustomerId: 'CUST_1', profile: { salonName: 'Ivory & Oak' }
};
const PENDING = {
  id: 'acct_2', email: 'waiting@salon.com', approved: false,
  squareCustomerId: null, profile: {}
};

const req = (over) => ({ method: 'POST', headers: {}, body: {}, query: {}, ...over });
const cookie = (token) => ({ cookie: `${COOKIE_NAME}=${token}` });

/* ---------------------------------------------------------------------------
   Asking for a link
   --------------------------------------------------------------------------- */

test('an unknown email gets the same answer as a known one', async () => {
  await withEnv(CONFIGURED, async () => {
    const dir = fakeAccounts({ [APPROVED.email]: APPROVED });
    const known = res(); const unknown = res();
    const mail = fakeMail();

    await authRequest(req({ body: { email: APPROVED.email } }), known,
      { store: fakeStore(), mail, accounts: dir });
    await authRequest(req({ body: { email: 'nobody@nowhere.com' } }), unknown,
      { store: fakeStore(), mail, accounts: dir });

    assert.equal(known.out.code, unknown.out.code);
    assert.deepEqual(known.out.body, unknown.out.body);
    assert.equal(mail.sent.length, 1, 'only the real account is emailed');
  });
});

test('an unapproved account is not emailed, and is indistinguishable', async () => {
  await withEnv(CONFIGURED, async () => {
    const mail = fakeMail();
    const r = res();
    await authRequest(req({ body: { email: PENDING.email } }), r,
      { store: fakeStore(), mail, accounts: fakeAccounts({ [PENDING.email]: PENDING }) });
    assert.equal(r.out.code, 200);
    assert.equal(mail.sent.length, 0);
  });
});

test('a malformed email is still a 200', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await authRequest(req({ body: { email: 'not-an-email' } }), r,
      { store: fakeStore(), mail: fakeMail(), accounts: fakeAccounts({}) });
    assert.equal(r.out.code, 200);
  });
});

test('no mail service configured is 503, not a silent success', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await authRequest(req({ body: { email: APPROVED.email } }), r, {
      store: fakeStore(), accounts: fakeAccounts({ [APPROVED.email]: APPROVED }),
      mail: { configured: () => false, send: async () => true }
    });
    assert.equal(r.out.code, 503);
    assert.equal(r.out.body.reason, 'not_configured');
  });
});

test('the emailed link carries the token and nothing about the account', async () => {
  await withEnv({ ...CONFIGURED, SITE_ORIGIN: 'https://example.com' }, async () => {
    const mail = fakeMail();
    const store = fakeStore();
    await authRequest(req({ body: { email: APPROVED.email } }), res(),
      { store, mail, accounts: fakeAccounts({ [APPROVED.email]: APPROVED }) });

    const body = mail.sent[0].text;
    assert.match(body, /https:\/\/example\.com\/api\/auth-verify\?token=/);
    assert.ok(!body.includes(APPROVED.id), 'the account id must not travel in the mail');
    const stored = [...store.data.keys()].find((k) => k.startsWith('signin:'));
    assert.ok(stored, 'the token is stored');
    assert.ok(store.log.some((l) => l[0] === 'setWithTtl' && l[2] === 900),
      'and it expires on its own');
  });
});

/* ---------------------------------------------------------------------------
   Spending a link
   --------------------------------------------------------------------------- */

test('a valid link signs the professional in as themselves', async () => {
  await withEnv(CONFIGURED, async () => {
    const store = fakeStore({ 'signin:tok': { accountId: APPROVED.id } });
    const r = res();
    await authVerify(req({ method: 'GET', query: { token: 'tok' } }), r,
      { store, accounts: fakeAccounts({ [APPROVED.email]: APPROVED }) });

    assert.equal(r.out.code, 302);
    assert.equal(r.out.headers.Location, '/account.html');
    const setCookie = r.out.headers['Set-Cookie'];
    const token = setCookie.split(';')[0].split('=')[1];
    assert.equal(readToken(token).sub, APPROVED.id, 'the session names the account');
  });
});

test('a link works exactly once', async () => {
  await withEnv(CONFIGURED, async () => {
    const store = fakeStore({ 'signin:tok': { accountId: APPROVED.id } });
    const dir = fakeAccounts({ [APPROVED.email]: APPROVED });

    const first = res();
    await authVerify(req({ method: 'GET', query: { token: 'tok' } }), first, { store, accounts: dir });
    assert.equal(first.out.code, 302);

    const second = res();
    await authVerify(req({ method: 'GET', query: { token: 'tok' } }), second, { store, accounts: dir });
    assert.equal(second.out.code, 401, 'the second use is refused');
    assert.ok(!second.out.headers['Set-Cookie'], 'and issues no session');
  });
});

test('an account suspended after the link was sent cannot spend it', async () => {
  await withEnv(CONFIGURED, async () => {
    const suspended = { ...APPROVED, approved: false };
    const store = fakeStore({ 'signin:tok': { accountId: suspended.id } });
    const r = res();
    await authVerify(req({ method: 'GET', query: { token: 'tok' } }), r,
      { store, accounts: fakeAccounts({ [suspended.email]: suspended }) });
    assert.equal(r.out.code, 401);
    assert.ok(!r.out.headers['Set-Cookie']);
  });
});

test('an unknown token is refused', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await authVerify(req({ method: 'GET', query: { token: 'never-issued' } }), r,
      { store: fakeStore(), accounts: fakeAccounts({}) });
    assert.equal(r.out.code, 401);
  });
});

/* ---------------------------------------------------------------------------
   The account itself
   --------------------------------------------------------------------------- */

const session = (sub) => sign(Date.now() + 60000, sub);

test('no session is 401', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await account(req({ method: 'GET', headers: {} }), r,
      { store: fakeStore(), accounts: fakeAccounts({}) });
    assert.equal(r.out.code, 401);
  });
});

test('the shared wholesale login is 403 no_account, not 401', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await account(req({ method: 'GET', headers: cookie(session()) }), r,
      { store: fakeStore(), accounts: fakeAccounts({}) });
    assert.equal(r.out.code, 403, 'they are signed in; they just have no account');
    assert.equal(r.out.body.reason, 'no_account');
  });
});

test('a signed-in professional sees their own profile', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await account(req({ method: 'GET', headers: cookie(session(APPROVED.id)) }), r, {
      store: fakeStore(), accounts: fakeAccounts({ [APPROVED.email]: APPROVED }),
      call: async () => ({ orders: [] })
    });
    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.account.email, APPROVED.email);
    assert.equal(r.out.body.account.profile.salonName, 'Ivory & Oak');
  });
});

test('an account with no Square customer reports linked:false, not a zero', async () => {
  await withEnv(CONFIGURED, async () => {
    const unlinked = { ...APPROVED, squareCustomerId: null };
    const r = res();
    await account(req({ method: 'GET', headers: cookie(session(unlinked.id)) }), r,
      { store: fakeStore(), accounts: fakeAccounts({ [unlinked.email]: unlinked }) });
    assert.equal(r.out.body.linked, false);
    assert.equal(r.out.body.ytdCents, null, 'an unknown total is null, never 0');
  });
});

test('Square being unreachable does not become "no orders"', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await account(req({ method: 'GET', headers: cookie(session(APPROVED.id)) }), r, {
      store: fakeStore(), accounts: fakeAccounts({ [APPROVED.email]: APPROVED }),
      call: async () => { throw new Error('square_http_500'); }
    });
    assert.equal(r.out.code, 200, 'the profile is still true');
    assert.equal(r.out.body.ordersAvailable, false);
    assert.equal(r.out.body.ytdCents, null);
  });
});

test('year to date counts completed orders this year and nothing else', async () => {
  await withEnv(CONFIGURED, async () => {
    const year = new Date().getUTCFullYear();
    const thisYear = `${year}-06-01T00:00:00Z`;
    const lastYear = `${year - 1}-06-01T00:00:00Z`;
    const r = res();
    await account(req({ method: 'GET', headers: cookie(session(APPROVED.id)) }), r, {
      store: fakeStore(), accounts: fakeAccounts({ [APPROVED.email]: APPROVED }),
      call: async () => ({ orders: [
        { id: 'o1', state: 'COMPLETED', closed_at: thisYear, total_money: { amount: 41000 } },
        { id: 'o2', state: 'COMPLETED', closed_at: thisYear, total_money: { amount: 33500 } },
        { id: 'o3', state: 'COMPLETED', closed_at: lastYear, total_money: { amount: 99900 } },
        { id: 'o4', state: 'OPEN', created_at: thisYear, total_money: { amount: 50000 } },
        { id: 'o5', state: 'CANCELED', closed_at: thisYear, total_money: { amount: 70000 } }
      ] })
    });
    assert.equal(r.out.body.ytdCents, 74500, 'only o1 + o2');
    assert.equal(r.out.body.open.length, 1);
    assert.equal(r.out.body.open[0].id, 'o4');
    assert.equal(r.out.body.history.length, 4);
  });
});

test('a profile update keeps only the fields a professional may edit', async () => {
  await withEnv(CONFIGURED, async () => {
    const target = { ...APPROVED, profile: {} };
    const r = res();
    await account(req({
      method: 'PATCH', headers: cookie(session(target.id)),
      body: { profile: {
        salonName: 'New Name',
        approved: true,            // must be ignored
        squareCustomerId: 'CUST_X', // must be ignored
        id: 'acct_someone_else'     // must be ignored
      } }
    }), r, { store: fakeStore(), accounts: fakeAccounts({ [target.email]: target }) });

    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.account.profile.salonName, 'New Name');
    assert.ok(!('approved' in r.out.body.account.profile));
    assert.ok(!('squareCustomerId' in r.out.body.account.profile));
    assert.ok(!('id' in r.out.body.account.profile));
    assert.equal(r.out.body.account.id, target.id, 'the account id is unchanged');
  });
});

test('the account view never returns the Square customer id to the browser', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await account(req({ method: 'GET', headers: cookie(session(APPROVED.id)) }), r, {
      store: fakeStore(), accounts: fakeAccounts({ [APPROVED.email]: APPROVED }),
      call: async () => ({ orders: [] })
    });
    assert.ok(!JSON.stringify(r.out.body.account).includes('CUST_1'));
  });
});
