// server.js
// Express HTTP + WebSocket server.
// Selects the active data provider from DATA_PROVIDER env var (alpaca | polygon).
// All provider-specific code lives in providers/alpaca.js and providers/polygon.js.

import { config as dotenvConfig } from 'dotenv';
import path       from 'path';
import { fileURLToPath } from 'url';
import express    from 'express';
import http       from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import alpacaProvider  from './providers/alpaca.js';
import polygonProvider from './providers/polygon.js';
import { computeHistory, updateBar }                               from './engine/vwap.js';
import { init as initScanner, getScanners, startScanning, handleTick, enrichWithFloat } from './engine/scanner.js';
import { checkNewGainers } from './alerts/gainers-tracker.js';
import { startPolling }    from './alerts/bot-commands.js';

const ema200Cache = new Map();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load environment ──────────────────────────────────────────────────────────

dotenvConfig({ path: path.join(__dirname, '..', '.env') });

// ── Select provider ───────────────────────────────────────────────────────────

const PROVIDER_NAME = (process.env.DATA_PROVIDER || 'alpaca').toLowerCase();
const provider      = PROVIDER_NAME === 'polygon' ? polygonProvider : alpacaProvider;

console.log(`\n📡 Data provider: ${PROVIDER_NAME.toUpperCase()}`);

// Build credentials object for the selected provider
const credentials = PROVIDER_NAME === 'polygon'
  ? { apiKey: process.env.POLYGON_API_KEY }
  : { keyId: process.env.ALPACA_API_KEY, secretKey: process.env.ALPACA_SECRET_KEY };

// Validate required credentials are present
const REQUIRED_VARS = PROVIDER_NAME === 'polygon'
  ? ['POLYGON_API_KEY']
  : ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY'];

const missingCreds = REQUIRED_VARS.filter(v => !process.env[v]);

if (missingCreds.length > 0) {
  console.error(`\nERROR: Missing credentials for ${PROVIDER_NAME}: ${missingCreds.join(', ')}`);
  console.error('Check your .env file.\n');
  process.exit(1);
}

// ── Express app ───────────────────────────────────────────────────────────────

const PORT   = parseInt(process.env.PORT || '3000', 10);
const app    = express();
const server = http.createServer(app);

// Serve the frontend as static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── REST endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/bars?ticker=AAPL&timeframe=1m
 * Returns pre-computed OHLCV + VWAP/EMA indicators.
 */
app.get('/api/bars', async (req, res) => {
  const { ticker, timeframe } = req.query;
  if (!ticker || !timeframe) return res.status(400).json({ error: 'ticker and timeframe required' });

  try {
    const { bars: raw, dataSource } = await provider.fetchRawBars(ticker, timeframe);
    const result = computeHistory(ticker, raw);
    res.json({ ...result, dataSource });
  } catch (err) {
    console.error('[/api/bars]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/quote?ticker=AAPL
 */
app.get('/api/quote', async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  try {
    const [quote, floatShares] = await Promise.all([
      provider.fetchQuote(ticker),
      enrichWithFloat(ticker),
    ]);
    if (floatShares !== null) quote.float = floatShares;
    res.json(quote);
  } catch (err) {
    console.error('[/api/quote]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/news?ticker=AAPL
 */
app.get('/api/news', async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  try {
    const items = await provider.fetchNews(ticker);
    res.json({ items, count: items.length });
  } catch (err) {
    console.error('[/api/news]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/scanners — initial scanner state for page load
 */
app.get('/api/scanners', (_req, res) => res.json(getScanners()));

/**
 * GET /api/provider — tells the frontend which provider is active
 */
app.get('/api/provider', (_req, res) => res.json({ name: PROVIDER_NAME }));

/**
 * GET /api/scanner-debug — explains Trade Ideas seed filtering.
 */
app.get('/api/scanner-debug', (_req, res) => {
  const debug = typeof provider.getScannerSeedDebug === 'function'
    ? provider.getScannerSeedDebug()
    : {
        source: PROVIDER_NAME,
        refreshedAt: null,
        candidates: [],
        message: 'Provider does not expose scanner seed diagnostics.',
      };
  res.json(debug);
});

// ── Browser WebSocket server ──────────────────────────────────────────────────

const wss     = new WebSocketServer({ server });
const clients = new Set();

function broadcast(msg) {
  const json = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(json);
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[ws] Client connected (${clients.size} total)`);
  ws.send(JSON.stringify({ type: 'scanner', data: getScanners() }));
  ws.send(JSON.stringify({ type: 'provider', name: PROVIDER_NAME }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.action === 'subscribe'   && msg.ticker) provider.subscribe([msg.ticker]);
    if (msg.action === 'unsubscribe' && msg.ticker) provider.unsubscribe([msg.ticker]);
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected (${clients.size} total)`);
  });

  ws.on('error', () => clients.delete(ws));
});

// ── Route provider messages → browser clients ─────────────────────────────────

provider.onMessage((msg) => {
  switch (msg.type) {
    case 'trade':
      // Live price update for quote header
      broadcast({ type: 'quote', ticker: msg.ticker, price: msg.price, size: msg.size, timestamp: msg.timestamp });
      break;

    case 'bar': {
      // Compute VWAP/EMA for this bar, then broadcast enriched tick
      const ind = updateBar(msg.ticker, msg.bar);
      const bar = msg.bar;

      // Feed scanner engine with bar data (for rel-vol tracking)
      if (ind.ema200 !== null) ema200Cache.set(msg.ticker, ind.ema200);
      if (msg.timeframe === '10s' || msg.timeframe === '1m') {
        handleTick({ sym: msg.ticker, c: bar.close, av: bar.volume });
        checkNewGainers(getScanners());
      }

      broadcast({
        type:      'tick',
        ticker:    msg.ticker,
        timeframe: msg.timeframe,
        bar: {
          candle:     { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close },
          volume:     { time: bar.time, value: bar.volume, color: bar.close >= bar.open ? '#00ff9d44' : '#ff003344' },
          vwap:       { time: ind.time, value: ind.vwap },
          vwapPlus1:  { time: ind.time, value: ind.vwapPlus1 },
          vwapMinus1: { time: ind.time, value: ind.vwapMinus1 },
          vwapPlus2:  { time: ind.time, value: ind.vwapPlus2 },
          vwapMinus2: { time: ind.time, value: ind.vwapMinus2 },
          ema9:       ind.ema9   !== null ? { time: ind.time, value: ind.ema9   } : null,
          ema20:      ind.ema20  !== null ? { time: ind.time, value: ind.ema20  } : null,
          ema200:     ind.ema200 !== null ? { time: ind.time, value: ind.ema200 } : null,
        },
      });
      break;
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

initScanner({ broadcast, provider });

server.listen(PORT, () => {
  console.log(`🟢 Warrior Trading running at http://localhost:${PORT}\n`);
  provider.connect(credentials);
  startScanning().then(() => {
    const seeded = getScanners().dayTrade.map(r => r.symbol);
    if (seeded.length > 0) {
      console.log(`[scanner] Subscribing to ${seeded.length} seeded tickers:`, seeded.join(', '));
      provider.subscribe(seeded);
    }
    checkNewGainers(getScanners());
  });
  startPolling(getScanners, ema200Cache, provider);
});
