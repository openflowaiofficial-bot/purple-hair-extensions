# The Purple Crown Extensions

Public marketing site for **The Purple Crown Extensions** — a professional-only hair
extension house selling to licensed stylists and salons. Never to consumers.

Live: https://purple-hair-extensions.vercel.app · Intended domain:
**www.purplecrownextensions.com**

## Stack

Plain static HTML / CSS / JavaScript — no build step. Open any page from disk.

| File | Role |
| --- | --- |
| `index.html` | Home — the hair, the collections, the two ways in |
| `who-we-are.html` | Brand story, sourcing heritage, commitments |
| `become-certified.html` | Crown Your Style, class calendar, Salon Partner section |
| `professional-login.html` | Wholesale access, what is inside an account |
| `contact.html` | Contact form and direct routes |
| `styles.css` · `main.js` | One shared stylesheet, one shared script |
| `crest.svg` · `favicon.svg` | Line crown mark |

## Design system

Built to the client brief of 2026-08-07.

- **Palette** — warm ivory `#f8f4ed` is the page. Near-black `#131013`, deep amethyst
  `#5a2d6e` as a *recognisable accent* only, subtle champagne `#d6bd8a`. The site is
  deliberately **not** mostly purple.
- **Type** — Bodoni Moda for headlines, Jost for body. No monospace: it reads technical.
  Bodoni's optical size is pinned to `opsz 11`; on `auto` the browser picks the 96 master
  and its hairlines antialias away.
- **Grounds** — a band declares its ink (`--fg`, `--fg-soft`, `--fg-mark`, `--fg-rule`)
  and components consume it. Never pick colour by descendant selector.
- **Restraint** — minimal borders, no rounded cards, no gradients as filler. Hierarchy
  comes from space and scale.

## Photography

**The site is designed around large hair photography that does not exist yet.** Every
image position is a `.frame` — a quiet tonal field, deliberately not an outlined box.
Search the HTML for `<!-- PHOTO:` to find each slot and what it should hold.

To place a real image, drop an `<img class="shot">` inside the frame:

```html
<div class="frame frame-portrait">
  <img class="shot" src="hair-01.jpg" alt="" />
</div>
```

The hero takes `<img class="hero-shot">` as the first child of `.hero`.

## Not yet wired up

- **Class dates are placeholders.** See the comment above the calendar in
  `become-certified.html`. Each row becomes a bookable class — as a Shopify product with
  the date as a variant and seats as inventory — and `REGISTER` should point at it.
- **Professional Login** links to email. Point it at the Shopify customer login once the
  store exists (`WIRE UP` comment in `professional-login.html`).
- **The contact form does not send.** It validates, then hands the visitor a pre-filled
  `mailto:` and says plainly that nothing was transmitted. It never prints a receipt for
  a message that was not sent.

## Deploy

Static site on [Vercel](https://vercel.com), connected to this repo — a push to `master`
deploys to production. `master` is the default branch; there is no `main`.
