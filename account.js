/* ==========================================================================
   The Purple Crown Extensions — the account page.

   Loaded only by account.html. Everything on the page is drawn from
   /api/account; nothing is hardcoded and nothing is assumed. Where the server
   says it does not know something — a spend total it cannot compute, orders it
   could not reach — this says so rather than printing a zero. A zero is a
   claim, and an invented one is worse than an empty state.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('[data-account]');
  if (!root) return;

  function el(sel) { return root.querySelector(sel); }
  function show(node, on) { if (node) node.hidden = !on; }

  function money(cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function longDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined,
      { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function orderLabel(order) {
    var lines = (order.lineItems || []).map(function (li) {
      return [li.variationName || li.name, li.quantity ? '× ' + li.quantity : '']
        .filter(Boolean).join(' ');
    }).filter(Boolean);
    return lines.length ? lines.join(', ') : 'Order ' + order.id;
  }

  function renderOrders(listNode, emptyNode, orders, emptyText) {
    listNode.innerHTML = '';
    if (!orders.length) {
      emptyNode.textContent = emptyText;
      show(emptyNode, true);
      show(listNode, false);
      return;
    }
    show(emptyNode, false);
    show(listNode, true);
    orders.forEach(function (order) {
      var row = document.createElement('div');
      row.className = 'order-row';

      var when = document.createElement('p');
      when.className = 'order-date';
      when.textContent = longDate(order.closedAt || order.createdAt) || '—';

      var what = document.createElement('div');
      var name = document.createElement('p');
      name.className = 'order-name';
      name.textContent = orderLabel(order);
      var state = document.createElement('span');
      state.className = 'order-state';
      state.textContent = (order.state || '').toLowerCase();
      what.appendChild(name);
      what.appendChild(state);

      var total = document.createElement('p');
      total.className = 'order-total';
      total.textContent = money(order.totalCents);

      row.appendChild(when);
      row.appendChild(what);
      row.appendChild(total);
      listNode.appendChild(row);
    });
  }

  function fillProfile(profile) {
    var form = el('[data-profile-form]');
    Object.keys(profile || {}).forEach(function (field) {
      var input = form.querySelector('[name="' + field + '"]');
      if (input) input.value = profile[field] || '';
    });
  }

  function readProfile() {
    var form = el('[data-profile-form]');
    var out = {};
    Array.prototype.forEach.call(form.querySelectorAll('input[name]'), function (input) {
      out[input.name] = input.value;
    });
    return out;
  }

  function render(data) {
    el('[data-account-email]').textContent = data.account.email;
    fillProfile(data.account.profile);

    var spend = el('[data-ytd]');
    var spendNote = el('[data-ytd-note]');
    if (typeof data.ytdCents === 'number') {
      spend.textContent = money(data.ytdCents);
      spendNote.textContent = 'Completed orders in ' + data.year + ', from Square.';
    } else {
      // linked:false or ordersAvailable:false. Either way the number is not
      // known, and an unknown total is never drawn as $0.00.
      spend.textContent = '—';
      spendNote.textContent = data.linked === false
        ? 'Your account is not linked to a Square customer record yet, so spend cannot be shown. Contact support and we will connect it.'
        : 'We could not reach Square just now, so this year’s total is unavailable. Your orders are unaffected.';
    }

    var openEmpty = data.ordersAvailable === false
      ? 'Order status is unavailable right now.'
      : 'Nothing is currently in progress.';
    var historyEmpty = data.ordersAvailable === false
      ? 'Order history is unavailable right now.'
      : 'No past orders yet.';

    renderOrders(el('[data-open-list]'), el('[data-open-empty]'), data.open || [], openEmpty);
    renderOrders(el('[data-history-list]'), el('[data-history-empty]'), data.history || [], historyEmpty);

    show(el('[data-account-loading]'), false);
    show(root.querySelector('[data-account-body]'), true);
  }

  function fail(message) {
    show(el('[data-account-loading]'), false);
    var box = el('[data-account-down]');
    box.textContent = message;
    show(box, true);
  }

  function load() {
    fetch('/api/account', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) { window.location.replace('professional-login.html'); return null; }
        return r.json().then(function (body) { return { status: r.status, body: body }; });
      })
      .then(function (result) {
        if (!result) return;
        if (result.status === 403) {
          // Signed in, but on the shared wholesale login rather than a
          // professional account. Not an error, and not a reason to throw
          // anyone out of a session that still works for ordering.
          fail('This sign-in is not linked to a professional account, so there is no profile to show. '
             + 'If you should have one, contact support@purplecrownextensions.com.');
          return;
        }
        if (result.status !== 200) { fail('Your account is unavailable right now. Please try again shortly.'); return; }
        render(result.body);
      })
      .catch(function () { fail('Your account is unavailable right now. Please try again shortly.'); });
  }

  var form = el('[data-profile-form]');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var note = el('[data-profile-note]');
    var button = el('[data-profile-save]');
    button.disabled = true;
    note.hidden = true;

    fetch('/api/account', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: readProfile() })
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (out) {
        button.disabled = false;
        note.hidden = false;
        if (out.ok) {
          note.textContent = 'Saved.';
          fillProfile(out.body.account.profile);
        } else {
          note.textContent = 'We could not save that just now. Please try again shortly.';
        }
      })
      .catch(function () {
        button.disabled = false;
        note.hidden = false;
        note.textContent = 'We could not save that just now. Please try again shortly.';
      });
  });

  load();
})();
