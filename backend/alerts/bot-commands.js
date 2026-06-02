// alerts/bot-commands.js
// Polls Telegram for bot commands and handles /5P [ticker] queries.
// Uses Node's built-in https — no npm dependency.

import https from 'https';
import { sendMessage } from './telegram.js';
import { evalPillars, getNewsFromCache, refreshNewsAsync, topTickers } from './pillars-tracker.js';
import { enrichWithFloat } from '../engine/scanner.js';

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

  // Scheduled top-5 summary every 10 minutes during market hours
  setInterval(() => {
    if (_isMarketHours()) handleTop5(getScanners(), ema200Cache);
  }, 10 * 60_000);

  console.log('[telegram] Bot command polling started (/5P, /top5)');
}

// Exported for testing
export function _processUpdate(update, getScanners, ema200Cache, provider) {
  if (update.update_id > lastUpdateId) lastUpdateId = update.update_id;
  const text = update.message?.text?.trim() ?? '';
  const sc   = typeof getScanners === 'function' ? getScanners() : getScanners;
  if (/^\/5[pP]\b/.test(text)) {
    const ticker = text.replace(/^\/5[pP]\s*/i, '').toUpperCase().trim();
    if (ticker) handle5P(ticker, sc, ema200Cache, provider);
  }
  if (/^\/top5?\b/i.test(text)) {
    handleTop5(sc, ema200Cache);
  }
}

// ── /5P handler ───────────────────────────────────────────────────────────────

export async function handle5P(ticker, scanners, ema200Cache, provider) {
  let row = scanners.dayTrade?.find(r => r.symbol === ticker)
          ?? scanners.highMomentum?.find(r => r.symbol === ticker)
          ?? scanners.lowFloat?.find(r => r.symbol === ticker)
          ?? scanners.runningUp?.find(r => r.symbol === ticker)
          ?? scanners.session?.[ticker]
          ?? null;

  let liveMode = false;
  if (!row) {
    if (!provider) {
      sendMessage(`❌ <b>${ticker}</b> not found in scanner`);
      return;
    }
    try {
      const [quote, floatShares] = await Promise.all([
        provider.fetchQuote(ticker),
        enrichWithFloat(ticker),
      ]);
      row = {
        symbol:             ticker,
        price:              quote.price,
        float:              floatShares ?? 0,
        relVolDaily:        quote.relVolDaily,
        gapPct:             quote.gapPct,
        changeFromClosePct: quote.changePct,
        preMarketVolPct:    0,
      };
      liveMode = true;
    } catch {
      sendMessage(`❌ <b>${ticker}</b> not found in scanner or provider`);
      return;
    }
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

  sendMessage(format5P(ticker, row, ruRow, pillars, score, ema200, liveMode));
}

// ── /top5 handler ─────────────────────────────────────────────────────────────

export function handleTop5(scanners, ema200Cache) {
  const top = topTickers(scanners, ema200Cache, 5);
  if (top.length === 0) {
    sendMessage('📊 <b>Top Watchlist</b>\n\nNo qualifying tickers (float &lt; 10M) in scanner.');
    return;
  }
  sendMessage(formatTop5(top));
}

function _isMarketHours() {
  const et   = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const d    = new Date(et);
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function formatTop5(entries) {
  const etTime = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const lines = [`📊 <b>Top Watchlist</b> — ${etTime} ET`, ''];

  entries.forEach(({ row, pillars, score }, i) => {
    const icons = [
      pillars.lowFloat    ? '✅' : '❌',
      pillars.highRelVol  ? '✅' : '❌',
      pillars.catalyst    ? '✅' : '❌',
      pillars.momentum    ? '✅' : '❌',
      pillars.strongDaily ? '✅' : '❌',
    ].join('');

    const chg    = row.changeFromClosePct ?? 0;
    const chgStr = `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`;

    lines.push(
      `${i + 1}. <b>${row.symbol}</b>  $${fmtNum(row.price)} ${chgStr}`,
      `   Float ${fmtFloat(row.float)}  RVOL ${fmtNum(row.relVolDaily, 1)}×  ${score}/5 ${icons}`,
      '',
    );
  });

  lines.push('<i>LF · RV · C · M · SD</i>');
  return lines.join('\n');
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmtNum(v, d = 2) { return v != null ? Number(v).toFixed(d) : '—'; }
function fmtFloat(v) {
  if (!v || v === 0) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

function format5P(ticker, row, ruRow, pillars, score, ema200, liveMode = false) {
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

  const header = liveMode
    ? `📊 <b>${ticker}</b> — 5 Pillars <i>(live lookup)</i>`
    : `📊 <b>${ticker}</b> — 5 Pillars`;

  return [
    header,
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
