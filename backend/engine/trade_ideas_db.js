// ─────────────────────────────────────────────────────────────────────────────
// backend/engine/trade_ideas_db.js  ·  v1.0
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Optional bridge to the stock-screening-mvp Trade Ideas scraper.
//           Reads the most-frequently-seen tickers from the last LOOKBACK_H
//           hours of the scraper's SQLite database and returns them as a
//           seed list for the scanner. Silently no-ops if TRADE_IDEAS_DB_PATH
//           is unset or the file is missing (scraper not running, market closed).
//
// Config:   TRADE_IDEAS_DB_PATH  — absolute path to stock_screen.db in .env
//
// Exports:  getRecentTickers(limit?)  → [{ ticker, pctGain }]
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const LOOKBACK_H = 4;    // only consider captures from the last N hours
const PCT_MAX    = 500;  // ignore Volume Today extreme values (139k%) as seed
const DEFAULT_LIMIT = 100;

const QUERY = `
  SELECT dt.ticker,
         COUNT(*)          AS appearances,
         AVG(dt.percent_gain) AS avg_gain
  FROM   detected_tickers dt
  JOIN   screenshots s       ON dt.screenshot_id = s.id
  JOIN   capture_runs cr     ON s.capture_run_id = cr.id
  WHERE  cr.started_at > datetime('now', ?)
    AND  dt.percent_gain IS NOT NULL
    AND  dt.percent_gain > 0
    AND  dt.percent_gain < ?
  GROUP  BY dt.ticker
  ORDER  BY appearances DESC, avg_gain DESC
  LIMIT  ?
`;

export function getRecentTickers(limit = DEFAULT_LIMIT) {
  const DB_PATH = process.env.TRADE_IDEAS_DB_PATH;
  if (!DB_PATH) return [];
  if (!existsSync(DB_PATH)) {
    console.warn('[trade_ideas_db] DB not found at', DB_PATH);
    return [];
  }

  try {
    const db   = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    const rows = db.prepare(QUERY).all(`-${LOOKBACK_H} hours`, PCT_MAX, limit);
    db.close();

    if (rows.length > 0) {
      console.log(`[trade_ideas_db] ${rows.length} tickers from last ${LOOKBACK_H}h:`,
        rows.slice(0, 8).map(r => r.ticker).join(', '));
    }
    return rows.map(r => ({ ticker: r.ticker, pctGain: r.avg_gain }));
  } catch (err) {
    console.warn('[trade_ideas_db] Read failed:', err.message);
    return [];
  }
}
