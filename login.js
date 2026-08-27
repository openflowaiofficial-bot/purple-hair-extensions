/* ==========================================================================
   The Purple Crown Extensions — the sign-in form.

   Loaded only by professional-login.html. It is deliberately not part of
   main.js: the other four brochure pages must not touch /api/ at all, and
   test/isolation.test.js keeps that true.

   The password is posted as JSON and never appears in a URL, a query string,
   a log line, or anywhere on the page.
   ========================================================================== */
(function () {
  'use strict';

  var form = document.querySelector('[data-login-form]');
  if (!form) return;

  var email = form.querySelector('#login-email');
  var password = form.querySelector('#login-password');
  var note = form.querySelector('[data-login-error]');
  var button = form.querySelector('[data-login-submit]');

  function say(message) {
    note.textContent = message || '';
    note.hidden = !message;
  }

  function busy(on) {
    button.disabled = on;
    form.setAttribute('data-busy', String(on));
  }

  form.addEventListener('submit', function (event) {
    // Without this the browser would GET this page with the password in the
    // query string. Everything below depends on it.
    event.preventDefault();
    say('');

    if (!email.value.trim() || !password.value) {
      say('Enter your email and password.');
      return;
    }

    busy(true);
    fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim(), password: password.value })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (data) { return { status: r.status, data: data }; });
      })
      .then(function (result) {
        if (result.status === 200 && result.data.ok) {
          // Clear the field before leaving, so a back-navigation restore has
          // nothing to put back.
          password.value = '';
          window.location.href = 'wefts.html';
          return;
        }
        busy(false);
        if (result.status === 503) {
          say('Sign-in is not configured yet.');
        } else if (result.status === 401) {
          say(result.data.error || 'Those details were not recognised');
        } else {
          say('Sign-in is unavailable right now. Please try again shortly.');
        }
      })
      .catch(function () {
        busy(false);
        say('Sign-in is unavailable right now. Please try again shortly.');
      });
  });
})();
