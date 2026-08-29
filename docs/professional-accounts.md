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
SITE_ORIGIN            https://www.purplecrownextensions.com  (optional; falls
                       back to the request Host header)
```

`SESSION_SECRET` and `SQUARE_ACCESS_TOKEN` are already in use and unchanged.

## Creating an account

Accounts are an **approval decision, not a signup**. There is deliberately no
public endpoint that creates one — a professional cannot self-register, which
is the whole point of invitation-only access.

To approve someone, write two keys into KV:

```
acct:<id>              the record
acct:email:<email>     lowercased email -> <id>
```

The record:

```json
{
  "id": "acct_1",
  "email": "stylist@salon.com",
  "squareCustomerId": "SQUARE_CUSTOMER_ID",
  "approved": true,
  "createdAt": "2026-08-29T00:00:00.000Z",
  "profile": {}
}
```

`api/_accounts.js` exports `create()` for this. **TODO (owner): decide how
approvals are actually performed** — a small admin endpoint, a script, or by
hand in the Vercel KV browser. Until that is chosen, accounts are created by
hand.

## Linking a professional to their orders

`squareCustomerId` is what makes history and spend possible. Two pieces:

1. Each approved professional needs a **Square Customer** record, and its id on
   their account.
2. **TODO (owner): `/api/checkout` does not yet attach `customer_id` to the
   order.** Until it does, orders placed through the site are not linked to
   anyone, and a professional's history will be empty even with everything
   above configured. This is a small change to `api/checkout.js` — the payload
   takes `order.customer_id` — but it needs deciding first, because it changes
   what Square records against every future order.

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
