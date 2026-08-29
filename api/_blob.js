// api/_blob.js
// Thin Vercel Blob client over its REST API. No dependencies, same reasoning
// as _square.js, _store.js and _mail.js.
//
// Never embed credential values here — they come only from process.env at
// request time.
//
// NOTE (owner): the header contract below matches what the @vercel/blob client
// sends (x-api-version 7). If Vercel revises it, this is the one file to
// change — nothing else in the project talks to Blob.
const BASE = 'https://blob.vercel-storage.com';
const API_VERSION = '7';

function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }

function configured() { return !!token(); }

// `pathname` is always built by the caller from the session's account id, never
// from anything the browser sent. See api/avatar.js.
async function put(pathname, body, contentType) {
  if (!configured()) throw new Error('blob_not_configured');
  const res = await fetch(BASE + '/' + pathname.replace(/^\/+/, ''), {
    method: 'PUT',
    headers: {
      authorization: 'Bearer ' + token(),
      'x-api-version': API_VERSION,
      'x-content-type': contentType,
      // A random suffix means a replaced picture gets a fresh URL, so a CDN or
      // a browser never serves the previous one from cache.
      'x-add-random-suffix': '1'
    },
    body
  });
  if (!res.ok) {
    // Status only: an error body can echo the request, bearer token included.
    throw new Error('blob_http_' + res.status);
  }
  const json = await res.json();
  if (!json || !json.url) throw new Error('blob_no_url');
  return json.url;
}

async function del(url) {
  if (!configured()) throw new Error('blob_not_configured');
  const res = await fetch(BASE + '/delete', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token(),
      'x-api-version': API_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ urls: [url] })
  });
  if (!res.ok) throw new Error('blob_http_' + res.status);
  return true;
}

module.exports = { configured, put, del };
