# Professional accounts

Per-professional sign-in, profiles, order history, and year-to-date spend.

**None of this runs until the environment variables below are set.** Every
endpoint fails closed with a 503 `not_configured` until then, in the same way
`/api/catalog` does without a Square token. Nothing half-works and nothing
invents a number in the meantime.

## What was already true, and what changed

The site had **one** login: `SHOP_EMAIL` and `SHOP_PASSWORD`, shared by every
approved professional. The session cookie carried `{ exp }` and no identity, so
"their orders" and "their spend" had no *their* to attach to.

That shared login still works and still opens the shop. It is now simply a
session with no account attached: `/api/account` answers it with **403
`no_account`**, not 401, because the stylist really is signed in — they just
have no account to show.

## Where things live

| Thing | Where | Why |
| --- | --- | --- |
| Orders, totals, spend | **Square** | Already the system of record for money. Nothing financial is stored on our side, so nothing can drift out of step with Square. |
| Account record, profile | **Vercel KV** | Only what Square does not hold. |
| Sign-in tokens | **Vercel KV**, with a TTL | Single-use, and they expire on their own. |
| Credentials | **nowhere** | Magic links mean there is no password to store, reset, or leak. |

## Environment variables

```
KV_REST_API_URL        from the Vercel KV integration
KV_REST_API_TOKEN      from the Vercel KV integration
RESEND_API_KEY         from resend.com
MAIL_FROM              e.g. "The Purple Crown <no-reply@purplecrownextensions.com>"
SQUARE_PROFESSIONAL_GROUP  optional; defaults to "Certified Stylists/Salon Partners"
BLOB_READ_WRITE_TOKEN  from the Vercel Blob integration (profile pictures)
SITE_ORIGIN            https://www.purplecrownextensions.com  (optional; falls
                       back to the request Host header)
```

`SESSION_SECRET` and `SQUARE_ACCESS_TOKEN` are already in use and unchanged.

## Approving a professional

**Add their Square customer to the customer group named "Certified
Stylists/Salon Partners".** That is the whole process. There is no admin
screen to build and no second list to keep in step, because Square is where
the owner already manages customers.

Removing someone from the group revokes their access on their **next request** —
not whenever their session happens to expire.

Two things must both hold for someone to be treated as a professional:

1. their Square customer is in the group — checked live, every request
2. the local record is not switched off (`approved` in KV)

Square is the live authority. The KV flag only ever takes access away, so it
is a kill-switch for cutting someone off without touching Square.

### First sign-in creates the record

A customer in the group who has never signed in has no KV record yet. When they
ask for a link, `/api/auth-request` looks them up in Square by email, confirms
they are in the group, and creates the account there and then — seeding salon
name, contact name and phone from the Square customer.

So nothing has to be written into KV by hand. Add to the group in Square,
tell them to request a link, done.

### The group name

Configured by `SQUARE_PROFESSIONAL_GROUP`, defaulting to
`Certified Stylists/Salon Partners`. It is matched by name, case- and
whitespace-insensitively, and the resolved id is cached for an hour.

**If the group is renamed in Square without this being updated, nothing
resolves and every sign-in fails.** That is deliberate — the alternative is
granting access when the check could not be made — but it means the name has to
be kept in step. The server log says `professionals group not found in Square`
when this happens.

### It fails closed

If Square cannot be reached, or the group cannot be found, **nobody is
approved.** A Square outage therefore locks professionals out of the portal.

That is a deliberate trade. The alternative is granting wholesale access on the
strength of a request that failed, which is worse than an hour of downtime.

## Signing in

1. The professional enters their email on `professional-login.html`
2. `/api/auth-request` looks them up and, **if the account exists and is
   approved**, emails a single-use link. It answers identically either way —
   an endpoint that says "no such account" is a directory of who this house
   works with.
3. `/api/auth-verify` spends the token, re-checks approval, and issues a
   session carrying the account id
4. `account.html` reads `/api/account`

Links last **15 minutes** and work **once**. The token is deleted before the
session is signed, so a mail scanner or a forwarded message cannot spend it
twice.

## The rule this page is built on

**An unknown number is never drawn as zero.**

- No Square customer linked → `linked: false`, spend renders as an em dash
- Square unreachable → `ordersAvailable: false`, and the empty state says
  "unavailable", never "no orders"

`$0.00` is a claim about someone's year. The page only makes it when Square
actually said so. Two tests hold that line: `account.html` must contain no
money figure at all, and `account.js` must never coerce a null total to zero.

## Profile pictures

A professional uploads their own picture from the account page. `POST
/api/avatar` replaces it, `DELETE /api/avatar` removes it, and both take the
account from the signed session — never from the request. Nothing the browser
sends can name another account, choose a storage path, or set the stored URL.

**The browser resizes before uploading.** The file is drawn to a 512×512 canvas
and re-encoded as JPEG. That caps the upload and guarantees a square, but the
reason worth stating is different: re-encoding drops the EXIF block, which on a
phone photograph routinely carries the **GPS coordinates of where it was
taken**. A stylist uploading a headshot should not be publishing their home
address.

**The server believes none of that.** A request can be made by anything, and a
declared Content-Type is a string the client chose, so `api/_image.js` reads
the first bytes and accepts only a real JPEG, PNG or WebP header. SVG is
refused deliberately — an SVG is a document that can carry script, and a
profile picture has no business being one.

Replacing a picture deletes the previous file, and only after the new URL is
safely recorded, so a failed upload cannot leave an account pointing at
something that was just deleted.

### One thing to be clear with professionals about

**Vercel Blob URLs are public.** The address is long and unguessable, and it is
never shown to anyone but the account owner — but it is not access-controlled.
Anyone who obtains the URL can view the image, and it stays reachable until the
picture is replaced or removed.

For a professional headshot that is normally the expected trade-off, and it is
how most avatar hosting works. It is written down here so the decision is a
decision. **TODO (owner): if profile pictures should be genuinely private,
they need to be served through an authenticated endpoint rather than straight
from Blob** — a larger change, and worth doing only if the requirement is real.
