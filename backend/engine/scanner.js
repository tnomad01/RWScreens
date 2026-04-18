// engine/scanner.js
// Three scanners matching Warrior Trading layout:
//   dayTrade     → "Top Gainers [window] (Online)"          — sorted by Change%
//   highMomentum → "Small Cap – High of Day Momentum"        — streaming alert feed
//   lowFloat     → "Low Float Top Gainers [window] (Online)" — sorted, float < 20M
//
// Float data is fetched from Finviz and cached for the session.

import { getFloat, batchGetFloats } from './float.js';

const PRICE_MIN  = 0.50;
const PRICE_MAX  = 30;
const VOL_MIN    = 100_000;
const FLOAT_MAX_LOW = 20_000_000;   // Low Float scanner threshold

// ── State ─────────────────────────────────────────────────────────────────────

const scanners = {
  dayTrade:     [],    // top gainers sorted by change%
  highMomentum: [],    // streaming momentum alert feed
  lowFloat:     [],    // low-float top gainers sorted by change%
};

// Rolling 5-min window timestamps for scanner headers
const window5min = {
  from: _etTimeStr(Date.now() - 5 * 60_000),
  to:   _etTimeStr(Date.now()),
};

// Per-ticker session data
const tickerMeta = {};    // { ticker: { sessionVol, avgDailyVolume, prevClose, open, float } }
const highWatermarks = {}; // { ticker: intraday high price } — for momentum feed

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
      // Fetch floats for all symbols in parallel (rate-limited inside batchGetFloats)
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
 * Checks for new intraday highs → pushes to momentum alert feed.
 * msg = { sym, c (close), av (accumulated volume) }
 */
export function handleTick(msg) {
  const ticker = msg.sym;
  const meta   = tickerMeta[ticker];
  if (!meta) return;

  const price = msg.c || 0;
  meta.sessionVol = msg.av || meta.sessionVol;

  // Update the sorted scanner rows
  const existing = _findRow(ticker);
  if (existing) {
    const relVolDaily        = meta.avgDailyVolume > 0 ? meta.sessionVol / meta.avgDailyVolume : 0;
    const changeFromClose    = price - (meta.prevClose || price);
    const changeFromClosePct = (meta.prevClose || 0) > 0 ? (changeFromClose / meta.prevClose) * 100 : 0;

    const updated = {
      ...existing,
      time:               _etTimeStr(Date.now()),
      price:              _round(price),
      volume:             meta.sessionVol,
      relVolDaily:        _round(relVolDaily),
      changeFromClose:    _round(changeFromClose),
      changeFromClosePct: _round(changeFromClosePct),
    };
    _updateRow(ticker, updated);
  }

  // Momentum alert feed — trigger on new intraday high
  const isNewHigh = !highWatermarks[ticker] || price > highWatermarks[ticker];
  if (isNewHigh) {
    highWatermarks[ticker] = price;
    _pushMomentumAlert(ticker, price, meta);
  }

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
    gapPct:             _round(g.gapPct),
    changeFromClose:    _round(g.changeFromClose),
    changeFromClosePct: _round(g.changeFromClosePct),
    hasNews:            false,   // set by news check if desired
  };
}

function _updateRow(ticker, row) {
  _upsertRow(scanners.dayTrade, ticker, row);

  if ((row.float > 0 && row.float <= FLOAT_MAX_LOW) || row.float === 0) {
    _upsertRow(scanners.lowFloat, ticker, row);
  } else {
    // Remove from lowFloat if float grew above threshold
    const idx = scanners.lowFloat.findIndex(r => r.symbol === ticker);
    if (idx >= 0) scanners.lowFloat.splice(idx, 1);
  }

  // Sort both by changeFromClosePct descending, cap at 20 rows
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

  const alert = {
    time:        _etTimeStr(Date.now()),
    symbol:      ticker,
    price:       _round(price),
    volume:      meta.sessionVol,
    float:       meta.float || existing.float || 0,
    relVolDaily: _round(relVolDaily),
    relVol5min:  _round(relVol5min),
    hasNews:     existing.hasNews || false,
  };

  // Prepend to feed (newest at top), cap at 50
  scanners.highMomentum.unshift(alert);
  if (scanners.highMomentum.length > 50) scanners.highMomentum.pop();
}

function _calc5minRelVol(meta) {
  // 5-min rel vol = current 5-min pace vs expected 5-min avg
  // Expected = avgDailyVolume / 78 (78 five-minute periods in a 6.5hr day)
  const avg5min = (meta.avgDailyVolume || 0) / 78;
  if (avg5min <= 0) return 0;
  // Current 5-min volume = rough estimate from session volume pace
  const minutesSinceOpen = _minutesSinceOpen();
  if (minutesSinceOpen <= 0) return 0;
  const pace5min = (meta.sessionVol / minutesSinceOpen) * 5;
  return pace5min / avg5min;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _etTimeStr(ms) {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function _minutesSinceOpen() {
  const now  = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const open  = new Date(etNow);
  open.setHours(9, 30, 0, 0);
  return Math.max(0, (etNow - open) / 60_000);
}

function _round(n) { return Math.round((n || 0) * 100) / 100; }
