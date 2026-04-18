// engine/scanner.js
// Four scanners matching Warrior Trading layout:
//   dayTrade     → "Top Gainers [window] (Online)"          — sorted by Change%
//   highMomentum → "Small Cap – High of Day Momentum"        — streaming alert feed
//   lowFloat     → "Low Float Top Gainers [window] (Online)" — derived from dayTrade ∪ highMomentum, float < 20M
//   runningUp    → "Running Up (Online)"                     — velocity-based alert feed, 7 columns
//
// Float data is fetched from Finviz and cached for the session.

import { getFloat, batchGetFloats } from './float.js';

const PRICE_MIN      = 0.50;
const PRICE_MAX      = 30;
const VOL_MIN        = 100_000;
const FLOAT_MAX_LOW  = 20_000_000;   // Low Float scanner threshold

// Running Up trigger thresholds
const RU_PRICE_ADV_PCT   = 4;     // min % price advance in look-back window
const RU_REL_VOL_DAILY   = 2.5;   // min daily relative volume
const RU_REL_VOL_5MIN    = 3.0;   // min 5-min relative volume
const RU_DELTA_MIN       = 0.5;   // min positive delta (relVol5min - relVolDaily)
const RU_LOOKBACK_MS     = 60_000; // price velocity window (60 seconds)
const RU_FREQ_WINDOW_MS  = 5_000;  // frequency note window (5 seconds)
const RU_MAX_ROWS        = 50;

// ── State ─────────────────────────────────────────────────────────────────────

const scanners = {
  dayTrade:     [],    // top gainers sorted by change%
  highMomentum: [],    // streaming momentum alert feed
  lowFloat:     [],    // low-float top gainers (from dayTrade ∪ highMomentum), sorted by change%
  runningUp:    [],    // velocity-based alert feed, prepend newest
};

// Rolling 5-min window timestamps for scanner headers
const window5min = {
  from: _etTimeStr(Date.now() - 5 * 60_000),
  to:   _etTimeStr(Date.now()),
};

// Per-ticker session data
const tickerMeta = {};     // { ticker: { sessionVol, avgDailyVolume, prevClose, open, float } }
const highWatermarks = {}; // { ticker: intraday high price } — for highMomentum feed

// Price history for velocity detection (Running Up)
const priceHistory = {};   // { ticker: [ { price, ts } ] }

// Frequency tracking for Running Up "(N in Xsec)" notes
const runUpFreq = {};      // { ticker: { count, windowStart, lastPrice } }

let broadcastFn = null;
let provider    = null;

// Update the 5-min window every 30 seconds
setInterval(() => {
  window5min.from = _etTimeStr(Date.now() - 5 * 60_000);
  window5min.to   = _etTimeStr(Date.now());
}, 30_000);

// ── Public API ────────────────────────────────────────────────────────────────

export function init({ broadcast, provider: p }) {
  broadcastFn = broadcast;
  provider    = p;
}

export function getScanners() {
  return { ...scanners, window5min };
}

export async function startScanning() {
  console.log('[scanner] Seeding from provider…');
  try {
    const gainers = await provider.fetchGainers();
    const filtered = gainers.filter(g =>
      g.price >= PRICE_MIN &&
      g.price <= PRICE_MAX &&
      g.volume >= VOL_MIN
    );

    if (filtered.length === 0) {
      console.warn('[scanner] No symbols passed filters — using mock data');
      await _seedMockData();
    } else {
      console.log(`[scanner] Fetching Finviz float for ${filtered.length} symbols…`);
      const floatMap = await batchGetFloats(filtered.map(g => g.symbol));

      const time = _etTimeStr(Date.now());
      for (const g of filtered) {
        const floatData = floatMap[g.symbol];
        const float     = floatData?.float ?? 0;
        const avgVol    = floatData?.avgVolume ?? g.avgDailyVolume ?? g.volume ?? 500_000;

        tickerMeta[g.symbol] = {
          sessionVol:     g.volume,
          avgDailyVolume: avgVol,
          prevClose:      g.prevClose,
          open:           g.open,
          float,
        };
        highWatermarks[g.symbol] = g.price;

        _updateRow(g.symbol, _buildRow(time, g, float, avgVol));
      }
      console.log(`[scanner] Seeded ${scanners.dayTrade.length} symbols with float data`);
    }
  } catch (err) {
    console.error('[scanner] Seed failed:', err.message, '— using mock data');
    await _seedMockData();
  }

  broadcastFn?.({ type: 'scanner', data: getScanners() });
}

/**
 * Called on each bar tick from server.js.
 * msg = { sym, c (close), av (accumulated volume) }
 */
export function handleTick(msg) {
  const ticker = msg.sym;
  const meta   = tickerMeta[ticker];
  if (!meta) return;

  const price = msg.c || 0;
  const now   = Date.now();
  meta.sessionVol = msg.av || meta.sessionVol;

  // Track price history for velocity detection
  if (!priceHistory[ticker]) priceHistory[ticker] = [];
  priceHistory[ticker].push({ price, ts: now });
  // Prune entries older than look-back window
  const cutoff = now - RU_LOOKBACK_MS;
  priceHistory[ticker] = priceHistory[ticker].filter(e => e.ts >= cutoff);

  // Update sorted scanner rows
  const existing = _findRow(ticker);
  if (existing) {
    const relVolDaily        = meta.avgDailyVolume > 0 ? meta.sessionVol / meta.avgDailyVolume : 0;
    const changeFromClose    = price - (meta.prevClose || price);
    const changeFromClosePct = (meta.prevClose || 0) > 0 ? (changeFromClose / meta.prevClose) * 100 : 0;
    const relVol5min         = _calc5minRelVol(meta);

    const updated = {
      ...existing,
      time:               _etTimeStr(now),
      price:              _round(price),
      volume:             meta.sessionVol,
      relVolDaily:        _round(relVolDaily),
      relVol5min:         _round(relVol5min),
      changeFromClose:    _round(changeFromClose),
      changeFromClosePct: _round(changeFromClosePct),
      newsIcon:           _computeNewsIcon(relVolDaily, changeFromClosePct),
    };
    _updateRow(ticker, updated);
  }

  // highMomentum alert feed — trigger on new intraday high
  const isNewHigh = !highWatermarks[ticker] || price > highWatermarks[ticker];
  if (isNewHigh) {
    highWatermarks[ticker] = price;
    _pushMomentumAlert(ticker, price, meta);
  }

  // Running Up alert feed — velocity + volume acceleration trigger
  _evaluateRunningUp(ticker, price, meta, now);

  broadcastFn?.({ type: 'scanner', data: getScanners() });
}

// ── Float enrichment for individual tickers (called by /api/quote) ────────────

export async function enrichWithFloat(ticker) {
  if (tickerMeta[ticker]?.float) return tickerMeta[ticker].float;
  const data = await getFloat(ticker);
  return data?.float ?? null;
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _buildRow(time, g, float, avgVol) {
  const relVolDaily = avgVol > 0 ? (g.volume || 0) / avgVol : 0;
  const relVol5min  = 0; // populated on first tick
  return {
    time,
    symbol:             g.symbol,
    price:              _round(g.price),
    prevClose:          _round(g.prevClose),
    open:               _round(g.open || g.price),
    volume:             g.volume || 0,
    float:              float || 0,
    avgDailyVolume:     avgVol,
    relVolDaily:        _round(relVolDaily),
    relVol5min:         _round(relVol5min),
    gapPct:             _round(g.gapPct),
    changeFromClose:    _round(g.changeFromClose),
    changeFromClosePct: _round(g.changeFromClosePct),
    newsIcon:           _computeNewsIcon(relVolDaily, g.changeFromClosePct || 0),
  };
}

function _updateRow(ticker, row) {
  _upsertRow(scanners.dayTrade, ticker, row);

  // lowFloat is the union of dayTrade and highMomentum candidates with float < threshold
  if ((row.float > 0 && row.float <= FLOAT_MAX_LOW) || row.float === 0) {
    _upsertRow(scanners.lowFloat, ticker, row);
  } else {
    const idx = scanners.lowFloat.findIndex(r => r.symbol === ticker);
    if (idx >= 0) scanners.lowFloat.splice(idx, 1);
  }

  for (const list of [scanners.dayTrade, scanners.lowFloat]) {
    list.sort((a, b) => b.changeFromClosePct - a.changeFromClosePct);
    if (list.length > 20) list.splice(20);
  }
}

function _pushMomentumAlert(ticker, price, meta) {
  const existing = _findRow(ticker);
  if (!existing) return;

  const relVolDaily = meta.avgDailyVolume > 0 ? meta.sessionVol / meta.avgDailyVolume : 0;
  const relVol5min  = _calc5minRelVol(meta);
  const newsIcon    = _computeNewsIcon(relVolDaily, existing.changeFromClosePct || 0);

  const alert = {
    time:        _etTimeStr(Date.now()),
    symbol:      ticker,
    price:       _round(price),
    volume:      meta.sessionVol,
    float:       meta.float || existing.float || 0,
    relVolDaily: _round(relVolDaily),
    relVol5min:  _round(relVol5min),
    newsIcon,
    // Fields needed for lowFloat eligibility check
    changeFromClosePct: existing.changeFromClosePct || 0,
  };

  scanners.highMomentum.unshift(alert);
  if (scanners.highMomentum.length > 50) scanners.highMomentum.pop();

  // Also add to lowFloat if it qualifies (float < threshold) — per interrelationship spec
  const float = alert.float;
  if ((float > 0 && float <= FLOAT_MAX_LOW) || float === 0) {
    const fullRow = scanners.dayTrade.find(r => r.symbol === ticker) || alert;
    _upsertRow(scanners.lowFloat, ticker, { ...fullRow, newsIcon });
    scanners.lowFloat.sort((a, b) => b.changeFromClosePct - a.changeFromClosePct);
    if (scanners.lowFloat.length > 20) scanners.lowFloat.splice(20);
  }
}

/**
 * Evaluates Running Up trigger criteria for a ticker on each tick.
 * Fires when: price up ≥ 4% in 60s window + relVolDaily ≥ 2.5 + relVol5min ≥ 3.0 + positive delta.
 */
function _evaluateRunningUp(ticker, price, meta, now) {
  const history = priceHistory[ticker];
  if (!history || history.length < 2) return;

  const oldest = history[0];
  const pricePctAdv = oldest.price > 0 ? ((price - oldest.price) / oldest.price) * 100 : 0;

  if (pricePctAdv < RU_PRICE_ADV_PCT) return;

  const relVolDaily = meta.avgDailyVolume > 0 ? meta.sessionVol / meta.avgDailyVolume : 0;
  if (relVolDaily < RU_REL_VOL_DAILY) return;

  const relVol5min = _calc5minRelVol(meta);
  if (relVol5min < RU_REL_VOL_5MIN) return;

  const delta = relVol5min - relVolDaily;
  if (delta < RU_DELTA_MIN) return;

  // Passed all criteria — compute frequency note
  const freq = runUpFreq[ticker] || { count: 0, windowStart: now };
  if (now - freq.windowStart <= RU_FREQ_WINDOW_MS) {
    freq.count += 1;
  } else {
    freq.count = 1;
    freq.windowStart = now;
  }
  runUpFreq[ticker] = freq;

  const elapsedSec = Math.round((now - freq.windowStart) / 1000);
  const frequencyNote = freq.count > 1 ? `(${freq.count} in ${Math.max(1, elapsedSec)}sec)` : '';

  const existing = _findRow(ticker);
  const newsIcon  = existing
    ? _computeNewsIcon(relVolDaily, existing.changeFromClosePct || 0)
    : _computeNewsIcon(relVolDaily, 0);

  const alert = {
    timestamp:      _etTimeStr(now),
    frequencyNote,
    symbol:         ticker,
    price:          _round(price),
    volume:         meta.sessionVol,
    float:          meta.float || existing?.float || 0,
    relVolDaily:    _round(relVolDaily),
    relVol5minPct:  _round(relVol5min),
    delta5minVsDaily: _round(delta),
    newsIcon,
  };

  // Deduplicate: update existing row for same ticker if it fired very recently (< 3s)
  const existingIdx = scanners.runningUp.findIndex(r => r.symbol === ticker);
  if (existingIdx >= 0) {
    scanners.runningUp[existingIdx] = alert;
  } else {
    scanners.runningUp.unshift(alert);
    if (scanners.runningUp.length > RU_MAX_ROWS) scanners.runningUp.pop();
  }
}

function _calc5minRelVol(meta) {
  const avg5min = (meta.avgDailyVolume || 0) / 78;
  if (avg5min <= 0) return 0;
  const minutesSinceOpen = _minutesSinceOpen();
  if (minutesSinceOpen <= 0) return 0;
  const pace5min = (meta.sessionVol / minutesSinceOpen) * 5;
  return pace5min / avg5min;
}

function _computeNewsIcon(relVol, changePct) {
  if (relVol >= 5 || changePct >= 30) return 'flame';
  if (relVol >= 3 || changePct >= 15) return 'yellowCircle';
  return null;
}

function _upsertRow(list, ticker, row) {
  const idx = list.findIndex(r => r.symbol === ticker);
  if (idx >= 0) list[idx] = row;
  else list.push(row);
}

function _findRow(ticker) {
  return scanners.dayTrade.find(r => r.symbol === ticker) ||
         scanners.lowFloat.find(r => r.symbol === ticker) ||
         null;
}

async function _seedMockData() {
  const mockRows = [
    { symbol: 'WSHP', price: 31.62, prevClose: 8.02,  open: 31.62, volume: 21_710_000, avgDailyVolume: 1_200_000, gapPct: 294, changeFromClose: 23.6,  changeFromClosePct: 284.62 },
    { symbol: 'MYSE', price: 3.83,  prevClose: 1.45,  open: 3.83,  volume: 135_980_000,avgDailyVolume: 8_000_000, gapPct: 164, changeFromClose: 2.38,  changeFromClosePct: 165.97 },
    { symbol: 'ONFO', price: 1.59,  prevClose: 0.66,  open: 1.59,  volume: 87_420_000, avgDailyVolume: 3_500_000, gapPct: 141, changeFromClose: 0.93,  changeFromClosePct: 138.38 },
    { symbol: 'WNW',  price: 4.58,  prevClose: 3.16,  open: 4.58,  volume: 9_140_000,  avgDailyVolume: 500_000,   gapPct: 44,  changeFromClose: 1.42,  changeFromClosePct: 44.94  },
    { symbol: 'MAMO', price: 1.33,  prevClose: 0.99,  open: 1.33,  volume: 19_920_000, avgDailyVolume: 1_100_000, gapPct: 34,  changeFromClose: 0.34,  changeFromClosePct: 34.80  },
    { symbol: 'AGAE', price: 0.59,  prevClose: 0.47,  open: 0.59,  volume: 62_770_000, avgDailyVolume: 4_000_000, gapPct: 25,  changeFromClose: 0.12,  changeFromClosePct: 25.04  },
  ];

  const floatMap = {
    WSHP: 1_330_000, MYSE: 3_840_000, ONFO: 3_900_000,
    WNW:  453_740,   MAMO: 4_990_000, AGAE: 16_950_000,
  };

  const time = _etTimeStr(Date.now());
  for (const r of mockRows) {
    tickerMeta[r.symbol] = { sessionVol: r.volume, avgDailyVolume: r.avgDailyVolume, prevClose: r.prevClose, open: r.open, float: floatMap[r.symbol] || 0 };
    highWatermarks[r.symbol] = r.price;
    _updateRow(r.symbol, _buildRow(time, r, floatMap[r.symbol] || 0, r.avgDailyVolume));
  }

  // Seed a few mock Running Up alerts
  const mockRunUp = [
    { symbol: 'WSHP', price: 32.10, relVolDaily: 4.2, relVol5minPct: 8.1, delta5minVsDaily: 3.9, float: 1_330_000, volume: 22_000_000, frequencyNote: '(2 in 3sec)', newsIcon: 'flame' },
    { symbol: 'MYSE', price: 3.95,  relVolDaily: 3.1, relVol5minPct: 5.4, delta5minVsDaily: 2.3, float: 3_840_000, volume: 136_000_000, frequencyNote: '',           newsIcon: 'yellowCircle' },
  ];
  for (const r of mockRunUp) {
    scanners.runningUp.push({ timestamp: time, ...r });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _etTimeStr(ms) {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function _minutesSinceOpen() {
  const now   = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const open  = new Date(etNow);
  open.setHours(9, 30, 0, 0);
  return Math.max(0, (etNow - open) / 60_000);
}

function _round(n) { return Math.round((n || 0) * 100) / 100; }
