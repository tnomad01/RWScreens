// engine/vwap.js
// Stateful per-ticker VWAP, ±1/±2 SD bands, and 9/20/200 EMA calculations.
// VWAP resets at 09:30 ET each session. EMAs persist across sessions.
// Call updateBar(ticker, bar) for each new OHLCV bar — returns computed indicators.

const ET_OPEN_HOUR   = 9;
const ET_OPEN_MINUTE = 30;

// Per-ticker state
const state = {};

function _getState(ticker) {
  if (!state[ticker]) {
    state[ticker] = {
      // VWAP accumulators (reset each session)
      cumTPV:  0,   // cumulative (typical price × volume)
      cumVol:  0,   // cumulative volume
      cumTPV2: 0,   // cumulative (typical price²  × volume) for variance
      // EMA last values (persist)
      ema9:   null,
      ema20:  null,
      ema200: null,
      // Track last bar time to detect session reset
      lastBarDate: null,
    };
  }
  return state[ticker];
}

/**
 * Process one completed OHLCV bar.
 * bar = { time (Unix seconds), open, high, low, close, volume }
 * Returns indicator values for that bar.
 */
export function updateBar(ticker, bar) {
  const s = _getState(ticker);
  const barDate = _etDateString(bar.time);

  // Detect new session (date changed or 09:30 reset)
  if (s.lastBarDate !== barDate) {
    s.cumTPV  = 0;
    s.cumVol  = 0;
    s.cumTPV2 = 0;
    s.lastBarDate = barDate;
  }

  const tp = (bar.high + bar.low + bar.close) / 3;  // typical price

  s.cumTPV  += tp * bar.volume;
  s.cumVol  += bar.volume;
  s.cumTPV2 += tp * tp * bar.volume;

  const vwap = s.cumVol > 0 ? s.cumTPV / s.cumVol : tp;

  // Variance = E[x²] − E[x]² (population variance weighted by volume)
  const variance = s.cumVol > 0
    ? Math.max(0, (s.cumTPV2 / s.cumVol) - vwap * vwap)
    : 0;
  const sd = Math.sqrt(variance);

  // EMAs
  s.ema9   = _ema(bar.close, s.ema9,   9);
  s.ema20  = _ema(bar.close, s.ema20,  20);
  s.ema200 = _ema(bar.close, s.ema200, 200);

  return {
    time:        bar.time,
    vwap:        _round(vwap),
    vwapPlus1:   _round(vwap + sd),
    vwapMinus1:  _round(vwap - sd),
    vwapPlus2:   _round(vwap + 2 * sd),
    vwapMinus2:  _round(vwap - 2 * sd),
    ema9:        s.ema9  !== null ? _round(s.ema9)  : null,
    ema20:       s.ema20 !== null ? _round(s.ema20) : null,
    ema200:      s.ema200 !== null ? _round(s.ema200) : null,
  };
}

/**
 * Process a full historical bar array for a ticker and return parallel indicator arrays.
 * Resets state first so historical loads start clean.
 * Returns { candles, volume, vwap, vwapPlus1, vwapMinus1, vwapPlus2, vwapMinus2, ema9, ema20, ema200 }
 * Each value is an array of { time, value } objects ready for Lightweight Charts setData().
 */
export function computeHistory(ticker, bars) {
  // Reset state for clean computation
  delete state[ticker];

  const candles    = [];
  const volume     = [];
  const vwap       = [];
  const vwapPlus1  = [];
  const vwapMinus1 = [];
  const vwapPlus2  = [];
  const vwapMinus2 = [];
  const ema9       = [];
  const ema20      = [];
  const ema200     = [];

  for (const bar of bars) {
    candles.push({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    volume.push({
      time:  bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? '#00ff9d44' : '#ff003344',
    });

    const ind = updateBar(ticker, bar);
    vwap.push({ time: ind.time, value: ind.vwap });
    vwapPlus1.push({ time: ind.time, value: ind.vwapPlus1 });
    vwapMinus1.push({ time: ind.time, value: ind.vwapMinus1 });
    vwapPlus2.push({ time: ind.time, value: ind.vwapPlus2 });
    vwapMinus2.push({ time: ind.time, value: ind.vwapMinus2 });
    if (ind.ema9   !== null) ema9.push({ time: ind.time, value: ind.ema9 });
    if (ind.ema20  !== null) ema20.push({ time: ind.time, value: ind.ema20 });
    if (ind.ema200 !== null) ema200.push({ time: ind.time, value: ind.ema200 });
  }

  return { candles, volume, vwap, vwapPlus1, vwapMinus1, vwapPlus2, vwapMinus2, ema9, ema20, ema200 };
}

/** Reset all state (e.g., on new trading day) */
export function resetAll() {
  for (const key of Object.keys(state)) delete state[key];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ema(close, prev, period) {
  if (prev === null) return close;
  const k = 2 / (period + 1);
  return close * k + prev * (1 - k);
}

function _round(n) {
  return Math.round(n * 10000) / 10000;
}

/** Returns YYYY-MM-DD in ET timezone for the bar's Unix timestamp */
function _etDateString(unixSec) {
  return new Date(unixSec * 1000).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}
