// js/pillars.js
// Stock Quote & 5 Pillars center panel.
// Renders dynamic header, news feed, key stats, and 5 Pillars scoring.
// Depends on: window.liveData, window.events (from engine.js)

// ── 5 Pillars scoring ─────────────────────────────────────────────────────────

function evaluatePillars(quote, ema200) {
  return {
    lowFloat:    { pass: (quote.float > 0 && quote.float < 10_000_000), label: 'Low Float',          note: '< 10M shares' },
    highRelVol:  { pass: quote.relVolDaily > 5,                          label: 'High Relative Vol',  note: '> 5× daily avg' },
    catalyst:    { pass: (window.liveData.news?.length > 0),             label: 'Catalyst / News',    note: 'News today'     },
    momentum:    { pass: quote.gapPct > 10,                              label: 'Momentum Gap',       note: '> 10% gap'      },
    strongDaily: { pass: ema200 !== null && quote.price > ema200,        label: 'Strong Daily Chart', note: 'Price > 200 EMA'},
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderQuotePanel(quote, news) {
  const panel = document.getElementById('panel-quote');
  if (!panel) return;

  const change    = quote.change ?? 0;
  const changePct = quote.changePct ?? 0;
  const isUp      = change >= 0;
  const chgColor  = isUp ? '#00ff9d' : '#ff0033';
  const chgSign   = isUp ? '+' : '';

  // We'll get ema200 from the dailyContext chart data cache if available
  const chartCache = window.liveData.chartDataCache[quote.ticker]?.['1D'];
  const ema200Arr  = chartCache?.ema200 || [];
  const ema200Val  = ema200Arr.length > 0 ? ema200Arr[ema200Arr.length - 1].value : null;

  const pillars = evaluatePillars(quote, ema200Val);
  const score   = Object.values(pillars).filter(p => p.pass).length;

  panel.innerHTML = `
    <!-- Dynamic header -->
    <div class="quote-header">
      <div class="quote-ticker">${quote.ticker || '—'}</div>
      <div class="quote-price" style="color:${chgColor}">
        $${fmtPrice(quote.price)}
        <span class="quote-change">${chgSign}${fmtPrice(change)} (${chgSign}${(changePct).toFixed(2)}%)</span>
      </div>
      <div class="quote-meta">
        <span>${quote.companyName || ''}</span>
        <span class="dot">·</span>
        <span>${quote.sector || 'N/A'}</span>
        <span class="dot">·</span>
        <span>Mkt Cap: ${fmtCap(quote.marketCap)}</span>
        <span class="dot">·</span>
        <span>Float: ${fmtFloat(quote.float)}</span>
      </div>
    </div>

    <!-- Key Stats -->
    <div class="key-stats">
      <div class="stat-grid">
        ${stat('Open',      '$' + fmtPrice(quote.open))}
        ${stat('Prev Close','$' + fmtPrice(quote.prevClose))}
        ${stat('Gap %',     fmtPct(quote.gapPct), quote.gapPct > 0)}
        ${stat('Volume',    fmtVol(quote.volume))}
        ${stat('RVol (D)',  fmtX(quote.relVolDaily), quote.relVolDaily > 3)}
        ${stat('Float',     fmtFloat(quote.float))}
      </div>
    </div>

    <!-- 5 Pillars -->
    <div class="pillars-section">
      <div class="pillars-title">Ross's 5 Pillars Scan</div>
      <div class="pillars-list">
        ${Object.values(pillars).map(p => `
          <div class="pillar-row ${p.pass ? 'pass' : 'fail'}">
            <span class="pillar-icon">${p.pass ? '✓' : '✗'}</span>
            <span class="pillar-label">${p.label}</span>
            <span class="pillar-note">${p.note}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- Pillars Alert -->
    <div class="pillars-alert ${score === 5 ? 'alert-green' : score >= 3 ? 'alert-yellow' : 'alert-gray'}">
      ${score === 5
        ? '&#9899; QUALIFIED — All 5 Pillars Pass'
        : score >= 3
          ? `&#9899; WATCH — ${score}/5 Pillars (Partial Setup)`
          : 'No qualified trading opportunity found'}
    </div>

    <!-- News Feed -->
    <div class="news-section">
      <div class="news-title">News</div>
      <ul class="news-list">
        ${(news || []).length === 0
          ? '<li class="news-empty">No recent news</li>'
          : (news || []).map(n => `
            <li class="news-item">
              <span class="news-time">${fmtNewsTime(n.publishedAt)}</span>
              <a class="news-link" href="${n.url}" target="_blank" rel="noopener">${escHtml(n.title)}</a>
              <span class="news-source">${escHtml(n.source)}</span>
            </li>`).join('')}
      </ul>
    </div>`;
}

// ── Live price update (without full re-render) ────────────────────────────────

function updateLivePrice(ticker, price) {
  const el = document.querySelector('.quote-price');
  if (!el) return;
  const prev   = window.liveData.quote?.prevClose ?? price;
  const change = price - prev;
  const pct    = prev > 0 ? (change / prev) * 100 : 0;
  const isUp   = change >= 0;
  const color  = isUp ? '#00ff9d' : '#ff0033';
  const sign   = isUp ? '+' : '';
  el.style.color = color;
  el.innerHTML   = `$${fmtPrice(price)} <span class="quote-change">${sign}${fmtPrice(change)} (${sign}${pct.toFixed(2)}%)</span>`;
  if (window.liveData.quote) window.liveData.quote.price = price;
}

// ── Events ────────────────────────────────────────────────────────────────────

window.events.addEventListener('symbolSelected', () => {
  // Show loading state immediately
  const panel = document.getElementById('panel-quote');
  if (panel) panel.innerHTML = '<div class="loading">Loading…</div>';
});

window.events.addEventListener('quoteLoaded', (e) => {
  const { quote } = e.detail;
  renderQuotePanel(quote, window.liveData.news || []);
});

window.events.addEventListener('newsLoaded', (e) => {
  const { news } = e.detail;
  // Re-render with news (quote already loaded)
  renderQuotePanel(window.liveData.quote || {}, news);
});

window.events.addEventListener('quoteUpdated', (e) => {
  updateLivePrice(e.detail.ticker, e.detail.price);
});

// ── Init ──────────────────────────────────────────────────────────────────────

export function initPillars() {
  const panel = document.getElementById('panel-quote');
  if (panel) {
    panel.innerHTML = `
      <div class="quote-empty">
        <div class="quote-empty-icon">📈</div>
        <div>Click any scanner row to load a stock</div>
      </div>`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stat(label, value, highlight = false) {
  return `<div class="stat-item ${highlight ? 'stat-highlight' : ''}">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
  </div>`;
}

function fmtPrice(v)  { return v != null ? Number(v).toFixed(2) : '—'; }
function fmtPct(v)    { return v != null ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—'; }
function fmtX(v)      { return v != null ? `${Number(v).toFixed(2)}x` : '—'; }
function fmtVol(v)    {
  if (v == null) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
  return String(v);
}
function fmtFloat(v)  { return fmtVol(v); }
function fmtCap(v)    {
  if (!v) return 'N/A';
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(1) + 'M';
  return fmtVol(v);
}
function fmtNewsTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return ''; }
}
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
