// ─────────────────────────────────────────────────────────────────────────────
// backend/alerts/gainers-tracker.js  ·  v1.2
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Detects new entries in the dayTrade (Top Gainers) scanner and
//           sends a Telegram alert for each one. Called on every 1m bar tick
//           from server.js. A 30-minute per-ticker cooldown prevents duplicate
//           alerts while a ticker stays in the list.
//
// Exports:  checkNewGainers(scanners)
//
// Depends:  alerts/telegram.js
// ─────────────────────────────────────────────────────────────────────────────

import { sendMessage }  from './telegram.js';
import { marketPhase } from './pillars-tracker.js';

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

function formatGainerAlert(row, phase) {
  const newsTag = row.newsIcon === 'flame' ? ' 🔥' : row.newsIcon === 'yellowCircle' ? ' 🟡' : '';

  const header = phase === 'premarket'
    ? `🌅 <b>PRE-MARKET GAINER: ${row.symbol}${newsTag}</b>`
    : phase === 'afterhours'
      ? `🌙 <b>AFTER-HOURS GAINER: ${row.symbol}${newsTag}</b>`
      : `🚨 <b>TOP GAINER: ${row.symbol}${newsTag}</b>`;

  // Before open: pre-market volume % is the meaningful volume context.
  // After open: session volume + RVOL are the live measures — drop the pre-mkt figure.
  const pmPct       = Math.round((row.preMarketVolPct ?? 0) * 100);
  const volumeLine  = phase === 'premarket'
    ? `Pre-Mkt Vol: ${pmPct}% of avg daily  |  Float: ${fmtFloat(row.float)}`
    : `Volume: ${fmtVol(row.volume)}  |  Float: ${fmtFloat(row.float)}`;

  return [
    header,
    '',
    `Price: $${fmtPrice(row.price)}  |  Change: ${fmtPct(row.changeFromClosePct)}`,
    volumeLine,
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
      sendMessage(formatGainerAlert(row, marketPhase()));
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
