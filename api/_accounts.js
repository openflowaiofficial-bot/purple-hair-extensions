// api/_accounts.js
// A professional account is a thin record in KV pointing at a Square customer.
// Square stays the system of record for anything to do with money: orders,
// totals, spend. Nothing financial is stored here, so nothing here can drift
// out of step with Square.
//
// Keys
//   acct:<id>            the account record
//   acct:email:<email>   lowercased email -> account id
//   signin:<token>       single-use sign-in token -> account id (TTL'd)
const store = require('./_store.js');

// Fields a professional may change about themselves. Anything not on this list
// is ignored, so a crafted request cannot promote an account, point it at
// another Square customer, or edit its own approval state.
//
// avatarUrl is deliberately NOT here. It lives on the account rather than in
// the profile, and is only ever written by api/avatar.js from a URL that
// storage just returned. If it were editable a professional could point their
// picture at any address on the internet.
const EDITABLE = ['salonName', 'contactName', 'phone', 'licenseNumber',
  'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'];

const MAX_FIELD = 200;

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function accountKey(id) { return 'acct:' + id; }
function emailKey(email) { return 'acct:email:' + normaliseEmail(email); }

async function byId(id) {
  if (!id || typeof id !== 'string') return null;
  return store.get(accountKey(id));
}

async function byEmail(email) {
  const normalised = normaliseEmail(email);
  if (!normalised) return null;
  const id = await store.get(emailKey(normalised));
  return id ? byId(typeof id === 'string' ? id : String(id)) : null;
}

// Only ever called by whoever approves a professional — never from a public
// endpoint. Creating an account is an approval decision, not a signup.
async function create({ id, email, squareCustomerId, profile, approved }) {
  const record = {
    id,
    email: normaliseEmail(email),
    squareCustomerId: squareCustomerId || null,
    avatarUrl: null,
    // The local switch. Square's group is the live authority — see
    // _approval.js — and this only ever takes access away, never grants it.
    approved: approved !== false,
    createdAt: new Date().toISOString(),
    profile: sanitiseProfile(profile || {})
  };
  await store.set(accountKey(id), record);
  await store.set(emailKey(record.email), id);
  return record;
}

// Trims, caps length, and drops anything not explicitly editable.
function sanitiseProfile(input) {
  const out = {};
  for (const field of EDITABLE) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const value = input[field];
      if (value === null || value === undefined) continue;
      out[field] = String(value).trim().slice(0, MAX_FIELD);
    }
  }
  return out;
}

// Written only by api/avatar.js, and only with a URL that storage returned a
// moment earlier. Passing null removes the picture.
async function setAvatar(id, url) {
  const account = await byId(id);
  if (!account) return null;
  const next = {
    ...account,
    avatarUrl: url || null,
    updatedAt: new Date().toISOString()
  };
  await store.set(accountKey(id), next);
  return next;
}

async function updateProfile(id, input) {
  const account = await byId(id);
  if (!account) return null;
  const next = {
    ...account,
    profile: { ...(account.profile || {}), ...sanitiseProfile(input) },
    updatedAt: new Date().toISOString()
  };
  await store.set(accountKey(id), next);
  return next;
}

// What the browser is allowed to see. Deliberately omits internal fields so a
// future addition is opt-in rather than leaked by default.
function publicView(account) {
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    approved: !!account.approved,
    avatarUrl: account.avatarUrl || null,
    profile: account.profile || {}
  };
}

module.exports = {
  EDITABLE, normaliseEmail, byId, byEmail, create, updateProfile, setAvatar,
  sanitiseProfile, publicView, accountKey, emailKey
};
