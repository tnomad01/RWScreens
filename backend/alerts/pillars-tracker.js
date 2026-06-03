// ─────────────────────────────────────────────────────────────────────────────
// backend/alerts/pillars-tracker.js  ·  v1.2
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Shared utilities for Ross Cameron's 5 Pillars evaluation and the
//           news result cache shared between the aggregator and bot commands.
//           evalPillars() mirrors the frontend scoring logic in pillars.js.
//
// Pillars:  lowFloat      float > 0 and < 10M shares
//           highRelVol    relative daily volume > 5×
//           catalyst      news confirmed by news-aggregator in the last N min
//           momentum      Running Up 5m RVOL ≥ 3× (or gap > 10% at open)
//           strongDaily   current price above 200-day EMA
//           potential     pre-market volume > 25% of avg daily (bonus signal)
//
// Exports:  newsCache  (Map — written by news-aggregator, read by bot-commands)
//           getNewsFromCache(ticker), refreshNewsAsync(ticker, provider)
//           evalPillars(row, ruRow, ema200, hasNews) → pillar flags object
//           topTickers(scanners, ema200Cache, n)     → ranked ticker list
//
// Config:   TELEGRAM_NEWS_CACHE_MIN  cache TTL in minutes (default 5)
// ─────────────────────────────────────────────────────────────────────────────

const NEWS_TTL_MS = (parseInt(process.env.TELEGRAM_NEWS_CACHE_MIN || '5', 10)) * 60_000;

// newsCache: ticker → { hasNews: bool, cachedAt: ms }
export const newsCache = new Map();

// ── News cache ────────────────────────────────────────────────────────────────

export function getNewsFromCache(ticker) {
  const entry = newsCache.get(ticker);
  if (entry && (Date.now() - entry.cachedAt) < NEWS_TTL_MS) return entry.hasNews;
  return null; // stale or absent
}

export function refreshNewsAsync(ticker, provider) {
  provider.fetchNews(ticker)
    .then((items) => {
      newsCache.set(ticker, { hasNews: items.length > 0, cachedAt: Date.now() });
    })
    .catch(() => {}); // swallow — cache stays stale, retried next call
}

// ── Pillar evaluation (mirrors frontend/js/pillars.js:evaluatePillars) ────────

/**
 * Returns up to `n` tickers ranked by pillar score then RVOL.
 * Filters to float > 0 and < 10M. Deduplicates across all scanner arrays.
 */
export function topTickers(scanners, ema200Cache, n = 5) {
  const seen = new Map();
  const sources = [
    ...(scanners.dayTrade     || []),
    ...(scanners.highMomentum || []),
    ...(scanners.lowFloat     || []),
    ...(scanners.runningUp    || []),
    ...Object.values(scanners.session || {}),
  ];
  for (const row of sources) {
    if (!seen.has(row.symbol)) seen.set(row.symbol, row);
  }

  const results = [];
  for (const [sym, row] of seen) {
    if (!(row.float > 0 && row.float < 10_000_000)) continue;
    const ruRow  = scanners.runningUp?.find(r => r.symbol === sym) ?? null;
    const ema200 = ema200Cache instanceof Map ? (ema200Cache.get(sym) ?? null) : (ema200Cache?.[sym] ?? null);
    const hasNews = getNewsFromCache(sym) ?? false;
    const pillars = evalPillars(row, ruRow, ema200, hasNews);
    const score = ['lowFloat', 'highRelVol', 'catalyst', 'momentum', 'strongDaily']
      .filter(k => pillars[k]).length;
    results.push({ row, pillars, score });
  }

  results.sort((a, b) => b.score - a.score || (b.row.relVolDaily ?? 0) - (a.row.relVolDaily ?? 0));
  return results.slice(0, n);
}

export function evalPillars(row, ruRow, ema200, hasNews) {
  const momentumPass = ruRow
    ? ((ruRow.relVol5minPct ?? 0) >= 3.0 && (ruRow.delta5minVsDaily ?? 0) >= 0.5)
    : (row.gapPct ?? 0) > 10;

  // Potential trigger: pre-market volume > 25% of average daily volume.
  // Captured at seed time (preMarketVolPct is frozen, not overwritten by live ticks).
  // Signals elevated interest before the open — warrants further investigation
  // once the session starts and pace-adjusted RVOL can be properly evaluated.
  const potential = (row.preMarketVolPct ?? 0) > 0.25;

  return {
    lowFloat:    row.float > 0 && row.float < 10_000_000,
    highRelVol:  (row.relVolDaily ?? 0) > 5,
    catalyst:    hasNews,
    momentum:    momentumPass,
    strongDaily: ema200 != null && row.price > ema200,
    potential,
  };
}
