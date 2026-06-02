// alerts/news-watcher.js
// Proactive discovery: polls trusted news sources and X handles for new tickers,
// checks float + price + momentum, and injects qualifying ones into the scanner.
//
// Sources are configured in backend/config/news-sources.json and reloaded hourly
// so new entries take effect without a server restart.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { enrichWithFloat, injectNewsDiscovery } from '../engine/scanner.js';
import { sendMessage }                          from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, '..', 'config', 'news-sources.json');

const POLL_INTERVAL_MS   = 5 * 60_000;   // poll every 5 minutes
const SOURCE_RELOAD_MS   = 60 * 60_000;  // reload sources file every hour
const TICKER_STAGGER_MS  = 350;

// Gate criteria for injection
const FLOAT_MIN  = 0;           // > 0 enforced by check below
const FLOAT_MAX  = 10_000_000;
const PRICE_MIN  = 0.50;
const PRICE_MAX  = 30;
const CHANGE_MIN = 5;           // |changePct| >= 5%

// xAI key rotation (shared rotation index with news-aggregator)
const _xaiKeys = () => [process.env.XAI_API_KEY_1, process.env.XAI_API_KEY_2].filter(Boolean);
let _keyIndex = 0;

// Sources state
let _sources    = [];
let _loadedAt   = 0;

// ── Public ────────────────────────────────────────────────────────────────────

export function startNewsWatcher(getScanners, provider) {
  const run = () => _poll(getScanners, provider);
  run();
  setInterval(run, POLL_INTERVAL_MS);
  console.log('[watcher] News watcher started (5-min discovery cycle)');
}

// ── Poll cycle ────────────────────────────────────────────────────────────────

async function _poll(getScanners, provider) {
  _loadSourcesIfStale();

  const enabled = _sources.filter(s => s.enabled);
  if (enabled.length === 0) return;

  // Split into API sources and X handle sources
  const apiSources = enabled.filter(s => s.type === 'api');
  const xSources   = enabled.filter(s => s.type === 'x' && s.channel === 'x_grok');

  // Collect discovered tickers from all sources
  const discovered = new Set();

  // Run API sources in parallel
  const apiResults = await Promise.allSettled(apiSources.map(s => _fetchApiSource(s)));
  for (const r of apiResults) {
    if (r.status === 'fulfilled') r.value.forEach(t => discovered.add(t));
  }

  // Batch all X handles into one Grok call
  if (xSources.length > 0) {
    const grokTickers = await _fetchXGrokBatch(xSources);
    grokTickers.forEach(t => discovered.add(t));
  }

  if (discovered.size === 0) return;

  // Filter out tickers already tracked in the scanner session
  const scanners   = getScanners();
  const knownSet   = _knownTickers(scanners);
  const newTickers = [...discovered].filter(t => !knownSet.has(t));

  if (newTickers.length === 0) return;
  console.log(`[watcher] Discovered ${newTickers.length} new candidate(s): ${newTickers.join(', ')}`);

  // Evaluate each new ticker against the gate criteria
  for (const ticker of newTickers) {
    try {
      const [quote, floatShares] = await Promise.all([
        provider.fetchQuote(ticker),
        enrichWithFloat(ticker),
      ]);

      const float  = floatShares ?? 0;
      const price  = quote.price ?? 0;
      const change = Math.abs(quote.changePct ?? 0);

      if (
        float > FLOAT_MIN && float < FLOAT_MAX &&
        price >= PRICE_MIN && price <= PRICE_MAX &&
        change >= CHANGE_MIN
      ) {
        // Find which source first surfaced this ticker (for Telegram)
        const sourceEntry = _findSourceForTicker(ticker, apiSources, xSources);

        injectNewsDiscovery(ticker, quote, float);

        const fmtFloat  = float >= 1_000_000 ? `${(float / 1_000_000).toFixed(1)}M` : `${(float / 1_000).toFixed(0)}K`;
        const fmtChange = `${quote.changePct >= 0 ? '+' : ''}${(quote.changePct ?? 0).toFixed(1)}%`;
        const rvol      = quote.relVolDaily != null ? `${quote.relVolDaily.toFixed(1)}×` : 'N/A';
        const srcLine   = sourceEntry
          ? `Source: ${sourceEntry.name}${sourceEntry.handle ? ` (${sourceEntry.handle})` : ''}`
          : 'Source: news discovery';

        sendMessage(
          `🔍 <b>NEWS DISCOVERY: ${ticker}</b>\n\n` +
          `$${price.toFixed(2)} ${fmtChange} | Float ${fmtFloat} | RVOL ${rvol}\n` +
          `${srcLine}\n\n` +
          `Added to scanner automatically.`
        );

        console.log(`[watcher] Injected: ${ticker} via ${sourceEntry?.name ?? 'unknown source'}`);
      }
    } catch (err) {
      console.warn(`[watcher] Error evaluating ${ticker}:`, err.message);
    }

    await _sleep(TICKER_STAGGER_MS);
  }
}

// ── Config reload ─────────────────────────────────────────────────────────────

function _loadSourcesIfStale() {
  if (Date.now() - _loadedAt < SOURCE_RELOAD_MS) return;
  try {
    const raw = fs.readFileSync(SOURCES_PATH, 'utf8');
    _sources  = JSON.parse(raw);
    _loadedAt = Date.now();
    const enabledCount = _sources.filter(s => s.enabled).length;
    console.log(`[watcher] Loaded ${_sources.length} news source(s) (${enabledCount} enabled)`);
  } catch (err) {
    console.warn('[watcher] Could not load news-sources.json:', err.message);
    if (_sources.length === 0) _sources = [];
  }
}

// ── API source drivers ────────────────────────────────────────────────────────

async function _fetchApiSource(source) {
  if (source.channel === 'marketaux_trending') return _fetchMarketauxTrending(source);
  if (source.channel === 'stocktwits_trending') return _fetchStockTwitsTrending();
  return [];
}

async function _fetchMarketauxTrending(source) {
  const key = process.env[source.envKey];
  if (!key) { console.warn(`[watcher] ${source.name}: env var ${source.envKey} not set`); return []; }
  try {
    const url = `https://api.marketaux.com/v1/entity/trending?api_token=${key}`;
    const res = await fetch(url);
    if (!res.ok) { console.warn(`[watcher] Marketaux trending HTTP ${res.status}`); return []; }
    const json = await res.json();
    return (json.data || [])
      .map(e => (e.symbol || '').toUpperCase().trim())
      .filter(t => /^[A-Z]{1,6}$/.test(t));
  } catch (err) {
    console.warn('[watcher] Marketaux trending error:', err.message);
    return [];
  }
}

async function _fetchStockTwitsTrending() {
  try {
    const res = await fetch('https://api.stocktwits.com/api/2/trending.json');
    if (!res.ok) { console.warn(`[watcher] StockTwits trending HTTP ${res.status}`); return []; }
    const json = await res.json();
    return (json.symbols || [])
      .map(s => (s.symbol || '').toUpperCase().trim())
      .filter(t => /^[A-Z]{1,6}$/.test(t));
  } catch (err) {
    console.warn('[watcher] StockTwits trending error:', err.message);
    return [];
  }
}

// ── X Grok driver ─────────────────────────────────────────────────────────────

async function _fetchXGrokBatch(xSources) {
  const keys = _xaiKeys();
  if (keys.length === 0) { console.warn('[watcher] No xAI API keys configured'); return []; }

  const key     = keys[_keyIndex % keys.length];
  _keyIndex++;

  const handles = xSources.map(s => s.handle).join(', ');
  const prompt  =
    `Search the most recent posts (last 2 hours) from these X accounts for stock ticker ` +
    `mentions that look like trading catalysts or breaking news: ${handles}. ` +
    `Reply with just the distinct ticker symbols (1–6 uppercase letters), one per line. No other text.`;

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model:    'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        search_parameters: { mode: 'on', sources: [{ type: 'x' }] },
        max_tokens: 200,
      }),
    });

    if (!res.ok) { console.warn(`[watcher] Grok API error ${res.status}`); return []; }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '';
    return text.split('\n')
      .map(l => l.trim().toUpperCase())
      .filter(t => /^[A-Z]{1,6}$/.test(t));
  } catch (err) {
    console.warn('[watcher] Grok X fetch error:', err.message);
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _knownTickers(scanners) {
  return new Set([
    ...(scanners.dayTrade     || []).map(r => r.symbol),
    ...(scanners.highMomentum || []).map(r => r.symbol),
    ...(scanners.lowFloat     || []).map(r => r.symbol),
    ...(scanners.runningUp    || []).map(r => r.symbol),
    ...Object.keys(scanners.session || {}),
  ]);
}

function _findSourceForTicker(ticker, apiSources, xSources) {
  // We can't cheaply map ticker back to the exact source that found it, so return
  // the first enabled X source (most likely for breaking news) or the first API source.
  return xSources[0] ?? apiSources[0] ?? null;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
