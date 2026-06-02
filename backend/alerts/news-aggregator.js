// alerts/news-aggregator.js
// Polls multiple news sources every 5 minutes for all seeded tickers.
// Sources: active data provider, xAI Grok live X/web search (batched), SEC EDGAR 8-K filings.
// Writes directly into newsCache from pillars-tracker.js.

import { newsCache } from './pillars-tracker.js';

const POLL_INTERVAL_MS  = 5 * 60_000;
const TICKER_STAGGER_MS = 350; // space out per-ticker EDGAR + provider calls

// xAI key rotation state
const _xaiKeys = () => [
  process.env.XAI_API_KEY_1,
  process.env.XAI_API_KEY_2,
].filter(Boolean);
let _keyIndex = 0;

// ── Public ────────────────────────────────────────────────────────────────────

export function startNewsAggregator(getScanners, provider) {
  const run = () => _poll(getScanners, provider);
  run(); // immediate first pass
  setInterval(run, POLL_INTERVAL_MS);
  console.log('[news] Aggregator started (provider + Grok + EDGAR, 5-min interval)');
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function _poll(getScanners, provider) {
  const tickers = _activeTickers(getScanners());
  if (tickers.length === 0) return;

  // Grok: one batched request covers all tickers
  const grokHits = await _checkGrokBatch(tickers);
  if (grokHits.size > 0) {
    console.log(`[news] Grok hits: ${[...grokHits].join(', ')}`);
  }

  // Provider + EDGAR: per-ticker, staggered to avoid bursting
  for (const ticker of tickers) {
    const [providerRes, edgarRes] = await Promise.allSettled([
      _checkProvider(ticker, provider),
      _checkEdgar(ticker),
    ]);

    const hasNews =
      grokHits.has(ticker) ||
      (providerRes.status === 'fulfilled' && providerRes.value === true) ||
      (edgarRes.status    === 'fulfilled' && edgarRes.value    === true);

    newsCache.set(ticker, { hasNews, cachedAt: Date.now() });

    if (hasNews) console.log(`[news] Catalyst confirmed: ${ticker}`);
    await _sleep(TICKER_STAGGER_MS);
  }
}

// ── Grok batch ────────────────────────────────────────────────────────────────

async function _checkGrokBatch(tickers) {
  const keys = _xaiKeys();
  if (keys.length === 0) return new Set();

  const key = keys[_keyIndex % keys.length];
  _keyIndex++;

  const tickerList = tickers.join(', ');
  const prompt =
    `Search X posts and recent web news for each of these stock tickers. ` +
    `For each, reply YES if there is a significant catalyst in the last 24 hours ` +
    `(press release, earnings, partnership, acquisition, SEC filing, major announcement on X), ` +
    `or NO if nothing significant found. ` +
    `Format exactly as: TICKER:YES or TICKER:NO, one per line. No other text. ` +
    `Tickers: ${tickerList}`;

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        search_parameters: {
          mode:    'on',
          sources: [{ type: 'x' }, { type: 'web' }],
        },
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      console.warn(`[news] Grok API error ${res.status}`);
      return new Set();
    }

    const json  = await res.json();
    const text  = json.choices?.[0]?.message?.content ?? '';
    const hits  = new Set();

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

// ── SEC EDGAR 8-K search ──────────────────────────────────────────────────────

async function _checkEdgar(ticker) {
  try {
    const today = _etDateString();
    const url   =
      `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22` +
      `&forms=8-K&dateRange=custom&startdt=${today}&enddt=${today}`;

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'warrior-trading-screener mark.s.wall@gmail.com' },
    });
    if (!res.ok) return false;

    const json = await res.json();
    return (json.hits?.total?.value ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Provider news ─────────────────────────────────────────────────────────────

async function _checkProvider(ticker, provider) {
  try {
    const items = await provider.fetchNews(ticker);
    return items.length > 0;
  } catch {
    return false;
  }
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
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
