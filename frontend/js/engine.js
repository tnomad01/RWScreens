// ─────────────────────────────────────────────────────────────────────────────
// frontend/js/engine.js  ·  v1.0
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Foundation module. Owns the global state object (window.liveData),
//           the EventTarget event bus (window.events), and the WebSocket client
//           that connects to the backend. All other frontend modules subscribe
//           to events rather than calling engine.js directly.
//
// Events fired:
//   dataUpdated      scanner snapshot refreshed  (scanners.js)
//   liveTick         new OHLCV bar arrived        (charts.js)
//   quoteLoaded      REST quote fetch completed   (pillars.js)
//   newsLoaded       REST news fetch completed    (pillars.js)
//   quoteUpdated     live trade price update      (pillars.js)
//   symbolSelected   user clicked a ticker row    (charts.js, scanners.js, pillars.js)
//
// Exports:  fetchBars(ticker, tf), fetchScanners(), selectSymbol(ticker)
// ─────────────────────────────────────────────────────────────────────────────

const WS_PORT = 3000;
const WS_URL  = `ws://${location.hostname}:${WS_PORT}`;

// ── Global state ──────────────────────────────────────────────────────────────

window.liveData = {
  currentSymbol: null,
  scanners: { dayTrade: [], highMomentum: [], lowFloat: [] },
  quote:    {},
  news:     [],
  // { 'AAPL': { '1m': { candles, volume, vwap, ... }, '10s': {...}, '1D': {...} } }
  chartDataCache: {},
};

window.events = new EventTarget();

// ── WebSocket client ──────────────────────────────────────────────────────────

let ws = null;

function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    console.log('[engine] WebSocket connected to backend');
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    _routeMessage(msg);
  });

  ws.addEventListener('close', () => {
    console.warn('[engine] WebSocket closed — reconnecting in 3s');
    setTimeout(connectWS, 3_000);
  });

  ws.addEventListener('error', (err) => {
    console.error('[engine] WebSocket error:', err);
  });
}

function _routeMessage(msg) {
  switch (msg.type) {
    case 'scanner':
      window.liveData.scanners = msg.data;
      window.events.dispatchEvent(new CustomEvent('dataUpdated', { detail: msg.data }));
      break;

    case 'provider':
      window.liveData.provider = msg.name;
      break;

    case 'tick':
      if (msg.ticker === window.liveData.currentSymbol) {
        window.events.dispatchEvent(new CustomEvent('liveTick', { detail: msg }));
      }
      break;

    case 'quote':
      if (msg.ticker === window.liveData.currentSymbol) {
        window.liveData.quote.price = msg.price;
        window.events.dispatchEvent(new CustomEvent('quoteUpdated', { detail: msg }));
      }
      break;
  }
}

// ── Symbol selection ──────────────────────────────────────────────────────────

/**
 * Call this to select a new ticker from anywhere in the UI.
 * Sends subscribe to backend, fetches bars + quote + news, fires symbolSelected.
 */
window.selectSymbol = async function(ticker) {
  if (!ticker) return;

  // Unsubscribe old symbol's live stream
  if (window.liveData.currentSymbol && window.liveData.currentSymbol !== ticker) {
    _wsSend({ action: 'unsubscribe', ticker: window.liveData.currentSymbol });
  }

  window.liveData.currentSymbol = ticker;

  // Subscribe new symbol to live stream
  _wsSend({ action: 'subscribe', ticker });

  // Dispatch event immediately so UI shows loading state
  window.events.dispatchEvent(new CustomEvent('symbolSelected', { detail: { ticker } }));

  // Fetch all data in parallel
  const [quote, news] = await Promise.all([
    fetchQuote(ticker),
    fetchNews(ticker),
  ]);

  window.liveData.quote = quote;
  window.liveData.news  = news;

  window.events.dispatchEvent(new CustomEvent('quoteLoaded',  { detail: { ticker, quote } }));
  window.events.dispatchEvent(new CustomEvent('newsLoaded',   { detail: { ticker, news  } }));
};

// ── API helpers ───────────────────────────────────────────────────────────────

const CACHE_MAX_SYMBOLS = 10;
const _cacheOrder = [];  // insertion-order tracker for LRU eviction

export async function fetchBars(ticker, timeframe) {
  const cache = window.liveData.chartDataCache;
  if (cache[ticker]?.[timeframe]) return cache[ticker][timeframe];

  const res  = await fetch(`/api/bars?ticker=${ticker}&timeframe=${timeframe}`);
  if (!res.ok) throw new Error(`/api/bars error: ${res.status}`);
  const data = await res.json();

  if (!cache[ticker]) {
    cache[ticker] = {};
    _cacheOrder.push(ticker);
    if (_cacheOrder.length > CACHE_MAX_SYMBOLS) {
      delete cache[_cacheOrder.shift()];
    }
  }
  cache[ticker][timeframe] = data;
  return data;
}

export async function fetchQuote(ticker) {
  const res = await fetch(`/api/quote?ticker=${ticker}`);
  if (!res.ok) throw new Error(`/api/quote error: ${res.status}`);
  return res.json();
}

export async function fetchNews(ticker) {
  const res = await fetch(`/api/news?ticker=${ticker}`);
  if (!res.ok) throw new Error(`/api/news error: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

export async function fetchScanners() {
  const res = await fetch('/api/scanners');
  if (!res.ok) throw new Error(`/api/scanners error: ${res.status}`);
  return res.json();
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _wsSend(obj) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

connectWS();
