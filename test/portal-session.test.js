// test/portal-session.test.js
//
// /api/session is the gate the professional resource pages ask before showing
// themselves. It has one job and one failure mode that matters: it must never
// answer 200 to a browser that is not signed in, and it must not answer 401
// when the truth is that the server cannot tell.
const { test } = require('node:test');
const assert = require('node:assert');

const handler = require('../api/session.js');
const { sign, cookieHeader, COOKIE_NAME } = require('../api/_session.js');

function res() {
  const out = { code: null, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; }
  };
}

const req = (cookie) => ({ headers: cookie ? { cookie } : {} });

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const CONFIGURED = {
  SHOP_EMAIL: 'pro@example.com',
  SHOP_PASSWORD: 'correct horse',
  SESSION_SECRET: 'a-test-secret-value'
};

test('an unconfigured gate is 503, not 401', async () => {
  await withEnv({ SHOP_EMAIL: undefined, SHOP_PASSWORD: undefined, SESSION_SECRET: undefined },
    async () => {
      const r = res();
      await handler(req(), r);
      assert.equal(r.out.code, 503);
      assert.equal(r.out.body.reason, 'not_configured');
    });
});

test('no cookie is 401', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await handler(req(), r);
    assert.equal(r.out.code, 401);
    assert.equal(r.out.body.reason, 'unauthenticated');
  });
});

test('a valid session is 200 and says nothing else', async () => {
  await withEnv(CONFIGURED, async () => {
    const token = sign(Date.now() + 60000);
    const r = res();
    await handler(req(cookieHeader(token, 3600).split(';')[0]), r);
    assert.equal(r.out.code, 200);
    assert.deepEqual(r.out.body, { ok: true });
  });
});

test('an expired session is 401', async () => {
  await withEnv(CONFIGURED, async () => {
    const token = sign(Date.now() - 1000);
    const r = res();
    await handler(req(`${COOKIE_NAME}=${token}`), r);
    assert.equal(r.out.code, 401);
  });
});

test('a forged signature is 401', async () => {
  await withEnv(CONFIGURED, async () => {
    const token = sign(Date.now() + 60000);
    const forged = token.split('.')[0] + '.' + 'not-the-real-signature';
    const r = res();
    await handler(req(`${COOKIE_NAME}=${forged}`), r);
    assert.equal(r.out.code, 401);
  });
});

// A token signed with a different secret must not verify. This is the check
// that would catch the gate being pointed at an empty or shared key.
test('a session signed with another secret is 401', async () => {
  const token = await withEnv({ ...CONFIGURED, SESSION_SECRET: 'a-different-secret' },
    async () => sign(Date.now() + 60000));
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await handler(req(`${COOKIE_NAME}=${token}`), r);
    assert.equal(r.out.code, 401);
  });
});

test('a successful check is never cached', async () => {
  await withEnv(CONFIGURED, async () => {
    const token = sign(Date.now() + 60000);
    const r = res();
    await handler(req(`${COOKIE_NAME}=${token}`), r);
    assert.equal(r.out.headers['Cache-Control'], 'no-store');
  });
});

test('the response body carries no session detail', async () => {
  await withEnv(CONFIGURED, async () => {
    const token = sign(Date.now() + 60000);
    const r = res();
    await handler(req(`${COOKIE_NAME}=${token}`), r);
    const serialised = JSON.stringify(r.out.body);
    assert.ok(!serialised.includes('exp'), 'must not leak the expiry');
    assert.ok(!serialised.includes('@'), 'must not leak an email');
    assert.ok(!serialised.includes(token), 'must not echo the token');
  });
});
