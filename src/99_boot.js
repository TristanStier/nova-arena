/* 99_boot.js — boot, dev overlay, dev URL params, the test harness bridge.
 *
 * Dev params
 *   ?debug=1        fps / entity overlay + on-screen error box
 *   ?wave=N         start at wave N with a plausible build
 *   ?endless=N      start endless mode at wave N (>=31)
 *   ?boss=id        jump straight to that boss
 *   ?stress=1       spawn the stress scene (500 enemies, 5000 bullets, 3000 particles)
 *   ?test=1         audio off, deterministic seed, exposes window.__NA_TEST
 *   ?frames=N       with ?test=1: mark the run complete after N frames
 *   ?seed=N         force the run seed
 *   ?quality=0..3   pin the quality tier
 *   ?bot=1          the autopilot (98_bot.js)
 *   ?god=1          the player takes no damage
 *   ?fast=N         multiply the simulation clock by N (wall clock unchanged)
 *   ?prof=1         per-module timing accumulator in the overlay
 *   ?untilWave=N    with ?test=1: the run completes when wave N starts
 *   ?stallSec=N     with ?test=1: fail if nothing progresses for N real seconds
 *   ?waveSec=N      with ?test=1: fail if one wave runs longer than N sim seconds
 *   ?msBudget=N     with ?test=1&?prof=1: fail if the average frame exceeds N ms
 */
(function () {
  var P = NA.params;
  var errors = [];

  function showError(msg) {
    errors.push(msg);
    if (window.__NA_TEST) window.__NA_TEST.errors.push(msg);
    var box = document.getElementById('err');
    if (box && (P.debug || P.test)) {
      box.style.display = 'block';
      box.textContent = errors.slice(-8).join('\n');
    }
    if (typeof console !== 'undefined') console.error('[NA] ' + msg);
  }

  window.addEventListener('error', function (e) {
    showError((e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    showError('unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  function boot() {
    try {
      NA.Store.load();
      if (P.quality !== undefined) NA.Store.settings.quality = +P.quality;

      var gl = document.getElementById('gl');
      var ui = document.getElementById('ui');
      NA.R.init(gl, ui);
      NA.R.setQuality(Math.min(3, NA.Store.settings.quality | 0));
      NA.Input.init(window);
      if (NA.Audio && NA.Audio.setVolumes) NA.Audio.setVolumes({
        master: NA.Store.settings.volMaster,
        music: NA.Store.settings.volMusic,
        sfx: NA.Store.settings.volSfx
      });

      if (P.test) {
        window.__NA_TEST = {
          ready: true, frames: 0, errors: errors.slice(), done: false,
          targetFrames: P.frames ? +P.frames : 0,
          mode: NA.R.mode, quality: NA.R.quality,
          avgMs: 0, p95Ms: 0, maxMs: 0, samples: [],
          entities: { enemies: 0, pbullets: 0, ebullets: 0, particles: 0, instances: 0, draws: 0 },
          untilWave: P.untilWave ? +P.untilWave : 0,
          fail: '', maxWave: 0, deaths: 0, warns: 0,
          _sum: 0, _cnt: 0, _sri: 0
        };
        if (NA.Audio) NA.Audio.enabled = false;
        NA.Store.settings.autofire = 1;
        NA.Game.on('playerDeath', function () { window.__NA_TEST.deaths++; });
      }

      var seed = P.seed ? (+P.seed >>> 0) : (P.test ? 12345 : 0);
      NA.Game.newRun(seed || undefined);

      if (P.stress) NA.Game.stress();
      else if (P.boss) {
        NA.Game.newRun(seed || undefined);
        NA.Game.wave = 1;
        if (!NA.Bosses.spawn(P.boss)) NA.Bosses.spawn(NA.Bosses.list[0]);
        NA.Game.setState('boss');
      }
      else if (P.endless) NA.Waves.startEndless(Math.max(31, +P.endless | 0));
      else if (P.wave) NA.Game.startAt(Math.max(1, +P.wave | 0));
      else if (P.test) NA.Game.startWave(1);
      else NA.Game.title();

      NA.Game.running = true;
      requestAnimationFrame(loop);
    } catch (e) {
      showError('boot: ' + (e && e.stack ? e.stack : e));
    }
  }

  var dbgEl = null, dbgAcc = 0;
  var SAMPLE_CAP = 4096;
  var sortBuf = [];

  /* p95 over the bounded sample ring, without allocating a new array. */
  function pct95(T) {
    var n = T.samples.length; if (!n) return 0;
    sortBuf.length = n;
    for (var i = 0; i < n; i++) sortBuf[i] = T.samples[i];
    sortBuf.sort(function (a, b) { return a - b; });
    return sortBuf[Math.min(n - 1, Math.floor(n * 0.95))];
  }

  /* ---------------------------------------------------------- watchdogs
   * A soft-lock is "the run signature stopped changing". The signature is
   * coarse on purpose (state, wave, boss, phase, spawn progress, kills) so a
   * long but healthy wave still ticks it, and a genuine stall does not. */
  var wdSig = '', wdRealAt = 0, wdWaveSimAt = 0, wdWave = -1;
  var STALL_SEC = P.stallSec ? +P.stallSec : 90;
  var WAVE_SEC = P.waveSec ? +P.waveSec : 360;
  // Average frame-time budget asserted on ?prof=1 runs (see the __NA_TEST tail).
  var MS_BUDGET = P.msBudget ? +P.msBudget : 33;

  function signature() {
    var b = NA.Bosses.active;
    return NA.Game.state + '|' + NA.Game.wave +
      '|' + (b ? b.id + ':' + b.state + ':' + b.phase + ':' + ((b.hp / Math.max(1, b.maxHp) * 40) | 0) : '-') +
      '|' + (((NA.Waves.progress || 0) * 40) | 0) +
      '|' + (NA.Enemies.totalKills | 0) +
      '|' + (NA.Player.alive ? 1 : 0);
  }

  function watchdog(T) {
    var sig = signature();
    if (sig !== wdSig) { wdSig = sig; wdRealAt = NA.Time.real; }
    else if (NA.Time.real - wdRealAt > STALL_SEC) {
      T.fail = 'stalled ' + STALL_SEC + 's real at ' + sig;
      T.done = true;
    }
    if (NA.Game.wave !== wdWave) { wdWave = NA.Game.wave; wdWaveSimAt = NA.Time.t; }
    else if (NA.Game.state === 'wave' && NA.Time.t - wdWaveSimAt > WAVE_SEC) {
      T.fail = 'wave ' + wdWave + ' ran ' + (NA.Time.t - wdWaveSimAt).toFixed(0) +
        's sim (limit ' + WAVE_SEC + ')';
      T.done = true;
    }
    if (NA.Game.wave > T.maxWave) T.maxWave = NA.Game.wave;
    if (T.untilWave && NA.Game.wave >= T.untilWave && NA.Game.state === 'wave') T.done = true;
  }

  function loop(ts) {
    try {
      NA.Game.frame(ts);
    } catch (e) {
      showError('frame: ' + (e && e.stack ? e.stack : e));
      NA.Game.running = false;
      if (window.__NA_TEST) window.__NA_TEST.done = true;
      return;
    }

    if (window.__NA_TEST) {
      var T = window.__NA_TEST;
      T.frames++;
      var ms = NA.R.stats.frameMs;
      if (T.frames > 10) {                 // ignore warm-up frames
        /* A 200k-frame autopilot run must not grow an unbounded sample array
         * (and must not clone+sort it twice a second). The mean is exact from
         * a running sum; the percentile comes from a bounded ring of the last
         * SAMPLE_CAP frames. */
        T._sum += ms; T._cnt++;
        if (T.samples.length < SAMPLE_CAP) T.samples.push(ms);
        else { T.samples[T._sri] = ms; T._sri = (T._sri + 1) % SAMPLE_CAP; }
        if (ms > T.maxMs) T.maxMs = ms;
      }
      T.entities.enemies = NA.Enemies.n;
      T.entities.pbullets = NA.Bullets.P.n;
      T.entities.ebullets = NA.Bullets.E.n;
      T.entities.particles = NA.Particles.count;
      T.entities.instances = NA.R.stats.instances;
      T.entities.draws = NA.R.stats.draws;
      T.quality = NA.R.quality;
      T.mode = NA.R.mode;
      if (!T.done) watchdog(T);
      // Stream progress to the console so tools/test.js still has numbers even
      // if the (flaky) headless renderer is killed mid-run.
      if ((T.frames % 60) === 0) {
        console.log('NA_STATS ' + JSON.stringify({
          frames: T.frames, mode: T.mode, quality: T.quality,
          avgMs: T._cnt ? T._sum / T._cnt : 0,
          p95Ms: pct95(T),
          maxMs: T.maxMs, state: NA.Game.state, wave: NA.Game.wave,
          boss: NA.Bosses.active ? (NA.Bosses.active.id + ':' + NA.Bosses.active.state +
            ':p' + NA.Bosses.active.phase + ':' + (NA.Bosses.active.hp | 0)) : '',
          hp: NA.Player.hp, real: +NA.Time.real.toFixed(1), sim: +NA.Time.t.toFixed(1),
          deaths: T.deaths, entities: T.entities, errors: T.errors.length,
          prof: (NA.Prof && NA.Prof.on) ? NA.Prof.report() : ''
        }));
      }
      if (T.targetFrames && T.frames >= T.targetFrames && !T.done) {
        if (T.untilWave && !T.fail) T.fail = 'frame budget spent at wave ' + T.maxWave +
          ' (' + NA.Game.state + '), never reached wave ' + T.untilWave;
        T.done = true;
      }
      // Unconditional: an aborted / timed-out run must still report its real
      // timings, or a 2000 ms/frame fallback reads as "0.00 ms (OK)".
      T.avgMs = T._cnt ? T._sum / T._cnt : 0;
      // p95 sorts the sample ring, so it is refreshed on the stats cadence and
      // once more when the run finishes - never on every frame.
      if ((T.frames % 60) === 0 || (T.done && !T._final)) T.p95Ms = pct95(T);
      /* With ?prof=1 the run is a performance measurement, so a blown frame
       * budget is a failure, not a footnote: assert it in-page once the run
       * finishes (the harness reads T.fail). ?msBudget=N overrides. */
      if (T.done && !T._final && P.prof && !T.fail && T._cnt > 60 && T.avgMs > MS_BUDGET) {
        T.fail = 'frame budget: avg ' + T.avgMs.toFixed(2) + ' ms > ' + MS_BUDGET +
          ' ms over ' + T._cnt + ' frames (p95 ' + T.p95Ms.toFixed(2) + ')';
      }
      if (T.done && !T._final) T._final = true;
    }

    if (P.debug) {
      dbgAcc += 1;
      if ((dbgAcc & 7) === 0) {
        if (!dbgEl) { dbgEl = document.getElementById('dbg'); if (dbgEl) dbgEl.style.display = 'block'; }
        if (dbgEl) {
          dbgEl.textContent =
            'fps ' + (1000 / Math.max(0.001, NA.R.stats.avgMs)).toFixed(0) +
            '  avg ' + NA.R.stats.avgMs.toFixed(2) + 'ms  p95 ' + NA.R.stats.p95.toFixed(2) +
            '\nmode ' + NA.R.mode + '  q' + NA.R.quality + '  res ' + NA.R.resScale +
            '\nstate ' + NA.Game.state + '  wave ' + NA.Game.wave +
            '\nenemies ' + NA.Enemies.n + '  pb ' + NA.Bullets.P.n + '  eb ' + NA.Bullets.E.n +
            '\nparticles ' + NA.Particles.count + '  inst ' + NA.R.stats.instances + '  draws ' + NA.R.stats.draws +
            '\nhp ' + NA.Player.hp + '  mana ' + NA.Player.mana.toFixed(0) + '  ts ' + NA.Time.timeScale.toFixed(2) +
            (NA.Waves.debugNote && NA.Waves.debugNote() ? '\nwaves ' + NA.Waves.debugNote() : '') +
            (NA.Prof && NA.Prof.on ? '\nprof ' + NA.Prof.report() : '') +
            (NA.Bot && NA.Bot.on ? '\nbot ' + NA.Bot.note : '');
        }
      }
    }

    if (NA.Game.running) requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
