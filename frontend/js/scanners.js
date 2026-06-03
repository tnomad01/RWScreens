// ─────────────────────────────────────────────────────────────────────────────
// frontend/js/scanners.js  ·  v1.1
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Renders and updates the four left-column scanner panels.
//           Listens to the 'dataUpdated' event from engine.js and re-renders
//           only changed rows. Clicking a row fires 'symbolSelected'.
//
// Panels:   1. Top Gainers (dayTrade)       sorted by Change%, 5-min rolling header
//           2. Small Cap High of Day        streaming new-high alert feed, prepend newest
//           3. Low Float Top Gainers        Change%-sorted, derived from panels 1+2
//           4. Running Up                   velocity alert feed, 7 columns
//
// Depends:  frontend/js/engine.js  (fetchScanners, window.events)
// ─────────────────────────────────────────────────────────────────────────────

import { fetchScanners } from './engine.js';

// ── Scanner definitions ───────────────────────────────────────────────────────

const SCANNERS = [
  {
    key:         'dayTrade',
    containerId: 'scanner-daytrade',
    titleFn:     (w) => `Top Gainers: ${w.from} - ${w.to}`,
    badge:       'Online',
    sortable:    true,
    feedMode:    false,
    columns: [
      { label: 'Change\nFrom\nClose(%)', field: 'changeFromClosePct', fmt: fmtChg,   color: true, align: 'right', width: '60px' },
      { label: 'Symbol /\nNews',         field: 'symbol',             fmt: fmtSym,   align: 'left',  width: '80px'  },
      { label: 'Price',                  field: 'price',              fmt: fmtPrice, align: 'right', width: '50px'  },
      { label: 'Volume',                 field: 'volume',             fmt: fmtVol,   align: 'right', width: '60px'  },
      { label: 'Float',                  field: 'float',              fmt: fmtFloat, align: 'right', width: '55px'  },
      { label: 'Relative\nVolume\nRate', field: 'relVolDaily',        fmt: fmtX,     align: 'right', width: '50px'  },
    ],
  },
  {
    key:         'highMomentum',
    containerId: 'scanner-highmomentum',
    titleFn:     () => 'Small Cap \u2013 High of Day Momentum',
    badge:       'Online',
    sortable:    false,
    feedMode:    true,
    columns: [
      { label: 'Time',                         field: 'time',        fmt: v => v,   align: 'left',  width: '65px'  },
      { label: 'Symbol /\nNews',               field: 'symbol',      fmt: fmtSym,   align: 'left',  width: '80px'  },
      { label: 'Price',                        field: 'price',       fmt: fmtPrice, align: 'right', width: '50px'  },
      { label: 'Volume',                       field: 'volume',      fmt: fmtVol,   align: 'right', width: '60px'  },
      { label: 'Float',                        field: 'float',       fmt: fmtFloat, align: 'right', width: '55px'  },
      { label: 'Relative\nVolume\n(Daily Rate)',field: 'relVolDaily', fmt: fmtX,     align: 'right', width: '45px'  },
      { label: '5 min\n%',                     field: 'relVol5min',  fmt: fmtX,     align: 'right', width: '45px'  },
    ],
  },
  {
    key:         'lowFloat',
    containerId: 'scanner-lowfloat',
    titleFn:     (w) => `Low Float Top Gainers: ${w.from} - ${w.to}`,
    badge:       'Online',
    sortable:    true,
    feedMode:    false,
    columns: [
      { label: 'Change\nFrom\nClose(%)', field: 'changeFromClosePct', fmt: fmtChg,   color: true, align: 'right', width: '60px' },
      { label: 'Symbol /\nNews',         field: 'symbol',             fmt: fmtSym,   align: 'left',  width: '80px'  },
      { label: 'Price',                  field: 'price',              fmt: fmtPrice, align: 'right', width: '50px'  },
      { label: 'Volume',                 field: 'volume',             fmt: fmtVol,   align: 'right', width: '60px'  },
      { label: 'Float',                  field: 'float',              fmt: fmtFloat, align: 'right', width: '55px'  },
      { label: 'Relative\nVolume\nRate', field: 'relVolDaily',        fmt: fmtX,     align: 'right', width: '50px'  },
    ],
  },
  {
    key:         'runningUp',
    containerId: 'scanner-runningup',
    titleFn:     () => 'Running Up',
    badge:       'Online',
    sortable:    false,
    feedMode:    true,
    columns: [
      { label: 'Time',                         field: 'timestamp',     fmt: fmtRunUpTime, align: 'left',  width: '80px'  },
      { label: 'Symbol /\nNews',               field: 'symbol',        fmt: fmtSym,       align: 'left',  width: '80px'  },
      { label: 'Price',                        field: 'price',         fmt: fmtPrice,     align: 'right', width: '50px'  },
      { label: 'Volume',                       field: 'volume',        fmt: fmtVol,       align: 'right', width: '60px'  },
      { label: 'Float',                        field: 'float',         fmt: fmtFloat,     align: 'right', width: '55px'  },
      { label: 'Relative\nVolume\n(Daily)',     field: 'relVolDaily',   fmt: fmtX,         align: 'right', width: '45px'  },
      { label: 'Rel Vol\n5 min %',             field: 'relVol5minPct', fmt: fmtX,         align: 'right', width: '45px'  },
    ],
  },
];

// Track current window for header updates
let currentWindow = { from: '--:--:--', to: '--:--:--' };

// ── Render ────────────────────────────────────────────────────────────────────

function renderScanner(def, rows, window5min) {
  const container = document.getElementById(def.containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="scanner-header">
      <div class="scanner-header-top">
        <span class="scanner-title">${def.titleFn(window5min || currentWindow)}</span>
        <span class="badge-online">(${def.badge})</span>
        <div class="scanner-header-icons">
          <span class="scanner-icon" title="Detach">&#x29C9;</span>
          <span class="scanner-icon" title="Refresh" onclick="refreshScanner('${def.key}')">&#x21BB;</span>
        </div>
      </div>
    </div>
    <div class="scanner-scroll">
      <table class="scanner-table">
        <thead><tr>${def.columns.map(c => `
          <th style="width:${c.width};text-align:${c.align}">
            ${c.label.replace(/\n/g, '<br>')}
            ${c === def.columns[0] && def.sortable ? '<span class="sort-arrow">&#x25BC;</span>' : ''}
          </th>`).join('')}</tr>
        </thead>
        <tbody id="${def.containerId}-tbody">
          ${(rows || []).map(row => renderRow(def, row)).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderRow(def, row) {
  const cells = def.columns.map(col => {
    const val = row[col.field];
    const txt = col.fmt ? col.fmt(val, row) : (val ?? '—');
    let cls   = `text-${col.align}`;
    if (col.color) cls += val > 0 ? ' bull' : val < 0 ? ' bear' : '';
    if (col.field === 'changeFromClosePct' && val > 0) cls += ' chg-cell-bull';
    if (col.field === 'changeFromClosePct' && val < 0) cls += ' chg-cell-bear';
    return `<td class="${cls}">${txt}</td>`;
  });

  return `<tr class="scanner-row" data-ticker="${row.symbol}"
    onclick="window.selectSymbol('${row.symbol}')">
    ${cells.join('')}
  </tr>`;
}

// Partial update — only diff the tbody rows
function updateRows(def, rows, window5min) {
  // Update header time window
  const titleEl = document.querySelector(`#${def.containerId} .scanner-title`);
  if (titleEl) titleEl.textContent = def.titleFn(window5min || currentWindow);

  const tbody = document.getElementById(`${def.containerId}-tbody`);
  if (!tbody) { renderScanner(def, rows, window5min); return; }

  const existing = {};
  for (const tr of tbody.querySelectorAll('tr[data-ticker]')) {
    existing[tr.dataset.ticker] = tr;
  }

  const newRows  = rows || [];
  const fragment = document.createDocumentFragment();

  for (const row of newRows) {
    const newHtml = renderRow(def, row);
    const temp = document.createElement('tbody');
    temp.innerHTML = newHtml;
    const newTr = temp.firstElementChild;

    if (existing[row.symbol]) {
      const old = existing[row.symbol];
      if (old.innerHTML !== newTr.innerHTML) {
        newTr.classList.add('row-flash');
        fragment.appendChild(newTr);
        old.remove();
      } else {
        fragment.appendChild(old);
      }
      delete existing[row.symbol];
    } else {
      newTr.classList.add('row-new');
      fragment.appendChild(newTr);
    }
  }

  tbody.replaceChildren(fragment);

  // Re-apply active highlight
  const active = window.liveData?.currentSymbol;
  if (active) {
    tbody.querySelectorAll(`tr[data-ticker="${active}"]`).forEach(tr => tr.classList.add('row-active'));
  }
}

// ── Feed update for Scanner 2 (prepend newest) ───────────────────────────────

function updateFeed(def, rows) {
  const tbody = document.getElementById(`${def.containerId}-tbody`);
  if (!tbody) { renderScanner(def, rows); return; }

  const existingCount = tbody.querySelectorAll('tr').length;
  const newCount      = (rows || []).length;

  // If feed grew, prepend the new rows at the top
  if (newCount > existingCount) {
    const newRows = (rows || []).slice(0, newCount - existingCount);
    for (const row of newRows.reverse()) {
      const temp = document.createElement('tbody');
      temp.innerHTML = renderRow(def, row);
      const newTr = temp.firstElementChild;
      newTr.classList.add('row-new');
      tbody.prepend(newTr);
    }
    // Trim excess rows
    const allRows = tbody.querySelectorAll('tr');
    for (let i = 50; i < allRows.length; i++) allRows[i].remove();
  } else if (newCount < existingCount || existingCount === 0) {
    // Full re-render (e.g. on initial load or reset)
    tbody.innerHTML = (rows || []).map(row => renderRow(def, row)).join('');
  }
}

// ── Public ────────────────────────────────────────────────────────────────────

function refreshAll(data) {
  const sc  = data || window.liveData.scanners;
  const win = data?.window5min || currentWindow;
  if (data?.window5min) currentWindow = data.window5min;

  for (const def of SCANNERS) {
    const rows = sc[def.key] || [];
    if (def.feedMode) {
      updateFeed(def, rows);
    } else {
      updateRows(def, rows, win);
    }
  }
}

window.refreshScanner = function(key) {
  const def = SCANNERS.find(d => d.key === key);
  if (!def) return;
  const rows = window.liveData.scanners?.[def.key] || [];
  if (def.feedMode) updateFeed(def, rows);
  else updateRows(def, rows, currentWindow);
};

window.forceRefreshScanner = async function() {
  try {
    const fresh = await fetchScanners();
    window.liveData.scanners = fresh;
    refreshAll(fresh);
  } catch (err) {
    console.error('[scanners] Force refresh failed:', err.message);
  }
};

// ── Events ────────────────────────────────────────────────────────────────────

window.events.addEventListener('dataUpdated', (e) => {
  refreshAll(e.detail);
});

window.events.addEventListener('symbolSelected', (e) => {
  const { ticker } = e.detail;
  document.querySelectorAll('.scanner-row').forEach(tr => {
    tr.classList.toggle('row-active', tr.dataset.ticker === ticker);
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initScanners() {
  for (const def of SCANNERS) renderScanner(def, [], currentWindow);

  try {
    const data = await fetchScanners();
    window.liveData.scanners = data;
    if (data.window5min) currentWindow = data.window5min;
    refreshAll(data);
  } catch (err) {
    console.error('[scanners] Initial fetch failed:', err.message);
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtChg(v) {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`;
}

function fmtSym(v, row) {
  const icon = row?.newsIcon === 'flame'
    ? ' 🔥'
    : row?.newsIcon === 'yellowCircle'
      ? ' 🟡'
      : '';
  return `<span class="sym-text">${v}${icon}</span>`;
}

function fmtRunUpTime(v, row) {
  if (!v) return '—';
  const freq = row?.frequencyNote ? `<br><span class="ru-freq">${row.frequencyNote}</span>` : '';
  return `<span class="ru-time">${v}</span>${freq}`;
}

function fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '—'; }

function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(2) + 'K';
  return String(v);
}

function fmtFloat(v) {
  if (!v || v === 0) return '—';
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)         return (v / 1_000).toFixed(2) + 'K';
  return String(v);
}

function fmtX(v) { return v != null && v > 0 ? Number(v).toFixed(2) : '—'; }
