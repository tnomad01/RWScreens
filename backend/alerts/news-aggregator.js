// ─────────────────────────────────────────────────────────────────────────────
// backend/alerts/news-aggregator.js  ·  v1.2
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Polls 9 news sources every 5 minutes for every ticker currently
//           tracked in the scanner. Writes a { hasNews, cachedAt } result to
//           newsCache (in pillars-tracker.js) which the /5P command reads to
//           evaluate the Catalyst pillar.
//
// Sources:  Phase 1 — free, no key required:
//             provider (Alpaca/Polygon news), Grok live search (batched),
//             EDGAR 8-K same-day, Yahoo Finance, StockTwits (links only), Finviz
//           Phase 2 — free tier API keys, daily quota protected:
//             Alpha Vantage NEWS_SENTIMENT, Marketaux per-ticker, NewsAPI
//
// Config:   XAI_API_KEY_1, XAI_API_KEY_2        xAI key rotation
//           ALPHA_VANTAGE_API_KEY                Phase 2
//           MARKETAUX_API_KEY                    Phase 2
//           NEWS_API_KEY                         Phase 2
//
// Exports:  startNewsAggregator(getScanners, provider)
//
// Depends:  alerts/pillars-tracker.js  (newsCache)
// ─────────────────────────────────────────────────────────────────────────────

import { newsCache } from './pillars-tracker.js';

const POLL_INTERVAL_MS  = 5 * 60_000;
const TICKER_STAGGER_MS = 400;

// Finviz rate-limit guard (shared with float.js — both scrape finviz.com)
let _lastFinvizMs = 0;

// xAI key rotation
const _xaiKeys = () => [process.env.XAI_API_KEY_1, process.env.XAI_API_KEY_2].filter(Boolean);
let _keyIndex = 0;

// Daily quota cache for Phase 2 sources: "TICKER:source" → "YYYY-MM-DD"
const _dailyQuotaCache = new Map();

const FINVIZ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer':    'https://finviz.com/',
};

// ── Public ────────────────────────────────────────────────────────────────────

export function startNewsAggregator(getScanners, provider) {
  const run = () => _poll(getScanners, provider);
  run();
  setInterval(run, POLL_INTERVAL_MS);
  console.log('[news] Aggregator started (provider+Grok+EDGAR+Yahoo+StockTwits+Finviz+AV+Marketaux+NewsAPI, 5-min)');
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function _poll(getScanners, provider) {
  const tickers = _activeTickers(getScanners());
  if (tickers.length === 0) return;

  // Grok: one batched request for all tickers
  const grokHits = await _checkGrokBatch(tickers);
  if (grokHits.size > 0) console.log(`[news] Grok hits: ${[...grokHits].join(', ')}`);

  for (const ticker of tickers) {
    // Phase 1: free sources — all in parallel
    const [providerRes, edgarRes, yahooRes, stocktwitsRes, finvizRes] =
      await Promise.allSettled([
        _checkProvider(ticker, provider),
        _checkEdgar(ticker),
        _checkYahooFinance(ticker),
        _checkStockTwits(ticker),
        _checkFinvizNews(ticker),
      ]);

    // Phase 2: quota-limited — sequential, gated by daily check
    const avRes        = await _checkAlphaVantage(ticker);
    const marketauxRes = await _checkMarketaux(ticker);
    const newsApiRes   = await _checkNewsAPI(ticker);

    const hasNews =
      grokHits.has(ticker)   ||
      _ok(providerRes)       || _ok(edgarRes)    || _ok(yahooRes) ||
      _ok(stocktwitsRes)     || _ok(finvizRes)   ||
      avRes                  || marketauxRes      || newsApiRes;

    newsCache.set(ticker, { hasNews, cachedAt: Date.now() });
    if (hasNews) console.log(`[news] Catalyst confirmed: ${ticker}`);
    await _sleep(TICKER_STAGGER_MS);
  }
}

function _ok(r) { return r.status === 'fulfilled' && r.value === true; }

// ── Grok batch ────────────────────────────────────────────────────────────────

async function _checkGrokBatch(tickers) {
  const keys = _xaiKeys();
  if (keys.length === 0) return new Set();

  const key = keys[_keyIndex % keys.length];
  _keyIndex++;

  const prompt =
    `Search X posts and recent web news for each of these stock tickers. ` +
    `For each, reply YES if there is a significant catalyst in the last 24 hours ` +
    `(press release, earnings, partnership, acquisition, SEC filing, major announcement on X), ` +
    `or NO if nothing significant found. ` +
    `Format exactly as: TICKER:YES or TICKER:NO, one per line. No other text. ` +
    `Tickers: ${tickers.join(', ')}`;

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        search_parameters: { mode: 'on', sources: [{ type: 'x' }, { type: 'web' }] },
        max_tokens: 300,
      }),
    });

    if (!res.ok) { console.warn(`[news] Grok API error ${res.status}`); return new Set(); }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '';
    const hits = new Set();
    for (const line of text.split('\n')) {
      const m = line.trim().match(/^([A-Z]{1,6}):YES$/i);
      if (m) hits.add(m[1].toUpperCase());
    }
    return hits;
  } catch (err) {
    console.warn('[news] Grok fetch error:', err.message);
    return new Set();
  }
}

// ── Phase 1: free sources ─────────────────────────────────────────────────────

async function _checkProvider(ticker, provider) {
  try {
    const items = await provider.fetchNews(ticker);
    return items.length > 0;
  } catch { return false; }
}

async function _checkEdgar(ticker) {
  try {
    const today = _etDateString();
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22` +
                `&forms=8-K&dateRange=custom&startdt=${today}&enddt=${today}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'warrior-trading-screener mark.s.wall@gmail.com' } });
    if (!res.ok) return false;
    const json = await res.json();
    return (json.hits?.total?.value ?? 0) > 0;
  } catch { return false; }
}

async function _checkYahooFinance(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=5&quotesCount=0`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return false;
    const json = await res.json();
    const yesterday = Math.floor(Date.now() / 1000) - 86_400;
    return (json.news || []).some(n => (n.providerPublishTime ?? 0) > yesterday);
  } catch { return false; }
}

async function _checkStockTwits(ticker) {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(ticker)}.json`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const json = await res.json();
    // Only signal true when a message contains an external link — plain commentary is too noisy
    return (json.messages || []).some(m => (m.entities?.links?.length ?? 0) > 0);
  } catch { return false; }
}

async function _checkFinvizNews(ticker) {
  try {
    // Finviz rate-limit: min 1s between requests
    const gap = Date.now() - _lastFinvizMs;
    if (gap < 1000) await _sleep(1000 - gap);
    _lastFinvizMs = Date.now();

    const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}&ty=c&ta=1&p=d`;
    const res = await fetch(url, { headers: FINVIZ_HEADERS });
    if (!res.ok) return false;

    const html = await res.text();
    // News table rows have a date column — "Today" means same-day news
    const newsTableMatch = html.match(/id="news-table"[\s\S]*?<\/table>/i);
    if (!newsTableMatch) return false;
    return /Today/i.test(newsTableMatch[0]);
  } catch { return false; }
}

// ── Phase 2: quota-limited sources ───────────────────────────────────────────

function _quotaCheck(ticker, source) {
  const key   = `${ticker}:${source}`;
  const today = _etDateString();
  if (_dailyQuotaCache.get(key) === today) return false; // already checked today
  _dailyQuotaCache.set(key, today);
  return true;
}

async function _checkAlphaVantage(ticker) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key || !_quotaCheck(ticker, 'av')) return false;
  try {
    const today = _etDateString().replace(/-/g, '');
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(ticker)}&time_from=${today}T0000&limit=5&apikey=${key}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const json = await res.json();
    return (json.feed?.length ?? 0) > 0;
  } catch { return false; }
}

async function _checkMarketaux(ticker) {
  const key = process.env.MARKETAUX_API_KEY;
  if (!key || !_quotaCheck(ticker, 'mx')) return false;
  try {
    const today = _etDateString();
    const url = `https://api.marketaux.com/v1/news/all?symbols=${encodeURIComponent(ticker)}&filter_entities=true&published_after=${today}&api_token=${key}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const json = await res.json();
    return (json.data?.length ?? 0) > 0;
  } catch { return false; }
}

async function _checkNewsAPI(ticker) {
  const key = process.env.NEWS_API_KEY;
  if (!key || !_quotaCheck(ticker, 'napi')) return false;
  try {
    const today = _etDateString();
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(ticker)}&from=${today}&sortBy=publishedAt&pageSize=5&apiKey=${key}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const json = await res.json();
    return (json.articles?.length ?? 0) > 0;
  } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _activeTickers(scanners) {
  return [...new Set([
    ...(scanners.dayTrade     || []).map(r => r.symbol),
    ...(scanners.highMomentum || []).map(r => r.symbol),
    ...(scanners.lowFloat     || []).map(r => r.symbol),
    ...(scanners.runningUp    || []).map(r => r.symbol),
    ...Object.keys(scanners.session || {}),
  ])];
}

function _etDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
