# Square-Backed Wholesale Shop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three configurator pages on the existing static site that read the live Square catalog at the wholesale location and hand a multi-item order off to a Square-hosted checkout.

**Architecture:** Two Vercel Node functions (`api/catalog.js`, `api/checkout.js`) hold the Square token server-side; the browser gets a shaped variation list with no secrets. Pure logic (contract validation, response shaping, cart) lives in dependency-free CommonJS modules that `node --test` can exercise directly. The three pages share one `shop.js`; the five existing pages never reference it.

**Tech Stack:** Plain HTML/CSS/JS, no framework, no bundler, no npm dependencies. Node 24 (Vercel default) for functions and for `node --test`. Square Catalog API and Online Checkout Payment Links API.

**Spec:** `docs/superpowers/specs/2026-08-26-square-shop-design.md`

## Global Constraints

- **No build step. No npm dependencies.** There is no `package.json` and none is to be added — adding one risks flipping Vercel out of static mode. All modules are CommonJS (`module.exports`), which is Node's default for `.js` without a package type.
- **Node 24.x** — the Vercel project reports `framework: null`, `nodeVersion: 24.x`.
- **Wholesale location is `L0MRDCWWBFR3Z`.** Never read or write the Purple Chair retail location.
- **Catalog scope is SKU prefix `PCE-`.** Verified 2026-08-26: zero pre-existing Square items use that prefix; legacy items use numeric barcodes. Any variation whose SKU does not start with `PCE-` is not ours and is dropped.
- **The contract is 5 items / 121 variations**, split 20/27/20/27/27.
- **Prices never enter browser storage.** The cart holds `{variationId, qty}` only. Square prices the order at checkout.
- **The token never reaches the browser.** No secret in any `.html`, `.js` served to the client, or API response.
- **Primary nav stays exactly five items** — Home, Who We Are, Become Certified, Professional Login, Contact. The client brief fixes this. Configurators are reached from `professional-login.html` and from each other, never by adding a sixth nav item.
- **Visual rules** (from `purple-crown-design-direction`): ivory `#f8f4ed` ground, near-black `#131013`, amethyst `#5a2d6e` as accent only, Bodoni Moda headlines, Jost body, **no monospace**, no rounded cards, no gradients as filler.
- **Env vars:** `SQUARE_ACCESS_TOKEN` (required), `SQUARE_LOCATION_ID` (default `L0MRDCWWBFR3Z`), `SQUARE_API_BASE` (default `https://connect.squareup.com`; sandbox is `https://connect.squareupsandbox.com`), `SQUARE_VERSION` (default `2025-01-23`).

---

## File Structure

| File | Responsibility |
|---|---|
| `api/_contract.js` | The 121-variation contract and its validator. Pure. |
| `api/_shape.js` | Square catalog response → `variations[]`. Pure. |
| `api/_square.js` | Config + the single `fetch` wrapper that talks to Square. |
| `api/catalog.js` | Route: fetch, shape, validate, cache, serve. |
| `api/checkout.js` | Route: cart → Square payment link. |
| `cart.js` | Pure cart logic over injected storage. UMD-shimmed so both the browser and `node --test` can load it. |
| `shop.js` | Browser: configurator DOM, fetch, order drawer. Loaded only by the three shop pages. |
| `wefts.html`, `volume-wefts.html`, `plus-lace-wefts.html` | The three pages. Identical but for one `data-method` value. |
| `styles.css` | Appended shop styles. No existing rule is edited. |
| `test/*.test.js` | `node --test` suites. |
| `test/fixtures/` | A Square-shaped fixture built from `build_catalog.py`'s CSV. |

Files prefixed `_` inside `api/` are excluded from routing by Vercel, so they are importable helpers rather than endpoints.

---

### Task 1: The contract and its validator

**Files:**
- Create: `api/_contract.js`
- Create: `test/contract.test.js`
- Create: `test/fixtures/build-fixture.js`
- Create: `test/fixtures/square-catalog.json` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `EXPECTED = {items: 5, variations: 121, perItem: {...}}`, `COLORS`, `LENGTHS`, and `validate(variations) -> {ok: boolean, problems: string[]}`.

- [ ] **Step 1: Generate the fixture from the known-good catalog**

`test/fixtures/build-fixture.js` reads the CSV that `~/purple-crown-catalog/build_catalog.py` emits and writes a Square-shaped `square-catalog.json`. Run it once and commit the output.

```js
// Usage: node test/fixtures/build-fixture.js ~/purple-crown-catalog/purple-crown-catalog.csv
const fs = require('fs');

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1)
  .map(line => {
    // naive CSV split that respects double-quoted fields
    const out = []; let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });

const items = new Map();
for (const r of rows) {
  const [sku, itemName, , , , collection, color, , length, , wholesale] = r;
  if (!items.has(itemName)) items.set(itemName, []);
  items.get(itemName).push({
    type: 'ITEM_VARIATION',
    id: 'VAR_' + sku,
    item_variation_data: {
      sku,
      name: `${color} | ${length}`,
      location_overrides: [{
        location_id: 'L0MRDCWWBFR3Z',
        price_money: { amount: Math.round(parseFloat(wholesale) * 100), currency: 'USD' }
      }],
      item_option_values: [
        { item_option_id: 'OPT_COLOR', item_option_value_id: 'VAL_' + color },
        { item_option_id: 'OPT_LENGTH', item_option_value_id: 'VAL_' + length }
      ]
    },
    _collection: collection, _color: color, _length: length
  });
}

const objects = [...items].map(([name, variations]) => ({
  type: 'ITEM', id: 'ITEM_' + name.replace(/\W+/g, '_'),
  item_data: { name, variations }
}));

fs.writeFileSync(__dirname + '/square-catalog.json', JSON.stringify({ objects }, null, 2));
console.log('items', objects.length, 'variations', rows.length);
```

Run: `node test/fixtures/build-fixture.js ~/purple-crown-catalog/purple-crown-catalog.csv`
Expected: `items 5 variations 121`

- [ ] **Step 2: Write the failing test**

```js
// test/contract.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { validate } = require('../api/_contract.js');

const good = require('./fixtures/square-catalog.json').objects
  .flatMap(i => i.item_data.variations.map(v => ({
    sku: v.item_variation_data.sku,
    method: v.item_variation_data.sku.split('-')[1],
    collection: v._collection, color: v._color, length: v._length,
    price: v.item_variation_data.location_overrides[0].price_money.amount
  })));

test('the real catalog passes', () => {
  assert.deepEqual(validate(good), { ok: true, problems: [] });
});

test('a missing variation fails on count', () => {
  const r = validate(good.slice(0, 120));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(' '), /121/);
});

test('Plus Lace in a single colour fails', () => {
  const bad = good.concat([{ sku: 'PCE-PLS-BRT-1416', method: 'PLS',
    collection: 'Single Colors', color: 'Brittany', length: '14"-16"', price: 1 }]);
  assert.match(validate(bad).problems.join(' '), /Plus Lace/);
});

test('a Coffee 27"-29" fails', () => {
  const bad = good.concat([{ sku: 'PCE-WFT-CHL-2729', method: 'WFT',
    collection: 'Coffee Collection', color: 'Chai Latte', length: '27"-29"', price: 1 }]);
  assert.match(validate(bad).problems.join(' '), /27/);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/contract.test.js`
Expected: FAIL — `Cannot find module '../api/_contract.js'`

- [ ] **Step 4: Write the validator**

```js
// api/_contract.js
const SINGLE = ['Brittany', 'Margo', 'Amber', 'Jayla', 'Jade'];
const COFFEE = ['Chai Latte', 'French Vanilla', 'Cafe Latte', 'Toasted Hazelnut',
  'Cappuccino', 'Caramel Macchiato', 'Pumpkin Spice', 'Peppermint Mocha', 'Espresso Bean'];
const LENGTHS = ['14"-16"', '18"-20"', '22"-24"', '27"-29"'];
const EXPECTED_VARIATIONS = 121;
const EXPECTED_ITEMS = 5;

function validate(variations) {
  const problems = [];
  if (variations.length !== EXPECTED_VARIATIONS) {
    problems.push(`expected ${EXPECTED_VARIATIONS} variations, got ${variations.length}`);
  }
  const skus = new Set(variations.map(v => v.sku));
  if (skus.size !== variations.length) problems.push('duplicate SKUs');

  for (const v of variations) {
    if (v.method === 'PLS' && v.collection !== 'Coffee Collection') {
      problems.push(`Plus Lace outside Coffee Collection: ${v.sku}`);
    }
    if (v.length === '27"-29"' && v.collection !== 'Single Colors') {
      problems.push(`27"-29" outside Single Colors: ${v.sku}`);
    }
    if (v.length === '27"-29"' && v.method === 'PLS') {
      problems.push(`Plus Lace at 27"-29": ${v.sku}`);
    }
    if (!Number.isInteger(v.price) || v.price <= 0) {
      problems.push(`missing or bad price: ${v.sku}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { validate, SINGLE, COFFEE, LENGTHS, EXPECTED_ITEMS, EXPECTED_VARIATIONS };
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test test/contract.test.js`
Expected: PASS, 4/4

- [ ] **Step 6: Commit**

```bash
git add api/_contract.js test/contract.test.js test/fixtures/
git commit -m "Add the 121-variation catalog contract and its validator"
```

---

### Task 2: Shaping Square's response

**Files:**
- Create: `api/_shape.js`
- Create: `test/shape.test.js`

**Interfaces:**
- Consumes: `test/fixtures/square-catalog.json` from Task 1.
- Produces: `shape(squareBody, locationId) -> variations[]`, each `{variationId, sku, method, collection, color, length, price}` where `price` is an integer of cents.

- [ ] **Step 1: Write the failing test**

```js
// test/shape.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { shape } = require('../api/_shape.js');
const body = require('./fixtures/square-catalog.json');

test('shapes all 121 of ours', () => {
  assert.equal(shape(body, 'L0MRDCWWBFR3Z').length, 121);
});

test('takes the wholesale location price', () => {
  const v = shape(body, 'L0MRDCWWBFR3Z').find(x => x.sku === 'PCE-WFT-AMB-2224');
  assert.equal(v.price, 33500);
  assert.equal(v.method, 'WFT');
});

test('drops anything without a PCE- SKU', () => {
  const dirty = { objects: body.objects.concat([{
    type: 'ITEM', id: 'ITEM_CLIP', item_data: { name: 'Clip In Sets', variations: [
      { type: 'ITEM_VARIATION', id: 'VAR_CLIP', item_variation_data: {
        sku: '1178054', name: '16" / Beth',
        location_overrides: [{ location_id: 'L0MRDCWWBFR3Z',
          price_money: { amount: 39900, currency: 'USD' } }] } }] } }]) };
  assert.equal(shape(dirty, 'L0MRDCWWBFR3Z').length, 121);
});

test('drops a variation with no price at our location', () => {
  const clone = JSON.parse(JSON.stringify(body));
  clone.objects[0].item_data.variations[0].item_variation_data.location_overrides = [];
  assert.equal(shape(clone, 'L0MRDCWWBFR3Z').length, 120);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/shape.test.js`
Expected: FAIL — `Cannot find module '../api/_shape.js'`

- [ ] **Step 3: Write the shaper**

Collection, colour and length come from the variation name our import wrote (`"Amber | 22\"-24\""`) plus the SKU's method code. The SKU is the stable key; the name is display.

```js
// api/_shape.js
const { COFFEE } = require('./_contract.js');

function priceAt(variationData, locationId) {
  const override = (variationData.location_overrides || [])
    .find(o => o.location_id === locationId);
  const money = override && override.price_money;
  return money && Number.isInteger(money.amount) ? money.amount : null;
}

function shape(body, locationId) {
  const out = [];
  for (const obj of body.objects || []) {
    if (obj.type !== 'ITEM') continue;
    for (const v of (obj.item_data && obj.item_data.variations) || []) {
      const d = v.item_variation_data || {};
      if (!d.sku || !d.sku.startsWith('PCE-')) continue;

      const price = priceAt(d, locationId);
      if (price === null) continue;

      const [, method] = d.sku.split('-');
      const [color, length] = String(d.name || '').split('|').map(s => s.trim());
      if (!color || !length) continue;

      out.push({
        variationId: v.id,
        sku: d.sku,
        method,
        collection: COFFEE.includes(color) ? 'Coffee Collection' : 'Single Colors',
        color,
        length,
        price
      });
    }
  }
  return out;
}

module.exports = { shape };
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/shape.test.js`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add api/_shape.js test/shape.test.js
git commit -m "Shape Square catalog responses into wholesale variations"
```

---

### Task 3: The catalog endpoint

**Files:**
- Create: `api/_square.js`
- Create: `api/catalog.js`
- Create: `test/catalog.test.js`

**Interfaces:**
- Consumes: `shape` (Task 2), `validate` (Task 1).
- Produces: `GET /api/catalog` → `200 {variations: [...]}`, or `503 {error, reason}`. Reasons are exactly `not_configured`, `upstream`, `contract`.

- [ ] **Step 1: Write the failing test**

`handler` takes `(req, res)`; the test passes fakes, so no HTTP server is needed.

```js
// test/catalog.test.js
const { test } = require('node:test');
const assert = require('node:assert');

function fakeRes() {
  return { code: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; } };
}

test('says not_configured with no token', async () => {
  delete process.env.SQUARE_ACCESS_TOKEN;
  const handler = require('../api/catalog.js');
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.reason, 'not_configured');
});

test('never leaks the token into the response', async () => {
  process.env.SQUARE_ACCESS_TOKEN = 'sq0atp-SECRETVALUE';
  const handler = require('../api/catalog.js');
  const res = fakeRes();
  await handler({ method: 'GET' }, res, async () => { throw new Error('boom'); });
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes('SECRETVALUE'));
});

test('refuses to serve a catalog that breaks the contract', async () => {
  process.env.SQUARE_ACCESS_TOKEN = 'sq0atp-x';
  const body = require('./fixtures/square-catalog.json');
  const short = { objects: body.objects.slice(0, 2) };
  const handler = require('../api/catalog.js');
  const res = fakeRes();
  await handler({ method: 'GET' }, res, async () => short);
  assert.equal(res.code, 503);
  assert.equal(res.body.reason, 'contract');
});

test('serves 121 shaped variations from a good response', async () => {
  process.env.SQUARE_ACCESS_TOKEN = 'sq0atp-x';
  const body = require('./fixtures/square-catalog.json');
  const handler = require('../api/catalog.js');
  const res = fakeRes();
  await handler({ method: 'GET' }, res, async () => body);
  assert.equal(res.code, 200);
  assert.equal(res.body.variations.length, 121);
  assert.ok(!('token' in res.body));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/catalog.test.js`
Expected: FAIL — `Cannot find module '../api/_square.js'`

- [ ] **Step 3: Write the Square client**

```js
// api/_square.js
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'L0MRDCWWBFR3Z';
const API_BASE = process.env.SQUARE_API_BASE || 'https://connect.squareup.com';
const VERSION = process.env.SQUARE_VERSION || '2025-01-23';

function token() { return process.env.SQUARE_ACCESS_TOKEN || ''; }

async function call(path, options) {
  const res = await fetch(API_BASE + path, {
    method: (options && options.method) || 'GET',
    headers: {
      'Square-Version': VERSION,
      'Authorization': 'Bearer ' + token(),
      'Content-Type': 'application/json'
    },
    body: options && options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    // Never include the response body verbatim — it can echo request headers.
    throw new Error('square_http_' + res.status);
  }
  return res.json();
}

// Every ITEM in the library, with variations. Filtering to PCE- happens in _shape.
async function fetchCatalog() {
  return call('/v2/catalog/list?types=ITEM');
}

module.exports = { call, fetchCatalog, LOCATION_ID, token };
```

- [ ] **Step 4: Write the route**

The third argument is a seam for tests only; Vercel calls the handler with two.

```js
// api/catalog.js
const { fetchCatalog, LOCATION_ID, token } = require('./_square.js');
const { shape } = require('./_shape.js');
const { validate } = require('./_contract.js');

module.exports = async function handler(req, res, fetcher) {
  if (!token()) {
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'not_configured' });
  }

  let body;
  try {
    body = await (fetcher || fetchCatalog)();
  } catch (err) {
    console.error('catalog upstream failed:', err.message);
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'upstream' });
  }

  const variations = shape(body, LOCATION_ID);
  const check = validate(variations);
  if (!check.ok) {
    console.error('catalog contract broken:', check.problems.join('; '));
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'contract' });
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=60');
  return res.status(200).json({ variations });
};
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test test/catalog.test.js`
Expected: PASS, 4/4

- [ ] **Step 6: Run the whole suite**

Run: `node --test test/`
Expected: PASS, 12/12

- [ ] **Step 7: Commit**

```bash
git add api/_square.js api/catalog.js test/catalog.test.js
git commit -m "Serve the wholesale catalog, refusing anything off-contract"
```

---

### Task 4: The cart

**Files:**
- Create: `cart.js`
- Create: `test/cart.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: global `Cart` in the browser, `module.exports` in Node. Methods `read(storage)`, `add(storage, variationId, qty)`, `setQty(storage, variationId, qty)`, `remove(storage, variationId)`, `clear(storage)`. All return the current array of `{variationId, qty}`.

- [ ] **Step 1: Write the failing test**

```js
// test/cart.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const Cart = require('../cart.js');

function mem(seed) {
  const m = new Map(seed ? [['pce_cart', seed]] : []);
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v),
           removeItem: k => m.delete(k) };
}

test('starts empty', () => assert.deepEqual(Cart.read(mem()), []));

test('adds and accumulates the same variation', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 1);
  assert.deepEqual(Cart.add(s, 'VAR_A', 2), [{ variationId: 'VAR_A', qty: 3 }]);
});

test('never persists a price even if handed one', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 1, { price: 33500 });
  assert.ok(!s.getItem('pce_cart').includes('33500'));
  assert.deepEqual(Object.keys(Cart.read(s)[0]).sort(), ['qty', 'variationId']);
});

test('survives corrupt storage', () => {
  assert.deepEqual(Cart.read(mem('{not json')), []);
  assert.deepEqual(Cart.read(mem('{"variationId":"x"}')), []);
  assert.deepEqual(Cart.read(mem('[{"qty":2}]')), []);
});

test('removing and clearing', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 1); Cart.add(s, 'VAR_B', 1);
  assert.deepEqual(Cart.remove(s, 'VAR_A'), [{ variationId: 'VAR_B', qty: 1 }]);
  assert.deepEqual(Cart.clear(s), []);
});

test('quantity is clamped to a sane range', () => {
  const s = mem();
  Cart.add(s, 'VAR_A', 999);
  assert.equal(Cart.read(s)[0].qty, 99);
  assert.deepEqual(Cart.setQty(s, 'VAR_A', 0), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/cart.test.js`
Expected: FAIL — `Cannot find module '../cart.js'`

- [ ] **Step 3: Write the cart**

```js
// cart.js — loadable by both the browser (window.Cart) and node --test
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'pce_cart';
  var MAX = 99;

  function clamp(n) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, MAX);
  }

  function read(storage) {
    var raw;
    try { raw = storage.getItem(KEY); } catch (e) { return []; }
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var row = parsed[i];
      if (!row || typeof row.variationId !== 'string') continue;
      var qty = clamp(row.qty);
      if (qty > 0) out.push({ variationId: row.variationId, qty: qty });
    }
    return out;
  }

  function write(storage, rows) {
    try { storage.setItem(KEY, JSON.stringify(rows)); } catch (e) { /* full or blocked */ }
    return rows;
  }

  function add(storage, variationId, qty) {
    var rows = read(storage);
    var found = rows.filter(function (r) { return r.variationId === variationId; })[0];
    if (found) found.qty = clamp(found.qty + (qty || 1));
    else rows.push({ variationId: variationId, qty: clamp(qty || 1) });
    return write(storage, rows.filter(function (r) { return r.qty > 0; }));
  }

  function setQty(storage, variationId, qty) {
    var rows = read(storage).map(function (r) {
      if (r.variationId === variationId) r.qty = clamp(qty);
      return r;
    });
    return write(storage, rows.filter(function (r) { return r.qty > 0; }));
  }

  function remove(storage, variationId) {
    return write(storage, read(storage).filter(function (r) {
      return r.variationId !== variationId;
    }));
  }

  function clear(storage) { return write(storage, []); }

  return { read: read, add: add, setQty: setQty, remove: remove, clear: clear, KEY: KEY };
});
```

Note the extra argument in the "never persists a price" test is simply ignored — `add` takes only three parameters, which is what makes the guarantee structural.

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/cart.test.js`
Expected: PASS, 6/6

- [ ] **Step 5: Commit**

```bash
git add cart.js test/cart.test.js
git commit -m "Add a cart that holds variation ids and quantities, never prices"
```

---

### Task 5: The three pages and the configurator

**Files:**
- Create: `wefts.html`, `volume-wefts.html`, `plus-lace-wefts.html`
- Create: `shop.js`
- Modify: `styles.css` (append only)
- Modify: `professional-login.html` (add links to the three pages)

**Interfaces:**
- Consumes: `GET /api/catalog` from Task 3; `window.Cart` from Task 4.
- Produces: the DOM contract below, which Task 6 attaches checkout to.

- [ ] **Step 1: Build one page from the existing skeleton**

Copy `contact.html` head/rail/masthead/footer verbatim so the chrome matches exactly. Change the `<title>`, the `aria-current` (none of the five nav links is current on a shop page — remove the attribute entirely), and the `<main>` body. Load two scripts before `main.js`:

```html
<script src="cart.js"></script>
<script src="shop.js"></script>
<script src="main.js"></script>
```

The `<main>` body:

```html
<main id="main">
  <section class="opener">
    <div class="wrap opener-grid">
      <div>
        <hr class="mark" />
        <span class="eyebrow">Wholesale</span>
        <h1 class="d1">Wefts.</h1>
      </div>
      <p class="lede">
        Single-direction Indian Temple hair, one donor to a bundle, never
        silicone-coated. Choose a collection, a colour and a length.
      </p>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="shop" data-method="WFT" data-shop>
        <div class="shop-loading" data-shop-loading>Loading the catalogue…</div>
        <div class="shop-down" data-shop-down hidden>
          <p class="prose">The catalogue is temporarily unavailable. Email
            <a href="mailto:support@purplecrownextensions.com">support@purplecrownextensions.com</a>
            and we will place your order by hand.</p>
        </div>
        <div class="shop-picker" data-shop-picker hidden>
          <fieldset class="pick"><legend class="eyebrow">Collection</legend>
            <div class="pick-row" data-pick="collection"></div></fieldset>
          <fieldset class="pick"><legend class="eyebrow">Colour</legend>
            <div class="pick-row" data-pick="color"></div></fieldset>
          <fieldset class="pick"><legend class="eyebrow">Length</legend>
            <div class="pick-row" data-pick="length"></div></fieldset>
          <div class="shop-result" data-shop-result hidden>
            <p class="shop-chosen" data-shop-chosen></p>
            <p class="shop-price" data-shop-price></p>
            <p class="shop-sku" data-shop-sku></p>
            <button class="btn btn-solid" type="button" data-shop-add>Add to order</button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <aside class="drawer" data-drawer hidden aria-label="Your order">
    <button class="drawer-toggle" type="button" data-drawer-toggle>
      Your order (<span data-drawer-count>0</span>)
    </button>
    <div class="drawer-body" data-drawer-body hidden>
      <ul class="drawer-list" data-drawer-list></ul>
      <p class="drawer-total" data-drawer-total></p>
      <button class="btn btn-solid" type="button" data-drawer-checkout>Check out with Square</button>
      <p class="form-note" data-drawer-note hidden></p>
    </div>
  </aside>
</main>
```

`volume-wefts.html` is identical with `data-method="VOL"`, title "Volume Wefts", `<h1>Volume wefts.</h1>`. `plus-lace-wefts.html` uses `data-method="PLS"`, "Plus Lace Wefts", `<h1>Plus lace wefts.</h1>` — and note Plus Lace exists only in the Coffee Collection, so its Collection row will render a single option. That is correct and needs no special case.

- [ ] **Step 2: Write the failing check — the isolation guarantee**

This is the fault-protection requirement that a test can actually hold. Add to a new `test/isolation.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const BROCHURE = ['index.html', 'who-we-are.html', 'become-certified.html',
  'contact.html', 'professional-login.html'];

test('no brochure page loads shop code or calls the API', () => {
  for (const page of BROCHURE) {
    const html = fs.readFileSync(page, 'utf8');
    assert.ok(!html.includes('shop.js'), `${page} must not load shop.js`);
    assert.ok(!html.includes('cart.js'), `${page} must not load cart.js`);
    assert.ok(!html.includes('/api/'), `${page} must not reference /api/`);
  }
});

test('main.js never calls the API', () => {
  assert.ok(!fs.readFileSync('main.js', 'utf8').includes('/api/'));
});

test('the nav is still exactly five links on every page', () => {
  for (const page of BROCHURE.concat(['wefts.html', 'volume-wefts.html', 'plus-lace-wefts.html'])) {
    const html = fs.readFileSync(page, 'utf8');
    const nav = html.split('<nav')[1].split('</nav>')[0];
    assert.equal((nav.match(/class="nav-link/g) || []).length, 5, page);
  }
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/isolation.test.js`
Expected: FAIL — `ENOENT: wefts.html`

- [ ] **Step 4: Write `shop.js`**

```js
/* The configurator. Loaded only by wefts / volume-wefts / plus-lace-wefts. */
(function () {
  'use strict';
  var root = document.querySelector('[data-shop]');
  if (!root) return;

  var method = root.getAttribute('data-method');
  var all = [];
  var choice = { collection: null, color: null, length: null };

  function el(sel) { return root.querySelector(sel) || document.querySelector(sel); }
  function show(node, on) { if (node) node.hidden = !on; }

  function money(cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function matching(ignore) {
    return all.filter(function (v) {
      return (ignore === 'collection' || !choice.collection || v.collection === choice.collection)
        && (ignore === 'color' || !choice.color || v.color === choice.color)
        && (ignore === 'length' || !choice.length || v.length === choice.length);
    });
  }

  function optionsFor(field) {
    var seen = [];
    matching(field).forEach(function (v) {
      if (seen.indexOf(v[field]) === -1) seen.push(v[field]);
    });
    return seen;
  }

  function renderRow(field) {
    var row = root.querySelector('[data-pick="' + field + '"]');
    var options = optionsFor(field);
    if (choice[field] && options.indexOf(choice[field]) === -1) choice[field] = null;
    row.innerHTML = '';
    options.forEach(function (value) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = value;
      b.setAttribute('aria-pressed', String(choice[field] === value));
      b.addEventListener('click', function () {
        choice[field] = (choice[field] === value) ? null : value;
        render();
      });
      row.appendChild(b);
    });
  }

  function resolved() {
    var hits = matching();
    return (choice.collection && choice.color && choice.length && hits.length === 1)
      ? hits[0] : null;
  }

  function render() {
    ['collection', 'color', 'length'].forEach(renderRow);
    var v = resolved();
    show(root.querySelector('[data-shop-result]'), !!v);
    if (!v) return;
    root.querySelector('[data-shop-chosen]').textContent =
      v.collection + ' · ' + v.color + ' · ' + v.length;
    // A variation with no price is the gated case: show it, do not price it.
    root.querySelector('[data-shop-price]').textContent =
      typeof v.price === 'number' ? money(v.price) : 'Price on approved account';
    root.querySelector('[data-shop-sku]').textContent = v.sku;
    root.querySelector('[data-shop-add]').disabled = typeof v.price !== 'number';
    root.querySelector('[data-shop-add]').onclick = function () {
      window.Cart.add(window.localStorage, v.variationId, 1);
      window.PCEDrawer.refresh();
    };
  }

  function fail() {
    show(el('[data-shop-loading]'), false);
    show(el('[data-shop-picker]'), false);
    show(el('[data-shop-down]'), true);
  }

  fetch('/api/catalog')
    .then(function (r) { if (!r.ok) throw new Error('down'); return r.json(); })
    .then(function (data) {
      all = (data.variations || []).filter(function (v) { return v.method === method; });
      if (!all.length) return fail();
      show(el('[data-shop-loading]'), false);
      show(el('[data-shop-picker]'), true);
      render();
    })
    .catch(fail);

  window.PCEShop = { lookup: function (id) {
    for (var i = 0; i < all.length; i++) if (all[i].variationId === id) return all[i];
    return null;
  } };
})();
```

- [ ] **Step 5: Write the drawer, in the same file**

Append to `shop.js`:

```js
/* The order drawer. Shared across the three pages via localStorage. */
(function () {
  'use strict';
  var drawer = document.querySelector('[data-drawer]');
  if (!drawer) return;

  var body = drawer.querySelector('[data-drawer-body]');
  drawer.querySelector('[data-drawer-toggle]').addEventListener('click', function () {
    body.hidden = !body.hidden;
  });

  function refresh() {
    var rows = window.Cart.read(window.localStorage);
    drawer.hidden = rows.length === 0;
    drawer.querySelector('[data-drawer-count]').textContent = String(rows.length);

    var list = drawer.querySelector('[data-drawer-list]');
    list.innerHTML = '';
    rows.forEach(function (row) {
      var v = window.PCEShop.lookup(row.variationId);
      var li = document.createElement('li');
      li.textContent = (v ? v.color + ' · ' + v.length : row.variationId) + ' × ' + row.qty;
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'chip'; x.textContent = 'Remove';
      x.addEventListener('click', function () {
        window.Cart.remove(window.localStorage, row.variationId);
        refresh();
      });
      li.appendChild(x);
      list.appendChild(li);
    });
    // Deliberately no total. Square prices the order; the browser must not.
    drawer.querySelector('[data-drawer-total]').textContent =
      rows.length + (rows.length === 1 ? ' bundle' : ' bundles') + ' — priced at checkout';
  }

  window.PCEDrawer = { refresh: refresh };
  refresh();
})();
```

- [ ] **Step 6: Append the shop styles to `styles.css`**

Append only; edit no existing rule. Chips are square, not rounded, per the design rules — a 1px near-black rule, amethyst fill when pressed, Jost at body size. The drawer is fixed bottom-right on desktop and full-width bottom on narrow screens. Reuse the existing `--fg`, `--fg-soft`, `--fg-rule` custom properties rather than introducing new colours.

- [ ] **Step 7: Link the pages from `professional-login.html`**

In the "Already approved" block, under the existing Sign in button, add:

```html
<p class="form-note">
  Shop wholesale: <a href="wefts.html">Wefts</a> ·
  <a href="volume-wefts.html">Volume Wefts</a> ·
  <a href="plus-lace-wefts.html">Plus Lace Wefts</a>
</p>
```

This is the only route into the shop, by design — the five-item nav does not change.

- [ ] **Step 8: Run the whole suite**

Run: `node --test test/`
Expected: PASS, 21/21

- [ ] **Step 9: Commit**

```bash
git add wefts.html volume-wefts.html plus-lace-wefts.html shop.js styles.css professional-login.html test/isolation.test.js
git commit -m "Add the three configurator pages and the shared order drawer"
```

---

### Task 6: Checkout

**Files:**
- Create: `api/checkout.js`
- Create: `test/checkout.test.js`
- Modify: `shop.js` (wire `[data-drawer-checkout]`)

**Interfaces:**
- Consumes: `call`, `LOCATION_ID`, `token` from `api/_square.js`.
- Produces: `POST /api/checkout` with `{items: [{variationId, qty}]}` → `200 {url}` or `4xx/503 {error, reason}`. Reasons: `not_configured`, `empty`, `bad_request`, `upstream`.

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');

function fakeRes() {
  return { code: 0, body: null, setHeader() { return this; },
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test('rejects an empty order', async () => {
  process.env.SQUARE_ACCESS_TOKEN = 'sq0atp-x';
  const handler = require('../api/checkout.js');
  const res = fakeRes();
  await handler({ method: 'POST', body: { items: [] } }, res);
  assert.equal(res.code, 400);
  assert.equal(res.body.reason, 'empty');
});

test('ignores any price the browser sends', async () => {
  process.env.SQUARE_ACCESS_TOKEN = 'sq0atp-x';
  let sent = null;
  const handler = require('../api/checkout.js');
  const res = fakeRes();
  await handler({ method: 'POST', body: { items: [
    { variationId: 'VAR_A', qty: 2, price: 1 }] } }, res,
    async (path, opts) => { sent = opts.body; return { payment_link: { url: 'https://sq/x' } }; });
  assert.equal(res.code, 200);
  assert.equal(res.body.url, 'https://sq/x');
  assert.equal(JSON.stringify(sent).includes('"price"'), false);
  assert.equal(sent.order.location_id, 'L0MRDCWWBFR3Z');
  assert.deepEqual(sent.order.line_items,
    [{ catalog_object_id: 'VAR_A', quantity: '2' }]);
});

test('reports upstream failure without leaking', async () => {
  process.env.SQUARE_ACCESS_TOKEN = 'sq0atp-SECRETVALUE';
  const handler = require('../api/checkout.js');
  const res = fakeRes();
  await handler({ method: 'POST', body: { items: [{ variationId: 'VAR_A', qty: 1 }] } },
    res, async () => { throw new Error('square_http_401'); });
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes('SECRETVALUE'));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/checkout.test.js`
Expected: FAIL — `Cannot find module '../api/checkout.js'`

- [ ] **Step 3: Write the route**

Square prices `catalog_object_id` line items from the catalog at `location_id`, so no price crosses the wire in either direction.

```js
// api/checkout.js
const { call, LOCATION_ID, token } = require('./_square.js');

module.exports = async function handler(req, res, caller) {
  if (!token()) {
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'not_configured' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST', reason: 'bad_request' });
  }

  const raw = (req.body && req.body.items) || [];
  const items = raw
    .filter(i => i && typeof i.variationId === 'string')
    .map(i => ({ variationId: i.variationId, qty: Math.min(Math.max(parseInt(i.qty, 10) || 0, 0), 99) }))
    .filter(i => i.qty > 0)
    .slice(0, 50);

  if (!items.length) {
    return res.status(400).json({ error: 'Your order is empty', reason: 'empty' });
  }

  const payload = {
    idempotency_key: (globalThis.crypto || require('node:crypto').webcrypto).randomUUID(),
    order: {
      location_id: LOCATION_ID,
      line_items: items.map(i => ({ catalog_object_id: i.variationId, quantity: String(i.qty) }))
    },
    checkout_options: { ask_for_shipping_address: true }
  };

  let result;
  try {
    result = await (caller || call)('/v2/online-checkout/payment-links',
      { method: 'POST', body: payload });
  } catch (err) {
    console.error('checkout upstream failed:', err.message);
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'upstream' });
  }

  const url = result && result.payment_link && result.payment_link.url;
  if (!url) {
    console.error('checkout returned no url');
    return res.status(503).json({ error: 'Checkout unavailable', reason: 'upstream' });
  }
  return res.status(200).json({ url });
};
```

- [ ] **Step 4: Wire the drawer button**

In `shop.js`'s drawer IIFE, inside `refresh` scope:

```js
  drawer.querySelector('[data-drawer-checkout]').addEventListener('click', function () {
    var note = drawer.querySelector('[data-drawer-note]');
    var button = drawer.querySelector('[data-drawer-checkout]');
    button.disabled = true;
    note.hidden = true;
    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: window.Cart.read(window.localStorage) })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (out) {
        if (!out.ok || !out.b.url) throw new Error(out.b.reason || 'down');
        window.location.href = out.b.url;
      })
      .catch(function () {
        button.disabled = false;
        note.hidden = false;
        note.textContent = 'We could not open checkout. Your order is saved — try again, or email support@purplecrownextensions.com.';
      });
  });
```

- [ ] **Step 5: Run the whole suite**

Run: `node --test test/`
Expected: PASS, 24/24

- [ ] **Step 6: Commit**

```bash
git add api/checkout.js test/checkout.test.js shop.js
git commit -m "Hand a multi-bundle order to a Square-hosted checkout"
```

---

### Task 7: Ship it to a preview and verify

**Files:**
- Create: `README` section documenting the env vars (append to `README.md`)

- [ ] **Step 1: Push and let Vercel build the preview**

```bash
git push
```

Preview lands at `purple-hair-extensions-git-square-shop-danielkimes-projects.vercel.app`.

- [ ] **Step 2: Verify the token-absent path in Chrome**

Open all three pages on the preview. Expected on each: the page chrome, the hair copy, and the "catalogue is temporarily unavailable" block. **Not** a broken picker, not a JS error. Open the console and confirm it is clean.

- [ ] **Step 3: Verify the isolation guarantee by hand**

Open the four brochure pages on the preview with the network tab filtered to `/api/`. Expected: zero requests.

- [ ] **Step 4: Daniel sets the sandbox token**

He creates a Square sandbox application, copies the access token, and adds `SQUARE_ACCESS_TOKEN` plus `SQUARE_API_BASE=https://connect.squareupsandbox.com` to the Vercel project. Claude does not handle the value. Note the sandbox catalog is empty, so expect the `contract` refusal — that is the correct result and proves the gate fires.

- [ ] **Step 5: Daniel sets the production token**

Same, with the production token and no `SQUARE_API_BASE` override. Redeploy the preview so it picks up the variables.

- [ ] **Step 6: Verify the real catalogue**

On the preview, walk `/wefts`: Single Colors should offer five colours and four lengths; Coffee should offer nine colours and three lengths with no 27"-29". `/plus-lace-wefts` should offer Coffee only. Spot-check `PCE-WFT-AMB-2224` reads **$335.00** and `PCE-PLS-ESP-2224` reads **$787.50**.

- [ ] **Step 7: Put one order through**

Add two different bundles, check out, and confirm the Square page shows both line items at wholesale prices. **Do not complete the payment.**

- [ ] **Step 8: Add the edge rate limit**

In the Vercel dashboard, add a firewall rule limiting `/api/catalog` per IP. Confirm the plan supports it; if not, note it and open a follow-up rather than adding an in-code limiter under time pressure.

- [ ] **Step 9: Document the env vars and commit**

Append to `README.md` a short section naming the four variables, their defaults, and the fact that the shop degrades to "unavailable" without the token.

```bash
git add README.md
git commit -m "Document the Square environment variables"
git push
```

- [ ] **Step 10: Merge only after Daniel has seen the preview**

Do not merge to `master` unprompted. Production deploys from `master` the moment it moves.

---

## Self-Review

**Spec coverage.** Three configurator pages (Task 5); `/api/catalog` with ten-minute cache (Task 3); cart holding IDs only (Task 4); Square-hosted checkout (Task 6); the four fault-protection layers — isolation (Task 5, Step 2 test), sanity gate (Tasks 1 and 3), rate limiting (Task 7, Step 8), branch-then-preview (Task 7); testing as specced (Tasks 1–6); prerequisites (Task 7, Steps 4–5).

**Two changes from the spec, deliberate and worth Daniel seeing:**

1. **Scope key is the SKU prefix `PCE-`, not item IDs.** The spec said "scoped by item ID", but we have no item IDs until a token exists, which would have blocked every task on Daniel's prerequisite. Verified 2026-08-26 that no pre-existing Square item uses a `PCE-` SKU, so the prefix isolates exactly our 121. It is also self-healing if Jessica recreates an item.

2. **`/api/checkout` sends catalog object IDs rather than re-reading prices.** The spec said the function re-reads prices; sending `catalog_object_id` with the order's `location_id` makes Square price the line items itself, which is strictly stronger — no price crosses the wire in either direction, and there is no window between reading and charging.

**One gap the spec did not cover, now decided:** how a stylist reaches the configurators. The client brief fixes the primary nav at five items, so the shop is linked from `professional-login.html` and from the shared drawer, and the nav is unchanged. A test asserts the nav stays at five links on every page.
