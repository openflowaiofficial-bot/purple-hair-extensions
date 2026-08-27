const { COFFEE } = require('./_contract.js');

function priceAt(variationData, locationId) {
  const override = (variationData.location_overrides || [])
    .find(o => o.location_id === locationId);
  const money = override && override.price_money;
  return money && Number.isInteger(money.amount) ? money.amount : null;
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
