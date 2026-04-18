**Purpose** 
<< need to add>> 


Ross Cameron Warrior Trading Momentum System – Chart Trading Rules & Workflow

**Referenced Documents**

•  overall_integration_requirements.md – Defines the global event bus, symbolSelected event, real-time data flow, and how all panels synchronize.

**Integration with Overall System**

•  Each of the four charts must listen for the global symbolSelected(ticker) event.

•  On receipt, the chart clears existing series, loads the new ticker’s data for its specific timeframe/resolution, and re-creates its studies (VWAP, 9/20/200 EMAs, volume histogram, optional SD bands).

•  Charts also listen for liveTick events to update the current candle/series in real time.

•  No shared state between charts — each maintains its own series objects and settings.

•  Full details of synchronization and event flow are in overall_integration_requirements.md.

Core Principles (apply to all charts)

- Trade only in the direction of the trend: price above 9/20/200 EMAs = bullish bias.
- VWAP is dynamic support/resistance on intraday charts.
- Favor pullbacks to key levels (9 EMA, 20 EMA, VWAP, or +1 SD band) for entries.
- Look for price action: micro pullbacks, bull flags, first-candle new highs, volume spikes.
- Risk: tight stops below VWAP or recent low; target 2:1+ or 10%+ moves on low-priced stocks.
- Use the 5 Pillars (low float, high relative volume, catalyst, momentum/gap, strong daily chart) as overall filter.

Rules for Each Chart

Chart 1: Intraday Momentum Chart (Top-Left – 1m or 5m)

- Primary decision chart for the trade.
- Bullish bias when price holds above VWAP + 9/20 EMAs.
- Entry signals: pullback to VWAP / +1 SD band or 9/20 EMA confluence, then reclaim with volume.
- Continuation: price walking up the 9 EMA or breaking to new highs.
- Warning: price losing VWAP or 9 EMA = potential exit or stop.

Chart 2: Scalping Fast Chart (Top-Right – 10s or 1m)

- Precision timing chart for exact entry and exit.
- Entry: first candle making new high after micro pullback to 9 EMA or VWAP.
- Exit/trailing: loss of 9 EMA or VWAP on this fast timeframe.
- Confirmation: aggressive scalp long on VWAP or +1 SD reclaim with volume spike.

Chart 3: Daily Context Chart (Bottom-Left – 1D or 5m)

- Trend filter and stock-selection chart.
- Only take longs if price is above 200 EMA (ideal) and ideally above 9/20 EMAs.
- 200 EMA acts as major support or resistance; stocks far below it are higher risk.
- Use to confirm the overall daily structure supports the momentum setup.

Chart 4: Micro Scalping Chart (Bottom-Right – 10s)

- Final execution and micro-level confirmation chart.
- Micro entry: final pullback to 9 EMA / VWAP before candle break.
- Micro exit: immediate loss of 9 EMA or failure to hold VWAP.
- Fast reads: price walking the 9 EMA or breaking highs with volume = continuation.

Section: Ordering of Charts – Which Chart to Watch at Each Stage of the Trade

Pre-Entry (Scanning / Setup Phase)

1. Start with Chart 3 (Daily Context) → confirm bullish daily structure (price above 200 EMA).
2. Move to Chart 1 (Intraday Momentum) → confirm price above VWAP and 9/20 EMAs + catalyst alignment.
3. Only then check Chart 2 (Scalping Fast) for tightening setup.

Entry Phase

1. Primary decision: Chart 1 (Intraday Momentum) – look for pullback to key level (VWAP / 9 EMA) then reclaim.
2. Timing trigger: switch to Chart 2 (Scalping Fast) and Chart 4 (Micro Scalping) for the exact candle (first new high or micro pullback break).
3. Final confirmation: all three faster charts aligned with volume spike on Chart 4.

During the Trade (Management / Monitoring)

- Monitor Chart 1 for overall trend health (price staying above VWAP / 9 EMA).
- Use Chart 2 and Chart 4 for real-time price action and early warning of weakness.
- Check Chart 3 only if the move is extended (to confirm daily room to run).

Exit Phase

- Primary: Chart 2 (Scalping Fast) or Chart 4 (Micro Scalping) – loss of 9 EMA or VWAP = immediate exit or trail.
- Scale out targets: watch Chart 1 for extension to +2 SD bands or resistance.
- Full exit if Chart 3 daily structure starts breaking (price losing 200 EMA).

Section: How the Charts Interrelate

The four charts form a hierarchy:

- Chart 3 (Daily) sets the macro bias (higher-timeframe filter).
- Chart 1 (Intraday Momentum) provides the main trade thesis and structure.
- Chart 2 & 4 (Fast & Micro) supply precision timing and confirmation.

They must align top-down: a strong daily chart + clean intraday setup + fast/micro confirmation = high-probability trade.  
Disagreement between timeframes (e.g., intraday above VWAP but daily below 200 EMA) = avoid or reduce size.  
VWAP and 9 EMA act as “glue” across all intraday charts — price respecting them on faster charts while holding on slower charts = strongest setups.

Example Scenarios

Scenario A – “Looking Good” (Textbook Long Entry)

- Chart 3: Price well above 200 EMA, strong daily uptrend.
- Chart 1: Stock pulls back exactly to VWAP + 9/20 EMA confluence, then reclaims with volume (bull flag).
- Chart 2 & 4: Micro pullback to 9 EMA followed by first-candle new high on high volume.
- Result: Clean entry, price walks up the 9 EMA, extends toward +2 SD band → easy 10%+ move with trailing stops.

Scenario B – “Getting Stopped” (Failed Trade)

- Chart 3: Daily chart is choppy or price near 200 EMA resistance.
- Chart 1: Early entry on VWAP reclaim but price immediately loses VWAP.
- Chart 2 & 4: Fast charts show loss of 9 EMA with red volume spike and no new highs.
- Result: Quick stop below VWAP or recent low. Lesson: daily context was weak and fast charts never confirmed the move.

Scenario C – Mid-Trade Warning

- Chart 1: Price still above VWAP but starts hugging the 9 EMA.
- Chart 2 & 4: Multiple failures to make new highs + volume drying up.
- Action: Tighten stop or exit on first loss of 9 EMA on fast charts, even if Chart 1 still looks okay.

Document Version

- Created: April 15, 2026
- Purpose: Detailed trading rules, workflow, interrelations, and example scenarios for the four Warrior Trading charts.

  

You now have two clean, separate documents exactly as requested.  
Let me know if you want any tweaks or the full Claude prompt that references both files!