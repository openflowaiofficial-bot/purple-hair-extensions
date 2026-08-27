// test/session.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Forges a token the way an attacker would if they knew the (public,
// readable-from-this-repo) signing algorithm but not a real SESSION_SECRET:
// they guess the key is the empty string, since that's what an unguarded
// `process.env.SESSION_SECRET || ''` fallback would use.
function forgeTokenWithKey(expiresAtMs, key) {
  const body = Buffer.from(JSON.stringify({ exp: expiresAtMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return body + '.' + sig;
}

function freshSession() {
  delete require.cache[require.resolve('../api/_session.js')];
  return require('../api/_session.js');
}

function withEnv(vars, fn) {
  const prior = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

test('configured() is false when any of the three vars is missing', () => {
  withEnv({ SHOP_EMAIL: undefined, SHOP_PASSWORD: 'x', SESSION_SECRET: 'x' }, () => {
    assert.equal(freshSession().configured(), false);
  });
  withEnv({ SHOP_EMAIL: 'a@b.com', SHOP_PASSWORD: undefined, SESSION_SECRET: 'x' }, () => {
    assert.equal(freshSession().configured(), false);
  });
  withEnv({ SHOP_EMAIL: 'a@b.com', SHOP_PASSWORD: 'x', SESSION_SECRET: undefined }, () => {
    assert.equal(freshSession().configured(), false);
  });
  withEnv({ SHOP_EMAIL: '', SHOP_PASSWORD: 'x', SESSION_SECRET: 'x' }, () => {
    assert.equal(freshSession().configured(), false);
  });
});

test('configured() is true when all three vars are set', () => {
  withEnv({ SHOP_EMAIL: 'a@b.com', SHOP_PASSWORD: 'x', SESSION_SECRET: 'x' }, () => {
    assert.equal(freshSession().configured(), true);
  });
});

test('a token signed and verified under the same secret is valid', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'correct-horse-battery-staple' }, () => {
    const { sign, verify } = freshSession();
    const token = sign(Date.now() + 60000);
    assert.equal(verify(token), true);
  });
});

test('a token signed under a different SESSION_SECRET fails verify', () => {
  let token;
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'secret-one' }, () => {
    token = freshSession().sign(Date.now() + 60000);
  });
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'secret-two' }, () => {
    const { verify } = freshSession();
    assert.equal(verify(token), false);
  });
});

test('a token with a valid signature but an expired exp fails verify', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'a-secret' }, () => {
    const { sign, verify } = freshSession();
    const token = sign(Date.now() - 1000);
    assert.equal(verify(token), false);
  });
});

test('structurally broken tokens fail verify without throwing', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'a-secret' }, () => {
    const { verify } = freshSession();
    const garbage = [
      'no-dot-at-all',
      'not$$base64.also-not-base64!!!',
      Buffer.from('not json at all').toString('base64url') + '.' + Buffer.from('sig').toString('base64url'),
      '',
      null,
      undefined,
      42,
      {},
      'a.b.c',
      '.',
      'a.',
      '.b'
    ];
    for (const g of garbage) {
      assert.doesNotThrow(() => verify(g), `verify threw on ${JSON.stringify(g)}`);
      assert.equal(verify(g), false, `verify accepted ${JSON.stringify(g)}`);
    }
  });
});

test('tampering with the payload while keeping the old signature fails verify', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'a-secret' }, () => {
    const { sign, verify } = freshSession();
    const token = sign(Date.now() + 60000);
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const tamperedBody = Buffer.from(JSON.stringify({ exp: payload.exp + 1000000 })).toString('base64url');
    const tampered = tamperedBody + '.' + sig;
    assert.equal(verify(tampered), false);
  });
});

test('a token with a valid body and signature but a trailing extra segment is rejected', () => {
  // Guards the "exactly two parts" check itself: mutating that check from
  // `!== 2` to `< 2` would let a genuinely valid token with extra data
  // tacked on the end (a length-3 token whose first two parts are real)
  // slip through verify(), since destructuring `[body, sig]` silently
  // ignores anything past the second part.
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'a-secret' }, () => {
    const { sign, verify } = freshSession();
    const valid = sign(Date.now() + 60000);
    assert.equal(verify(valid), true, 'sanity check: the base token should verify on its own');
    const withExtraSegment = valid + '.EVILPAYLOAD';
    assert.equal(verify(withExtraSegment), false);
  });
});

test('verify() and hasSession() fail closed when SESSION_SECRET is unset, even against a token forged with an empty-string key', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: undefined }, () => {
    const { verify, hasSession, configured, COOKIE_NAME } = freshSession();
    assert.equal(configured(), false, 'sanity check: this environment must be unconfigured');
    const forged = forgeTokenWithKey(Date.now() + 60000, '');
    assert.equal(verify(forged), false);
    assert.equal(hasSession({ headers: { cookie: `${COOKIE_NAME}=${forged}` } }), false);
  });
});

test('verify() and hasSession() fail closed when SESSION_SECRET is the empty string, even against a token forged with an empty-string key', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: '' }, () => {
    const { verify, hasSession, configured, COOKIE_NAME } = freshSession();
    assert.equal(configured(), false, 'sanity check: this environment must be unconfigured');
    const forged = forgeTokenWithKey(Date.now() + 60000, '');
    assert.equal(verify(forged), false);
    assert.equal(hasSession({ headers: { cookie: `${COOKIE_NAME}=${forged}` } }), false);
  });
});

test('credentialsMatch succeeds on the configured pair', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'x' }, () => {
    const { credentialsMatch } = freshSession();
    assert.equal(credentialsMatch('owner@example.test', 'th-r0waway-pw!'), true);
  });
});

test('credentialsMatch fails on wrong email', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'x' }, () => {
    const { credentialsMatch } = freshSession();
    assert.equal(credentialsMatch('somebody-else@example.test', 'th-r0waway-pw!'), false);
  });
});

test('credentialsMatch fails on wrong password', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'x' }, () => {
    const { credentialsMatch } = freshSession();
    assert.equal(credentialsMatch('owner@example.test', 'wrong'), false);
  });
});

test('credentialsMatch is case-insensitive on email but exact on password', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'x' }, () => {
    const { credentialsMatch } = freshSession();
    assert.equal(credentialsMatch('  Owner@Example.Test  ', 'th-r0waway-pw!'), true);
    assert.equal(credentialsMatch('OWNER@EXAMPLE.TEST', 'th-r0waway-pw!'), true);
    assert.equal(credentialsMatch('owner@example.test', 'TH-R0WAWAY-PW!'), false);
    assert.equal(credentialsMatch('owner@example.test', 'th-r0waway-pw! '), false);
  });
});

test('credentialsMatch handles malformed input without throwing', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'x' }, () => {
    const { credentialsMatch } = freshSession();
    assert.doesNotThrow(() => credentialsMatch(undefined, undefined));
    assert.doesNotThrow(() => credentialsMatch(null, null));
    assert.doesNotThrow(() => credentialsMatch(42, {}));
    assert.equal(credentialsMatch(undefined, undefined), false);
    assert.equal(credentialsMatch(null, null), false);
  });
});

test('readCookie parses the named cookie out of a header with several cookies', () => {
  const { readCookie, COOKIE_NAME } = freshSession();
  const req = { headers: { cookie: `foo=bar; ${COOKIE_NAME}=abc123; baz=qux` } };
  assert.equal(readCookie(req, COOKIE_NAME), 'abc123');
});

test('readCookie returns null when the cookie is absent or headers missing', () => {
  const { readCookie, COOKIE_NAME } = freshSession();
  assert.equal(readCookie({ headers: { cookie: 'foo=bar' } }, COOKIE_NAME), null);
  assert.equal(readCookie({ headers: {} }, COOKIE_NAME), null);
  assert.equal(readCookie({}, COOKIE_NAME), null);
});

test('hasSession is true only with a currently-valid signed cookie', () => {
  withEnv({ SHOP_EMAIL: 'owner@example.test', SHOP_PASSWORD: 'th-r0waway-pw!', SESSION_SECRET: 'a-secret' }, () => {
    const { sign, hasSession, COOKIE_NAME } = freshSession();
    const token = sign(Date.now() + 60000);
    assert.equal(hasSession({ headers: { cookie: `${COOKIE_NAME}=${token}` } }), true);
    assert.equal(hasSession({ headers: { cookie: `${COOKIE_NAME}=garbage` } }), false);
    assert.equal(hasSession({ headers: {} }), false);
  });
});

test('cookieHeader carries HttpOnly, Secure, SameSite, Path and Max-Age', () => {
  const { cookieHeader, COOKIE_NAME } = freshSession();
  const header = cookieHeader('sometoken', 43200);
  assert.match(header, new RegExp(`^${COOKIE_NAME}=sometoken;`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.match(header, /Max-Age=43200/);
});

test('TTL_SECONDS is 12 hours', () => {
  const { TTL_SECONDS } = freshSession();
  assert.equal(TTL_SECONDS, 43200);
});
