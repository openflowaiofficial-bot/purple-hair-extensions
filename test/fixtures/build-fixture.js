// Usage: node test/fixtures/build-fixture.js ~/purple-crown-catalog/purple-crown-catalog.csv
//
// Not a test: this is a one-off generator for test/fixtures/square-catalog.json.
// It lives under test/ per the task brief, which means `node --test` (run from
// the repo root) auto-discovers it via its default **/test/**/*.js glob. Guard
// against that: no-op when there's no CSV path argument, so test-runner
// auto-discovery treats this file as a trivially-passing no-op instead of
// crashing on a missing argv[2].
if (!process.argv[2]) {
  module.exports = {};
  return void 0;
}

const fs = require('fs');

const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1)
  .map(line => {
    // naive CSV split that respects double-quoted fields, including
    // an escaped quote inside a quoted field (`""` -> one literal `"`)
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });

const items = new Map();
for (const r of rows) {
  const [sku, itemName, , , , collection, color, , length, , wholesale, retail] = r;
  if (!items.has(itemName)) items.set(itemName, []);
  items.get(itemName).push({
    type: 'ITEM_VARIATION',
    id: 'VAR_' + sku,
    item_variation_data: {
      sku,
      name: `${color}, ${length}`,
      // Mirrors how Square actually stores this import: the wholesale price
      // is the base price for every variation, and a location_overrides
      // entry exists only for the retail location, since Square only stores
      // an override where that location's price differs from the base.
      price_money: { amount: Math.round(parseFloat(wholesale) * 100), currency: 'USD' },
      location_overrides: [{
        location_id: 'L1RH8QK7VWXYZ',
        price_money: { amount: Math.round(parseFloat(retail) * 100), currency: 'USD' }
      }],
      item_option_values: [
        { item_option_id: 'OPT_COLOR', item_option_value_id: 'VAL_' + color },
        { item_option_id: 'OPT_LENGTH', item_option_value_id: 'VAL_' + length }
      ]
    },
    _collection: collection, _color: color, _length: length
  });
}

const objects = [...items].map(([name, variations]) => ({
  type: 'ITEM', id: 'ITEM_' + name.replace(/\W+/g, '_'),
  item_data: { name, variations }
}));

fs.writeFileSync(__dirname + '/square-catalog.json', JSON.stringify({ objects }, null, 2));
console.log('items', objects.length, 'variations', rows.length);
