// providers/alpaca.js
// Alpaca Markets data provider — free IEX feed.
// Implements the standard provider interface used by server.js and scanner.js.
//
// Provider interface (both providers implement these):
//   connect(credentials)
//   disconnect()
//   subscribe(tickers)
//   unsubscribe(tickers)
//   onMessage(handler)          — normalized { type, ticker, ... } messages
//   fetchRawBars(ticker, tf)    — [{time, open, high, low, close, volume}]
//   fetchQuote(ticker)          — normalized quote object
//   fetchNews(ticker, limit)    — [{id, title, publishedAt, url, source}]
//   fetchGainers()              — normalized scanner seed rows

import { WebSocket } from 'ws';

const WS_URL  = 'wss://stream.data.alpaca.markets/v2/iex';
const REST_URL = 'https://data.alpaca.markets';

class AlpacaProvider {
  constructor() {
    this.name            = 'alpaca';
    this.ws              = null;
    this.authed          = false;
    this.intentionalClose = false;
    this.reconnectMs     = 1_000;
    this.maxReconnectMs  = 30_000;
    this.heartbeatTimer  = null;
    this.credentials     = null;
    this.handlers        = [];
    // Pending subscriptions (sent after auth)
    this.pending = { trades: new Set(), bars: new Set(), updatedBars: new Set() };
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  connect(credentials) {
    this.credentials     = credentials;
    this.intentionalClose = false;
    this._open();
  }

  disconnect() {
    this.intentionalClose = true;
    clearInterval(this.heartbeatTimer);
    if (this.ws) this.ws.close();
  }

  /**
   * Subscribe to trades + minute bars + updated (in-progress) bars for each ticker.
   * Updated bars give near-real-time price action on the 10s charts (free tier doesn't
   * have true second bars, but updatedBars fires on every trade).
   */
  subscribe(tickers) {
    tickers.forEach(t => {
      this.pending.trades.add(t);
      this.pending.bars.add(t);
      this.pending.updatedBars.add(t);
    });
    if (this.authed) this._sendSubscribe(tickers);
  }

  unsubscribe(tickers) {
    tickers.forEach(t => {
      this.pending.trades.delete(t);
      this.pending.bars.delete(t);
      this.pending.updatedBars.delete(t);
    });
    if (this.authed && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action:      'unsubscribe',
        trades:      tickers,
        bars:        tickers,
        updatedBars: tickers,
      }));
    }
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  // ── REST ──────────────────────────────────────────────────────────────────

  /**
   * Raw OHLCV bars for a ticker + timeframe.
   * NOTE: Alpaca free (IEX) has no second-level historical bars.
   *       '10s' maps to '1Min' bars — live updatedBars provide near-real-time detail.
   */
  async fetchRawBars(ticker, timeframe) {
    const { tf, from, to } = _resolveAlpacaTimeframe(timeframe);
    const url = `${REST_URL}/v2/stocks/${ticker}/bars` +
      `?timeframe=${tf}&start=${from}&end=${to}&limit=1000&feed=iex&adjustment=raw`;
    const data = await this._fetch(url);

    return (data.bars || []).map(b => ({
      time:   Math.floor(new Date(b.t).getTime() / 1000),
      open:   b.o,
      high:   b.h,
      low:    b.l,
      close:  b.c,
      volume: b.v,
    }));
  }

  /**
   * Current quote / snapshot for a ticker.
   * Returns a normalized quote object compatible with /api/quote.
   */
  async fetchQuote(ticker) {
    const url = `${REST_URL}/v2/stocks/${ticker}/snapshot?feed=iex`;
    const data = await this._fetch(url);

    const day     = data.dailyBar     || {};
    const prev    = data.prevDailyBar || {};
    const latest  = data.latestTrade  || {};

    const price      = latest.p || day.c || 0;
    const prevClose  = prev.c   || price;
    const open       = day.o    || price;
    const change     = price - prevClose;
    const changePct  = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const gapPct     = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
    const todayVol   = day.v    || 0;
    const prevVol    = prev.v   || 1;

    // Fetch asset details for name/class (sector not available on free Alpaca)
    let companyName = ticker;
    let sector      = 'N/A';
    try {
      const base  = process.env.ALPACA_PAPER === 'true'
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets';
      const asset = await this._fetch(`${base}/v2/assets/${ticker}`);
      companyName = asset.name || ticker;
    } catch (_) {}

    return {
      ticker,
      price:        _round(price),
      prevClose:    _round(prevClose),
      change:       _round(change),
      changePct:    _round(changePct),
      open:         _round(open),
      gapPct:       _round(gapPct),
      volume:       todayVol,
      relVolDaily:  _round(prevVol > 0 ? todayVol / prevVol : 1),
      marketCap:    0,    // not available on Alpaca free
      float:        0,    // not available on Alpaca (use Polygon for float data)
      sector,
      companyName,
      ema200:       null,
      newsCount:    0,
    };
  }

  /**
   * Latest news headlines for a ticker.
   */
  async fetchNews(ticker, limit = 10) {
    const url = `${REST_URL}/v1beta1/news?symbols=${ticker}&limit=${limit}&sort=desc`;
    const data = await this._fetch(url);
    return (data.news || []).map(n => ({
      id:          String(n.id),
      title:       n.headline,
      publishedAt: n.created_at,
      source:      n.source || 'Unknown',
      url:         n.url,
    }));
  }

  /**
   * Top movers (gainers) for scanner seeding.
   * Tries Alpaca screener first, falls back to snapshot of a momentum watchlist.
   */
  async fetchGainers() {
    // Strategy 1: Alpaca screener endpoint (requires Unlimited plan)
    try {
      const url  = `${REST_URL}/v1beta1/screener/stocks/movers?by=percent_change&top=20`;
      const data = await this._fetch(url);
      const gainers = data.gainers || data.top_gainers || [];
      if (gainers.length > 0) {
        return gainers.map(g => ({
          symbol:             g.symbol,
          price:              _round(g.price || 0),
          prevClose:          _round((g.price || 0) - (g.change || 0)),
          open:               _round(g.price || 0),
          volume:             g.volume || 0,
          float:              0,
          avgDailyVolume:     g.volume || 500_000,
          gapPct:             _round(g.percent_change || 0),
          changeFromClose:    _round(g.change || 0),
          changeFromClosePct: _round(g.percent_change || 0),
        }));
      }
    } catch (_) {}

    // Strategy 2: Snapshot a curated watchlist of commonly active small caps
    // and rank by percent change. This works on free IEX tier.
    console.log('[alpaca] Screener unavailable — fetching snapshot watchlist');
    return this._fetchWatchlistSnapshot();
  }

  /**
   * Fetches snapshots for a curated list of commonly volatile small caps,
   * filters by price/volume criteria, and sorts by percent change.
   * This is the free-tier fallback for scanner seeding.
   */
  async _fetchWatchlistSnapshot() {
    // A broad watchlist of typically active small/micro cap tickers.
    // In production you'd pull this from a screener; for now this covers many momentum days.
    const watchlist = [
      'AAPL','TSLA','NVDA','AMD','META','AMZN','GOOGL','MSFT','NFLX','SPY',
      'QQQ','SOXL','TQQQ','UVXY','SQQQ','SPXL','FAS','LABU','NAIL','GUSH',
      'RIOT','MARA','COIN','PLTR','SOFI','HOOD','OPEN','AFRM','LCID','RIVN',
      'GME','AMC','BB','BBBY','WISH','CLOV','WKHS','SPCE','SNDL','EXPR',
    ];

    try {
      const symbols = watchlist.join(',');
      const data    = await this._fetch(`${REST_URL}/v2/stocks/snapshots?symbols=${symbols}&feed=iex`);
      const rows    = [];

      for (const [symbol, snap] of Object.entries(data)) {
        const day  = snap.dailyBar     || {};
        const prev = snap.prevDailyBar || {};
        const lt   = snap.latestTrade  || {};

        const price     = lt.p || day.c || 0;
        const prevClose = prev.c || price;
        if (price < 1 || price > 100)  continue;
        if ((day.v || 0) < 200_000)    continue;

        const changeFromClose    = price - prevClose;
        const changeFromClosePct = prevClose > 0 ? (changeFromClose / prevClose) * 100 : 0;
        const gapPct             = prevClose > 0 ? ((day.o || price) - prevClose) / prevClose * 100 : 0;

        rows.push({
          symbol,
          price:              _round(price),
          prevClose:          _round(prevClose),
          open:               _round(day.o || price),
          volume:             day.v || 0,
          float:              0,
          avgDailyVolume:     prev.v || day.v || 500_000,
          gapPct:             _round(gapPct),
          changeFromClose:    _round(changeFromClose),
          changeFromClosePct: _round(changeFromClosePct),
        });
      }

      // Sort by percent change descending, take top 20
      return rows.sort((a, b) => b.changeFromClosePct - a.changeFromClosePct).slice(0, 20);
    } catch (err) {
      console.warn('[alpaca] Watchlist snapshot failed:', err.message);
      return [];
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _open() {
    this.ws    = new WebSocket(WS_URL);
    this.authed = false;

    this.ws.on('open', () => {
      console.log('[alpaca] WebSocket connected — authenticating…');
      this.reconnectMs = 1_000;
      this.ws.send(JSON.stringify({
        action: 'auth',
        key:    this.credentials.keyId,
        secret: this.credentials.secretKey,
      }));
      this._startHeartbeat();
    });

    this.ws.on('message', (raw) => {
      let msgs;
      try { msgs = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(msgs)) msgs = [msgs];

      for (const msg of msgs) {
        if (msg.T === 'success' && msg.msg === 'authenticated') {
          console.log('[alpaca] auth_success — subscribing to', this.pending.trades.size, 'tickers');
          this.authed = true;
          if (this.pending.trades.size > 0) {
            this._sendSubscribe([...this.pending.trades]);
          }
          continue;
        }
        if (msg.T === 'error') {
          console.error(`[alpaca] Error ${msg.code}: ${msg.msg}`);
          continue;
        }
        // Data messages — normalize and route
        const normalized = this._normalize(msg);
        if (normalized) this.handlers.forEach(h => h(normalized));
      }
    });

    this.ws.on('close', () => {
      clearInterval(this.heartbeatTimer);
      this.authed = false;
      if (!this.intentionalClose) {
        console.warn(`[alpaca] Connection closed — reconnecting in ${this.reconnectMs}ms`);
        const delay = this.reconnectMs;
        this.reconnectMs = Math.min(this.reconnectMs * 2, this.maxReconnectMs);
        setTimeout(() => this._open(), delay);
      }
    });

    this.ws.on('error', (err) => console.error('[alpaca] WS error:', err.message));
  }

  _sendSubscribe(tickers) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      action:      'subscribe',
      trades:      tickers,
      bars:        tickers,
      updatedBars: tickers,
    }));
  }

  _startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, 30_000);
  }

  /**
   * Normalize Alpaca WebSocket messages to the standard provider format.
   * Standard format that server.js expects:
   *   { type: 'trade', ticker, price, size, timestamp }
   *   { type: 'bar',   ticker, timeframe: '1m'|'10s', bar: {time,open,high,low,close,volume} }
   */
  _normalize(msg) {
    switch (msg.T) {
      case 't':  // Trade
        return {
          type:      'trade',
          ticker:    msg.S,
          price:     msg.p,
          size:      msg.s,
          timestamp: new Date(msg.t).getTime(),
        };
      case 'b':  // Completed minute bar
        return {
          type:      'bar',
          ticker:    msg.S,
          timeframe: '1m',
          bar: {
            time:   Math.floor(new Date(msg.t).getTime() / 1000),
            open:   msg.o,
            high:   msg.h,
            low:    msg.l,
            close:  msg.c,
            volume: msg.v,
          },
        };
      case 'u':  // Updated (in-progress) bar — treat as 10s signal
        return {
          type:      'bar',
          ticker:    msg.S,
          timeframe: '10s',
          bar: {
            time:   Math.floor(new Date(msg.t).getTime() / 1000),
            open:   msg.o,
            high:   msg.h,
            low:    msg.l,
            close:  msg.c,
            volume: msg.v,
          },
        };
      default:
        return null;
    }
  }

  async _fetch(url) {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID':     this.credentials.keyId,
        'APCA-API-SECRET-KEY': this.credentials.secretKey,
      },
    });
    if (!res.ok) throw new Error(`Alpaca fetch ${url.split('?')[0]} → HTTP ${res.status}`);
    return res.json();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _resolveAlpacaTimeframe(tf) {
  const now  = new Date().toISOString();
  switch (tf) {
    case '10s': return { tf: '1Min', from: _hoursAgo(2),   to: now };
    case '1m':  return { tf: '1Min', from: _hoursAgo(8),   to: now };
    case '5m':  return { tf: '5Min', from: _hoursAgo(24),  to: now };
    case '1D':  return { tf: '1Day', from: _daysAgo(365),  to: now };
    default:    return { tf: '1Min', from: _hoursAgo(8),   to: now };
  }
}

function _hoursAgo(n) {
  return new Date(Date.now() - n * 3_600_000).toISOString();
}
function _daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
function _round(n) {
  return Math.round(n * 100) / 100;
}

export default new AlpacaProvider();
