const SINGLE = ['Brittany', 'Margo', 'Amber', 'Jayla', 'Jade'];
const COFFEE = ['Chai Latte', 'French Vanilla', 'Cafe Latte', 'Toasted Hazelnut',
  'Cappuccino', 'Caramel Macchiato', 'Pumpkin Spice', 'Peppermint Mocha', 'Espresso Bean',
  'Chocolate Truffle'];
const LENGTHS = ['14"-16"', '18"-20"', '22"-24"', '27"-29"'];
const EXPECTED_ITEMS = 5;

/* The count is a tripwire for a half-delivered catalogue, so it is exact.
   2026-08-28: the Chocolate Truffle migration completed — the colour now
   exists in Square on WFT, VOL and PLS at the three Coffee lengths
   (10 Coffee colours x 3 lengths x 3 methods + 5 Single colours x 4 lengths
   x 2 methods = 130), and the transitional [121, 130] window is closed. */
const EXPECTED_VARIATIONS = 130;
const ACCEPTED_VARIATIONS = [130];

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
