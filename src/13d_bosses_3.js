/* 13d_bosses_3.js — BOSSES 21–30 (owned by the BOSSES-3 agent).
 *
 *   21 schism              the arena splits; the far half accumulates and floods
 *   22 siren               a song drags you and the swarm in; dash in the window
 *   23 probability         a tumbling die whose face is the arena rule
 *   24 page                the arena becomes the browser viewport
 *   25 understudyPerfect   the wave-10 Understudy with zero delay + 3 extra drafts
 *   26 duoLightsCamera     Strobe + Turntable
 *   27 duoBaitSwitch       Angler + Reflector
 *   28 congregationRequiem two overlapping Congregations with Wraiths inside
 *   29 duoHeatDeath        Supernova + Compactor
 *   30 singularity         the finale, and the §8.1 ending
 *
 * Also public, used by the three duos and by the two "reprise" fights:
 *
 *   NA.Bosses.defineDuo(id, [idA, idB], opts)
 *     Runs two *registered* bosses inside one fight: one shared intro, one rim
 *     ring per component, kills in any order, a 5 s grace after the first death.
 *     The components are resolved LAZILY at fight start, so file load order
 *     between 13b / 13c / 13d does not matter. A missing component falls back to
 *     the other alone (or to opts.fallback) and logs to the ?debug=1 overlay.
 *     opts = { name, color, hp, camZoom, introTime, minDuration, grace,
 *              fallback(def|fn), enter(b), update(b,dt), render(b),
 *              onDeath(b), onEnd(b), tweak(b, sub, index) }
 *
 *   NA.Bosses.shared.mirror / .swarm    reusable pieces other boss files may use
 *   NA.Bosses.flags                     cross-fight flags (nextDraftCards, …)
 *
 * Conventions honoured: intro per §9, every phase has a minDuration, hitTest
 * returns 0/1/2, every damage source telegraphs ≥0.4 s, zero text, no per-frame
 * allocation in the hot loops, nothing regressive (no upgrade is ever removed).
 */
(function () {
  var M = NA.M, C = NA.C, B = NA.Bosses;
  var R = NA.R, L = NA.R.L;
  var COL = C.COL;

  var SILVER = [0.78, 0.82, 0.88];
  var TEAL = [0.30, 0.98, 0.92];
  var EMBER_A = [1.0, 0.541, 0.10];
  var EMBER_B = [0.62, 0.24, 0.42];

  B.shared = B.shared || {};
  B.flags = B.flags || {};

  /* ==================================================================== util */

  /* The only place this file ever produces text: the ?debug=1 overlay. */
  function dbg(msg) {
    try {
      /* The console line stays BEHIND the debug gate: the harness counts
       * console.warn as a test error, so an un-gated warn fails every run. */
      if (typeof document === 'undefined') return;
      if (!NA.params.debug && !NA.params.test) return;
      if (NA.params.debug && typeof console !== 'undefined' && console.warn) console.warn('[NA.Bosses3] ' + msg);
      var box = document.getElementById('err');
      if (!box) return;
      box.style.display = 'block';
      box.textContent = (box.textContent ? box.textContent + '\n' : '') + '[bosses3] ' + msg;
    } catch (e) { }
  }

  /* The fourth-wall helper API (§9) is written by the UI agent in parallel:
   * every call is guarded and every return value is optional. */
  function fw() { return (NA.UI && NA.UI.fourthWall) ? NA.UI.fourthWall : null; }
  function fwCall(name, a, b2) {
    var f = fw(); if (!f) return undefined;
    var fn = f[name]; if (typeof fn !== 'function') return undefined;
    try { return fn.call(f, a, b2); } catch (e) { dbg('fourthWall.' + name + ': ' + e); return undefined; }
  }
  function domEl() {
    try { return (typeof document !== 'undefined') ? document.getElementById('dom') : null; } catch (e) { return null; }
  }

  var SCR = { x: 0, y: 0 };

  /* First registered id from the preference list; 'mote' always exists. */
  function pickEnemy(a, b2, c2, d2) {
    var ids = [a, b2, c2, d2];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] && NA.Enemies.byId[ids[i]] !== undefined) return ids[i];
    }
    return 'mote';
  }

  /* Nothing spawns within four ship-widths of the player, nothing outside. */
  function spawnAt(id, x, y) {
    if (NA.Enemies.n > 240) return -1;
    var P = NA.Player;
    if (P.alive) {
      var dx = x - P.x, dy = y - P.y, d2 = dx * dx + dy * dy;
      var minD = C.SHIP_R * 8;
      if (d2 < minD * minD) {
        var l = Math.sqrt(d2) || 1;
        x = P.x + dx / l * minD; y = P.y + dy / l * minD;
      }
    }
    var ax = x - NA.Arena.cx, ay = y - NA.Arena.cy;
    var ang = Math.atan2(ay, ax);
    var rr = NA.Arena.radiusAt(ang) - 40;
    var d = Math.sqrt(ax * ax + ay * ay);
    if (d > rr) { x = NA.Arena.cx + Math.cos(ang) * rr; y = NA.Arena.cy + Math.sin(ang) * rr; }
    return NA.Enemies.spawn(id, x, y);
  }

  function sfx(name, x, y, o) {
    if (!NA.Audio) return;
    var opt = o || SFXO; opt.x = x; opt.y = y;
    NA.Audio.sfx(name, opt);
  }
  var SFXO = { x: 0, y: 0 };

  /* A boss-shaped silhouette intro: the membrane dims, a point on the rim
   * cracks white, the shape slides in, the eye ignites with a camera punch. */
  function introRim(b, t, dur, col, sides) {
    var k = M.clamp01(t / dur);
    var a = b.angle;
    var rr = NA.Arena.radiusAt(a);
    var x0 = NA.Arena.cx + Math.cos(a) * rr, y0 = NA.Arena.cy + Math.sin(a) * rr;
    var x = M.lerp(x0, b.x, M.easeOut(k)), y = M.lerp(y0, b.y, M.easeOut(k));
    R.line(L.VEIL, x0, y0, x, y, 5 * (1 - k) + 1.5, 1, 1, 1, 0.85 * (1 - k * 0.5));
    R.poly(L.ENEMIES, x, y, 30 + 46 * k, sides || 6, t * 1.2, 3,
      col[0] * (0.35 + 0.65 * k), col[1] * (0.35 + 0.65 * k), col[2] * (0.35 + 0.65 * k), 0.95);
    R.dot(L.ENEMIES, x, y, 5 + 11 * k * k, 1, 1, 1, 0.35 + 0.6 * k);
    R.softRing(L.VEIL, x, y, 120 * k, col[0], col[1], col[2], 0.18 * k);
    if (k > 0.92 && !b.data._punch) { b.data._punch = 1; NA.Cam.addTrauma(0.28); NA.FX.chroma(2, 180); }
    return false;
  }

  /* ------------------------------------------------------------- tickers
   * Post-death effects (the Siren's 5 s pin, the finale's ending spectacle)
   * outlive the boss object, so they ride a tiny list wrapped around
   * NA.Bosses.update / render — the update half steps with the simulation, the
   * render half draws inside the frame's command buffer. A ticker's update
   * returns false when it is done. */
  var tickers = [];
  var tickHooked = 0;
  function addTicker(update, render) {
    // NA.Game does not exist yet when this file loads, so the cleanup hooks are
    // installed on first use
    if (!tickHooked && NA.Game) {
      tickHooked = 1;
      NA.Game.on('playerDeath', function () { tickers.length = 0; });
      NA.Game.on('stateChange', function (s) { if (s === 'title') tickers.length = 0; });
    }
    tickers.push({ u: update, r: render || null });
  }
  /* Same chain as 13c: one NA.Bosses.resetRun() clears every run-long effect
   * both files own, in load order, on restart and on returning to the title. */
  var _prevResetRun3 = B.resetRun;
  B.resetRun = function () {
    tickers.length = 0;
    if (_prevResetRun3) _prevResetRun3.call(B);
  };

  var _bossUpdate = B.update, _bossRender = B.render;
  B.update = function (dt) {
    _bossUpdate.call(B, dt);
    for (var i = tickers.length - 1; i >= 0; i--) {
      var keep = true;
      try { keep = tickers[i].u(dt) !== false; } catch (e) { keep = false; dbg('ticker: ' + e); }
      if (!keep) tickers.splice(i, 1);
    }
  };
  B.render = function () {
    _bossRender.call(B);
    for (var i = 0; i < tickers.length; i++) {
      if (!tickers[i].r) continue;
      try { tickers[i].r(); } catch (e) { dbg('ticker render: ' + e); }
    }
  };

  /* ======================================================= sub-boss driver
   * A "sub" is a boss object with the same shape as NA.Bosses.active, driven by
   * hand so two of them can share one fight. While a component's code runs,
   * NA.Bosses.active points at ITS sub, so components written against the
   * framework (b, or NA.Bosses.active) behave normally. */

  function makeSub(def, id, angle) {
    return {
      def: def, id: id, hp: def.hp, maxHp: def.hp,
      x: NA.Arena.cx, y: NA.Arena.cy, angle: angle || 0,
      phase: -1, phaseT: 0, t: 0, introT: def.introTime || 0,
      state: 'fight', ringK: 1, flash: 0, data: {},
      dead: false, onDeadCb: null, isSub: true
    };
  }

  /* A component that hurts itself calls the FRAMEWORK — NA.Bosses.damage() and
   * NA.Bosses.die() — because that is the only API a stand-alone fight has (the
   * Reflector's matte facet, the Metronome's wall impacts, the Echo's key). In
   * a duo those calls arrive with B.active pointed at a sub, and the framework
   * then ran its own phase maths on the sub and, at 0 HP, set state='dying'
   * WITHOUT setting sb.dead or firing onDeadCb — so the duo's tick never saw
   * the component die. duoBaitSwitch sat at hp 0 in fight:p0 forever. Route
   * both calls to the sub driver whenever the active boss is a sub. */
  var _fwDamage = B.damage, _fwDie = B.die;
  B.damage = function (amt) {
    var a = B.active;
    if (a && a.isSub) { subDamage(a, amt); return; }
    return _fwDamage.call(B, amt);
  };
  B.die = function () {
    var a = B.active;
    if (a && a.isSub) { subDie(a); return; }
    return _fwDie.call(B);
  };

  function withActive(sb, fn, arg) {
    if (typeof fn !== 'function') return;
    var prev = B.active;
    B.active = sb;
    try { fn(sb, arg); }
    catch (e) { dbg((sb.id || '?') + ': ' + (e && e.message ? e.message : e)); }
    B.active = prev;
  }

  function subNextPhase(sb) {
    var ph = sb.def.phases[sb.phase];
    if (ph && ph.exit) withActive(sb, ph.exit);
    sb.phase++; sb.phaseT = 0;
    if (sb.phase >= sb.def.phases.length) { sb.phase = sb.def.phases.length - 1; return; }
    var np = sb.def.phases[sb.phase];
    if (np && np.enter) withActive(sb, np.enter);
    if (sb.def.onPhase) withActive(sb, sb.def.onPhase, sb.phase);
    if (sb.phase > 0) {
      NA.FX.hitStop(110); NA.Time.slowmo(0.4, 600); NA.FX.chroma(2.5, 180); NA.FX.trauma(0.35);
      sfx('bossPhase', sb.x, sb.y);
    }
  }

  function subUpdate(sb, dt) {
    if (sb.dead) return;
    sb.t += dt; sb.phaseT += dt;
    if (sb.flash > 0) sb.flash -= dt;
    var ph = sb.def.phases[sb.phase];
    /* The same catch stepBoss() has: a component already pinned at its phase
     * threshold by the minimum-duration floor advances (or dies, on the last
     * phase) the moment the timer expires, instead of waiting for one more
     * landed hit that a consumed weak point may never offer. */
    if (ph && sb.phaseT >= ph.minDuration) {
      var np0 = Math.max(1, sb.def.phases.length);
      var thr = (np0 - 1 - sb.phase) * (sb.maxHp / np0);
      if (sb.hp <= thr + 1.001) {
        if (sb.phase < np0 - 1) { subNextPhase(sb); return; }
        if (sb.hp <= 1.001) { subDie(sb); return; }
      }
    }
    if (ph && ph.update) withActive(sb, ph.update, dt);
    if (sb.def.update) withActive(sb, sb.def.update, dt);
  }

  /* During the grace window the survivor breathes but never attacks. */
  function subIdle(sb, dt) {
    if (sb.dead) return;
    sb.t += dt;
    if (sb.flash > 0) sb.flash -= dt;
  }

  function subRender(sb) {
    if (sb.dead) return;
    if (sb.def.render) withActive(sb, sb.def.render);
    var ph = sb.def.phases[sb.phase];
    if (ph && ph.render) withActive(sb, ph.render);
  }

  function subHit(sb, x, y, r) {
    if (sb.dead) return 0;
    if (sb.def.hitTest) {
      var res = 0, prev = B.active;
      B.active = sb;
      try { res = sb.def.hitTest(sb, x, y, r) | 0; }
      catch (e) { dbg((sb.id || '?') + '.hitTest: ' + e); res = 0; }
      B.active = prev;
      return res;
    }
    var rr = (sb.data.radius || 70) + r, dx = sb.x - x, dy = sb.y - y;
    return (dx * dx + dy * dy <= rr * rr) ? 1 : 0;
  }

  /* The framework's phase gate, per component: while phaseT < minDuration the
   * component floors 1 HP above its phase threshold. */
  function subDamage(sb, amt) {
    if (sb.dead) return;
    if (sb.def.onDamage) {
      var ok = true, prev = B.active;
      B.active = sb;
      try { ok = sb.def.onDamage(sb, amt) !== false; } catch (e) { dbg('onDamage: ' + e); }
      B.active = prev;
      if (!ok) return;
    }
    var np = Math.max(1, sb.def.phases.length);
    var phaseHp = sb.maxHp / np;
    var ph = sb.def.phases[sb.phase];
    sb.hp -= amt; sb.flash = 0.08;
    var floor = (np - 1 - sb.phase) * phaseHp;
    if (ph && sb.phaseT < ph.minDuration) floor += 1;
    if (sb.hp < floor) sb.hp = floor;
    if (sb.hp <= 0) subDie(sb);
    else if (sb.phase < np - 1 && sb.hp <= floor + 0.001 && ph && sb.phaseT >= ph.minDuration) subNextPhase(sb);
  }

  function subDie(sb) {
    if (sb.dead) return;
    sb.dead = true; sb.hp = 0; sb.state = 'dying';
    NA.FX.flash(0.3, 160); NA.FX.chroma(3, 320); NA.FX.trauma(0.5);
    sfx('bossDeath', sb.x, sb.y);
    if (sb.def.onDeath) withActive(sb, sb.def.onDeath);
    if (sb.onDeadCb) { try { sb.onDeadCb(sb); } catch (e) { dbg('onDeadCb: ' + e); } }
  }

  function subEnd(sb) { if (sb.def.onEnd) withActive(sb, sb.def.onEnd); }

  /* One thin ring per component on the rim, inside the framework's total ring. */
  function subRing(sb, i, n) {
    var col = sb.def.color || COL.magenta;
    var rad = NA.Arena.radius + 66;
    var span = M.TAU / Math.max(1, n) * 0.92;
    var a0 = sb.angle + span * 0.5;
    var frac = M.clamp01(sb.hp / Math.max(1, sb.maxHp));
    R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, rad, a0, a0 - span, 3, col[0], col[1], col[2], 0.18);
    if (frac > 0) R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, rad, a0, a0 - span * frac, 6.5,
      col[0], col[1], col[2], sb.dead ? 0.2 : 0.9);
  }

  /* ================================================================ THE DUO */

  function resolveComponent(cid, opts, index) {
    var d = B.defs[cid];
    if (d && d.phases && d.phases.length) return d;
    return null;
  }

  function fallbackOf(opts, id) {
    var f = opts && opts.fallback;
    if (typeof f === 'function') { try { return f(id); } catch (e) { dbg('fallback: ' + e); } }
    else if (f && f.phases) return f;
    return genericDef(id);
  }

  /* A last-resort component so a duo is never an empty room. */
  function genericDef(id) {
    return {
      id: id + ':generic', name: id, color: COL.magenta, hp: 380, introTime: 0,
      phases: [
        { minDuration: 10, update: function (b, dt) { genericTick(b, dt, 0); } },
        { minDuration: 12, update: function (b, dt) { genericTick(b, dt, 1); } }
      ],
      hitTest: function (b, x, y, r) {
        var dx = b.x - x, dy = b.y - y, rr = 58 + r;
        return dx * dx + dy * dy <= rr * rr ? 1 : 0;
      },
      render: function (b) {
        R.poly(L.ENEMIES, b.x, b.y, 58, 6, b.t * 0.5, 3, 1, 0.235, 0.675, 0.95);
        R.dot(L.ENEMIES, b.x, b.y, 10, 1, 1, 1, 0.9);
      }
    };
  }
  function genericTick(b, dt, mode) {
    var d = b.data;
    var rr = NA.Arena.radius * 0.55;
    b.x = NA.Arena.cx + Math.cos(b.angle + b.t * 0.4) * rr;
    b.y = NA.Arena.cy + Math.sin(b.angle + b.t * 0.4) * rr;
    d.cd = (d.cd || 0) - dt;
    if (d.cd <= 0) {
      d.cd = mode ? 1.5 : 2.4;
      var P = NA.Player;
      var a = Math.atan2(P.y - b.y, P.x - b.x);
      for (var k = -1; k <= 1; k++) {
        NA.Bullets.fireEnemy(b.x, b.y, Math.cos(a + k * 0.22) * 460, Math.sin(a + k * 0.22) * 460,
          { size: 9, life: 4, color: COL.magenta });
      }
      sfx('shotHeavy', b.x, b.y);
    }
  }

  B.defineDuo = function (id, ids, opts) {
    opts = opts || {};
    var grace = opts.grace === undefined ? 5 : opts.grace;

    function start(b) {
      var d = b.data;
      d.subs = [];
      d.grace = 0; d.hitSub = null; d.deaths = 0;
      var i, cdef, missing = 0;
      for (i = 0; i < ids.length; i++) {
        cdef = resolveComponent(ids[i], opts, i);
        if (!cdef) { missing++; dbg('duo ' + id + ': component "' + ids[i] + '" is not registered'); continue; }
        d.subs.push(makeSub(cdef, ids[i], b.angle + (i / ids.length) * M.TAU));
      }
      if (!d.subs.length) {
        // every component missing: run the fallback alone rather than nothing
        var fb = fallbackOf(opts, id);
        d.subs.push(makeSub(fb, id + ':fallback', b.angle));
        dbg('duo ' + id + ': no components resolved, using the fallback');
      } else if (missing) {
        dbg('duo ' + id + ': running ' + d.subs.length + ' of ' + ids.length + ' components');
      }
      var total = 0;
      for (i = 0; i < d.subs.length; i++) {
        var sb = d.subs[i];
        var rr = NA.Arena.radius * (d.subs.length > 1 ? 0.5 : 0.35);
        sb.x = NA.Arena.cx + Math.cos(sb.angle) * rr;
        sb.y = NA.Arena.cy + Math.sin(sb.angle) * rr;
        sb.onDeadCb = onSubDead;
        if (opts.tweak) { try { opts.tweak(b, sb, i); } catch (e) { dbg('tweak: ' + e); } }
        subNextPhase(sb);
        total += sb.maxHp;
      }
      b.maxHp = total || b.maxHp; b.hp = total || b.hp;
      if (opts.enter) { try { opts.enter(b); } catch (e) { dbg('duo enter: ' + e); } }

      function onSubDead() {
        d.deaths++;
        var aliveLeft = 0;
        for (var q = 0; q < d.subs.length; q++) if (!d.subs[q].dead) aliveLeft++;
        if (aliveLeft > 0) {
          d.grace = grace;                        // a breather before the second half
          NA.Time.slowmo(0.35, 800);
          NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, 40, NA.Arena.radius, 0.8, 6, 1, 1, 1, 0.7);
        }
      }
    }

    function tick(b, dt) {
      var d = b.data;
      if (!d.subs) return;
      if (d.grace > 0) d.grace -= dt;
      var hp = 0, mx = 0, alive = 0, i;
      for (i = 0; i < d.subs.length; i++) {
        var sb = d.subs[i];
        hp += sb.hp; mx += sb.maxHp;
        if (sb.dead) continue;
        alive++;
        if (d.grace > 0) subIdle(sb, dt); else subUpdate(sb, dt);
      }
      b.hp = hp; b.maxHp = Math.max(1, mx);
      /* ARCHITECTURE 25.23: the body the arena tracks must BE something you can
       * shoot. The duo's own b.x/b.y sat on the arena centre for the whole
       * fight, so the off-screen marker, the camera and the autopilot's
       * fallback spiral all pointed at empty floor whenever the probe came up
       * dry (the Reflector's hitTest reports 0 by design). Park it on the
       * nearest LIVE component instead, with a little hysteresis so it does not
       * flip every frame when the two are equidistant. */
      var bx = NA.Player.x, by = NA.Player.y, bestD = 1e18, best = null;
      for (i = 0; i < d.subs.length; i++) {
        var lb = d.subs[i];
        if (lb.dead) continue;
        var ldx = lb.x - bx, ldy = lb.y - by, ld = ldx * ldx + ldy * ldy;
        if (lb === d.bodySub) ld *= 0.55;
        if (ld < bestD) { bestD = ld; best = lb; }
      }
      if (best) { d.bodySub = best; b.x = best.x; b.y = best.y; }
      if (opts.update) { try { opts.update(b, dt); } catch (e) { dbg('duo update: ' + e); } }
      if (!alive && b.state === 'fight') B.die();
    }

    return B.define(id, {
      name: opts.name || id,
      color: opts.color || COL.magenta,
      hp: opts.hp || 900,
      introTime: opts.introTime === undefined ? 2.0 : opts.introTime,
      camZoom: opts.camZoom || 0.66,

      intro: function (b, t) {
        /* GAME_PLAN 9: the intro shows the rule before the boss touches you.
         * A duo therefore plays each component's OWN intro for the first 60% of
         * the window -- the Strobe's darkness, the Turntable's spin, the prism,
         * the growing sun -- and only then hands off to the shared eye-ignition
         * punch.  The intro subs are throwaway instances; they never fight. */
        var d0 = b.data;
        var dur = b.def.introTime || 2;
        if (!d0._iSubs) {
          d0._iSubs = [];
          for (var q = 0; q < ids.length; q++) {
            var cd = resolveComponent(ids[q], opts, q);
            if (!cd || typeof cd.intro !== 'function') continue;
            var isb = makeSub(cd, ids[q], b.angle + (q / Math.max(1, ids.length)) * M.TAU);
            var irr = NA.Arena.radius * (ids.length > 1 ? 0.5 : 0.35);
            isb.x = NA.Arena.cx + Math.cos(isb.angle) * irr;
            isb.y = NA.Arena.cy + Math.sin(isb.angle) * irr;
            isb.state = 'intro';
            d0._iSubs.push(isb);
          }
        }
        if (t < dur * 0.6) {
          for (var w = 0; w < d0._iSubs.length; w++) {
            var sbi = d0._iSubs[w];
            // each component's own intro clock, stretched over the shared 60%
            var ct = (t / (dur * 0.6)) * (sbi.def.introTime || dur * 0.6);
            withActive(sbi, sbi.def.intro, ct);
          }
        } else if (d0._iSubs.length) {
          for (var w2 = 0; w2 < d0._iSubs.length; w2++) {
            var sbe = d0._iSubs[w2];
            if (sbe.def.onEnd) withActive(sbe, sbe.def.onEnd);
          }
          d0._iSubs.length = 0;
        }

        // then the shared hand-off: silhouettes slide in from opposite rim cracks
        var n = Math.max(1, ids.length);
        for (var i = 0; i < n; i++) {
          var a = b.angle + (i / n) * M.TAU;
          var k = M.clamp01(t / (b.def.introTime || 2));
          var rr = NA.Arena.radiusAt(a);
          var x0 = NA.Arena.cx + Math.cos(a) * rr, y0 = NA.Arena.cy + Math.sin(a) * rr;
          var x1 = NA.Arena.cx + Math.cos(a) * NA.Arena.radius * 0.5;
          var y1 = NA.Arena.cy + Math.sin(a) * NA.Arena.radius * 0.5;
          var x = M.lerp(x0, x1, M.easeOut(k)), y = M.lerp(y0, y1, M.easeOut(k));
          var col = opts.color || COL.magenta;
          R.line(L.VEIL, x0, y0, x, y, 4 * (1 - k) + 1.5, 1, 1, 1, 0.7 * (1 - k * 0.5));
          R.poly(L.ENEMIES, x, y, 26 + 40 * k, 6, t * 1.1 + i, 3, col[0], col[1], col[2], 0.9);
          R.dot(L.ENEMIES, x, y, 4 + 9 * k * k, 1, 1, 1, 0.4 + 0.5 * k);
        }
        if (t > (b.def.introTime || 2) * 0.92 && !b.data._punch) {
          b.data._punch = 1; NA.Cam.addTrauma(0.3); NA.FX.chroma(2.4, 200);
        }
        return false;
      },

      hitTest: function (b, x, y, r) {
        var d = b.data;
        if (!d.subs) return 0;
        var absorbed = 0;
        for (var i = 0; i < d.subs.length; i++) {
          var sb = d.subs[i];
          if (sb.dead) continue;
          var res = subHit(sb, x, y, r);
          if (res === 1) { d.hitSub = sb; return 1; }
          if (res === 2) absorbed = 2;
        }
        return absorbed;
      },

      /* all damage is routed by hand so each component keeps its own gate */
      onDamage: function (b, amt) {
        var sb = b.data.hitSub;
        b.data.hitSub = null;
        if (sb) subDamage(sb, amt);
        return false;
      },

      phases: [{ minDuration: opts.minDuration || 0, enter: start, update: tick }],

      onDeath: function (b) {
        var d = b.data;
        if (d.subs) for (var i = 0; i < d.subs.length; i++) if (!d.subs[i].dead) subDie(d.subs[i]);
        if (opts.onDeath) { try { opts.onDeath(b); } catch (e) { dbg('duo onDeath: ' + e); } }
      },

      onEnd: function (b) {
        var d = b.data;
        if (d.subs) for (var i = 0; i < d.subs.length; i++) subEnd(d.subs[i]);
        if (opts.onEnd) { try { opts.onEnd(b); } catch (e) { dbg('duo onEnd: ' + e); } }
      },

      render: function (b) {
        var d = b.data;
        if (!d.subs) return;
        var i;
        for (i = 0; i < d.subs.length; i++) subRender(d.subs[i]);
        for (i = 0; i < d.subs.length; i++) subRing(d.subs[i], i, d.subs.length);
        if (d.grace > 0) {
          // the survivor holds its breath: a soft ring counts the grace down
          var k = M.clamp01(d.grace / Math.max(0.001, grace));
          R.ring(L.HUD, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius + 84, 2.5, 1, 1, 1, 0.25 * k);
        }
        if (opts.render) { try { opts.render(b); } catch (e) { dbg('duo render: ' + e); } }
      }
    });
  };

  /* ====================================================== reusable: MIRROR
   * A negative-colour copy of the ship, mirrored through the arena centre,
   * replaying your inputs with a delay. Used by understudyPerfect (as a
   * fallback) and by the Singularity's third phase. */
  var MIR_N = 256;
  function mirrorMake(delay) {
    return {
      hx: new Float32Array(MIR_N), hy: new Float32Array(MIR_N), ha: new Float32Array(MIR_N),
      hi: 0, filled: 0, delay: delay || 0,
      x: NA.Arena.cx, y: NA.Arena.cy, ang: 0, fireCd: 0, extra: 0, stun: 0
    };
  }
  function mirrorUpdate(m, dt, aggression) {
    var P = NA.Player;
    m.hi = (m.hi + 1) % MIR_N;
    m.hx[m.hi] = P.x; m.hy[m.hi] = P.y; m.ha[m.hi] = P.angle;
    if (m.filled < MIR_N) m.filled++;
    var back = Math.min(MIR_N - 1, Math.round(m.delay / Math.max(1e-4, NA.Time.fixed)));
    var j = (m.hi - back + MIR_N * 2) % MIR_N;
    // mirrored through the arena centre: mirror geometry is the counter-play
    var tx = 2 * NA.Arena.cx - m.hx[j], ty = 2 * NA.Arena.cy - m.hy[j];
    m.x = M.smooth(m.x, tx, 14, dt);
    m.y = M.smooth(m.y, ty, 14, dt);
    m.ang = Math.atan2(P.y - m.y, P.x - m.x);
    if (m.stun > 0) { m.stun -= dt; return; }
    m.fireCd -= dt;
    if (m.fireCd <= 0) {
      m.fireCd = 0.34 / Math.max(0.4, aggression || 1);
      var n = 1 + (m.extra > 0 ? 2 : 0);
      for (var k = 0; k < n; k++) {
        var a = m.ang + (k - (n - 1) / 2) * 0.16;
        NA.Bullets.fireEnemy(m.x + Math.cos(a) * 22, m.y + Math.sin(a) * 22,
          Math.cos(a) * 620, Math.sin(a) * 620,
          { size: 7, life: 3.4, color: COL.violet });
      }
      sfx('shot', m.x, m.y, { vol: 0.35 });
    }
  }
  function mirrorRender(m, alpha) {
    var a = alpha === undefined ? 1 : alpha;
    NA.Ship.render(m.x, m.y, m.ang, 0.9 * a, 1.25, COL.violet);
    R.ring(L.ENEMIES, m.x, m.y, 26, 2, COL.violet[0], COL.violet[1], COL.violet[2], 0.6 * a);
    R.dot(L.ENEMIES, m.x, m.y, 4, 1, 1, 1, 0.85 * a);
    if (m.stun > 0) R.ring(L.VEIL, m.x, m.y, 40, 3, 1, 1, 1, 0.5);
  }
  function mirrorHit(m, x, y, r) {
    var dx = m.x - x, dy = m.y - y, rr = 30 + r;
    return dx * dx + dy * dy <= rr * rr ? 1 : 0;
  }
  B.shared.mirror = { make: mirrorMake, update: mirrorUpdate, render: mirrorRender, hit: mirrorHit };

  /* ======================================================= reusable: SWARM
   * A compact Congregation: N boids that assemble into shapes; the shape is the
   * attack; the keystones are the weak points. Used as the Requiem's fallback
   * when 13b's congregation is not registered. */
  var SWARM_N = 96;
  function swarmDef(id, col) {
    var color = col || COL.grey;
    return {
      id: id, name: id, color: color, hp: 460, introTime: 0,
      phases: [
        { minDuration: 13, enter: function (b) { swarmInit(b, 0); }, update: function (b, dt) { swarmTick(b, dt); } },
        { minDuration: 15, enter: function (b) { swarmInit(b, 1); }, update: function (b, dt) { swarmTick(b, dt); } }
      ],
      hitTest: function (b, x, y, r) {
        var d = b.data; if (!d.kx) return 0;
        for (var k = 0; k < 4; k++) {
          if (d.khp[k] <= 0) continue;
          var dx = d.kx[k] - x, dy = d.ky[k] - y, rr = 34 + r;
          if (dx * dx + dy * dy <= rr * rr) return 1;
        }
        // the body of the flock eats what is not aimed at a keystone
        var bx = b.x - x, by = b.y - y;
        return (bx * bx + by * by < 260 * 260) ? 2 : 0;
      },
      render: function (b) { swarmRender(b, color); },
      onDeath: function (b) { swarmAsh(b, color); }
    };
  }
  function swarmInit(b, mode) {
    var d = b.data;
    if (!d.px) {
      d.px = new Float32Array(SWARM_N); d.py = new Float32Array(SWARM_N);
      d.vx = new Float32Array(SWARM_N); d.vy = new Float32Array(SWARM_N);
      d.kx = new Float32Array(4); d.ky = new Float32Array(4); d.khp = new Float32Array(4);
      for (var i = 0; i < SWARM_N; i++) {
        var a = i / SWARM_N * M.TAU;
        d.px[i] = b.x + Math.cos(a) * 200; d.py[i] = b.y + Math.sin(a) * 200;
      }
    }
    d.mode = mode; d.shape = 0; d.shapeT = 0; d.lunge = 0;
    for (var k = 0; k < 4; k++) d.khp[k] = 30;
  }
  function swarmTick(b, dt) {
    var d = b.data, P = NA.Player, i;
    d.shapeT += dt;
    var period = d.mode ? 4.2 : 5.4;
    if (d.shapeT > period) { d.shapeT = 0; d.shape = (d.shape + 1) % 3; d.lunge = 0.9; sfx('charge', b.x, b.y); }
    // the mass drifts toward the player, slowly
    var ang = Math.atan2(P.y - b.y, P.x - b.x);
    b.x += Math.cos(ang) * 34 * dt; b.y += Math.sin(ang) * 34 * dt;
    var rr = NA.Arena.radius * 0.72;
    var bd = Math.sqrt((b.x - NA.Arena.cx) * (b.x - NA.Arena.cx) + (b.y - NA.Arena.cy) * (b.y - NA.Arena.cy));
    if (bd > rr) { var ba = Math.atan2(b.y - NA.Arena.cy, b.x - NA.Arena.cx); b.x = NA.Arena.cx + Math.cos(ba) * rr; b.y = NA.Arena.cy + Math.sin(ba) * rr; }

    var k2 = M.clamp01(d.shapeT / (period * 0.55));
    var lung = d.lunge > 0 ? (d.lunge -= dt, M.clamp01(d.lunge)) : 0;
    for (i = 0; i < SWARM_N; i++) {
      var f = i / SWARM_N, tx, ty;
      if (d.shape === 0) {            // ring
        tx = b.x + Math.cos(f * M.TAU + b.t * 0.5) * 190;
        ty = b.y + Math.sin(f * M.TAU + b.t * 0.5) * 190;
      } else if (d.shape === 1) {     // wedge aimed at the player
        var sp = (f - 0.5) * 320;
        tx = b.x + Math.cos(ang) * Math.abs(sp) * 0.7 - Math.sin(ang) * sp;
        ty = b.y + Math.sin(ang) * Math.abs(sp) * 0.7 + Math.cos(ang) * sp;
      } else {                        // spiral spear
        var s = f * 6.0;
        tx = b.x + Math.cos(ang + s) * (28 + s * 34);
        ty = b.y + Math.sin(ang + s) * (28 + s * 34);
      }
      var dx = tx - d.px[i], dy = ty - d.py[i];
      d.vx[i] = M.smooth(d.vx[i], dx * 3.2, 6, dt);
      d.vy[i] = M.smooth(d.vy[i], dy * 3.2, 6, dt);
      d.px[i] += d.vx[i] * dt * (1 + lung * 1.5);
      d.py[i] += d.vy[i] * dt * (1 + lung * 1.5);
      // the shape is the attack: contact hurts only once the shape has formed
      if (k2 > 0.85 && P.alive) {
        var pdx = d.px[i] - P.x, pdy = d.py[i] - P.y;
        if (pdx * pdx + pdy * pdy < 320) P.damage(1, d.px[i], d.py[i]);
      }
    }
    for (var k = 0; k < 4; k++) {
      var ka = b.t * 0.6 + k * M.HALFPI;
      d.kx[k] = b.x + Math.cos(ka) * 120; d.ky[k] = b.y + Math.sin(ka) * 120;
    }
  }
  function swarmRender(b, col) {
    var d = b.data; if (!d.px) return;
    var k2 = M.clamp01(d.shapeT / 2.2);
    for (var i = 0; i < SWARM_N; i += 1) {
      R.sprite(L.ENEMIES, 'tri', d.px[i], d.py[i], Math.atan2(d.vy[i], d.vx[i]), 7, 7,
        col[0], col[1], col[2], 0.55 + 0.35 * k2);
    }
    for (var k = 0; k < 4; k++) {
      if (d.khp[k] <= 0) continue;
      R.poly(L.ENEMIES, d.kx[k], d.ky[k], 22, 4, b.t, 3, COL.gold[0], COL.gold[1], COL.gold[2], 0.9);
      R.dot(L.ENEMIES, d.kx[k], d.ky[k], 5, 1, 1, 1, 0.9);
    }
  }
  function swarmAsh(b, col) {
    var d = b.data; if (!d.px) return;
    for (var i = 0; i < SWARM_N; i += 2) {
      NA.Particles.spawn(d.px[i], d.py[i], (NA.RNG.f() - 0.5) * 40, -60 - NA.RNG.f() * 90,
        1.1, 3, col[0], col[1], col[2], 0.8, 1, 0.4);
    }
  }
  B.shared.swarm = { def: swarmDef };

  /* ================================================================ 21 SCHISM
   * The arena splits into two half-arenas with a white gap. Enemies spawn on
   * both sides; the side you are not on accumulates and floods across at a
   * threshold shown as a growing ring. Crossing costs your whole bar: dash into
   * the gap edge. Phase 2 makes four quadrants. Phase 3 slam-merges the halves
   * and pancakes whatever is caught in the gap. */

  function schismSide(b, x, y, which) {
    var d = b.data;
    var nx = which ? -Math.sin(d.axis2) : -Math.sin(d.axis);
    var ny = which ? Math.cos(d.axis2) : Math.cos(d.axis);
    return (x - NA.Arena.cx) * nx + (y - NA.Arena.cy) * ny;
  }

  function schismCell(b, x, y) {
    var s = schismSide(b, x, y, 0) >= 0 ? 1 : 0;
    if (!b.data.quad) return s;
    return s * 2 + (schismSide(b, x, y, 1) >= 0 ? 1 : 0);
  }

  function schismPushOut(b, which, x, y, half, out) {
    var d = b.data;
    var nx = which ? -Math.sin(d.axis2) : -Math.sin(d.axis);
    var ny = which ? Math.cos(d.axis2) : Math.cos(d.axis);
    var s = (x - NA.Arena.cx) * nx + (y - NA.Arena.cy) * ny;
    var sgn = s >= 0 ? 1 : -1;
    var need = half - Math.abs(s);
    out.x = x + nx * sgn * need;
    out.y = y + ny * sgn * need;
    out.s = s;
    return need > 0;
  }
  var SCH_OUT = { x: 0, y: 0, s: 0 };

  NA.Bosses.define('schism', {
    name: 'Schism', color: COL.magenta, hp: 720, introTime: 2.0, camZoom: 0.55,

    intro: function (b, t) {
      // the rule before the boss touches you: a white seam opens across the ring
      var k = M.clamp01(t / 2.0);
      var a = b.data.axis === undefined ? (b.data.axis = b.angle + M.HALFPI, b.angle + M.HALFPI) : b.data.axis;
      var rr = NA.Arena.radius * 1.02 * k;
      var ux = Math.cos(a), uy = Math.sin(a);
      R.line(L.FLOOR, NA.Arena.cx - ux * rr, NA.Arena.cy - uy * rr,
        NA.Arena.cx + ux * rr, NA.Arena.cy + uy * rr, 8 + 40 * k, 1, 1, 1, 0.35 * k);
      R.line(L.VEIL, NA.Arena.cx - ux * rr, NA.Arena.cy - uy * rr,
        NA.Arena.cx + ux * rr, NA.Arena.cy + uy * rr, 3, 1, 1, 1, 0.9 * k);
      if (k > 0.9 && !b.data._punch) { b.data._punch = 1; NA.Cam.addTrauma(0.3); NA.FX.chroma(2.5, 200); sfx('wall', b.x, b.y); }
      return false;
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (d.axis === undefined) d.axis = b.angle + M.HALFPI;
      d.axis2 = d.axis + M.HALFPI;
      d.gap = 74; d.gapT = 0;
      d.quad = i >= 1;
      d.slam = i >= 2;
      d.spawnCd = 1.2;
      d.threshold = i === 0 ? 14 : i === 1 ? 18 : 22;
      d.floodT = 0; d.floodWarn = 0; d.crossT = 0; d.dryCd = 0;
      d.slamT = 0; d.slamWarn = 0; d.merge = 0;
      d.radius = 60;
      d.far = 0; d.farX = 0; d.farY = 0;
      d.filler = pickEnemy('husk', 'moteling', 'larva', 'mote');
      d.problem = pickEnemy('spitter', 'lancer', 'mote');
      if (i > 0) NA.FX.flash(0.22, 130);
    },

    hitTest: function (b, x, y, r) {
      var dx = b.x - x, dy = b.y - y, rr = b.data.radius + r;
      return dx * dx + dy * dy <= rr * rr ? 1 : 0;
    },

    phases: [
      { minDuration: 14, update: function (b, dt) { schismTick(b, dt); } },
      { minDuration: 15, update: function (b, dt) { schismTick(b, dt); } },
      { minDuration: 16, update: function (b, dt) { schismTick(b, dt); } }
    ],

    onDeath: function (b) {
      // the gap fills with white and the halves slam together, pancaking it
      var d = b.data;
      var E = NA.Enemies, i;
      for (i = E.n - 1; i >= 0; i--) {
        if (Math.abs(schismSide(b, E.x[i], E.y[i], 0)) < d.gap + 40 ||
          (d.quad && Math.abs(schismSide(b, E.x[i], E.y[i], 1)) < d.gap + 40)) {
          NA.Particles.frag(E.x[i], E.y[i], 0, 0, 0, 26, 0.5, 1, 1, 1);
          E.kill(i, false);
        }
      }
      var ux = Math.cos(d.axis), uy = Math.sin(d.axis);
      var rr = NA.Arena.radius;
      NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, 20, rr * 1.15, 0.8, 8, 1, 1, 1, 1);
      for (i = -6; i <= 6; i++) {
        NA.Particles.frag(NA.Arena.cx + ux * i * rr / 7, NA.Arena.cy + uy * i * rr / 7,
          -uy * 260, ux * 260, d.axis, 60, 0.7, 1, 1, 1);
      }
      NA.FX.flash(0.5, 260); NA.FX.trauma(0.9); NA.Arena.ripple(NA.Arena.cx, NA.Arena.cy, 2.5, 1, 1, 1);
      d.merge = 1;
    },

    render: function (b) { schismRender(b); }
  });

  function schismTick(b, dt) {
    var d = b.data, P = NA.Player, E = NA.Enemies, i;
    d.gapT += dt;

    // the boss rides the seam so both halves can always reach it
    var ride = Math.sin(b.t * 0.55) * NA.Arena.radius * 0.62;
    b.x = NA.Arena.cx + Math.cos(d.axis) * ride;
    b.y = NA.Arena.cy + Math.sin(d.axis) * ride;

    // ---- slam-merge (phase 3): a 1.2 s telegraph, then the gap closes
    var gapNow = d.gap;
    if (d.slam) {
      d.slamT += dt;
      if (d.slamT > 6) { d.slamT = 0; d.slamWarn = 0.0001; sfx('telegraph', b.x, b.y); }
      if (d.slamWarn > 0) {
        d.slamWarn += dt;
        var wk = d.slamWarn / 1.55;
        if (wk < 0.78) {
          // the doomed band breathes orange, snapping to red at lock
          var tc = NA.Enemies.telegraphColor(d.slamWarn, 1.2);
          var tp = NA.Enemies.telegraphPulse(d.slamWarn, 1.2);
          schismBand(b, 0, d.gap, tc[0], tc[1], tc[2], 0.35 * tp, L.VEIL);
          if (d.quad) schismBand(b, 1, d.gap, tc[0], tc[1], tc[2], 0.35 * tp, L.VEIL);
        } else {
          gapNow = d.gap * M.clamp01((1.05 - wk) / 0.27);
          if (!d.slammed) {
            d.slammed = 1;
            schismPancake(b, d.gap);
          }
        }
        if (d.slamWarn > 1.75) { d.slamWarn = 0; d.slammed = 0; }
      }
    }
    d.gapNow = gapNow;

    // ---- spawning on BOTH sides
    d.spawnCd -= dt;
    if (d.spawnCd <= 0 && E.n < 170) {
      d.spawnCd = d.quad ? 1.5 : 1.15;
      var cells = d.quad ? 4 : 2;
      for (var c = 0; c < cells; c++) {
        var tries = 0, sx = 0, sy = 0, ok = false;
        while (tries++ < 8) {
          var a = NA.RNG.f() * M.TAU;
          var rad = NA.Arena.radiusAt(a) * (0.55 + NA.RNG.f() * 0.38);
          sx = NA.Arena.cx + Math.cos(a) * rad; sy = NA.Arena.cy + Math.sin(a) * rad;
          if (schismCell(b, sx, sy) === c && Math.abs(schismSide(b, sx, sy, 0)) > d.gap + 30) { ok = true; break; }
        }
        if (!ok) continue;
        spawnAt(NA.RNG.chance(0.22) ? d.problem : d.filler, sx, sy);
      }
    }

    // ---- the two halves: confinement, reduced tick on the far side, tally
    var pCell = P.alive ? schismCell(b, P.x, P.y) : 0;
    var slow = (NA.Time.frames % 3) !== 0;
    var far = 0, fx = 0, fy = 0;
    for (i = 0; i < E.n; i++) {
      var ex = E.x[i], ey = E.y[i];
      // never let anything sit inside the white gap
      if (schismPushOut(b, 0, ex, ey, gapNow + E.size[i], SCH_OUT)) {
        E.x[i] = SCH_OUT.x; E.y[i] = SCH_OUT.y; ex = SCH_OUT.x; ey = SCH_OUT.y;
      }
      if (d.quad && schismPushOut(b, 1, ex, ey, gapNow + E.size[i], SCH_OUT)) {
        E.x[i] = SCH_OUT.x; E.y[i] = SCH_OUT.y; ex = SCH_OUT.x; ey = SCH_OUT.y;
      }
      var cell = schismCell(b, ex, ey);
      if (cell !== pCell) {
        far++; fx += ex; fy += ey;
        if (d.floodT <= 0) {
          // the unattended half simulates at a reduced tick rate
          if (slow) { E.vx[i] *= 0.18; E.vy[i] *= 0.18; }
        } else {
          // the flood: they cross, hard and telegraphed
          var fa = Math.atan2(P.y - ey, P.x - ex);
          E.vx[i] = Math.cos(fa) * 340; E.vy[i] = Math.sin(fa) * 340;
        }
      }
    }
    d.far = far;
    if (far > 0) { d.farX = fx / far; d.farY = fy / far; }

    // ---- the threshold, drawn as a growing ring, then the flood
    if (d.floodT > 0) { d.floodT -= dt; }
    else if (d.floodWarn > 0) {
      d.floodWarn += dt;
      if (d.floodWarn > 1.1) { d.floodWarn = 0; d.floodT = 2.6; NA.FX.flash(0.22, 120); NA.FX.trauma(0.4); sfx('lock', d.farX, d.farY); }
    } else if (far >= d.threshold) {
      d.floodWarn = 0.0001;
      sfx('telegraph', d.farX, d.farY);
    }

    // ---- the player and the gap: crossing costs the whole bar
    if (d.dryCd > 0) d.dryCd -= dt;
    if (d.crossT > 0) d.crossT -= dt;
    if (P.alive && d.crossT <= 0) {
      schismGate(b, 0, gapNow, dt);
      if (d.quad) schismGate(b, 1, gapNow, dt);
    }
  }

  function schismGate(b, which, gapNow, dt) {
    var d = b.data, P = NA.Player;
    var nx = which ? -Math.sin(d.axis2) : -Math.sin(d.axis);
    var ny = which ? Math.cos(d.axis2) : Math.cos(d.axis);
    var s = (P.x - NA.Arena.cx) * nx + (P.y - NA.Arena.cy) * ny;
    var half = gapNow + C.SHIP_R;
    if (Math.abs(s) >= half) return;
    var sgn = s >= 0 ? 1 : -1;
    // dashing into the gap edge with a full bar buys the crossing
    if (P.dashT > 0 && P.mana >= P.manaMax * 0.55) {
      P.mana = 0;
      d.crossT = 0.45;
      NA.FX.flash(0.18, 90); NA.FX.chroma(2.5, 160);
      NA.Particles.ring(P.x, P.y, 10, 150, 0.4, 3, 1, 1, 1, 0.9);
      NA.Arena.ripple(P.x, P.y, 1.4, 1, 1, 1);
      sfx('dash', P.x, P.y);
      return;
    }
    // otherwise the seam is a wall
    P.x += nx * sgn * (half - Math.abs(s));
    P.y += ny * sgn * (half - Math.abs(s));
    var vn = P.vx * nx + P.vy * ny;
    if (vn * sgn < 0) { P.vx -= nx * vn; P.vy -= ny * vn; }
    if (d.dryCd <= 0) { d.dryCd = 0.5; sfx('manaDry', P.x, P.y); NA.Arena.ripple(P.x, P.y, 0.5, 1, 1, 1); }
  }

  function schismPancake(b, half) {
    var d = b.data, E = NA.Enemies, P = NA.Player, i;
    for (i = E.n - 1; i >= 0; i--) {
      if (Math.abs(schismSide(b, E.x[i], E.y[i], 0)) < half ||
        (d.quad && Math.abs(schismSide(b, E.x[i], E.y[i], 1)) < half)) {
        NA.Particles.frag(E.x[i], E.y[i], 0, 0, d.axis, 22, 0.35, 1, 1, 1);
        E.kill(i, false);
      }
    }
    if (P.alive && (Math.abs(schismSide(b, P.x, P.y, 0)) < half ||
      (d.quad && Math.abs(schismSide(b, P.x, P.y, 1)) < half))) {
      P.damage(1, NA.Arena.cx, NA.Arena.cy);
    }
    NA.FX.flash(0.3, 140); NA.FX.trauma(0.6);
    sfx('explode', b.x, b.y);
  }

  function schismBand(b, which, half, r, g, bl, a, layer) {
    var d = b.data;
    var ang = which ? d.axis2 : d.axis;
    var rr = NA.Arena.radius * 1.02;
    var ux = Math.cos(ang), uy = Math.sin(ang);
    R.line(layer, NA.Arena.cx - ux * rr, NA.Arena.cy - uy * rr,
      NA.Arena.cx + ux * rr, NA.Arena.cy + uy * rr, half * 2, r, g, bl, a);
  }

  function schismRender(b) {
    var d = b.data;
    if (d.axis === undefined) return;
    var gapNow = d.gapNow === undefined ? d.gap : d.gapNow;
    // the white gap between the half-arenas
    schismBand(b, 0, gapNow, 1, 1, 1, 0.16, L.FLOOR);
    schismEdges(b, 0, gapNow);
    if (d.quad) { schismBand(b, 1, gapNow, 1, 1, 1, 0.16, L.FLOOR); schismEdges(b, 1, gapNow); }

    // the accumulation ring on the unattended side
    if (d.far > 0) {
      var k = M.clamp01(d.far / Math.max(1, d.threshold));
      var warn = d.floodWarn > 0;
      var cr = warn ? 1 : 1, cg = warn ? 0.18 : 0.541, cb = warn ? 0.30 : 0.0;
      var puls = 0.55 + 0.45 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
      R.ring(warn ? L.VEIL : L.FLOOR, d.farX, d.farY, 40 + k * 260, 3 + k * 4, cr, cg, cb, (0.25 + 0.55 * k) * puls);
      R.dot(L.FLOOR, d.farX, d.farY, 6, cr, cg, cb, 0.7 * puls);
      // …and on the rim, so it is never off-screen
      var fa = Math.atan2(d.farY - NA.Arena.cy, d.farX - NA.Arena.cx);
      R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius + 22, fa - 0.5 * k, fa + 0.5 * k, 6,
        cr, cg, cb, (0.3 + 0.6 * k) * puls);
    }

    // the body: a twin blade riding the seam
    var f = b.flash > 0 ? 1 : 0;
    var col = COL.magenta;
    var cr2 = f ? 1 : col[0], cg2 = f ? 1 : col[1], cb2 = f ? 1 : col[2];
    R.poly(L.ENEMIES, b.x, b.y, d.radius, 4, d.axis, 4, cr2, cg2, cb2, 0.95);
    R.poly(L.ENEMIES, b.x, b.y, d.radius * 0.58, 4, d.axis + M.HALFPI * 0.5, 3, 1, 0.6, 0.85, 0.75);
    R.dot(L.ENEMIES, b.x, b.y, 12, 1, 1, 1, 0.9);
    R.light(b.x, b.y, 260, 0.4);
  }

  function schismEdges(b, which, half) {
    var d = b.data;
    var ang = which ? d.axis2 : d.axis;
    var rr = NA.Arena.radius * 1.02;
    var ux = Math.cos(ang), uy = Math.sin(ang);
    var nx = -uy, ny = ux;
    for (var s = -1; s <= 1; s += 2) {
      R.line(L.MEMBRANE, NA.Arena.cx - ux * rr + nx * s * half, NA.Arena.cy - uy * rr + ny * s * half,
        NA.Arena.cx + ux * rr + nx * s * half, NA.Arena.cy + uy * rr + ny * s * half,
        2.6, 1, 1, 1, 0.8);
    }
  }

  /* ================================================================= 22 SIREN
   * Every 10 s a 2 s song damps your input toward it and converges the swarm.
   * Enemies that arrive fuse into armour rings. It is vulnerable only when the
   * song is interrupted by a dash inside the window that opens with it — a
   * 0.9 s orange -> red beat counts it in, a red ring pulse marks it open —
   * which stuns it 3 s. Phase 2 the song bends your fire toward it too;
   * phase 3 the song never stops and each verse re-opens the window. */

  /* The dash window. 0.45 s is the base — long enough to be a reaction, short
   * enough to still be the skill of the fight. Two safety valves stop the
   * fight from ever deadlocking, and neither of them takes anything away:
   *   - every 4th song is a "chorus": a 0.8 s window, telegraphed the same way;
   *   - after SIREN_MERCY_AT seconds with no landed dash the window widens
   *     progressively (up to 2.5x) until one lands, then snaps back.
   * The lead-in is SIREN_LEAD seconds of orange -> red beat above everything,
   * so the window is never a surprise (GAME_PLAN §7/§10: telegraph >= 0.4 s). */
  var SIREN_WINDOW = 0.45;
  var SIREN_CHORUS = 0.80;
  var SIREN_LEAD = 0.90;
  var SIREN_MERCY_AT = 25;
  var SIREN_MERCY_SPAN = 20;
  var SIREN_MERCY_MAX = 1.5;

  /* how long the next window stays open, given the song count and the drought */
  function sirenWindowLen(d) {
    var w = (d.songIndex % 4) === 3 ? SIREN_CHORUS : SIREN_WINDOW;
    if (d.sinceHit > SIREN_MERCY_AT) {
      w *= 1 + M.clamp01((d.sinceHit - SIREN_MERCY_AT) / SIREN_MERCY_SPAN) * SIREN_MERCY_MAX;
    }
    return w;
  }

  /* Seconds until the next dash window opens, from wherever the song is now.
   * Published on the boss instance as a read-only hint (b.dashHintT /
   * b.dashWindowOpen) so the ?bot=1 autopilot can play the fight; the game
   * itself never reads it, it reads d.hintT for the lead-in beat. */
  function sirenHint(b) {
    var d = b.data;
    if (d.window > 0) { d.hintT = 0; b.dashHintT = 0; b.dashWindowOpen = true; return; }
    var t;
    if (d.stun > 0) t = d.stun + 2.0;                 // stun ends -> songCd 2.0
    else if (!d.song) t = d.songCd;
    else if (d.always) t = d.verseCd;
    else t = (2.0 - d.songT) + 8.0;                   // song out, then songCd 8
    if (!(t >= 0)) t = 0;
    d.hintT = t; b.dashHintT = t; b.dashWindowOpen = false;
  }

  NA.Bosses.define('siren', {
    name: 'Siren', color: TEAL, hp: 760, introTime: 2.0, camZoom: 0.78,

    intro: function (b, t) {
      b.x = NA.Arena.cx; b.y = NA.Arena.cy;
      introRim(b, t, 2.0, TEAL, 4);
      // the rule, shown once: a teal ring pulses out and the rim leans in
      var k = M.clamp01(t / 2.0);
      R.ring(L.VEIL, b.x, b.y, 60 + 420 * ((t * 0.7) % 1), 3, TEAL[0], TEAL[1], TEAL[2], 0.5 * (1 - ((t * 0.7) % 1)));
      return false;
    },

    onPhase: function (b, i) {
      var d = b.data;
      d.radius = 54;
      d.armor = d.armor || 0;
      d.songCd = i === 2 ? 0.4 : 3.0;
      d.song = 0; d.songT = 0; d.window = 0; d.stun = 0; d.absorb = 0;
      d.bend = i >= 1; d.always = i >= 2;
      d.verseCd = 0;
      d.songIndex = d.songIndex || 0;
      d.sinceHit = d.sinceHit || 0;
      d.windowMax = SIREN_WINDOW; d.leadFired = 0;
      d.hintT = d.songCd;
      b.dashHintT = d.songCd; b.dashWindowOpen = false;
      d.wander = NA.RNG.f() * M.TAU;
      if (i > 0) NA.FX.chroma(2.5, 200);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data;
      var dx = b.x - x, dy = b.y - y;
      var rr = d.radius + 8 + d.armor * 3.2 + r;
      if (dx * dx + dy * dy > rr * rr) return 0;
      if (d.stun > 0) {
        // the interrupted song: everything lands, and the armour comes off
        if (d.armor > 0) { d.armor = Math.max(0, d.armor - 0.5); }
        return 1;
      }
      // armour absorbs; enough absorbed shots pop one ring off, so shooting is
      // never wasted — but the kill still needs the dash
      d.absorb++;
      if (d.absorb >= 14 && d.armor > 0) {
        d.absorb = 0; d.armor--;
        NA.Particles.ring(b.x, b.y, d.radius, d.radius + 40, 0.35, 3, TEAL[0], TEAL[1], TEAL[2], 0.8);
        sfx('hitEnemy', b.x, b.y);
      }
      return 2;
    },

    phases: [
      { minDuration: 14, update: function (b, dt) { sirenTick(b, dt); } },
      { minDuration: 15, update: function (b, dt) { sirenTick(b, dt); } },
      { minDuration: 16, update: function (b, dt) { sirenTick(b, dt); } }
    ],

    onDeath: function (b) {
      // a shockwave pins every enemy to the walls for 5 s
      var E = NA.Enemies, i;
      for (i = 0; i < E.n; i++) {
        var a = Math.atan2(E.y[i] - NA.Arena.cy, E.x[i] - NA.Arena.cx);
        var rr = NA.Arena.radiusAt(a) - E.size[i] - 2;
        E.x[i] = NA.Arena.cx + Math.cos(a) * rr;
        E.y[i] = NA.Arena.cy + Math.sin(a) * rr;
        E.vx[i] = 0; E.vy[i] = 0;
        NA.Arena.ripple(E.x[i], E.y[i], 0.6, TEAL[0], TEAL[1], TEAL[2]);
      }
      NA.Particles.ring(b.x, b.y, 20, NA.Arena.radius, 0.9, 9, TEAL[0], TEAL[1], TEAL[2], 1);
      NA.FX.flash(0.4, 220); NA.FX.trauma(0.8);
      var pin = 5;
      addTicker(function (dt) {
        pin -= dt;
        var E2 = NA.Enemies;
        for (var j = 0; j < E2.n; j++) {
          var ja = Math.atan2(E2.y[j] - NA.Arena.cy, E2.x[j] - NA.Arena.cx);
          var jr = NA.Arena.radiusAt(ja) - E2.size[j] - 2;
          E2.x[j] = NA.Arena.cx + Math.cos(ja) * jr;
          E2.y[j] = NA.Arena.cy + Math.sin(ja) * jr;
          E2.vx[j] = 0; E2.vy[j] = 0;
        }
        return pin > 0;
      }, function () {
        var E2 = NA.Enemies, a = 0.5 * M.clamp01(pin);
        for (var j = 0; j < E2.n; j++) {
          var ja = Math.atan2(E2.y[j] - NA.Arena.cy, E2.x[j] - NA.Arena.cx);
          var jr = NA.Arena.radiusAt(ja);
          R.line(L.FLOOR, E2.x[j], E2.y[j],
            NA.Arena.cx + Math.cos(ja) * (jr + 26), NA.Arena.cy + Math.sin(ja) * (jr + 26),
            2, TEAL[0], TEAL[1], TEAL[2], a);
        }
      });
    },

    render: function (b) { sirenRender(b); }
  });

  function sirenStartSong(b) {
    var d = b.data;
    d.songIndex++;
    d.song = 1; d.songT = 0; d.leadFired = 0;
    d.windowMax = sirenWindowLen(d); d.window = d.windowMax;
    NA.Particles.ring(b.x, b.y, 30, 200, 0.3, 5, TEAL[0], TEAL[1], TEAL[2], 1);
    // the window itself: a white shock ring off the body, so "now" is unmissable
    NA.Particles.ring(b.x, b.y, 84, 150, 0.22, 4, COL.gold[0], COL.gold[1], COL.gold[2], 0.95);
    NA.FX.chroma(1.2, 120);
    sfx('charge', b.x, b.y);
    sfx('lock', b.x, b.y, { vol: 0.35 });
  }

  function sirenTick(b, dt) {
    var d = b.data, P = NA.Player, E = NA.Enemies, i;

    d.sinceHit += dt;                        // drought clock for the mercy widen
    sirenHint(b);                            // read-only hints for the autopilot
    // the lead-in counts itself in once, in sound as well as in light
    if (d.window <= 0 && d.stun <= 0 && d.hintT > 0 && d.hintT < SIREN_LEAD) {
      if (!d.leadFired) { d.leadFired = 1; sfx('telegraph', b.x, b.y, { vol: 0.55 }); }
    } else if (d.hintT >= SIREN_LEAD) d.leadFired = 0;

    // it drifts slowly; it is never the thing that kills you
    d.wander += dt * 0.35;
    var wr = NA.Arena.radius * 0.34;
    b.x = M.smooth(b.x, NA.Arena.cx + Math.cos(d.wander) * wr, 1.2, dt);
    b.y = M.smooth(b.y, NA.Arena.cy + Math.sin(d.wander * 0.8) * wr, 1.2, dt);

    if (d.stun > 0) {
      d.stun -= dt;
      if (d.stun <= 0) { d.songCd = 2.0; }
      return;                                  // stunned: no song, wide open
    }

    if (!d.song) {
      d.songCd -= dt;
      if (d.songCd <= 0) sirenStartSong(b);
      return;
    }

    // ---- the song
    d.songT += dt;
    if (d.window > 0) {
      d.window -= dt;
      // interrupted on the first frames by a dash: stunned for 3 s
      if (P.dashT > 0 || NA.Input.pressed('dash')) {
        d.window = 0; d.song = 0; d.stun = 3;
        d.armor = 0; d.absorb = 0; d.sinceHit = 0;
        b.dashWindowOpen = false;
        NA.Particles.ring(b.x, b.y, 20, 260, 0.5, 6, 1, 1, 1, 1);
        NA.FX.hitStop(90); NA.FX.chroma(3, 260); NA.FX.trauma(0.5);
        NA.Time.slowmo(0.4, 500);
        sfx('lock', b.x, b.y);
        return;
      }
    }

    var songLen = d.always ? 1e9 : 2.0;
    if (!d.always && d.songT >= songLen) {
      d.song = 0; d.songCd = 10 - 2.0;
      return;
    }
    // phase 3: the song never stops, but each verse re-opens the dash window
    if (d.always) {
      d.verseCd -= dt;
      if (d.verseCd <= 0) {
        d.verseCd = 4.0; d.songIndex++; d.leadFired = 0;
        d.windowMax = sirenWindowLen(d); d.window = d.windowMax;
        NA.Particles.ring(b.x, b.y, 24, 180, 0.28, 4, TEAL[0], TEAL[1], TEAL[2], 0.9);
        NA.Particles.ring(b.x, b.y, 84, 150, 0.22, 4, COL.gold[0], COL.gold[1], COL.gold[2], 0.95);
        NA.FX.chroma(1.2, 120);
        sfx('charge', b.x, b.y); sfx('lock', b.x, b.y, { vol: 0.35 });
      }
    }

    // ---- it damps your input toward it (a dash is always the way out)
    if (P.alive && P.dashT <= 0) {
      var dx = b.x - P.x, dy = b.y - P.y;
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      var pull = d.always ? 620 : 520;
      P.vx += dx / l * pull * dt;
      P.vy += dy / l * pull * dt;
      // damp the component pointing away from the song
      var vn = P.vx * (-dx / l) + P.vy * (-dy / l);
      if (vn > 0) { P.vx -= (-dx / l) * vn * 1.6 * dt; P.vy -= (-dy / l) * vn * 1.6 * dt; }
    }

    // ---- the swarm converges, and arrivals fuse into armour
    for (i = E.n - 1; i >= 0; i--) {
      var ex = b.x - E.x[i], ey = b.y - E.y[i];
      var d2 = ex * ex + ey * ey;
      if (d2 < 70 * 70) {
        if (d.armor < 22) d.armor++;
        NA.Particles.burst(E.x[i], E.y[i], 4, 160, 0.25, TEAL[0], TEAL[1], TEAL[2], 1);
        E.kill(i, false);
        sfx('hitEnemy', b.x, b.y, { vol: 0.2 });
        continue;
      }
      var el = Math.sqrt(d2) || 1;
      E.vx[i] += ex / el * 260 * dt;
      E.vy[i] += ey / el * 260 * dt;
    }

    // ---- phase 2+: the song bends your fire toward it as well
    if (d.bend) {
      var BP = NA.Bullets.P;
      var n = Math.min(BP.n, 420);
      for (i = 0; i < n; i++) {
        var bx = b.x - BP.x[i], by = b.y - BP.y[i];
        var bl = Math.sqrt(bx * bx + by * by) || 1;
        var sp = Math.sqrt(BP.vx[i] * BP.vx[i] + BP.vy[i] * BP.vy[i]) || 1;
        BP.vx[i] = M.smooth(BP.vx[i], bx / bl * sp, 1.6, dt);
        BP.vy[i] = M.smooth(BP.vy[i], by / bl * sp, 1.6, dt);
      }
    }
  }

  function sirenRender(b) {
    var d = b.data;
    var f = b.flash > 0 ? 1 : 0;
    var col = d.stun > 0 ? COL.gold : TEAL;
    var cr = f ? 1 : col[0], cg = f ? 1 : col[1], cb = f ? 1 : col[2];

    // the body: a diamond with a slow inner rotor
    R.poly(L.ENEMIES, b.x, b.y, d.radius, 4, b.t * 0.5, 4, cr, cg, cb, 0.95);
    R.poly(L.ENEMIES, b.x, b.y, d.radius * 0.55, 4, -b.t * 0.8, 2.5, 1, 1, 1, 0.55);
    R.dot(L.ENEMIES, b.x, b.y, 9, 1, 1, 1, 0.9);

    // the armour rings, one per fused arrival
    for (var i = 0; i < d.armor; i++) {
      R.ring(L.ENEMIES, b.x, b.y, d.radius + 12 + i * 3.2, 1.6, col[0], col[1], col[2],
        0.55 - i * 0.012);
    }

    // the song
    if (d.song) {
      var k = (d.songT * 1.4) % 1;
      R.ring(L.VEIL, b.x, b.y, 60 + k * NA.Arena.radius * 0.9, 3, col[0], col[1], col[2], 0.45 * (1 - k));
      var k2 = ((d.songT * 1.4) + 0.5) % 1;
      R.ring(L.VEIL, b.x, b.y, 60 + k2 * NA.Arena.radius * 0.9, 2, col[0], col[1], col[2], 0.3 * (1 - k2));
      R.softRing(L.VEIL, b.x, b.y, 130, col[0], col[1], col[2], 0.16);
    }
    /* the lead-in: for SIREN_LEAD seconds before the window, a beat collapses
     * onto the body and runs orange -> red at the lock, drawn above everything.
     * Three ticks land inside it, so the dash is a read, not a reflex. */
    var hint = d.hintT || 0;
    if (d.window <= 0 && d.stun <= 0 && hint > 0 && hint < SIREN_LEAD) {
      var lk = 1 - hint / SIREN_LEAD;                       // 0 far -> 1 at lock
      var lr = COL.orange[0] + (COL.red[0] - COL.orange[0]) * lk;
      var lg = COL.orange[1] + (COL.red[1] - COL.orange[1]) * lk;
      var lb = COL.orange[2] + (COL.red[2] - COL.orange[2]) * lk;
      // the collapsing beat ring
      R.ring(L.VEIL, b.x, b.y, d.radius + 30 + (1 - lk) * 190, 2 + 4 * lk, lr, lg, lb, 0.35 + 0.6 * lk);
      // three metronome ticks, one every third of the lead-in
      for (var t3 = 0; t3 < 3; t3++) {
        var tk = (lk * 3) - t3;
        if (tk < 0 || tk > 1) continue;
        R.ring(L.VEIL, b.x, b.y, d.radius + 16 + (1 - tk) * 70, 2.4, lr, lg, lb, 0.55 * (1 - tk));
      }
      // and a matching cuff on the ship, so the read works with the eyes on it
      R.ring(L.VEIL, NA.Player.x, NA.Player.y, 34 + (1 - lk) * 26, 2 + 2 * lk, lr, lg, lb, 0.25 + 0.55 * lk);
    }

    // the window itself: a red lock pulse on the body, a gold "now" cuff on the ship
    if (d.window > 0) {
      var w = d.window / (d.windowMax || SIREN_WINDOW);
      var pulse = 0.7 + 0.3 * Math.sin(NA.Time.t * 36);
      var G = COL.gold;
      R.ring(L.VEIL, b.x, b.y, d.radius + 18, 6 * w + 2.5, COL.red[0], COL.red[1], COL.red[2], 0.95 * pulse);
      R.ring(L.VEIL, b.x, b.y, 90 + (1 - w) * 60, 8 * w + 2, TEAL[0], TEAL[1], TEAL[2], 0.95);
      R.ring(L.VEIL, b.x, b.y, d.radius + 40 + (1 - w) * 120, 3, G[0], G[1], G[2], 0.7 * w);
      R.softRing(L.VEIL, b.x, b.y, 150, G[0], G[1], G[2], 0.16 * w);
      R.ring(L.VEIL, NA.Player.x, NA.Player.y, 46, 3.5, G[0], G[1], G[2], 0.85 * w);
    }
    if (d.stun > 0) {
      R.ring(L.VEIL, b.x, b.y, d.radius + 26, 3, COL.gold[0], COL.gold[1], COL.gold[2],
        0.5 + 0.4 * Math.sin(NA.Time.t * 14));
    }
    R.light(b.x, b.y, 300, 0.45);
  }

  /* =========================================================== 23 PROBABILITY
   * A tumbling die whose face-up number IS the arena rule. Shots push it to
   * tumble, which rerolls. Phase 2 adds a second die and the rules combine.
   * Phase 3 cracks a 7 onto it: every rule at once for 7 s, and then it is
   * vulnerable everywhere. Death: d20 shards, and the next draft has 5 cards. */

  var PROB_STASH = { count: -1, bulletSpeed: -1, fireRate: -1, damage: -1, explode: -1 };
  function probStash() {
    var s = NA.Player.stats;
    PROB_STASH.count = s.count; PROB_STASH.bulletSpeed = s.bulletSpeed;
    PROB_STASH.fireRate = s.fireRate; PROB_STASH.damage = s.damage;
    PROB_STASH.explode = s.explode;
  }
  function probRestore() {
    var s = NA.Player.stats;
    if (PROB_STASH.count < 0) return;
    s.count = PROB_STASH.count; s.bulletSpeed = PROB_STASH.bulletSpeed;
    s.fireRate = PROB_STASH.fireRate; s.damage = PROB_STASH.damage;
    s.explode = PROB_STASH.explode;
  }

  /* Rule table. Each rule is enter/update/exit and touches only reversible,
   * never-regressive state (buffs are added, nothing the player owns is lost). */
  var PROB_RULES = [
    null,
    { // 1 — one elite at a time
      enter: function (d) { d.eliteCd = 0; },
      update: function (d, b, dt) {
        d.eliteCd -= dt;
        var E = NA.Enemies, alive = 0, i;
        for (i = E.n - 1; i >= 0; i--) if (E.type[i] === d.eliteType) alive++;
        // one at a time: the crowd is trimmed to a single problem
        if (alive === 0 && d.eliteCd <= 0) {
          d.eliteCd = 2.4;
          var a = NA.RNG.f() * M.TAU;
          var rr = NA.Arena.radiusAt(a) * 0.8;
          var ei = spawnAt(d.eliteId, NA.Arena.cx + Math.cos(a) * rr, NA.Arena.cy + Math.sin(a) * rr);
          if (ei >= 0) { NA.Enemies.setMutator(ei, NA.Enemies.MUT.VOLATILE); d.eliteType = NA.Enemies.type[ei]; }
        }
      },
      exit: function (d) { }
    },
    { // 2 — doubled shots at half speed
      enter: function (d) { var s = NA.Player.stats; s.count = Math.max(1, s.count) * 2; s.bulletSpeed *= 0.5; },
      update: function () { },
      exit: function (d) { probRestore(); }
    },
    { // 3 — three walls close in
      enter: function (d) {
        d.walls = d.walls || [];
        d.wallD = NA.Arena.radius * 0.95;
        for (var k = 0; k < 3; k++) {
          var a = d.wallA0 + k * M.TAU / 3;
          var id = NA.Arena.addMirrorWall(0, 0, 0, 0, 1e9, 0);
          var ws = NA.Arena.mirrorWalls;
          d.walls.push({ a: a, id: id, w: ws.length ? ws[ws.length - 1] : null });
        }
      },
      update: function (d, b, dt) {
        // the wall objects are mutated in place: no allocation per frame
        d.wallD = Math.max(NA.Arena.radius * 0.42, d.wallD - 26 * dt);
        for (var k = 0; k < d.walls.length; k++) {
          var e = d.walls[k];
          if (!e.w) continue;
          var a = e.a, cx = NA.Arena.cx + Math.cos(a) * d.wallD, cy = NA.Arena.cy + Math.sin(a) * d.wallD;
          var ux = -Math.sin(a), uy = Math.cos(a), half = NA.Arena.radius * 0.62;
          e.w.x1 = cx - ux * half; e.w.y1 = cy - uy * half;
          e.w.x2 = cx + ux * half; e.w.y2 = cy + uy * half;
        }
      },
      exit: function (d) {
        if (!d.walls) return;
        for (var k = 0; k < d.walls.length; k++) if (d.walls[k].id) NA.Arena.removeMirrorWall(d.walls[k].id);
        d.walls.length = 0;
      }
    },
    { // 4 — slow-mo
      enter: function (d) { NA.Time.setTimeScale(0.6, 260); },
      update: function () { },
      exit: function (d) { NA.Time.setTimeScale(1, 260); }
    },
    { // 5 — five clones of you, firing randomly
      enter: function (d) {
        if (!d.clones) {
          d.clones = [];
          for (var k = 0; k < 5; k++) d.clones.push({ x: 0, y: 0, a: 0, cd: 0.4 + k * 0.17 });
        }
        d.clonesOn = 1;
      },
      update: function (d, b, dt) {
        var P = NA.Player;
        for (var k = 0; k < 5; k++) {
          var c = d.clones[k];
          var ang = NA.Time.t * 0.55 + k * (M.TAU / 5);
          var tx = P.x + Math.cos(ang) * 250, ty = P.y + Math.sin(ang) * 250;
          c.x = M.smooth(c.x || tx, tx, 3, dt); c.y = M.smooth(c.y || ty, ty, 3, dt);
          c.cd -= dt;
          if (c.cd <= 0) {
            c.cd = 0.95;
            c.a = NA.RNG.f() * M.TAU;
            NA.Bullets.fireEnemy(c.x, c.y, Math.cos(c.a) * 380, Math.sin(c.a) * 380,
              { size: 7, life: 3.2, color: COL.violet });
            sfx('shot', c.x, c.y, { vol: 0.25 });
          }
        }
      },
      exit: function (d) { d.clonesOn = 0; }
    },
    { // 6 — sixfold upgrade mods, then normal
      enter: function (d) {
        var s = NA.Player.stats;
        s.fireRate *= 2.2; s.damage *= 2.6; s.count = Math.max(1, s.count) + 2;
        s.explode = Math.max(s.explode, 70);
        d.giftT = 6;
        sfx('manaFull', NA.Player.x, NA.Player.y);
      },
      update: function (d, b, dt) { d.giftT -= dt; if (d.giftT <= 0) probReroll(b, 0, true); },
      exit: function (d) { probRestore(); }
    }
  ];

  function probApply(b, slot, face) {
    var d = b.data;
    var st = slot ? d.s1 : d.s0;
    if (st.face) { var old = PROB_RULES[st.face]; if (old && old.exit) old.exit(st); }
    st.face = face;
    // stash the untouched stats only when the other slot is holding nothing
    var other = slot ? d.s0 : d.s1;
    if (!other.face) probStash();
    var rule = PROB_RULES[face];
    if (rule && rule.enter) rule.enter(st, b);
  }

  function probClear(b) {
    var d = b.data;
    var slots = [d.s0, d.s1];
    for (var i = 0; i < slots.length; i++) {
      var st = slots[i];
      if (st && st.face) { var rule = PROB_RULES[st.face]; if (rule && rule.exit) rule.exit(st); st.face = 0; }
    }
    probRestore();
    NA.Time.setTimeScale(1, 200);
  }

  function probReroll(b, slot, silent) {
    var d = b.data;
    var die = slot ? d.d1 : d.d0;
    if (!die.on) return;
    // a shot pushes it, but a gatling cannot hold it in permanent tumble
    if (die.pushCd > 0 && !silent) return;
    die.pushCd = 0.9;
    die.tumble = 0.55;
    die.face = 0;
    var st = slot ? d.s1 : d.s0;
    if (st.face) { var rule = PROB_RULES[st.face]; if (rule && rule.exit) rule.exit(st); st.face = 0; }
    if (!silent) sfx('uiTick', die.x, die.y);
  }

  NA.Bosses.define('probability', {
    name: 'Probability', color: COL.gold, hp: 780, introTime: 2.0, camZoom: 0.72,

    intro: function (b, t) {
      b.x = NA.Arena.cx; b.y = NA.Arena.cy - 60;
      introRim(b, t, 2.0, COL.gold, 4);
      // the rule: six pips light one by one on the rim
      var k = M.clamp01(t / 2.0);
      for (var i = 0; i < 6; i++) {
        var a = b.angle + (i - 2.5) * 0.22;
        var rr = NA.Arena.radius + 30;
        R.dot(L.HUD, NA.Arena.cx + Math.cos(a) * rr, NA.Arena.cy + Math.sin(a) * rr, 6,
          COL.gold[0], COL.gold[1], COL.gold[2], i / 6 < k ? 0.9 : 0.15);
      }
      return false;
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (!d.d0) {
        d.d0 = { on: 1, x: NA.Arena.cx - 120, y: NA.Arena.cy, vx: 0, vy: 0, rot: 0, face: 0, tumble: 0.6, faceT: 0 };
        d.d1 = { on: 0, x: NA.Arena.cx + 120, y: NA.Arena.cy, vx: 0, vy: 0, rot: 0, face: 0, tumble: 0.6, faceT: 0 };
        d.s0 = { face: 0, wallA0: 0.4 }; d.s1 = { face: 0, wallA0: 1.7 };
        d.radius = 46;
        d.eliteId = pickEnemy('chargerElite', 'charger', 'lancer', 'spitter');
        d.eliteType = -1;
        d.s0.eliteId = d.s1.eliteId = d.eliteId;
      }
      d.d1.on = i >= 1 ? 1 : 0;
      d.cracked = i >= 2;
      d.crackT = 0; d.open = 0;
      if (d.cracked) { probClear(b); d.crackT = 0; }
      if (i > 0) NA.FX.chroma(2.5, 200);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data;
      // the cracked 7 leaves it vulnerable everywhere for its open window
      if (d.open > 0) return 1;
      var res = 0;
      if (probDieHit(d.d0, x, y, r)) { probReroll(b, 0); res = 1; }
      else if (d.d1.on && probDieHit(d.d1, x, y, r)) { probReroll(b, 1); res = 1; }
      return res;
    },

    phases: [
      { minDuration: 14, update: function (b, dt) { probTick(b, dt); } },
      { minDuration: 15, update: function (b, dt) { probTick(b, dt); } },
      { minDuration: 16, update: function (b, dt) { probTick(b, dt); } }
    ],

    onDeath: function (b) {
      probClear(b);
      var d = b.data;
      // it shatters into d20s
      for (var i = 0; i < 20; i++) {
        var a = i / 20 * M.TAU, sp = 220 + NA.RNG.f() * 340;
        NA.Particles.frag(d.d0.x, d.d0.y, Math.cos(a) * sp, Math.sin(a) * sp, a, 22, 1.0,
          COL.gold[0], COL.gold[1], COL.gold[2]);
        NA.Particles.spawn(d.d0.x, d.d0.y, Math.cos(a) * sp * 0.6, Math.sin(a) * sp * 0.6,
          0.9, 4, COL.gold[0], COL.gold[1], COL.gold[2], 1, 1, 0.5);
      }
      NA.Particles.ring(d.d0.x, d.d0.y, 20, 420, 0.7, 6, COL.gold[0], COL.gold[1], COL.gold[2], 1);
      // …and the next draft deals five cards
      B.flags.nextDraftCards = 5;
      probPatchDraft();
    },

    onEnd: function (b) { probClear(b); },

    render: function (b) { probRender(b); }
  });

  /* NA.Draft only exists once 15_ui.js has loaded, so the wrapper is installed
   * at death time, once. */
  function probPatchDraft() {
    if (!NA.Draft || NA.Draft._na3Patched) return;
    var open = NA.Draft.open;
    if (typeof open !== 'function') return;
    NA.Draft._na3Patched = 1;
    NA.Draft.open = function (count) {
      if (B.flags.nextDraftCards) { count = B.flags.nextDraftCards; B.flags.nextDraftCards = 0; }
      return open.call(NA.Draft, count);
    };
  }

  function probDieHit(die, x, y, r) {
    if (!die.on) return false;
    var dx = die.x - x, dy = die.y - y, rr = 46 + r;
    return dx * dx + dy * dy <= rr * rr;
  }

  function probDieTick(b, die, slot, dt) {
    if (!die.on) return;
    var d = b.data, P = NA.Player;
    if (die.pushCd > 0) die.pushCd -= dt;
    // it tumbles across the floor, holding a stand-off band so it never sits
    // on top of you
    var ang = Math.atan2(P.y - die.y, P.x - die.x);
    var dist = Math.sqrt((P.x - die.x) * (P.x - die.x) + (P.y - die.y) * (P.y - die.y)) || 1;
    var want = 330;
    var radial = M.clamp((dist - want) / want, -1, 1);
    var strafe = Math.sin(NA.Time.t * 0.6 + (slot ? 2.1 : 0)) * 0.6;
    var mx = Math.cos(ang) * radial - Math.sin(ang) * strafe;
    var my = Math.sin(ang) * radial + Math.cos(ang) * strafe;
    var ml = Math.sqrt(mx * mx + my * my) || 1;
    die.vx = M.smooth(die.vx, mx / ml * 120, 1.6, dt);
    die.vy = M.smooth(die.vy, my / ml * 120, 1.6, dt);
    die.x += die.vx * dt; die.y += die.vy * dt;
    var da = Math.atan2(die.y - NA.Arena.cy, die.x - NA.Arena.cx);
    var dr = Math.sqrt((die.x - NA.Arena.cx) * (die.x - NA.Arena.cx) + (die.y - NA.Arena.cy) * (die.y - NA.Arena.cy));
    var lim = NA.Arena.radiusAt(da) - 90;
    if (dr > lim) { die.x = NA.Arena.cx + Math.cos(da) * lim; die.y = NA.Arena.cy + Math.sin(da) * lim; die.vx *= -0.4; die.vy *= -0.4; }

    if (die.tumble > 0) {
      die.tumble -= dt;
      die.rot += dt * 16;
      if (die.tumble <= 0) {
        var face = 1 + NA.RNG.int(6);
        die.face = face; die.faceT = 0;
        probApply(b, slot, face);
        sfx('lock', die.x, die.y);
      }
      return;
    }
    die.rot = M.lerpAngle(die.rot, 0, M.clamp01(dt * 6));
    die.faceT += dt;
    if (die.faceT > 9) probReroll(b, slot);      // faces never outstay their welcome
    var st = slot ? b.data.s1 : b.data.s0;
    var rule = PROB_RULES[st.face];
    if (rule && rule.update) rule.update(st, b, dt);
  }

  function probTick(b, dt) {
    var d = b.data;
    if (d.cracked) {
      // the cracked 7: every rule at once for 7 s, then wide open for 5 s
      d.crackT += dt;
      if (d.open > 0) {
        d.open -= dt;
        if (d.open <= 0) { d.crackT = 0; probCrackEnter(b); }
      } else if (d.crackT >= 7) {
        d.open = 5;
        probClear(b);
        NA.FX.flash(0.25, 160); NA.FX.chroma(3, 260);
        sfx('bossPhase', d.d0.x, d.d0.y);
      } else {
        if (!d.crackOn) probCrackEnter(b);
        // all six rules, driven off the two rule slots plus a light-weight sweep
        var st = d.s0;
        for (var f = 1; f <= 6; f++) {
          var rule = PROB_RULES[f];
          if (rule && rule.update && (f === 1 || f === 3 || f === 5)) rule.update(st, b, dt);
        }
      }
      probDieTick(b, d.d0, 0, dt);
      if (d.d1.on) probDieTick(b, d.d1, 1, dt);
      return;
    }
    probDieTick(b, d.d0, 0, dt);
    if (d.d1.on) probDieTick(b, d.d1, 1, dt);
  }

  function probCrackEnter(b) {
    var d = b.data;
    d.crackOn = 1;
    probStash();
    var st = d.s0;
    st.wallA0 = 0.4;
    // the statistically absurd ones only: walls, clones, the elite
    if (PROB_RULES[1].enter) PROB_RULES[1].enter(st, b);
    if (PROB_RULES[3].enter) PROB_RULES[3].enter(st, b);
    if (PROB_RULES[5].enter) PROB_RULES[5].enter(st, b);
    NA.Time.setTimeScale(0.85, 300);
  }

  var PIPS = [
    null,
    [0, 0],
    [-1, -1, 1, 1],
    [-1, -1, 0, 0, 1, 1],
    [-1, -1, 1, -1, -1, 1, 1, 1],
    [-1, -1, 1, -1, 0, 0, -1, 1, 1, 1],
    [-1, -1, 1, -1, -1, 0, 1, 0, -1, 1, 1, 1]
  ];

  function probDrawDie(die, cracked, flash) {
    if (!die.on) return;
    var col = cracked ? COL.red : COL.gold;
    var cr = flash ? 1 : col[0], cg = flash ? 1 : col[1], cb = flash ? 1 : col[2];
    var s = 46;
    R.poly(L.ENEMIES, die.x, die.y, s, 4, die.rot + M.HALFPI * 0.5, 4, cr, cg, cb, 0.95);
    R.poly(L.ENEMIES, die.x, die.y, s * 0.82, 4, die.rot + M.HALFPI * 0.5, 1.5, 1, 1, 1, 0.3);
    if (die.tumble > 0) {
      R.dot(L.ENEMIES, die.x, die.y, 8, 1, 1, 1, 0.6 + 0.4 * Math.sin(NA.Time.t * 40));
      return;
    }
    var pips = PIPS[die.face];
    if (pips) {
      var c = Math.cos(die.rot), sn = Math.sin(die.rot);
      for (var i = 0; i < pips.length; i += 2) {
        var px = pips[i] * s * 0.44, py = pips[i + 1] * s * 0.44;
        R.dot(L.ENEMIES, die.x + px * c - py * sn, die.y + px * sn + py * c, 6, 1, 1, 1, 0.95);
      }
    }
    if (cracked) {
      // a 7 that should not exist: the crack across the face
      R.line(L.ENEMIES, die.x - s * 0.7, die.y - s * 0.5, die.x + s * 0.2, die.y + s * 0.75, 3, 1, 1, 1, 0.9);
      R.line(L.ENEMIES, die.x + s * 0.2, die.y + s * 0.75, die.x + s * 0.65, die.y - s * 0.2, 2.4, 1, 1, 1, 0.7);
      for (var k = 0; k < 7; k++) {
        var a = k / 7 * M.TAU + NA.Time.t * 0.4;
        R.dot(L.ENEMIES, die.x + Math.cos(a) * s * 0.55, die.y + Math.sin(a) * s * 0.55, 4.5, 1, 1, 1, 0.85);
      }
    }
  }

  function probRender(b) {
    var d = b.data;
    if (!d.d0) return;
    var f = b.flash > 0;
    probDrawDie(d.d0, d.cracked, f);
    probDrawDie(d.d1, d.cracked, f);
    // the rule in play, shown as a ring on the floor under each die
    var slots = [d.s0, d.s1], dice = [d.d0, d.d1];
    for (var i = 0; i < 2; i++) {
      if (!dice[i].on || !slots[i].face) continue;
      R.ring(L.FLOOR, dice[i].x, dice[i].y, 92, 2, COL.gold[0], COL.gold[1], COL.gold[2], 0.35);
    }
    // the five clones
    if (d.s0.clones && (d.s0.face === 5 || (d.cracked && !d.open))) {
      for (var k = 0; k < 5; k++) {
        var c = d.s0.clones[k];
        NA.Ship.render(c.x, c.y, c.a, 0.55, 1.05, COL.violet);
      }
    }
    // wide open: the whole arena is the hitbox
    if (d.open > 0) {
      var pl = 0.4 + 0.35 * Math.sin(NA.Time.t * 8);
      R.ring(L.VEIL, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius - 10, 4, COL.gold[0], COL.gold[1], COL.gold[2], pl);
    }
    R.light(d.d0.x, d.d0.y, 240, 0.4);
  }

  /* ================================================================== 24 PAGE
   * The arena becomes the browser viewport. Page elements are cover. A crimson
   * border with four corner nodes breathes inward. Phase 2 scrolls the page
   * under you; phase 3 shrinks the viewport back with the last node outside the
   * canvas. Kills stain the page (DOM). Death snaps back with a page flash. */

  var CRIMSON = [0.86, 0.10, 0.26];
  var PAGE_STAINS = [];

  function pageStain(x, y) {
    var el = domEl(); if (!el) return;
    try {
      if (typeof document === 'undefined' || !document.createElement) return;
      NA.Cam.worldToScreen(x, y, SCR);
      var node;
      if (PAGE_STAINS.length >= 18) { node = PAGE_STAINS.shift(); }
      else { node = document.createElement('div'); el.appendChild(node); }
      var s = 14 + NA.RNG.f() * 26;
      node.style.cssText = 'position:absolute;pointer-events:none;left:' + (SCR.x - s * 0.5).toFixed(0) +
        'px;top:' + (SCR.y - s * 0.5).toFixed(0) + 'px;width:' + s.toFixed(0) + 'px;height:' + s.toFixed(0) +
        'px;border-radius:50%;background:rgba(220,26,66,0.30);filter:blur(2px);';
      PAGE_STAINS.push(node);
    } catch (e) { dbg('stain: ' + e); }
  }
  function pageStainsClear() {
    try {
      for (var i = 0; i < PAGE_STAINS.length; i++) {
        var n = PAGE_STAINS[i];
        if (n && n.parentNode) n.parentNode.removeChild(n);
      }
    } catch (e) { }
    PAGE_STAINS.length = 0;
  }

  var NODE_WINDOW = 130;      // the hole a live corner node punches in the border

  NA.Bosses.define('page', {
    name: 'Page', color: CRIMSON, hp: 900, introTime: 2.2, camZoom: 0.62,

    intro: function (b, t) {
      b.x = NA.Arena.cx; b.y = NA.Arena.cy;
      var k = M.clamp01(t / 2.2);
      // the camera zooms past the canvas: a crimson rectangle draws itself
      var w = NA.Arena.radius * (1.05 + 0.5 * k), h = NA.Arena.radius * (0.72 + 0.34 * k);
      pageRect(NA.Arena.cx, NA.Arena.cy, w, h, 3, CRIMSON, 0.4 + 0.5 * k, L.VEIL, k);
      if (k > 0.5 && !b.data._vp) {
        b.data._vp = 1;
        if (fwCall('viewportArena', true) === undefined) dbg('page: viewportArena() unavailable, running on canvas');
      }
      if (k > 0.9 && !b.data._punch) { b.data._punch = 1; NA.Cam.addTrauma(0.35); NA.FX.chroma(3, 240); }
      return false;
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (!d.nodes) {
        d.nodes = [];
        for (var k = 0; k < 4; k++) d.nodes.push({ x: 0, y: 0, hp: 1, alive: 1, out: 0 });
        d.rects = []; d.rectCd = 0;
        /* The page has to FIT INSIDE the ring. Its four corner nodes are the
         * only things that take damage, and player bullets pop on the membrane
         * — at 1.5 x 1.02 the corners sat at 1.8 arena radii, so nothing could
         * ever reach them and the fight could not leave phase 1. 0.80 x 0.55
         * puts the corners at 0.97 of the radius: reachable, and the closing
         * border now actually sweeps the play space instead of the void.
         * 0.62 x 0.42 leaves room for the phase-2 scroll (+-260) to carry the
         * corners without pushing them back through the membrane. */
        d.w = NA.Arena.radius * 0.62; d.h = NA.Arena.radius * 0.42;
        d.breathe = 0; d.warn = 0;
        d.stainCb = function (ty) { if (NA.RNG.chance(0.5)) pageStain(NA.Player.aimX, NA.Player.aimY); };
        if (NA.Game) NA.Game.on('kill', d.stainCb);
        if (fwCall('viewportArena', true) === undefined && !d._warned) { d._warned = 1; }
      }
      d.mode = i;
      d.scrollCd = 3.0; d.scrollY = 0;
      d.shrink = i >= 2 ? 1 : 0;
      if (i >= 2) {
        // the last node steps outside the canvas
        var last = -1;
        for (var q = 0; q < 4; q++) if (d.nodes[q].alive) last = q;
        if (last >= 0) d.nodes[last].out = 1;
      }
      if (i > 0) NA.FX.chroma(2.5, 220);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data;
      if (!d.nodes) return 0;
      var k, n, dx, dy, rr;
      for (k = 0; k < 4; k++) {
        n = d.nodes[k];
        if (!n.alive) continue;
        dx = n.x - x; dy = n.y - y; rr = 40 + r;
        if (dx * dx + dy * dy <= rr * rr) return 1;
      }
      /* A live node is a WINDOW in the border, not a target painted on it.
       * The border absorbs everything within 60 units of it, and the nodes sit
       * exactly on the corners — so without this hole a shot was always eaten
       * a few units short of the node and the fight could never be damaged. */
      for (k = 0; k < 4; k++) {
        n = d.nodes[k];
        if (!n.alive || (n.window !== undefined && n.window < 0.05)) continue;
        dx = n.x - x; dy = n.y - y;
        if (dx * dx + dy * dy <= NODE_WINDOW * NODE_WINDOW) return 0;
      }
      // the border itself eats shots; the open page does not
      var ox = Math.abs(x - NA.Arena.cx) - (d.cw || d.w);
      var oy = Math.abs(y - (NA.Arena.cy + (d.scrollY || 0))) - (d.ch || d.h);
      return (ox > -60 || oy > -60) ? 2 : 0;
    },

    phases: [
      { minDuration: 14, update: function (b, dt) { pageTick(b, dt); } },
      { minDuration: 15, update: function (b, dt) { pageTick(b, dt); } },
      { minDuration: 16, update: function (b, dt) { pageTick(b, dt); } }
    ],

    onDamage: function (b, amt) {
      // nodes die one at a time; the border is what is left
      var d = b.data;
      var alive = 0, k;
      for (k = 0; k < 4; k++) if (d.nodes[k].alive) alive++;
      var frac = b.hp / b.maxHp;
      var want = Math.max(1, Math.ceil(frac * 4));
      if (alive > want) {
        for (k = 3; k >= 0; k--) if (d.nodes[k].alive) {
          d.nodes[k].alive = 0;
          NA.Particles.ring(d.nodes[k].x, d.nodes[k].y, 10, 160, 0.5, 4, CRIMSON[0], CRIMSON[1], CRIMSON[2], 1);
          NA.Particles.burst(d.nodes[k].x, d.nodes[k].y, 12, 320, 0.4, 1, 0.4, 0.5, 1);
          sfx('explode', d.nodes[k].x, d.nodes[k].y);
          break;
        }
      }
      return true;
    },

    onDeath: function (b) {
      // it snaps back to canvas size with a white page flash
      fwCall('viewportArena', false);
      if (fwCall('pageFlash', 220) === undefined) NA.FX.flash(0.45, 220);
      pageStainsClear();
      NA.FX.chroma(3, 400); NA.FX.trauma(0.8);
      NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, NA.Arena.radius * 1.4, 40, 0.7, 8, 1, 1, 1, 1);
    },

    onEnd: function (b) {
      var d = b.data;
      if (d && d.stainCb && NA.Game) NA.Game.off('kill', d.stainCb);
      fwCall('viewportArena', false);
      fwCall('scrollPage', 0, 1);
      pageStainsClear();
    },

    render: function (b) { pageRender(b); }
  });

  function pageRect(cx, cy, w, h, width, col, a, layer, k) {
    var x0 = cx - w, x1 = cx + w, y0 = cy - h, y1 = cy + h;
    var kk = k === undefined ? 1 : k;
    R.line(layer, x0, y0, M.lerp(x0, x1, kk), y0, width, col[0], col[1], col[2], a);
    R.line(layer, x1, y0, x1, M.lerp(y0, y1, kk), width, col[0], col[1], col[2], a);
    R.line(layer, x1, y1, M.lerp(x1, x0, kk), y1, width, col[0], col[1], col[2], a);
    R.line(layer, x0, y1, x0, M.lerp(y1, y0, kk), width, col[0], col[1], col[2], a);
  }

  function pageTick(b, dt) {
    var d = b.data, P = NA.Player;

    // ---- page elements as cover, refreshed twice a second
    d.rectCd -= dt;
    if (d.rectCd <= 0) {
      d.rectCd = 0.5;
      var got = fwCall('obstacles');
      d.rects.length = 0;
      if (got && got.length) {
        for (var i = 0; i < got.length && i < 8; i++) {
          var o = got[i];
          if (!o) continue;
          d.rects.push(o);
        }
      }
    }

    // ---- the border breathes inward: a 1.0 s telegraph, then it closes
    d.breathe += dt;
    var period = d.mode === 0 ? 5.0 : 4.0;
    var ph = (d.breathe % period) / period;
    var closeK = ph > 0.55 ? M.easeInOut(M.clamp01((ph - 0.55) / 0.22)) * (ph > 0.77 ? M.clamp01((1 - ph) / 0.23) : 1) : 0;
    d.close = closeK;
    var shrink = d.shrink ? 0.72 : 1;
    var w = d.w * shrink * (1 - closeK * 0.34);
    var h = d.h * shrink * (1 - closeK * 0.34);
    d.cw = w; d.ch = h;

    // the border hurts on contact, and only after the telegraph
    if (P.alive && closeK > 0.3) {
      var ox = Math.abs(P.x - NA.Arena.cx) - w, oy = Math.abs(P.y - NA.Arena.cy) - h;
      if (ox > -C.SHIP_R || oy > -C.SHIP_R) {
        P.damage(1, NA.Arena.cx, NA.Arena.cy);
        P.vx *= -0.6; P.vy *= -0.6;
      }
    }

    // ---- the four corner nodes
    var cy = NA.Arena.cy + d.scrollY;
    for (var k = 0; k < 4; k++) {
      var n = d.nodes[k];
      var sx = (k === 0 || k === 3) ? -1 : 1;
      var sy = (k < 2) ? -1 : 1;
      if (n.out) {
        // outside the canvas: it swings in for 1.2 s every 3.5 s
        var t = (b.t % 3.5) / 3.5;
        var inK = t > 0.66 ? M.easeInOut(M.clamp01((t - 0.66) / 0.17)) * M.clamp01((1 - t) / 0.17) : 0;
        var rr = NA.Arena.radius * (1.34 - 0.5 * inK);
        var ang = b.t * 0.5 + k;
        n.x = NA.Arena.cx + Math.cos(ang) * rr;
        n.y = cy + Math.sin(ang) * rr * 0.7;
        n.window = inK;
      } else {
        n.x = NA.Arena.cx + sx * w; n.y = cy + sy * h;
        n.window = 1;
      }
    }

    // ---- phase 2: it scrolls the page under you
    if (d.mode >= 1) {
      d.scrollCd -= dt;
      if (d.scrollCd <= 0) {
        d.scrollCd = 4.2;
        d.scrollTarget = (d.scrollTarget || 0) + (NA.RNG.chance(0.5) ? 260 : -260);
        fwCall('scrollPage', d.scrollTarget > (d.scrollY || 0) ? 320 : -320, 500);
        sfx('wall', NA.Arena.cx, NA.Arena.cy);
        NA.FX.chroma(2, 220);
      }
      d.scrollY = M.smooth(d.scrollY || 0, d.scrollTarget || 0, 2.2, dt);
      // everything on the page is dragged with it, you are not
      var E = NA.Enemies;
      var drag = ((d.scrollTarget || 0) - d.scrollY) * 0.9 * dt;
      for (var e = 0; e < E.n; e++) E.y[e] += drag;
    }

    // ---- cover: page rects eat enemy bullets that cross them
    if (d.rects.length) {
      var EB = NA.Bullets.E;
      var n2 = Math.min(EB.n, 700);
      for (var q = n2 - 1; q >= 0; q--) {
        for (var ri = 0; ri < d.rects.length; ri++) {
          var rc = d.rects[ri];
          if (EB.x[q] > rc.x && EB.x[q] < rc.x + rc.w && EB.y[q] > rc.y && EB.y[q] < rc.y + rc.h) {
            NA.Bullets.killE(q); break;
          }
        }
      }
    }

    // the border fires a slow crimson bolt from a live node now and then
    d.fireCd = (d.fireCd || 1.6) - dt;
    if (d.fireCd <= 0) {
      d.fireCd = d.mode === 0 ? 1.9 : 1.4;
      for (var f = 0; f < 4; f++) {
        var nd = d.nodes[f];
        if (!nd.alive) continue;
        var a2 = Math.atan2(P.y - nd.y, P.x - nd.x);
        NA.Bullets.fireEnemy(nd.x, nd.y, Math.cos(a2) * 380, Math.sin(a2) * 380,
          { size: 9, life: 4.5, color: CRIMSON });
      }
      sfx('shotHeavy', NA.Arena.cx, NA.Arena.cy);
    }
  }

  function pageRender(b) {
    var d = b.data;
    if (!d.nodes) return;
    var cy = NA.Arena.cy + (d.scrollY || 0);
    var breath = 0.6 + 0.4 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
    var closing = d.close > 0.05;
    var cr = closing ? 1 : CRIMSON[0], cg = closing ? 0.18 : CRIMSON[1], cb = closing ? 0.3 : CRIMSON[2];
    pageRect(NA.Arena.cx, cy, d.cw || d.w, d.ch || d.h, closing ? 6 : 3.4,
      [cr, cg, cb], (closing ? 0.95 : 0.65) * (closing ? 1 : breath), closing ? L.VEIL : L.MEMBRANE, 1);

    // page elements are cover
    for (var i = 0; i < d.rects.length; i++) {
      var rc = d.rects[i];
      R.line(L.FLOOR, rc.x, rc.y + rc.h * 0.5, rc.x + rc.w, rc.y + rc.h * 0.5, rc.h,
        0.16, 0.17, 0.22, 0.85);
      R.line(L.MEMBRANE, rc.x, rc.y, rc.x + rc.w, rc.y, 1.5, CRIMSON[0], CRIMSON[1], CRIMSON[2], 0.4);
    }

    // the four corner nodes: weak points, gold because they are the answer
    for (var k = 0; k < 4; k++) {
      var n = d.nodes[k];
      if (!n.alive) {
        R.poly(L.ENEMIES, n.x, n.y, 16, 4, NA.Time.t * 0.3, 1.5, 0.4, 0.12, 0.18, 0.4);
        continue;
      }
      var w2 = n.window === undefined ? 1 : n.window;
      var g = COL.gold;
      R.poly(L.ENEMIES, n.x, n.y, 34, 4, NA.Time.t * 0.6, 3.4, g[0], g[1], g[2], 0.5 + 0.45 * w2);
      R.dot(L.ENEMIES, n.x, n.y, 8, 1, 1, 1, 0.6 + 0.4 * w2);
      if (n.out) R.ring(L.VEIL, n.x, n.y, 52, 2, g[0], g[1], g[2], 0.5 * w2);
      R.light(n.x, n.y, 200, 0.35);
    }
  }

  /* ================================================== 25 UNDERSTUDY: PERFECT
   * The wave-10 Understudy with zero delay from the first second and three
   * extra random upgrades of its own. The component is resolved lazily; if
   * 13b has not registered it, the built-in mirror fights instead. */

  function understudyFallback(id) {
    return {
      id: id, name: id, color: COL.violet, hp: 620, introTime: 0,
      phases: [
        { minDuration: 14, enter: function (b) { b.data.m = mirrorMake(0); b.data.m.extra = 1; },
          update: function (b, dt) { mirrorTickBoss(b, dt, 1.0); } },
        { minDuration: 16, update: function (b, dt) { mirrorTickBoss(b, dt, 1.35); } }
      ],
      hitTest: function (b, x, y, r) { return b.data.m ? mirrorHit(b.data.m, x, y, r) : 0; },
      render: function (b) { if (b.data.m) mirrorRender(b.data.m, 1); },
      onDeath: function (b) {
        if (!b.data.m) return;
        // shatters into copies of your ship
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * M.TAU;
          NA.Particles.afterImage(b.data.m.x + Math.cos(a) * 40, b.data.m.y + Math.sin(a) * 40,
            a, C.SHIP_R * 2.2, 0.8, COL.violet[0], COL.violet[1], COL.violet[2], 0.6, 0);
        }
        NA.Particles.ring(b.data.m.x, b.data.m.y, 10, 320, 0.7, 5, COL.violet[0], COL.violet[1], COL.violet[2], 1);
      }
    };
  }
  function mirrorTickBoss(b, dt, aggr) {
    var m = b.data.m; if (!m) return;
    mirrorUpdate(m, dt, aggr);
    b.x = m.x; b.y = m.y;
  }

  B.defineDuo('understudyPerfect', ['understudy'], {
    name: 'Understudy: Perfect', color: COL.violet, hp: 820, camZoom: 0.86,
    introTime: 1.8, grace: 0, minDuration: 18,
    fallback: understudyFallback,

    tweak: function (b, sb, i) {
      // zero delay from the first second — every plausible key the component
      // might keep its lag in, plus our own if the fallback is running
      var d = sb.data;
      d.delay = 0; d.lag = 0; d.mirrorDelay = 0; d.delayT = 0; d.perfect = 1;
      /* GAME_PLAN 9: it drafts THREE extra upgrades.  They are seeded into the
       * component before its first phase enters, so `usInit` (13b) builds the
       * mirror's shot rules out of all three tag sets -- homing, heavy rounds,
       * an extra barrel -- exactly the way the plain Understudy uses its one.
       * The salvo below is the same three cards, made visible. */
      var ids = (NA.Upgrades && NA.Upgrades.list) ? NA.Upgrades.list : null;
      b.data.extras = [];
      if (ids && ids.length) {
        for (var k = 0; k < 3; k++) {
          var pickId = ids[NA.RNG.int(ids.length)];
          if (b.data.extras.indexOf(pickId) < 0) b.data.extras.push(pickId);
          else k--;
          if (b.data.extras.length >= Math.min(3, ids.length)) break;
        }
      }
      d.extraIds = b.data.extras;                // read by usInit
      d.extraUpgrades = b.data.extras;
      sb.x = 2 * NA.Arena.cx - NA.Player.x;
      sb.y = 2 * NA.Arena.cy - NA.Player.y;
    },

    update: function (b, dt) {
      var d = b.data;
      var sb = d.subs && d.subs[0];
      if (!sb || sb.dead) return;
      // hold the delay at zero even if the component keeps rewriting it
      sb.data.delay = 0; sb.data.lag = 0; sb.data.mirrorDelay = 0;
      // the three extra drafts, expressed as three extra shots on a slower clock
      d.exCd = (d.exCd === undefined ? 1.4 : d.exCd) - dt;
      if (d.exCd <= 0 && d.extras && d.extras.length) {
        d.exCd = 2.1;
        var P = NA.Player;
        var a = Math.atan2(P.y - sb.y, P.x - sb.x);
        for (var k = 0; k < d.extras.length; k++) {
          var tags = (NA.Upgrades && NA.Upgrades.tagsOf) ? NA.Upgrades.tagsOf(d.extras[k]) : null;
          var explode = tags && tags.indexOf && tags.indexOf('explode') >= 0;
          var homing = tags && tags.indexOf && tags.indexOf('kill') >= 0;
          var off = (k - 1) * 0.30;
          NA.Bullets.fireEnemy(sb.x, sb.y, Math.cos(a + off) * 520, Math.sin(a + off) * 520, {
            size: explode ? 12 : 8, life: 3.6, homing: homing ? 0.25 : 0,
            color: explode ? COL.orange : COL.violet
          });
        }
        sfx('shotHeavy', sb.x, sb.y);
      }
    },

    render: function (b) {
      var d = b.data;
      var sb = d.subs && d.subs[0];
      if (!sb || sb.dead) return;
      // its crown: three pips, one per extra draft
      for (var k = 0; k < 3; k++) {
        var a = -M.HALFPI + (k - 1) * 0.4;
        R.dot(L.ENEMIES, sb.x + Math.cos(a) * 44, sb.y + Math.sin(a) * 44, 4.5,
          COL.gold[0], COL.gold[1], COL.gold[2], 0.85);
      }
      R.ring(L.VEIL, sb.x, sb.y, 54, 1.6, COL.violet[0], COL.violet[1], COL.violet[2],
        0.35 + 0.2 * Math.sin(NA.Time.t * 3));
    },

    onDeath: function (b) {
      NA.FX.flash(0.35, 200); NA.FX.chroma(3, 400);
      NA.Particles.ring(NA.Player.x, NA.Player.y, 10, 260, 0.6, 4,
        COL.violet[0], COL.violet[1], COL.violet[2], 1);
    }
  });

  /* ============================================ 26/27/29 THE REMIX DUOS */

  B.defineDuo('duoLightsCamera', ['strobe', 'turntable'], {
    name: 'Lights, Camera', color: COL.violet, hp: 980, camZoom: 0.62, minDuration: 8,
    onDeath: function (b) {
      // the lights come up and the floor locks: everything is flung at the walls
      NA.FX.darkness(0, 400);
      NA.FX.flash(0.42, 240);
      NA.Arena.rotate(0);
      var E = NA.Enemies;
      for (var i = 0; i < E.n; i++) {
        var a = Math.atan2(E.y[i] - NA.Arena.cy, E.x[i] - NA.Arena.cx);
        E.vx[i] = Math.cos(a) * 1400; E.vy[i] = Math.sin(a) * 1400;
      }
      NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, 20, NA.Arena.radius, 0.8, 8, 1, 1, 1, 1);
      NA.FX.trauma(0.8);
    },
    onEnd: function () { NA.Arena.rotate(0); NA.FX.darkness(0, 200); }
  });

  B.defineDuo('duoBaitSwitch', ['angler', 'reflector'], {
    name: 'Bait and Switch', color: COL.green, hp: 980, camZoom: 0.68, minDuration: 8,

    /* GAME_PLAN 9: "bank shots off the prism into the Angler's surface window".
     * The Angler component is told a prism is in the room: the bait alone now
     * only cracks its mouth (0.6 s), while a shot the Reflector has bounced --
     * stamped OWN.REFLECT when it leaves the prism -- throws it wide open and
     * bites a chunk out of it.  The flag is cleared the moment the prism dies,
     * so the second half of the fight is the plain Angler again. */
    tweak: function (b, sb, i) {
      if (sb.id === 'angler') { sb.data.bankOnly = 1; b.data.angSub = sb; }
      if (sb.id === 'reflector') b.data.refSub = sb;
    },

    update: function (b, dt) {
      var d = b.data;
      if (!d.subs || d.subs.length < 2) return;
      var a = d.angSub, c = d.refSub;
      if (!a || !c) return;
      d.guide = (d.guide || 0) + dt;
      if (c.dead || a.dead) { if (a) a.data.bankOnly = 0; return; }

      /* a reflected shot that reaches the mass */
      var OWN = B.OWN;
      if (!OWN || !NA.Bullets) return;
      var E = NA.Bullets.E;
      var rr = (a.data.radius || 76);
      for (var k = 0; k < E.n; k++) {
        if (E.owner[k] !== OWN.REFLECT) continue;
        var dx = E.x[k] - a.x, dy = E.y[k] - a.y;
        var hr = rr + E.size[k];
        if (dx * dx + dy * dy > hr * hr) continue;
        NA.Bullets.killE(k, true); k--;
        if (B.anglerBank) withActive(a, B.anglerBank);
        subDamage(a, 34);
        NA.Time.addHitStop(50);
        sfx('hitEnemy', a.x, a.y, 1.2);
      }
    },

    render: function (b) {
      var d = b.data;
      if (!d.subs || d.subs.length < 2) return;
      var a = d.angSub, c = d.refSub;
      if (!a || !c || a.dead || c.dead) return;
      // the bank line: player -> prism -> mass, so the trick reads without text
      var k = 0.18 + 0.12 * Math.sin(NA.Time.t * 2);
      R.line(L.FLOOR, c.x, c.y, a.x, a.y, 2, COL.green[0], COL.green[1], COL.green[2], k);
      R.line(L.FLOOR, NA.Player.x, NA.Player.y, c.x, c.y, 1.4,
        COL.green[0], COL.green[1], COL.green[2], k * 0.7);
      // the mouth ring brightens gold while a bank shot would land
      R.ring(L.FLOOR, a.x, a.y, (a.data.radius || 76) + 16, 2,
        COL.gold[0], COL.gold[1], COL.gold[2], k * 1.1);
    },
    onDeath: function (b) {
      NA.FX.flash(0.3, 180);
      NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, 10, 420, 0.7, 6, COL.green[0], COL.green[1], COL.green[2], 1);
    }
  });

  B.defineDuo('duoHeatDeath', ['supernova', 'compactor'], {
    name: 'Heat Death', color: COL.orange, hp: 1100, camZoom: 0.58, minDuration: 10,
    update: function (b, dt) {
      // the habitable band: the sun from the middle, the walls from the outside
      var d = b.data;
      if (!d.subs) return;
      d.band = (d.band || 0) + dt;
    },
    render: function (b) {
      // a thin gold ring marks the band that is still alive
      var r0 = 240, r1 = NA.Arena.radius * 0.8;
      var pulse = 0.16 + 0.08 * Math.sin(NA.Time.t * 2.2);
      R.ring(L.FLOOR, NA.Arena.cx, NA.Arena.cy, (r0 + r1) * 0.5, (r1 - r0),
        COL.gold[0], COL.gold[1], COL.gold[2], pulse * 0.25);
    },
    onDeath: function (b) {
      // the plan's twist: the walls slam into the sun, it detonates through
      // them, and the arena ends BIGGER than it started
      NA.FX.flash(0.5, 300); NA.FX.chroma(3, 500); NA.FX.trauma(1);
      NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, 10, NA.Arena.radius * 1.5, 1.1, 12,
        1, 0.7, 0.25, 1);
      for (var i = 0; i < 26; i++) {
        var a = i / 26 * M.TAU;
        NA.Particles.frag(NA.Arena.cx + Math.cos(a) * 220, NA.Arena.cy + Math.sin(a) * 220,
          Math.cos(a) * 900, Math.sin(a) * 900, a, 54, 1.0, 1, 0.6, 0.2);
      }
      NA.Arena.setRadius(C.ARENA_R * 1.35, 1.6);
      NA.Arena.ripple(NA.Arena.cx, NA.Arena.cy, 3, 1, 0.7, 0.3);
      var t = 0;
      addTicker(function (dt2) { t += dt2; return t < 1.2; }, function () {
        var k = M.clamp01(t / 1.2);
        R.ring(L.VEIL, NA.Arena.cx, NA.Arena.cy, k * NA.Arena.radius * 1.4, 10 * (1 - k) + 1,
          1, 0.75, 0.35, 0.8 * (1 - k));
      });
    },
    onEnd: function () { NA.Arena.restoreSides(); }
  });

  /* ================================================ 28 CONGREGATION: REQUIEM
   * The swarm boss returns with two overlapping formations from the start and
   * Wraiths riding inside. Silver. */

  B.defineDuo('congregationRequiem', ['congregation', 'congregation'], {
    name: 'Congregation: Requiem', color: SILVER, hp: 1050, camZoom: 0.62,
    introTime: 2.4, grace: 3.5, minDuration: 20,
    fallback: function (id) { return swarmDef(id, SILVER); },

    tweak: function (b, sb, i) {
      // the two formations overlap: one leads, one trails a quarter turn behind
      sb.data.silver = 1;
      sb.data.formationOffset = i * M.HALFPI;
      sb.data.palette = SILVER;
      var rr = NA.Arena.radius * 0.42;
      sb.x = NA.Arena.cx + Math.cos(sb.angle) * rr;
      sb.y = NA.Arena.cy + Math.sin(sb.angle) * rr;
    },

    enter: function (b) {
      b.data.wraithId = pickEnemy('wraith', 'shade', 'skitter', 'mote');
      b.data.wraithCd = 3.0;
      b.data.wraiths = 0;
    },

    update: function (b, dt) {
      var d = b.data;
      d.wraithCd -= dt;
      if (d.wraithCd <= 0 && d.wraiths < 26) {
        d.wraithCd = 3.4;
        // they are spawned INSIDE the formations, where you cannot see them
        for (var i = 0; i < d.subs.length; i++) {
          var sb = d.subs[i];
          if (sb.dead) continue;
          var a = NA.RNG.f() * M.TAU;
          if (spawnAt(d.wraithId, sb.x + Math.cos(a) * 90, sb.y + Math.sin(a) * 90) >= 0) d.wraiths++;
        }
        sfx('spawn', NA.Arena.cx, NA.Arena.cy, { vol: 0.5 });
      }
    },

    render: function (b) {
      // silver: a cold rim light over both formations
      var d = b.data;
      if (!d.subs) return;
      for (var i = 0; i < d.subs.length; i++) {
        var sb = d.subs[i];
        if (sb.dead) continue;
        R.softRing(L.VEIL, sb.x, sb.y, 210, SILVER[0], SILVER[1], SILVER[2], 0.07);
        R.ring(L.VEIL, sb.x, sb.y, 205, 1.4, SILVER[0], SILVER[1], SILVER[2], 0.22);
      }
    },

    onDeath: function (b) {
      // ash, again, but silver
      for (var i = 0; i < 90; i++) {
        var a = NA.RNG.f() * M.TAU, rr = NA.RNG.f() * NA.Arena.radius * 0.7;
        NA.Particles.spawn(NA.Arena.cx + Math.cos(a) * rr, NA.Arena.cy + Math.sin(a) * rr,
          (NA.RNG.f() - 0.5) * 50, -70 - NA.RNG.f() * 110, 1.3, 3,
          SILVER[0], SILVER[1], SILVER[2], 0.8, 1, 0.35);
      }
      NA.Particles.ring(NA.Arena.cx, NA.Arena.cy, 20, NA.Arena.radius, 1.0, 6,
        SILVER[0], SILVER[1], SILVER[2], 0.9);
      NA.FX.flash(0.3, 220);
    }
  });

  /* =========================================================== 30 SINGULARITY
   * The finale. The Supernova's collapsed form: a black core inside an event
   * horizon whose ring carries the sunspots. Extreme pull, and the arena wall
   * inverts — it pulls you in, and the wall is the thing to brace against.
   * Three phases recall the Metronome, the Constellation and the Understudy.
   * Death triggers §8.1. */

  var SPOT_N = 7;
  var HORIZON_R = 300;
  var SPOT_R = 46;            // the sunspot hit radius

  NA.Bosses.define('singularity', {
    name: 'Singularity', color: COL.violet, hp: 1400, introTime: 2.6, camZoom: 0.56,

    intro: function (b, t) {
      b.x = NA.Arena.cx; b.y = NA.Arena.cy;
      var k = M.clamp01(t / 2.6);
      // the sun collapses: a bright disc falls into a black core
      var rr = M.lerp(NA.Arena.radius * 0.75, 34, M.easeInOut(k));
      R.disc(L.ENEMIES, b.x, b.y, rr, 1, M.lerp(0.9, 0.3, k), M.lerp(0.7, 0.1, k), 0.5 * (1 - k * 0.7));
      R.ring(L.ENEMIES, b.x, b.y, rr, 4, 1, 0.8, 0.5, 0.8);
      R.disc(L.ENEMIES, b.x, b.y, 34 * k, 0.02, 0.02, 0.04, 1);
      R.ring(L.VEIL, b.x, b.y, HORIZON_R * k, 3, COL.violet[0], COL.violet[1], COL.violet[2], 0.7 * k);
      // the wall inverts: arrows on the membrane turn inward
      for (var i = 0; i < 24; i++) {
        var a = i / 24 * M.TAU;
        var r0 = NA.Arena.radiusAt(a);
        R.line(L.MEMBRANE, NA.Arena.cx + Math.cos(a) * r0, NA.Arena.cy + Math.sin(a) * r0,
          NA.Arena.cx + Math.cos(a) * (r0 - 60 * k), NA.Arena.cy + Math.sin(a) * (r0 - 60 * k),
          2.4, COL.violet[0], COL.violet[1], COL.violet[2], 0.6 * k);
      }
      if (k > 0.94 && !b.data._punch) {
        b.data._punch = 1; NA.Cam.addTrauma(0.5); NA.FX.chroma(3, 400); NA.FX.flash(0.25, 160);
      }
      return false;
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (!d.spotA) {
        d.spotA = new Float32Array(SPOT_N);
        d.spotHp = new Float32Array(SPOT_N);
        d.spotT = new Float32Array(SPOT_N);
        d.radius = 46;
        // reuse boss 18's Supernova module when 13c published it: its pull is
        // this fight's pull, and its nova is the first beat of the ending
        var sup = (B.shared && B.shared.supernova) ? B.shared.supernova : null;
        d.sup = (sup && typeof sup.create === 'function' && typeof sup.pull === 'function') ? sup : null;
        d.sun = d.sup ? d.sup.create({
          x: NA.Arena.cx, y: NA.Arena.cy, r: d.radius * 1.5, rMax: d.radius * 1.5, grow: 0, pull: 1250
        }) : null;
        if (!d.sup) dbg('singularity: NA.Bosses.shared.supernova absent, using the built-in core');
        d.stars = [];
        for (var s = 0; s < 5; s++) d.stars.push({ x: 0, y: 0, alive: 1, a: 0 });
      }
      for (var k = 0; k < SPOT_N; k++) { d.spotA[k] = k / SPOT_N * M.TAU; d.spotHp[k] = 1; d.spotT[k] = 0; }
      // nothing damages during transitions: if you are standing where the core
      // collapses, the horizon spits you out first
      var P0 = NA.Player;
      if (P0.alive) {
        var pdx = P0.x - NA.Arena.cx, pdy = P0.y - NA.Arena.cy;
        var pl = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pl < HORIZON_R * 1.15) {
          var pa = pl > 1 ? Math.atan2(pdy, pdx) : NA.RNG.f() * M.TAU;
          P0.x = NA.Arena.cx + Math.cos(pa) * HORIZON_R * 1.45;
          P0.y = NA.Arena.cy + Math.sin(pa) * HORIZON_R * 1.45;
          P0.invuln = Math.max(P0.invuln, 0.6);
          NA.Particles.ring(P0.x, P0.y, 10, 120, 0.4, 3, COL.violet[0], COL.violet[1], COL.violet[2], 0.9);
        }
      }
      d.mode = i;
      d.tick = 0; d.frozen = 0; d.pend = 0;
      d.starT = 0;
      d.mirror = null;
      if (i === 2) { d.mirror = mirrorMake(0); d.mirror.extra = 1; }
      if (i > 0) { NA.FX.chroma(3, 300); NA.FX.flash(0.2, 140); }
    },

    hitTest: function (b, x, y, r) {
      var d = b.data;
      if (!d.spotA) return 0;
      d.hitSpot = -1;             // stars and the mirror are not sunspots
      // phase 3: the mirror is the weak point
      if (d.mode === 2 && d.mirror) {
        if (mirrorHit(d.mirror, x, y, r)) return 1;
      }
      // phase 2: the stars are the weak points
      if (d.mode === 1) {
        for (var s = 0; s < d.stars.length; s++) {
          var st = d.stars[s];
          if (!st.alive) continue;
          var sdx = st.x - x, sdy = st.y - y, srr = 34 + r;
          if (sdx * sdx + sdy * sdy <= srr * srr) return 1;
        }
      }
      /* The sunspots on the event horizon, always — phase 1 gates them on the
       * metronome freeze.  hitTest is PURE: it only records which spot was
       * struck, and the chip is applied in onDamage. It used to burn 0.34 spot
       * HP per call, and the autopilot's own probe (98_bot ~279-312, an 8 Hz
       * coarse lattice plus a 49-sample refinement) therefore destroyed every
       * spot it looked at before a bullet could ever reach one. */
      for (var k = 0; k < SPOT_N; k++) {
        if (d.spotHp[k] <= 0) continue;
        var a = d.spotA[k] + b.t * 0.35;
        var sx = b.x + Math.cos(a) * HORIZON_R, sy = b.y + Math.sin(a) * HORIZON_R;
        var dx = sx - x, dy = sy - y, rr = SPOT_R + r;
        if (dx * dx + dy * dy <= rr * rr) {
          /* The time gate is a MISS, not armour: returning 2 deleted the shot,
           * so a build firing through a closed window lost its whole output. */
          if (d.mode === 0 && d.frozen <= 0) return 0;      // the time gate
          d.hitSpot = k;
          return 1;
        }
      }
      /* ARCHITECTURE 25.23, "distance first, then verdict": only the collapsed
       * CORE eats a shot. The old test absorbed everything inside the event
       * horizon (340 units), and the fight's own pull parks the ship at the
       * centre — so every bullet was swallowed on the frame it was fired and
       * the boss sat at full health forever. */
      var hx = b.x - x, hy = b.y - y, hr = (d.radius || 46) + 10 + r;
      return (hx * hx + hy * hy <= hr * hr) ? 2 : 0;
    },

    /* the chip the pure hitTest deferred: one real landed shot, one bite */
    onDamage: function (b) {
      var d = b.data, k = d.hitSpot;
      d.hitSpot = -1;
      if (k === undefined || k < 0 || !d.spotHp || d.spotHp[k] <= 0) return true;
      d.spotHp[k] -= 0.25;
      if (d.spotHp[k] <= 0) {
        d.spotT[k] = 1.6;
        var a = d.spotA[k] + b.t * 0.35;
        var sx = b.x + Math.cos(a) * HORIZON_R, sy = b.y + Math.sin(a) * HORIZON_R;
        NA.Particles.ring(sx, sy, 8, 120, 0.4, 3, 1, 0.8, 0.4, 1);
        NA.Particles.burst(sx, sy, 10, 300, 0.35, 1, 0.7, 0.3, 1);
        sfx('explode', sx, sy);
      }
      return true;
    },

    phases: [
      { minDuration: 15, update: function (b, dt) { singTick(b, dt); } },
      { minDuration: 15, update: function (b, dt) { singTick(b, dt); } },
      { minDuration: 17, update: function (b, dt) { singTick(b, dt); } }
    ],

    onDeath: function (b) { singEnding(b); },
    onEnd: function (b) { NA.FX.darkness(0, 200); },
    render: function (b) { singRender(b); }
  });

  function singTick(b, dt) {
    var d = b.data, P = NA.Player, E = NA.Enemies, i;
    b.x = NA.Arena.cx; b.y = NA.Arena.cy;

    // ---- the shared Supernova's pull, if 13c published it
    var shared = 0;
    if (d.sup && d.sun) {
      d.sun.x = b.x; d.sun.y = b.y;
      try { d.sup.pull(d.sun, dt); shared = 1; }
      catch (e) { d.sup = null; dbg('shared.supernova.pull: ' + e); }
    }

    // ---- extreme pull, and the inverted wall
    if (P.alive) {
      var dx = b.x - P.x, dy = b.y - P.y;
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      var edge = NA.Arena.radiusAt(Math.atan2(P.y - NA.Arena.cy, P.x - NA.Arena.cx));
      var brace = M.clamp01((l - (edge - 150)) / 150);      // 1 at the wall
      var pull = (shared ? 900 : 1500) * (1 - brace) * (P.dashT > 0 ? 0.25 : 1);
      P.vx += dx / l * pull * dt;
      P.vy += dy / l * pull * dt;
      if (brace > 0.5) { P.vx -= dx / l * 520 * dt * brace; P.vy -= dy / l * 520 * dt * brace; }
      // the core itself is lethal, and it is the one thing that reads as red
      if (l < d.radius + C.SHIP_R) P.damage(1, b.x, b.y);
    }
    for (i = 0; i < E.n; i++) {
      var ex = b.x - E.x[i], ey = b.y - E.y[i];
      var el = Math.sqrt(ex * ex + ey * ey) || 1;
      E.vx[i] += ex / el * 420 * dt; E.vy[i] += ey / el * 420 * dt;
      if (el < d.radius + E.size[i]) { E.kill(i, false); i--; }
    }
    // enemy bullets bend into the well too
    var EB = NA.Bullets.E, n = Math.min(EB.n, 600);
    for (i = 0; i < n; i++) {
      var bx = b.x - EB.x[i], by = b.y - EB.y[i];
      var bl = Math.sqrt(bx * bx + by * by) || 1;
      EB.vx[i] += bx / bl * 220 * dt; EB.vy[i] += by / bl * 220 * dt;
    }

    // ---- the sunspots regrow, so the fight always has an answer
    var spotsUp = 0, coldest = 0;
    for (i = 0; i < SPOT_N; i++) {
      if (d.spotHp[i] > 0) { spotsUp++; continue; }
      d.spotT[i] -= dt;
      if (d.spotT[i] <= 0) { d.spotHp[i] = 1; spotsUp++; }
      else if (d.spotT[i] < d.spotT[coldest] || d.spotHp[coldest] > 0) coldest = i;
    }
    // the ring is never bare: the next spot back is handed over immediately
    if (!spotsUp) { d.spotHp[coldest] = 1; d.spotT[coldest] = 0; }

    if (d.mode === 0) {
      // ---- phase 1: the Metronome. Time only moves while the bob swings, and
      // the spots are only vulnerable in the freeze.
      d.pend += dt;
      var period = 1.9;
      if (d.pend >= period) {
        d.pend = 0;
        d.frozen = 0.95;
        NA.Time.slowmo(0.07, 380);
        sfx('lock', b.x, b.y);
        NA.Particles.ring(b.x, b.y, HORIZON_R - 20, HORIZON_R + 40, 0.35, 4,
          COL.gold[0], COL.gold[1], COL.gold[2], 0.8);
      }
      if (d.frozen > 0) d.frozen -= dt;
      // the bob sweeps a lethal arc through the arena, telegraphed by its swing
      var swing = Math.sin(d.pend / period * M.TAU) * 1.15;
      var bx2 = b.x + Math.cos(swing - M.HALFPI) * NA.Arena.radius * 0.8;
      var by2 = b.y + Math.sin(swing - M.HALFPI) * NA.Arena.radius * 0.8;
      d.bobX = bx2; d.bobY = by2;
      if (P.alive) {
        var pdx = P.x - bx2, pdy = P.y - by2;
        if (pdx * pdx + pdy * pdy < 70 * 70) P.damage(1, bx2, by2);
      }
    } else if (d.mode === 1) {
      // ---- phase 2: a Constellation cast across the arena
      d.starT += dt;
      if (!d.starsOn) {
        d.starsOn = 1;
        for (i = 0; i < d.stars.length; i++) {
          d.stars[i].a = i / d.stars.length * M.TAU + 0.4;
          d.stars[i].alive = 1;
        }
      }
      var live = 0;
      for (i = 0; i < d.stars.length; i++) {
        var st = d.stars[i];
        st.a += dt * 0.18;
        var srr = NA.Arena.radius * 0.66;
        st.x = b.x + Math.cos(st.a) * srr;
        st.y = b.y + Math.sin(st.a) * srr;
        if (st.alive) live++;
      }
      if (live === 0) { for (i = 0; i < d.stars.length; i++) d.stars[i].alive = 1; }
      // the lines between live stars are lethal, and fade in over 0.6 s
      var fade = M.clamp01(d.starT / 0.6);
      if (P.alive && fade >= 1) {
        for (i = 0; i < d.stars.length; i++) {
          var a1 = d.stars[i], a2 = d.stars[(i + 1) % d.stars.length];
          if (!a1.alive || !a2.alive) continue;
          if (segNear(a1.x, a1.y, a2.x, a2.y, P.x, P.y, 16 + C.SHIP_R)) { P.damage(1, a1.x, a1.y); break; }
        }
      }
    } else {
      // ---- phase 3: it mirrors you
      if (d.mirror) mirrorUpdate(d.mirror, dt, 1.3);
    }
  }

  function segNear(x1, y1, x2, y2, px, py, r) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy; if (l2 < 1e-6) return false;
    var t = M.clamp01(((px - x1) * dx + (py - y1) * dy) / l2);
    var qx = x1 + dx * t - px, qy = y1 + dy * t - py;
    return qx * qx + qy * qy < r * r;
  }

  function singRender(b) {
    var d = b.data;
    if (!d.spotA) return;
    var end = d.end;

    // the inverted wall: inward barbs on the membrane, the brace ring
    for (var i = 0; i < 32; i++) {
      var a = i / 32 * M.TAU;
      var r0 = NA.Arena.radiusAt(a);
      var k = 0.35 + 0.25 * Math.sin(NA.Time.t * 2 + i);
      R.line(L.MEMBRANE, NA.Arena.cx + Math.cos(a) * r0, NA.Arena.cy + Math.sin(a) * r0,
        NA.Arena.cx + Math.cos(a) * (r0 - 46), NA.Arena.cy + Math.sin(a) * (r0 - 46),
        2.2, COL.violet[0], COL.violet[1], COL.violet[2], k);
    }

    // the collapsed core and its event horizon
    R.disc(L.ENEMIES, b.x, b.y, d.radius * 1.6, 0.02, 0.02, 0.04, 1);
    R.ring(L.ENEMIES, b.x, b.y, d.radius, 3, COL.violet[0], COL.violet[1], COL.violet[2], 0.9);
    R.ring(L.ENEMIES, b.x, b.y, HORIZON_R, 3.4, COL.violet[0], COL.violet[1], COL.violet[2], 0.65);
    R.softRing(L.PARTICLES, b.x, b.y, HORIZON_R * 0.55, 0.45, 0.2, 0.7, 0.07);
    // the accretion streaks
    for (var s = 0; s < 10; s++) {
      var sa = NA.Time.t * 0.8 + s / 10 * M.TAU;
      var sr = HORIZON_R * (0.55 + 0.4 * ((NA.Time.t * 0.3 + s * 0.1) % 1));
      R.arc(L.PARTICLES, b.x, b.y, sr, sa, sa + 0.5, 2, 0.8, 0.5, 1, 0.25);
    }

    // the sunspots living on the horizon
    for (var k2 = 0; k2 < SPOT_N; k2++) {
      var ang = d.spotA[k2] + b.t * 0.35;
      var x = b.x + Math.cos(ang) * HORIZON_R, y = b.y + Math.sin(ang) * HORIZON_R;
      if (d.spotHp[k2] <= 0) {
        R.ring(L.ENEMIES, x, y, 16, 1.4, 0.3, 0.2, 0.4, 0.5);
        continue;
      }
      var open = (d.mode !== 0) || d.frozen > 0;
      var col = open ? COL.gold : COL.orange;
      R.polyFill(L.ENEMIES, x, y, SPOT_R * 0.62, 6, ang, col[0] * 0.9, col[1] * 0.9, col[2] * 0.9, 0.9);
      R.dot(L.ENEMIES, x, y, 6, 1, 1, 1, open ? 0.95 : 0.4);
      R.light(x, y, 180, 0.4);
    }

    if (d.mode === 0 && d.bobX !== undefined) {
      // the pendulum: the rod, the bob, and its lethal head
      R.line(L.ENEMIES, b.x, b.y, d.bobX, d.bobY, 3, COL.gold[0], COL.gold[1], COL.gold[2], 0.7);
      R.poly(L.ENEMIES, d.bobX, d.bobY, 36, 6, NA.Time.t, 3.4, 1, 0.18, 0.30, 0.95);
      R.dot(L.ENEMIES, d.bobX, d.bobY, 9, 1, 1, 1, 0.9);
      if (d.frozen > 0) R.ring(L.VEIL, b.x, b.y, HORIZON_R + 26, 3, COL.gold[0], COL.gold[1], COL.gold[2],
        0.6 * M.clamp01(d.frozen / 0.42));
    } else if (d.mode === 1) {
      var fade = M.clamp01(d.starT / 0.6);
      for (var i2 = 0; i2 < d.stars.length; i2++) {
        var a1 = d.stars[i2], a2 = d.stars[(i2 + 1) % d.stars.length];
        if (!a1.alive || !a2.alive) continue;
        var lc = fade >= 1 ? 1 : 0.541;
        R.line(L.VEIL, a1.x, a1.y, a2.x, a2.y, fade >= 1 ? 3 : 2, 1, fade >= 1 ? 0.18 : 0.541,
          fade >= 1 ? 0.3 : 0.0, 0.5 + 0.4 * fade);
      }
      for (var i3 = 0; i3 < d.stars.length; i3++) {
        var st2 = d.stars[i3];
        if (!st2.alive) { R.dot(L.ENEMIES, st2.x, st2.y, 4, 0.4, 0.35, 0.5, 0.5); continue; }
        R.sprite(L.ENEMIES, 'star4', st2.x, st2.y, NA.Time.t * 0.5, 26, 26,
          COL.gold[0], COL.gold[1], COL.gold[2], 0.95);
        R.light(st2.x, st2.y, 200, 0.4);
      }
    } else if (d.mirror) {
      mirrorRender(d.mirror, 1);
    }

    if (end) singEndRender(b, end);
  }

  /* -------------------------------------------------------------- §8.1 */
  function singEnding(b) {
    var d = b.data;
    // the ending is a state of its own: hold the framework in 'dying' while it
    // plays, so the game does not walk into wave 31 underneath it
    d.end = { t: 0, stage: 0, flashed: 0, shared: 0 };
    // the Supernova goes nova one last time, collapsed or not
    if (d.sup && d.sun && typeof d.sup.detonate === 'function') {
      try { d.sup.detonate(d.sun); d.end.shared = 1; } catch (e) { dbg('shared.supernova.detonate: ' + e); }
    }
    if (NA.Game) NA.Game.emit('victory', { wave: NA.Game.wave, kills: NA.Player.kills });
    if (NA.Audio && NA.Audio.music && NA.Audio.music.stinger) {
      try { NA.Audio.music.stinger('victory'); } catch (e) { }
    }
    if (NA.Store && NA.Store.records) {
      NA.Store.records.beat30 = 1;
      if (NA.Store.save) { try { NA.Store.save(); } catch (e) { } }
    }
    NA.Enemies.killAll(true);
    NA.Bullets.reset();
    NA.FX.flash(0.5, 300);
    NA.Time.slowmo(0.3, 1200);

    var end = d.end;
    addTicker(function (dt) {
      end.t += dt;
      if (b.state === 'dying') b.t = Math.min(b.t, 1.3);      // hold the state
      if (end.stage === 0 && end.t > 1.0) {
        // the whole page flashes white
        end.stage = 1;
        if (fwCall('pageFlash', 320) === undefined) NA.FX.flash(0.5, 320);
        NA.FX.trauma(0.6);
      }
      if (end.stage === 1 && end.t > 1.5) { end.stage = 2; }   // one second of nothing
      if (end.stage === 2 && end.t > 2.6) {
        end.stage = 3;                                          // the arena redraws
        if (NA.Events && NA.Events.setBiome) { try { NA.Events.setBiome('ember'); } catch (e) { } }
      }
      if (end.t > 4.6) { b.t = 2; return false; }              // release; the UI takes over
      return true;
    });
  }

  function singEndRender(b, end) {
    var cx = NA.Arena.cx, cy = NA.Arena.cy;
    if (end.stage === 0) {
      // a white ring expands past the arena
      var k = M.clamp01(end.t / 1.0);
      if (!end.shared) R.ring(L.VEIL, cx, cy, k * NA.Arena.radius * 1.8, 26 * (1 - k) + 3, 1, 1, 1, 1 - k * 0.2);
      R.softRing(L.VEIL, cx, cy, k * NA.Arena.radius * 1.5, 1, 1, 1, 0.25 * (1 - k));
    } else if (end.stage === 1 || end.stage === 2) {
      // for one second there is nothing: no arena, no HUD, no page
      R.sdisc(R.w * 0.5, R.h * 0.5, Math.max(R.w, R.h), 0.02, 0.024, 0.039, 1);
    } else {
      // the arena redraws itself from the centre outward, in Ember colours
      var k2 = M.clamp01((end.t - 2.6) / 1.6);
      var cover = 1 - M.clamp01((end.t - 2.6) / 0.5);
      if (cover > 0) R.sdisc(R.w * 0.5, R.h * 0.5, Math.max(R.w, R.h), 0.02, 0.024, 0.039, cover);
      var rr = NA.Arena.radius * M.easeOut(k2);
      R.ring(L.VEIL, cx, cy, rr, 3.4, EMBER_A[0], EMBER_A[1], EMBER_A[2], 0.9);
      R.softRing(L.VEIL, cx, cy, rr * 0.9, EMBER_B[0], EMBER_B[1], EMBER_B[2], 0.10);
      for (var i = 0; i < 10; i++) {
        var a = i / 10 * M.TAU + NA.Time.real * 0.2;
        R.dot(L.VEIL, cx + Math.cos(a) * rr * 0.72, cy + Math.sin(a) * rr * 0.72, 3,
          EMBER_A[0], EMBER_A[1], EMBER_A[2], 0.5 * k2);
      }
      // the ship drifts to the centre in its final form
      NA.Ship.render(cx, cy, NA.Time.real * 0.4, 0.9 * k2, 1.5);
    }
  }
})();
