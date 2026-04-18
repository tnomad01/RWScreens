scanner_interrelationships_and_filtering_logic.md
(New document)

scanner_interrelationships_and_filtering_logic.md
Ross Cameron Warrior Trading Momentum System – Scanner Interrelationships & Filtering Logic
Purpose
This document diagrams the data flow and filtering relationships between the three left scanners and how they feed into Ross’s 5 Pillars evaluation.
Overall Flow Diagram (Text Representation)

Market Data (real-time trades, quotes, volume)
          ↓
    ┌─────────────────────┐
    │  Top Gainers        │ ← Biggest % movers from previous close
    │  (Change From Close)│    + News flame icons
    └─────────────────────┘
          ↓                  ↘
    ┌─────────────────────┐   \
    │ Small Cap High of   │    \
    │ Day Momentum        │     \
    │ (Timestamped new    │      \
    │  highs + RVOL)      │       \
    └─────────────────────┘        \
               ↓                    \
               └────────────────────┘
                        ↓
    ┌─────────────────────────────────────┐
    │ Low Float Top Gainers               │ ← Intersection + Low-Float Filter
    │ (Big % move OR New High) + Float < threshold
    │ + Retained News Flame Icons         │
    └─────────────────────────────────────┘
                        ↓
    ┌─────────────────────────────────────┐
    │ Ross’s 5 Pillars Scan & Alert       │ ← Final qualification
    │ (Low Float + High RVOL + Catalyst   │
    │  + Momentum + Strong Daily Chart)   │
    └─────────────────────────────────────┘

Detailed Interrelationships

Top Gainers Scanner
Broad net: captures any stock with large % change from previous close.
No float restriction.
Strong visual emphasis on % column and news icons.

Small Cap High of Day Momentum Scanner
Real-time, timestamped feed.
Focuses on small-cap universe making new intraday highs or showing strong short-term relative volume.
Complements Top Gainers by catching intra-bucket momentum that may not yet show as the absolute highest % from close.

Low Float Top Gainers Scanner
Filtering Logic: Combines candidates from both Top Gainers and Small Cap High of Day Momentum.
Applies low-float filter (typically < 20M shares).
Retains news flame icons from source scanners.
Acts as the “refined alert list” before 5 Pillars evaluation.

Feed into Ross’s 5 Pillars
The Low Float Top Gainers list is the primary input for Ross’s 5 Pillars Scan and Alert.
5 Pillars then applies the final score: Low Float + High Relative Volume + Catalyst/News + Momentum/Gap + Strong Daily Chart.
Qualified names appear in the purple “Ross’s 5 Pillars Alert” section.


Key Design Benefits

Layered approach prevents information overload.
Traders can scan broad movers → real-time momentum → low-float high-conviction names → final 5 Pillars qualification.
News flame icons are preserved through the filtering chain so catalyst awareness is never lost.

Document Version

Created: April 18, 2026
