# The Purple Crown Extensions — Square-backed wholesale shop

Design spec. Written 2026-08-26. Status: approved in conversation, not yet implemented.

## What this is

Three configurator pages on the existing Vercel site that read the live Square
catalog and hand off to Square for payment. Today the site is five static pages
with a single unused `data-store` hook; there is no shop of any kind.

This spec covers browsing and ordering. It does not cover stylist logins — those
come later, and the design leaves a defined seam for them.

## What already exists

- **Repo** `openflowaiofficial-bot/purple-hair-extensions`, branch `master`,
  pure static: no build step, no `vercel.json`, no `api/`. That constraint is
  deliberate and survives this change.
- **Vercel** project `purple-hair-extensions` (`prj_BZp39RyeiOkjszb5utTtoZMCuWNJ`),
  team `danielkimes-projects` (`team_BjrOfZNOmix9QUZLoEqJUhmk`), Pro plan.
  `framework: null`, Node 24.x. `master` auto-deploys to production; last
  production deploy 2026-08-07 23:29 EDT = commit `e3b21a2`.
  Answers only on `*.vercel.app` — `purplecrownextensions.com` is **not**
  attached to this project.
- **Square** catalog loaded and verified 2026-08-09: 5 master items, 121
  variations, at location `L0MRDCWWBFR3Z` ("Purple Crown Extensions - Wholesale").
- **`~/purple-crown-catalog/build_catalog.py`** generates all 121 valid rows and
  self-validates count, SKU uniqueness and the invalid-combination rules.

## Decisions taken

Each of these was a fork; recording who closed it and how.

| Decision | Chosen | Notes |
|---|---|---|
| Where the shop lives | On our Vercel site | Not a hand-off to a Square Online storefront |
| Price gate | **None for phase one** | Daniel's call, against the brief's "no public pricing" — see Known risk |
| Cart | Multi-item, checkout once | Stylists buy several bundles per client head |
| Stock | Ignored entirely | All 121 read Sold out in Square; Jessica works stock by hand |
| Checkout | Square-hosted payment link | Square collects payment and shipping address |
| Fault protection | All four (below) | |

## Catalog contract

Five master items at `L0MRDCWWBFR3Z`. SKU form `PCE-[METHOD]-[COLOR]-[LENGTH]`.

| Item | Method | Collection | Colors | Lengths | Count |
|---|---|---|---|---|---|
| Weft — Single Colors | WFT | Single Colors | 5 | 4 | 20 |
| Weft — Coffee Collection | WFT | Coffee Collection | 9 | 3 | 27 |
| Volume Weft — Single Colors | VOL | Single Colors | 5 | 4 | 20 |
| Volume Weft — Coffee Collection | VOL | Coffee Collection | 9 | 3 | 27 |
| Plus Lace Weft — Coffee Collection | PLS | Coffee Collection | 9 | 3 | 27 |

**121 total.** Single Colors: Brittany (BRT), Margo (MRG), Amber (AMB),
Jayla (JYL), Jade (JDE). Coffee Collection: Chai Latte (CHL), French Vanilla
(FRV), Cafe Latte (CFL), Toasted Hazelnut (THZ), Cappuccino (CAP), Caramel
Macchiato (CRM), Pumpkin Spice (PSP), Peppermint Mocha (PPM), Espresso Bean (ESP).

Lengths are 14"-16", 18"-20", 22"-24" everywhere, plus **27"-29" only for Single
Colors on Weft and Volume Weft**. Plus Lace exists only in Coffee Collection.

Sample wholesale prices: `PCE-WFT-AMB-2224` $335.00, `PCE-VOL-CHL-1416` $325.00,
`PCE-PLS-ESP-2224` $787.50.

## Architecture

```
BROWSE                          ORDER
/wefts.html                     shop.js (browser)
/volume-wefts.html                cart in localStorage:
/plus-lace-wefts.html             [{variationId, qty}]
   |  fetch on load                    |  POST at checkout
   v                                   v
/api/catalog                    /api/checkout
  Square Catalog API              Square Orders + Payment Links
  location L0MRDCWWBFR3Z          location L0MRDCWWBFR3Z
  cached 10 min at the edge       returns { url }
   |                                   |
   v                                   v
{ colors, lengths,              redirect to Square-hosted
  variations[] }                checkout
```

### `/api/catalog`

Reads the five master items from Square, scoped **by item ID** so unrelated items
in the shared library (Clip In Sets, the ~90 Maria Nila retail products, the
legacy Purple Crown items) are never fetched and cannot affect the result.

Flattens to `variations[]`, each `{ variationId, sku, method, collection, color,
length, price }`. Cached ten minutes. The Square token is server-side only and
never reaches the browser.

### The configurator

Client-side and stateless. Method is fixed by which page you are on; Collection,
Color and Length narrow `variations[]` until one remains and its price shows.

The invalid-combination rules are not written anywhere in the page code. Those
variations do not exist in the data, so those options never render. One source of
truth, in Square.

### Cart and checkout

`localStorage` holds variation IDs and quantities only — **never prices**.
`/api/checkout` re-reads each variation from Square and builds the order there,
so the amount charged is always Square's current price. A stale cart or an edited
browser cannot change what anyone pays.

### The seam for logins

`/api/catalog` is the single choke point. When logins arrive, that one function
checks the session before including `price`, and returns a priceless catalog to
everyone else. The pages must already render correctly with `price` absent —
that is the same code path as the unavailable state — so turning the gate on is a
change to one file, not a rebuild.

## Fault protection

**1. A shop failure cannot take the site down.** The configurator ships as its own
`shop.js`, loaded only by the three new pages. `index.html`, `who-we-are.html`,
`become-certified.html`, `contact.html` and `professional-login.html` never
reference it and never call `/api/*`. There is no code path from a Square outage
to the lead funnel — the code is absent, not merely guarded.

**2. Never show or charge a wrong price.** `/api/catalog` validates what Square
returned against the contract above — five items present, 121 variations, no Plus
Lace outside Coffee Collection, nothing but Single Colors at 27"-29" — before
serving anything. On mismatch it refuses, writes the mismatch to the Vercel
runtime log, and the pages show unavailable. The failure mode is "come back
shortly", never a wrong number.

*Refinement from the conversation:* because the query is scoped to the five item
IDs, Jessica adding an unrelated line does not trip the gate. It fires only when
those five items themselves change shape, which is exactly when a human should
look. The expected counts live in one constant, bumped deliberately.

**3. Rate limiting.** At the platform edge via Vercel firewall rules (available on
Pro), so a scraper never reaches the function and costs nothing in compute. In-code
fallback if the rule cannot be expressed there. **This is a speed bump, not a
defence** — while the pages are ungated, a patient scraper still gets the price
list. The login is the real fix.

**4. No bad deploy reaches production.** Work lands on a branch; Vercel builds a
preview URL; the three pages are verified in Chrome against real Square data;
only then does it merge to `master`. Vercel retains prior deploys, so rollback is
one click to the last good one.

## Testing

Node 24 ships a test runner, so tests add no dependency and no build step.

- **Catalog shaping and the sanity gate** — unit tests against fixtures derived
  from `build_catalog.py`'s output, which already knows all 121 valid
  combinations. Includes the negative cases: 120 variations, a Plus Lace single
  colour, a Coffee 27"-29".
- **Configurator narrowing** — given the fixture, every one of the 121 paths
  resolves to exactly one variation, and no invalid option is ever offered.
- **Cart** — round-trips through localStorage, survives a corrupt entry, and
  never persists a price.
- **End to end** — the three pages driven in Chrome on a Vercel preview, and one
  real bundle put through to a Square checkout link in **sandbox** before
  anything points at the live location.

## Prerequisites (Daniel)

1. Create a Square application and generate an access token in the Square
   Developer dashboard — sandbox first, production later.
2. Add it to the Vercel project as an environment variable. Claude never handles
   the value.

Until step 2 exists, `/api/catalog` returns "not configured" and the pages show
the unavailable state. **All of this can be built, merged and deployed before the
token exists**; it turns on when the variable is set.

## Known risk

Phase one publishes the wholesale price list to the open web. The client brief is
explicit that pricing is trade-only and not public. Daniel accepted this
knowingly to get the shop working sooner. It should be closed before the site is
promoted to the client or pointed at `purplecrownextensions.com`.

## Out of scope

Order history; Salon Partner minimum buy-in enforcement; differential pricing
between Certified Stylist and Salon Partner; retail pricing or the Purple Chair
location; attaching `purplecrownextensions.com`; the unpublished Square Online
sites; legacy Square catalog cleanup.
