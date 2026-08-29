// api/_mail.js
// Thin Resend client. No dependencies, same reasoning as _square.js and
// _store.js. Never embed credential values here.
const API = 'https://api.resend.com/emails';

function token() { return process.env.RESEND_API_KEY || ''; }
function from() { return process.env.MAIL_FROM || ''; }

function configured() {
  return !!(token() && from());
}

async function send({ to, subject, text }) {
  if (!configured()) throw new Error('mail_not_configured');
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: from(), to: [to], subject, text })
  });
  if (!res.ok) {
    // Status only. The body can echo the request, bearer token included.
    throw new Error('mail_http_' + res.status);
  }
  return true;
}

module.exports = { configured, send };
