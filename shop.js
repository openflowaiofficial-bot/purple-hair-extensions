/* ==========================================================================
   The Purple Crown Extensions — the wholesale configurator.

   Loaded only by wefts.html, volume-wefts.html and plus-lace-wefts.html. The
   brochure pages must never pull this file in; test/isolation.test.js holds
   that line.

   Nothing about the catalogue lives here. Collections, colours, lengths, SKUs
   and prices all arrive from the gated /api/catalog, so the static shell is
   worth nothing to someone who has not signed in.
   ========================================================================== */

/* The configurator. */
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
    if (!row) return;
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
    var add = root.querySelector('[data-shop-add]');
    add.disabled = typeof v.price !== 'number';
    add.onclick = function () {
      // Only the variation id and a quantity are ever stored. The price the
      // stylist just read is Square's to state again at checkout.
      window.Cart.add(window.localStorage, v.variationId, 1);
      if (window.PCEDrawer) window.PCEDrawer.refresh();
    };
  }

  /* Square is down, or the contract broke, or the network did. Different from
     being signed out, and shown differently. */
  function fail() {
    show(el('[data-shop-loading]'), false);
    show(el('[data-shop-picker]'), false);
    show(el('[data-shop-down]'), true);
  }

  /* Not signed in. The server already refused; this is only the UX on top of
     it. Never the "temporarily unavailable" block — nothing is unavailable,
     the stylist simply has no session. replace() rather than href so the back
     button does not bounce them straight back into a page they cannot use. */
  function signedOut() {
    window.location.replace('professional-login.html');
  }

  fetch('/api/catalog', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401) { signedOut(); return null; }
      if (!r.ok) throw new Error('down');
      return r.json();
    })
    .then(function (data) {
      if (!data) return; // 401 — already leaving the page.
      all = (data.variations || []).filter(function (v) { return v.method === method; });
      if (!all.length) return fail();
      show(el('[data-shop-loading]'), false);
      show(el('[data-shop-picker]'), true);
      render();
      // The drawer drew itself before the catalogue arrived, so its rows are
      // bare ids until now.
      if (window.PCEDrawer) window.PCEDrawer.refresh();
    })
    .catch(fail);

  window.PCEShop = { lookup: function (id) {
    for (var i = 0; i < all.length; i++) if (all[i].variationId === id) return all[i];
    return null;
  } };
})();

/* The order drawer. Shared across the three pages via localStorage. */
(function () {
  'use strict';
  var drawer = document.querySelector('[data-drawer]');
  if (!drawer) return;

  var body = drawer.querySelector('[data-drawer-body]');
  var toggle = drawer.querySelector('[data-drawer-toggle]');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', function () {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
  });

  function refresh() {
    var rows = window.Cart.read(window.localStorage);
    drawer.hidden = rows.length === 0;
    drawer.querySelector('[data-drawer-count]').textContent = String(rows.length);

    var list = drawer.querySelector('[data-drawer-list]');
    list.innerHTML = '';
    rows.forEach(function (row) {
      var v = window.PCEShop ? window.PCEShop.lookup(row.variationId) : null;
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'drawer-item';
      name.textContent = (v ? v.color + ' · ' + v.length : row.variationId)
        + ' × ' + row.qty;
      li.appendChild(name);
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip';
      x.textContent = 'Remove';
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
