// alerts/pillars-tracker.js
// Shared utilities for 5 Pillars evaluation and news caching.
// Used by bot-commands.js for the /5P command handler.

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
