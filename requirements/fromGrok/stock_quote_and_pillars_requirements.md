

Ross Cameron Warrior Trading Momentum System – Stock Quote & 5 Pillars Panel Requirements

Purpose

Define the center-column dynamic detail panel that serves as the evaluation hub.

Referenced Documents

•  overall_integration_requirements.md – Defines the global event bus, symbolSelected and liveTick events, and overall data synchronization.

Required Sections

•  Dynamic header (ticker, price, change, %, market cap, float, sector).

•  Company name + sector line.

•  Scrollable News Headline feed (with timestamps and links).

•  Key stats block (float, rel vol daily/5-min, gap %, etc.).

•  Ross’s 5 Pillars Scan section.

•  Ross’s Pillars Alert section.

Functional Requirements

•  Updates instantly on symbolSelected(ticker).

•  5 Pillars evaluation must run a simple scoring function (stubbed logic OK for now) and display pass/fail or “No qualified trading opportunity found”.

•  Must trigger chart updates via the global event bus.

Integration Points

•  Listens for symbolSelected and liveTick.

•  On update, re-evaluates 5 Pillars and refreshes display.

Document Version

•  Created: April 15, 2026