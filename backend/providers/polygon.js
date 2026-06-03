// ─────────────────────────────────────────────────────────────────────────────
// backend/providers/polygon.js  ·  v1.0
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Polygon.io data provider (alternate to Alpaca). Paid plans
//           recommended for full real-time access. Implements the same
//           provider interface as alpaca.js — swap with DATA_PROVIDER=polygon.
//
// Config:   POLYGON_API_KEY  in .env
// ─────────────────────────────────────────────────────────────────────────────

import { WebSocket } from 'ws';

const WS_URL   = 'wss://socket.polygon.io/stocks';
const REST_URL = 'https://api.polygon.io';

class PolygonProvider {
  constructor() {
    this.name             = 'polygon';
    this.ws               = null;
    this.authed           = false;
    this.intentionalClose = false;
    this.reconnectMs      = 1_000;
    this.maxReconnectMs   = 30_000;
    this.heartbeatTimer   = null;
    this.credentials      = null;
    this.handlers         = [];
    this.subscriptions    = new Set();   // e.g. 'T.AAPL', 'A.AAPL', 'AM.AAPL'
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  connect(credentials) {
    this.credentials      = credentials;
    this.intentionalClose = false;
    this._open();
  }

  disconnect() {
    this.intentionalClose = true;
    clearInterval(this.heartbeatTimer);
    if (this.ws) this.ws.close();
  }

  subscribe(tickers) {
    const params = tickers.flatMap(t => [`T.${t}`, `A.${t}`, `AM.${t}`]);
    params.forEach(p => this.subscriptions.add(p));
    if (this.authed && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'subscribe', params: params.join(',') }));
    }
  }

  unsubscribe(tickers) {
    const params = tickers.flatMap(t => [`T.${t}`, `A.${t}`, `AM.${t}`]);
    params.forEach(p => this.subscriptions.delete(p));
    if (this.authed && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'unsubscribe', params: params.join(',') }));
    }
  }

  onMessage(handler) {
    this.handlers.push(handler);
  }

  // ── REST ──────────────────────────────────────────────────────────────────

  async fetchRawBars(ticker, timeframe) {
    const { multiplier, timespan, from, to } = _resolvePolygonTimeframe(timeframe);
    const url = `${REST_URL}/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=1000&apiKey=${this.credentials.apiKey}`;
    const data = await this._fetch(url);
    const bars = (data.results || []).map(r => ({
      time:   Math.floor(r.t / 1000),
      open:   r.o,
      high:   r.h,
      low:    r.l,
      close:  r.c,
      volume: r.v,
    }));
    return { bars, dataSource: 'polygon' };
  }

  async fetchQuote(ticker) {
    const [snap, details] = await Promise.all([
      this._fetch(`${REST_URL}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${this.credentials.apiKey}`),
      this._fetch(`${REST_URL}/v3/reference/tickers/${ticker}?apiKey=${this.credentials.apiKey}`),
    ]);

    const t        = snap.ticker || {};
    const day      = t.day       || {};
    const prevDay  = t.prevDay   || {};
    const r        = details.results || {};

    const price     = day.c || t.lastQuote?.P || 0;
    const prevClose = prevDay.c || price;
    const open      = day.o || price;
    const change    = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const gapPct    = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
    const todayVol  = day.v || 0;
    const prevVol   = prevDay.v || 1;

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
      marketCap:    r.market_cap || 0,
      float:        r.share_class_shares_outstanding || 0,
      sector:       r.sic_description || 'N/A',
      companyName:  r.name || ticker,
      ema200:       null,
      newsCount:    0,
    };
  }

  async fetchNews(ticker, limit = 10) {
    const url = `${REST_URL}/v2/reference/news?ticker=${ticker}&limit=${limit}&order=desc&apiKey=${this.credentials.apiKey}`;
    const data = await this._fetch(url);
    return (data.results || []).map(n => ({
      id:          n.id,
      title:       n.title,
      publishedAt: n.published_utc,
      source:      n.publisher?.name || 'Unknown',
      url:         n.article_url,
    }));
  }

  async fetchGainers() {
    const data = await this._fetch(
      `${REST_URL}/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${this.credentials.apiKey}`
    );
    return (data.tickers || []).map(t => {
      const day  = t.day     || {};
      const prev = t.prevDay || {};
      const price = day.c || t.lastQuote?.P || 0;
      const prevClose = prev.c || price;
      const open = day.o || price;
      return {
        symbol:            t.ticker,
        price:             _round(price),
        prevClose:         _round(prevClose),
        open:              _round(open),
        volume:            day.v || 0,
        float:             0,  // fetched separately in scanner.js if needed
        avgDailyVolume:    prev.v || 500_000,
        gapPct:            prevClose > 0 ? _round(((open - prevClose) / prevClose) * 100) : 0,
        changeFromClose:   _round(price - prevClose),
        changeFromClosePct: prevClose > 0 ? _round(((price - prevClose) / prevClose) * 100) : 0,
      };
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _open() {
    this.ws    = new WebSocket(WS_URL);
    this.authed = false;

    this.ws.on('open', () => {
      console.log('[polygon] WebSocket connected — authenticating…');
      this.reconnectMs = 1_000;
      this.ws.send(JSON.stringify({ action: 'auth', params: this.credentials.apiKey }));
      this._startHeartbeat();
    });

    this.ws.on('message', (raw) => {
      let msgs;
      try { msgs = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(msgs)) msgs = [msgs];

      for (const msg of msgs) {
        if (msg.status === 'auth_success') {
          console.log('[polygon] auth_success — subscribing to', this.subscriptions.size, 'channels');
          this.authed = true;
          if (this.subscriptions.size > 0) {
            this.ws.send(JSON.stringify({ action: 'subscribe', params: [...this.subscriptions].join(',') }));
          }
          continue;
        }
        if (msg.status === 'auth_failed') {
          console.error('[polygon] Auth failed — check POLYGON_API_KEY (requires paid plan for WebSocket)');
          continue;
        }
        const normalized = this._normalize(msg);
        if (normalized) this.handlers.forEach(h => h(normalized));
      }
    });

    this.ws.on('close', () => {
      clearInterval(this.heartbeatTimer);
      this.authed = false;
      if (!this.intentionalClose) {
        console.warn(`[polygon] Connection closed — reconnecting in ${this.reconnectMs}ms`);
        const delay = this.reconnectMs;
        this.reconnectMs = Math.min(this.reconnectMs * 2, this.maxReconnectMs);
        setTimeout(() => this._open(), delay);
      }
    });

    this.ws.on('error', (err) => console.error('[polygon] WS error:', err.message));
  }

  _startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, 30_000);
  }

  /**
   * Normalize Polygon WebSocket messages to the standard provider format.
   */
  _normalize(msg) {
    switch (msg.ev) {
      case 'T':  // Trade
        return { type: 'trade', ticker: msg.sym, price: msg.p, size: msg.s, timestamp: msg.t };
      case 'A':  // Second aggregate → 10s chart
        return {
          type: 'bar', ticker: msg.sym, timeframe: '10s',
          bar: { time: Math.floor(msg.s / 1000), open: msg.o, high: msg.h, low: msg.l, close: msg.c, volume: msg.av || msg.v || 0 },
        };
      case 'AM': // Minute aggregate → 1m chart
        return {
          type: 'bar', ticker: msg.sym, timeframe: '1m',
          bar: { time: Math.floor(msg.s / 1000), open: msg.o, high: msg.h, low: msg.l, close: msg.c, volume: msg.av || msg.v || 0 },
        };
      default:
        return null;
    }
  }

  async _fetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Polygon fetch ${url.split('?')[0]} → HTTP ${res.status}`);
    return res.json();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _resolvePolygonTimeframe(tf) {
  const to = new Date().toISOString().slice(0, 10);
  switch (tf) {
    case '10s': return { multiplier: 10, timespan: 'second', from: _daysAgo(0), to };
    case '1m':  return { multiplier: 1,  timespan: 'minute', from: _daysAgo(0), to };
    case '5m':  return { multiplier: 5,  timespan: 'minute', from: _daysAgo(1), to };
    case '1D':  return { multiplier: 1,  timespan: 'day',    from: _daysAgo(365), to };
    default:    return { multiplier: 1,  timespan: 'minute', from: _daysAgo(0), to };
  }
}

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function _round(n) {
  return Math.round(n * 100) / 100;
}

export default new PolygonProvider();
