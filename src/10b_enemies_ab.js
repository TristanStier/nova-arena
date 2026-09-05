/* 10b_enemies_ab.js — Band A and Band B enemy types + the twelve mutator
 * behaviours.  Loads after 10_enemies.js (which owns the framework and the two
 * reference types, mote and spitter).
 *
 * Types defined here (GAME_PLAN §7):
 *   Band A : drifter skitter popper (+ moteling) lancer charger
 *   Band B : shade constrictor sentinel mortar bloat sower
 *
 * Also implemented here, as additive wrappers around the framework:
 *   - all 12 mutator behaviours (volatile is the framework's; the other 11 and
 *     the diamond-outline + rim-colour render are here)
 *   - enemy bullets flagged ENEMYHURT damaging enemies (Spitter bolts kill
 *     Motes in front of them)
 *   - Sentinel / Shrouded domes fizzling player bullets that cross in from
 *     outside
 *   - hard simultaneous caps per type
 *   - shared sub-systems: Sower mines, deferred death flares (Bloat), slow
 *     fields (Sentinel dome collapse)
 *
 * Dev param:  ?spawn=charger:5,shade:10   spawns those at the rim at boot.
 */
(function () {
  var M = NA.M, C = NA.C, COL = C.COL;
  var En = NA.Enemies, P = En.pool;

  /* ------------------------------------------------------------- constants */
  var MUT = En.MUT;
  var HUSK = 1;                     // NA.Enemies.flags bit: risen husk (drawn grey)
  var MIRRORED = 2;                 // mirror mutator already spent
  En.EFLAG = { HUSK: HUSK, MIRRORED: MIRRORED };

  // simultaneous hard caps from GAME_PLAN §7 / the brief
  var CAP = {
    charger: 12, lancer: 30, shade: 60, constrictor: 3,
    sentinel: 8, mortar: 20, bloat: 25
  };
  var capIdx = null;                // typeIndex -> cap, built lazily

  /* --------------------------------------------------------------- scratch */
  var TMP = { x: 0, y: 0 };
  var magX = new Float32Array(8), magY = new Float32Array(8), magN = 0;

  /* =====================================================================
   * small shared helpers
   * ===================================================================== */

  function edgeAt(x, y) {
    return NA.Arena.radiusAt(Math.atan2(y - NA.Arena.cy, x - NA.Arena.cx));
  }
  function depthOf(i) {
    var dx = P.x[i] - NA.Arena.cx, dy = P.y[i] - NA.Arena.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    return NA.Arena.radiusAt(Math.atan2(dy, dx)) - d;
  }
  /* Point → segment squared distance.  Used by lasers and tether beams. */
  function distSeg2(px, py, x1, y1, x2, y2) {
    var vx = x2 - x1, vy = y2 - y1;
    var wx = px - x1, wy = py - y1;
    var vv = vx * vx + vy * vy;
    var t = vv > 0 ? (wx * vx + wy * vy) / vv : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = x1 + vx * t - px, cy = y1 + vy * t - py;
    return cx * cx + cy * cy;
  }
  /* Push an enemy, unless it is Anchored (immune to push/pull). */
  function shove(i, ax, ay) {
    if (P.mut[i] & MUT.ANCHORED) return;
    P.vx[i] += ax; P.vy[i] += ay;
  }
  En.shove = shove;

  /* Steer toward/away from a point holding a band distance.  No allocation. */
  function bandSeek(i, dt, want, speed, strafe) {
    var dx = NA.Player.x - P.x[i], dy = NA.Player.y - P.y[i];
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var tx = dx / dist, ty = dy / dist;
    var radial = M.clamp((dist - want) / (want * 0.5), -1, 1);
    var s = strafe || 0;
    var vx = tx * radial - ty * s, vy = ty * radial + tx * s;
    var l = Math.sqrt(vx * vx + vy * vy) || 1;
    P.vx[i] = M.smooth(P.vx[i], vx / l * speed, 5, dt);
    P.vy[i] = M.smooth(P.vy[i], vy / l * speed, 5, dt);
    TMP.x = tx; TMP.y = ty;
    return dist;
  }

  /* =====================================================================
   * Sub-systems: mines, deferred flares, slow fields
   * ===================================================================== */

  /* --- Sower mines: a static circle pool, hard cap 250 ------------------ */
  var MINE_CAP = 250, MINE_ARM = 1.0, MINE_LIFE = 20, MINE_R = 70, MINE_DMG = 25;
  var Mines = NA.Pool.create(MINE_CAP, { x: 'f32', y: 'f32', t: 'f32' });

  function addMine(x, y) {
    var k = Mines.alloc();
    if (k < 0) { Mines.free(0); k = Mines.alloc(); }      // oldest-ish out
    if (k < 0) return;
    Mines.x[k] = x; Mines.y[k] = y; Mines.t[k] = 0;
    if (NA.Audio) NA.Audio.sfx('telegraph', { x: x, y: y, vol: 0.25 });
  }
  function blowMine(k) {
    var x = Mines.x[k], y = Mines.y[k];
    Mines.free(k);
    NA.Particles.ring(x, y, 8, MINE_R, 0.3, 4, COL.green[0], COL.green[1], COL.green[2], 1);
    queueExplode(x, y, MINE_R, MINE_DMG);
  }
  function updateMines(dt) {
    var parity = NA.Time.frames & 3;
    var pl = NA.Player;
    for (var k = 0; k < Mines.n; k++) {
      Mines.t[k] += dt;
      if (Mines.t[k] >= MINE_LIFE) {
        NA.Particles.burst(Mines.x[k], Mines.y[k], 3, 70, 0.3, COL.green[0], COL.green[1], COL.green[2], 0);
        Mines.free(k); k--; continue;
      }
      if (Mines.t[k] < MINE_ARM) continue;                 // still arming
      var mx = Mines.x[k], my = Mines.y[k];
      if (pl && pl.alive) {
        var pdx = pl.x - mx, pdy = pl.y - my;
        if (pdx * pdx + pdy * pdy < 30 * 30) { blowMine(k); k--; continue; }
      }
      if ((k & 3) !== parity) continue;                    // enemy test at 1/4 rate
      var cnt = En.grid.query(mx, my, 34), out = En.grid.out, hit = false;
      for (var q = 0; q < cnt; q++) {
        var j = out[q];
        if (j >= P.n || P.intangible[j] > 0) continue;
        var jdx = P.x[j] - mx, jdy = P.y[j] - my, rr = P.size[j] + 12;
        if (jdx * jdx + jdy * jdy < rr * rr) { hit = true; break; }
      }
      if (hit) { blowMine(k); k--; }
    }
  }
  function renderMines() {
    var R = NA.R, L = R.L;
    var g = COL.green;
    var pl2 = NA.Player && NA.Player.alive;
    for (var k = 0; k < Mines.n; k++) {
      var t = Mines.t[k];
      var arm = M.clamp01(t / MINE_ARM);
      var fade = t > MINE_LIFE - 2 ? (MINE_LIFE - t) * 0.5 : 1;
      if (arm < 1) {
        // arming: a shrinking outer ring closes onto the body — a clear 1s tell
        R.ring(L.ENEMIES, Mines.x[k], Mines.y[k], 10 + (1 - arm) * 18, 1.2, g[0], g[1], g[2], 0.4 * fade);
        R.poly(L.ENEMIES, Mines.x[k], Mines.y[k], 8, 4, 0, 1.2, g[0] * 0.55, g[1] * 0.55, g[2] * 0.55, 0.5 * fade);
      } else {
        // armed: dim by default so a minefield stays background texture, and it
        // only brightens when the ship is close enough for it to matter
        var pulse = 0.5 + 0.5 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ + k);
        var near = pl2 ? M.clamp01(1 - M.dist2(Mines.x[k], Mines.y[k], NA.Player.x, NA.Player.y) / 90000) : 0;
        var aa = (0.26 + pulse * 0.12 + near * 0.45) * fade;
        R.ring(L.ENEMIES, Mines.x[k], Mines.y[k], 10, 1.4, g[0], g[1], g[2], aa);
        R.dot(L.ENEMIES, Mines.x[k], Mines.y[k], 2.4, g[0], g[1], g[2], aa * 0.9);
      }
    }
  }

  /* --- deferred death flares (Bloat): telegraph, then explode ----------- */
  var FLARE_CAP = 48;
  var flareX = new Float32Array(FLARE_CAP), flareY = new Float32Array(FLARE_CAP);
  var flareT = new Float32Array(FLARE_CAP), flareR = new Float32Array(FLARE_CAP);
  var flareD = new Float32Array(FLARE_CAP), flareDur = new Float32Array(FLARE_CAP);
  var flareN = 0;

  function addFlare(x, y, r, dmg, dur) {
    if (flareN >= FLARE_CAP) return;
    var k = flareN++;
    flareX[k] = x; flareY[k] = y; flareT[k] = 0;
    flareR[k] = r; flareD[k] = dmg; flareDur[k] = dur;
  }
  function updateFlares(dt) {
    for (var k = 0; k < flareN; k++) {
      flareT[k] += dt;
      var dur = flareDur[k];
      En.telegraphCircle(flareX[k], flareY[k], flareR[k], flareT[k], dur, dur * 0.7);
      if (flareT[k] >= dur) {
        queueExplode(flareX[k], flareY[k], flareR[k], flareD[k]);
        NA.FX.trauma(0.12);
        flareN--;
        if (k !== flareN) {
          flareX[k] = flareX[flareN]; flareY[k] = flareY[flareN];
          flareT[k] = flareT[flareN]; flareR[k] = flareR[flareN];
          flareD[k] = flareD[flareN]; flareDur[k] = flareDur[flareN];
        }
        k--;
      }
    }
  }

  /* --- deferred explosions ---------------------------------------------
   * Volatile chains used to recurse (explode -> damageArea -> kill -> explode)
   * until the stack blew.  Everything explosive queues here instead and is
   * drained once per step, so a chain spreads over frames and stays readable. */
  var BOOM_CAP = 128;
  var boomX = new Float32Array(BOOM_CAP), boomY = new Float32Array(BOOM_CAP);
  var boomR = new Float32Array(BOOM_CAP), boomD = new Float32Array(BOOM_CAP);
  var boomN = 0;
  function queueExplode(x, y, r, dmg) {
    if (boomN >= BOOM_CAP) return;
    var k = boomN++;
    boomX[k] = x; boomY[k] = y; boomR[k] = r; boomD[k] = dmg;
  }
  function drainExplosions() {
    var run = boomN;                    // anything queued during the drain waits
    if (!run) return;
    if (run > 24) run = 24;
    for (var k = 0; k < run; k++) NA.Bullets.explode(boomX[k], boomY[k], boomR[k], boomD[k], 1);
    var left = boomN - run;
    for (var j = 0; j < left; j++) {
      boomX[j] = boomX[j + run]; boomY[j] = boomY[j + run];
      boomR[j] = boomR[j + run]; boomD[j] = boomD[j + run];
    }
    boomN = left;
  }

  /* --- slow fields (Sentinel dome collapse) ----------------------------- */
  var ZONE_CAP = 12;
  var zoneX = new Float32Array(ZONE_CAP), zoneY = new Float32Array(ZONE_CAP);
  var zoneR = new Float32Array(ZONE_CAP), zoneT = new Float32Array(ZONE_CAP);
  var zoneN = 0;
  function addSlowZone(x, y, r, life) {
    if (zoneN >= ZONE_CAP) return;
    var k = zoneN++;
    zoneX[k] = x; zoneY[k] = y; zoneR[k] = r; zoneT[k] = life;
  }
  function updateZones(dt) {
    var R = NA.R, L = R.L;
    for (var k = 0; k < zoneN; k++) {
      zoneT[k] -= dt;
      if (zoneT[k] <= 0) {
        zoneN--;
        if (k !== zoneN) { zoneX[k] = zoneX[zoneN]; zoneY[k] = zoneY[zoneN]; zoneR[k] = zoneR[zoneN]; zoneT[k] = zoneT[zoneN]; }
        k--; continue;
      }
      var zx = zoneX[k], zy = zoneY[k], zr = zoneR[k];
      var cnt = En.grid.query(zx, zy, zr), out = En.grid.out;
      var damp = 1 - Math.min(0.9, 4 * dt);
      for (var q = 0; q < cnt; q++) {
        var j = out[q];
        if (j >= P.n) continue;
        var dx = P.x[j] - zx, dy = P.y[j] - zy;
        if (dx * dx + dy * dy > zr * zr) continue;
        P.vx[j] *= damp; P.vy[j] *= damp;
      }
      var a = M.clamp01(zoneT[k]) * 0.55;
      R.ring(L.FLOOR, zx, zy, zr * (0.4 + 0.6 * M.clamp01(zoneT[k])), 3, COL.green[0], COL.green[1], COL.green[2], a);
    }
  }

  /* --- live dome registry (Sentinel + Shrouded) ------------------------- */
  var domeObjs = [];                     // reused objects, never re-allocated
  var domeN = 0;
  function pushDome(x, y, r, owner) {
    var o = domeObjs[domeN];
    if (!o) { o = domeObjs[domeN] = { x: 0, y: 0, r: 0, owner: -1, orad: 0 }; }
    o.x = x; o.y = y; o.r = r; o.owner = owner;
    // the owner's own hit radius: shots aimed at it are never fizzled, so the
    // dome protects everything inside except the thing projecting it
    o.orad = P.size[owner] + 6;
    domeN++;
    En.domes.push(o);
  }

  /* =====================================================================
   * BAND A
   * ===================================================================== */

  /* --- Drifter — pale-blue circle, Brownian wander, ignores you --------- */
  En.define('drifter', {
    shape: 'circle', color: [0.60, 0.80, 1.00],
    size: 12, hp: 8, speed: 58, cost: 1, band: 'A', retireWave: 7,
    flock: false, contact: 1, sides: 8, spawnTime: 0.5,
    init: function (i) { P.p0[i] = NA.RNG.f() * M.TAU; },
    update: function (i, dt) {
      // a slow random walk driven by deterministic value noise: no allocation,
      // no RNG draw per frame, and every drifter wanders differently
      P.p0[i] += M.noise1(NA.Time.t * 0.35 + P.seed[i]) * 2.4 * dt;
      var sp = 58;
      P.vx[i] = M.smooth(P.vx[i], Math.cos(P.p0[i]) * sp, 2.2, dt);
      P.vy[i] = M.smooth(P.vy[i], Math.sin(P.p0[i]) * sp, 2.2, dt);
      // turn away from the membrane so drifters spread instead of piling up
      if (depthOf(i) < 90) {
        var ia = Math.atan2(NA.Arena.cy - P.y[i], NA.Arena.cx - P.x[i]);
        P.p0[i] = M.lerpAngle(P.p0[i], ia, Math.min(1, 2 * dt));
      }
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a * 0.9);
      R.ring(L.ENEMIES, P.x[i], P.y[i], sz * 0.55, 1.2, cr, cg, cb, a * 0.5);
    }
  });

  /* --- Skitter — tiny white circle, fast erratic 0.25s bursts ----------- */
  var SKIT_BURST = 0.25;
  En.define('skitter', {
    // off-white: 10.1 keeps pure white for the ship core, your bullets and
    // whatever is about to kill you
    shape: 'circle', color: [0.94, 0.97, 1.0],
    size: 8, hp: 6, speed: 320, cost: 1, band: 'A', retireWave: 7,
    flock: false, contact: 1, sides: 6, spawnTime: 0.4,
    init: function (i) { P.p0[i] = NA.RNG.range(0, SKIT_BURST); P.p1[i] = NA.RNG.angle(); },
    update: function (i, dt) {
      P.p0[i] -= dt;
      if (P.p0[i] <= 0) {
        P.p0[i] = SKIT_BURST;
        // each burst re-aims: 60% at the player, 40% scatter — it leaks around
        // the Mote wall because it never commits to a straight line
        var want = Math.atan2(NA.Player.y - P.y[i], NA.Player.x - P.x[i]);
        P.p1[i] = want + (NA.RNG.f() - 0.5) * 2.2;
        P.vx[i] = Math.cos(P.p1[i]) * 320;
        P.vy[i] = Math.sin(P.p1[i]) * 320;
      } else {
        var k = 1 - Math.min(1, 3.2 * dt);
        P.vx[i] *= k; P.vy[i] *= k;
      }
      P.rot[i] = P.p1[i];
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      // the jagged trail: two short back-swept ticks, no particles needed
      var bx = P.x[i] - Math.cos(P.p1[i]) * sz * 2.4, by = P.y[i] - Math.sin(P.p1[i]) * sz * 2.4;
      var jag = Math.sin(NA.Time.t * 40 + P.seed[i]) * sz * 0.9;
      R.line(L.ENEMIES, P.x[i], P.y[i], bx - Math.sin(P.p1[i]) * jag, by + Math.cos(P.p1[i]) * jag,
        1.6, cr, cg, cb, a * 0.45);
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
    }
  });

  /* --- Moteling — the Popper's children -------------------------------- */
  En.define('moteling', {
    shape: 'circle', color: [0.72, 0.98, 1.00],
    size: 8, hp: 6, speed: 118, cost: 0, band: 'A',
    flock: true, contact: 1, separation: 1, cohesion: 0.22, spawnTime: 0.25, sides: 6,
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
    }
  });

  /* --- Popper — cyan circle with 3 dots; death makes 3 Motelings -------- */
  En.define('popper', {
    shape: 'circle', color: [0.30, 0.95, 1.00],
    size: 16, hp: 26, speed: 70, cost: 2, band: 'A', retireWave: 17,
    flock: true, contact: 1, separation: 1, cohesion: 0.10, sides: 8,
    onDeath: function (i) {
      var x = P.x[i], y = P.y[i];
      for (var k = 0; k < 3; k++) {
        var a = P.rot[i] + k * (M.TAU / 3);
        var j = En.spawn('moteling', x + Math.cos(a) * 20, y + Math.sin(a) * 20);
        if (j >= 0) { P.vx[j] = Math.cos(a) * 200; P.vy[j] = Math.sin(a) * 200; }
      }
      NA.Particles.ring(x, y, 6, 46, 0.26, 3, 0.30, 0.95, 1.00, 0.9);
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i] * (P.flash[i] > 0 ? 1.2 : 1);
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      // three dots: the payload is visible before you shoot it
      for (var k = 0; k < 3; k++) {
        var ang = P.rot[i] + k * (M.TAU / 3);
        R.dot(L.ENEMIES, P.x[i] + Math.cos(ang) * sz * 0.42, P.y[i] + Math.sin(ang) * sz * 0.42,
          sz * 0.16, 0.05, 0.10, 0.14, a);
      }
    }
  });

  /* --- Lancer — long orange needle, 1.0s aim / 0.7s lock / 0.25s laser -- */
  var LAN_RANGE = 400, LAN_AIM = 1.0, LAN_LOCK = 0.7, LAN_BEAM = 0.25, LAN_COOL = 1.1;
  En.define('lancer', {
    shape: 'needle', color: COL.orange,
    size: 16, hp: 30, speed: 165, cost: 4, band: 'A', retireWave: 12,
    flock: false, contact: 1, sides: 3,
    init: function (i) { P.state[i] = 0; P.t2[i] = NA.RNG.range(0, 0.6); },
    update: function (i, dt) {
      var st = P.state[i];
      if (st === 0) {                                   // approach the 400px band
        var dist = bandSeek(i, dt, LAN_RANGE, 165, 0.25);
        P.rot[i] = Math.atan2(TMP.y, TMP.x);
        P.t2[i] += dt;
        if (dist < LAN_RANGE * 1.25 && P.t2[i] > 0.5) { P.state[i] = 1; P.t2[i] = 0; }
      } else if (st === 1) {                            // aim 1.0s, lock at 0.7s
        P.vx[i] = M.smooth(P.vx[i], 0, 8, dt); P.vy[i] = M.smooth(P.vy[i], 0, 8, dt);
        if (P.t2[i] < LAN_LOCK) {                       // still tracking
          var ang = Math.atan2(NA.Player.y - P.y[i], NA.Player.x - P.x[i]);
          P.rot[i] = M.lerpAngle(P.rot[i], ang, Math.min(1, 9 * dt));
          P.p0[i] = P.rot[i];
        }
        var len = edgeAt(P.x[i], P.y[i]) * 2.2;
        var ex = P.x[i] + Math.cos(P.p0[i]) * len, ey = P.y[i] + Math.sin(P.p0[i]) * len;
        En.telegraphLine(P.x[i], P.y[i], ex, ey, P.t2[i], LAN_AIM, LAN_LOCK, 3);
        P.t2[i] += dt;
        if (P.t2[i] >= LAN_AIM) {
          P.state[i] = 2; P.t2[i] = 0; P.p1[i] = 0;
          if (NA.Audio) NA.Audio.sfx('laser', { x: P.x[i], y: P.y[i] });
          NA.FX.trauma(0.05);
        }
      } else if (st === 2) {                            // the beam: 0.25s
        P.vx[i] = 0; P.vy[i] = 0;
        var l2 = edgeAt(P.x[i], P.y[i]) * 2.2;
        var bx = P.x[i] + Math.cos(P.p0[i]) * l2, by = P.y[i] + Math.sin(P.p0[i]) * l2;
        // the laser passes through allies; only the player is on the hook
        if (P.p1[i] === 0 && NA.Player.alive) {
          if (distSeg2(NA.Player.x, NA.Player.y, P.x[i], P.y[i], bx, by) < 18 * 18) {
            if (NA.Player.damage(1, P.x[i], P.y[i])) P.p1[i] = 1;
          }
        }
        P.t2[i] += dt;
        if (P.t2[i] >= LAN_BEAM) { P.state[i] = 3; P.t2[i] = 0; }
      } else {                                          // cooldown, then re-aim
        bandSeek(i, dt, LAN_RANGE, 165, 0.35);
        P.t2[i] += dt;
        if (P.t2[i] >= LAN_COOL) { P.state[i] = 1; P.t2[i] = 0; }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      var st = P.state[i];
      if (st === 2) {
        // the beam itself, drawn white-hot over red: "the thing killing you"
        var k = 1 - P.t2[i] / LAN_BEAM;
        var l2 = edgeAt(P.x[i], P.y[i]) * 2.2;
        var bx = P.x[i] + Math.cos(P.p0[i]) * l2, by = P.y[i] + Math.sin(P.p0[i]) * l2;
        R.line(L.VEIL, P.x[i], P.y[i], bx, by, 16 * k, COL.red[0], COL.red[1], COL.red[2], 0.85 * k);
        R.line(L.VEIL, P.x[i], P.y[i], bx, by, 5 * k, 1, 1, 1, k);
      }
      // the needle body, long along its aim
      var ang = st >= 1 ? P.p0[i] : P.rot[i];
      R.sprite(L.ENEMIES, 'needle', P.x[i], P.y[i], ang + M.HALFPI, sz * 0.45, sz * 1.5, cr, cg, cb, a);
      var chg = st === 1 ? M.clamp01(P.t2[i] / LAN_AIM) : 0;
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * (0.18 + chg * 0.26),
        1, M.lerp(0.55, 0.18, chg), M.lerp(0.10, 0.30, chg), a * (0.6 + chg * 0.4));
    }
  });

  /* --- Charger — orange chevron with legs ------------------------------
   * jitters at 350-500px to bait shots, stops, 1.5s floor arrow locking at
   * 1.2s, then 600px at 3x speed, shoving allies aside; stuns on the wall. */
  var CH_SPEED = 175, CH_TELE = 1.5, CH_LOCK = 1.2, CH_DIST = 600, CH_STUN = 1.2;
  En.define('charger', {
    shape: 'chevron', color: COL.orange,
    size: 19, hp: 48, speed: CH_SPEED, cost: 6, band: 'A', retireWave: 17,
    flock: false, contact: 1, sides: 3, spawnTime: 0.6,
    init: function (i) { P.state[i] = 0; P.t2[i] = NA.RNG.range(0, 0.8); P.p1[i] = NA.RNG.range(350, 500); },
    update: function (i, dt) {
      var st = P.state[i];
      if (st === 0) {                                   // jitter, baiting shots
        var jit = M.noise1(NA.Time.t * 3.1 + P.seed[i]) * 1.4;
        var dist = bandSeek(i, dt, P.p1[i], CH_SPEED, jit);
        P.rot[i] = Math.atan2(P.vy[i], P.vx[i]);
        P.t2[i] += dt;
        if (P.t2[i] > 1.6 && dist < 620) { P.state[i] = 1; P.t2[i] = 0; }
      } else if (st === 1) {                            // stop dead
        P.vx[i] = M.smooth(P.vx[i], 0, 12, dt); P.vy[i] = M.smooth(P.vy[i], 0, 12, dt);
        P.t2[i] += dt;
        if (P.t2[i] >= 0.22) { P.state[i] = 2; P.t2[i] = 0; }
      } else if (st === 2) {                            // 1.5s arrow, lock 1.2s
        P.vx[i] = 0; P.vy[i] = 0;
        if (P.t2[i] < CH_LOCK) P.p0[i] = Math.atan2(NA.Player.y - P.y[i], NA.Player.x - P.x[i]);
        P.rot[i] = P.p0[i];
        En.telegraphArrow(P.x[i], P.y[i], P.p0[i], CH_DIST * 0.55, P.t2[i], CH_TELE, CH_LOCK);
        P.t2[i] += dt;
        if (P.t2[i] >= CH_TELE) {
          P.state[i] = 3; P.t2[i] = 0; P.p2[i] = 0;
          P.vx[i] = Math.cos(P.p0[i]) * CH_SPEED * 3;
          P.vy[i] = Math.sin(P.p0[i]) * CH_SPEED * 3;
          if (NA.Audio) NA.Audio.sfx('charge', { x: P.x[i], y: P.y[i] });
        }
      } else if (st === 3) {                            // the charge
        var sp = CH_SPEED * 3;
        P.vx[i] = Math.cos(P.p0[i]) * sp; P.vy[i] = Math.sin(P.p0[i]) * sp;
        P.p2[i] += sp * dt;
        P.rot[i] = P.p0[i];
        shoveAllies(i, sp * dt);
        NA.Particles.spawn(P.x[i], P.y[i], -P.vx[i] * 0.1, -P.vy[i] * 0.1, 0.18, 5,
          COL.orange[0], COL.orange[1], COL.orange[2], 0.7, 0, 3);
        if (depthOf(i) <= P.size[i] + 2) {               // slammed the membrane
          P.state[i] = 4; P.t2[i] = 0; P.vx[i] = P.vy[i] = 0;
          NA.Arena.ripple(P.x[i], P.y[i], 1.4, COL.orange[0], COL.orange[1], COL.orange[2]);
          NA.FX.trauma(0.18);
          NA.Particles.burst(P.x[i], P.y[i], 8, 260, 0.3, COL.orange[0], COL.orange[1], COL.orange[2], 1);
          if (NA.Audio) NA.Audio.sfx('wall', { x: P.x[i], y: P.y[i] });
        } else if (P.p2[i] >= CH_DIST) { P.state[i] = 0; P.t2[i] = 0; }
      } else {                                          // stunned: free damage
        P.vx[i] = M.smooth(P.vx[i], 0, 6, dt); P.vy[i] = M.smooth(P.vy[i], 0, 6, dt);
        P.rot[i] += 6 * dt;
        P.t2[i] += dt;
        if (P.t2[i] >= CH_STUN) { P.state[i] = 0; P.t2[i] = 0; }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      var st = P.state[i];
      if (st === 4) { var f = 0.5 + 0.5 * Math.sin(NA.Time.t * 22); cr = M.lerp(cr, 1, f * 0.5); cg = M.lerp(cg, 1, f * 0.5); cb = M.lerp(cb, 1, f * 0.5); }
      // legs: two short ticks trailing the chevron
      for (var s = -1; s <= 1; s += 2) {
        var la = P.rot[i] + s * 2.35;
        R.line(L.ENEMIES, P.x[i], P.y[i], P.x[i] + Math.cos(la) * sz * 1.25, P.y[i] + Math.sin(la) * sz * 1.25,
          2.2, cr * 0.8, cg * 0.8, cb * 0.8, a * 0.85);
      }
      R.sprite(L.ENEMIES, 'chevron', P.x[i], P.y[i], P.rot[i] + M.HALFPI, sz, sz, cr, cg, cb, a);
      if (st === 2) {
        var k = M.clamp01(P.t2[i] / CH_TELE);
        R.ring(L.ENEMIES, P.x[i], P.y[i], sz * (1.6 - k * 0.5), 2, 1, M.lerp(0.541, 0.18, k >= 0.8 ? 1 : 0), 0, a);
      }
    }
  });

  /* Charge shove: everything the charger runs through is pushed aside. */
  function shoveAllies(i, step) {
    var r = P.size[i] + 34;
    var cnt = En.grid.query(P.x[i], P.y[i], r), out = En.grid.out;
    for (var q = 0; q < cnt; q++) {
      var j = out[q];
      if (j === i || j >= P.n) continue;
      var dx = P.x[j] - P.x[i], dy = P.y[j] - P.y[i];
      var d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      var d = Math.sqrt(d2) || 1;
      var push = (1 - d / r) * step * 26;
      shove(j, dx / d * push, dy / d * push);
    }
  }

  /* =====================================================================
   * BAND B
   * ===================================================================== */

  /* --- Shade — invisible slow chaser, 2x contact ----------------------- */
  En.define('shade', {
    shape: 'circle', color: COL.violet,
    size: 14, hp: 30, speed: 72, cost: 3, band: 'B', retireWave: 23,
    flock: true, contact: 2, invisible: true, separation: 0.6, cohesion: 0.05,
    sides: 8, spawnTime: 0.6,
    onDeath: function (i) {
      // death reveals a violet ring, and hints at the neighbours you cannot see
      var x = P.x[i], y = P.y[i];
      NA.Particles.ring(x, y, 8, 260, 0.5, 3, COL.violet[0], COL.violet[1], COL.violet[2], 0.9);
      var cnt = En.grid.query(x, y, 420), out = En.grid.out;
      for (var q = 0; q < cnt; q++) {
        var j = out[q];
        if (j === i || j >= P.n || !P.invisible[j]) continue;
        if (P.hitT[j] < 0.7) P.hitT[j] = 0.7;            // reuse the reveal timer
      }
    },
    render: function (i, a, cr, cg, cb) {
      if (a <= 0.02) return;
      var R = NA.R, L = R.L, sz = P.size[i];
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      R.ring(L.ENEMIES, P.x[i], P.y[i], sz * 1.25, 1.4, cr, cg, cb, a * 0.5);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * 0.2, 1, 1, 1, a * 0.4);
    }
  });

  /* --- Constrictor — large magenta hexagon at the rim ------------------
   * every second the nearest wall steps 6px inward.  Not restored on death. */
  En.define('constrictor', {
    shape: 'hex', color: COL.magenta,
    size: 34, hp: 220, speed: 26, cost: 8, band: 'B', retireWave: 23,
    flock: false, contact: 1, sides: 6, spawnTime: 0.9, elite: true,
    init: function (i) { P.p0[i] = 1.0; P.p1[i] = NA.RNG.sign() * 0.16; },
    update: function (i, dt) {
      // hug the rim, sliding slowly along it
      var ang = Math.atan2(P.y[i] - NA.Arena.cy, P.x[i] - NA.Arena.cx);
      var want = NA.Arena.radiusAt(ang) - 70;
      var tx = NA.Arena.cx + Math.cos(ang + P.p1[i] * dt * 4) * want;
      var ty = NA.Arena.cy + Math.sin(ang + P.p1[i] * dt * 4) * want;
      var dx = tx - P.x[i], dy = ty - P.y[i], l = Math.sqrt(dx * dx + dy * dy) || 1;
      P.vx[i] = M.smooth(P.vx[i], dx / l * 26, 3, dt);
      P.vy[i] = M.smooth(P.vy[i], dy / l * 26, 3, dt);
      P.rot[i] += 0.5 * dt;

      P.p0[i] -= dt;
      if (P.p0[i] <= 0) {
        P.p0[i] = 1.0;
        NA.Arena.shrinkSide(ang, 6);                     // ~6px/s inward, cumulative
        NA.Arena.ripple(P.x[i], P.y[i], 0.8, COL.magenta[0], COL.magenta[1], COL.magenta[2]);
        if (NA.Audio) NA.Audio.sfx('telegraph', { x: P.x[i], y: P.y[i], vol: 0.3 });
      }
    },
    onDeath: function (i) {
      // a scar line across the wall it was eating: the arena keeps the loss
      var ang = Math.atan2(P.y[i] - NA.Arena.cy, P.x[i] - NA.Arena.cx);
      var r = NA.Arena.radiusAt(ang);
      var ax = NA.Arena.cx + Math.cos(ang - 0.16) * r, ay = NA.Arena.cy + Math.sin(ang - 0.16) * r;
      var bx = NA.Arena.cx + Math.cos(ang + 0.16) * r, by = NA.Arena.cy + Math.sin(ang + 0.16) * r;
      addScar(ax, ay, bx, by);
      NA.Particles.ring(P.x[i], P.y[i], 10, 120, 0.4, 4, COL.magenta[0], COL.magenta[1], COL.magenta[2], 1);
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      R.sprite(L.ENEMIES, 'hex', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      // three inward chevrons: the shape says "the wall is coming in"
      var ang = Math.atan2(NA.Arena.cy - P.y[i], NA.Arena.cx - P.x[i]);
      var pulse = 0.4 + 0.6 * (1 - M.clamp01(P.p0[i]));
      for (var k = -1; k <= 1; k++) {
        var o = ang + k * 0.5;
        R.line(L.ENEMIES, P.x[i] + Math.cos(o) * sz * 0.3, P.y[i] + Math.sin(o) * sz * 0.3,
          P.x[i] + Math.cos(o) * sz * 0.85, P.y[i] + Math.sin(o) * sz * 0.85,
          2.4, 1, 1, 1, a * pulse * 0.8);
      }
      R.poly(L.ENEMIES, P.x[i], P.y[i], sz * 1.2, 6, -P.rot[i] * 0.5, 1.6, cr, cg, cb, a * 0.4);
    }
  });

  /* Permanent-ish scars left where a Constrictor died. */
  var SCAR_CAP = 16;
  var scarA = new Float32Array(SCAR_CAP * 4), scarT = new Float32Array(SCAR_CAP), scarN = 0;
  function addScar(x1, y1, x2, y2) {
    if (scarN >= SCAR_CAP) { scarN = SCAR_CAP - 1; }
    var k = scarN++;
    scarA[k * 4] = x1; scarA[k * 4 + 1] = y1; scarA[k * 4 + 2] = x2; scarA[k * 4 + 3] = y2;
    scarT[k] = 0;
  }
  function renderScars() {
    var R = NA.R, L = R.L, m = COL.magenta;
    for (var k = 0; k < scarN; k++) {
      var a = 0.35 + 0.15 * Math.sin(NA.Time.t * 2 + k);
      R.line(L.MEMBRANE, scarA[k * 4], scarA[k * 4 + 1], scarA[k * 4 + 2], scarA[k * 4 + 3], 3, m[0], m[1], m[2], a);
    }
  }

  /* --- Sentinel — green hexagon with a 120px dome ---------------------- */
  var DOME_R = 120;
  En.define('sentinel', {
    shape: 'hex', color: COL.green,
    // GAME_PLAN act V: the Cathedral takes over the shielding role at 25
    size: 26, hp: 130, speed: 62, cost: 7, band: 'B', retireWave: 25,
    flock: false, contact: 1, sides: 6, spawnTime: 0.8,
    update: function (i, dt) {
      // drifts with the pack, keeping its dome over the crowd
      var dx = NA.Player.x - P.x[i], dy = NA.Player.y - P.y[i];
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      P.vx[i] = M.smooth(P.vx[i], dx / l * 62, 3, dt);
      P.vy[i] = M.smooth(P.vy[i], dy / l * 62, 3, dt);
      P.rot[i] += 0.35 * dt;
      pushDome(P.x[i], P.y[i], DOME_R, i);               // protects others, not itself
    },
    onDeath: function (i) {
      addSlowZone(P.x[i], P.y[i], DOME_R, 1.5);          // collapse slows those inside
      NA.Particles.ring(P.x[i], P.y[i], DOME_R, 12, 0.4, 4, COL.green[0], COL.green[1], COL.green[2], 1);
      if (NA.Audio) NA.Audio.sfx('explode', { x: P.x[i], y: P.y[i], vol: 0.5 });
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      var g = COL.green;
      var br = 0.30 + 0.10 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ * 0.5 + P.seed[i]);
      R.ring(L.ENEMIES, P.x[i], P.y[i], DOME_R, 2, g[0], g[1], g[2], br);
      R.softRing(L.ENEMIES, P.x[i], P.y[i], DOME_R * 0.98, g[0] * 0.5, g[1] * 0.5, g[2] * 0.5, br * 0.35);
      R.sprite(L.ENEMIES, 'hex', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      R.poly(L.ENEMIES, P.x[i], P.y[i], sz * 0.55, 6, -P.rot[i], 2, 1, 1, 1, a * 0.6);
    }
  });

  /* --- Mortar — fat yellow triangle, stationary, predicted shells ------ */
  var MOR_CYCLE = 3.4, MOR_FILL = 1.2, MOR_R = 90, MOR_DMG = 22;
  En.define('mortar', {
    shape: 'tri', color: COL.yellow,
    size: 22, hp: 60, speed: 0, cost: 5, band: 'B', retireWave: 17,
    flock: false, contact: 1, eye: true, sides: 3, spawnTime: 0.7,
    init: function (i) { P.p0[i] = NA.RNG.range(0, MOR_CYCLE * 0.8); P.state[i] = 0; },
    update: function (i, dt) {
      P.vx[i] = M.smooth(P.vx[i], 0, 10, dt); P.vy[i] = M.smooth(P.vy[i], 0, 10, dt);
      P.rot[i] = Math.atan2(NA.Player.y - P.y[i], NA.Player.x - P.x[i]) + M.HALFPI;
      if (P.state[i] === 0) {
        P.p0[i] += dt;
        if (P.p0[i] >= MOR_CYCLE) {
          // lead the player by the shell flight time
          var tx = NA.Player.x + NA.Player.vx * MOR_FILL * 0.85;
          var ty = NA.Player.y + NA.Player.vy * MOR_FILL * 0.85;
          var dx = tx - NA.Arena.cx, dy = ty - NA.Arena.cy;
          var d = Math.sqrt(dx * dx + dy * dy);
          var lim = NA.Arena.radiusAt(Math.atan2(dy, dx)) - 20;
          if (d > lim) { tx = NA.Arena.cx + dx / d * lim; ty = NA.Arena.cy + dy / d * lim; }
          P.tx[i] = tx; P.ty[i] = ty;
          P.state[i] = 1; P.t2[i] = 0; P.p0[i] = 0;
          if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: P.x[i], y: P.y[i], vol: 0.45 });
        }
      } else {
        // a 90px circle fills for 1.2s, snapping red just before it lands
        En.telegraphCircle(P.tx[i], P.ty[i], MOR_R, P.t2[i], MOR_FILL, MOR_FILL * 0.86);
        P.t2[i] += dt;
        if (P.t2[i] >= MOR_FILL) {
          P.state[i] = 0; P.t2[i] = 0;
          NA.FX.flash(0.12, 80);
          queueExplode(P.tx[i], P.ty[i], MOR_R, MOR_DMG);            // hurts enemies too
        }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      R.sprite(L.ENEMIES, 'tri', P.x[i], P.y[i], P.rot[i], sz * 1.15, sz, cr, cg, cb, a);
      var chg = P.state[i] === 1 ? 1 - P.t2[i] / MOR_FILL : M.clamp01(P.p0[i] / MOR_CYCLE);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * (0.16 + chg * 0.16), 1, M.lerp(0.85, 0.4, chg), 0.2, a * (0.5 + chg * 0.5));
      if (P.state[i] === 1) {
        // a thin arc from the tube to the impact circle: you can read the shot
        R.line(L.VEIL, P.x[i], P.y[i], P.tx[i], P.ty[i], 1, COL.orange[0], COL.orange[1], COL.orange[2], 0.18);
      }
    }
  });

  /* --- Bloat — big dim red circle; 0.4s flare then a 140px explosion ---- */
  var BLOAT_R = 140, BLOAT_DMG = 26, BLOAT_FLARE = 0.4;
  En.define('bloat', {
    shape: 'circle', color: [0.70, 0.16, 0.24],
    size: 34, hp: 90, speed: 22, cost: 5, band: 'B', retireWave: 23,
    flock: true, contact: 1, separation: 1, cohesion: 0, sides: 8, spawnTime: 0.9,
    onDeath: function (i) {
      addFlare(P.x[i], P.y[i], BLOAT_R, BLOAT_DMG, BLOAT_FLARE);   // hurts everyone
      if (NA.Audio) NA.Audio.sfx('telegraph', { x: P.x[i], y: P.y[i], vol: 0.5 });
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L;
      var breathe = 1 + 0.05 * Math.sin(NA.Time.t * 1.6 + P.seed[i]);
      var sz = P.size[i] * breathe;
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      R.ring(L.ENEMIES, P.x[i], P.y[i], sz * 0.72, 2, cr * 1.4, cg * 1.4, cb * 1.4, a * 0.55);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * 0.2, 1, 0.35, 0.30, a * 0.5);
    }
  });

  /* --- Sower — small green square, straight lines, a mine every 1.5s ---- */
  var SOW_PERIOD = 1.5;
  En.define('sower', {
    shape: 'square', color: COL.green,
    size: 14, hp: 26, speed: 155, cost: 4, band: 'B', retireWave: 17,
    flock: false, contact: 1, sides: 4, spawnTime: 0.5,
    init: function (i) {
      P.p1[i] = Math.atan2(NA.Arena.cy - P.y[i], NA.Arena.cx - P.x[i]) + NA.RNG.range(-0.8, 0.8);
      P.p0[i] = NA.RNG.range(0, SOW_PERIOD);
    },
    update: function (i, dt) {
      // straight lines, reflecting off the membrane
      if (depthOf(i) < P.size[i] + 12) {
        var na = Math.atan2(NA.Arena.cy - P.y[i], NA.Arena.cx - P.x[i]);
        P.p1[i] = na + (P.p1[i] - na) * 0.1 + NA.RNG.range(-0.4, 0.4);
      }
      P.vx[i] = Math.cos(P.p1[i]) * 155;
      P.vy[i] = Math.sin(P.p1[i]) * 155;
      P.rot[i] = 0;
      P.p0[i] += dt;
      if (P.p0[i] >= SOW_PERIOD) { P.p0[i] = 0; addMine(P.x[i], P.y[i]); }
    },
    onDeath: function (i) { addMine(P.x[i], P.y[i]); },   // one last mine
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L, sz = P.size[i];
      R.sprite(L.ENEMIES, 'square', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      var k = M.clamp01(P.p0[i] / SOW_PERIOD);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * (0.16 + k * 0.18), cr, cg, cb, a * (0.4 + k * 0.6));
    }
  });

  /* =====================================================================
   * MUTATORS  (GAME_PLAN §7.1) — diamond outline plus a rim colour, max 2
   * ===================================================================== */

  var MUT_BITS = [
    MUT.VOLATILE, MUT.LINKED, MUT.PHASED, MUT.ANCHORED, MUT.SPLIT, MUT.HAUNTED,
    MUT.SHROUDED, MUT.MAGNETIC, MUT.MIRROR, MUT.VAMPIRIC, MUT.BLOOMED, MUT.SIREN
  ];
  var MUT_COL = [
    COL.red,                 // volatile  — red
    COL.orange,              // linked    — orange
    COL.violet,              // phased    — violet
    COL.yellow,              // anchored  — yellow
    [1, 1, 1],               // split     — white
    COL.grey,                // haunted   — gray
    [0.10, 0.45, 0.24],      // shrouded  — dark green
    COL.magenta,             // magnetic  — magenta
    COL.player,              // mirror    — cyan
    COL.green,               // vampiric  — green
    [1.00, 0.45, 0.78],      // bloomed   — pink
    [0.35, 0.55, 1.00]       // siren     — blue
  ];

  En.mutRim = true;                 // 10_enemies.js defers the rim marker to us

  var SIREN_PERIOD = 4.0, LINK_R = 260, MAG_R = 240;
  var sirenT = 0, linkHurtCd = 0;

  /* Per-frame mutator behaviour.  Runs before the framework update so that
   * intangibility and impulses land on the same step. */
  function mutPre(dt) {
    magN = 0;
    sirenT += dt;
    var siren = sirenT >= SIREN_PERIOD;
    if (siren) sirenT = 0;
    if (linkHurtCd > 0) linkHurtCd -= dt;
    var px = NA.Player.x, py = NA.Player.y;

    for (var i = 0; i < P.n; i++) {
      var m = P.mut[i];
      if (!m) continue;

      // PHASED — intangible 1s in every 3s
      if (m & MUT.PHASED) {
        var ph = (NA.Time.t + P.seed[i]) % 3;
        if (ph < 1) P.intangible[i] = Math.max(P.intangible[i], dt * 2);
      }
      // MAGNETIC — remember where it is; the bullet pass bends shots toward it
      if ((m & MUT.MAGNETIC) && magN < 8) { magX[magN] = P.x[i]; magY[magN] = P.y[i]; magN++; }

      // VAMPIRIC — contact with the player heals nearby allies
      if (m & MUT.VAMPIRIC) {
        var vdx = px - P.x[i], vdy = py - P.y[i];
        var vr = P.size[i] + C.SHIP_R + 6;
        if (NA.Player.alive && vdx * vdx + vdy * vdy < vr * vr) healAllies(i, dt);
      }
      // SIREN — every 4s it speed-bursts the allies around it
      if (siren && (m & MUT.SIREN)) sirenBurst(i);
      // LINKED — a tether beam to the nearest other linked enemy
      if (m & MUT.LINKED) linkBeam(i, px, py);
    }
  }

  function healAllies(i, dt) {
    var cnt = En.grid.query(P.x[i], P.y[i], 160), out = En.grid.out;
    var g = COL.green;
    for (var q = 0; q < cnt && q < 12; q++) {
      var j = out[q];
      if (j >= P.n || P.hp[j] >= P.maxHp[j]) continue;
      P.hp[j] = Math.min(P.maxHp[j], P.hp[j] + 6 * dt);
      if ((NA.Time.frames & 15) === 0) {
        NA.R.line(NA.R.L.PARTICLES, P.x[i], P.y[i], P.x[j], P.y[j], 1, g[0], g[1], g[2], 0.28);
      }
    }
  }

  function sirenBurst(i) {
    var cnt = En.grid.query(P.x[i], P.y[i], 300), out = En.grid.out;
    var px = NA.Player.x, py = NA.Player.y, n = 0;
    for (var q = 0; q < cnt && n < 20; q++) {
      var j = out[q];
      if (j === i || j >= P.n) continue;
      var dx = px - P.x[j], dy = py - P.y[j], l = Math.sqrt(dx * dx + dy * dy) || 1;
      shove(j, dx / l * 260, dy / l * 260);
      NA.Particles.spawn(P.x[j], P.y[j], 0, 0, 0.25, 4, 0.35, 0.55, 1, 0.6, 0, 2);
      n++;
    }
    NA.Particles.ring(P.x[i], P.y[i], 10, 300, 0.35, 3, 0.35, 0.55, 1, 0.8);
    if (NA.Audio) NA.Audio.sfx('telegraph', { x: P.x[i], y: P.y[i], vol: 0.3 });
  }

  function linkBeam(i, px, py) {
    var cnt = En.grid.query(P.x[i], P.y[i], LINK_R), out = En.grid.out;
    var best = -1, bd = LINK_R * LINK_R;
    for (var q = 0; q < cnt; q++) {
      var j = out[q];
      if (j <= i || j >= P.n) continue;                   // draw each pair once
      if (!(P.mut[j] & MUT.LINKED)) continue;
      var dx = P.x[j] - P.x[i], dy = P.y[j] - P.y[i], d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = j; }
    }
    if (best < 0) return;
    var o = COL.orange;
    NA.R.line(NA.R.L.VEIL, P.x[i], P.y[i], P.x[best], P.y[best], 2.5, o[0], o[1], o[2],
      0.5 + 0.3 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ));
    if (linkHurtCd <= 0 && NA.Player.alive &&
      distSeg2(px, py, P.x[i], P.y[i], P.x[best], P.y[best]) < 16 * 16) {
      if (NA.Player.damage(1, P.x[i], P.y[i])) linkHurtCd = 0.6;
    }
  }

  /* Domes owned by Shrouded enemies — registered after the framework update
   * (which clears the dome list at the top of its own pass). */
  function mutDomes() {
    for (var i = 0; i < P.n; i++) {
      if (P.mut[i] & MUT.SHROUDED) pushDome(P.x[i], P.y[i], 70, i);
    }
  }

  /* Death-time mutator effects.  Runs before the framework frees the row. */
  function mutDeath(i) {
    var m = P.mut[i];
    if (!m) return;
    var x = P.x[i], y = P.y[i], ti = P.type[i];

    if (m & MUT.VOLATILE) {
      // taken over from the framework so the blast is deferred, not recursive
      P.mut[i] &= ~MUT.VOLATILE;
      queueExplode(x, y, 110, 12);
      NA.Particles.ring(x, y, 6, 110, 0.28, 3, COL.red[0], COL.red[1], COL.red[2], 0.9);
    }

    if (m & MUT.SPLIT) {
      for (var k = 0; k < 2; k++) {
        var a = P.rot[i] + k * M.PI;
        var j = En.spawn(ti, x + Math.cos(a) * 16, y + Math.sin(a) * 16);
        if (j >= 0) {
          P.size[j] *= 0.66; P.maxHp[j] = P.hp[j] = Math.max(4, P.maxHp[j] * 0.5);
          P.mut[j] = m & ~MUT.SPLIT;                      // halves never split again
          P.vx[j] = Math.cos(a) * 180; P.vy[j] = Math.sin(a) * 180;
        }
      }
    }
    if (m & MUT.HAUNTED) {
      var h = En.spawn(ti, x, y);
      if (h >= 0) {
        P.maxHp[h] = P.hp[h] = Math.max(3, P.maxHp[h] * 0.3);
        P.mut[h] = 0;                                     // it rises exactly once
        P.flags[h] |= HUSK;
        P.spawnT[h] = 0.5; P.intangible[h] = 0.5;
      }
    }
    if (m & MUT.BLOOMED) {
      var pk = MUT_COL[10];
      for (var b = 0; b < 6; b++) {
        var ba = P.rot[i] + b * (M.TAU / 6);
        NA.Bullets.fireEnemy(x + Math.cos(ba) * 12, y + Math.sin(ba) * 12,
          Math.cos(ba) * 170, Math.sin(ba) * 170,
          { size: 9, life: 1.6, color: pk, owner: 1, dmg: 1 });
      }
      NA.Particles.ring(x, y, 8, 90, 0.3, 3, pk[0], pk[1], pk[2], 0.9);
    }
  }

  /* Damage-time mutator effects.  Returns false to swallow the hit. */
  function mutDamage(i, amt, src) {
    var m = P.mut[i];
    if (!m) return true;
    if ((m & MUT.MIRROR) && !(P.flags[i] & MIRRORED) && src === 'player') {
      P.flags[i] |= MIRRORED;
      var c = COL.player;
      var dx = NA.Player.x - P.x[i], dy = NA.Player.y - P.y[i];
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      NA.Bullets.fireEnemy(P.x[i] + dx / l * 16, P.y[i] + dy / l * 16, dx / l * 460, dy / l * 460,
        { size: 7, life: 3, color: c, owner: 1, dmg: 1 });
      NA.Particles.ring(P.x[i], P.y[i], 6, P.size[i] * 2.4, 0.24, 3, c[0], c[1], c[2], 1);
      if (NA.Audio) NA.Audio.sfx('wall', { x: P.x[i], y: P.y[i], vol: 0.4 });
      return false;                                       // the first hit bounces
    }
    return true;
  }

  /* The rim marker: a diamond outline plus up to two coloured rings.
   * Exposed as En.mutRim so 10_enemies.js skips its own placeholder marker. */
  function mutRender() {
    var R = NA.R, L = R.L;
    for (var i = 0; i < P.n; i++) {
      var m = P.mut[i];
      if (!m || P.spawnT[i] > 0) continue;
      var a = En.revealOf(i);
      if (a <= 0.02) continue;
      var sz = P.size[i];
      R.poly(L.ENEMIES, P.x[i], P.y[i], sz * 1.35, 4, P.rot[i] * -0.6, 1.3, 1, 1, 1, a * 0.45);
      var shown = 0;
      for (var b = 0; b < 12 && shown < 2; b++) {
        if (!(m & MUT_BITS[b])) continue;
        var c = MUT_COL[b];
        var rr = sz * (1.5 + shown * 0.22);
        var pulse = 0.55 + 0.35 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ + b);
        R.ring(L.ENEMIES, P.x[i], P.y[i], rr, 1.6, c[0], c[1], c[2], a * pulse * 0.8);
        shown++;
      }
      if ((m & MUT.PHASED) && P.intangible[i] > 0) {
        R.softRing(L.ENEMIES, P.x[i], P.y[i], sz * 1.1, COL.violet[0], COL.violet[1], COL.violet[2], a * 0.4);
      }
    }
  }

  /* =====================================================================
   * Bullet-side hooks: ENEMYHURT bullets, dome fizzle, magnetic pull
   * ===================================================================== */

  var EB = NA.Bullets.E, PB = NA.Bullets.P, BF = NA.Bullets.FLAG;

  /* Enemy bullets flagged ENEMYHURT damage enemies too, after a short arming
   * delay so the shooter never kills itself.  Spitter bolts clear Motes. */
  /* SUPERSEDED by 08_bullets.js — kept only so the file still reads as one
   * piece. Never called; the foundation loop does this once per bullet now. */
  function enemyBulletsVsEnemies(dt) {
    return;
    /* eslint-disable no-unreachable */
    if (!EB.n || !P.n) return;
    for (var i = 0; i < EB.n; i++) {
      if (!(EB.flags[i] & BF.ENEMYHURT)) continue;
      if (EB.maxLife[i] - EB.life[i] < 0.1) continue;     // arming delay
      var cnt = En.grid.query(EB.x[i], EB.y[i], EB.size[i] + 44), out = En.grid.out;
      for (var q = 0; q < cnt; q++) {
        var ei = out[q];
        if (ei >= P.n || P.intangible[ei] > 0) continue;
        var rr = EB.size[i] + P.size[ei];
        var dx = P.x[ei] - EB.x[i], dy = P.y[ei] - EB.y[i];
        if (dx * dx + dy * dy > rr * rr) continue;
        En.damage(ei, EB.dmg[i] * 14, 'enemy');
        NA.Particles.burst(EB.x[i], EB.y[i], 2, 110, 0.16, EB.r[i], EB.g[i], EB.b[i], 0);
        if (EB.pierce[i] > 0) EB.pierce[i]--;
        else { NA.Bullets.killE(i, true); i--; }
        break;
      }
    }
  }

  /* Sentinel / Shrouded domes: a player bullet crossing in from outside
   * fizzles at the dome edge.  Shots fired from inside pass freely. */
  function domeFizzle() {
    if (!En.domes.length || !PB.n) return;
    var ds = En.domes;
    for (var i = 0; i < PB.n; i++) {
      for (var k = 0; k < ds.length; k++) {
        var d = ds[k], r2 = d.r * d.r;
        var ex = PB.x[i] - d.x, ey = PB.y[i] - d.y;
        if (ex * ex + ey * ey > r2) continue;              // still outside
        var sx = PB.px[i] - d.x, sy = PB.py[i] - d.y;
        if (sx * sx + sy * sy <= r2) continue;             // it started inside
        // the Sentinel itself is not protected: a shot whose flight path still
        // leads to its body passes through the shell untouched
        var orr = d.orad + PB.size[i];
        var vx = PB.vx[i], vy = PB.vy[i], vv = vx * vx + vy * vy;
        if (vv > 0) {
          var wx = d.x - PB.x[i], wy = d.y - PB.y[i];
          var tt = (wx * vx + wy * vy) / vv;
          if (tt > 0) {
            var ox = wx - vx * tt, oy = wy - vy * tt;
            if (ox * ox + oy * oy < orr * orr) continue;
          }
        }
        // land the fizzle on the dome surface
        var dl = Math.sqrt(ex * ex + ey * ey) || 1;
        var hx = d.x + ex / dl * d.r, hy = d.y + ey / dl * d.r;
        var g = COL.green;
        NA.Particles.burst(hx, hy, 3, 120, 0.2, g[0], g[1], g[2], 0);
        NA.R.softRing(NA.R.L.VEIL, hx, hy, 14, g[0], g[1], g[2], 0.5);
        NA.Bullets.killP(i, true); i--;
        break;
      }
    }
  }

  /* Magnetic mutator: your projectiles curve toward the enemy. */
  function magneticPull(dt) {
    if (!magN || !PB.n) return;
    var r2 = MAG_R * MAG_R;
    for (var i = 0; i < PB.n; i++) {
      for (var k = 0; k < magN; k++) {
        var dx = magX[k] - PB.x[i], dy = magY[k] - PB.y[i];
        var d2 = dx * dx + dy * dy;
        if (d2 > r2 || d2 < 1) continue;
        var d = Math.sqrt(d2);
        var pull = (1 - d / MAG_R) * 1700 * dt;
        PB.vx[i] += dx / d * pull; PB.vy[i] += dy / d * pull;
        PB.rot[i] = Math.atan2(PB.vy[i], PB.vx[i]);
        break;
      }
    }
  }

  /* =====================================================================
   * Wrappers around the framework
   * ===================================================================== */

  /* --- hard simultaneous caps ------------------------------------------ */
  function buildCaps() {
    capIdx = new Int32Array(En.types.length);
    for (var id in CAP) {
      var ti = En.typeIndex(id);
      if (ti >= 0) capIdx[ti] = CAP[id];
    }
  }
  var _spawn = En.spawn;
  En.spawn = function (id, x, y) {
    var ti = typeof id === 'number' ? id : En.byId[id];
    if (ti === undefined || ti < 0) return -1;
    if (!capIdx || capIdx.length !== En.types.length) buildCaps();
    var cap = capIdx[ti];
    if (cap > 0) {
      var live = 0;
      for (var i = 0; i < P.n; i++) if (P.type[i] === ti) { live++; if (live >= cap) return -1; }
    }
    return _spawn(ti, x, y);
  };

  /* --- damage / death wrappers (mutators) ------------------------------ */
  var _damage = En.damage;
  En.damage = function (i, amt, src) {
    if (i < 0 || i >= P.n) return false;
    if (P.mut[i] && !mutDamage(i, amt, src)) return false;
    return _damage(i, amt, src);
  };
  var _kill = En.kill;
  En.kill = function (i, byPlayer) {
    if (i < 0 || i >= P.n) return;
    if (P.mut[i]) mutDeath(i);
    _kill(i, byPlayer);
  };

  /* --- update / render wrappers ---------------------------------------- */
  var _update = En.update;
  En.update = function (dt) {
    devSpawn();
    domeN = 0;                  // the framework clears En.domes at the top of its pass
    mutPre(dt);                 // phased / vampiric / siren / linked, magnet list
    _update(dt);                // the framework: grid, flock, per-type update (Sentinels
                                //   register their domes from inside it)
    mutDomes();                 // Shrouded personal domes
    updateMines(dt);
    updateFlares(dt);
    updateZones(dt);
    drainExplosions();
  };

  var _render = En.render;
  En.render = function () {
    renderScars();
    renderMines();
    _render();
    mutRender();
  };

  /* Bullets: enemy-vs-enemy hits, dome fizzle, magnetic pull.  Wrapping keeps
   * 08_bullets.js untouched and runs on the same step, after integration. */
  var _bupdate = NA.Bullets.update;
  NA.Bullets.update = function (dt) {
    _bupdate(dt);
    // ENEMYHURT now lives in 08_bullets.js (one implementation, one hit each)
    domeFizzle();
    magneticPull(dt);
  };

  /* Reset the local sub-systems with the enemy pool. */
  var _reset = En.reset;
  En.reset = function () {
    Mines.clear(); flareN = 0; zoneN = 0; scarN = 0; domeN = 0; boomN = 0;
    sirenT = 0; linkHurtCd = 0;
    _reset();
  };

  /* =====================================================================
   * ?spawn=charger:5,shade:10  — dev spawns at boot
   * ===================================================================== */
  var devList = null, devDone = false;
  (function parseDev() {
    var s = NA.params && NA.params.spawn;
    if (!s) { devDone = true; return; }
    devList = [];
    var parts = String(s).split(',');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(':');
      var id = kv[0].trim();
      var n = kv.length > 1 ? Math.min(200, Math.max(1, parseInt(kv[1], 10) || 1)) : 1;
      if (id) devList.push(id, n);
    }
    if (!devList.length) devDone = true;
  })();

  function devSpawn() {
    if (devDone) return;
    if (!NA.Game || (NA.Game.state !== 'wave' && NA.Game.state !== 'boss')) return;
    devDone = true;
    for (var k = 0; k < devList.length; k += 2) {
      var id = devList[k], n = devList[k + 1];
      if (En.typeIndex(id) < 0) continue;
      for (var j = 0; j < n; j++) {
        En.spawnAtRim(id, (j / n) * M.TAU + NA.RNG.f() * 0.4, 140 + (j % 5) * 30);
      }
    }
  }
})();
