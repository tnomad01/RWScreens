// engine/float.js
// Fetches share float (and avg volume) with a two-source fallback chain:
//   1. Finviz  — primary; fast HTML scrape, works for most NYSE/NASDAQ stocks
//   2. Yahoo Finance — fallback via yahoo-finance2 (already installed, no extra key)
// ETFs return null from both sources and are naturally excluded.
// Results cached in memory for the session — float barely changes day to day.

import YahooFinance from 'yahoo-finance2';

const _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const CACHE   = {};   // { ticker: { float, avgVolume, marketCap } | null }
const PENDING = {};   // in-flight promises — prevents duplicate requests

const FINVIZ_URL = 'https://finviz.com/quote.ashx';
const DELAY_MS   = 300;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer':    'https://finviz.com/',
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns { float, avgVolume, marketCap } for a ticker.
 * float and avgVolume are raw numbers (e.g. 1330000 for 1.33M).
 * Returns null on failure — ticker not found on either source (likely an ETF).
 */
export async function getFloat(ticker) {
  ticker = ticker.toUpperCase();

  if (CACHE[ticker] !== undefined) return CACHE[ticker];

  // Deduplicate concurrent requests for the same ticker
  if (PENDING[ticker]) return PENDING[ticker];

  PENDING[ticker] = _fetchFloat(ticker).then(result => {
    CACHE[ticker] = result;
    delete PENDING[ticker];
    return result;
  });

  return PENDING[ticker];
}

/**
 * Batch fetch floats for a list of tickers with rate limiting.
 * Returns { TICKER: result } map.
 */
export async function batchGetFloats(tickers) {
  const results = {};
  for (const ticker of tickers) {
    results[ticker] = await getFloat(ticker);
    await _sleep(DELAY_MS);
  }
  return results;
}

/** Returns cached result without fetching (null if not yet fetched). */
export function getCached(ticker) {
  return CACHE[ticker.toUpperCase()] ?? null;
}

export function clearCache() {
  for (const k of Object.keys(CACHE))   delete CACHE[k];
  for (const k of Object.keys(PENDING)) delete PENDING[k];
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _fetchFloat(ticker) {
  const finviz = await _fetchFromFinviz(ticker);
  if (finviz) return finviz;
  return _fetchFromYahoo(ticker);
}

async function _fetchFromFinviz(ticker) {
  try {
    const url = `${FINVIZ_URL}?t=${ticker}&ty=c&ta=1&p=d`;
    const res  = await fetch(url, { headers: HEADERS });

    if (res.status === 404) return null;
    if (!res.ok)            { console.warn(`[float] ${ticker}: Finviz HTTP ${res.status}`); return null; }

    const html = await res.text();
    const data = _parseFinvizTable(html);
    if (!data['Shs Float']) return null;

    const result = {
      float:      _parseNum(data['Shs Float']),
      avgVolume:  _parseNum(data['Avg Volume'] || data['Avg Vol']),
      marketCap:  _parseNum(data['Market Cap']),
    };

    console.log(`[float] ${ticker}: float=${_fmt(result.float)} avgVol=${_fmt(result.avgVolume)}`);
    return result;
  } catch {
    return null;
  }
}

async function _fetchFromYahoo(ticker) {
  try {
    const r = await _yf.quoteSummary(ticker, {
      modules: ['defaultKeyStatistics', 'summaryDetail'],
    });

    const floatShares = r.defaultKeyStatistics?.floatShares;
    if (!floatShares) {
      console.warn(`[float] ${ticker}: not found on Finviz or Yahoo — skipping`);
      return null;
    }

    const avgVolume = r.summaryDetail?.averageVolume ?? null;
    const marketCap = r.summaryDetail?.marketCap ?? null;

    console.log(`[float] ${ticker}: float=${_fmt(floatShares)} avgVol=${_fmt(avgVolume)} (Yahoo)`);
    return { float: floatShares, avgVolume, marketCap };
  } catch {
    console.warn(`[float] ${ticker}: not found on Finviz or Yahoo — skipping`);
    return null;
  }
}

/**
 * Parses all label→value pairs from the Finviz snapshot table.
 * Handles multiple Finviz HTML layouts.
 */
function _parseFinvizTable(html) {
  const data = {};

  // Pattern 1: Current layout — <div class="snapshot-td-label">Label</div> ... <div class="snapshot-td-content"><b>Value</b></div>
  const re1 = /<div class="snapshot-td-label">([^<]+)<\/div><\/td><td[^>]*>[^<]*<div class="snapshot-td-content"[^>]*><b>([^<]+)<\/b>/g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    const label = m[1].trim();
    const val   = m[2].trim();
    if (label && val && val !== '-') data[label] = val;
  }

  // Pattern 2: Older layout — <td ...>Label</td><td ...><b>Value</b></td>
  const re2 = /<td[^>]*>([A-Za-z][^<]{1,30})<\/td>\s*<td[^>]*>\s*(?:<b>)?([0-9][^<]+)(?:<\/b>)?/g;
  while ((m = re2.exec(html)) !== null) {
    const label = m[1].trim();
    const val   = m[2].trim();
    if (label && val && val !== '-' && !data[label]) data[label] = val;
  }

  // Pattern 3: data-boxover label attribute (intermediate layout)
  const re3 = /data-boxover-html="([^"]+)"[^>]*>[^<]*<div class="snapshot-td-label">[^<]*<\/div><\/td><td[^>]*>[^<]*<div[^>]*><b>([^<]+)<\/b>/g;
  while ((m = re3.exec(html)) !== null) {
    const label = m[1].trim();
    const val   = m[2].trim();
    if (label && val && val !== '-' && !data[label]) data[label] = val;
  }

  return data;
}

/** Converts Finviz number string to raw integer (e.g. "1.33M" → 1330000) */
function _parseNum(str) {
  if (!str || str === '-') return null;
  str = str.replace(/,/g, '').trim();
  const mul = str.endsWith('T') ? 1e12
            : str.endsWith('B') ? 1e9
            : str.endsWith('M') ? 1e6
            : str.endsWith('K') ? 1e3
            : 1;
  const n = parseFloat(str);
  return isNaN(n) ? null : Math.round(n * mul);
}

function _fmt(n)     { if (!n) return 'N/A'; if (n >= 1e6) return (n/1e6).toFixed(2)+'M'; if (n >= 1e3) return (n/1e3).toFixed(0)+'K'; return String(n); }
function _sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }
