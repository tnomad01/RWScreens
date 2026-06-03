// ─────────────────────────────────────────────────────────────────────────────
// backend/test/harness.js  ·  v1.0
// ─────────────────────────────────────────────────────────────────────────────
// Purpose:  Self-contained test harness for alert services.
//           Covers: Telegram send, gainers-tracker deduplication + cooldown,
//           5 Pillars evaluation logic, and /5P + /top5 bot command handlers.
//           Does not require a live provider or browser — uses mock scanners.
//
// Run:      node test/harness.js
// Exit:     0 = all pass,  1 = any failure
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env before importing modules that read process.env at top-level
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: path.join(__dirname, '..', '..', '.env') });

import { _overrideSendMessage, _restoreSendMessage, sendMessage } from '../alerts/telegram.js';
import { checkNewGainers }                                         from '../alerts/gainers-tracker.js';
import { evalPillars }                                             from '../alerts/pillars-tracker.js';
import { handle5P, _processUpdate }                                from '../alerts/bot-commands.js';

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n══ ${name} ${'═'.repeat(Math.max(0, 40 - name.length))}`);
}

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// Capture sendMessage calls
function makeCollector() {
  const calls = [];
  _overrideSendMessage((text) => calls.push(text));
  return calls;
}

// Mock data factories
function makeRow(overrides = {}) {
  return {
    symbol:             'SPCE',
    price:              8.43,
    prevClose:          7.50,
    open:               7.30,
    volume:             488_750,
    float:              8_200_000,
    avgDailyVolume:     5_000_000,
    relVolDaily:        6.2,
    relVol5min:         4.1,
    gapPct:             12.4,
    changeFromClose:    0.93,
    changeFromClosePct: 12.4,
    newsIcon:           'flame',
    ...overrides,
  };
}

function makeRuRow(overrides = {}) {
  return {
    symbol:           'SPCE',
    relVol5minPct:    4.1,
    delta5minVsDaily: 1.2,
    ...overrides,
  };
}

function makeScanners(overrides = {}) {
  return {
    dayTrade:     [],
    highMomentum: [],
    lowFloat:     [],
    runningUp:    [],
    ...overrides,
  };
}

// ── Group 1: Gainers Tracker ──────────────────────────────────────────────────

group('Gainers Tracker');

// Reset module state between subtests by re-importing... can't easily do that
// in ES modules, so we rely on sequential test ordering + cooldown bypass.
// We use a fresh import-time state since gainers-tracker uses module-level Sets.
// Tests must run in order: empty → seed → same → depart/re-enter.

{
  let calls = makeCollector();

  // Empty scanner
  checkNewGainers(makeScanners());
  assert('No alerts on empty scanner', calls.length === 0, `got ${calls.length}`);

  // Initial seed with 2 tickers
  calls.length = 0;
  checkNewGainers(makeScanners({ dayTrade: [makeRow({ symbol: 'SPCE' }), makeRow({ symbol: 'CLOV' })] }));
  assert('2 alerts fired for initial seed', calls.length === 2, `got ${calls.length}`);
  assert('Alert contains ticker symbol', calls[0].includes('SPCE'), calls[0].slice(0, 60));
  assert('Alert contains price', calls[0].includes('8.43'), calls[0].slice(0, 80));
  assert('Alert contains change%', calls[0].includes('12.40%'), calls[0].slice(0, 100));

  // Same tickers — no re-alert (cooldown active)
  calls.length = 0;
  checkNewGainers(makeScanners({ dayTrade: [makeRow({ symbol: 'SPCE' }), makeRow({ symbol: 'CLOV' })] }));
  assert('No re-alert for same tickers (cooldown)', calls.length === 0, `got ${calls.length}`);

  // SPCE departs, SOFI enters
  calls.length = 0;
  checkNewGainers(makeScanners({ dayTrade: [makeRow({ symbol: 'CLOV' }), makeRow({ symbol: 'SOFI' })] }));
  assert('Alert for new ticker SOFI', calls.length === 1 && calls[0].includes('SOFI'), `got ${calls.length} calls`);

  // SPCE re-enters (was pruned when it departed)
  calls.length = 0;
  checkNewGainers(makeScanners({ dayTrade: [makeRow({ symbol: 'CLOV' }), makeRow({ symbol: 'SOFI' }), makeRow({ symbol: 'SPCE' })] }));
  assert('Re-alert when ticker re-enters after departure', calls.length === 1 && calls[0].includes('SPCE'), `got ${calls.length} calls`);

  _restoreSendMessage();
}

// ── Group 2: evalPillars Logic ────────────────────────────────────────────────

group('evalPillars Logic');

{
  const row = makeRow();

  const allPass = evalPillars(row, makeRuRow(), 7.00, true);
  assert('All 5 pillars pass', Object.values(allPass).every(Boolean));
  assert('Score = 5', Object.values(allPass).filter(Boolean).length === 5);

  const floatFail = evalPillars(makeRow({ float: 50_000_000 }), null, 7.00, true);
  assert('Float fail (> 10M)', floatFail.lowFloat === false);

  const relVolFail = evalPillars(makeRow({ relVolDaily: 3 }), null, 7.00, true);
  assert('RelVol fail (< 5×)', relVolFail.highRelVol === false);

  const catalystFail = evalPillars(row, makeRuRow(), 7.00, false);
  assert('Catalyst fail (no news)', catalystFail.catalyst === false);

  const momentumViaRu = evalPillars(row, makeRuRow({ relVol5minPct: 4, delta5minVsDaily: 1 }), 7.00, true);
  assert('Momentum pass via ruRow', momentumViaRu.momentum === true);

  const momentumRuFail = evalPillars(row, makeRuRow({ relVol5minPct: 2, delta5minVsDaily: 0.3 }), 7.00, true);
  assert('Momentum fail via ruRow (below thresholds)', momentumRuFail.momentum === false);

  const momentumViaGap = evalPillars(makeRow({ gapPct: 15 }), null, 7.00, true);
  assert('Momentum pass via gapPct (> 10%)', momentumViaGap.momentum === true);

  const momentumGapFail = evalPillars(makeRow({ gapPct: 5 }), null, 7.00, true);
  assert('Momentum fail via gapPct (< 10%)', momentumGapFail.momentum === false);

  const strongFail = evalPillars(makeRow({ price: 5.00 }), null, 9.00, true);
  assert('Strong daily fail (price < ema200)', strongFail.strongDaily === false);

  const strongPass = evalPillars(makeRow({ price: 10.00 }), null, 9.00, true);
  assert('Strong daily pass (price > ema200)', strongPass.strongDaily === true);

  const noEma = evalPillars(row, null, null, true);
  assert('Strong daily fail when ema200 = null', noEma.strongDaily === false);
}

// ── Group 3: /5P Command Handler ──────────────────────────────────────────────

group('/5P Command Handler');

{
  let calls = makeCollector();
  const ema200Cache = new Map([['SPCE', 7.00]]);
  const mockProvider = { fetchNews: async () => [] };

  // Known ticker in dayTrade
  const scanners = makeScanners({ dayTrade: [makeRow({ symbol: 'SPCE' })] });
  handle5P('SPCE', scanners, ema200Cache, mockProvider);
  assert('Known ticker returns 5P message', calls.length === 1, `got ${calls.length}`);
  assert('Message contains ticker', calls[0].includes('SPCE'));
  assert('Message contains all 5 pillar rows', ['Low Float', 'High Relative Vol', 'Catalyst', 'Momentum', 'Strong Daily'].every(p => calls[0].includes(p)), calls[0]);
  assert('Message contains score line', calls[0].includes('Score:'));

  // Unknown ticker
  calls.length = 0;
  handle5P('FAKE', scanners, ema200Cache, mockProvider);
  assert('Unknown ticker returns not-found message', calls.length === 1 && calls[0].includes('not found'), calls[0]);

  // Fallback to highMomentum
  calls.length = 0;
  const scanners2 = makeScanners({ highMomentum: [makeRow({ symbol: 'CLOV' })] });
  handle5P('CLOV', scanners2, ema200Cache, mockProvider);
  assert('Ticker found via highMomentum fallback', calls.length === 1 && calls[0].includes('CLOV'), calls[0].slice(0, 60));

  _restoreSendMessage();
}

// ── Group 4: Command Parsing ──────────────────────────────────────────────────

group('Command Parsing (_processUpdate)');

{
  const handled = [];
  let calls = makeCollector();

  // Temporarily replace handle5P by using _processUpdate with a scanners object
  // that has the ticker, so we can observe what ticker was parsed
  const scanners = makeScanners({ dayTrade: [makeRow({ symbol: 'SPCE' }), makeRow({ symbol: 'CLOV' })] });
  const ema200Cache = new Map();
  const mockProvider = { fetchNews: async () => [] };

  function fakeUpdate(id, text) {
    return { update_id: id, message: { text } };
  }

  // /5P SPCE
  calls.length = 0;
  _processUpdate(fakeUpdate(1, '/5P SPCE'), scanners, ema200Cache, mockProvider);
  assert('/5P SPCE triggers response for SPCE', calls.length === 1 && calls[0].includes('SPCE'));

  // /5p spce (lowercase)
  calls.length = 0;
  _processUpdate(fakeUpdate(2, '/5p spce'), scanners, ema200Cache, mockProvider);
  assert('/5p spce (lowercase) triggers response', calls.length === 1 && calls[0].includes('SPCE'));

  // /5P FAKE (unknown ticker)
  calls.length = 0;
  _processUpdate(fakeUpdate(3, '/5P FAKE'), scanners, ema200Cache, mockProvider);
  assert('/5P FAKE returns not-found', calls.length === 1 && calls[0].includes('not found'));

  // /start (ignored)
  calls.length = 0;
  _processUpdate(fakeUpdate(4, '/start'), scanners, ema200Cache, mockProvider);
  assert('/start is ignored (no response)', calls.length === 0, `got ${calls.length}`);

  // /5P with no ticker (ignored)
  calls.length = 0;
  _processUpdate(fakeUpdate(5, '/5P'), scanners, ema200Cache, mockProvider);
  assert('/5P with no ticker is ignored', calls.length === 0, `got ${calls.length}`);

  _restoreSendMessage();
}

// ── Group 5: Live Telegram Round-Trip ─────────────────────────────────────────

group('Live Telegram Round-Trip');

{
  const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TOKEN || !CHAT_ID) {
    assert('Telegram credentials present', false, 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
  } else {
    // Send a real test message and verify HTTP 200
    await new Promise((resolve) => {
      const text = `🧪 <b>Test harness</b> — alert service OK (${new Date().toLocaleTimeString('en-GB')})`;
      const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });

      const req = https.request({
        hostname: 'api.telegram.org',
        path:     `/bot${TOKEN}/sendMessage`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            assert('Test message delivered to Momentum Signals', json.ok === true, data.slice(0, 120));
          } catch {
            assert('Test message delivered to Momentum Signals', false, 'JSON parse error');
          }
          resolve();
        });
      });
      req.on('error', (err) => { assert('Test message delivered', false, err.message); resolve(); });
      req.write(body);
      req.end();
    });
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'═'.repeat(44)}`);
console.log(`  Passed: ${passed}/${total}${failed > 0 ? `  (${failed} FAILED)` : '  ✓ All clear'}`);
console.log('');

process.exit(failed > 0 ? 1 : 0);
