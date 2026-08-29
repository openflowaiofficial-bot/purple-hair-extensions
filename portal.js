/* ==========================================================================
   The Purple Crown Extensions — the portal bar's avatar.

   Loaded by every page behind the login. Its only job is to put the signed-in
   professional's picture beside "Your Account" in the bar.

   It asks /api/account?brief=1, which returns the account and skips the Square
   order search entirely. Drawing a 26px avatar is not worth searching someone's
   order history for.

   On the account page this does nothing: account.js already has the whole
   account in hand and fills the bar from that, so the page never fetches twice.
   ========================================================================== */
(function () {
  'use strict';

  // The account page fills its own bar.
  if (document.querySelector('[data-account]')) return;

  var slot = document.querySelector('[data-portal-avatar]');
  if (!slot) return;

  fetch('/api/account?brief=1', { credentials: 'same-origin' })
    .then(function (r) { return r.status === 200 ? r.json() : null; })
    .then(function (data) {
      // No account (the shared wholesale login), or no picture set: the empty
      // circle stays. Nothing is reported as missing, because nothing is wrong.
      if (!data || !data.account || !data.account.avatarUrl) return;
      slot.style.backgroundImage = "url('" + data.account.avatarUrl.replace(/'/g, '%27') + "')";
      slot.setAttribute('data-has-avatar', 'true');
    })
    .catch(function () { /* The bar still works without a picture. */ });
})();
