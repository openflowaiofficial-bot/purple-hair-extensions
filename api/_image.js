// api/_image.js
// What an uploaded profile picture is allowed to be.
//
// The browser resizes and re-encodes before uploading, but nothing here trusts
// that: a request can be made by anything, and a declared Content-Type is just
// a string the client chose. So the bytes themselves are checked.
//
// SVG is deliberately absent. An SVG is a document that can carry script, and
// a profile picture has no business being one.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

const SIGNATURES = [
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', test: (b) => b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { type: 'image/webp', ext: 'webp', test: (b) => b.length > 12 &&
      b.slice(0, 4).toString('latin1') === 'RIFF' &&
      b.slice(8, 12).toString('latin1') === 'WEBP' }
];

// Returns { ok:true, type, ext } or { ok:false, reason }.
// `reason` is a short code, never the bytes and never a filename.
function inspect(buffer) {
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty' };
  if (buffer.length > MAX_BYTES) return { ok: false, reason: 'too_large' };

  for (const sig of SIGNATURES) {
    if (sig.test(buffer)) return { ok: true, type: sig.type, ext: sig.ext };
  }
  // Anything whose first bytes are not a JPEG, PNG or WebP header — including
  // an SVG, an HTML file, or a PNG-named executable — stops here.
  return { ok: false, reason: 'unsupported_type' };
}

module.exports = { inspect, MAX_BYTES, SIGNATURES };
