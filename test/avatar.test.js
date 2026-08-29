// test/avatar.test.js
//
// An upload endpoint is the one place on a site where a stranger hands you
// bytes and asks you to keep them. Three things have to hold:
//
//   * the account comes from the session, never from the request, so nobody
//     can overwrite anyone else's picture;
//   * the file is judged by its bytes, not by what the request called it;
//   * the stored URL is whatever storage returned, never anything the browser
//     supplied.
const { test } = require('node:test');
const assert = require('node:assert');

const avatar = require('../api/avatar.js');
const { inspect, MAX_BYTES } = require('../api/_image.js');
const accountsReal = require('../api/_accounts.js');
const { sign, COOKIE_NAME } = require('../api/_session.js');

// Approval asks Square whether the account's customer is in the professionals
// group. _approval.js reads these off the module at call time, so overriding
// them here stands in for Square across the whole file — rather than threading
// a stub through every deps object.
const groupsModule = require('../api/_groups.js');
const GROUP = 'GRP_PROFESSIONALS';
let membership = new Set([GROUP]);

groupsModule.resolveGroupId = async () => GROUP;
groupsModule.customerById = async (id) => ({ id, group_ids: [...membership] });
groupsModule.customerByEmail = async () => null;

// For the tests that need someone outside it.
function outOfGroup(fn) {
  membership = new Set();
  return Promise.resolve(fn()).finally(() => { membership = new Set([GROUP]); });
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(64, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

const ACCOUNT = { id: 'acct_1', email: 'a@b.com', approved: true,
  squareCustomerId: 'CUST_1', avatarUrl: null, profile: {} };

function fakeAccounts(seed) {
  const a = { ...seed };
  return {
    publicView: accountsReal.publicView,
    async byId(id) { return a.id === id ? a : null; },
    async setAvatar(id, url) { if (a.id !== id) return null; a.avatarUrl = url || null; return a; },
    _record: () => a
  };
}

function fakeBlob() {
  const puts = [];
  const deletes = [];
  return {
    puts, deletes,
    configured: () => true,
    async put(pathname, body, type) {
      puts.push({ pathname, type, bytes: body.length });
      return 'https://blob.example.com/' + pathname + '-abc123';
    },
    async del(url) { deletes.push(url); return true; }
  };
}

const store = { configured: () => true };
const cookie = (sub) => ({ cookie: `${COOKIE_NAME}=${sign(Date.now() + 60000, sub)}` });
const req = (over) => ({ method: 'POST', headers: {}, body: undefined, ...over });

/* --- what counts as an image -------------------------------------------- */

test('a JPEG, a PNG and a WebP are recognised by their bytes', () => {
  assert.equal(inspect(JPEG).type, 'image/jpeg');
  assert.equal(inspect(PNG).type, 'image/png');
  assert.equal(inspect(WEBP).type, 'image/webp');
});

test('an SVG is refused however it is labelled', () => {
  const check = inspect(SVG);
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'unsupported_type');
});

test('HTML wearing an image name is refused', () => {
  assert.equal(inspect(HTML).ok, false);
});

test('an oversized file is refused before anything else looks at it', () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_BYTES + 1)]);
  assert.equal(inspect(big).reason, 'too_large');
});

/* --- the endpoint -------------------------------------------------------- */

test('no session is 401', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await avatar(req({ headers: {}, body: JPEG }), r,
      { store, blob: fakeBlob(), accounts: fakeAccounts(ACCOUNT) });
    assert.equal(r.out.code, 401);
  });
});

test('the shared wholesale login has no picture to change', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    // A session with no subject: signed in, but not as anybody.
    await avatar(req({ headers: { cookie: `${COOKIE_NAME}=${sign(Date.now() + 60000)}` }, body: JPEG }), r,
      { store, blob: fakeBlob(), accounts: fakeAccounts(ACCOUNT) });
    assert.equal(r.out.code, 403);
    assert.equal(r.out.body.reason, 'no_account');
  });
});

test('an upload is stored under the session account, not anything sent', async () => {
  await withEnv(CONFIGURED, async () => {
    const blob = fakeBlob();
    const dir = fakeAccounts(ACCOUNT);
    const r = res();
    await avatar(req({
      headers: cookie('acct_1'),
      body: JPEG,
      // All of this is noise the handler must ignore.
      query: { id: 'acct_victim', pathname: '../../evil' }
    }), r, { store, blob, accounts: dir });

    assert.equal(r.out.code, 200);
    assert.equal(blob.puts.length, 1);
    assert.equal(blob.puts[0].pathname, 'avatars/acct_1.jpg');
    assert.equal(blob.puts[0].type, 'image/jpeg');
    assert.equal(dir._record().avatarUrl, r.out.body.avatarUrl);
  });
});

test('the stored URL is the one storage returned', async () => {
  await withEnv(CONFIGURED, async () => {
    const blob = fakeBlob();
    const dir = fakeAccounts(ACCOUNT);
    const r = res();
    await avatar(req({
      headers: cookie('acct_1'),
      body: PNG,
      avatarUrl: 'https://attacker.example.com/pixel.png'
    }), r, { store, blob, accounts: dir });

    assert.match(r.out.body.avatarUrl, /^https:\/\/blob\.example\.com\//);
    assert.ok(!dir._record().avatarUrl.includes('attacker'));
  });
});

test('an SVG upload is refused by the endpoint, and nothing is stored', async () => {
  await withEnv(CONFIGURED, async () => {
    const blob = fakeBlob();
    const r = res();
    await avatar(req({ headers: cookie('acct_1'), body: SVG }), r,
      { store, blob, accounts: fakeAccounts(ACCOUNT) });
    assert.equal(r.out.code, 400);
    assert.equal(blob.puts.length, 0, 'nothing reaches storage');
  });
});

test('replacing a picture deletes the one it replaced', async () => {
  await withEnv(CONFIGURED, async () => {
    const blob = fakeBlob();
    const dir = fakeAccounts({ ...ACCOUNT, avatarUrl: 'https://blob.example.com/avatars/acct_1.jpg-old' });
    const r = res();
    await avatar(req({ headers: cookie('acct_1'), body: JPEG }), r,
      { store, blob, accounts: dir });
    assert.equal(r.out.code, 200);
    assert.deepEqual(blob.deletes, ['https://blob.example.com/avatars/acct_1.jpg-old']);
  });
});

test('storage failing does not leave the account pointing at nothing', async () => {
  await withEnv(CONFIGURED, async () => {
    const dir = fakeAccounts({ ...ACCOUNT, avatarUrl: 'https://blob.example.com/keep-me' });
    const failing = {
      configured: () => true,
      async put() { throw new Error('blob_http_500'); },
      async del() { throw new Error('should not be called'); }
    };
    const r = res();
    await avatar(req({ headers: cookie('acct_1'), body: JPEG }), r,
      { store, blob: failing, accounts: dir });
    assert.equal(r.out.code, 503);
    assert.equal(dir._record().avatarUrl, 'https://blob.example.com/keep-me',
      'the old picture survives a failed replacement');
  });
});

test('DELETE removes the picture and the stored file', async () => {
  await withEnv(CONFIGURED, async () => {
    const blob = fakeBlob();
    const dir = fakeAccounts({ ...ACCOUNT, avatarUrl: 'https://blob.example.com/avatars/acct_1.jpg-old' });
    const r = res();
    await avatar(req({ method: 'DELETE', headers: cookie('acct_1') }), r,
      { store, blob, accounts: dir });
    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.avatarUrl, null);
    assert.equal(dir._record().avatarUrl, null);
    assert.deepEqual(blob.deletes, ['https://blob.example.com/avatars/acct_1.jpg-old']);
  });
});

test('blob storage unconfigured is 503, not a silent success', async () => {
  await withEnv(CONFIGURED, async () => {
    const r = res();
    await avatar(req({ headers: cookie('acct_1'), body: JPEG }), r, {
      store, accounts: fakeAccounts(ACCOUNT),
      blob: { configured: () => false, put: async () => 'x', del: async () => true }
    });
    assert.equal(r.out.code, 503);
    assert.equal(r.out.body.reason, 'not_configured');
  });
});

test('a professional removed from the group cannot change their picture', async () => {
  await withEnv(CONFIGURED, async () => {
    const blob = fakeBlob();
    const r = res();
    await outOfGroup(() => avatar(req({ headers: cookie('acct_1'), body: JPEG }), r,
      { store, blob, accounts: fakeAccounts(ACCOUNT) }));
    assert.equal(r.out.code, 403);
    assert.equal(blob.puts.length, 0, 'nothing reaches storage');
  });
});

test('avatarUrl cannot be smuggled in through the profile form', () => {
  const cleaned = accountsReal.sanitiseProfile({
    salonName: 'Fine', avatarUrl: 'https://attacker.example.com/pixel.png'
  });
  assert.equal(cleaned.salonName, 'Fine');
  assert.ok(!('avatarUrl' in cleaned), 'avatarUrl is not an editable profile field');
});
