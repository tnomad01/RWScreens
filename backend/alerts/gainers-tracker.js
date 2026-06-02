// alerts/gainers-tracker.js
// Detects entries to the Top Gainers (dayTrade) scanner and sends Telegram alerts.
// Alerts on initial seed AND on new entries. Cooldown prevents re-alerting
// the same ticker while it stays in the list.

import { sendMessage } from './telegram.js';

const COOLDOWN_MS = 30 * 60_000; // 30 minutes per ticker

const knownTickers = new Set();          // tickers currently in dayTrade
const alertedAt    = new Map();          // ticker → timestamp of last alert

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmtPrice(v)  { return v != null ? Number(v).toFixed(2) : '—'; }
function fmtPct(v)    { return v != null ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—'; }
function fmtX(v)      { return v != null ? `${Number(v).toFixed(1)}×` : '—'; }
function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}
function fmtFloat(v) {
  if (!v || v === 0) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}

function formatGainerAlert(row) {
  const newsTag = row.newsIcon === 'flame' ? ' 🔥' : row.newsIcon === 'yellowCircle' ? ' 🟡' : '';
  return [
    `🚨 <b>TOP GAINER: ${row.symbol}${newsTag}</b>`,
    '',
    `Price: $${fmtPrice(row.price)}  |  Change: ${fmtPct(row.changeFromClosePct)}`,
    `Volume: ${fmtVol(row.volume)}  |  Float: ${fmtFloat(row.float)}`,
    `Rel Vol: ${fmtX(row.relVolDaily)}  |  Gap: ${fmtPct(row.gapPct)}`,
  ].join('\n');
}

// ── Public ────────────────────────────────────────────────────────────────────

export function checkNewGainers(scanners) {
  const now            = Date.now();
  const currentSymbols = new Set((scanners.dayTrade || []).map(r => r.symbol));

  for (const row of (scanners.dayTrade || [])) {
    const isNew      = !knownTickers.has(row.symbol);
    const lastAlert  = alertedAt.get(row.symbol) ?? 0;
    const cooledDown = (now - lastAlert) > COOLDOWN_MS;

    if (isNew && cooledDown) {
      sendMessage(formatGainerAlert(row));
      alertedAt.set(row.symbol, now);
    }

    knownTickers.add(row.symbol);
  }

  // Prune departed tickers so re-entries alert fresh
  for (const sym of knownTickers) {
    if (!currentSymbols.has(sym)) {
      knownTickers.delete(sym);
      alertedAt.delete(sym);
    }
  }
}
