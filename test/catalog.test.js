// test/catalog.test.js
const { test } = require('node:test');
const assert = require('node:assert');

function fakeRes() {
  return { code: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; } };
}

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function freshCatalog() {
  // Every module in the dependency chain reads env at call time except
  // _square.js's module-scope LOCATION_ID/API_BASE/VERSION constants, which
  // are captured once at require. Clear the whole chain between tests that
  // vary env so nothing bleeds across cases.
  delete require.cache[require.resolve('../api/catalog.js')];
  delete require.cache[require.resolve('../api/_square.js')];
  delete require.cache[require.resolve('../api/_shape.js')];
  delete require.cache[require.resolve('../api/_contract.js')];
  delete require.cache[require.resolve('../api/_session.js')];
  return require('../api/catalog.js');
}

async function withEnv(vars, fn) {
  const prior = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

const FULL_ENV = {
  SQUARE_ACCESS_TOKEN: 'sq0atp-THROWAWAYTOKENVALUE',
  SHOP_EMAIL: 'owner@example.test',
  SHOP_PASSWORD: 'th-r0waway-pw!',
  SESSION_SECRET: 'a-long-random-throwaway-secret'
};

const goodBody = require('./fixtures/square-catalog.json');

function cookieReq(token) {
  return { method: 'GET', headers: { cookie: `pce_session=${token}` } };
}

function noCookieReq() {
  return { method: 'GET', headers: {} };
}

function neverCalled() {
  return async () => { throw new Error('fetcher must not be called at this check'); };
}

// ---------------------------------------------------------------- 1: token

test('no Square token -> 503 not_configured, and the fetcher is never invoked', async () => {
  await withEnv({ ...FULL_ENV, SQUARE_ACCESS_TOKEN: undefined }, async () => {
    const handler = freshCatalog();
    const res = fakeRes();
    await handler(noCookieReq(), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

// ------------------------------------------------------- 2: session config

test('token present but SHOP_EMAIL missing -> 503 not_configured', async () => {
  await withEnv({ ...FULL_ENV, SHOP_EMAIL: undefined }, async () => {
    const handler = freshCatalog();
    const res = fakeRes();
    await handler(noCookieReq(), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('token present but SHOP_PASSWORD missing -> 503 not_configured', async () => {
  await withEnv({ ...FULL_ENV, SHOP_PASSWORD: undefined }, async () => {
    const handler = freshCatalog();
    const res = fakeRes();
    await handler(noCookieReq(), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('token present but SESSION_SECRET missing -> 503 not_configured', async () => {
  await withEnv({ ...FULL_ENV, SESSION_SECRET: undefined }, async () => {
    const handler = freshCatalog();
    const res = fakeRes();
    await handler(noCookieReq(), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

// -------------------------------------------------------- 3: session cookie

test('no cookie -> 401 unauthenticated, body has NO variations key at all', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshCatalog();
    const res = fakeRes();
    await handler(noCookieReq(), res, async () => goodBody);
    assert.equal(res.code, 401);
    assert.equal(res.body.reason, 'unauthenticated');
    assert.ok(!('variations' in res.body), 'no variations key should leak on 401');
  });
});

test('tampered cookie (valid shape, wrong signature) -> 401, fetcher never invoked', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    const [body] = token.split('.');
    const tampered = body + '.' + 'a'.repeat(43);
    const res = fakeRes();
    await handler(cookieReq(tampered), res, neverCalled());
    assert.equal(res.code, 401);
    assert.ok(!('variations' in res.body));
  });
});

test('expired cookie -> 401', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() - 1000);
    const res = fakeRes();
    await handler(cookieReq(token), res, neverCalled());
    assert.equal(res.code, 401);
  });
});

test('valid session cookie clears the gate and reaches the fetcher', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    let called = false;
    const res = fakeRes();
    await handler(cookieReq(token), res, async () => { called = true; return goodBody; });
    assert.ok(called);
    assert.equal(res.code, 200);
  });
});

// -------------------------------------------------------------- 4: upstream

test('fetcher throws -> 503 upstream', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    const res = fakeRes();
    await handler(cookieReq(token), res, async () => { throw new Error('square_http_500'); });
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'upstream');
  });
});

// -------------------------------------------------------------- 5: contract

test('a catalog too short to be the whole library -> 503 contract', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    const short = { objects: goodBody.objects.slice(0, 2) };
    const res = fakeRes();
    await handler(cookieReq(token), res, async () => short);
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'contract');
    assert.ok(!('variations' in res.body));
  });
});

// -------------------------------------------------------------- 6: success

test('valid session + good catalog -> 200 with all 121 shaped variations', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    const res = fakeRes();
    await handler(cookieReq(token), res, async () => goodBody);
    assert.equal(res.code, 200);
    assert.equal(res.body.variations.length, 121);
  });
});

test('success response carries the s-maxage/stale-while-revalidate Cache-Control header', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    const res = fakeRes();
    await handler(cookieReq(token), res, async () => goodBody);
    assert.equal(res.headers['Cache-Control'], 's-maxage=600, stale-while-revalidate=60');
  });
});

// ---------------------------------------------------------------- pagination

test('fetchCatalog follows the cursor across pages and concatenates objects', async () => {
  await withEnv({ SQUARE_ACCESS_TOKEN: 'sq0atp-x' }, async () => {
    const square = freshRequire('../api/_square.js');
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      calls.push(String(url));
      const u = new URL(String(url));
      if (!u.searchParams.get('cursor')) {
        return { ok: true, json: async () => ({ objects: [{ id: 'A' }, { id: 'B' }], cursor: 'PAGE2TOKEN' }) };
      }
      assert.equal(u.searchParams.get('cursor'), 'PAGE2TOKEN');
      return { ok: true, json: async () => ({ objects: [{ id: 'C' }] }) };
    };
    try {
      const result = await square.fetchCatalog();
      assert.deepEqual(result.objects.map(o => o.id), ['A', 'B', 'C']);
      assert.equal(calls.length, 2);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('fetchCatalog stops at a page cap instead of looping forever on an endless cursor', async () => {
  await withEnv({ SQUARE_ACCESS_TOKEN: 'sq0atp-x' }, async () => {
    const square = freshRequire('../api/_square.js');
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ objects: [{ id: 'X' }], cursor: 'NEVER_ENDS' }) };
    };
    try {
      const result = await square.fetchCatalog();
      assert.ok(calls > 1, 'should have paginated at least once');
      assert.ok(calls <= 50, `expected a page cap, got ${calls} calls`);
      assert.equal(result.objects.length, calls);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('a single-page response (no cursor) makes exactly one call', async () => {
  await withEnv({ SQUARE_ACCESS_TOKEN: 'sq0atp-x' }, async () => {
    const square = freshRequire('../api/_square.js');
    let calls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ objects: [{ id: 'ONLY' }] }) };
    };
    try {
      const result = await square.fetchCatalog();
      assert.equal(calls, 1);
      assert.equal(result.objects.length, 1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------- token leak

test('the Square token never appears in any response body across every outcome', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const handler = freshCatalog();
    const token = sign(Date.now() + 1000000);
    const secret = FULL_ENV.SQUARE_ACCESS_TOKEN;
    const bodies = [];

    let res = fakeRes();
    await handler(noCookieReq(), res, async () => goodBody);
    bodies.push(res);

    res = fakeRes();
    await handler(cookieReq(token), res, async () => { throw new Error('square_http_401'); });
    bodies.push(res);

    res = fakeRes();
    await handler(cookieReq(token), res, async () => ({ objects: goodBody.objects.slice(0, 2) }));
    bodies.push(res);

    res = fakeRes();
    await handler(cookieReq(token), res, async () => goodBody);
    bodies.push(res);

    for (const r of bodies) {
      assert.ok(!JSON.stringify(r.body).includes(secret), 'token leaked into response body');
      assert.ok(!JSON.stringify(r.headers).includes(secret), 'token leaked into response headers');
    }
  });
});

test('an upstream error never echoes a response body that could reflect the Authorization header', async () => {
  await withEnv({ SQUARE_ACCESS_TOKEN: 'sq0atp-REALSECRETVALUE' }, async () => {
    const square = freshRequire('../api/_square.js');
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'bad auth', echoed_authorization: 'Bearer sq0atp-REALSECRETVALUE' })
    });
    try {
      let thrown;
      try { await square.fetchCatalog(); } catch (e) { thrown = e; }
      assert.ok(thrown, 'expected fetchCatalog to reject on a non-ok response');
      assert.ok(!thrown.message.includes('sq0atp-REALSECRETVALUE'), 'thrown error echoed the upstream body/token');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
