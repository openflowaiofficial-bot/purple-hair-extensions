// test/shop-behaviour.test.js
//
// test/isolation.test.js reads shop.js as text. That catches a redirect being
// ADDED to the unavailable path, but it cannot catch the likelier regression:
// the redirect being hoisted to cover every non-OK status, e.g.
//
//     if (!r.ok) { signedOut(); return null; }
//
// which conflates "you are signed out" with "the catalogue is down" — exactly
// what the auth addendum forbids. Source-text assertions pass straight through
// that mutation. So this file runs shop.js for real, in a vm, against a stub
// DOM, and asserts what the stylist ends up looking at.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SHOP_JS = fs.readFileSync(path.join(ROOT, 'shop.js'), 'utf8');
const Cart = require('../cart.js');

/* --------------------------------------------------------------------------
   A DOM small enough to read, large enough for shop.js.
   -------------------------------------------------------------------------- */
function node(tag) {
  const self = {
    tag,
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    onclick: null,
    attrs: {},
    children: [],
    handlers: {},
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    dispatch(type) { (this.handlers[type] || []).forEach((fn) => fn()); },
    click() { this.dispatch('click'); if (this.onclick) this.onclick(); },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; }
  };
  // Assigning innerHTML = '' is how shop.js empties a row.
  Object.defineProperty(self, 'innerHTML', {
    get() { return ''; },
    set() { self.children.length = 0; }
  });
  return self;
}

const SHOP_KIDS = ['[data-shop-loading]', '[data-shop-down]', '[data-shop-picker]',
  '[data-shop-result]', '[data-shop-chosen]', '[data-shop-price]', '[data-shop-sku]',
  '[data-shop-add]', '[data-pick="collection"]', '[data-pick="color"]', '[data-pick="length"]'];

const DRAWER_KIDS = ['[data-drawer-body]', '[data-drawer-toggle]', '[data-drawer-count]',
  '[data-drawer-list]', '[data-drawer-total]', '[data-drawer-checkout]', '[data-drawer-note]'];

// Same starting state as the real HTML: loading visible, everything else hidden.
function build({ method = 'WFT', withDrawer = false, storage = null } = {}) {
  const kids = {};
  SHOP_KIDS.forEach((s) => { kids[s] = node('div'); });
  ['[data-shop-down]', '[data-shop-picker]', '[data-shop-result]']
    .forEach((s) => { kids[s].hidden = true; });

  const root = node('div');
  root.attrs['data-method'] = method;
  root.querySelector = (s) => kids[s] || null;

  let drawer = null;
  if (withDrawer) {
    DRAWER_KIDS.forEach((s) => { kids[s] = node('div'); });
    kids['[data-drawer-body]'].hidden = true;
    kids['[data-drawer-note]'].hidden = true;
    drawer = node('aside');
    drawer.hidden = true;
    drawer.querySelector = (s) => kids[s] || null;
  }

  const redirects = [];
  const navigations = [];
  const mem = new Map(storage ? [['pce_cart', storage]] : []);

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    document: {
      querySelector(s) {
        if (s === '[data-shop]') return root;
        if (s === '[data-drawer]') return drawer;
        return kids[s] || null;
      },
      createElement: (t) => node(t)
    },
    Cart,
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v)
    },
    location: {
      replace: (u) => redirects.push(u),
      get href() { return navigations[navigations.length - 1] || null; },
      set href(u) { navigations.push(u); }
    },
    // Overwritten per test.
    fetch: () => new Promise(() => {})
  };
  sandbox.window = sandbox;

  return { sandbox, kids, root, drawer, redirects, navigations, mem };
}

function run(ctx) {
  vm.createContext(ctx.sandbox);
  vm.runInContext(SHOP_JS, ctx.sandbox, 'shop.js');
  // Let shop.js's promise chain settle.
  return new Promise((r) => setTimeout(r, 10));
}

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

const CATALOG = {
  variations: [
    { variationId: 'V1', sku: 'PCE-WFT-COF4-1416', method: 'WFT', collection: 'Coffee Collection', color: 'Coffee #4', length: '14"-16"', price: 33500 },
    { variationId: 'V2', sku: 'PCE-WFT-COF4-1820', method: 'WFT', collection: 'Coffee Collection', color: 'Coffee #4', length: '18"-20"', price: 41000 },
    { variationId: 'V3', sku: 'PCE-VOL-COF4-1416', method: 'VOL', collection: 'Coffee Collection', color: 'Coffee #4', length: '14"-16"', price: 52000 }
  ]
};

const view = (ctx) => ({
  redirects: ctx.redirects.slice(),
  loading: !ctx.kids['[data-shop-loading]'].hidden,
  down: !ctx.kids['[data-shop-down]'].hidden,
  picker: !ctx.kids['[data-shop-picker]'].hidden
});

/* --------------------------------------------------------------------------
   The 401-vs-503 split. The whole point of the file.
   -------------------------------------------------------------------------- */
test('401 sends the stylist to the login page and shows no failure block', async () => {
  const ctx = build();
  ctx.sandbox.fetch = () => Promise.resolve(
    res(401, { error: 'Sign in to view the catalogue', reason: 'unauthenticated' }));
  await run(ctx);

  const v = view(ctx);
  assert.deepEqual(v.redirects, ['professional-login.html'], 'a 401 must redirect');
  assert.equal(v.down, false, 'nothing is unavailable — the stylist is simply signed out');
  assert.equal(v.picker, false, 'no picker on a page we are leaving');
});

for (const reason of ['not_configured', 'upstream', 'contract']) {
  test(`503 ${reason} shows the failure block and never redirects`, async () => {
    const ctx = build();
    ctx.sandbox.fetch = () => Promise.resolve(res(503, { error: 'Catalog unavailable', reason }));
    await run(ctx);

    const v = view(ctx);
    assert.deepEqual(v.redirects, [], 'a 503 must not be mistaken for being signed out');
    assert.equal(v.down, true, 'the stylist must be told to email us');
    assert.equal(v.loading, false, 'the loading line must be cleared');
    assert.equal(v.picker, false);
  });
}

test('a network rejection shows the failure block and never redirects', async () => {
  const ctx = build();
  ctx.sandbox.fetch = () => Promise.reject(new Error('offline'));
  await run(ctx);

  assert.deepEqual(ctx.redirects, [], 'a dead network is not a dead session');
  assert.equal(view(ctx).down, true);
});

test('a 500 shows the failure block and never redirects', async () => {
  const ctx = build();
  ctx.sandbox.fetch = () => Promise.resolve(res(500, {}));
  await run(ctx);

  assert.deepEqual(ctx.redirects, []);
  assert.equal(view(ctx).down, true);
});

test('200 renders the picker, with no redirect and no failure block', async () => {
  const ctx = build();
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  const v = view(ctx);
  assert.deepEqual(v.redirects, []);
  assert.equal(v.down, false);
  assert.equal(v.picker, true);
  assert.equal(v.loading, false);
});

/* --------------------------------------------------------------------------
   The configurator itself.
   -------------------------------------------------------------------------- */
const labels = (ctx, field) =>
  ctx.kids[`[data-pick="${field}"]`].children.map((c) => c.textContent);

test('a page only ever offers its own method', async () => {
  const ctx = build({ method: 'WFT' });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);
  // V3 is the VOL row; its length must not appear on the wefts page.
  assert.deepEqual(labels(ctx, 'length'), ['14"-16"', '18"-20"']);

  const vol = build({ method: 'VOL' });
  vol.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(vol);
  assert.deepEqual(labels(vol, 'length'), ['14"-16"']);
});

test('an empty result for this method is a failure, not an empty picker', async () => {
  const ctx = build({ method: 'PLS' });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  assert.equal(view(ctx).down, true);
  assert.equal(view(ctx).picker, false);
  assert.deepEqual(ctx.redirects, []);
});

test('choosing all three renders the price in dollars, from integer cents', async () => {
  const ctx = build();
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  assert.equal(ctx.kids['[data-shop-result]'].hidden, true, 'nothing chosen yet');
  ctx.kids['[data-pick="collection"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="color"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="length"]'].children[1].dispatch('click'); // 18"-20", 41000c

  assert.equal(ctx.kids['[data-shop-result]'].hidden, false);
  assert.equal(ctx.kids['[data-shop-chosen]'].textContent, 'Coffee Collection · Coffee #4 · 18"-20"');
  assert.equal(ctx.kids['[data-shop-price]'].textContent, '$410.00');
  assert.equal(ctx.kids['[data-shop-sku]'].textContent, 'PCE-WFT-COF4-1820');
  assert.equal(ctx.kids['[data-shop-add]'].disabled, false);
});

test('a variation with no price is shown but cannot be added', async () => {
  const ctx = build();
  ctx.sandbox.fetch = () => Promise.resolve(res(200, {
    variations: [{ variationId: 'V9', sku: 'PCE-WFT-X-1416', method: 'WFT',
      collection: 'Coffee Collection', color: 'Coffee #4', length: '14"-16"' }]
  }));
  await run(ctx);

  ctx.kids['[data-pick="collection"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="color"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="length"]'].children[0].dispatch('click');

  assert.equal(ctx.kids['[data-shop-price]'].textContent, 'Price on approved account');
  assert.equal(ctx.kids['[data-shop-add]'].disabled, true);
});

/* --------------------------------------------------------------------------
   The drawer, and what it is allowed to remember.
   -------------------------------------------------------------------------- */
test('adding a bundle stores an id and a quantity, and never a price', async () => {
  const ctx = build({ withDrawer: true });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  ctx.kids['[data-pick="collection"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="color"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="length"]'].children[0].dispatch('click');
  ctx.kids['[data-shop-add]'].click();

  const stored = ctx.mem.get('pce_cart');
  assert.deepEqual(JSON.parse(stored), [{ variationId: 'V1', qty: 1 }]);
  assert.ok(!/price|amount|33500|\$/.test(stored), `no price may be persisted: ${stored}`);

  assert.equal(ctx.drawer.hidden, false);
  assert.equal(ctx.kids['[data-drawer-count]'].textContent, '1');
  assert.match(ctx.kids['[data-drawer-total]'].textContent, /^1 bundle — priced at checkout$/);
});

test('the drawer stays hidden while the order is empty', async () => {
  const ctx = build({ withDrawer: true });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  assert.equal(ctx.drawer.hidden, true);
  assert.equal(ctx.kids['[data-drawer-count]'].textContent, '0');
});

test('a stale row from another page survives as its id rather than throwing', async () => {
  const ctx = build({ withDrawer: true, storage: JSON.stringify([{ variationId: 'GONE', qty: 2 }]) });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  const rows = ctx.kids['[data-drawer-list]'].children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].children[0].textContent, 'GONE × 2');
});

test('Remove drops the row from storage', async () => {
  const ctx = build({ withDrawer: true, storage: JSON.stringify([
    { variationId: 'V1', qty: 1 }, { variationId: 'V2', qty: 3 }]) });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  assert.equal(ctx.kids['[data-drawer-list]'].children.length, 2);
  ctx.kids['[data-drawer-list]'].children[0].children[1].dispatch('click');

  assert.deepEqual(JSON.parse(ctx.mem.get('pce_cart')), [{ variationId: 'V2', qty: 3 }]);
  assert.equal(ctx.kids['[data-drawer-list]'].children.length, 1);
});

test('the drawer toggle tracks aria-expanded', async () => {
  const ctx = build({ withDrawer: true, storage: JSON.stringify([{ variationId: 'V1', qty: 1 }]) });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  const toggle = ctx.kids['[data-drawer-toggle]'];
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.dispatch('click');
  assert.equal(ctx.kids['[data-drawer-body]'].hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('the checkout button is bound once, however often the cart changes', async () => {
  const ctx = build({ withDrawer: true });
  ctx.sandbox.fetch = () => Promise.resolve(res(200, CATALOG));
  await run(ctx);

  // Three cart changes, each of which re-renders the drawer.
  ctx.kids['[data-pick="collection"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="color"]'].children[0].dispatch('click');
  ctx.kids['[data-pick="length"]'].children[0].dispatch('click');
  ctx.kids['[data-shop-add]'].click();
  ctx.kids['[data-shop-add]'].click();
  ctx.kids['[data-shop-add]'].click();

  const handlers = ctx.kids['[data-drawer-checkout]'].handlers.click || [];
  assert.equal(handlers.length, 1, 'one click must never mean N checkout requests');
});
