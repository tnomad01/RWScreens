

Ross Cameron Warrior Trading Momentum System – Real-Time Data Engine Requirements

Purpose

Define the central engine that powers live updates and serves as the single source of truth.

Referenced Documents

•  overall_integration_requirements.md – Defines the global event bus, symbolSelected and liveTick events, and overall data synchronization.

Requirements

•  Maintain global liveData object containing all scanners, current symbol details, and chart data cache.

•  Run a configurable mock engine (setInterval 4–8 seconds) that:

•  Adds realistic new rows to scanners.

•  Updates prices/volumes with small realistic ticks.

•  Emits dataUpdated and liveTick events.

•  Provide clear // TODO: CONNECT REAL FEED HERE hooks to replace the mock with WebSocket/SSE.

•  Expose helper functions: updateScannerData(), simulateWebSocketMessage(), getChartDataForSymbol(ticker, timeframe).

Integration Points

•  Every other panel and chart only reads from liveData and listens to events emitted by this engine.

•  Must support seamless swap from mock → production feed.

Document Version

•  Created: April 15, 2026