const { COFFEE } = require('./_contract.js');

function priceAt(variationData, locationId) {
  const override = (variationData.location_overrides || [])
    .find(o => o.location_id === locationId);
  const overrideMoney = override && override.price_money;
  if (overrideMoney && Number.isInteger(overrideMoney.amount)) return overrideMoney.amount;

  // Square only stores a location override where that location's price
  // differs from the base price. No override for `locationId` means that
  // location charges the base price, so fall back to it. Never fall back to
  // another location's override.
  const baseMoney = variationData.price_money;
  return baseMoney && Number.isInteger(baseMoney.amount) ? baseMoney.amount : null;
}

function shape(body, locationId) {
  const out = [];
  for (const obj of body.objects || []) {
    if (obj.type !== 'ITEM') continue;
    for (const v of (obj.item_data && obj.item_data.variations) || []) {
      const d = v.item_variation_data || {};
      if (!d.sku || !d.sku.startsWith('PCE-')) continue;

      const price = priceAt(d, locationId);
      if (price === null) continue;

      const [, method] = d.sku.split('-');
      // Square rebuilds a variation's name from its option values and joins them
      // with a comma ("Chai Latte, 14\"-16\""), regardless of the delimiter the
      // import file used. Our own import wrote a pipe, so accept either, and
      // split on the FIRST delimiter only: no colour or length contains one.
      const rawName = String(d.name || '');
      const cut = rawName.search(/[|,]/);
      if (cut === -1) continue;
      const color = rawName.slice(0, cut).trim();
      const length = rawName.slice(cut + 1).trim();
      if (!color || !length) continue;

      out.push({
        variationId: v.id,
        sku: d.sku,
        method,
        collection: COFFEE.includes(color) ? 'Coffee Collection' : 'Single Colors',
        color,
        length,
        price
      });
    }
  }
  return out;
}

module.exports = { shape };
