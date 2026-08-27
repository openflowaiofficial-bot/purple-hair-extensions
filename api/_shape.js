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
      const [color, length] = String(d.name || '').split('|').map(s => s.trim());
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
