// tools/square-inspect.js
//
// Prints the few Square ids the site needs configuring with. Run it yourself —
// it reads the token from your environment, uses it once, and never prints it,
// stores it, or sends it anywhere but Square.
//
//   Windows PowerShell:
//     $env:SQUARE_ACCESS_TOKEN = "..."   ; node tools/square-inspect.js
//     Remove-Item Env:\SQUARE_ACCESS_TOKEN
//
//   bash:
//     SQUARE_ACCESS_TOKEN="..." node tools/square-inspect.js
//
// Nothing it prints is a secret: group ids and catalog ids are not credentials
// and are safe to paste into an email, a ticket, or a chat.
const TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';
const BASE = process.env.SQUARE_API_BASE || 'https://connect.squareup.com';
const VERSION = process.env.SQUARE_VERSION || '2025-01-23';

if (!TOKEN) {
  console.error('SQUARE_ACCESS_TOKEN is not set. See the comment at the top of this file.');
  process.exit(1);
}

async function call(path, options) {
  const res = await fetch(BASE + path, {
    method: (options && options.method) || 'GET',
    headers: {
      'Square-Version': VERSION,
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json'
    },
    body: options && options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    // Status only. An error body can echo the request, bearer token included.
    throw new Error(path + ' -> HTTP ' + res.status);
  }
  return res.json();
}

function heading(text) {
  console.log('\n' + text);
  console.log('-'.repeat(text.length));
}

(async () => {
  heading('Customer groups');
  let groups = [];
  try {
    const result = await call('/v2/customers/groups');
    groups = result.groups || [];
    if (!groups.length) console.log('  (none — the groups need creating in Square first)');
    for (const g of groups) console.log('  ' + g.name + '\n    id: ' + g.id);
  } catch (err) {
    console.log('  FAILED: ' + err.message);
    console.log('  If this is a 403, the token is missing the CUSTOMERS_READ permission.');
  }

  const WANTED = ['Certified Stylists/Salon Partners', 'Class attendees/pending approval'];
  heading('Do the names the site expects exist?');
  for (const want of WANTED) {
    const hit = groups.find((g) => g.name.trim().toLowerCase() === want.toLowerCase());
    console.log('  ' + (hit ? 'FOUND   ' : 'MISSING ') + want);
    if (!hit) {
      const near = groups.find((g) => g.name.toLowerCase().includes(want.split('/')[0].toLowerCase()));
      if (near) console.log('          closest match in Square: "' + near.name + '"');
    }
  }

  heading('Catalog items (looking for the class)');
  try {
    let cursor;
    const items = [];
    for (let page = 0; page < 20; page++) {
      const qs = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
      const result = await call('/v2/catalog/list?types=ITEM' + qs);
      items.push(...(result.objects || []));
      cursor = result.cursor;
      if (!cursor) break;
    }
    // The class is not a weft, so anything with a PCE- SKU is filtered out to
    // keep this readable.
    const notHair = items.filter((o) => {
      const vars = (o.item_data && o.item_data.variations) || [];
      return !vars.some((v) => (v.item_variation_data.sku || '').startsWith('PCE-'));
    });
    if (!notHair.length) console.log('  (every item looks like hair — the class may not exist as a catalog item yet)');
    for (const o of notHair) {
      console.log('  ' + (o.item_data && o.item_data.name));
      console.log('    item id: ' + o.id);
      for (const v of (o.item_data && o.item_data.variations) || []) {
        console.log('    variation: ' + (v.item_variation_data.name || '(default)') +
                    '  id: ' + v.id);
      }
    }
    console.log('\n  SQUARE_CLASS_CATALOG_IDS wants the VARIATION id of the class.');
  } catch (err) {
    console.log('  FAILED: ' + err.message);
    console.log('  If this is a 403, the token is missing the ITEMS_READ permission.');
  }

  heading('Permissions this site needs');
  const checks = [
    ['ITEMS_READ', '/v2/catalog/list?types=ITEM'],
    ['CUSTOMERS_READ', '/v2/customers/groups'],
    ['ORDERS_READ', null]
  ];
  for (const [name, path] of checks) {
    if (!path) { console.log('  ' + name + ': needed for order history and spend (not probed here)'); continue; }
    try { await call(path); console.log('  ' + name + ': ok'); }
    catch { console.log('  ' + name + ': MISSING or failing'); }
  }
  console.log('\n  Also needed and not probed: CUSTOMERS_WRITE (enrolling class buyers).');
  console.log('\nNothing above is a secret. The token was never printed.');
})();
