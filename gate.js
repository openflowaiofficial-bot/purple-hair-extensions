/* ==========================================================================
   The Purple Crown Extensions — the portal gate.

   Loaded only by the professional resource pages. It asks /api/session whether
   anyone is signed in, and reveals the page only if the answer is yes.

   Read this before trusting it with anything: the redirect below hides the
   page, it does not protect it. Every word in the HTML has already been sent
   to the browser by the time this runs, so anyone who fetches the URL directly
   can read it. That is exactly why the shop pages keep the catalogue OUT of
   their HTML and pull it from a gated endpoint instead.

   These pages currently hold no confidential content — the answers are
   placeholders awaiting owner approval. If real policy, pricing or care
   documentation is ever put here and it genuinely must not be public, it has
   to come from a gated API the way /api/catalog does. A client-side redirect
   is not a substitute for that.
   ========================================================================== */
(function () {
  'use strict';

  var main = document.querySelector('[data-gated]');
  if (!main) return;

  function reveal() {
    main.hidden = false;
    var pending = document.querySelector('[data-gate-pending]');
    if (pending) pending.hidden = true;
  }

  function say(message) {
    var pending = document.querySelector('[data-gate-pending]');
    if (pending) pending.textContent = message;
  }

  fetch('/api/session', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 200) { reveal(); return; }
      if (r.status === 401) {
        // Signed out. replace() rather than href so the back button does not
        // bounce the stylist straight back into a page they cannot use.
        window.location.replace('professional-login.html');
        return;
      }
      // 503 and anything else: being unable to check is not the same as being
      // signed out, and must not be reported as one.
      say('We could not confirm your session just now. Please try again shortly, or sign in.');
    })
    .catch(function () {
      say('We could not confirm your session just now. Please try again shortly, or sign in.');
    });
})();
