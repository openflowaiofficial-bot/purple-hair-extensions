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
const DEFAULT_PENDING_GROUP = 'Class attendees/pending approval';
const GROUP_CACHE_TTL = 3600; // 1 hour

function groupName() {
  return (process.env.SQUARE_PROFESSIONAL_GROUP || DEFAULT_GROUP).trim();
}

// Where someone lands when they buy a class. Membership of THIS group grants
// nothing: _approval.js only ever asks about the professionals group, so a
// class attendee cannot sign in, order, or see wholesale pricing. It is a
// waiting room, and being in it is not an approval.
function pendingGroupName() {
  return (process.env.SQUARE_PENDING_GROUP || DEFAULT_PENDING_GROUP).trim();
}

function cacheKey(name) {
  return 'square:groupid:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Cached for an hour: a group id does not change, and this would otherwise be
// an extra Square call on every request that touches an account.
async function resolveNamedGroupId(wanted, deps) {
  const caller = (deps && deps.call) || call;
  const kv = (deps && deps.store) || store;
  const key = cacheKey(wanted);

  try {
    const cached = await kv.get(key);
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
      try { await kv.setWithTtl(key, { id: found.id, name: wanted }, GROUP_CACHE_TTL); } catch {}
      return found.id;
    }
    cursor = result.cursor;
    if (!cursor) break;
  }
  return null;
}

function resolveGroupId(deps) {
  return resolveNamedGroupId(groupName(), deps);
}

function resolvePendingGroupId(deps) {
  return resolveNamedGroupId(pendingGroupName(), deps);
}

// Square's own membership call. Idempotent: adding someone already in the
// group is not an error, which matters because a webhook can arrive twice.
async function addToGroup(customerId, groupId, deps) {
  const caller = (deps && deps.call) || call;
  return caller('/v2/customers/' + encodeURIComponent(customerId) +
                '/groups/' + encodeURIComponent(groupId), { method: 'PUT' });
}

async function createCustomer(fields, deps) {
  const caller = (deps && deps.call) || call;
  const result = await caller('/v2/customers', {
    method: 'POST',
    body: {
      idempotency_key: fields.idempotencyKey,
      email_address: fields.email,
      given_name: fields.givenName || undefined,
      family_name: fields.familyName || undefined,
      phone_number: fields.phone || undefined,
      note: fields.note || undefined
    }
  });
  return (result && result.customer) || null;
}

// Everyone in a group. Used by the invitation job, which has to notice people
// the owner moved by hand.
async function listGroupMembers(groupId, deps) {
  const caller = (deps && deps.call) || call;
  const out = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const result = await caller('/v2/customers/search', {
      method: 'POST',
      body: {
        limit: 100,
        cursor,
        query: { filter: { group_ids: { any: [groupId] } } }
      }
    });
    out.push(...((result && result.customers) || []));
    cursor = result && result.cursor;
    if (!cursor) break;
  }
  return out;
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
  DEFAULT_GROUP, DEFAULT_PENDING_GROUP, GROUP_CACHE_TTL, cacheKey,
  groupName, pendingGroupName,
  resolveNamedGroupId, resolveGroupId, resolvePendingGroupId,
  customerById, customerByEmail, inGroup,
  addToGroup, createCustomer, listGroupMembers
};
