# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start backend (from /backend)
node server.js          # production
node --watch server.js  # dev with auto-restart (npm run dev)

# Frontend is served as static files by the backend — no build step.
# Open http://localhost:3000 after starting the backend.
```

No linter or test runner is configured. The `.env` file lives at the repo root (one level above `backend/`), not inside `backend/`.

## Architecture

This is a **vanilla JS + Node.js** trading dashboard — no framework, no bundler.

```
warrior-trading/
  .env                      ← credentials (DATA_PROVIDER, ALPACA_*, POLYGON_*, PORT)
  frontend/
    index.html              ← static shell; loads ES modules in order (see script tag)
    styles/custom.css
    js/
      engine.js             ← window.liveData, window.events (EventTarget), WebSocket client
      scanners.js           ← renders/updates the 3 left-column scanner tables
      charts.js             ← TradingView Lightweight Charts (4 charts), crosshair sync
      pillars.js            ← center panel: stock quote + Ross's 5 Pillars scoring
  backend/
    server.js               ← Express + WebSocket server, provider wiring, REST endpoints
    providers/
      alpaca.js             ← Alpaca Markets IEX feed (default)
      polygon.js            ← Polygon.io (alternate, set DATA_PROVIDER=polygon)
    engine/
      scanner.js            ← 3-scanner state machine; seeded from provider, updated on ticks
      vwap.js               ← per-ticker VWAP + ±1/±2 SD bands + 9/20/200 EMA computation
      float.js              ← Finviz scraper for share float (cached per session)
  requirements/fromGrok/    ← spec documents — source of truth for feature behaviour
```

### Data flow

1. Backend connects to Alpaca WebSocket → receives `trade` and `bar` events.
2. `engine/scanner.js` seeds from `provider.fetchGainers()` and updates on each bar tick.
3. Backend broadcasts over a browser WebSocket: `scanner`, `tick`, `quote`, `provider` message types.
4. `js/engine.js` routes messages → updates `window.liveData` → fires `EventTarget` events.
5. `scanners.js`, `charts.js`, `pillars.js` each listen to events and re-render.

### Key events (window.events)

| Event | Fired by | Consumed by |
|---|---|---|
| `symbolSelected` | `engine.js` (selectSymbol) | charts.js, scanners.js (highlight), pillars.js |
| `dataUpdated` | `engine.js` (WS `scanner` msg) | scanners.js |
| `liveTick` | `engine.js` (WS `tick` msg) | charts.js |
| `quoteLoaded` | `engine.js` (after fetch) | pillars.js |
| `newsLoaded` | `engine.js` (after fetch) | pillars.js |
| `quoteUpdated` | `engine.js` (WS `quote` msg) | pillars.js (live price only) |

### Provider interface

Both `alpaca.js` and `polygon.js` implement the same interface used by `server.js`:
`connect`, `disconnect`, `subscribe`, `unsubscribe`, `onMessage`, `fetchRawBars`, `fetchQuote`, `fetchNews`, `fetchGainers`.

Switch providers by setting `DATA_PROVIDER=polygon` in `.env`.

### Scanner engine (backend)

`engine/scanner.js` maintains three arrays in `scanners`:
- `dayTrade` — top gainers sorted by `changeFromClosePct`
- `highMomentum` — timestamped momentum alert feed, prepend-newest, triggered on new intraday highs
- `lowFloat` — same rows as dayTrade but filtered to `float < 20M`

Float data is scraped from Finviz via `engine/float.js` (session-cached, 300 ms between requests). Falls back to mock data if the live seed fails.

### Charts (frontend)

Four independent Lightweight Charts instances (`intradayMomentum`, `scalpingFast`, `dailyContext`, `microScalping`). All load from `/api/bars?ticker=&timeframe=` and use `computeHistory()` from the backend to pre-compute VWAP, SD bands, and EMAs server-side. Live updates arrive via `liveTick` and call `series.update()`.

Crosshair sync: `intradayMomentum` is the master; it calls `setCrosshairPosition()` on the other three.

### REST endpoints

| Endpoint | Description |
|---|---|
| `GET /api/bars?ticker=&timeframe=` | OHLCV + VWAP + EMAs (server-computed) |
| `GET /api/quote?ticker=` | Quote + float enrichment |
| `GET /api/news?ticker=` | News items |
| `GET /api/scanners` | Initial scanner state |
| `GET /api/provider` | Active provider name |

### Requirements documents

The `requirements/fromGrok/` folder is the authoritative spec. Key files:
- `3_left_scanner_panels_requirements.md` — scanner column definitions, coloring, and behaviour (supersedes `scanner_panels_requirements.md`)
- `scanner_interrelationships_and_filtering_logic.md` — data flow between the three scanners and into 5 Pillars
- `running_up_scanner_requirements.md` — 4th scanner ("Running Up") spec with 7-column layout and velocity/delta trigger logic
- `overall_integration_requirements.md` — master integration and event bus spec
- `ross_warrior_charting_requirements.md` — chart timeframes and study configuration
- `stock_quote_and_pillars_requirements.md` — 5 Pillars scoring rules
