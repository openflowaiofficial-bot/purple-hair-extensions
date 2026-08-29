// api/square-webhook.js
// Square tells us a payment happened. If it was a class, the buyer becomes a
// Square customer in the "Class attendees/pending approval" group.
//
// Being in that group grants NOTHING. _approval.js only ever asks about the
// professionals group, so a class attendee cannot sign in, order, or see
// wholesale pricing. They are waiting, and this endpoint cannot promote them.
// Only a person moving them to the professionals group in Square can do that.
//
// This URL is public — anyone can POST to it — so the signature is checked
// before the body is looked at. An unsigned or wrongly-signed request is
// refused without touching Square, because otherwise a stranger could enrol
// anyone they liked by posting a made-up payment.
//
// Fail-closed, in this order:
//   1. not POST                        -> 405
//   2. no signature key configured     -> 503 not_configured
//   3. signature absent or wrong       -> 401 bad_signature
//   4. not a payment event             -> 200 ignored
//   5. not a class purchase            -> 200 ignored
//   6. no buyer email                  -> 200 ignored (nothing to enrol)
//   7. otherwise                       -> 200 enrolled
const crypto = require('node:crypto');
const groupsModule = require('./_groups.js');
const store = require('./_store.js');

// Which purchases count as a class. Unset means this endpoint enrols nobody:
// guessing which line item is a class from an amount or a name would sooner or
// later enrol a hair order, so it does nothing until told what to look for.
function classCatalogIds() {
  return (process.env.SQUARE_CLASS_CATALOG_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

function signatureKey() { return process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || ''; }

// Square signs the notification URL concatenated with the raw body, HMAC-SHA256
// under the endpoint's signature key, base64. The URL must be byte-identical to
// the one registered in Square, which is why it is configured rather than
// rebuilt from headers a caller controls.
function notificationUrl(req) {
  const configured = process.env.SQUARE_WEBHOOK_URL;
  if (configured) return configured;
  const host = req && req.headers && req.headers.host;
  return host ? 'https://' + host + '/api/square-webhook' : '';
}

function signatureValid(req, rawBody) {
  const key = signatureKey();
  if (!key) return false;
  const provided = req.headers && (req.headers['x-square-hmacsha256-signature'] ||
                                   req.headers['X-Square-HmacSha256-Signature']);
  if (!provided) return false;

  const expected = crypto.createHmac('sha256', key)
    .update(notificationUrl(req) + rawBody)
    .digest('base64');

  // Hash both sides to a fixed length first: timingSafeEqual throws on
  // mismatched lengths, and the length of a signature is itself information.
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function readRaw(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && !req.on) return JSON.stringify(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function buyerEmail(payment) {
  return (payment && payment.buyer_email_address) || null;
}

function orderLineCatalogIds(order) {
  return ((order && order.line_items) || [])
    .map((li) => li.catalog_object_id)
    .filter(Boolean);
}

module.exports = async function handler(req, res, deps) {
  const groups = (deps && deps.groups) || groupsModule;
  const kv = (deps && deps.store) || store;
  const caller = deps && deps.call;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST', reason: 'bad_request' });
  }

  if (!signatureKey()) {
    return res.status(503).json({ error: 'Webhook not configured', reason: 'not_configured' });
  }

  let raw;
  try {
    raw = await readRaw(req);
  } catch (err) {
    console.error('webhook read failed:', err.message);
    return res.status(400).json({ error: 'Unreadable body', reason: 'bad_request' });
  }

  if (!signatureValid(req, raw)) {
    // Deliberately says nothing about why.
    return res.status(401).json({ error: 'Not authorised', reason: 'bad_signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { event = null; }
  if (!event || !event.type) return res.status(200).json({ ok: true, ignored: 'unparseable' });

  if (event.type !== 'payment.created' && event.type !== 'payment.updated') {
    return res.status(200).json({ ok: true, ignored: event.type });
  }

  const payment = event.data && event.data.object && event.data.object.payment;
  if (!payment || payment.status !== 'COMPLETED') {
    return res.status(200).json({ ok: true, ignored: 'not_completed' });
  }

  // Square delivers at least once, so the same payment can arrive twice.
  const seenKey = 'webhook:payment:' + payment.id;
  try {
    if (await kv.get(seenKey)) return res.status(200).json({ ok: true, ignored: 'already_seen' });
  } catch { /* A cache miss must not stop a real enrolment. */ }

  const wanted = classCatalogIds();
  if (!wanted.length) {
    console.error('SQUARE_CLASS_CATALOG_IDS is unset; webhook enrolled nobody');
    return res.status(200).json({ ok: true, ignored: 'not_configured' });
  }

  let order = null;
  if (payment.order_id) {
    try {
      const result = await (caller || require('./_square.js').call)(
        '/v2/orders/' + encodeURIComponent(payment.order_id));
      order = (result && result.order) || null;
    } catch (err) {
      console.error('webhook order lookup failed:', err.message);
      // A payment we cannot classify is left alone rather than guessed at.
      return res.status(200).json({ ok: true, ignored: 'order_unavailable' });
    }
  }

  const bought = orderLineCatalogIds(order);
  const isClass = bought.some((id) => wanted.includes(id));
  if (!isClass) return res.status(200).json({ ok: true, ignored: 'not_a_class' });

  const email = buyerEmail(payment) ||
    (order && order.fulfillments && order.fulfillments[0] &&
     order.fulfillments[0].shipment_details &&
     order.fulfillments[0].shipment_details.recipient &&
     order.fulfillments[0].shipment_details.recipient.email_address) || null;

  if (!email) {
    // Nothing to enrol against. Logged so it can be handled by hand rather
    // than silently lost.
    console.error('class purchase with no buyer email, payment:', payment.id);
    return res.status(200).json({ ok: true, ignored: 'no_email' });
  }

  try {
    const pendingId = await groups.resolvePendingGroupId(deps);
    if (!pendingId) {
      console.error('pending group not found in Square:', groups.pendingGroupName());
      return res.status(200).json({ ok: true, ignored: 'group_missing' });
    }

    let customer = await groups.customerByEmail(email, deps);
    if (!customer) {
      customer = await groups.createCustomer({
        idempotencyKey: 'class-' + payment.id,
        email,
        note: 'Created from a Crown Your Style purchase.'
      }, deps);
    }
    if (!customer) return res.status(200).json({ ok: true, ignored: 'no_customer' });

    await groups.addToGroup(customer.id, pendingId, deps);
    try { await kv.setWithTtl(seenKey, { at: Date.now() }, 60 * 60 * 24 * 30); } catch {}

    return res.status(200).json({ ok: true, enrolled: true });
  } catch (err) {
    console.error('webhook enrolment failed:', err.message);
    // A 500 asks Square to retry, which is what we want for a transient fault.
    return res.status(500).json({ error: 'Enrolment failed', reason: 'upstream' });
  }
};

module.exports.signatureValid = signatureValid;
module.exports.classCatalogIds = classCatalogIds;
module.exports.config = { api: { bodyParser: false } };
