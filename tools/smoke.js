#!/usr/bin/env node
/* NOVA ARENA Node-side smoke test — no browser required.
 *
 * Extracts the inlined <script> from the built nova-arena.html, runs it inside
 * a minimal stubbed window/document/Canvas2D environment, then drives a few
 * hundred simulation frames through the Canvas2D backend. It catches:
 *   - load-time exceptions in any module
 *   - missing globals / ordering mistakes between files
 *   - runtime exceptions in boot, the state machine and every hot loop
 *
 * It does NOT validate WebGL, pixels or performance — that is tools/test.js.
 *
 * Usage:  node tools/smoke.js [--frames=300] [--stress] [--wave=3] [--boss=compactor]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'nova-arena.html');

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? '1' : m[2];
}
const FRAMES = +(argv.frames || 300);

if (!fs.existsSync(FILE)) { console.error('build first: node tools/build.js'); process.exit(2); }
const html = fs.readFileSync(FILE, 'utf8');
const m = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('no inline <script> found in nova-arena.html'); process.exit(2); }
const code = m[1].replace(/<\\\/script/g, '</script');

/* ------------------------------------------------------------------ stubs */
// Any method call on a 2D context is a no-op; any property read returns a stub.
function ctxStub() {
  const grad = { addColorStop() { } };
  const target = {
    canvas: null,
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    measureText: () => ({ width: 0 }),
    isPointInPath: () => false
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return function () { };            // every canvas method
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function canvasStub(w, h) {
  const c = {
    width: w || 300, height: h || 150, style: {},
    getContext(kind) { return kind === '2d' ? ctxStub() : null; },  // no WebGL -> the Canvas2D path
    toDataURL() { return ''; },
    addEventListener() { }, removeEventListener() { },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
    classList: { add() { }, remove() { }, toggle() { } }
  };
  return c;
}
function elemStub(id) {
  return {
    id, style: {}, textContent: '', innerHTML: '',
    classList: { add() { }, remove() { }, toggle() { } },
    addEventListener() { }, removeEventListener() { },
    appendChild() { }, removeChild() { }
  };
}

const listeners = Object.create(null);
const els = Object.create(null);
let rafQueue = [];

const win = {
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  location: { search: buildSearch() },
  navigator: { getGamepads: () => [], userAgent: 'node-smoke' },
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
  cancelAnimationFrame() { },
  addEventListener(k, cb) { (listeners[k] || (listeners[k] = [])).push(cb); },
  removeEventListener() { },
  scrollBy() { },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  // swallow the NA_STATS progress stream that tools/test.js consumes
  console: Object.assign({}, console, {
    log: function () {
      if (typeof arguments[0] === 'string' && arguments[0].indexOf('NA_STATS ') === 0) return;
      console.log.apply(console, arguments);
    }
  })
};
win.window = win;
win.self = win;
win.globalThis = win;

win.document = {
  readyState: 'complete',
  hidden: false,
  body: elemStub('body'),
  documentElement: elemStub('html'),
  getElementById(id) {
    if (!els[id]) els[id] = (id === 'gl' || id === 'ui') ? canvasStub(1600, 900) : elemStub(id);
    return els[id];
  },
  createElement(tag) { return tag === 'canvas' ? canvasStub(2048, 2048) : elemStub(tag); },
  addEventListener(k, cb) { (listeners[k] || (listeners[k] = [])).push(cb); },
  removeEventListener() { },
  querySelector() { return null; }
};
win.AudioContext = undefined;
win.webkitAudioContext = undefined;

function buildSearch() {
  const q = ['test=1', 'nogl=1', 'frames=' + FRAMES];
  if (argv.stress) q.push('stress=1');
  if (argv.wave) q.push('wave=' + argv.wave);
  if (argv.boss) q.push('boss=' + argv.boss);
  q.push('seed=12345');
  return '?' + q.join('&');
}

/* -------------------------------------------------------------------- run */
const failures = [];
const ctx = vm.createContext(win);
try {
  vm.runInContext('"use strict";\n' + code, ctx, { filename: 'nova-arena.html', timeout: 30000 });
} catch (e) {
  console.error('LOAD FAILED: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
}

const NA = ctx.NA;
if (!NA) { console.error('NA global was never created'); process.exit(1); }
if (!NA.Game || !NA.R || !NA.Player) { console.error('core modules missing'); process.exit(1); }

// boot registers an error handler that pushes into __NA_TEST.errors
const T = ctx.window.__NA_TEST;

let t = 0, ran = 0;
for (let i = 0; i < FRAMES; i++) {
  const q = rafQueue; rafQueue = [];
  if (!q.length) break;
  t += 1000 / 60;
  for (const cb of q) {
    try { cb(t); ran++; }
    catch (e) { failures.push('frame ' + i + ': ' + (e && e.stack ? e.stack : e)); i = FRAMES; break; }
  }
  if (failures.length > 3) break;
}

if (T && T.errors) for (const e of T.errors) failures.push('in-page: ' + e);

console.log('=== NOVA ARENA smoke (node, Canvas2D stub) ===');
console.log('modules       : ' + Object.keys(NA).sort().join(' '));
console.log('renderer mode : ' + NA.R.mode + '   atlas sprites ' + NA.Atlas.list.length);
console.log('frames driven : ' + ran + ' / ' + FRAMES);
console.log('state / wave  : ' + NA.Game.state + ' / ' + NA.Game.wave);
console.log('entities      : enemies ' + NA.Enemies.n + '   player bullets ' + NA.Bullets.P.n +
  '   enemy bullets ' + NA.Bullets.E.n + '   particles ' + NA.Particles.count);
console.log('enemy types   : ' + NA.Enemies.types.map(x => x.id).join(', '));
console.log('bosses        : ' + NA.Bosses.list.join(', '));
console.log('events        : ' + Object.keys(NA.Events.defs).join(', '));
console.log('waves scripted: ' + NA.Waves.script.filter(Boolean).length);

if (failures.length) {
  console.error('\nFAILURES (' + failures.length + '):');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
if (ran < Math.min(FRAMES, 30)) { console.error('\nthe loop stopped early (' + ran + ' frames)'); process.exit(1); }
console.log('\nOK');
process.exit(0);
