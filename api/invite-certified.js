// api/invite-certified.js
// Runs on a schedule. Anyone the owner has moved into the professionals group
// who has not been invited yet gets one email telling them they can create
// their account.
//
// A schedule rather than a webhook, deliberately: Square's customer events do
// not reliably distinguish "added to a group" from any other edit, and an
// invitation that fires on the wrong event is worse than one that arrives a
// few minutes later. Polling the group is unambiguous — membership either
// changed or it did not.
//
// Each professional is invited ONCE. The flag is written before the email is
// sent, so a job that dies midway re-sends nothing; the cost of that ordering
// is that a failed send is not retried, which is the right way round for a
// message nobody asked for twice.
//
// Fail-closed, in this order:
//   1. not POST or GET               -> 405
//   2. wrong or missing cron secret  -> 401
//   3. store/mail/Square unconfigured-> 503 not_configured
//   4. group missing                 -> 503 not_configured
//   5. otherwise                     -> 200 {invited, skipped}
const crypto = require('node:crypto');
const groupsModule = require('./_groups.js');
const storeModule = require('./_store.js');
const mailModule = require('./_mail.js');
const { token } = require('./_square.js');

const INVITE_KEY = (customerId) => 'invited:' + customerId;
const MAX_PER_RUN = 50;

function secret() { return process.env.CRON_SECRET || ''; }

// Vercel sends the cron secret as a bearer token. Checked in constant time,
// because this endpoint can email every professional in the group.
function authorised(req) {
  const expected = secret();
  if (!expected) return false;
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const provided = String(header).replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function siteOrigin(req) {
  const configured = process.env.SITE_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  const host = req && req.headers && req.headers.host;
  return host ? 'https://' + host : '';
}

module.exports = async function handler(req, res, deps) {
  const groups = (deps && deps.groups) || groupsModule;
  const kv = (deps && deps.store) || storeModule;
  const mail = (deps && deps.mail) || mailModule;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', reason: 'bad_request' });
  }

  if (!authorised(req)) {
    return res.status(401).json({ error: 'Not authorised', reason: 'unauthenticated' });
  }

  if (!kv.configured() || !mail.configured() || !token()) {
    return res.status(503).json({ error: 'Invitations unavailable', reason: 'not_configured' });
  }

  let groupId;
  try {
    groupId = await groups.resolveGroupId(deps);
  } catch (err) {
    console.error('invite: group lookup failed:', err.message);
    return res.status(503).json({ error: 'Invitations unavailable', reason: 'upstream' });
  }
  if (!groupId) {
    console.error('invite: professionals group not found:', groups.groupName());
    return res.status(503).json({ error: 'Invitations unavailable', reason: 'not_configured' });
  }

  let members;
  try {
    members = await groups.listGroupMembers(groupId, deps);
  } catch (err) {
    console.error('invite: member list failed:', err.message);
    return res.status(503).json({ error: 'Invitations unavailable', reason: 'upstream' });
  }

  const origin = siteOrigin(req);
  let invited = 0;
  let skipped = 0;
  const problems = [];

  for (const customer of members.slice(0, MAX_PER_RUN)) {
    const email = customer && customer.email_address;
    if (!email) { skipped++; continue; }

    try {
      if (await kv.get(INVITE_KEY(customer.id))) { skipped++; continue; }
    } catch (err) {
      // Unable to tell whether they were invited. Skipping risks a delay;
      // sending risks a duplicate. A delay is the kinder failure.
      problems.push(customer.id);
      skipped++;
      continue;
    }

    // Written first. A crash after this point costs one uninvited person,
    // which someone will notice; a crash before it could email the whole
    // group again, which they would notice rather more.
    try {
      await kv.set(INVITE_KEY(customer.id), { at: new Date().toISOString(), email });
    } catch (err) {
      problems.push(customer.id);
      skipped++;
      continue;
    }

    try {
      await mail.send({
        to: email,
        subject: 'Your Purple Crown professional account',
        text: [
          'Congratulations on completing Crown Your Style.',
          '',
          'Your professional account is ready to set up. Go to:',
          '',
          origin + '/professional-login.html',
          '',
          'Enter this email address and we will send you a sign-in link. There is no',
          'password to choose or remember.',
          '',
          'Once you are in you can complete your profile, place wholesale orders, and',
          'follow them through to delivery.',
          '',
          'The Purple Crown Extensions'
        ].join('\n')
      });
      invited++;
    } catch (err) {
      // The flag is already set, so this person will not be retried. Logged
      // loudly with the address so it can be sent by hand.
      console.error('invite: send failed for', email, err.message);
      problems.push(customer.id);
    }
  }

  return res.status(200).json({
    ok: true,
    invited,
    skipped,
    total: members.length,
    truncated: members.length > MAX_PER_RUN,
    problems: problems.length
  });
};

module.exports.INVITE_KEY = INVITE_KEY;
module.exports.MAX_PER_RUN = MAX_PER_RUN;
