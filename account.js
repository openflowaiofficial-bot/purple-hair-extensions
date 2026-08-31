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

  function renderAvatar(url) {
    var img = el('[data-avatar-img]');
    var placeholder = el('[data-avatar-placeholder]');
    var remove = el('[data-avatar-remove]');
    if (url) {
      img.src = url;
      show(img, true);
      show(placeholder, false);
      show(remove, true);
    } else {
      img.removeAttribute('src');
      show(img, false);
      show(placeholder, true);
      show(remove, false);
    }
  }

  // The bar sits outside [data-account], so it is reached from the document
  // rather than through el().
  function renderBarAvatar(url) {
    var slot = document.querySelector('[data-portal-avatar]');
    if (!slot) return;
    if (url) {
      slot.style.backgroundImage = "url('" + url.replace(/'/g, '%27') + "')";
      slot.setAttribute('data-has-avatar', 'true');
    } else {
      slot.style.backgroundImage = '';
      slot.removeAttribute('data-has-avatar');
    }
  }

  function render(data) {
    el('[data-account-email]').textContent = data.account.email;
    renderAvatar(data.account.avatarUrl);
    renderBarAvatar(data.account.avatarUrl);
    fillProfile(data.account.profile);

    var spend = el('[data-ytd]');
    var spendNote = el('[data-ytd-note]');
    if (typeof data.ytdCents === 'number') {
      spend.textContent = money(data.ytdCents);
      spendNote.textContent = 'Completed orders in ' + data.year + ', from Square.';
    } else {
      // ordersAvailable:false — Square was unreachable. The number is not known,
      // and an unknown total is never drawn as $0.00.
      spend.textContent = '—';
      spendNote.textContent = 'We could not reach Square just now, so this year’s total is unavailable. Your orders are unaffected.';
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
          // A 403 has more than one cause, and the server tells them apart in
          // `detail`. Collapsing them into one message sends a stylist whose
          // access lapsed — or who hit a Square outage — the wrong instruction.
          var detail = result.body && result.body.detail;
          if (detail === 'upstream') {
            // Approval could not be confirmed because Square was unreachable.
            // This is not "you have no account"; it is "we could not check".
            fail('We could not confirm your professional access just now — the connection to Square '
               + 'failed. Please try again shortly.');
          } else if (detail) {
            // A known account whose professional access is not currently active
            // (removed from the group, switched off, or not yet linked).
            fail('This account does not currently have active professional access. If you believe this '
               + 'is a mistake, contact support@purplecrownextensions.com.');
          } else {
            // No detail: the shared wholesale login, which carries no account.
            // Not an error, and not a reason to end a session that still orders.
            fail('This sign-in is not linked to a professional account, so there is no profile to show. '
               + 'You can still order wholesale using the links above. If you should have an '
               + 'account, contact support@purplecrownextensions.com.');
          }
          return;
        }
        if (result.status !== 200) { fail('Your account is unavailable right now. Please try again shortly.'); return; }
        render(result.body);
      })
      .catch(function () { fail('Your account is unavailable right now. Please try again shortly.'); });
  }

  /* ------------------------------------------------------------------------
     The profile picture.

     The file is drawn to a square canvas and re-encoded as JPEG before it is
     sent. That caps the upload, guarantees a square, and — the part worth
     saying out loud — drops the EXIF block, which on a photograph taken with a
     phone routinely carries the GPS coordinates of where it was taken. A
     stylist uploading a headshot should not be publishing their home address.

     None of this is a security measure. The browser can be bypassed, so
     api/_image.js checks the bytes again on arrival and believes nothing the
     client claimed.
     ------------------------------------------------------------------------ */
  var AVATAR_PX = 512;

  function squareJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var side = Math.min(img.width, img.height);
        var canvas = document.createElement('canvas');
        canvas.width = AVATAR_PX;
        canvas.height = AVATAR_PX;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // Centre crop, then scale.
        ctx.drawImage(img,
          (img.width - side) / 2, (img.height - side) / 2, side, side,
          0, 0, AVATAR_PX, AVATAR_PX);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('encode_failed'));
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('not_an_image'));
      };
      img.src = url;
    });
  }

  function avatarNote(message) {
    var note = el('[data-avatar-note]');
    note.textContent = message || '';
    note.hidden = !message;
  }

  var fileInput = el('[data-avatar-file]');
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      avatarNote('Preparing your picture\u2026');

      squareJpeg(file)
        .then(function (blob) {
          avatarNote('Uploading\u2026');
          return fetch('/api/avatar', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob
          });
        })
        .then(function (r) {
          return r.json().catch(function () { return {}; })
            .then(function (b) { return { status: r.status, body: b }; });
        })
        .then(function (out) {
          fileInput.value = '';
          if (out.status === 200) {
            renderAvatar(out.body.avatarUrl);
            renderBarAvatar(out.body.avatarUrl);
            avatarNote('Updated.');
            return;
          }
          // The server's message is written for a person and says which rule
          // was broken, so it is shown rather than replaced with a generic one.
          avatarNote(out.body && out.body.error
            ? out.body.error
            : 'We could not update your picture just now. Please try again shortly.');
        })
        .catch(function (err) {
          fileInput.value = '';
          avatarNote(err && err.message === 'not_an_image'
            ? 'That file could not be read as an image.'
            : 'We could not update your picture just now. Please try again shortly.');
        });
    });
  }

  var removeButton = el('[data-avatar-remove]');
  if (removeButton) {
    removeButton.addEventListener('click', function () {
      avatarNote('Removing\u2026');
      fetch('/api/avatar', { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { return r.ok; })
        .then(function (ok) {
          if (ok) { renderAvatar(null); renderBarAvatar(null); avatarNote('Removed.'); }
          else { avatarNote('We could not remove your picture just now.'); }
        })
        .catch(function () { avatarNote('We could not remove your picture just now.'); });
    });
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
