// api/catalog.js
const { fetchCatalog, LOCATION_ID, token } = require('./_square.js');
const { shape } = require('./_shape.js');
const { validate } = require('./_contract.js');
const { hasSession, configured } = require('./_session.js');

// The third argument is a seam for tests only; Vercel calls the handler with
// two. Fail-closed, in this exact order:
//   1. Square token missing            -> 503 not_configured
//   2. session gate not configured     -> 503 not_configured
//   3. no valid session cookie         -> 401 unauthenticated (no `variations` key)
//   4. upstream Square failure         -> 503 upstream
//   5. contract violation              -> 503 contract (problems logged server-side only)
//   6. success                         -> 200 {variations}, cached
module.exports = async function handler(req, res, fetcher) {
  if (!token()) {
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'not_configured' });
  }

  if (!configured()) {
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'not_configured' });
  }

  if (!hasSession(req)) {
    return res.status(401).json({ error: 'Sign in to view the catalogue', reason: 'unauthenticated' });
  }

  let body;
  try {
    body = await (fetcher || fetchCatalog)();
  } catch (err) {
    console.error('catalog upstream failed:', err.message);
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'upstream' });
  }

  // TEMPORARY DIAGNOSTIC — counts only, no secrets and no product data beyond
  // SKU prefixes. Remove once the empty-catalog cause is found.
  try {
    const objs = (body && body.objects) || [];
    const items = objs.filter(o => o && o.type === 'ITEM');
    const vars = items.flatMap(i => (i.item_data && i.item_data.variations) || []);
    const withSku = vars.filter(v => v.item_variation_data && v.item_variation_data.sku);
    const pce = withSku.filter(v => v.item_variation_data.sku.startsWith('PCE-'));
    const withBase = pce.filter(v => v.item_variation_data.price_money);
    const withOverride = pce.filter(v => (v.item_variation_data.location_overrides || []).length);
    const sampleSkus = withSku.slice(0, 5).map(v => v.item_variation_data.sku);
    const itemNames = items.slice(0, 8).map(i => i.item_data && i.item_data.name);
    console.error('DIAG objects=' + objs.length +
      ' items=' + items.length +
      ' variations=' + vars.length +
      ' withSku=' + withSku.length +
      ' pcePrefix=' + pce.length +
      ' pceWithBasePrice=' + withBase.length +
      ' pceWithAnyOverride=' + withOverride.length +
      ' locationId=' + LOCATION_ID +
      ' sampleSkus=' + JSON.stringify(sampleSkus) +
      ' itemNames=' + JSON.stringify(itemNames));
  } catch (e) {
    console.error('DIAG failed:', e.message);
  }

  const variations = shape(body, LOCATION_ID);
  const check = validate(variations);
  if (!check.ok) {
    console.error('catalog contract broken:', check.problems.join('; '));
    return res.status(503).json({ error: 'Catalog unavailable', reason: 'contract' });
  }

  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=60');
  return res.status(200).json({ variations });
};
