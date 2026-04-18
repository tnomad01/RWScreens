3_left_scanner_panels_requirements.md
Ross Cameron Warrior Trading Momentum System – 3 Left Scanner Panels Requirements
Purpose
Define the three left-column real-time scanners that form the primary discovery engine of the Warrior Trading front desk. These scanners work together in a layered hierarchy to surface high-momentum small-cap setups.
Scanner 1: Top Gainers Scanner
Purpose
Real-time percentage-based gainer scanner that surfaces the biggest movers from the previous close within a rolling short time window (e.g., 09:48:00 – 09:53:00). Primary discovery tool for explosive percentage moves.
Key Characteristics

Time-bucketed header: “Top Gainers: HH:MM:SS - HH:MM:SS (Online)”.
Focus: Change From Close(%) as the primary sort (descending).
Includes news/catalyst flame icons (🔥) next to symbols with hot news or filings.
Does not apply low-float filter (includes both low and higher float names).

Exact Columns (left to right)

Change From Close(%) – bright green background for large positive moves, sorted descending.
Symbol / News – ticker + red flame icon when news is present.
Price
Volume
Float
Relative Volume (Daily Rate)

Coloring & Behavior

% change column has strong green background highlighting.
News flame icons prioritize rows with catalysts.
Updates in real time within the displayed 5-minute window.


Scanner 2: Small Cap – High of Day Momentum Scanner
Purpose
Granular, tick-by-tick scanner focused on small-cap stocks making new intraday highs or showing strong momentum right now. It is the most real-time “in-the-moment” momentum scanner.
Key Characteristics

Header: “Small Cap – High of Day Momentum (Online)”.
Each row is timestamped (e.g., 09:53:19 am) showing the exact moment the momentum signal fired.
Heavily focused on Relative Volume spikes and new highs.

Exact Columns (left to right)

Time – exact timestamp of the momentum update.
Symbol / News – ticker + flame icon for news.
Price
Volume
Float
Relative Volume (Daily Rate)
Rel Vol min % (short-term relative volume spike metric)

Coloring & Behavior

Rows use green/yellow gradients based on momentum strength.
Repeated rows for the same symbol indicate ongoing momentum (e.g., multiple ARTV entries).
Flame icons highlight catalyst-driven moves.

Main Difference from Top Gainers

Top Gainers = biggest % movers from previous close (percentage snapshot).
Small Cap High of Day Momentum = which small-caps are making new highs right now with real-time volume confirmation (timestamped feed).


Scanner 3: Low Float Top Gainers Scanner
Purpose
Highest-conviction filtered scanner that combines the strongest signals from the two scanners above only for low-float stocks, creating a concise alert list with catalyst emphasis.
Key Characteristics

Header example: “Low Float Top Gainers: 09:48:00 – 09:53:00 (Online)”.
Retains news flame icons so traders see catalyst + low-float + big move confluence immediately.

Exact Columns (left to right)

Change From Close(%)
Symbol / News (with flame icon)
Price
Volume
Float (low values are visually emphasized)
Relative Volume (Daily Rate)

Filtering Logic
This scanner does not scan the entire universe independently. Instead:

It pulls candidates from Top Gainers (big % moves) and Small Cap High of Day Momentum (new highs + RVOL spikes).
Applies a low-float filter (typically float < 20M shares or Warrior’s internal threshold).
Keeps the news/catalyst icons from the source scanners.
Produces a refined list that feeds directly into Ross’s 5 Pillars Scan and Ross’s 5 Pillars Alert.

Document Version

Updated: April 18, 2026


