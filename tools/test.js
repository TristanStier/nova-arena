#!/usr/bin/env node
/* NOVA ARENA headless smoke + perf test.
 *
 * Opens the built nova-arena.html in system Chrome (puppeteer-core), runs a
 * fixed number of frames, captures console errors / page errors, reports
 * average and 95th-percentile frame time and entity counts, saves a screenshot
 * to tools/out/, and exits non-zero on any error.
 *
 * Usage:
 *   node tools/test.js                        default scene, 600 frames
 *   node tools/test.js --stress               500 enemies + 5000 bullets + 3000 particles
 *   node tools/test.js --wave=3 --frames=900
 *   node tools/test.js --boss=compactor
 *   node tools/test.js --nogl                 exercise the Canvas2D fallback
 *   node tools/test.js --headful              watch it run
 *   node tools/test.js --gl=swiftshader       force the software rasteriser
 *   node tools/test.js --attempts=6           retries for a flaky browser
 *   node tools/test.js --bot --god --fast=4 --untilWave=31 --frames=200000
 *                                             a full autopiloted 1 -> 31 run
 *   node tools/test.js --prof                 per-module timing in the stream
 *   node tools/test.js --strict               drop every launch relaxation
 *   node tools/test.js --budget=33            avg-frame-time assertion (--nobudget off)
 *   node tools/test.js --prof --msBudget=20   in-page avg-frame assertion (?prof=1 runs)
 *
 * Autopilot flags: --bot (98_bot.js autopilot) --god (no player damage)
 * --fast=N (simulation multiplier) --untilWave=N (finish when wave N starts)
 * --endless=N (start endless at N) --timeout=ms (harness wall-clock budget)
 * --stallSec=N --waveSec=N (watchdogs). Progress is streamed line by line.
 *
 * BROWSER: Microsoft Edge (Chromium) — launching chrome.exe on this machine
 * trips a blocker app that kills the browser mid-run. Override with CHROME_PATH.
 * Runs that the browser aborts are retried; a run that COMPLETES with
 * console/page errors is always a real failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'tools', 'out');
const FILE = path.join(ROOT, 'nova-arena.html');

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? '1' : m[2];
}

// Edge is used on purpose: launching real Chrome on this machine triggers
// Cold Turkey, which kills the browser mid-test. Edge is Chromium, so
// puppeteer-core drives it unchanged.
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge'
].filter(Boolean);

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('Edge not found. Set CHROME_PATH to msedge.exe.');
}

const frames = +(argv.frames || 400);
// Default: let the browser pick its own GL path; --gl=swiftshader forces the
// software rasteriser when no GPU is available.
const glMode = argv.gl || 'auto';                  // auto | angle | swiftshader | desktop
const MAX_ATTEMPTS = +(argv.attempts || 8);

function buildUrl() {
  const q = ['test=1', 'frames=' + frames, 'debug=1'];
  if (argv.stress) q.push('stress=1');
  if (argv.wave) q.push('wave=' + argv.wave);
  if (argv.boss) q.push('boss=' + argv.boss);
  if (argv.upg) q.push('upg=' + argv.upg);          // e.g. --upg=blast:3,ricochet:2
  if (argv.seed) q.push('seed=' + argv.seed);
  if (argv.quality) q.push('quality=' + argv.quality);
  if (argv.nogl) q.push('nogl=1');
  if (argv.screen) q.push('screen=' + argv.screen);
  if (argv.bot) q.push('bot=1');
  if (argv.god) q.push('god=1');
  if (argv.prof) q.push('prof=1');
  if (argv.fast) q.push('fast=' + argv.fast);
  if (argv.endless) q.push('endless=' + argv.endless);
  if (argv.untilWave) q.push('untilWave=' + argv.untilWave);
  if (argv.stallSec) q.push('stallSec=' + argv.stallSec);
  if (argv.waveSec) q.push('waveSec=' + argv.waveSec);
  // In-page avg-frame assertion for ?prof=1 runs (99_boot.js MS_BUDGET).
  if (argv.msBudget) q.push('msBudget=' + argv.msBudget);
  return 'file://' + FILE.replace(/\\/g, '/') + '?' + q.join('&');
}

function shotPath() {
  const tag = argv.screen ? 'screen-' + argv.screen
    : argv.stress ? 'stress'
    : argv.boss ? 'boss-' + argv.boss
      : argv.untilWave ? 'bot-until' + argv.untilWave
        : argv.wave ? 'wave' + argv.wave
          : argv.nogl ? 'canvas2d' : 'default';
  return path.join(OUT, tag + '.png');
}

const INFRA = /detach|Target closed|Session closed|crashed|Failed to launch|Protocol error|Execution context was destroyed/i;

async function attempt(n, url) {
  const gpuArgs = glMode === 'swiftshader'
    ? ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : glMode === 'desktop' ? ['--use-gl=desktop']
      : glMode === 'angle' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : [];

  /* puppeteer.launch() cannot start this Edge build (it exits 0 before printing
   * the DevTools endpoint), so the browser is spawned directly on a fixed
   * remote-debugging port and puppeteer connects to it. */
  const port = 9200 + Math.floor(Math.random() * 600);
  const profile = path.join(os.tmpdir(), 'na-edge-' + process.pid + '-' + port);
  /* --strict drops every relaxation, so the run sees the same file:// origin
   * rules, autoplay policy and rAF throttling the shipped page will meet.
   * Everything in `relaxed` is a convenience for long autopiloted runs. */
  const relaxed = argv.strict ? [] : [
    '--allow-file-access-from-files',
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--mute-audio'
  ];
  const proc = spawn(findChrome(), [
    argv.headful ? '--start-maximized' : '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    ...relaxed,
    '--window-size=1600,900', '--hide-scrollbars',
    ...gpuArgs, 'about:blank'
  ], { stdio: 'ignore', detached: false });

  let browser = null;
  for (let i = 0; i < 60 && !browser; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:' + port,
        defaultViewport: { width: 1600, height: 900 }
      });
    } catch (e) { }
  }
  if (!browser) {
    try { proc.kill(); } catch (e) { }
    return { result: null, errors: ['Failed to launch: no DevTools endpoint on port ' + port], warnings: [], shot: '', streamed: null };
  }

  const errors = [], warnings = [];
  let result = null, shot = '', streamed = null;
  let lastKey = '', lastPrint = 0;
  try {
    const page = await browser.newPage();
    page.on('console', m => {
      const t = m.type(), txt = m.text();
      if (txt.startsWith('NA_STATS ')) {
        try {
          streamed = JSON.parse(txt.slice(9));
          const key = streamed.state + '|' + streamed.wave + '|' + (streamed.boss || '');
          const now = Date.now();
          if (key !== lastKey || now - lastPrint > 5000) {
            lastKey = key; lastPrint = now;
            console.log('  [' + String(streamed.frames).padStart(7) +
              '] sim ' + String(streamed.sim).padStart(7) + 's  ' +
              streamed.state.padEnd(9) + ' w' + String(streamed.wave).padEnd(3) +
              ' hp' + streamed.hp +
              (streamed.deaths ? ' d' + streamed.deaths : '') +
              '  e' + streamed.entities.enemies + '/b' + streamed.entities.ebullets +
              '  ' + streamed.avgMs.toFixed(1) + 'ms' +
              (streamed.boss ? '  boss ' + streamed.boss : '') +
              (streamed.prof ? '  prof ' + streamed.prof : ''));
          }
        } catch (e) { }
        return;
      }
      if (t === 'error') errors.push('console.error: ' + txt);
      else if (t === 'warning') warnings.push(txt);
    });
    page.on('pageerror', e => errors.push('pageerror: ' + (e && e.message ? e.message : e)));
    page.on('error', e => errors.push('crashed: ' + (e && e.message ? e.message : e)));
    page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    /* An explicit poll instead of page.waitForFunction: a multi-hour autopilot
     * run reliably tripped waitForFunction's internal WaitTask ("Waiting
     * failed") after ~30 minutes even though the page was still healthy — the
     * salvage evaluate() right after it always succeeded. */
    const deadline = Date.now() + (+(argv.timeout || 180000));
    let finished = false;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 400));
      try {
        finished = await page.evaluate(() => !!(window.__NA_TEST && window.__NA_TEST.done));
      } catch (e) {
        errors.push('poll: ' + ((e && e.message) || e));
        break;
      }
      if (finished) break;
    }
    if (!finished && !errors.length) errors.push('run did not finish before --timeout');

    result = await page.evaluate(() => {
      const T = window.__NA_TEST;
      if (!T) return null;
      return {
        frames: T.frames, done: T.done, mode: T.mode, quality: T.quality,
        avgMs: T.avgMs, p95Ms: T.p95Ms, maxMs: T.maxMs,
        entities: T.entities, inPage: T.errors,
        fail: T.fail, maxWave: T.maxWave, deaths: T.deaths,
        dom: (function () {
          const host = document.getElementById('dom');
          return {
            nodes: host ? host.querySelectorAll('*').length : -1,
            filter: (document.body.style.filter || '') ||
              ((document.getElementById('wrap') || {}).style || {}).filter || '',
            overflowY: document.body.style.overflowY || '',
            scrollY: Math.round(window.scrollY || 0),
            bodyKids: document.body.children.length
          };
        })(),
        state: window.NA ? NA.Game.state : '?',
        wave: window.NA ? NA.Game.wave : 0,
        atlas: window.NA ? NA.Atlas.list.length : 0
      };
    });

    shot = shotPath();
    try { await page.screenshot({ path: shot }); }
    catch (e) { warnings.push('screenshot failed: ' + e.message); shot = ''; }
  } catch (e) {
    errors.push((e && e.message) || String(e));
  }
  try { await browser.close(); } catch (e) { }
  try { proc.kill(); } catch (e) { }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  return { result, errors, warnings, shot, streamed };
}

(async () => {
  if (!fs.existsSync(FILE)) { console.error('build first: node tools/build.js'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  const url = buildUrl();
  console.log('opening ' + url);

  let out = null, lastStreamed = null;
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    try { out = await attempt(a, url); }
    catch (e) { out = { result: null, errors: ['Failed to launch: ' + e.message], warnings: [], shot: '' }; }

    if (out.streamed) lastStreamed = out.streamed;
    const bad = out.errors.slice();
    if (!out.result || !out.result.done) bad.push('run did not complete');
    if (bad.length && bad.some(m => INFRA.test(m))) {
      console.log('attempt ' + a + ' aborted by the browser process (' + bad[0].slice(0, 60) + '), retrying');
      out = null;
      continue;
    }
    break;
  }

  console.log('\n=== NOVA ARENA test ===');
  if (!out) { console.error('every attempt was aborted by the browser process (environment, not the build)'); process.exit(1); }

  const { result, errors, warnings, shot } = out;
  if (!result) {
    console.error('no harness result');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  if (result.inPage && result.inPage.length) for (const e of result.inPage) errors.push('in-page: ' + e);

  console.log('renderer      : ' + result.mode + '   quality tier ' + result.quality + '   atlas sprites ' + result.atlas);
  console.log('state / wave  : ' + result.state + ' / ' + result.wave +
    (result.maxWave ? '   (max wave reached ' + result.maxWave + ')' : '') +
    (result.deaths ? '   deaths ' + result.deaths : ''));
  console.log('frames        : ' + result.frames + (result.done ? '' : '  (INCOMPLETE)'));
  console.log('frame avg     : ' + result.avgMs.toFixed(2) + ' ms  (' + (1000 / Math.max(0.001, result.avgMs)).toFixed(0) + ' fps)');
  console.log('frame p95     : ' + result.p95Ms.toFixed(2) + ' ms');
  console.log('frame max     : ' + result.maxMs.toFixed(2) + ' ms');
  const e = result.entities;
  console.log('entities      : enemies ' + e.enemies + '   player bullets ' + e.pbullets +
    '   enemy bullets ' + e.ebullets + '   particles ' + e.particles);
  console.log('draw calls    : ' + e.draws + '   instances ' + e.instances);
  if (result.dom) {
    const d = result.dom;
    console.log('dom after run : nodes ' + d.nodes + '   filter "' + d.filter +
      '"   overflowY "' + d.overflowY + '"   scrollY ' + d.scrollY);
    if (argv.domcheck) {
      if (d.nodes > 0) errors.push('fourth wall leaked ' + d.nodes + ' DOM nodes under #dom');
      if (d.filter) errors.push('fourth wall left a CSS filter on the page: ' + d.filter);
      if (d.overflowY && d.overflowY !== 'hidden') errors.push('viewport not restored: overflowY=' + d.overflowY);
      if (d.scrollY !== 0) errors.push('page left scrolled to ' + d.scrollY);
    }
  }
  if (shot) console.log('screenshot    : ' + shot);
  if (result.fail) errors.push('watchdog: ' + result.fail);
  if (warnings.length) {
    // A console.warn from the game is a bug like any other: the build must be
    // silent. --warnok downgrades them for a one-off investigation.
    console.error('CONSOLE WARNINGS (' + warnings.length + ')' +
      (argv.warnok ? ' (downgraded by --warnok)' : ' - treated as errors') + ':');
    for (const w of warnings.slice(0, 20)) console.error('  - ' + w);
    if (!argv.warnok) for (const w of warnings) errors.push('console.warn: ' + w);
  }

  if (errors.length) {
    console.error('\nERRORS (' + errors.length + '):');
    for (const err of errors) console.error('  - ' + err);
    process.exit(1);
  }
  /* A 2000 ms/frame fallback used to surface only as a timeout; assert the
   * budget outright. --budget=N overrides, --nobudget disables. */
  if (!argv.nobudget) {
    const budget = argv.budget ? +argv.budget : 33;
    if (result.avgMs > budget) {
      console.error('\nframe budget exceeded: avg ' + result.avgMs.toFixed(2) +
        ' ms > ' + budget + ' ms');
      process.exit(1);
    }
  }
  if (!result.done) { console.error('\nrun did not complete'); process.exit(1); }
  if (e.instances === 0 && !argv.norender) { console.error('\nnothing was drawn'); process.exit(1); }
  console.log('\nOK');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
