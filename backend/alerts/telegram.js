// alerts/telegram.js
// Thin Telegram Bot API client using Node's built-in https — no npm dependency.
// No-ops silently if TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID are unset.

import https from 'https';

function _realSend(text) {
  const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return;

  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });

  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path:     `/bot${TOKEN}/sendMessage`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => {
      if (res.statusCode >= 400) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => console.error(`[telegram] API error ${res.statusCode}:`, data));
      }
    },
  );

  req.on('error', (err) => console.error('[telegram] send failed:', err.message));
  req.write(body);
  req.end();
}

let _impl = _realSend;

export const sendMessage = (text) => _impl(text);

// Test hooks — replace/restore the send implementation
export function _overrideSendMessage(fn) { _impl = fn; }
export function _restoreSendMessage()    { _impl = _realSend; }
