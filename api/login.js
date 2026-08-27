// api/login.js
const { configured, sign, cookieHeader, credentialsMatch, TTL_SECONDS } = require('./_session.js');

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    if (!configured()) {
      return res.status(503).json({ error: 'Sign-in is not configured yet.', reason: 'not_configured' });
    }

    const body = req.body || {};
    if (!credentialsMatch(body.email, body.password)) {
      return res.status(401).json({ error: 'Those details were not recognised', reason: 'bad_credentials' });
    }

    const token = sign(Date.now() + TTL_SECONDS * 1000);
    res.setHeader('Set-Cookie', cookieHeader(token, TTL_SECONDS));
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
