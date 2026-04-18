



(This is the master document that ties everything together)

Ross Cameron Warrior Trading Momentum System – Overall Integration & Data Flow Requirements



Purpose

Define how all major functional units (scanners, quote panel, charting area, real-time engine, 5 Pillars) connect into one cohesive, real-time dashboard.

Referenced Documents

•  ross_warrior_charting_requirements.md – Defines the four named charts, their timeframes, studies, and TradingView implementation details.

•  ross_warrior_chart_trading_rules.md – Details how trading rules map to each chart.

•  3_left_scanner_panels_requirements.md – (supersedes scanner_panels_requirements.md)

•  stock_quote_and_pillars_requirements.md

•  real_time_data_engine_requirements.md

Chart Integration Summary 

> The four `TradingView` charts (Intraday Momentum, Scalping Fast, Daily Context, Micro Scalping) are independent Lightweight Charts instances. On symbolSelected(ticker) they each load their own timeframe data and re-apply their specific studies (VWAP + EMAs + volume). See ross_warrior_charting_requirements.md for exact per-chart configuration.

Core Architecture Principles

•  Single source of truth: one global liveData JavaScript object.

•  Event-driven synchronization using a lightweight Pub/Sub (EventTarget or custom EventEmitter).

•  All panels are data-driven and reactive — they listen for events and re-render only what changed.

•  Real-time mock engine can be swapped for a production WebSocket/SSE feed with zero changes to UI panels.

Key Integration Events (must be implemented)

•  symbolSelected(ticker) — fired when user clicks any scanner row or changes ticker in quote panel.

•  dataUpdated — fired whenever scanners or live ticks change.

•  liveTick(ticker, priceData) — fired on every price/volume update.

How the Four TradingView Charts Work (Answering Your Specific Question)

Yes — it is fully possible and straightforward.

Each of the four charts is an independent TradingView Lightweight Charts instance created with LightweightCharts.createChart(container).

When symbolSelected(ticker) fires:

1.  Every chart receives the event.

2.  Each chart independently:

•  Clears its existing series (or replaces data).

•  Loads the new ticker's OHLCV data for its specific timeframe/resolution (from liveData.chartDataCache or an on-demand fetch).

•  Re-applies its own studies (VWAP, 9/20/200 EMAs, volume histogram, optional SD bands) using its own series objects.

3.  No conflict — the charts do not share series or state. They run in parallel.

This is a standard pattern with Lightweight Charts and performs excellently even with four charts updating simultaneously. Real-time updates continue via .update() on each series after the initial load.

Data Flow Summary

1.  Real-time engine updates liveData.scanners and liveData.currentSymbol.

2.  Scanners re-render rows → user clicks row → symbolSelected(ticker) fires.

3.  Quote panel updates instantly.

4.  All four charts update independently (different timeframes + studies).

5.  Live ticks continue flowing to the currently selected symbol across all panels and charts.

Cross-Panel Synchronization Requirements

•  Clicking any scanner row must update: quote panel + all four charts + 5 Pillars evaluation.

•  Live price/volume ticks must update the quote panel header and push new candles to the active charts.

•  5 Pillars Scan must re-evaluate on every symbol change or significant tick.

•  All panels must remain responsive and performant on a 1440p+ trading monitor.

Document Version

•  Created: April 15, 2026
•  Updated: April 18, 2026 – updated scanner reference to 3_left_scanner_panels_requirements.md
