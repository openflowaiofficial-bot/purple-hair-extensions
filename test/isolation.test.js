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

// The five pages that must stay pure brochure: no shop code, no API at all.
const BROCHURE = ['index.html', 'who-we-are.html', 'become-certified.html',
  'contact.html', 'faq.html'];

const SHOP = ['wefts.html', 'volume-wefts.html', 'plus-lace-wefts.html'];

// The professional resource pages. They are not brochure — they ask
// /api/session before revealing themselves — and they are not shop: no
// configurator, no cart.
const PORTAL = ['product-selection.html', 'hair-care.html', 'performance.html',
  'orders-policies.html'];

// The account page gates itself: /api/account answers 401 without a session and
// 403 for the shared wholesale login, and account.js acts on both. It does not
// use gate.js, so it is its own category rather than a fifth PORTAL page.
const ACCOUNT = ['account.html'];

const ALL_PAGES = BROCHURE.concat(['professional-login.html'], SHOP, PORTAL, ACCOUNT);

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

test('gate.js is loaded by exactly the portal resource pages', () => {
  assert.deepEqual(ALL_PAGES.filter((p) => read(p).includes('gate.js')), PORTAL);
});

// Every page behind the login carries the portal bar, and no page in front of
// it does. A public visitor must never be shown the way into a portal they
// cannot enter.
const SIGNED_IN = PORTAL.concat(SHOP, ACCOUNT);

test('the portal bar is on every signed-in page and no public one', () => {
  for (const page of SIGNED_IN) {
    assert.ok(read(page).includes('class="portal-bar"'), `${page} needs the portal bar`);
  }
  for (const page of BROCHURE.concat(['professional-login.html'])) {
    assert.ok(!read(page).includes('class="portal-bar"'),
      `${page} is public and must not carry the portal bar`);
  }
});

test('the portal bar marks exactly one destination as current', () => {
  for (const page of SIGNED_IN) {
    // Matched on the class itself rather than the whole attribute: the
    // current item also carries portal-account on the Your Account entry.
    const here = (read(page).match(/portal-here/g) || []).length;
    assert.equal(here, 1, `${page} must mark exactly one portal link current`);
  }
});

// It sits inside <main>, above the page's own content, so it is the first
// thing after the masthead rather than something to scroll for.
test('portal.js is loaded by exactly the signed-in pages', () => {
  // Sorted: ALL_PAGES lists the shop before the portal and SIGNED_IN the
  // other way round. The set is what matters, not the order.
  assert.deepEqual(
    ALL_PAGES.filter((p) => read(p).includes('portal.js')).sort(),
    SIGNED_IN.slice().sort());
});

// The avatar is decorative: the label beside it already says "Your Account".
// Announcing it again would only make a screen reader repeat itself.
test('the bar avatar is present, decorative, and drawn by CSS', () => {
  for (const page of SIGNED_IN) {
    const html = read(page);
    assert.ok(html.includes('data-portal-avatar'), page + ' needs an avatar slot');
    assert.match(html, /<span class="portal-avatar" data-portal-avatar aria-hidden="true">/,
      page + ': the avatar must be aria-hidden');
    assert.ok(!/<img[^>]*data-portal-avatar/.test(html),
      page + ': the bar avatar is a background image, so an unset one cannot fail to load');
  }
});

// One request per page for a 26px picture, and never a Square order search.
test('the bar asks for the brief account, not the full one', () => {
  const js = read('portal.js');
  assert.ok(js.includes('/api/account?brief=1'), 'portal.js must use the brief form');
  assert.ok(js.includes("querySelector('[data-account]')"),
    'portal.js must stand down on the account page, which already has the data');
});

test('the portal bar is the first thing inside main', () => {
  for (const page of SIGNED_IN) {
    const html = read(page);
    const main = html.indexOf('<main id="main"');
    const bar = html.indexOf('class="portal-bar"');
    const opener = html.indexOf('<section');
    assert.ok(bar > main, `${page}: the bar must be inside main`);
    assert.ok(bar < opener, `${page}: the bar must come before the first section`);
  }
});

// The bar must not become a second thing that answers to "the navigation" —
// see the masthead nav assertions above.
test('the portal bar is not a nav element', () => {
  for (const page of SIGNED_IN) {
    assert.equal((read(page).match(/<nav\b/g) || []).length, 1,
      `${page} must carry exactly one <nav>, the masthead`);
  }
});

test('both sign-in paths land on the account page', () => {
  assert.match(read('login.js'), /location\.href = 'account\.html'/,
    'the password form must land on the account');
  assert.match(read('api/auth-verify.js'), /'Location', '\/account\.html'/,
    'the emailed link must land on the account');
});

test('account.js is loaded by exactly the account page', () => {
  assert.deepEqual(ALL_PAGES.filter((p) => read(p).includes('account.js')), ACCOUNT);
});

test('the account page carries no shop code and asks not to be indexed', () => {
  for (const page of ACCOUNT) {
    const html = read(page);
    assert.match(html, /<meta name="robots" content="noindex"/, `${page} needs noindex`);
    assert.ok(!html.includes('shop.js'), `${page} must not load shop.js`);
    assert.ok(!html.includes('cart.js'), `${page} must not load cart.js`);
    assert.ok(!html.includes('gate.js'), `${page} gates itself via /api/account`);
  }
});

// The page must never carry a figure of its own. Every number on it comes from
// /api/account at request time, so a stale or invented total cannot be baked
// into the markup and shipped.
test('the account page hardcodes no money', () => {
  const html = read('account.html');
  const money = html.match(/\$[0-9][0-9,]*(\.[0-9]{2})?/g) || [];
  assert.deepEqual(money, [], `account.html must not contain a money figure: ${money.join(', ')}`);
});

// An unknown total renders as an em dash. If this ever becomes "0" the page
// starts making a claim about the year that nobody checked.
test('account.js never prints a zero for an unknown total', () => {
  const js = read('account.js');
  assert.ok(js.includes("spend.textContent = '—'") || js.includes('spend.textContent = "—"'),
    'an unknown year-to-date must render as an em dash');
  assert.ok(!/ytdCents\s*\|\|\s*0/.test(js),
    'null must not be coerced to 0 anywhere');
});

test('a portal page gates itself and carries no shop code', () => {
  for (const page of PORTAL) {
    const html = read(page);
    assert.ok(html.includes('data-gated'), `${page} must mark its main [data-gated]`);
    assert.match(html, /<main[^>]+data-gated[^>]*\bhidden\b/,
      `${page} must start hidden so nothing flashes before the session check`);
    assert.ok(!html.includes('shop.js'), `${page} must not load shop.js`);
    assert.ok(!html.includes('cart.js'), `${page} must not load cart.js`);
    assert.ok(!html.includes('login.js'), `${page} must not load login.js`);
  }
});

// These pages are reachable by URL whether or not anyone is signed in, so they
// must never be indexed. gate.js says the same thing in prose: the redirect
// hides the page, it does not protect the markup.
test('portal pages ask not to be indexed', () => {
  for (const page of PORTAL) {
    assert.match(read(page), /<meta name="robots" content="noindex"/,
      `${page} needs a noindex robots meta`);
  }
});

test('gate.js treats "cannot check" differently from "signed out"', () => {
  const js = read('gate.js');
  assert.ok(js.includes('replace('), 'it must replace() rather than href on 401');
  assert.ok(js.includes('401'), 'it must branch on 401 specifically');
  assert.ok(!/if\s*\(\s*!\s*r\.ok\s*\)[^]{0,80}replace/.test(js),
    'a non-OK status must not be collapsed into the signed-out redirect');
});

// Pinned to the masthead's own element rather than "the first <nav> in the
// file". Document order is not a guarantee: anything later that happened to be
// a <nav> — a breadcrumb, a sibling-page row — would silently become the thing
// these two assertions measure.
function primaryNav(page) {
  const html = read(page);
  const match = html.match(/<nav\b[^>]*\bid="nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(match, `${page} has no <nav id="nav"> masthead navigation`);
  return match[1];
}

test('the nav is still exactly six links on every page', () => {
  for (const page of ALL_PAGES) {
    assert.equal((primaryNav(page).match(/class="nav-link/g) || []).length, 6, page);
  }
});

test('no signed-in page marks a nav item as current', () => {
  // None of the shop, portal, or account pages is a masthead destination, so
  // none may mark one current. These pages are built by copying a brochure
  // page, which is exactly how a stray aria-current gets carried in.
  for (const page of SIGNED_IN) {
    assert.ok(!primaryNav(page).includes('aria-current'),
      `${page} must not mark a nav link current`);
  }
});

test('the shop pages carry no navigation element beyond the masthead', () => {
  // The sibling-page row inside <main> is a div, not a <nav>: it is not site
  // navigation, and making it one would put a second candidate in front of any
  // assertion that reaches for "the nav".
  for (const page of SHOP) {
    assert.equal((read(page).match(/<nav\b/g) || []).length, 1, page);
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

// The wholesale catalogue's prices must only ever come from Square, so no page
// and no shop script may state one. The Crown Your Style class is the single
// deliberate exception: it is a fixed published course price behind a Square
// payment link, not a catalogue variation, and a buyer deciding on a $1,200
// class is entitled to see the figure before clicking through to checkout.
// Keep this list at exactly one entry — a second one means the rule is leaking.
const PRICE_EXCEPTIONS = { 'become-certified.html': ['$1,200'] };

test('no page and no shop script contains a hard-coded price', () => {
  for (const page of ALL_PAGES.concat(['shop.js', 'login.js', 'cart.js'])) {
    const allowed = PRICE_EXCEPTIONS[page] || [];
    let body = read(page);
    for (const ok of allowed) body = body.split(ok).join('');
    assert.ok(!/\$\d/.test(body), `${page} must not hard-code a price`);
  }
});

test('the class price exception is a single named figure, not a loophole', () => {
  assert.deepEqual(Object.keys(PRICE_EXCEPTIONS), ['become-certified.html']);
  assert.equal(PRICE_EXCEPTIONS['become-certified.html'].length, 1);
  // If Jessica changes the class price in Square, this must be updated with it.
  assert.ok(read('become-certified.html').includes('$1,200'));
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
