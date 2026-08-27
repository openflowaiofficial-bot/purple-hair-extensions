const SINGLE = ['Brittany', 'Margo', 'Amber', 'Jayla', 'Jade'];
const COFFEE = ['Chai Latte', 'French Vanilla', 'Cafe Latte', 'Toasted Hazelnut',
  'Cappuccino', 'Caramel Macchiato', 'Pumpkin Spice', 'Peppermint Mocha', 'Espresso Bean',
  'Chocolate Truffle'];
const LENGTHS = ['14"-16"', '18"-20"', '22"-24"', '27"-29"'];
const EXPECTED_ITEMS = 5;

/* Chocolate Truffle is listed above, and its swatch is committed, before it
   exists in Square. That order is deliberate. A colour Square has not sent yet
   simply never matches, so naming it early costs nothing — whereas a colour
   Square sends that is NOT named here is classified Single Colors by _shape.js
   and immediately trips the Plus Lace rule, taking the whole catalogue down
   with a 503.

   The count is the other half of the same trap: it is a tripwire for a
   half-delivered catalogue, so it cannot simply be relaxed. During the change
   it accepts both the before and the after and nothing else.

     121 — Square today
     130 — Square once Chocolate Truffle is added to WFT, VOL and PLS at the
           three Coffee lengths (3 methods x 3 lengths = 9 new variations)

   Once Square is updated, drop 121, regenerate the fixture from the new CSV,
   and the count is a real tripwire again. Leaving both in place indefinitely
   would mean a catalogue that had silently lost nine variations still passed. */
const EXPECTED_VARIATIONS = 121;
const ACCEPTED_VARIATIONS = [121, 130];

function validate(variations) {
  const problems = [];
  if (!ACCEPTED_VARIATIONS.includes(variations.length)) {
    problems.push(
      `expected ${ACCEPTED_VARIATIONS.join(' or ')} variations, got ${variations.length}`);
  }
  const skus = new Set(variations.map(v => v.sku));
  if (skus.size !== variations.length) problems.push('duplicate SKUs');

  for (const v of variations) {
    if (v.method === 'PLS' && v.collection !== 'Coffee Collection') {
      problems.push(`Plus Lace outside Coffee Collection: ${v.sku}`);
    }
    if (v.length === '27"-29"' && v.collection !== 'Single Colors') {
      problems.push(`27"-29" outside Single Colors: ${v.sku}`);
    }
    if (v.length === '27"-29"' && v.method === 'PLS') {
      problems.push(`Plus Lace at 27"-29": ${v.sku}`);
    }
    if (!Number.isInteger(v.price) || v.price <= 0) {
      problems.push(`missing or bad price: ${v.sku}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { validate, SINGLE, COFFEE, LENGTHS, EXPECTED_ITEMS,
  EXPECTED_VARIATIONS, ACCEPTED_VARIATIONS };
