// api/_session.js
// Signed-cookie sessions for the wholesale shop gate. No dependencies beyond
// node:crypto. Never import or embed credential values here — they come
// only from process.env at request time.
const crypto = require('node:crypto');

const COOKIE_NAME = 'pce_session';
const TTL_SECONDS = 43200; // 12 hours

function configured() {
  return !!(process.env.SHOP_EMAIL && process.env.SHOP_PASSWORD && process.env.SESSION_SECRET);
}

// Hash-then-compare: both sides always collapse to a fixed-length SHA-256
// digest before crypto.timingSafeEqual sees them, so inputs of unequal
// length (attacker-controlled or otherwise) neither throw nor leak timing
// information about how long the real value is.
function safeEqualStrings(a, b) {
  const da = crypto.createHash('sha256').update(String(a)).digest();
  const db = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(da, db);
}

// Refuses to sign or check anything with a missing/empty key rather than
// silently falling back to ''. Because the algorithm is public (this repo
// is public), an empty-string key is a forgeable, publicly-known key —
// not a safe default.
function hmac(body) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  return crypto.createHmac('sha256', secret).update(body).digest();
}

// `subject` is the professional account id, when there is one. It is optional
// on purpose: the shared wholesale login predates per-professional accounts and
// still issues a subject-less session, which grants shop access and no account
// identity. Nothing may infer an identity from its absence.
function sign(expiresAtMs, subject) {
  const payload = { exp: expiresAtMs };
  if (typeof subject === 'string' && subject !== '') payload.sub = subject;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = hmac(body).toString('base64url');
  return body + '.' + sig;
}

// The whole verified payload, or null. verify() is the boolean form of this;
// both go through exactly the same checks, so a caller that wants the subject
// cannot accidentally skip one.
function readToken(token) {
  // Fail closed: with any of the three vars missing there is no safe key
  // to check a signature against, so no token can ever verify — this must
  // not depend on every caller remembering to check configured() first.
  if (!configured()) return null;
  try {
    if (typeof token !== 'string' || token === '') return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    if (!body || !sig) return null;

    const expectedSig = hmac(body).toString('base64url');
    if (!safeEqualStrings(sig, expectedSig)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

function verify(token) {
  return readToken(token) !== null;
}

function readCookie(req, name) {
  const header = req && req.headers && req.headers.cookie;
  if (typeof header !== 'string' || header === '') return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return null;
}

function hasSession(req) {
  return verify(readCookie(req, COOKIE_NAME));
}

// The account id this session belongs to, or null for the shared wholesale
// login. A caller that needs an account MUST treat null as "no account", never
// as "any account".
function sessionSubject(req) {
  const payload = readToken(readCookie(req, COOKIE_NAME));
  return payload && typeof payload.sub === 'string' && payload.sub !== ''
    ? payload.sub
    : null;
}

function cookieHeader(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// Never logs or returns email/password. Both comparisons are always
// evaluated (no short-circuit) so a wrong email and a wrong password take
// the same code path and the same time.
function credentialsMatch(email, password) {
  const configuredEmail = process.env.SHOP_EMAIL;
  const configuredPassword = process.env.SHOP_PASSWORD;
  if (!configuredEmail || !configuredPassword) return false;
  if (typeof email !== 'string' || typeof password !== 'string') return false;

  const emailOk = safeEqualStrings(email.trim().toLowerCase(), configuredEmail.trim().toLowerCase());
  const passwordOk = safeEqualStrings(password, configuredPassword);
  return emailOk && passwordOk;
}

module.exports = {
  COOKIE_NAME,
  TTL_SECONDS,
  configured,
  sign,
  verify,
  readToken,
  sessionSubject,
  readCookie,
  hasSession,
  cookieHeader,
  credentialsMatch
};
