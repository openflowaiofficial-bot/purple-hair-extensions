// test/enrolment.test.js
//
// The two ends of the class pipeline.
//
// The webhook is a public URL that can create Square customers, so the tests
// that matter most are the ones proving an unsigned request cannot. The
// invitation job can email every professional at once, so the ones that matter
// there are about never emailing the same person twice.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const webhook = require('../api/square-webhook.js');
const invite = require('../api/invite-certified.js');

function res() {
  const out = { code: null, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.code = c; return this; },
    json(b) { out.body = b; return this; }
  };
}

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

const KEY = 'webhook-signature-key';
const URL = 'https://example.com/api/square-webhook';
const CLASS_ID = 'CATALOG_CLASS_1';

const WEBHOOK_ENV = {
  SQUARE_WEBHOOK_SIGNATURE_KEY: KEY,
  SQUARE_WEBHOOK_URL: URL,
  SQUARE_CLASS_CATALOG_IDS: CLASS_ID,
  SQUARE_ACCESS_TOKEN: 'sq-test'
};

function sign(body) {
  return crypto.createHmac('sha256', KEY).update(URL + body).digest('base64');
}

function paymentEvent(over) {
  return JSON.stringify({
    type: 'payment.created',
    data: { object: { payment: {
      id: 'PAY_1', status: 'COMPLETED', order_id: 'ORD_1',
      buyer_email_address: 'student@salon.com', ...over
    } } }
  });
}

function req(body, over) {
  return {
    method: 'POST',
    headers: { 'x-square-hmacsha256-signature': sign(body) },
    rawBody: body,
    ...over
  };
}

function fakeStore(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    data,
    configured: () => true,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async set(k, v) { data.set(k, v); },
    async setWithTtl(k, v) { data.set(k, v); },
    async del(k) { data.delete(k); }
  };
}

function fakeGroups(over) {
  const added = [];
  const created = [];
  return {
    added, created,
    groupName: () => 'Certified Stylists/Salon Partners',
    pendingGroupName: () => 'Class attendees/pending approval',
    resolveGroupId: async () => 'GRP_PRO',
    resolvePendingGroupId: async () => 'GRP_PENDING',
    customerByEmail: async () => null,
    createCustomer: async (f) => { created.push(f); return { id: 'CUST_NEW', email_address: f.email }; },
    addToGroup: async (cid, gid) => { added.push([cid, gid]); return {}; },
    listGroupMembers: async () => [],
    ...over
  };
}

const classOrder = async () => ({ order: { line_items: [{ catalog_object_id: CLASS_ID }] } });
const hairOrder = async () => ({ order: { line_items: [{ catalog_object_id: 'CATALOG_WEFT' }] } });

/* --- the webhook is a public URL ---------------------------------------- */

test('an unsigned request enrols nobody', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const body = paymentEvent();
    const groups = fakeGroups();
    const r = res();
    await webhook({ method: 'POST', headers: {}, rawBody: body }, r,
      { groups, store: fakeStore(), call: classOrder });
    assert.equal(r.out.code, 401);
    assert.equal(groups.added.length, 0);
    assert.equal(groups.created.length, 0);
  });
});

test('a request signed with the wrong key enrols nobody', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const body = paymentEvent();
    const wrong = crypto.createHmac('sha256', 'not-the-key').update(URL + body).digest('base64');
    const groups = fakeGroups();
    const r = res();
    await webhook({ method: 'POST', headers: { 'x-square-hmacsha256-signature': wrong }, rawBody: body },
      r, { groups, store: fakeStore(), call: classOrder });
    assert.equal(r.out.code, 401);
    assert.equal(groups.added.length, 0);
  });
});

test('a body altered after signing is refused', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const original = paymentEvent();
    const tampered = paymentEvent({ buyer_email_address: 'attacker@example.com' });
    const groups = fakeGroups();
    const r = res();
    await webhook({ method: 'POST',
      headers: { 'x-square-hmacsha256-signature': sign(original) }, rawBody: tampered },
      r, { groups, store: fakeStore(), call: classOrder });
    assert.equal(r.out.code, 401);
    assert.equal(groups.created.length, 0);
  });
});

test('with no signature key configured the endpoint does nothing', async () => {
  await withEnv({ ...WEBHOOK_ENV, SQUARE_WEBHOOK_SIGNATURE_KEY: undefined }, async () => {
    const r = res();
    await webhook(req(paymentEvent()), r, { groups: fakeGroups(), store: fakeStore(), call: classOrder });
    assert.equal(r.out.code, 503);
  });
});

/* --- what it does with a real one --------------------------------------- */

test('a class purchase creates a customer in the pending group', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const body = paymentEvent();
    const groups = fakeGroups();
    const r = res();
    await webhook(req(body), r, { groups, store: fakeStore(), call: classOrder });

    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.enrolled, true);
    assert.equal(groups.created[0].email, 'student@salon.com');
    assert.deepEqual(groups.added, [['CUST_NEW', 'GRP_PENDING']],
      'pending group only — never the professionals group');
  });
});

test('the webhook can never add anyone to the professionals group', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const groups = fakeGroups();
    await webhook(req(paymentEvent()), res(), { groups, store: fakeStore(), call: classOrder });
    assert.ok(!groups.added.some(([, gid]) => gid === 'GRP_PRO'),
      'buying a class must not grant professional access');
  });
});

test('an existing customer is reused rather than duplicated', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const groups = fakeGroups({
      customerByEmail: async () => ({ id: 'CUST_EXISTING', email_address: 'student@salon.com' })
    });
    const r = res();
    await webhook(req(paymentEvent()), r, { groups, store: fakeStore(), call: classOrder });
    assert.equal(groups.created.length, 0);
    assert.deepEqual(groups.added, [['CUST_EXISTING', 'GRP_PENDING']]);
  });
});

test('buying hair is not buying a class', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const groups = fakeGroups();
    const r = res();
    await webhook(req(paymentEvent()), r, { groups, store: fakeStore(), call: hairOrder });
    assert.equal(r.out.body.ignored, 'not_a_class');
    assert.equal(groups.added.length, 0);
  });
});

test('with no class ids configured it enrols nobody', async () => {
  await withEnv({ ...WEBHOOK_ENV, SQUARE_CLASS_CATALOG_IDS: undefined }, async () => {
    const groups = fakeGroups();
    const r = res();
    await webhook(req(paymentEvent()), r, { groups, store: fakeStore(), call: classOrder });
    assert.equal(r.out.body.ignored, 'not_configured');
    assert.equal(groups.added.length, 0, 'it must not guess which purchase was a class');
  });
});

test('the same payment delivered twice enrols once', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const groups = fakeGroups();
    const store = fakeStore();
    const body = paymentEvent();
    await webhook(req(body), res(), { groups, store, call: classOrder });
    const second = res();
    await webhook(req(body), second, { groups, store, call: classOrder });
    assert.equal(second.out.body.ignored, 'already_seen');
    assert.equal(groups.added.length, 1);
  });
});

test('an incomplete payment is ignored', async () => {
  await withEnv(WEBHOOK_ENV, async () => {
    const groups = fakeGroups();
    const r = res();
    await webhook(req(paymentEvent({ status: 'PENDING' })), r,
      { groups, store: fakeStore(), call: classOrder });
    assert.equal(r.out.body.ignored, 'not_completed');
    assert.equal(groups.added.length, 0);
  });
});

/* --- the invitation job -------------------------------------------------- */

const INVITE_ENV = {
  CRON_SECRET: 'cron-secret-value',
  SQUARE_ACCESS_TOKEN: 'sq-test',
  SITE_ORIGIN: 'https://example.com'
};

function fakeMail() {
  const sent = [];
  return { sent, configured: () => true, async send(m) { sent.push(m); return true; } };
}

const cronReq = (over) => ({
  method: 'POST',
  headers: { authorization: 'Bearer cron-secret-value' },
  ...over
});

const MEMBERS = [
  { id: 'CUST_A', email_address: 'a@salon.com' },
  { id: 'CUST_B', email_address: 'b@salon.com' }
];

test('an unauthorised call emails nobody', async () => {
  await withEnv(INVITE_ENV, async () => {
    const mail = fakeMail();
    const r = res();
    await invite({ method: 'POST', headers: {} }, r, {
      groups: fakeGroups({ listGroupMembers: async () => MEMBERS }),
      store: fakeStore(), mail
    });
    assert.equal(r.out.code, 401);
    assert.equal(mail.sent.length, 0);
  });
});

test('a wrong cron secret emails nobody', async () => {
  await withEnv(INVITE_ENV, async () => {
    const mail = fakeMail();
    const r = res();
    await invite(cronReq({ headers: { authorization: 'Bearer wrong' } }), r, {
      groups: fakeGroups({ listGroupMembers: async () => MEMBERS }),
      store: fakeStore(), mail
    });
    assert.equal(r.out.code, 401);
    assert.equal(mail.sent.length, 0);
  });
});

test('newly certified professionals are invited', async () => {
  await withEnv(INVITE_ENV, async () => {
    const mail = fakeMail();
    const r = res();
    await invite(cronReq(), r, {
      groups: fakeGroups({ listGroupMembers: async () => MEMBERS }),
      store: fakeStore(), mail
    });
    assert.equal(r.out.body.invited, 2);
    assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['a@salon.com', 'b@salon.com']);
    assert.match(mail.sent[0].text, /https:\/\/example\.com\/professional-login\.html/);
  });
});

test('nobody is invited twice, however often the job runs', async () => {
  await withEnv(INVITE_ENV, async () => {
    const mail = fakeMail();
    const store = fakeStore();
    const deps = {
      groups: fakeGroups({ listGroupMembers: async () => MEMBERS }), store, mail
    };
    await invite(cronReq(), res(), deps);
    await invite(cronReq(), res(), deps);
    const third = res();
    await invite(cronReq(), third, deps);

    assert.equal(mail.sent.length, 2, 'two people, two emails, three runs');
    assert.equal(third.out.body.invited, 0);
    assert.equal(third.out.body.skipped, 2);
  });
});

test('someone added to the group later is invited on the next run', async () => {
  await withEnv(INVITE_ENV, async () => {
    const mail = fakeMail();
    const store = fakeStore();
    let members = [MEMBERS[0]];
    const deps = {
      groups: fakeGroups({ listGroupMembers: async () => members }), store, mail
    };
    await invite(cronReq(), res(), deps);
    assert.equal(mail.sent.length, 1);

    members = MEMBERS;
    const r = res();
    await invite(cronReq(), r, deps);
    assert.equal(r.out.body.invited, 1, 'only the new one');
    assert.equal(mail.sent.length, 2);
    assert.equal(mail.sent[1].to, 'b@salon.com');
  });
});

test('a member with no email is skipped, not crashed on', async () => {
  await withEnv(INVITE_ENV, async () => {
    const mail = fakeMail();
    const r = res();
    await invite(cronReq(), r, {
      groups: fakeGroups({ listGroupMembers: async () => [{ id: 'CUST_C' }] }),
      store: fakeStore(), mail
    });
    assert.equal(r.out.code, 200);
    assert.equal(r.out.body.invited, 0);
    assert.equal(r.out.body.skipped, 1);
  });
});

test('the invitation is recorded before it is sent', async () => {
  await withEnv(INVITE_ENV, async () => {
    const store = fakeStore();
    // A mailer that always fails: the flag must still be set, so a broken
    // provider cannot turn one invitation into an unbounded retry loop.
    const failing = { configured: () => true, async send() { throw new Error('smtp'); } };
    const r = res();
    await invite(cronReq(), r, {
      groups: fakeGroups({ listGroupMembers: async () => [MEMBERS[0]] }),
      store, mail: failing
    });
    assert.ok(store.data.has(invite.INVITE_KEY('CUST_A')),
      'the flag is written even when the send fails');
    assert.equal(r.out.body.problems, 1, 'and the failure is reported, not swallowed');
  });
});
