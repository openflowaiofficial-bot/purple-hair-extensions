# The Purple Crown Extensions

Trade-only marketing and partner-application site for **The Purple Crown Extensions (TPC)** —
custom mesh integration systems and hand-tied / machine wefts, sold to licensed salons and
stylists only. Never to consumers.

## Stack

Plain static HTML / CSS / JavaScript — no build step. Open any page from disk.

| File | Role |
| --- | --- |
| `index.html` | Home — hero build sheet, the two methods, color lab, process |
| `mesh-integration.html` · `wefts.html` | The two products |
| `customization.html` | The color lab and the interactive shade ring |
| `education.html` · `about.html` | Certification, the house |
| `partner.html` | The application — the site's only conversion goal |
| `styles.css` | One shared stylesheet |
| `main.js` | One shared script |
| `crest.svg` · `favicon.svg` | Flat gold line crown, drawn to the hairline weight of the seam |

## Design system

- **Palette** — noir-violet `#120c18`, aubergine `#24152e`, antique gold `#c6a268`,
  bone `#f4f1f6`.
- **Type** — Bodoni Moda (display), Jost (body/labels), IBM Plex Mono (specs and shade codes).
  Bodoni's optical size is **pinned to `opsz 11`** wherever it is set large; on `auto` the
  browser picks the 96 master and its hairlines antialias away at 1x.
- **Signature elements** — the hero strand field, the shade ring on `customization.html`,
  and the seam divider (a hairline with descending ticks, like a hand-tied weft row).
- **Ground model** — colour is never picked by descendant selector. A section declares a
  ground (`--fg-display`, `--fg-accent`, `--fg-body`, `--fg-faint`, `--rule`) and components
  consume those tokens. Dark islands (`.plate`, `.form-shell`, `.order-stub`) re-declare the
  dark set on themselves so they cannot inherit light-ground ink.
- **Image slots** — there is no photography yet. `.plate` elements are deliberate drawn
  panels with a filament texture and a TPC monogram. To swap in a photo, replace the
  `.plate` contents with `<img class="plate-img">` at the same aspect class.

## Form submissions

`partner.html` POSTs JSON to `/api/apply`. **It only shows the confirmation panel on a 2xx
response.** Any other outcome reveals a failure state with a pre-filled `mailto:` fallback —
the form never prints a receipt for a message that was not transmitted. Point `action` at a
Vercel serverless function or a CRM webhook before launch.

## Tooling

```bash
./render.sh      # full-page PNGs of every page into screens/ (headless Chrome, no deps)
node check.mjs   # runtime assertions: contrast, ring semantics, form failure path, gutters
```

## Deploy

Static site on [Vercel](https://vercel.com) — no build configuration needed.

The Vercel project is connected to this repo, so a push to `master` deploys to
production. `master` is the default branch; there is no `main`.
