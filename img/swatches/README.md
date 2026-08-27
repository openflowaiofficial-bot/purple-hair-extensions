# Colour swatches

One photograph per colour, shown as the thumbnail on the Colour row of the
wholesale configurator (`wefts.html`, `volume-wefts.html`, `plus-lace-wefts.html`).

## Naming

`shop.js` derives the filename from the colour name Square returns — nothing is
hardcoded, so a new colour in Square picks up its thumbnail the moment the file
lands here. Lowercase, non-alphanumerics collapsed to a single hyphen, `.jpg`:

    "Caramel Macchiato"  ->  caramel-macchiato.jpg

A missing file is not an error. The chip falls back to the same quiet tonal
field a `.frame` uses while it waits for photography, and the colour name stays
printed underneath either way.

## The fourteen

Coffee Collection

| Colour | File |
| --- | --- |
| Chai Latte | `chai-latte.jpg` |
| French Vanilla | `french-vanilla.jpg` |
| Cafe Latte | `cafe-latte.jpg` |
| Toasted Hazelnut | `toasted-hazelnut.jpg` |
| Cappuccino | `cappuccino.jpg` |
| Caramel Macchiato | `caramel-macchiato.jpg` |
| Pumpkin Spice | `pumpkin-spice.jpg` |
| Peppermint Mocha | `peppermint-mocha.jpg` |
| Espresso Bean | `espresso-bean.jpg` |

Single Colors

| Colour | File |
| --- | --- |
| Brittany | `brittany.jpg` |
| Margo | `margo.jpg` |
| Amber | `amber.jpg` |
| Jayla | `jayla.jpg` |
| Jade | `jade.jpg` |

## The files themselves

Square crops, so shoot or crop square. The thumbnail renders at roughly 116px
and the hover preview at 178px, both on retina — **600×600 is plenty**, and
keeps the colour row light on a salon's phone signal. Save as JPEG at quality
~80.

Photograph the hair filling the frame edge to edge, no background, no hand, no
weft track — the swatch is the shade, not the product shot.
