// test/login.test.js
const { test } = require('node:test');
const assert = require('node:assert');

function fakeRes() {
  return { code: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; } };
}

function freshLogin() {
  delete require.cache[require.resolve('../api/login.js')];
  delete require.cache[require.resolve('../api/_session.js')];
  return require('../api/login.js');
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

const FULL_ENV = { SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'a-long-random-string' };

test('POST returns 503 not_configured when SHOP_EMAIL is missing', async () => {
  await withEnv({ ...FULL_ENV, SHOP_EMAIL: undefined }, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: FULL_ENV.SHOP_PASSWORD } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('POST returns 503 not_configured when SHOP_PASSWORD is missing', async () => {
  await withEnv({ ...FULL_ENV, SHOP_PASSWORD: undefined }, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: 'th-r0waway-pw!' } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('POST returns 503 not_configured when SESSION_SECRET is missing', async () => {
  await withEnv({ ...FULL_ENV, SESSION_SECRET: undefined }, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: FULL_ENV.SHOP_PASSWORD } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.reason, 'not_configured');
  });
});

test('POST with wrong email and POST with wrong password get byte-identical 401 bodies', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();

    const resWrongEmail = fakeRes();
    await handler({ method: 'POST', body: { email: 'nope@example.test', password: FULL_ENV.SHOP_PASSWORD } }, resWrongEmail);

    const resWrongPassword = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: 'wrongpass' } }, resWrongPassword);

    assert.equal(resWrongEmail.code, 401);
    assert.equal(resWrongPassword.code, 401);
    assert.deepEqual(resWrongEmail.body, resWrongPassword.body);
    assert.equal(JSON.stringify(resWrongEmail.body), JSON.stringify(resWrongPassword.body));
    assert.equal(resWrongEmail.body.reason, 'bad_credentials');
    assert.equal(resWrongEmail.body.error, 'Those details were not recognised');
  });
});

test('POST with the right pair returns 200 with a Set-Cookie header', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: FULL_ENV.SHOP_PASSWORD } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.ok(res.headers['Set-Cookie'], 'expected a Set-Cookie header');
  });
});

test('the Set-Cookie header on success carries HttpOnly, Secure, SameSite and Path', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: FULL_ENV.SHOP_PASSWORD } }, res);
    const cookie = res.headers['Set-Cookie'];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite/);
    assert.match(cookie, /Path=\//);
  });
});

test('the success response never echoes the submitted email or password', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'POST', body: { email: FULL_ENV.SHOP_EMAIL, password: FULL_ENV.SHOP_PASSWORD } }, res);
    const everything = JSON.stringify(res.body) + JSON.stringify(res.headers);
    assert.ok(!everything.includes(FULL_ENV.SHOP_PASSWORD));
  });
});

test('DELETE returns 200 with the cookie cleared via Max-Age=0', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'DELETE' }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  });
});

test('GET is rejected with 405', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    assert.equal(res.code, 405);
  });
});

test('PUT is rejected with 405', async () => {
  await withEnv(FULL_ENV, async () => {
    const handler = freshLogin();
    const res = fakeRes();
    await handler({ method: 'PUT' }, res);
    assert.equal(res.code, 405);
  });
});
