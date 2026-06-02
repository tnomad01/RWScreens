// alerts/bot-commands.js
// Polls Telegram for bot commands and handles /5P [ticker] queries.
// Uses Node's built-in https — no npm dependency.

import https from 'https';
import { sendMessage } from './telegram.js';
import { evalPillars, getNewsFromCache, refreshNewsAsync } from './pillars-tracker.js';

let lastUpdateId = 0;

// ── Telegram polling ──────────────────────────────────────────────────────────

function getUpdates() {
  return new Promise((resolve) => {
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TOKEN) return resolve([]);
    const path = `/bot${TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`;
    const req = https.get({ hostname: 'api.telegram.org', path }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.ok ? json.result : []);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
  });
}

export function startPolling(getScanners, ema200Cache, provider) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;

  const poll = async () => {
    const updates = await getUpdates();
    for (const update of updates) {
      _processUpdate(update, getScanners, ema200Cache, provider);
    }
  };

  setInterval(poll, 2000);
  console.log('[telegram] Bot command polling started (/5P)');
}

// Exported for testing
export function _processUpdate(update, getScanners, ema200Cache, provider) {
  if (update.update_id > lastUpdateId) lastUpdateId = update.update_id;
  const text = update.message?.text?.trim() ?? '';
  if (/^\/5[pP]\b/.test(text)) {
    const ticker = text.replace(/^\/5[pP]\s*/i, '').toUpperCase().trim();
    if (ticker) handle5P(ticker, typeof getScanners === 'function' ? getScanners() : getScanners, ema200Cache, provider);
  }
}

// ── /5P handler ───────────────────────────────────────────────────────────────

export function handle5P(ticker, scanners, ema200Cache, provider) {
  const row = scanners.dayTrade?.find(r => r.symbol === ticker)
           ?? scanners.highMomentum?.find(r => r.symbol === ticker)
           ?? scanners.lowFloat?.find(r => r.symbol === ticker)
           ?? scanners.runningUp?.find(r => r.symbol === ticker)
           ?? scanners.session?.[ticker]
           ?? null;

  if (!row) {
    sendMessage(`❌ <b>${ticker}</b> not found in scanner`);
    return;
  }

  const ruRow  = scanners.runningUp?.find(r => r.symbol === ticker) ?? null;
  const ema200 = ema200Cache instanceof Map ? (ema200Cache.get(ticker) ?? null) : (ema200Cache[ticker] ?? null);

  let hasNews = getNewsFromCache(ticker);
  if (hasNews === null) {
    hasNews = false;
    if (provider) refreshNewsAsync(ticker, provider);
  }

  const pillars = evalPillars(row, ruRow, ema200, hasNews);
  const score   = Object.values(pillars).filter(Boolean).length;

  sendMessage(format5P(ticker, row, ruRow, pillars, score, ema200));
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmtNum(v, d = 2) { return v != null ? Number(v).toFixed(d) : '—'; }
function fmtFloat(v) {
  if (!v || v === 0) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

function format5P(ticker, row, ruRow, pillars, score, ema200) {
  const momentumNote = ruRow
    ? `5m RVOL ${fmtNum(ruRow.relVol5minPct, 1)}× (Δ${fmtNum(ruRow.delta5minVsDaily, 1)})`
    : `Gap ${(row.gapPct ?? 0) > 0 ? '+' : ''}${fmtNum(row.gapPct)}%`;

  const ema200Note = ema200 != null
    ? `$${fmtNum(row.price)} vs EMA200 $${fmtNum(ema200)}`
    : 'EMA200 not yet computed';

  const scoreLabel = score === 5
    ? '🟢 <b>QUALIFIED — All 5 Pillars Pass</b>'
    : score >= 3
      ? `🟡 <b>WATCH — ${score}/5 Pillars</b>`
      : `⚪ <b>NO SETUP — ${score}/5 Pillars</b>`;

  const potentialLine = pillars.potential
    ? `\n🔍 <b>Potential</b>: Pre-mkt vol ${fmtNum((row.preMarketVolPct ?? 0) * 100, 0)}% of avg daily — worth watching`
    : '';

  return [
    `📊 <b>${ticker}</b> — 5 Pillars`,
    '',
    `${pillars.lowFloat    ? '✅' : '❌'} Low Float: ${fmtFloat(row.float)} shares`,
    `${pillars.highRelVol  ? '✅' : '❌'} High Relative Vol: ${fmtNum(row.relVolDaily)}×`,
    `${pillars.catalyst    ? '✅' : '❌'} Catalyst: ${pillars.catalyst ? 'News today' : 'No news'}`,
    `${pillars.momentum    ? '✅' : '❌'} Momentum: ${momentumNote}`,
    `${pillars.strongDaily ? '✅' : '❌'} Strong Daily: ${ema200Note}`,
    '',
    `Score: ${score}/5 — ${scoreLabel}${potentialLine}`,
  ].join('\n');
}
