running_up_scanner_requirements.md
Ross Cameron Warrior Trading Momentum System – Running Up (Online) Scanner Requirements
Purpose
The “Running Up (Online)” scanner is a real-time velocity-based momentum alert scanner located in the mid-column. It detects stocks exhibiting rapid upward price acceleration combined with strong short-term volume spikes, giving traders the earliest possible alert on stocks that are “running” right now.
Key Characteristics

Header: “Running Up (Online)”.
Rows are timestamped at the exact second the alert fires.
Supports frequency notes such as “(2 in 3sec)” or “(3 in 5sec)” for repeated signals on the same symbol.
Emphasizes short-term momentum bursts rather than total % from previous close.
Catalyst icons (yellow circle or red flame) are preserved from source scanners.

Exact Columns (left to right – 7 columns)

Time – Exact timestamp (e.g., “09:53:20 am”) + optional frequency note in parentheses (e.g., “(2 in 3sec)”).
Symbol / News – Ticker + catalyst icon (yellow circle or red flame).
Price – Last traded price (green if most recent bar is up, red if down).
Volume – Current bar or cumulative volume.
Float – Float size (low floats often highlighted).
Relative Volume (Daily Rate) – Full-session relative volume (how many times average daily volume is trading).
Relative Volume (5 min %) – Short-term 5-minute relative volume spike (abbreviated “min %” in the UI). This measures how many times the stock’s average 5-minute volume it has traded in the most recent 5 minutes.

Coloring & Highlighting

Strong green background on rows with high Relative Volume (5 min %) or high frequency notes.
Lighter green/yellow on moderate momentum rows.
Hover state shows tooltip with quick 5-Pillars preview.

Low-Level Trigger Criteria (Algorithmic Logic)
A new alert fires when all of the following are true within the last 10–60 seconds:

Price has advanced ≥ 4–8% in the short look-back window.
Relative Volume (Daily Rate) ≥ 2.5× and rising.
Relative Volume (5 min %) ≥ 3.0× (strong short-term volume acceleration).
Algorithmic Watch on Daily vs 5-min Delta: The scanner explicitly monitors the difference / acceleration between the two relative volume metrics. A large positive delta (5-min % significantly higher than Daily Rate) is a core trigger condition — it confirms fresh, explosive buying pressure right now rather than steady all-day volume.
Optional: stock is making a new high of day or breaking short-term resistance.
Repeated triggers within 3–5 seconds increment the frequency note.

Data Structure (per row)
JavaScript{
  timestamp: "09:53:20",
  frequencyNote: "(2 in 3sec)",
  symbol: "FJET",
  price: 6.63,
  volume: 488750,
  float: 29990000,
  relVolDaily: 3.09,
  relVol5minPct: 3.09,
  newsIcon: "yellowCircle" || "flame" || null,
  delta5minVsDaily: 2.02
}
Confirmation on 5-min Timeframe
The 7th column is Relative Volume (5 min %). This is consistent across Warrior Trading scanners.
Integration Solution Definition
1. With Left-Column Scanners

Running Up pulls candidate symbols in real time from both Top Gainers and Small Cap High of Day Momentum.
It applies its own velocity + 5-min relative volume filter on top of those candidates.
News Icon Logic: Icons are inherited from the source scanner row. When a new Running Up row is created, copy the newsIcon value directly from the originating Top Gainers or High of Day row. If the symbol has new news after the initial alert, the icon can be updated via the real-time engine.

2. With Stock Quote Panel

Clicking any row fires global symbolSelected(ticker).
Stock Quote panel immediately populates and displays a small “Running Up Alert” badge if triggered by this scanner.

3. With Ross’s 5 Pillars Scan & Alert

Every new Running Up row is automatically evaluated by the 5 Pillars engine.
The 5-min relative volume value and the daily-vs-5-min delta are used as inputs to the “Momentum” pillar.
Qualified symbols appear in the purple “Ross’s 5 Pillars Alert” section.

4. With the 4 TradingView Charts

On symbolSelected(ticker) from a Running Up row, all four charts instantly switch to the ticker, load their respective timeframe data, and re-apply studies.
Live ticks continue updating all charts via the liveTick event.

5. With Overall Real-Time Engine

Subscribes to the same WebSocket feed as the left scanners.
Maintains its own array inside liveData.scanners.runningUp.
Emits dataUpdated on every new alert.
On every liveTick, re-evaluates the daily-vs-5-min delta and adds/updates rows.
News Icon Update Logic: The real-time engine must also listen for news events. If a news item arrives for a symbol already in Running Up, update the newsIcon field and re-emit dataUpdated so the row refreshes with the new icon.

Notes / TODO Section
News Icon Update Logic

Primary rule: News icons are inherited at row creation time from the originating scanner (Top Gainers or Small Cap High of Day Momentum).
Secondary rule: If new news arrives after the alert is created (via WebSocket news feed or polling), the icon must be updated in real time.
TODO: Implement a news event listener in the real-time engine that can target specific symbols and update newsIcon in all active scanners (including Running Up).
TODO: Define priority for icon types (flame = high priority catalyst, yellow circle = moderate).
TODO: Ensure that when a symbol is selected, the Stock Quote panel’s news headline section reflects the same catalyst that triggered the icon.

Document Version

Updated: April 18, 2026
Status: Complete low-level specification with 7-column layout, daily-vs-5-min algorithmic watch, and explicit news icon handling.
