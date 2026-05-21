const express = require('express');
const crypto = require('crypto');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;

function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) return true;
  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSig = req.headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const body = req.rawBody || Buffer.from(new URLSearchParams(req.body).toString());
  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', SLACK_SIGNING_SECRET);
  const computed = 'v0=' + hmac.update(sigBase).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
  } catch { return false; }
}

function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set((text.match(emailRegex) || []).map(e => e.toLowerCase()))];
}

async function blockInInstantly(emails) {
  const res = await fetch('https://api.instantly.ai/api/v2/block-lists-entries/bulk-create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INSTANTLY_API_KEY}`
    },
    body: JSON.stringify({ bl_values: emails })
  });
  return res.json();
}

app.post('/slack/command', async (req, res) => {
  const text = (req.body.text || '').trim();
  const user = req.body.user_name || 'someone';

  if (!text) {
    return res.json({
      response_type: 'ephemeral',
      text: 'Usage: `/blockemail email@domain.com`'
    });
  }

  const emails = extractEmails(text);

  if (emails.length === 0) {
    return res.json({
      response_type: 'ephemeral',
      text: `No valid email found in: "${text}"`
    });
  }

  res.json({
    response_type: 'in_channel',
    text: `⏳ Blocking ${emails.join(', ')}...`
  });

  try {
    const result = await blockInInstantly(emails);
    console.log(`[${new Date().toISOString()}] @${user} blocked:`, emails, result);
  } catch (err) {
    console.error('Instantly error:', err.message);
  }
});

app.post('/slack/events', async (req, res) => {
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  if (!event || event.type !== 'message' || event.subtype) return res.sendStatus(200);

  const emails = extractEmails(event.text || '');
  if (emails.length === 0) return res.sendStatus(200);

  console.log(`[${new Date().toISOString()}] Auto-blocking:`, emails);
  try { await blockInInstantly(emails); } catch (err) { console.error(err.message); }
  res.sendStatus(200);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
