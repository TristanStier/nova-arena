/* 98_bot.js — the integration autopilot, god mode, the sim time multiplier and
 * the per-module profiler. Dev-only: nothing here runs unless a URL param asks
 * for it, and the whole file is inert in a normal build.
 *
 *   ?bot=1     an autopilot that plays: dodges, aims, holds fire, dashes out of
 *              bullets, taps the active key, picks the first draft card, and
 *              flies through the title / death / ending gates so a run can go
 *              from wave 1 to endless without a human.
 *   ?god=1     the player takes no damage (hp is also re-floored every frame,
 *              so upgrades that pay hull directly cannot kill the run either).
 *   ?fast=N    multiply the SIMULATION clock by N. Wall clock, menus and the
 *              draft still run in real time.
 *   ?prof=1    per-module timing accumulator, readable from the ?debug=1
 *              overlay and from NA.Prof.report().
 *
 * Public API
 *   NA.Bot.on / NA.Bot.tick(dt) / NA.Bot.state       autopilot
 *   NA.Prof.report() -> "name ms | name ms"          profiler
 */
(function () {
  var P = NA.params, M = NA.M, C = NA.C;
  var wantBot = !!P.bot, wantGod = !!P.god;
  var fast = P.fast ? Math.max(0.1, +P.fast) : 1;
  var wantProf = !!P.prof;

  /* ===================================================== sim time multiplier */
  if (fast !== 1) {
    NA.Time.simScale = fast;
    NA.Time.maxSteps = Math.max(8, Math.ceil(8 * fast));
  }

  /* ================================================================ god mode */
  if (wantGod) {
    var _dmg = NA.Player.damage;
    NA.Player.damage = function (n, sx, sy) { return false; };
    NA.Player._damageReal = _dmg;
    NA.Player.godMode = true;
  }

  /* =============================================================== profiler
   * Wraps the per-frame entry point of every module so the overlay can name
   * the top offender. Costs one performance.now() pair per module per frame,
   * so it is only installed when ?prof=1 asks for it. */
  var Prof = NA.Prof = {
    on: wantProf, acc: Object.create(null), last: Object.create(null),
    frames: 0, _t: 0,
    report: function () {
      var a = [], k;
      for (k in Prof.last) a.push([k, Prof.last[k]]);
      a.sort(function (x, y) { return y[1] - x[1]; });
      var s = '';
      for (var i = 0; i < Math.min(6, a.length); i++) s += (i ? ' | ' : '') + a[i][0] + ' ' + a[i][1].toFixed(2);
      return s;
    }
  };
  if (wantProf) {
    var now = (typeof performance !== 'undefined' && performance.now)
      ? function () { return performance.now(); } : function () { return Date.now(); };
    var wrap = function (obj, fn, label) {
      if (!obj || typeof obj[fn] !== 'function') return;
      var orig = obj[fn];
      obj[fn] = function () {
        var t0 = now();
        var r = orig.apply(this, arguments);
        Prof.acc[label] = (Prof.acc[label] || 0) + (now() - t0);
        return r;
      };
    };
    var mods = [
      ['Events', 'update', 'events.u'], ['Events', 'renderBackdrop', 'events.bg'],
      ['Events', 'renderVeil', 'events.veil'],
      ['Arena', 'update', 'arena.u'], ['Arena', 'render', 'arena.r'],
      ['Player', 'update', 'player.u'], ['Player', 'render', 'player.r'],
      ['Enemies', 'update', 'enemies.u'], ['Enemies', 'render', 'enemies.r'],
      ['Bullets', 'update', 'bullets.u'], ['Bullets', 'render', 'bullets.r'],
      ['Bosses', 'update', 'bosses.u'], ['Bosses', 'render', 'bosses.r'],
      ['Upgrades', 'update', 'upgrades.u'], ['Upgrades', 'render', 'upgrades.r'],
      ['Particles', 'update', 'parts.u'], ['Particles', 'render', 'parts.r'],
      ['Waves', 'update', 'waves.u'], ['Waves', 'render', 'waves.r'],
      ['HUD', 'render', 'hud.r'], ['UI', 'renderOverlay', 'ui.ov'],
      ['R', 'end', 'gl.end'], ['FX', 'apply', 'fx.apply']
    ];
    for (var mi = 0; mi < mods.length; mi++) wrap(NA[mods[mi][0]], mods[mi][1], mods[mi][2]);
    // fold the accumulator into a per-second average once a second
    var _frame = NA.Game.frame;
    NA.Game.frame = function (ts) {
      _frame.call(NA.Game, ts);
      Prof.frames++;
      Prof._t += NA.R.stats.frameMs;
      if (Prof.frames >= 60) {
        for (var k in Prof.acc) { Prof.last[k] = Prof.acc[k] / Prof.frames; Prof.acc[k] = 0; }
        Prof.frames = 0; Prof._t = 0;
      }
    };
  }

  /* ================================================================ the bot */
  var Bot = NA.Bot = {
    on: wantBot,
    activeT: 0, draftT: 0, dashCd: 0, aimX: 0, aimY: 0,
    moveX: 0, moveY: 0, note: '',
    sweepA: 0, sweepR: 0, _bossHp: 1e9, _noDmgT: 0, _holdX: 0, _holdY: 0,
    _probeT: 0, _probeOk: false, _trackX: 0, _trackY: 0, _trackOk: false,
    // sticky hot-cell commitment (probeBoss) and the aim-lead estimator
    _stickX: 0, _stickY: 0, _stickOk: false, _chX: 0, _chY: 0, _chT: 0,
    _leadX: 0, _leadY: 0, _leadVX: 0, _leadVY: 0, _leadT: -1, _leadOk: false, _leadA: 0, _leadR: 0, _leadDR: 0, _leadDA: 0,
    _errL: 0, _errP: 0, _pLx: 0, _pLy: 0, _pPx: 0, _pPy: 0, _predOk: false, _pullT: 0, _leadOrbit: false, _leadPolar: false, _aimTrack: false, _subT: 0,
    _nextX: 0, _nextY: 0, _nextOk: false, _chSimT: 0
  };
  if (!wantBot) return;

  var DIRS = 16;
  var dirX = new Float32Array(DIRS), dirY = new Float32Array(DIRS);
  for (var d = 0; d < DIRS; d++) {
    var a = d / DIRS * M.TAU;
    dirX[d] = Math.cos(a); dirY[d] = Math.sin(a);
  }
  // threat scratch (no per-frame allocation)
  var TMAX = 64;
  var thX = new Float32Array(TMAX), thY = new Float32Array(TMAX);
  var thVX = new Float32Array(TMAX), thVY = new Float32Array(TMAX), thW = new Float32Array(TMAX);
  var thN = 0;

  var AX = { x: 0, y: 0 };
  var SCR = { x: 0, y: 0 };

  function pushThreat(x, y, vx, vy, w) {
    if (thN >= TMAX) return;
    thX[thN] = x; thY[thN] = y; thVX[thN] = vx; thVY[thN] = vy; thW[thN] = w; thN++;
  }

  function gatherThreats(px, py) {
    thN = 0;
    var i, dx, dy, d2;
    var E = NA.Bullets.E;
    for (i = 0; i < E.n && thN < TMAX; i++) {
      dx = E.x[i] - px; dy = E.y[i] - py; d2 = dx * dx + dy * dy;
      if (d2 > 420 * 420) continue;
      pushThreat(E.x[i], E.y[i], E.vx[i], E.vy[i], 2.6);
    }
    var En = NA.Enemies;
    for (i = 0; i < En.n && thN < TMAX; i++) {
      if (En.intangible[i] > 0) continue;
      dx = En.x[i] - px; dy = En.y[i] - py; d2 = dx * dx + dy * dy;
      if (d2 > 460 * 460) continue;
      pushThreat(En.x[i], En.y[i], En.vx[i], En.vy[i], 1.0 + En.size[i] * 0.05);
    }
    var b = NA.Bosses.active;
    if (b && b.state === 'fight') {
      dx = b.x - px; dy = b.y - py;
      if (dx * dx + dy * dy < 640 * 640) pushThreat(b.x, b.y, 0, 0, 3.0);
    }
  }

  /* Score a candidate step: high is bad. Threats are integrated over a short
   * lookahead so a bullet that is *about* to arrive already reads as danger. */
  var LOOK = 0.30;
  /* When a boss's soft spot is a long way off, standing in the middle of the
   * arena and firing at it is hopeless: the Cartographer's stylus runs the rim
   * at ~1500 u/s and a bullet spends most of a second in the air, so the lead
   * has to be enormous and the smallest error misses. The dodge therefore
   * carries a weak attraction to the tracked point, capped so it never
   * outweighs an incoming bullet and never pulls the ship onto the membrane. */
  var STANDOFF = 230, PULL = 1.8;
  var pullX = 0, pullY = 0, pullOn = false, pullBand = 0;
  // the live standoff / weight (a straggler hunt wants to close much harder
  // than a boss standoff does; see huntTarget below)
  var pullStand = STANDOFF, pullW = PULL;
  function scoreDir(px, py, k, speed) {
    var nx = px + dirX[k] * speed * LOOK;
    var ny = py + dirY[k] * speed * LOOK;
    var cost = 0, i;
    for (i = 0; i < thN; i++) {
      var tx = thX[i] + thVX[i] * LOOK, ty = thY[i] + thVY[i] * LOOK;
      var dx = tx - nx, dy = ty - ny;
      var d2 = dx * dx + dy * dy;
      if (d2 < 25) d2 = 25;
      cost += thW[i] * 90000 / d2;
    }
    // arena centre pull, quadratic in the normalised radius
    var acx = NA.Arena.cx, acy = NA.Arena.cy;
    var rx = nx - acx, ry = ny - acy;
    var rad = NA.Arena.radiusAt(Math.atan2(ry, rx)) || C.ARENA_R;
    var rn = Math.sqrt(rx * rx + ry * ry) / Math.max(1, rad);
    cost += rn * rn * 260;
    if (pullOn) {
      var pd;
      if (pullBand > 0) {
        /* The soft spot is orbiting: chasing it is hopeless (the stylus laps
         * the ship four times over), so park on its RING, one standoff inside,
         * and let it come round to point-blank range every lap. */
        pd = Math.abs(Math.sqrt(rx * rx + ry * ry) - pullBand);
      } else {
        var pdx = nx - pullX, pdy = ny - pullY;
        pd = Math.sqrt(pdx * pdx + pdy * pdy) - pullStand;
      }
      if (pd > 0) cost += pd * pullW;  // linear, so the gradient never flattens
    }
    if (rn > 0.86) cost += (rn - 0.86) * 6000;      // never hug the membrane
    // mirror walls and chasms
    var mw = NA.Arena.mirrorWalls;
    if (mw && mw.length) {
      for (i = 0; i < mw.length; i++) {
        var w = mw[i];
        var mx = (w.x1 + w.x2) * 0.5, my = (w.y1 + w.y2) * 0.5;
        var mdx = mx - nx, mdy = my - ny, md2 = mdx * mdx + mdy * mdy;
        if (md2 < 120 * 120) cost += 400;
      }
    }
    return cost;
  }

  /* ---- hunting the last stragglers -----------------------------------
   * A wave ends on kills, never on a timer, so a run is only over when the
   * LAST enemy dies — and the last enemy is very often a non-flocking kind
   * (an Echo, a parked Rotator) sitting on the far rim, 1700+ units away and
   * off the visible screen. Two things used to go wrong there:
   *
   *   1. the aim used NA.Enemies.nearestTo(px, py, 1800), a grid query with a
   *      hard radius. Across a 1900-unit arena two rim points are 3800 apart,
   *      so a straggler on the opposite rim returned -1, the aim fell back to
   *      the arena centre and the bot shot at nothing for the rest of the run;
   *   2. nothing ever moved the ship TOWARDS a plain enemy — the dodge only
   *      knows threats and a centre pull — so even a target inside the query
   *      radius could sit outside a bullet's 2094-unit reach forever.
   *
   * So: scan the whole (by then tiny) pool, and when the nearest thing left is
   * further than HUNT_ENGAGE, turn on the same positional pull the boss code
   * uses and walk the ship into range. */
  var HUNT_ENGAGE = 700;   // beyond this the bot goes and gets it
  var HUNT_HOLD = 300;     // and keeps going until this close (hysteresis)
  var HUNT_STAND = 170;    // how close the pull wants to end up
  var HUNT_PULL = 3.0;     // weight: beats the centre pull, loses to a bullet
  var huntD2 = 0, huntX = 0, huntY = 0, huntOn = false, huntWas = false;

  /* Bot diagnostics: OFF, and doubly gated.
   *
   * tools/test.js counts every console error the page emits as a failed run,
   * so a debug dump left switched on in here fails a three-hour autopilot run
   * that was otherwise perfect. This one needs a developer to BOTH flip DIAG
   * in the source and ask for ?debug=1, and it writes to console.log rather
   * than console.error even then, so it cannot fail a harness run. */
  var DIAG = false;
  function diag(msg) {
    if (!DIAG || !P.debug) return;
    if (typeof console !== 'undefined' && console.log) console.log('[NA bot] ' + msg);
  }

  /* Nearest enemy anywhere in the arena. Prefers a shootable one (tangible,
   * finished spawning, not a Reaper ally) and falls back to any row, so a
   * pool that only holds intangible rows still gets walked to instead of
   * leaving the ship parked in the middle. */
  function nearestEnemyAny(px, py) {
    var E = NA.Enemies, n = E.n;
    var best = -1, bd = 1e18, any = -1, ad = 1e18;
    for (var i = 0; i < n; i++) {
      var dx = E.x[i] - px, dy = E.y[i] - py, d2 = dx * dx + dy * dy;
      if (d2 < ad) { ad = d2; any = i; }
      if (E.intangible[i] > 0 || E.spawnT[i] > 0 || E.ally[i] > 0) continue;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best < 0) { best = any; bd = ad; }
    huntD2 = bd;
    return best;
  }

  function chooseMove(px, py, speed) {
    gatherThreats(px, py);
    var best = -1, bestC = 1e18, k;
    for (k = 0; k < DIRS; k++) {
      var c = scoreDir(px, py, k, speed);
      if (c < bestC) { bestC = c; best = k; }
    }
    // standing still is a real option when nothing is close
    var stay = scoreDir(px, py, 0, 0);
    if (stay <= bestC * 1.02) { AX.x = 0; AX.y = 0; return AX; }
    AX.x = dirX[best]; AX.y = dirY[best];
    return AX;
  }

  /* the nearest enemy bullet that is actually closing on us */
  function incomingBullet(px, py, r) {
    var E = NA.Bullets.E, r2 = r * r;
    for (var i = 0; i < E.n; i++) {
      var dx = px - E.x[i], dy = py - E.y[i];
      var d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (E.vx[i] * dx + E.vy[i] * dy <= 0) continue;   // moving away
      return i;
    }
    return -1;
  }

  function moveToward(px, py, tx, ty) {
    var dx = tx - px, dy = ty - py;
    var l = Math.sqrt(dx * dx + dy * dy);
    if (l < 12) { AX.x = 0; AX.y = 0; return AX; }
    AX.x = dx / l; AX.y = dy / l; return AX;
  }

  /* Ask the boss's own hitTest where its soft spot is.
   *
   * This is a DEV-ONLY shortcut and it is deliberate: a blind bot cannot learn
   * "shoot the eyes inside the wave front", and without it a single fight can
   * eat ten minutes of a smoke run. A few hitTests have side effects (the
   * Compactor's seams take chip damage), so it runs at 8 Hz in two passes -
   * a coarse fat-radius lattice, then a bullet-sized refinement of the hot
   * cells - and never in a shipped build. */
  var COARSE_STEP = 210, COARSE_R = 155;      // sweep the whole arena cheaply
  var FINE_N = 7, FINE_STEP = 46, FINE_R = 13; // then pin the real soft spot
  var HOT_MAX = 8;
  var hotX = new Float32Array(HOT_MAX), hotY = new Float32Array(HOT_MAX);

  function probeBoss(b, dt) {
    if (!b.def.hitTest) return false;
    /* Track first: if the soft spot we found last frame is still a soft spot,
     * follow it. Only when the track is lost do we pay for a full arena sweep,
     * and that stays rate-limited to 8 Hz. */
    if (Bot._trackOk && fineAround(b, Bot._nextOk ? Bot._nextX : Bot._trackX,
      Bot._nextOk ? Bot._nextY : Bot._trackY)) return true;
    Bot._probeT -= dt;
    if (Bot._probeT > 0) return false;
    Bot._probeT = 1 / 8;
    Bot._probeOk = false;

    var A = NA.Arena, rad = A.radius;
    var px = NA.Player.x, py = NA.Player.y;
    /* Dither so nothing hides between cells. Off the SIM clock, not the wall
     * clock: a bot whose search pattern depends on how fast the machine drew
     * the last frame makes every headless run a different run, and two of them
     * cannot be compared. */
    var jx = (NA.Time.t * 137) % COARSE_STEP;
    var jy = (NA.Time.t * 211) % COARSE_STEP;
    var hn = 0, res, x, y;

    /* pass 1: a coarse lattice with a fat probe radius, so a 40-unit weak spot
     * cannot slip between two samples */
    var span = rad * 1.15, span2 = span * span;   // a little past the rim: some
    for (y = A.cy - span + jy; y <= A.cy + span && hn < HOT_MAX; y += COARSE_STEP) {
      for (x = A.cx - span + jx; x <= A.cx + span && hn < HOT_MAX; x += COARSE_STEP) {
        var ddx = x - A.cx, ddy = y - A.cy;        // weak points sit on the rim
        if (ddx * ddx + ddy * ddy > span2) continue;
        res = 0;
        try { res = b.def.hitTest(b, x, y, COARSE_R); } catch (e) { return false; }
        if (res === 1) { hotX[hn] = x; hotY[hn] = y; hn++; }
      }
    }
    if (!hn) { Bot._stickOk = false; Bot._chT = 0; return false; }

    /* Commit to one hot cell and STAY on it.
     *
     * A boss with several simultaneous weak points (the Cartographer's rim
     * marks) used to hand the sweep a different "nearest" cell every eighth of
     * a second as the ship drifted, so the bot re-aimed forever and killed
     * nothing. The previously committed cell wins as long as it is still hot;
     * a rival only takes over once it has been *strictly* better — meaningfully
     * closer, not a pixel closer — for STICK_HOLD seconds without a break. */
    var esim = NA.Time.t - Bot._chSimT;             // sim seconds since the last sweep
    if (!(esim > 0) || esim > 0.25) esim = 0.25;    // ?fast=N speeds the sim, not the probe
    Bot._chSimT = NA.Time.t;
    var pick = pickSticky(px, py, hn, esim);

    /* pass 2: refine the committed cell first, then the rest as a fallback */
    if (fineAround(b, hotX[pick], hotY[pick])) return true;
    for (var h = 0; h < hn; h++) if (h !== pick && fineAround(b, hotX[h], hotY[h])) return true;
    // the fat probe saw something but nothing bullet-sized: shoot at it anyway
    Bot._trackX = hotX[pick]; Bot._trackY = hotY[pick]; Bot._trackOk = true;
    aimLead(hotX[pick], hotY[pick]);
    Bot._probeOk = true; return true;
  }

  var STICK_HOLD = 0.5, STICK_MARGIN = 0.72;   // a rival must be 28% closer
  function pickSticky(px, py, hn, esim) {
    var i, dx, dy, d2;
    // the cell nearest to what we committed to last time (if it survived)
    var keep = -1, keepD = COARSE_STEP * COARSE_STEP;
    if (Bot._stickOk) {
      for (i = 0; i < hn; i++) {
        dx = hotX[i] - Bot._stickX; dy = hotY[i] - Bot._stickY; d2 = dx * dx + dy * dy;
        if (d2 < keepD) { keepD = d2; keep = i; }
      }
    }
    // and the cell a memoryless bot would take: the closest one to the ship
    var best = 0, bestD = 1e18;
    for (i = 0; i < hn; i++) {
      dx = hotX[i] - px; dy = hotY[i] - py; d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    var pick = best;
    if (keep >= 0) {
      pick = keep;
      dx = hotX[keep] - px; dy = hotY[keep] - py;
      var keepPD = dx * dx + dy * dy;
      if (best !== keep && bestD < keepPD * STICK_MARGIN * STICK_MARGIN) {
        // the same rival as last probe? then its clock keeps running
        dx = hotX[best] - Bot._chX; dy = hotY[best] - Bot._chY;
        if (Bot._chT > 0 && dx * dx + dy * dy < COARSE_STEP * COARSE_STEP) {
          Bot._chT += esim;
          if (Bot._chT >= STICK_HOLD) { pick = best; Bot._chT = 0; }
        } else { Bot._chT = esim; }
        Bot._chX = hotX[best]; Bot._chY = hotY[best];
      } else Bot._chT = 0;
    } else Bot._chT = 0;
    Bot._stickX = hotX[pick]; Bot._stickY = hotY[pick]; Bot._stickOk = true;
    return pick;
  }

  /* One bullet-sized lattice around a point, keeping the nearest cell whose
   * flight path is not absorbed on the way in (Encore's stolen HUD arcs,
   * Constellation's taut lines, Compactor's seams). 49 hitTests, so it is
   * cheap enough to run EVERY frame on the last known soft spot — which is
   * what lets the bot stay on a moving weak point (the Tide's eyes ride a
   * sheet across the arena) instead of re-finding it eight times a second and
   * shooting at where it used to be. */
  var SOFT_MAX = FINE_N * FINE_N;
  var softX = new Float32Array(SOFT_MAX), softY = new Float32Array(SOFT_MAX);
  function fineAround(b, cx, cy) {
    var px = NA.Player.x, py = NA.Player.y;
    var bx = 0, by = 0, bd = 1e18, ax2 = 0, ay2 = 0, bdAny = 1e18;
    var half = (FINE_N - 1) * 0.5, res, sn = 0;
    for (var gy = 0; gy < FINE_N; gy++) {
      for (var gx = 0; gx < FINE_N; gx++) {
        var qx = cx + (gx - half) * FINE_STEP;
        var qy = cy + (gy - half) * FINE_STEP;
        res = 0;
        try { res = b.def.hitTest(b, qx, qy, FINE_R); } catch (e) { return false; }
        if (res !== 1) continue;
        softX[sn] = qx; softY[sn] = qy; sn++;
        var dx = qx - px, dy = qy - py, d2 = dx * dx + dy * dy;
        if (d2 < bdAny) { bdAny = d2; ax2 = qx; ay2 = qy; }
        if (d2 < bd && pathClear(b, qx, qy)) { bd = d2; bx = qx; by = qy; }
      }
    }
    if (bd >= 1e18) { bx = ax2; by = ay2; bd = bdAny; }
    if (bd >= 1e18) { Bot._trackOk = false; return false; }
    /* Take the CENTROID of the soft cells around the winner, not the winner.
     * A single lattice cell snaps in FINE_STEP jumps, and a target tracked in
     * 46-unit steps has no usable velocity — the aim lead was estimating the
     * lattice's stair-stepping instead of the weak point's motion. The cluster
     * mean moves continuously and sits on the middle of the soft spot, which
     * is also where a bullet is most likely to connect. */
    var near = FINE_STEP * 1.6, near2 = near * near, sx = 0, sy = 0, sc = 0;
    for (var i = 0; i < sn; i++) {
      var ddx = softX[i] - bx, ddy = softY[i] - by;
      if (ddx * ddx + ddy * ddy > near2) continue;
      sx += softX[i]; sy += softY[i]; sc++;
    }
    if (sc > 1) { bx = sx / sc; by = sy / sc; }
    /* Then bisect the soft spot's own edges. The lattice can only ever report
     * a multiple of FINE_STEP, and a 46-unit quantum in the MEASUREMENT is a
     * 700 u/s quantum in the velocity estimated from it — which is most of the
     * lead. Four binary searches out to the soft/hard boundary put the centre
     * within a couple of units and make the lead worth computing at all. */
    if (softCentre(b, bx, by)) { bx = CEN.x; by = CEN.y; }
    Bot._trackX = bx; Bot._trackY = by;
    aimLead(bx, by);
    Bot._trackOk = true; Bot._probeOk = true;
    return true;
  }

  /* Binary-search the soft/hard boundary along one direction. */
  var EDGE_ITER = 6, EDGE_MAX = 190;
  var CEN = { x: 0, y: 0 };
  function softEdge(b, cx, cy, ux, uy) {
    var lo = 0, hi = EDGE_MAX, mid, res;
    for (var i = 0; i < EDGE_ITER; i++) {
      mid = (lo + hi) * 0.5;
      res = 0;
      try { res = b.def.hitTest(b, cx + ux * mid, cy + uy * mid, FINE_R); } catch (e) { return lo; }
      if (res === 1) lo = mid; else hi = mid;
    }
    return lo;
  }
  function softCentre(b, cx, cy) {
    var res = 0;
    try { res = b.def.hitTest(b, cx, cy, FINE_R); } catch (e) { return false; }
    if (res !== 1) return false;
    var ex = softEdge(b, cx, cy, 1, 0), wx2 = softEdge(b, cx, cy, -1, 0);
    var ny = softEdge(b, cx, cy, 0, 1), sy2 = softEdge(b, cx, cy, 0, -1);
    // a boundary that ran to the search limit says nothing about the middle
    var ox = (ex >= EDGE_MAX - 1 || wx2 >= EDGE_MAX - 1) ? 0 : (ex - wx2) * 0.5;
    var oy = (ny >= EDGE_MAX - 1 || sy2 >= EDGE_MAX - 1) ? 0 : (ny - sy2) * 0.5;
    CEN.x = cx + ox; CEN.y = cy + oy;
    return true;
  }

  var PATH_STEPS = 7;
  function pathClear(b, qx, qy) {
    var sx = NA.Player.x, sy = NA.Player.y;
    for (var k = 1; k < PATH_STEPS; k++) {
      var t = k / PATH_STEPS;
      var mx = sx + (qx - sx) * t, my = sy + (qy - sy) * t;
      var r = 0;
      try { r = b.def.hitTest(b, mx, my, 6); } catch (e) { return true; }
      if (r === 2) return false;
    }
    return true;
  }

  function aimAt(wx, wy) {
    Bot.aimX = wx; Bot.aimY = wy;
    NA.Cam.worldToScreen(wx, wy, SCR);
    NA.Input.mouse.x = SCR.x; NA.Input.mouse.y = SCR.y;
  }

  /* ---- aim lead ------------------------------------------------------
   * Aiming at where a weak point IS misses everything that moves: the
   * Cartographer's rim marks cross a third of the arena during one bullet's
   * flight. So the bot estimates the target's velocity from consecutive
   * frames (in SIM seconds — Time.t, not the wall clock, because ?fast=N only
   * speeds the sim) and leads by range / bulletSpeed.
   *
   * Two models are estimated from the same samples — a straight line and a
   * circle about the arena centre — because a rim rider's tangent leaves the
   * arena inside a single bullet's flight. Both are single smoothed slots, no
   * allocation. A jump larger than LEAD_JUMP means the target identity changed
   * (a different weak point, or a fresh acquisition after the track was lost)
   * and the estimate is dropped rather than spiking. */
  var LEAD_JUMP = 260, LEAD_MAXT = 0.5, LEAD_K = 0.30, LEAD_VMAX = 2600;
  var LEAD_WMAX = 7.0, LEAD_ERR_K = 0.25;
  var LEAD_KA = 0.22;   // the angular rate is nearly constant: track it harder
  var LO = { x: 0, y: 0 };

  function resetLead() {
    Bot._leadOk = false; Bot._leadT = -1; Bot._predOk = false; Bot._nextOk = false;
    Bot._leadVX = 0; Bot._leadVY = 0;
    Bot._leadDR = 0; Bot._leadDA = 0;
    Bot._errL = 0; Bot._errP = 0;
  }

  /* Predict the target's position t seconds from now into LO, with whichever
   * of the two models is currently winning. */
  function leadPredict(wx, wy, t, polar) {
    if (polar) {
      var a = Bot._leadA + Bot._leadDA * t;
      var r = Bot._leadR + Bot._leadDR * t;
      if (r < 0) r = 0;
      LO.x = NA.Arena.cx + Math.cos(a) * r;
      LO.y = NA.Arena.cy + Math.sin(a) * r;
    } else {
      LO.x = wx + Bot._leadVX * t;
      LO.y = wy + Bot._leadVY * t;
    }
  }

  /* Aim at where the target will be `extra + flight` seconds from the last
   * sample. Two passes: time the flight to where the target is, predict, then
   * time the flight to the PREDICTED point and predict again — one iteration
   * is enough to stop a crossing target's lead from lagging its own range. */
  function solveAim(extra) {
    var wx = Bot._leadX, wy = Bot._leadY, polar = Bot._leadPolar;
    var st = NA.Player.stats, sp = Math.max(1, (st && st.bulletSpeed) || C.BULLET_SPEED);
    leadPredict(wx, wy, extra, polar);
    var rx = LO.x - NA.Player.x, ry = LO.y - NA.Player.y;
    var t = Math.sqrt(rx * rx + ry * ry) / sp;
    if (t > LEAD_MAXT) t = LEAD_MAXT;
    leadPredict(wx, wy, extra + t, polar);
    rx = LO.x - NA.Player.x; ry = LO.y - NA.Player.y;
    t = Math.sqrt(rx * rx + ry * ry) / sp;
    if (t > LEAD_MAXT) t = LEAD_MAXT;
    leadPredict(wx, wy, extra + t, polar);
    aimAt(LO.x, LO.y);
  }

  /* The bot only gets to think once a frame, but the sim runs eight fixed
   * steps inside one — and at ?fast=4 a frame is 66 ms of SIM time, in which
   * the Cartographer's stylus travels a quarter of the arena. An aim held for
   * a whole frame therefore misses everything fast, and the run looks like a
   * bot that cannot shoot when it is really a bot that cannot look. So the
   * prediction (which is a closed form in time, and costs no hitTest) is
   * re-evaluated before every fixed step, from the same sample. */
  var _playerUpdate = NA.Player.update;
  NA.Player.update = function (dt) {
    if (Bot.on && Bot._aimTrack) { Bot._subT += dt; solveAim(Bot._subT); }
    return _playerUpdate.apply(this, arguments);
  };

  function aimLead(wx, wy) {
    var tn = NA.Time.t, sdt = Bot._leadT >= 0 ? tn - Bot._leadT : 0;
    var cx = NA.Arena.cx, cy = NA.Arena.cy;
    var a = Math.atan2(wy - cy, wx - cx), r = Math.sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy));
    if (Bot._leadOk && sdt > 1e-4) {
      var dx = wx - Bot._leadX, dy = wy - Bot._leadY;
      if (dx * dx + dy * dy > LEAD_JUMP * LEAD_JUMP) resetLead();   // a different target
      else {
        // score last frame's two guesses against what actually happened
        if (Bot._predOk) {
          var eL = Math.abs(Bot._pLx - wx) + Math.abs(Bot._pLy - wy);
          var eP = Math.abs(Bot._pPx - wx) + Math.abs(Bot._pPy - wy);
          Bot._errL += (eL - Bot._errL) * LEAD_ERR_K;
          Bot._errP += (eP - Bot._errP) * LEAD_ERR_K;
        }
        // model 1: straight line
        Bot._leadVX += (dx / sdt - Bot._leadVX) * LEAD_K;
        Bot._leadVY += (dy / sdt - Bot._leadVY) * LEAD_K;
        var vm = Bot._leadVX * Bot._leadVX + Bot._leadVY * Bot._leadVY;
        if (vm > LEAD_VMAX * LEAD_VMAX) {
          var vs = LEAD_VMAX / Math.sqrt(vm);
          Bot._leadVX *= vs; Bot._leadVY *= vs;
        }
        // model 2: a circle about the arena centre (every rim rider)
        var da = M.norm(a - Bot._leadA);
        Bot._leadDA += (da / sdt - Bot._leadDA) * LEAD_KA;
        Bot._leadDR += ((r - Bot._leadR) / sdt - Bot._leadDR) * LEAD_KA;
        if (Bot._leadDA > LEAD_WMAX) Bot._leadDA = LEAD_WMAX;
        else if (Bot._leadDA < -LEAD_WMAX) Bot._leadDA = -LEAD_WMAX;
        if (Bot._leadDR > LEAD_VMAX) Bot._leadDR = LEAD_VMAX;
        else if (Bot._leadDR < -LEAD_VMAX) Bot._leadDR = -LEAD_VMAX;
      }
    }
    Bot._leadX = wx; Bot._leadY = wy; Bot._leadA = a; Bot._leadR = r;
    Bot._leadT = tn; Bot._leadOk = true;

    /* Which model to trust. The geometry decides first: when most of the
     * target's speed is TANGENTIAL about the arena centre it is riding a
     * circle (every rim weak point does), and a straight-line lead would fly
     * off on the tangent — over a 0.3 s flight the Cartographer's stylus turns
     * half a radian, which is the whole width of the arena. Only when the two
     * models disagree about nothing does the measured error break the tie: each
     * one predicted this frame's position last frame, and the smoothed error of
     * those guesses picks the winner. */
    var tang = Math.abs(Bot._leadDA) * r;
    var spd = Math.sqrt(Bot._leadVX * Bot._leadVX + Bot._leadVY * Bot._leadVY);
    var polar = r > 120 && tang > 0.55 * spd ? true
      : (r > 120 && tang > 0.25 * spd ? Bot._errP < Bot._errL : false);
    // "it is orbiting fast enough that the ship can never catch it up"
    Bot._leadOrbit = polar && tang > 700;
    Bot._leadPolar = polar; Bot._subT = 0; Bot._aimTrack = true;
    solveAim(0);

    // and file both guesses for next frame's scoring
    if (sdt > 1e-4) {
      leadPredict(wx, wy, sdt, false); Bot._pLx = LO.x; Bot._pLy = LO.y;
      leadPredict(wx, wy, sdt, true); Bot._pPx = LO.x; Bot._pPy = LO.y;
      Bot._predOk = true;
      /* Where the lattice should look NEXT frame. A frame of ?fast=4 is 66 ms
       * of sim time and the stylus covers 230 units in it — further than the
       * lattice is wide — so a tracker that re-probes around the LAST position
       * loses the weak point every single frame and falls back to the 8 Hz
       * arena sweep. Probing around the prediction keeps the lock. */
      Bot._nextX = polar ? Bot._pPx : Bot._pLx;
      Bot._nextY = polar ? Bot._pPy : Bot._pLy;
      Bot._nextOk = true;
    } else { Bot._predOk = false; Bot._nextOk = false; }
  }

  var In = NA.Input;
  var _axis = In.axis;
  In.axis = function () {
    if (Bot.on) { In._ax.x = Bot.moveX; In._ax.y = Bot.moveY; return In._ax; }
    return _axis.call(this);
  };

  Bot.tick = function (dt) {
    var G = NA.Game; if (!G) return;
    var Pl = NA.Player;
    var s = G.state;
    if (wantGod && Pl.alive && Pl.hp < Pl.maxHp) Pl.hp = Pl.maxHp;

    // the bot never lets the game sit on a modal it did not open
    if (G.paused) { In.pressedSet.pause = 1; In.down.pause = false; }

    Bot.moveX = 0; Bot.moveY = 0; Bot._aimTrack = false;
    In.down.fire = false; In.down.dash = false; In.down.active = false;
    if (Bot.dashCd > 0) Bot.dashCd -= dt;
    Bot.note = s;

    var px = Pl.x, py = Pl.y, ax;

    if (s === 'title' || s === 'death' || s === 'ending') {
      // hold "any input" so hold-to-skip screens fast-forward, then fly the gate
      In.holdTime = Math.max(In.holdTime, 1.0);
      var g = null;
      if (NA.UI.gate && NA.UI.gate.active) g = NA.UI.gate;
      if (g) ax = moveToward(px, py, g.x, g.y);
      else ax = moveToward(px, py, NA.Arena.cx, NA.Arena.cy);
      Bot.moveX = ax.x; Bot.moveY = ax.y;
      aimAt(px + 200, py);
      // death also accepts confirm; press it once a second as a belt-and-braces
      if (s === 'death' && G.stateT > 1.4) { Bot.activeT += dt; if (Bot.activeT > 1) { Bot.activeT = 0; In.pressedSet.confirm = 1; } }
      return;
    }

    if (s === 'draft') {
      Bot.draftT += dt;
      if (Bot.draftT > 0.5 && NA.Draft.active) {
        Bot.draftT = 0;
        if (NA.Draft.offers && NA.Draft.offers.length) NA.Draft.pick(0);
        else NA.Draft.skip();
      }
      aimAt(px + 200, py);
      return;
    }
    Bot.draftT = 0;

    if (s === 'pause') { In.pressedSet.pause = 1; return; }

    // ---- combat states -------------------------------------------------
    if (s !== 'wave' && s !== 'boss' && s !== 'overview' && s !== 'lastkill' && s !== 'sweep') {
      aimAt(px + 200, py);
      return;
    }

    // ---- aim ----------------------------------------------------------
    /* Bosses do not keep their weak point at b.x/b.y — stars, seams, limbs and
     * shields all live somewhere else, and some of them EAT projectiles. The
     * bot cannot probe hitTest (a few of them have side effects), so it uses
     * the health bar as its only feedback: hold an aim that is landing damage,
     * and when the bar stops moving, alternate between the live minions (the
     * 'shy' mutator makes those the real target) and a spiral sweep of the
     * boss's neighbourhood until something bites again. */
    var b = NA.Bosses.active;
    if (b && b.state === 'fight') {
      if (b.hp < Bot._bossHp - 0.001) { Bot._bossHp = b.hp; Bot._noDmgT = 0; }
      else Bot._noDmgT += dt;
      if (Bot._bossHp === 1e9) Bot._bossHp = b.hp;
      if (!b.def.hitTest) {
        // a plain radius body: the centre is always the answer
        aimLead(b.x, b.y);
        Bot._holdX = 0; Bot._holdY = 0;
      } else if (probeBoss(b, dt)) {
        /* hitTest told us where the soft spot is, this frame. The probe is
         * preferred over the "hold what is landing" heuristic whenever a
         * fight exposes a hitTest: an offset from b.x/b.y does not track a
         * weak point that moves independently of the body (the Tide's eyes
         * ride a sheet clean across the arena), and holding a stale offset
         * for 0.7 s after every miss was most of that fight's running time. */
        Bot._holdX = Bot.aimX - b.x; Bot._holdY = Bot.aimY - b.y;
      } else if (Bot._noDmgT < 0.7) {
        // the probe found nothing: hold the last offset that was landing
        aimAt(b.x + Bot._holdX, b.y + Bot._holdY);
      } else {
        var alt = ((NA.Time.real / 2.0) | 0) & 1;
        var mi = NA.Enemies.n ? NA.Enemies.nearestTo(px, py, 1800) : -1;
        if (alt && mi >= 0) aimAt(NA.Enemies.x[mi], NA.Enemies.y[mi]);
        else {
          // an outward spiral around the boss, one full turn every ~1.3s
          Bot.sweepA += dt * 4.8;
          Bot.sweepR += dt * 190;
          if (Bot.sweepR > NA.Arena.radius * 0.75) Bot.sweepR = 0;
          aimAt(b.x + Math.cos(Bot.sweepA) * Bot.sweepR,
            b.y + Math.sin(Bot.sweepA) * Bot.sweepR);
        }
        Bot._holdX = Bot.aimX - b.x; Bot._holdY = Bot.aimY - b.y;
      }
    } else {
      Bot._bossHp = 1e9; Bot._noDmgT = 0; Bot.sweepR = 0; Bot._trackOk = false;
      Bot._stickOk = false; Bot._chT = 0;
      /* No range cap: the last enemy of a wave is regularly on the opposite
       * rim, which is 3800 units away, and a bot that cannot see it aims at
       * the middle of an empty arena until the watchdog kills the run. */
      var ei = nearestEnemyAny(px, py);
      if (ei >= 0) {
        aimLead(NA.Enemies.x[ei], NA.Enemies.y[ei]);
        huntX = NA.Enemies.x[ei]; huntY = NA.Enemies.y[ei];
        /* Hysteresis: without it the ship closes to just inside HUNT_ENGAGE,
         * drops the pull, drifts back to the middle on the centre term, and
         * re-acquires — an orbit around the engage radius that never gets
         * close enough to actually land shots. Once hunting, stay hunting
         * until the target is at knife range. */
        var hr = huntWas ? HUNT_HOLD : HUNT_ENGAGE;
        huntOn = huntD2 > hr * hr;
        Bot.note = huntOn ? s + ':hunt' : s;
        if (huntOn !== huntWas) {
          huntWas = huntOn;
          if (huntOn) diag('hunt ' + NA.Enemies.typeOf(ei).id + ' n=' + NA.Enemies.n +
            ' d=' + Math.sqrt(huntD2).toFixed(0) +
            ' at ' + huntX.toFixed(0) + ',' + huntY.toFixed(0) +
            ' hp=' + NA.Enemies.hp[ei].toFixed(0));
        }
      } else { resetLead(); aimAt(NA.Arena.cx, NA.Arena.cy); huntOn = false; }
      Bot._holdX = 0; Bot._holdY = 0;
    }

    In.down.fire = true;

    /* close the range on whatever we are shooting at (see scoreDir) */
    pullOn = false; pullStand = STANDOFF; pullW = PULL;
    if (b && b.state === 'fight') {
      if (Bot._trackOk) {
        pullX = Bot._trackX; pullY = Bot._trackY; pullOn = true; Bot._pullT = 4;
        pullBand = Bot._leadOrbit ? Math.max(140, Bot._leadR - STANDOFF) : 0;
      } else if (!b.def.hitTest) { pullX = b.x; pullY = b.y; pullOn = true; Bot._pullT = 0; pullBand = 0; }
      else if (Bot._pullT > 0) {
        /* The soft spot went cold (the Cartographer's stylus only exists while
         * it is drawing). Hold station where it last was rather than drifting
         * back to the middle: it comes round again, and a shot from 200 units
         * away lands where a shot from across the arena never can. */
        Bot._pullT -= dt; pullOn = true;
      }
    } else {
      Bot._pullT = 0;
      /* Nothing left within weapons range: go and get it. The weight beats the
       * arena-centre pull but stays under the membrane repulsion, so the ship
       * closes to the rim band and shoots from there rather than parking on
       * the membrane. Threat costs are an order of magnitude larger at contact
       * range, so this never overrides a dodge. */
      if (huntOn) {
        pullX = huntX; pullY = huntY; pullBand = 0; pullOn = true;
        pullStand = HUNT_STAND; pullW = HUNT_PULL;
      }
    }
    ax = chooseMove(px, py, Pl.stats.speed);
    Bot.moveX = ax.x; Bot.moveY = ax.y;

    /* ---- timed-dash bosses -------------------------------------------
     * A fight whose only opening is a dash inside a short window (the Siren)
     * cannot be played by dashing on a fixed rhythm: the rhythm and the song
     * are both deterministic, so they alias and the bot can miss every window
     * for minutes. Such a boss publishes two read-only hints on its instance —
     * b.dashHintT (seconds until the window opens) and b.dashWindowOpen — and
     * the bot spends its dash on those and banks mana in between. */
    var hintT = (b && b.state === 'fight' && typeof b.dashHintT === 'number') ? b.dashHintT : -1;
    var windowOpen = hintT >= 0 && !!b.dashWindowOpen;
    var windowSoon = hintT >= 0 && (windowOpen || hintT <= 0.10);

    if (windowSoon && Pl.dashT <= 0 && Pl.mana >= Pl.stats.dashCost) {
      // aim and steer at the boss so the dash also carries the ship in
      var hdx = b.x - px, hdy = b.y - py;
      var hd = Math.sqrt(hdx * hdx + hdy * hdy);
      if (hd > 40) { Bot.moveX = hdx / hd; Bot.moveY = hdy / hd; }
      In.pressedSet.dash = 1; In.down.dash = true;
      Bot.dashCd = 0.25;
      Bot.note = s + ':window';
    } else

    // dash out of an incoming bullet (survival still outranks banking mana)
    if (Bot.dashCd <= 0 && Pl.dashT <= 0 && Pl.mana >= Pl.stats.dashCost + 2 &&
      incomingBullet(px, py, 60) >= 0) {
      In.pressedSet.dash = 1; In.down.dash = true;
      Bot.dashCd = 0.45;
    } else if (b && b.state === 'fight' && Bot._noDmgT > 1.2 && Bot.dashCd <= 0 &&
      Pl.dashT <= 0 && Pl.mana >= Pl.stats.dashCost + 8 && hintT < 0) {
      /* Shooting is not the only way in. Several fights want the ship to pass
       * THROUGH the soft spot (the Tide's eyes tear on a clean dash), so when
       * the health bar has not moved the bot charges whatever the probe found. */
      /* Charge the tracked soft spot if we have one, otherwise the body:
       * a fight whose hitTest absorbs everything (the Siren is only damageable
       * while a dash has interrupted its song) never gives the probe a target,
       * and the spiral aim would send the dash off into empty arena. */
      var ctx2 = Bot._trackOk ? Bot.aimX : b.x, cty = Bot._trackOk ? Bot.aimY : b.y;
      var adx = ctx2 - px, ady = cty - py;
      var ad = Math.sqrt(adx * adx + ady * ady);
      /* Dash regardless of range. Some fights want the ship to pass THROUGH
       * the soft spot (the Tide's eyes tear on a clean dash) and some only
       * care that a dash HAPPENED inside a window (the Siren's song is
       * interrupted by any dash at all, wherever the ship is) — so a dash that
       * is out of charging range is still the right move, it just steers with
       * whatever direction the dodge picked. */
      if (ad > 40) { Bot.moveX = adx / ad; Bot.moveY = ady / ad; }
      In.pressedSet.dash = 1; In.down.dash = true;
      Bot.dashCd = 0.6;
    }

    // the active key every few seconds
    Bot.activeT += dt;
    if (Bot.activeT > 3) {
      Bot.activeT = 0;
      In.pressedSet.active = 1; In.down.active = true;
    }
  };

  // run after the real poll so the bot's decisions win for this frame
  var _poll = In.poll;
  In.poll = function (dt) {
    _poll.call(this, dt);
    try { Bot.tick(dt); } catch (e) {
      if (typeof console !== 'undefined') console.error('[NA] bot: ' + (e && e.stack ? e.stack : e));
      Bot.on = false;
    }
  };

  // the bot is a player, so autofire is redundant but harmless; keep the
  // reticle off so it never draws over a screenshot
  if (NA.Store && NA.Store.settings) NA.Store.settings.autofire = 1;
})();
