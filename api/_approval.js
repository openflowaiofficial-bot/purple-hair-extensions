// api/_approval.js
// One answer to "is this person a professional right now", asked by every
// endpoint that needs it, so the four of them cannot drift apart.
//
// Two things must both hold:
//
//   1. the local record is not switched off  (account.approved in KV)
//   2. their Square customer is in the professionals group  (live, every time)
//
// Square is the live authority: remove someone from the group and their next
// request is refused. The KV flag is a local kill-switch for the case where
// access must be cut without touching Square.
//
// It fails CLOSED. If Square cannot be reached, or the group cannot be found,
// nobody is approved. That means a Square outage locks professionals out of
// the portal — a deliberate trade. The alternative is granting access on the
// strength of a request that failed, which for a wholesale account is worse
// than an hour of downtime.
const groups = require('./_groups.js');
const { token } = require('./_square.js');

// Returns { ok:true } or { ok:false, reason }
//   'blocked'          the local record is switched off
//   'unlinked'         no Square customer on the account
//   'not_configured'   no Square token, or the group name matches nothing
//   'not_in_group'     the customer exists but is not a professional
//   'upstream'         Square could not be reached
async function check(account, deps) {
  if (!account) return { ok: false, reason: 'blocked' };
  if (!account.approved) return { ok: false, reason: 'blocked' };
  if (!account.squareCustomerId) return { ok: false, reason: 'unlinked' };
  if (!token()) return { ok: false, reason: 'not_configured' };

  let groupId;
  try {
    groupId = await (deps && deps.resolveGroupId ? deps.resolveGroupId(deps) : groups.resolveGroupId(deps));
  } catch (err) {
    console.error('group lookup failed:', err.message);
    return { ok: false, reason: 'upstream' };
  }
  if (!groupId) {
    console.error('professionals group not found in Square:', groups.groupName());
    return { ok: false, reason: 'not_configured' };
  }

  let customer;
  try {
    customer = await (deps && deps.customerById
      ? deps.customerById(account.squareCustomerId, deps)
      : groups.customerById(account.squareCustomerId, deps));
  } catch (err) {
    console.error('customer lookup failed:', err.message);
    return { ok: false, reason: 'upstream' };
  }

  const member = deps && deps.inGroup
    ? deps.inGroup(customer, groupId)
    : groups.inGroup(customer, groupId);

  return member ? { ok: true } : { ok: false, reason: 'not_in_group' };
}

module.exports = { check };
