// test/isolation.test.js
// The brochure site and the shop are two different things sharing one domain.
// A stylist who never signs in must never download shop code, and a bug in the
// shop must never be able to break the pages the public actually sees.
//
// professional-login.html is the one hinge: since the auth addendum it carries
// the sign-in form, so it is allowed to load login.js and to name /api/. It is
// still not allowed to load the configurator or the cart.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The four pages that must stay pure brochure: no shop code, no API at all.
const BROCHURE = ['index.html', 'who-we-are.html', 'become-certified.html',
  'contact.html'];

const SHOP = ['wefts.html', 'volume-wefts.html', 'plus-lace-wefts.html'];

const ALL_PAGES = BROCHURE.concat(['professional-login.html'], SHOP);

test('no brochure page loads shop code or calls the API', () => {
  for (const page of BROCHURE) {
    const html = read(page);
    assert.ok(!html.includes('shop.js'), `${page} must not load shop.js`);
    assert.ok(!html.includes('cart.js'), `${page} must not load cart.js`);
    assert.ok(!html.includes('login.js'), `${page} must not load login.js`);
    assert.ok(!html.includes('/api/'), `${page} must not reference /api/`);
  }
});

test('professional-login.html carries the sign-in form but no shop code', () => {
  const html = read('professional-login.html');
  assert.ok(html.includes('login.js'), 'it must load login.js');
  assert.ok(html.includes('/api/login'), 'the form must post to /api/login');
  assert.ok(!html.includes('shop.js'), 'it must not load shop.js');
  assert.ok(!html.includes('cart.js'), 'it must not load cart.js');
});

test('the sign-in form posts rather than putting a password in a query string', () => {
  const html = read('professional-login.html');
  assert.ok(/<form[^>]+method="post"/i.test(html), 'the form must be method="post"');
  assert.ok(html.includes('autocomplete="email"'), 'email input needs autocomplete="email"');
  assert.ok(html.includes('autocomplete="current-password"'),
    'password input needs autocomplete="current-password"');
  assert.ok(html.includes('type="password"'), 'the password must be a password input');

  const js = read('login.js');
  assert.ok(js.includes('preventDefault'), 'login.js must cancel the native submit');
  assert.ok(js.includes("'POST'") || js.includes('"POST"'), 'login.js must POST');
  assert.ok(!/console\.[a-z]+\([^)]*password/i.test(js), 'login.js must never log the password');
});

test('main.js never calls the API', () => {
  assert.ok(!read('main.js').includes('/api/'));
});

test('login.js is loaded by exactly one page', () => {
  const loaders = ALL_PAGES.filter((p) => read(p).includes('login.js'));
  assert.deepEqual(loaders, ['professional-login.html']);
});

test('shop.js and cart.js are loaded by exactly the three shop pages', () => {
  assert.deepEqual(ALL_PAGES.filter((p) => read(p).includes('shop.js')), SHOP);
  assert.deepEqual(ALL_PAGES.filter((p) => read(p).includes('cart.js')), SHOP);
});

test('the nav is still exactly five links on every page', () => {
  for (const page of ALL_PAGES) {
    const html = read(page);
    const nav = html.split('<nav')[1].split('</nav>')[0];
    assert.equal((nav.match(/class="nav-link/g) || []).length, 5, page);
  }
});

test('no shop page marks a nav item as current', () => {
  for (const page of SHOP) {
    const nav = read(page).split('<nav')[1].split('</nav>')[0];
    assert.ok(!nav.includes('aria-current'), `${page} must not mark a nav link current`);
  }
});

test('a 401 sends the stylist to the login page and a 503 does not', () => {
  const js = read('shop.js');
  assert.ok(js.includes('401'), 'shop.js must treat 401 specially');
  assert.ok(js.includes("replace('professional-login.html')"),
    'a 401 must redirect to the login page');
  // The redirect must be reached from the 401 branch, not from the generic
  // failure path — conflating "signed out" with "Square is down" is the defect
  // this test exists to catch.
  const failBody = js.split('function fail()')[1].split('}')[0];
  assert.ok(!failBody.includes('replace('), 'the unavailable path must not redirect');
});

test('no page and no shop script contains a hard-coded price', () => {
  for (const page of ALL_PAGES.concat(['shop.js', 'login.js', 'cart.js'])) {
    assert.ok(!/\$\d/.test(read(page)), `${page} must not hard-code a price`);
  }
});

test('nothing in the shop uses a monospace typeface', () => {
  // Declarations only — the stylesheet's own header comment says the word.
  for (const file of SHOP.concat(['styles.css', 'shop.js', 'login.js'])) {
    const declared = read(file).match(/font-family\s*:[^;}]*/gi) || [];
    for (const decl of declared) {
      assert.ok(!/monospace|courier|menlo|consolas/i.test(decl),
        `${file} must not use monospace: ${decl.trim()}`);
    }
  }
});
