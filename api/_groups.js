// api/_groups.js
// Square customer groups. The group named below is the register of who is a
// current Purple Crown professional, so approving someone is one action in a
// tool the owner already uses: add them to the group. Removing them from it
// revokes access.
//
// The group is found by NAME rather than by a hardcoded id, because a name is
// something the owner can read and check. If the name is changed in Square
// without SQUARE_PROFESSIONAL_GROUP being changed to match, nothing resolves
// and every sign-in fails closed — which is the right direction to fail, and
// loud enough to notice.
const { call } = require('./_square.js');
const store = require('./_store.js');

const DEFAULT_GROUP = 'Certified Stylists/Salon Partners';
const GROUP_CACHE_KEY = 'square:groupid';
const GROUP_CACHE_TTL = 3600; // 1 hour

function groupName() {
  return (process.env.SQUARE_PROFESSIONAL_GROUP || DEFAULT_GROUP).trim();
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Cached for an hour: a group id does not change, and this would otherwise be
// an extra Square call on every request that touches an account.
async function resolveGroupId(deps) {
  const caller = (deps && deps.call) || call;
  const kv = (deps && deps.store) || store;
  const wanted = groupName();

  try {
    const cached = await kv.get(GROUP_CACHE_KEY);
    if (cached && cached.id && sameName(cached.name, wanted)) return cached.id;
  } catch {
    // A cache miss is not a failure; fall through and ask Square.
  }

  let cursor;
  for (let page = 0; page < 20; page++) {
    const qs = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
    const result = await caller('/v2/customers/groups' + qs);
    const found = (result.groups || []).find((g) => sameName(g.name, wanted));
    if (found) {
      try { await kv.setWithTtl(GROUP_CACHE_KEY, { id: found.id, name: wanted }, GROUP_CACHE_TTL); } catch {}
      return found.id;
    }
    cursor = result.cursor;
    if (!cursor) break;
  }
  return null;
}

async function customerById(customerId, deps) {
  const caller = (deps && deps.call) || call;
  const result = await caller('/v2/customers/' + encodeURIComponent(customerId));
  return (result && result.customer) || null;
}

// Square's exact email filter. Used only when someone asks for a sign-in link
// and has no account yet — never to browse the customer list.
async function customerByEmail(email, deps) {
  const caller = (deps && deps.call) || call;
  const result = await caller('/v2/customers/search', {
    method: 'POST',
    body: {
      limit: 2,
      query: { filter: { email_address: { exact: String(email || '').trim().toLowerCase() } } }
    }
  });
  const customers = (result && result.customers) || [];
  // Exactly one, or none. Two customers sharing an email is a data problem in
  // Square, and guessing which one to sign in as would be worse than refusing.
  return customers.length === 1 ? customers[0] : null;
}

function inGroup(customer, groupId) {
  if (!customer || !groupId) return false;
  return (customer.group_ids || []).includes(groupId);
}

module.exports = {
  DEFAULT_GROUP, GROUP_CACHE_KEY, GROUP_CACHE_TTL,
  groupName, resolveGroupId, customerById, customerByEmail, inGroup
};
