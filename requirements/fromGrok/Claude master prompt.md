Here is the complete master prompt you can copy and paste directly into Claude (Claude 3.5 Sonnet or Opus recommended). It references all your requirements documents and builds the full connected dashboard with proper event handling and crosshair synchronization for the TradingView charts.

  

PROMPT FOR CLAUDE:

You are an expert full-stack UI/UX developer specializing in high-performance financial trading dashboards. Create a complete, single-file, responsive web application (HTML + Tailwind CSS via CDN + vanilla JavaScript) that implements the Ross Cameron Warrior Trading Momentum Algo Front Desk exactly as specified in the following requirement documents.

Requirement Documents (follow these exactly):

1. overall_integration_requirements.md

- Single source of truth: global liveData object.
- Event-driven synchronization using EventTarget.
- Key events: symbolSelected(ticker), liveTick(ticker, newBar), dataUpdated.
- All panels must react to these events.
- The four TradingView charts are independent instances that load their own timeframe data on symbolSelected.

3. ross_warrior_charting_requirements.md (including the full Event Handling section)

- Four named charts with exact purposes, timeframes, and studies (VWAP orange, 9 EMA gray, 20 EMA green, 200 EMA purple, volume histogram).
- Implement full event handling: symbolSelected, liveTick, and crosshair synchronization from the Intraday Momentum Chart (master) to the other three using subscribeCrosshairMove and setCrosshairPosition.
- Use TradingView Lightweight Charts via CDN.
- Provide clean container divs with IDs: chart-intraday-momentum, chart-scalping-fast, chart-daily-context, chart-micro-scalping.

5. ross_warrior_chart_trading_rules.md

- Include the core principles, per-chart rules, ordering of charts during trade stages, interrelations, and example scenarios (“Looking Good” vs “Getting Stopped”) as comments or a small help panel (optional but visible).

7. scanner_panels_requirements.md

- Three left-column scanners with exact columns and styling.
- Rows must be clickable and emit symbolSelected(ticker).

9. stock_quote_and_pillars_requirements.md

- Center column with dynamic header, news, key stats, Ross’s 5 Pillars Scan, and Pillars Alert.

11. real_time_data_engine_requirements.md

- Mock real-time engine using setInterval (4–8 seconds) that adds rows, updates prices/volumes realistically, and emits events.
- Clear // TODO: CONNECT REAL FEED HERE comments for WebSocket replacement.

Visual & Layout Requirements

- Dark theme (#0a0a0a background, #111111 panels, neon green/red accents).
- 3-column grid: Left = Scanners (stacked), Center = Stock Quote & 5 Pillars, Right = Four Chart panels (2 top, 2 bottom).
- Bottom-left circular ON AIR overlay (placeholder image of trader in orange beanie/green hoodie with “ON AIR” text).
- Bottom-right “SUBSCRIBED” badge with shield logo.
- Exact panel titles, “(Online)” badges, Refresh/Force Refresh buttons, and timestamps matching Warrior Trading style.
- All tables with proper green/red coloring for positive/negative values.

Real-Time & Integration Requirements

- Clicking any scanner row fires symbolSelected(ticker) → updates quote panel + all four charts instantly.
- Each chart loads its own timeframe data and re-applies its studies independently.
- Live ticks update the quote panel and push new bars to the active charts using .update().
- Crosshair sync: Master chart (Intraday Momentum) uses subscribeCrosshairMove; other charts sync via setCrosshairPosition.
- Mock data should include at least 5–10 realistic rows per scanner with symbols like SKYQ, RMSG, etc., but remain generic and extensible.

Implementation Details

- Include TradingView Lightweight Charts via CDN.
- Implement the full event handling and crosshair sync code patterns from the charting requirements.
- Add detailed comments throughout explaining data flow, event listeners, and where to swap the mock engine for a real WebSocket.
- Make the dashboard feel live: scanners update smoothly, charts respond instantly to symbol changes and live ticks.
- Provide a small floating “Help” button that shows the chart ordering and example scenarios from ross_warrior_chart_trading_rules.md.

Output Format

- Deliver the complete single HTML file.
- Title comment block at the top: “Warrior Trading Momentum Algo Front Desk – Full Connected Dashboard with TradingView Charts & Crosshair Sync”.
- Include all necessary scripts and styles via CDN where possible.
- Add clear section comments for each major unit (scanners, quote panel, charts, real-time engine, integration layer).

Generate the full code now.

  

How to use this prompt:

1. Copy the entire block above.
2. Paste it into Claude.
3. Claude will output the complete single HTML file with everything wired together — scanners, quote panel, four TradingView charts, real-time mock updates, symbol selection, live ticks, and crosshair synchronization.

Once you have the generated code, you can:

- Test it locally.
- Extend the mock data.
- Replace the mock engine with your real WebSocket feed.
- Convert pieces to React if desired.

Would you like any small adjustments to the prompt before using it, or a follow-up prompt for adding hotkeys / order execution panel next?