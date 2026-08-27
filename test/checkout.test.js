// test/checkout.test.js
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

function freshCheckout() {
  // _square.js's module-scope LOCATION_ID/API_BASE/VERSION constants are
  // captured once at require, and _session.js reads env at call time, but
  // clear the whole chain between tests that vary env so nothing bleeds.
  delete require.cache[require.resolve('../api/checkout.js')];
  delete require.cache[require.resolve('../api/_square.js')];
  delete require.cache[require.resolve('../api/_session.js')];
  return require('../api/checkout.js');
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

function cookieReq(token, overrides) {
  return Object.assign({ method: 'POST', headers: { cookie: `pce_session=${token}` } }, overrides);
}

function noCookieReq(overrides) {
  return Object.assign({ method: 'POST', headers: {} }, overrides);
}

function neverCalled() {
  return async () => { throw new Error('Square must not be called at this check'); };
}

function validSession() {
  const { sign } = freshRequire('../api/_session.js');
  return sign(Date.now() + 1000000);
}

function okCaller(url) {
  return async () => ({ payment_link: { url: url || 'https://square.test/pay/x' } });
}

// ---------------------------------------------------------------- 1: token

test('no Square token -> 503 not_configured, Square never called', async () => {
  await withEnv({ ...FULL_ENV, SQUARE_ACCESS_TOKEN: undefined }, async () => {
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(noCookieReq({ body: { items: [] } }), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

// ------------------------------------------------------- 2: session config

test('token present but SHOP_EMAIL missing -> 503 not_configured', async () => {
  await withEnv({ ...FULL_ENV, SHOP_EMAIL: undefined }, async () => {
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(noCookieReq({ body: { items: [] } }), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('token present but SHOP_PASSWORD missing -> 503 not_configured', async () => {
  await withEnv({ ...FULL_ENV, SHOP_PASSWORD: undefined }, async () => {
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(noCookieReq({ body: { items: [] } }), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('token present but SESSION_SECRET missing -> 503 not_configured', async () => {
  await withEnv({ ...FULL_ENV, SESSION_SECRET: undefined }, async () => {
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(noCookieReq({ body: { items: [] } }), res, neverCalled());
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

// -------------------------------------------------------- 3: session cookie

test('no cookie -> 401 unauthenticated, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(noCookieReq({ body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }), res, neverCalled());
    assert.equal(res.code, 401);
    assert.equal(res.body.reason, 'unauthenticated');
  });
});

test('tampered cookie (valid shape, wrong signature) -> 401, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const [body] = token.split('.');
    const tampered = body + '.' + 'a'.repeat(43);
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(tampered, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }), res, neverCalled());
    assert.equal(res.code, 401);
    assert.equal(res.body.reason, 'unauthenticated');
  });
});

test('expired cookie -> 401, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const { sign } = freshRequire('../api/_session.js');
    const token = sign(Date.now() - 1000);
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }), res, neverCalled());
    assert.equal(res.code, 401);
  });
});

// -------------------------------------------------------------- 4: method

test('GET with a valid session -> 405 bad_request, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { method: 'GET', body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }), res, neverCalled());
    assert.equal(res.code, 405);
    assert.equal(res.body.reason, 'bad_request');
  });
});

// --------------------------------------------------------------- 5: empty

test('rejects an empty order -> 400 empty, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [] } }), res, neverCalled());
    assert.equal(res.code, 400);
    assert.equal(res.body.reason, 'empty');
  });
});

test('rejects an order that is entirely invalid rows -> 400 empty, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    const items = [
      { variationId: 42, qty: 3 },          // not a string id
      { qty: 5 },                            // no id at all
      { variationId: 'VAR_A', qty: 0 },      // zero qty
      { variationId: 'VAR_B', qty: -5 },     // negative qty
      { variationId: '', qty: 3 },           // empty string id
      null,
      'not an object'
    ];
    await handler(cookieReq(token, { body: { items } }), res, neverCalled());
    assert.equal(res.code, 400);
    assert.equal(res.body.reason, 'empty');
  });
});

test('missing body / missing items array -> 400 empty, Square never called', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: {} }), res, neverCalled());
    assert.equal(res.code, 400);
    assert.equal(res.body.reason, 'empty');
  });
});

// ----------------------------------------------------------- 6: upstream

test('upstream throw -> 503 upstream, error message not leaked', async () => {
  await withEnv({ ...FULL_ENV, SQUARE_ACCESS_TOKEN: 'sq0atp-SECRETVALUE' }, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }),
      res, async () => { throw new Error('square_http_401'); });
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'upstream');
    assert.ok(!JSON.stringify(res.body).includes('SECRETVALUE'));
  });
});

test('upstream response with no payment_link.url -> 503 upstream', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }),
      res, async () => ({ payment_link: {} }));
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'upstream');
  });
});

test('upstream response missing payment_link entirely -> 503 upstream', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }),
      res, async () => ({}));
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'upstream');
  });
});

// ------------------------------------------------------------- 7: success

test('valid order -> 200 with the payment link url', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 2 }] } }),
      res, okCaller('https://square.test/pay/abc'));
    assert.equal(res.code, 200);
    assert.equal(res.body.url, 'https://square.test/pay/abc');
  });
});

// -------------------------------------------------- price-integrity guarantee

test('ignores any price the browser sends — no price crosses the wire to Square', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    let sent = null;
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [
      { variationId: 'VAR_A', qty: 2, price: 1 },
      { variationId: 'VAR_B', qty: 1, price: '999999', amount: 5000, price_money: { amount: 100 } }
    ] } }), res,
      async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/x' } }; });
    assert.equal(res.code, 200);
    assert.equal(res.body.url, 'https://sq/x');
    assert.equal(JSON.stringify(sent).toLowerCase().includes('price'), false,
      'no form of "price" may appear anywhere in the outgoing Square payload');
    assert.equal(JSON.stringify(sent).includes('amount'), false,
      'no amount/money field may appear anywhere in the outgoing Square payload');
    assert.equal(sent.order.location_id, 'L0MRDCWWBFR3Z');
    assert.deepEqual(sent.order.line_items, [
      { catalog_object_id: 'VAR_A', quantity: '2' },
      { catalog_object_id: 'VAR_B', quantity: '1' }
    ]);
  });
});

test('sends only catalog_object_id and quantity per line item — nothing else', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    let sent = null;
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 3 }] } }), res,
      async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/x' } }; });
    assert.equal(res.code, 200);
    const line = sent.order.line_items[0];
    assert.deepEqual(Object.keys(line).sort(), ['catalog_object_id', 'quantity']);
  });
});

// ------------------------------------------------------------ clamping

test('quantities clamp to 1..99: over 99 clamps down, non-positive is dropped', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    let sent = null;
    const handler = freshCheckout();
    const res = fakeRes();
    await handler(cookieReq(token, { body: { items: [
      { variationId: 'VAR_HIGH', qty: 500 },
      { variationId: 'VAR_ZERO', qty: 0 },
      { variationId: 'VAR_NEG', qty: -3 },
      { variationId: 'VAR_OK', qty: 7 }
    ] } }), res,
      async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/x' } }; });
    assert.equal(res.code, 200);
    assert.deepEqual(sent.order.line_items, [
      { catalog_object_id: 'VAR_HIGH', quantity: '99' },
      { catalog_object_id: 'VAR_OK', quantity: '7' }
    ]);
  });
});

// ------------------------------------------------------------ line item cap

test('caps at 50 line items even when more are submitted', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    let sent = null;
    const handler = freshCheckout();
    const res = fakeRes();
    const items = [];
    for (let i = 0; i < 60; i++) items.push({ variationId: 'VAR_' + i, qty: 1 });
    await handler(cookieReq(token, { body: { items } }), res,
      async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/x' } }; });
    assert.equal(res.code, 200);
    assert.equal(sent.order.line_items.length, 50);
  });
});

// -------------------------------------------------------------- idempotency

test('generates a fresh idempotency key per request', async () => {
  await withEnv(FULL_ENV, async () => {
    const token = validSession();
    const keys = [];
    for (let i = 0; i < 2; i++) {
      const handler = freshCheckout();
      const res = fakeRes();
      await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }), res,
        async (path, opts) => { keys.push(opts.body.idempotency_key); return { payment_link: { url: 'https://sq/x' } }; });
    }
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
    assert.ok(keys[0] && keys[0].length > 10);
  });
});

// ---------------------------------------------------------------- token leak

test('a recognisable Square token value never appears in any response body across every outcome', async () => {
  const secret = 'sq0atp-SECRETVALUE12345';
  await withEnv({ ...FULL_ENV, SQUARE_ACCESS_TOKEN: secret }, async () => {
    const token = validSession();
    const bodies = [];

    let handler = freshCheckout();
    let res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }),
      res, async () => { throw new Error('square_http_401'); });
    bodies.push(res);

    res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }),
      res, async () => ({}));
    bodies.push(res);

    res = fakeRes();
    await handler(cookieReq(token, { body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }),
      res, okCaller());
    bodies.push(res);

    res = fakeRes();
    await handler(noCookieReq({ body: { items: [{ variationId: 'VAR_A', qty: 1 }] } }), res, neverCalled());
    bodies.push(res);

    for (const r of bodies) {
      assert.ok(!JSON.stringify(r.body).includes(secret), 'token leaked into response body');
      assert.ok(!JSON.stringify(r.headers).includes(secret), 'token leaked into response headers');
    }
  });
});
