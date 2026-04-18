**Purpose** 

Define the three left-column real-time scanners that discover momentum setups.

**Referenced Documents**

•  overall_integration_requirements.md – Defines the global event bus, symbolSelected and liveTick events, and overall data synchronization.

Required Scanners (exact match to Warrior screenshots)

1.  Day Trade Dash (top)

2.  Small Cap – High of Day Momentum (Online) (middle)

3.  Low Float Top Gainers [Time Range] (Online) (bottom)

Functional Requirements

•  Each scanner is a separate, self-contained table component.

•  Columns, colors (green/red), hover states, and headers must match screenshots exactly.

•  Rows are clickable → emit symbolSelected(ticker).

•  Real-time updates: new rows appear, existing rows tick prices/volumes smoothly.

•  “(Online)” badge and timestamp in header.

•  Data source: liveData.scanners.dayTrade, liveData.scanners.highMomentum, liveData.scanners.lowFloat.

Data Structure (example for each row)

`{`
  `time: "09:32 am",`
  `symbol: "SKYQ",`
  `price: 19.31,`
  `volume: 6370000,`
  `float: 3510000,`
  `relVolDaily: 4.67,`
  `relVol5min: 71.46,`
  `gapPct: 41.46,`
  `changeFromClose: 2.14,`
  `// ... other fields as needed per scanner`
`}`

Integration Points

•  Listen for dataUpdated to re-render only changed rows.

•  On row click → call global emit('symbolSelected', {ticker}).

Document Version

•  Created: April 15, 2026