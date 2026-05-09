// js/charts.js
// TradingView Lightweight Charts — chart registry, series factory,
// symbolSelected handler, liveTick handler, and crosshair synchronization.
// Depends on: window.liveData, window.events (from engine.js)

import { fetchBars } from './engine.js';

// ── Chart configuration ───────────────────────────────────────────────────────

const CHART_CONFIG = {
  intradayMomentum: { containerId: 'chart-intraday-momentum', defaultTf: '1m',  label: 'Intraday Momentum' },
  scalpingFast:     { containerId: 'chart-scalping-fast',     defaultTf: '10s', label: 'Scalping Fast'     },
  dailyContext:     { containerId: 'chart-daily-context',     defaultTf: '1D',  label: 'Daily Context'     },
  microScalping:    { containerId: 'chart-micro-scalping',    defaultTf: '10s', label: 'Micro Scalping'    },
};

// Active timeframe per chart (may change via tab clicks)
const activeTimeframes = {
  intradayMomentum: '1m',
  scalpingFast:     '10s',
  dailyContext:     '1D',
  microScalping:    '10s',
};

// Registries — populated by createWarriorChart()
const chartRegistry  = {};   // { name: LightweightChart }
const seriesRegistry = {};   // { name: { candle, volume, vwap, vwapPlus1, ... } }

// ── Chart factory ─────────────────────────────────────────────────────────────

function createWarriorChart(name, cfg) {
  const container = document.getElementById(cfg.containerId);
  if (!container) { console.error(`[charts] container #${cfg.containerId} not found`); return; }

  const isDailyDefault = cfg.defaultTf === '1D';

  const chart = LightweightCharts.createChart(container, {
    layout:    { background: { color: '#111111' }, textColor: '#cccccc', fontSize: 11 },
    grid:      { vertLines: { color: '#1e1e1e' }, horzLines: { color: '#1e1e1e' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Magnet },
    timeScale: {
      timeVisible:    true,
      secondsVisible: cfg.defaultTf === '10s',
      borderColor:    '#333333',
      rightOffset:    5,
    },
    rightPriceScale: { borderColor: '#333333', scaleMargins: { top: 0.1, bottom: 0.25 } },
    handleScroll: true,
    handleScale:  true,
  });

  // Candle series
  const candleSeries = chart.addCandlestickSeries({
    upColor:          '#00ff9d',
    downColor:        '#ff0033',
    borderUpColor:    '#00ff9d',
    borderDownColor:  '#ff0033',
    wickUpColor:      '#00ff9d',
    wickDownColor:    '#ff0033',
  });

  // Volume histogram (lower 20% of panel)
  const volumeSeries = chart.addHistogramSeries({
    priceFormat:  { type: 'volume' },
    priceScaleId: 'volume',
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  // VWAP — orange (hidden on daily chart)
  const vwapSeries = chart.addLineSeries({
    color:     '#ffaa00',
    lineWidth: 2,
    visible:   !isDailyDefault,
    title:     'VWAP',
    priceLineVisible: false,
    lastValueVisible: false,
  });

  // VWAP ±1 SD bands — faint dashed
  const vwapPlus1  = chart.addLineSeries({ color: '#ffaa0077', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, visible: !isDailyDefault, priceLineVisible: false, lastValueVisible: false });
  const vwapMinus1 = chart.addLineSeries({ color: '#ffaa0077', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, visible: !isDailyDefault, priceLineVisible: false, lastValueVisible: false });

  // VWAP ±2 SD bands — very faint
  const vwapPlus2  = chart.addLineSeries({ color: '#ffaa0033', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, visible: !isDailyDefault, priceLineVisible: false, lastValueVisible: false });
  const vwapMinus2 = chart.addLineSeries({ color: '#ffaa0033', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, visible: !isDailyDefault, priceLineVisible: false, lastValueVisible: false });

  // EMAs
  const ema9Series   = chart.addLineSeries({ color: '#888888', lineWidth: 1, title: '9 EMA',   priceLineVisible: false, lastValueVisible: false });
  const ema20Series  = chart.addLineSeries({ color: '#00ff9d', lineWidth: 1, title: '20 EMA',  priceLineVisible: false, lastValueVisible: false });
  const ema200Series = chart.addLineSeries({ color: '#cc00ff', lineWidth: 2, title: '200 EMA', priceLineVisible: false, lastValueVisible: false });

  chartRegistry[name]  = chart;
  seriesRegistry[name] = {
    candle:     candleSeries,
    volume:     volumeSeries,
    vwap:       vwapSeries,
    vwapPlus1,  vwapMinus1,
    vwapPlus2,  vwapMinus2,
    ema9:       ema9Series,
    ema20:      ema20Series,
    ema200:     ema200Series,
  };

  // Sync chart dimensions to container whenever CSS flex reflows the height
  new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) chart.applyOptions({ width, height });
  }).observe(container);

  return chart;
}

// ── Load data into a chart ────────────────────────────────────────────────────

async function loadChart(name, ticker, timeframe) {
  const s = seriesRegistry[name];
  if (!s) return;

  try {
    const data = await fetchBars(ticker, timeframe);

    s.candle.setData(data.candles     || []);
    s.volume.setData(data.volume      || []);
    s.vwap.setData(data.vwap          || []);
    s.vwapPlus1.setData(data.vwapPlus1   || []);
    s.vwapMinus1.setData(data.vwapMinus1 || []);
    s.vwapPlus2.setData(data.vwapPlus2   || []);
    s.vwapMinus2.setData(data.vwapMinus2 || []);
    s.ema9.setData(data.ema9    || []);
    s.ema20.setData(data.ema20  || []);
    s.ema200.setData(data.ema200 || []);

    // Show/hide VWAP series based on timeframe
    const showVwap = timeframe !== '1D';
    [s.vwap, s.vwapPlus1, s.vwapMinus1, s.vwapPlus2, s.vwapMinus2].forEach(
      series => series.applyOptions({ visible: showVwap })
    );

    chartRegistry[name].timeScale().fitContent();

    // Show 15MIN DLY badge when data comes from Yahoo Finance
    const badge = document.querySelector(`.delay-badge[data-chart="${name}"]`);
    if (badge) badge.classList.toggle('active', data.dataSource === 'yahoo');
  } catch (err) {
    console.error(`[charts] loadChart(${name}, ${ticker}, ${timeframe}):`, err.message);
  }
}

// ── symbolSelected handler ────────────────────────────────────────────────────

window.events.addEventListener('symbolSelected', async (e) => {
  const { ticker } = e.detail;

  // Load all four charts in parallel, each with its own timeframe
  await Promise.all(
    Object.entries(CHART_CONFIG).map(([name]) =>
      loadChart(name, ticker, activeTimeframes[name])
    )
  );
});

// ── liveTick handler ──────────────────────────────────────────────────────────

window.events.addEventListener('liveTick', (e) => {
  const { timeframe, bar } = e.detail;

  for (const [name] of Object.entries(CHART_CONFIG)) {
    if (activeTimeframes[name] !== timeframe) continue;

    const s = seriesRegistry[name];
    if (!s) continue;

    s.candle.update(bar.candle);
    s.volume.update(bar.volume);
    s.vwap.update(bar.vwap);
    s.vwapPlus1.update(bar.vwapPlus1);
    s.vwapMinus1.update(bar.vwapMinus1);
    s.vwapPlus2.update(bar.vwapPlus2);
    s.vwapMinus2.update(bar.vwapMinus2);
    if (bar.ema9)   s.ema9.update(bar.ema9);
    if (bar.ema20)  s.ema20.update(bar.ema20);
    if (bar.ema200) s.ema200.update(bar.ema200);
  }
});

// ── Crosshair synchronization ─────────────────────────────────────────────────
// Master: intradayMomentum → broadcasts to the other three

let lastCrosshairTime = null;
let isSyncing = false;  // prevents feedback loops

export function enableCrosshairSync() {
  const master = chartRegistry.intradayMomentum;
  if (!master) return;

  master.subscribeCrosshairMove((param) => {
    if (isSyncing || !param.time) return;
    if (param.time === lastCrosshairTime) return;
    lastCrosshairTime = param.time;

    const price = param.seriesPrices?.get(seriesRegistry.intradayMomentum?.candle) ?? null;
    if (price === null) return;

    isSyncing = true;
    for (const name of ['scalpingFast', 'dailyContext', 'microScalping']) {
      const c = chartRegistry[name];
      if (c) {
        try { c.setCrosshairPosition(price, param.time); } catch (_) {}
      }
    }
    isSyncing = false;
  });
}

// ── Timeframe tab switching ───────────────────────────────────────────────────

export function switchTimeframe(chartName, timeframe) {
  activeTimeframes[chartName] = timeframe;

  // Update seconds visibility on time scale
  chartRegistry[chartName]?.applyOptions({
    timeScale: { secondsVisible: timeframe === '10s' },
  });

  const ticker = window.liveData.currentSymbol;
  if (ticker) {
    // Invalidate cache for this specific timeframe so we re-fetch fresh data
    if (window.liveData.chartDataCache[ticker]) {
      delete window.liveData.chartDataCache[ticker][timeframe];
    }
    loadChart(chartName, ticker, timeframe);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initializeAllCharts() {
  for (const [name, cfg] of Object.entries(CHART_CONFIG)) {
    createWarriorChart(name, cfg);
  }
  enableCrosshairSync();
  console.log('[charts] All four charts initialized');
}

// ── Expose for timeframe tabs in HTML ────────────────────────────────────────
window.switchTimeframe = switchTimeframe;
