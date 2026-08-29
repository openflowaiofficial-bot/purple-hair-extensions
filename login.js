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

  /* ------------------------------------------------------------------------
     The sign-in link. Separate from the password form above because it is a
     different thing: the password is the shared wholesale login, while a link
     signs a professional in as themselves.

     The reply is always the same whether or not the email has an account, so
     this must not report "sent" in a way that implies one exists. It says what
     it can honestly say: if there is an account, a link is on its way.
     ------------------------------------------------------------------------ */
  var linkForm = document.querySelector('[data-link-form]');
  if (linkForm) {
    var linkEmail = linkForm.querySelector('#link-email');
    var linkNote = linkForm.querySelector('[data-link-note]');
    var linkButton = linkForm.querySelector('[data-link-submit]');

    linkForm.addEventListener('submit', function (event) {
      event.preventDefault();
      linkNote.hidden = true;

      if (!linkEmail.value.trim()) {
        linkNote.hidden = false;
        linkNote.textContent = 'Enter the email address on your account.';
        return;
      }

      linkButton.disabled = true;
      fetch('/api/auth-request', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: linkEmail.value.trim() })
      })
        .then(function (r) { return r.json().catch(function () { return {}; })
          .then(function (d) { return { status: r.status, data: d }; }); })
        .then(function (result) {
          linkButton.disabled = false;
          linkNote.hidden = false;
          if (result.status === 200) {
            linkNote.textContent = 'If that address has a professional account, '
              + 'a sign-in link is on its way. It can be used once and expires in 15 minutes.';
          } else if (result.status === 503) {
            linkNote.textContent = 'Sign-in links are not available yet.';
          } else {
            linkNote.textContent = 'We could not send a link just now. Please try again shortly.';
          }
        })
        .catch(function () {
          linkButton.disabled = false;
          linkNote.hidden = false;
          linkNote.textContent = 'We could not send a link just now. Please try again shortly.';
        });
    });
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
          window.location.href = 'account.html';
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
