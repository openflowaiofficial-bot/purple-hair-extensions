// api/_square.js
// Thin Square Catalog API client. No dependencies beyond global fetch.
// Never embed credential values here — they come only from process.env at
// request time, and defaults below are non-secret configuration only
// (a public API host, a public API version string, a public location id).
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'L0MRDCWWBFR3Z';
const API_BASE = process.env.SQUARE_API_BASE || 'https://connect.squareup.com';
const VERSION = process.env.SQUARE_VERSION || '2025-01-23';
const MAX_PAGES = 50;

function token() { return process.env.SQUARE_ACCESS_TOKEN || ''; }

async function call(path, options) {
  const res = await fetch(API_BASE + path, {
    method: (options && options.method) || 'GET',
    headers: {
      'Square-Version': VERSION,
      'Authorization': 'Bearer ' + token(),
      'Content-Type': 'application/json'
    },
    body: options && options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    // Never include the response body verbatim — it can echo request headers
    // (including the bearer token), so only the status code is surfaced.
    throw new Error('square_http_' + res.status);
  }
  return res.json();
}

// Every ITEM in the library, with variations. Filtering to PCE- happens in
// _shape. The list endpoint paginates at roughly 100 objects per page and
// this library holds around 500 objects, so a single call only returns a
// fraction of the catalog. Follow `cursor` until Square stops returning one,
// concatenating `objects` across pages, capped so a misbehaving upstream
// can't spin this forever.
async function fetchCatalog() {
  let cursor;
  let objects = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const result = await call(`/v2/catalog/list?types=ITEM${qs}`);
    objects = objects.concat(result.objects || []);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return { objects };
}

module.exports = { call, fetchCatalog, LOCATION_ID, token };
