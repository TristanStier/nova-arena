/* 10c_enemies_cde.js — enemy Bands C, D and E (GAME_PLAN §7).
 *
 * Owns 25 enemy types plus the two spawned variants (`larva`, `husk`):
 *   Band C  tetherPair puller hive larva glazier warden wisp splitter
 *   Band D  eclipse prism siphon rotator necromancer husk doppel chronoform flak
 *   Band E  wraith crush cathedral herald singularity ouroboros chargerElite
 *           echo sunder swarmLord
 *
 * Everything here is additive: the file only calls the public APIs in
 * ARCHITECTURE.md and wraps a few NA.Enemies / NA.Bullets entry points with
 * pass-through decorators (no foundation file is edited).
 *
 * Decorators installed (all call the original first):
 *   NA.Enemies.spawn      — per-type hard caps (`def.cap`)
 *   NA.Enemies.update     — the module tick (group bodies, fields, pulls)
 *   NA.Enemies.render     — module-owned overlays (fields, cords, shells)
 *   NA.Enemies.revealOf   — Eclipse / Prism / Wraith reveal pulses
 *   NA.Enemies.damage     — Cathedral node exposure gating
 *   NA.Bullets.explode    — explosions reveal invisibles nearby
 *
 * Extra registry fields (NA.Enemies.define normalizes the def and drops
 * unknown keys, so they are attached to the type object afterwards):
 *   cap          hard simultaneous cap, enforced in the spawn decorator
 *   retireWave   the wave at whose START the type stops spawning
 *
 * Per-entity bit budget in the SoA `flags` field (the framework never reads
 * it; bits 0..4 are deliberately left to the Bands A/B module):
 *   bit  5      ECHO        this row is a replay ghost, never recorded
 *   bit  6      TELEGRAPH   mid-telegraph: Wisps must not speed-burst it
 *   bit  7      HUSK        raised corpse
 *   bits 8..15  HUSKSRC     husk's source type index
 *   bits 16..21 GROUP       composite group id (Cathedral / Ouroboros / Swarm Lord)
 *   bits 22..27 ROLE        member index inside the group, or echo track + 1
 *   bits 28..30 HASTE       Wisp speed-burst, counts down in 0.5s units
 *
 * No allocation inside any per-frame loop: every buffer below is created once.
 */
(function () {
  var M = NA.M, C = NA.C, En = NA.Enemies;
  var R = NA.R, L = NA.R.L, COL = C.COL;

  var X = En.x, Y = En.y, VX = En.vx, VY = En.vy;
  var HP = En.hp, MAXHP = En.maxHp, TYPE = En.type, SIZE = En.size;
  var ROT = En.rot, ST = En.state, T = En.t, T2 = En.t2;
  var FLAGS = En.flags, TX = En.tx, TY = En.ty, INTAN = En.intangible;
  var SEED = En.seed, P0 = En.p0, P1 = En.p1, P2 = En.p2, P3 = En.p3;

  /* ------------------------------------------------------------ bit fields */
  var F_ECHO = 1 << 5, F_TELE = 1 << 6, F_HUSK = 1 << 7;
  var HUSKSRC_SH = 8, HUSKSRC_MASK = 0xFF << 8;
  var GROUP_SH = 16, GROUP_MASK = 0x3F << 16;
  var ROLE_SH = 22, ROLE_MASK = 0x3F << 22;
  var HASTE_SH = 28, HASTE_MASK = 0x7 << 28;

  function groupOf(i) { return (FLAGS[i] & GROUP_MASK) >>> GROUP_SH; }
  function roleOf(i) { return (FLAGS[i] & ROLE_MASK) >>> ROLE_SH; }
  function setGroup(i, g, role) {
    FLAGS[i] = (FLAGS[i] & ~(GROUP_MASK | ROLE_MASK)) | ((g & 0x3F) << GROUP_SH) | ((role & 0x3F) << ROLE_SH);
  }
  function clearGroup(i) { FLAGS[i] = FLAGS[i] & ~(GROUP_MASK | ROLE_MASK); }
  function hasteOf(i) { return (FLAGS[i] & HASTE_MASK) >>> HASTE_SH; }
  function setHaste(i, v) { FLAGS[i] = (FLAGS[i] & ~HASTE_MASK) | ((v & 7) << HASTE_SH); }

  /* --------------------------------------------------------------- helpers */
  var TMPC = [0, 0, 0];
  function mix(a, b, k) { TMPC[0] = a[0] + (b[0] - a[0]) * k; TMPC[1] = a[1] + (b[1] - a[1]) * k; TMPC[2] = a[2] + (b[2] - a[2]) * k; return TMPC; }
  function px() { return NA.Player.x; }
  function py() { return NA.Player.y; }
  function seek(i, tx, ty, sp, rate, dt) {
    var dx = tx - X[i], dy = ty - Y[i];
    var l = Math.sqrt(dx * dx + dy * dy) || 1;
    VX[i] = M.smooth(VX[i], dx / l * sp, rate, dt);
    VY[i] = M.smooth(VY[i], dy / l * sp, rate, dt);
  }
  function segDist2(px0, py0, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    var t = l2 < 1e-6 ? 0 : M.clamp01(((px0 - x1) * dx + (py0 - y1) * dy) / l2);
    var qx = x1 + dx * t - px0, qy = y1 + dy * t - py0;
    return qx * qx + qy * qy;
  }
  /* A safe interior point: never within four ship-widths of the player. */
  function interiorPoint(out, minFromPlayer) {
    var tries = 0, a, r;
    do {
      a = NA.RNG.f() * M.TAU;
      r = Math.sqrt(NA.RNG.f()) * (NA.Arena.radiusAt(a) - 140);
      out.x = NA.Arena.cx + Math.cos(a) * r; out.y = NA.Arena.cy + Math.sin(a) * r;
    } while (++tries < 12 && M.dist2(out.x, out.y, px(), py()) < minFromPlayer * minFromPlayer);
    return out;
  }
  var PT = { x: 0, y: 0 };

  /* Register a type and keep the extra fields the framework normalizes away. */
  function def(id, d) {
    var ti = En.define(id, d);
    var t = En.types[ti];
    t.cap = d.cap || 0;
    t.retireWave = d.retireWave || 0;
    return ti;
  }
  function tid(id) { var v = En.byId[id]; return v === undefined ? -1 : v; }
  function have(id) { return En.byId[id] !== undefined; }

  /* -------------------------------------------------------------- reveals */
  var REVEAL = new Float32Array(8 * 4), REVEAL_N = 0;   // x, y, r, life
  var GREVEAL = 0;                                       // global (Eclipse death)
  function revealPulse(x, y, r, life) {
    var o = (REVEAL_N++ % 8) * 4;
    REVEAL[o] = x; REVEAL[o + 1] = y; REVEAL[o + 2] = r; REVEAL[o + 3] = life;
  }

  /* =====================================================================
   * Module state — every buffer allocated once, at load.
   * ===================================================================== */
  var LIVE = new Int32Array(96);            // live count per type index
  var GMAX = 64, GSLOT = 64;
  var GMEM = new Int32Array(GMAX * GSLOT);  // group id -> role -> enemy index
  var GCNT = new Int32Array(GMAX);
  GMEM.fill(-1);
  var GNEXT = 1;
  function newGroup() { GNEXT = GNEXT % (GMAX - 1) + 1; return GNEXT; }

  // per-frame index lists, filled by the types' own update()
  var LIST_CAP = 96;
  var PULLERS = new Int32Array(LIST_CAP), PULLER_N = 0;
  var CHRONO = new Int32Array(LIST_CAP), CHRONO_N = 0;
  var ECLIPSES = new Int32Array(8), ECLIPSE_N = 0;
  var ROTATORS = new Int32Array(8), ROTATOR_N = 0;
  var SING = -1;
  var haveGroups = false;

  var HASTE_ACC = 0;         // 0.5s ticker for the wisp haste counter
  var PLAYER_HASTE = 0;      // Chronoform death gift
  var SG_DMG_BASE = -1;
  var SPLIT_BUDGET = 120;

  var hooked = false;

  /* ============================ Band C ================================= */

  /* --- Tether Pair -----------------------------------------------------
   * One entity with two positions: (x,y) is end A, (tx,ty) is end B; they
   * rotate about their midpoint at <=220px apart. The beam hurts the player
   * only. Half the HP kills end B; the survivor turns skitter-like. */
  var TP_HALF = 105, TP_HP = 64;
  def('tetherPair', {
    shape: 'diamond', color: COL.orange, size: 16, hp: TP_HP, speed: 78,
    cost: 8, band: 'C', flock: false, contact: 0, sides: 4, elite: false,
    cap: 14, retireWave: 23,
    init: function (i) {
      P0[i] = NA.RNG.f() * M.TAU;      // pair angle
      P1[i] = 0.55 + NA.RNG.f() * 0.3; // spin rate
      ST[i] = 3;                        // both ends alive
      TX[i] = X[i] + Math.cos(P0[i]) * TP_HALF * 2;
      TY[i] = Y[i] + Math.sin(P0[i]) * TP_HALF * 2;
    },
    update: function (i, dt) {
      var both = ST[i] === 3;
      if (both) {
        P0[i] += P1[i] * dt;
        // drift the midpoint toward the player, slowly
        var mx = (X[i] + TX[i]) * 0.5, my = (Y[i] + TY[i]) * 0.5;
        var dx = px() - mx, dy = py() - my;
        var l = Math.sqrt(dx * dx + dy * dy) || 1;
        VX[i] = M.smooth(VX[i], dx / l * 78, 3, dt);
        VY[i] = M.smooth(VY[i], dy / l * 78, 3, dt);
        // end B is the mirror of end A about the (moving) midpoint
        var ca = Math.cos(P0[i]) * TP_HALF, sa = Math.sin(P0[i]) * TP_HALF;
        mx += VX[i] * dt; my += VY[i] * dt;
        TX[i] = mx + ca; TY[i] = my + sa;
        X[i] = mx - ca; Y[i] = my - sa;
        VX[i] = VY[i] = 0;               // positions are authored, not integrated
        // the beam: hurts you, not enemies
        if (NA.Player.alive && INTAN[i] <= 0) {
          if (segDist2(px(), py(), X[i], Y[i], TX[i], TY[i]) < (C.SHIP_R + 9) * (C.SHIP_R + 9))
            NA.Player.damage(1, X[i], Y[i]);
        }
        // both diamonds do contact damage
        if (NA.Player.alive && INTAN[i] <= 0) {
          var rr = (SIZE[i] + C.SHIP_R) * (SIZE[i] + C.SHIP_R);
          if (M.dist2(px(), py(), X[i], Y[i]) < rr || M.dist2(px(), py(), TX[i], TY[i]) < rr)
            NA.Player.damage(1, X[i], Y[i]);
        }
      } else {
        // survivor: skitter-like 0.25s erratic bursts
        T2[i] -= dt;
        if (T2[i] <= 0) {
          T2[i] = 0.25;
          var a = Math.atan2(py() - Y[i], px() - X[i]) + NA.RNG.range(-1.1, 1.1);
          VX[i] = Math.cos(a) * 300; VY[i] = Math.sin(a) * 300;
        }
        VX[i] *= 1 - 1.4 * dt; VY[i] *= 1 - 1.4 * dt;
        if (NA.Player.alive && INTAN[i] <= 0) {
          var r2 = (SIZE[i] + C.SHIP_R) * (SIZE[i] + C.SHIP_R);
          if (M.dist2(px(), py(), X[i], Y[i]) < r2) NA.Player.damage(1, X[i], Y[i]);
        }
      }
    },
    onDamage: function (i, amt) {
      if (ST[i] === 3 && HP[i] - amt <= TP_HP * 0.5) {
        // end B pops; the beam dies with it
        ST[i] = 1;
        HP[i] = TP_HP * 0.5;
        NA.Particles.shatter(TX[i], TY[i], SIZE[i] * 1.6, 4, COL.orange[0], COL.orange[1], COL.orange[2], 220);
        NA.Particles.ring(TX[i], TY[i], 6, 70, 0.3, 2, 1, 0.54, 0, 0.8);
        if (NA.Audio) NA.Audio.sfx('kill', { x: TX[i], y: TY[i] });
        SIZE[i] = 13;
        return false;
      }
      return true;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      if (ST[i] === 3) {
        // the beam: orange, always visible — it is a standing hazard
        var br = 0.6 + 0.4 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
        R.line(L.VEIL, X[i], Y[i], TX[i], TY[i], 4, 1, 0.45, 0.12, 0.55 + br * 0.35);
        R.line(L.VEIL, X[i], Y[i], TX[i], TY[i], 12, 1, 0.6, 0.2, 0.10 * br);
        R.sprite(L.ENEMIES, 'diamond', TX[i], TY[i], ROT[i], sz, sz, cr, cg, cb, a);
        R.dot(L.ENEMIES, TX[i], TY[i], sz * 0.25, 1, 1, 1, a * 0.7);
      }
      R.sprite(L.ENEMIES, 'diamond', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.25, 1, 1, 1, a * 0.7);
    },
    onDeath: function (i) {
      if (ST[i] === 3) NA.Particles.shatter(TX[i], TY[i], SIZE[i] * 1.6, 4, 1, 0.54, 0, 220);
    }
  });

  /* --- Puller ----------------------------------------------------------
   * Magenta ring. Spawns *inside* the arena after a 2s swirl, then pulls
   * enemies, the player and projectiles within 350px. Death shoves outward. */
  var PULL_R = 350, PULL_WARN = 2.0;
  def('puller', {
    shape: 'ring', color: COL.magenta, size: 26, hp: 70, speed: 40,
    cost: 12, band: 'C', flock: false, contact: 0, sides: 8, spawnTime: 0.4,
    cap: 3, retireWave: 0,
    init: function (i) {
      interiorPoint(PT, 320);
      X[i] = PT.x; Y[i] = PT.y;
      ST[i] = 0; T2[i] = 0;
      INTAN[i] = PULL_WARN + 0.4;      // harmless during the swirl
    },
    update: function (i, dt) {
      T2[i] += dt;
      VX[i] *= 1 - 2 * dt; VY[i] *= 1 - 2 * dt;
      if (ST[i] === 0) { if (T2[i] >= PULL_WARN) { ST[i] = 1; T2[i] = 0; } return; }
      if (PULLER_N < LIST_CAP) PULLERS[PULLER_N++] = i;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      if (ST[i] === 0) {
        // 2s swirl telegraph: three inward arms drawing the ring
        var k = M.clamp01(T2[i] / PULL_WARN);
        var tc = En.telegraphColor(T2[i], PULL_WARN);
        var al = En.telegraphPulse(T2[i], PULL_WARN);
        for (var s = 0; s < 3; s++) {
          var a0 = NA.Time.t * 2.6 + s * M.TAU / 3;
          var rr = PULL_R * (1 - k) * 0.8 + 40;
          R.arc(L.VEIL, X[i], Y[i], rr, a0, a0 + 1.5, 3, tc[0], tc[1], tc[2], al * 0.8);
        }
        R.ring(L.VEIL, X[i], Y[i], sz * k, 2, tc[0], tc[1], tc[2], al);
        return;
      }
      var b = 0.7 + 0.3 * Math.sin(NA.Time.t * 3 + SEED[i]);
      R.ring(L.ENEMIES, X[i], Y[i], sz, 3, cr, cg, cb, a);
      R.ring(L.ENEMIES, X[i], Y[i], sz * 0.55, 2, cr, cg, cb, a * 0.7);
      // the pull field, drawn as three contracting arcs so the radius is legible
      for (var q = 0; q < 3; q++) {
        var t = (NA.Time.t * 0.55 + q / 3) % 1;
        R.ring(L.FLOOR, X[i], Y[i], PULL_R * (1 - t), 2, cr, cg, cb, 0.16 * t * b);
      }
    },
    onDeath: function (i) {
      // death is an outward shove
      var x = X[i], y = Y[i];
      NA.Particles.ring(x, y, 20, PULL_R * 0.8, 0.4, 4, 1, 0.235, 0.675, 0.9);
      En.forEachInRadius(x, y, PULL_R, function (j) {
        var dx = X[j] - x, dy = Y[j] - y;
        var l = Math.sqrt(dx * dx + dy * dy) || 1;
        var k = 1 - l / PULL_R;
        VX[j] += dx / l * 700 * k; VY[j] += dy / l * 700 * k;
      });
      if (NA.Player.alive) {
        var dx = NA.Player.x - x, dy = NA.Player.y - y;
        var l = Math.sqrt(dx * dx + dy * dy) || 1;
        if (l < PULL_R) { var k = 1 - l / PULL_R; NA.Player.vx += dx / l * 520 * k; NA.Player.vy += dy / l * 520 * k; }
      }
      NA.FX.trauma(0.12);
    }
  });

  /* --- Larva (Hive spawn) ---------------------------------------------- */
  def('larva', {
    shape: 'circle', color: COL.acid, size: 8, hp: 8, speed: 128,
    cost: 1, band: 'C', flock: true, contact: 1, separation: 0.8, cohesion: 0.2,
    spawnTime: 0.25, cap: 300, retireWave: 0,
    init: function (i) { P0[i] = 12; },      // 12s lifetime
    update: function (i, dt) {
      P0[i] -= dt;
      if (P0[i] <= 0) HP[i] = -1;            // reaped by the module tick, never mid-loop
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i] * (P0[i] < 1.5 ? 0.6 + 0.4 * Math.abs(Math.sin(NA.Time.t * 9)) : 1);
      R.sprite(L.ENEMIES, 'circle', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
    }
  });

  /* --- Hive ------------------------------------------------------------- */
  var HIVE_PERIOD = 2.5;
  def('hive', {
    shape: 'hex', color: COL.green, size: 40, hp: 220, speed: 42,
    cost: 22, band: 'C', flock: false, contact: 1, sides: 6, elite: true,
    cap: 6, retireWave: 24,
    init: function (i) { P0[i] = NA.RNG.range(0, HIVE_PERIOD); },
    update: function (i, dt) {
      seek(i, px(), py(), 42, 2, dt);
      P0[i] += dt;
      if (P0[i] >= HIVE_PERIOD) {
        P0[i] = 0;
        for (var k = 0; k < 4; k++) {
          var a = NA.Time.t * 1.7 + k * M.HALFPI;
          En.spawn('larva', X[i] + Math.cos(a) * (SIZE[i] + 8), Y[i] + Math.sin(a) * (SIZE[i] + 8));
        }
        if (NA.Audio) NA.Audio.sfx('spawn', { x: X[i], y: Y[i], vol: 0.5 });
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      var swell = 1 + 0.06 * Math.sin(P0[i] / HIVE_PERIOD * M.TAU);
      R.poly(L.ENEMIES, X[i], Y[i], sz * swell, 6, ROT[i], 3, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.6, 6, -ROT[i] * 1.4, 2, cr, cg, cb, a * 0.7);
      var k = P0[i] / HIVE_PERIOD;
      R.dot(L.ENEMIES, X[i], Y[i], sz * (0.14 + k * 0.16), cr, cg, cb, a * (0.5 + k * 0.5));
    },
    onDeath: function (i) {
      for (var k = 0; k < 8; k++) {
        var a = k / 8 * M.TAU;
        var j = En.spawn('larva', X[i] + Math.cos(a) * (SIZE[i] + 10), Y[i] + Math.sin(a) * (SIZE[i] + 10));
        if (j >= 0) { VX[j] = Math.cos(a) * 260; VY[j] = Math.sin(a) * 260; }
      }
    }
  });

  /* --- Glazier ---------------------------------------------------------
   * Magenta square that draws mirror-wall segments behind itself. 12 segments
   * at a time, each living 15s; death shatters them all. */
  var GLAZ_WALLS = Object.create(null), GLAZ_UID = 1;
  var GLAZ_MAX = 8, GLAZ_LIFE = 15, GLAZ_PERIOD = 1.3;
  /* Readability (GAME_PLAN 10.1): panes are obstacles, not scenery. A pane is
   * the path swept since the last one, so a shoved or hasted Glazier used to
   * lay a segment that crossed the whole 3800-unit arena; a dozen of those from
   * several Glaziers turned the floor into a magenta cage you could not find
   * your ship in. Two caps, neither of which removes a pane from play:
   *   - GLAZ_SEG_MAX  clamps a pane to the last stretch of the sweep, so it is
   *     always a local wall you can read and walk around.
   *   - GLAZ_LIVE_MAX is a global budget across every Glazier; the oldest pane
   *     retires when a new one is drawn. */
  var GLAZ_SEG_MAX = 340, GLAZ_SEG_MIN2 = 40 * 40;
  var GLAZ_LIVE_MAX = 22;
  var GLAZ_RING = new Int32Array(GLAZ_LIVE_MAX), GLAZ_RH = 0, GLAZ_RN = 0;
  function glazPush(id) {                      // global ring: oldest pane out
    if (GLAZ_RN >= GLAZ_LIVE_MAX) {
      NA.Arena.removeMirrorWall(GLAZ_RING[GLAZ_RH]);
      GLAZ_RING[GLAZ_RH] = id; GLAZ_RH = (GLAZ_RH + 1) % GLAZ_LIVE_MAX;
    } else {
      GLAZ_RING[(GLAZ_RH + GLAZ_RN) % GLAZ_LIVE_MAX] = id; GLAZ_RN++;
    }
  }
  def('glazier', {
    shape: 'square', color: COL.magenta, size: 20, hp: 90, speed: 150,
    cost: 16, band: 'C', flock: false, contact: 1, sides: 4,
    cap: 8, retireWave: 0,
    init: function (i) {
      P3[i] = GLAZ_UID++;
      GLAZ_WALLS[P3[i]] = [];
      P0[i] = 0;
      P1[i] = NA.RNG.f() * M.TAU;
      TX[i] = X[i]; TY[i] = Y[i];
    },
    update: function (i, dt) {
      // long lazy sweeps across the floor: the wall follows the path
      P1[i] += Math.sin(NA.Time.t * 0.5 + SEED[i]) * 0.6 * dt;
      var tx = NA.Arena.cx + Math.cos(P1[i]) * (NA.Arena.radius * 0.72);
      var ty = NA.Arena.cy + Math.sin(P1[i]) * (NA.Arena.radius * 0.72);
      if (M.dist2(X[i], Y[i], tx, ty) < 90 * 90) P1[i] += 2.1;
      seek(i, tx, ty, 150, 3, dt);
      P0[i] += dt;
      if (P0[i] >= GLAZ_PERIOD) {
        P0[i] = 0;
        var ws = GLAZ_WALLS[P3[i]];
        if (ws) {
          var sdx = TX[i] - X[i], sdy = TY[i] - Y[i];
          var sl2 = sdx * sdx + sdy * sdy;
          if (sl2 > GLAZ_SEG_MIN2) {
            var ax = TX[i], ay = TY[i];
            if (sl2 > GLAZ_SEG_MAX * GLAZ_SEG_MAX) {      // keep only the last stretch
              var sk = GLAZ_SEG_MAX / Math.sqrt(sl2);
              ax = X[i] + sdx * sk; ay = Y[i] + sdy * sk;
            }
            var id = NA.Arena.addMirrorWall(ax, ay, X[i], Y[i], GLAZ_LIFE, 0);
            ws.push(id);
            glazPush(id);
            while (ws.length > GLAZ_MAX) NA.Arena.removeMirrorWall(ws.shift());
            if (NA.Audio) NA.Audio.sfx('wall', { x: X[i], y: Y[i], vol: 0.4 });
          }
          TX[i] = X[i]; TY[i] = Y[i];
        }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 4, ROT[i], 2.6, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.55, 4, -ROT[i], 1.6, 1, 1, 1, a * 0.5);
      // the pane being drawn right now (same clamp as the pane it becomes)
      var qx = TX[i] - X[i], qy = TY[i] - Y[i], ql2 = qx * qx + qy * qy;
      if (ql2 > GLAZ_SEG_MAX * GLAZ_SEG_MAX) {
        var qk = GLAZ_SEG_MAX / Math.sqrt(ql2); qx *= qk; qy *= qk;
      }
      R.line(L.MEMBRANE, X[i] + qx, Y[i] + qy, X[i], Y[i], 3, cr, cg, cb, 0.35);
    },
    onDeath: function (i) {
      var ws = GLAZ_WALLS[P3[i]];
      if (ws) {
        for (var k = 0; k < ws.length; k++) {
          NA.Arena.removeMirrorWall(ws[k]);
        }
        NA.Particles.burst(X[i], Y[i], 10, 320, 0.35, 1, 0.235, 0.675, 1);
        delete GLAZ_WALLS[P3[i]];
      }
    }
  });

  /* --- Warden ----------------------------------------------------------
   * Yellow square with a turret head. Walks to 500px, plants with a spoke
   * telegraph, then fires 3-round bursts leading you by 0.6s; re-plants
   * every 10s. Changing speed beats it. */
  var WD_RANGE = 500, WD_PLANT = 0.8, WD_CYCLE = 10, WD_BURST = 3, WD_GAP = 0.13, WD_LEAD = 0.6;
  def('warden', {
    shape: 'square', color: COL.yellow, size: 19, hp: 70, speed: 165,
    cost: 14, band: 'C', flock: false, contact: 1, sides: 4, eye: true,
    cap: 15, retireWave: 24,
    init: function (i) { ST[i] = 0; T2[i] = 0; P0[i] = 0; P1[i] = 0; },
    update: function (i, dt) {
      var d = Math.sqrt(M.dist2(X[i], Y[i], px(), py()));
      T2[i] += dt;
      if (ST[i] === 0) {                                  // walk to range
        var ang = Math.atan2(py() - Y[i], px() - X[i]);
        var want = (d - WD_RANGE) / WD_RANGE;
        seek(i, X[i] + Math.cos(ang) * M.clamp(want, -1, 1) * 200,
                Y[i] + Math.sin(ang) * M.clamp(want, -1, 1) * 200, 165, 4, dt);
        if (Math.abs(d - WD_RANGE) < 70) { ST[i] = 1; T2[i] = 0; }
      } else if (ST[i] === 1) {                           // plant: spoke telegraph
        VX[i] *= 1 - 6 * dt; VY[i] *= 1 - 6 * dt;
        FLAGS[i] |= F_TELE;
        var tc = En.telegraphColor(T2[i], WD_PLANT);
        var al = En.telegraphPulse(T2[i], WD_PLANT);
        En._cue(T2[i], WD_PLANT, WD_PLANT, X[i], Y[i]);
        for (var s = 0; s < 4; s++) {
          var sa = ROT[i] + s * M.HALFPI;
          var ln = 34 + M.clamp01(T2[i] / WD_PLANT) * 26;
          R.line(L.VEIL, X[i], Y[i], X[i] + Math.cos(sa) * ln, Y[i] + Math.sin(sa) * ln, 3, tc[0], tc[1], tc[2], al);
        }
        if (T2[i] >= WD_PLANT) { ST[i] = 2; T2[i] = 0; P0[i] = 0; P1[i] = 0; FLAGS[i] &= ~F_TELE; }
      } else {                                            // planted: bursts
        VX[i] *= 1 - 8 * dt; VY[i] *= 1 - 8 * dt;
        P0[i] += dt;
        if (P1[i] < WD_BURST && P0[i] >= (P1[i] === 0 ? 1.1 : WD_GAP) * En.fireMul) {
          P0[i] = 0; P1[i]++;
          var tx = px() + NA.Player.vx * WD_LEAD, ty = py() + NA.Player.vy * WD_LEAD;
          var bx = tx - X[i], by = ty - Y[i];
          var bl = Math.sqrt(bx * bx + by * by) || 1;
          var sp = 620;
          NA.Bullets.fireEnemy(X[i] + bx / bl * 22, Y[i] + by / bl * 22, bx / bl * sp, by / bl * sp,
            { size: 7, life: 3.2, color: COL.yellow, dmg: 1 });
          ROT[i] = Math.atan2(by, bx);
          if (NA.Audio) NA.Audio.sfx('shot', { x: X[i], y: Y[i], vol: 0.35 });
        }
        if (T2[i] >= WD_CYCLE) { ST[i] = 0; T2[i] = 0; }
        else if (P1[i] >= WD_BURST && P0[i] > 2.2) { P1[i] = 0; P0[i] = 0; }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 4, ST[i] === 2 ? 0.785 : ROT[i] * 0.3, 2.4, cr, cg, cb, a);
      // turret head points at the lead position
      var hx = X[i] + Math.cos(ROT[i]) * sz * 1.1, hy = Y[i] + Math.sin(ROT[i]) * sz * 1.1;
      R.line(L.ENEMIES, X[i], Y[i], hx, hy, 4, cr, cg, cb, a);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.26, 1, 1, 1, a * (ST[i] === 2 ? 0.85 : 0.45));
      if (ST[i] === 2) R.ring(L.ENEMIES, X[i], Y[i], sz * 1.5, 1.2, cr, cg, cb, a * 0.3);
    }
  });

  /* --- Wisp -------------------------------------------------------------
   * Parametric orbit at 200px around you. Every 4s it speed-bursts the 20
   * nearest enemies (they gain trails). It never buffs a charger that is
   * mid-telegraph — that would break the read. */
  var WISP_ORBIT = 200, WISP_PERIOD = 4, WISP_TARGETS = 20;
  var WISP_BUF = new Int32Array(64);
  def('wisp', {
    shape: 'circle', color: COL.player, size: 10, hp: 26, speed: 260,
    cost: 12, band: 'C', flock: false, contact: 1, sides: 8,
    cap: 8, retireWave: 25,
    init: function (i) { P0[i] = NA.RNG.f() * M.TAU; P1[i] = NA.RNG.range(0, WISP_PERIOD); },
    update: function (i, dt) {
      P0[i] += 1.25 * dt;
      var wob = Math.sin(NA.Time.t * 1.4 + SEED[i]) * 40;
      var tx = px() + Math.cos(P0[i]) * (WISP_ORBIT + wob);
      var ty = py() + Math.sin(P0[i]) * (WISP_ORBIT + wob);
      seek(i, tx, ty, 260, 7, dt);
      P1[i] += dt;
      if (P1[i] >= WISP_PERIOD) {
        P1[i] = 0;
        var n = 0;
        var cnt = En.grid.query(X[i], Y[i], 420), out = En.grid.out;
        for (var q = 0; q < cnt && n < WISP_TARGETS; q++) {
          var j = out[q];
          if (j >= En.n || j === i) continue;
          if (FLAGS[j] & F_TELE) continue;                       // mid-telegraph: never
          var td = En.types[TYPE[j]].id;
          if ((td === 'charger' || td === 'chargerElite') &&
              (VX[j] * VX[j] + VY[j] * VY[j]) < 400) continue;   // planted charger = telegraphing
          WISP_BUF[n++] = j;
        }
        for (var k = 0; k < n; k++) {
          var e = WISP_BUF[k];
          setHaste(e, 4);                                        // 2s of speed burst
          var sp = En.types[TYPE[e]].speed;
          var dx = px() - X[e], dy = py() - Y[e];
          var l = Math.sqrt(dx * dx + dy * dy) || 1;
          VX[e] += dx / l * sp * 0.9; VY[e] += dy / l * sp * 0.9;
          NA.Particles.burst(X[e], Y[e], 2, 120, 0.22, 0.3, 0.95, 1, 0);
        }
        if (n && NA.Audio) NA.Audio.sfx('spawn', { x: X[i], y: Y[i], vol: 0.35 });
        NA.Particles.ring(X[i], Y[i], 10, 220, 0.35, 2, 0.3, 0.95, 1, 0.7);
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      // elegant trail: four fading motes along the orbit behind it
      for (var k = 1; k <= 4; k++) {
        var ta = P0[i] - k * 0.09;
        var tr = WISP_ORBIT + Math.sin(NA.Time.t * 1.4 + SEED[i]) * 40;
        R.dot(L.AFTER, px() + Math.cos(ta) * tr, py() + Math.sin(ta) * tr, sz * (0.5 - k * 0.08), cr, cg, cb, a * (0.3 - k * 0.06));
      }
      var chg = M.clamp01(P1[i] / WISP_PERIOD);
      R.sprite(L.ENEMIES, 'circle', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      R.ring(L.ENEMIES, X[i], Y[i], sz * (1.4 + chg * 0.8), 1.2, cr, cg, cb, a * chg * 0.6);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.3, 1, 1, 1, a * 0.8);
    }
  });

  /* --- Splitter ---------------------------------------------------------
   * White circle with a seam. Non-lethal damage splits it into halves, then
   * quarters, against a global per-wave split budget. Kill it in one hit. */
  var SPL_SIZE = [21, 14, 9], SPL_HP = [44, 22, 11];
  def('splitter', {
    shape: 'circle', color: [0.96, 0.98, 1.0], size: SPL_SIZE[0], hp: SPL_HP[0], speed: 110,
    cost: 9, band: 'C', flock: true, contact: 1, separation: 1, cohesion: 0.1,
    cap: 90, retireWave: 25,
    init: function (i) { P0[i] = 0; P1[i] = NA.RNG.f() * M.TAU; },
    onDamage: function (i, amt) {
      var gen = P0[i] | 0;
      if (gen >= 2 || SPLIT_BUDGET <= 0) return true;
      if (HP[i] - amt <= 0) return true;                 // lethal: it just dies
      SPLIT_BUDGET--;
      var ng = gen + 1;
      var ang = P1[i] + M.HALFPI;
      var off = SPL_SIZE[gen] * 0.9;
      P0[i] = ng; SIZE[i] = SPL_SIZE[ng]; HP[i] = MAXHP[i] = SPL_HP[ng];
      X[i] += Math.cos(ang) * off; Y[i] += Math.sin(ang) * off;
      VX[i] += Math.cos(ang) * 170; VY[i] += Math.sin(ang) * 170;
      var j = En.spawn('splitter', X[i] - Math.cos(ang) * off * 2, Y[i] - Math.sin(ang) * off * 2);
      if (j >= 0) {
        P0[j] = ng; SIZE[j] = SPL_SIZE[ng]; HP[j] = MAXHP[j] = SPL_HP[ng];
        P1[j] = P1[i] + 1.2;
        VX[j] = -Math.cos(ang) * 170; VY[j] = -Math.sin(ang) * 170;
        INTAN[j] = 0.12; En.spawnT[j] = 0.12;
      }
      NA.Particles.ring(X[i], Y[i], 4, SPL_SIZE[gen] * 2.4, 0.24, 2, 1, 1, 1, 0.8);
      if (NA.Audio) NA.Audio.sfx('hitEnemy', { x: X[i], y: Y[i], vol: 0.4 });
      return false;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.sprite(L.ENEMIES, 'circle', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      // the seam
      R.line(L.ENEMIES, X[i] - Math.cos(P1[i]) * sz, Y[i] - Math.sin(P1[i]) * sz,
        X[i] + Math.cos(P1[i]) * sz, Y[i] + Math.sin(P1[i]) * sz, 1.6, 0.1, 0.12, 0.18, a * 0.9);
    }
  });

  /* ============================ Band D ================================= */

  /* --- Eclipse ---------------------------------------------------------
   * A lantern: everything outside a shrinking radius around you fades out.
   * Each extra Eclipse shrinks the lantern and deepens the dark. Telegraphs
   * stay bright (see the telegraph decorators below). Death reveals Shades. */
  var ECL_R = 220;
  def('eclipse', {
    shape: 'circle', color: COL.magenta, size: 44, hp: 150, speed: 60,
    cost: 26, band: 'D', flock: false, contact: 1, sides: 8, elite: true,
    cap: 3, retireWave: 0,
    update: function (i, dt) {
      seek(i, px(), py(), 60, 1.6, dt);
      if (ECLIPSE_N < 8) ECLIPSES[ECLIPSE_N++] = i;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.disc(L.ENEMIES, X[i], Y[i], sz * 1.7, cr * 0.5, cg * 0.4, cb * 0.5, a * 0.5);
      R.ring(L.ENEMIES, X[i], Y[i], sz, 3, cr, cg, cb, a);
      R.ring(L.ENEMIES, X[i], Y[i], sz * (1.25 + 0.06 * Math.sin(NA.Time.t * 2)), 1.4, cr, cg, cb, a * 0.4);
      R.disc(L.ENEMIES, X[i], Y[i], sz * 0.62, 0.01, 0.01, 0.02, a);   // black core
    },
    onDeath: function (i) {
      GREVEAL = Math.max(GREVEAL, 2.0);
      NA.FX.flash(0.16, 120);
      NA.Particles.ring(X[i], Y[i], 20, 460, 0.5, 4, 1, 0.235, 0.675, 0.9);
    }
  });

  /* --- Prism -----------------------------------------------------------
   * Three aim lines (at you and +/-25 degrees), 1.2s telegraph locking at
   * 0.9s, then three red lasers that reflect off mirror walls. The reflected
   * path is drawn dim during the telegraph so the bank shot is readable.
   * Killed during the lock, the gem bursts and reveals invisibles. */
  /* PR_LEN only has to out-reach the 520px stand-off band, so 950 covers the
   * shot with room to spare; 1500 plus three bounces used to draw a line
   * clean across the 3800-unit arena for every one of eight Prisms. */
  var PR_TELE = 1.2, PR_LOCK = 0.9, PR_FIRE = 0.25, PR_LEN = 950, PR_SPREAD = 0.4363;
  var PR_BOUNCE = 2;
  var RAYBUF = new Float32Array(12);
  function castRay(x, y, ang, len, out) {
    var segs = 0, cx = x, cy = y, dx = Math.cos(ang), dy = Math.sin(ang), rem = len;
    for (var b = 0; b < PR_BOUNCE && rem > 4; b++) {
      var ex = cx + dx * rem, ey = cy + dy * rem;
      var w = NA.Arena.mirrorWalls.length ? NA.Arena.segmentBlocked(cx, cy, ex, ey) : null;
      if (!w) { out[segs * 4] = cx; out[segs * 4 + 1] = cy; out[segs * 4 + 2] = ex; out[segs * 4 + 3] = ey; segs++; break; }
      var o = NA.Arena._out;
      out[segs * 4] = cx; out[segs * 4 + 1] = cy; out[segs * 4 + 2] = o.x; out[segs * 4 + 3] = o.y; segs++;
      var ddx = o.x - cx, ddy = o.y - cy;
      rem -= Math.sqrt(ddx * ddx + ddy * ddy);
      var vn = dx * o.nx + dy * o.ny;
      dx -= 2 * vn * o.nx; dy -= 2 * vn * o.ny;
      cx = o.x + dx * 2; cy = o.y + dy * 2;
    }
    return segs;
  }
  def('prism', {
    shape: 'tri', color: COL.orange, size: 20, hp: 80, speed: 120,
    cost: 20, band: 'D', flock: false, contact: 1, sides: 3, eye: true,
    cap: 8, retireWave: 0,
    init: function (i) { ST[i] = 0; T2[i] = NA.RNG.range(0, 0.8); P0[i] = 0; },
    update: function (i, dt) {
      T2[i] += dt;
      if (ST[i] === 0) {                                    // approach and aim
        var d2 = M.dist2(X[i], Y[i], px(), py());
        if (d2 > 520 * 520) seek(i, px(), py(), 120, 3, dt);
        else { VX[i] *= 1 - 3 * dt; VY[i] *= 1 - 3 * dt; }
        if (T2[i] > 1.4) { ST[i] = 1; T2[i] = 0; P0[i] = Math.atan2(py() - Y[i], px() - X[i]); }
      } else if (ST[i] === 1) {                             // telegraph
        VX[i] *= 1 - 6 * dt; VY[i] *= 1 - 6 * dt;
        FLAGS[i] |= F_TELE;
        if (T2[i] < PR_LOCK) P0[i] = M.lerpAngle(P0[i], Math.atan2(py() - Y[i], px() - X[i]), Math.min(1, 3 * dt));
        ROT[i] = P0[i] + M.HALFPI;
        En._cue(T2[i], PR_TELE, PR_LOCK, X[i], Y[i]);
        var tc = En.telegraphColor(T2[i], PR_LOCK), al = En.telegraphPulse(T2[i], PR_LOCK);
        for (var b = -1; b <= 1; b++) {
          var segs = castRay(X[i], Y[i], P0[i] + b * PR_SPREAD, PR_LEN, RAYBUF);
          for (var s = 0; s < segs; s++) {
            var aa = s === 0 ? al : al * 0.22;             // reflected paths drawn dim
            R.line(L.VEIL, RAYBUF[s * 4], RAYBUF[s * 4 + 1], RAYBUF[s * 4 + 2], RAYBUF[s * 4 + 3],
              s === 0 ? 2.6 : 1.4, tc[0], tc[1], tc[2], aa);
          }
        }
        if (T2[i] >= PR_TELE) { ST[i] = 2; T2[i] = 0; FLAGS[i] &= ~F_TELE; if (NA.Audio) NA.Audio.sfx('laser', { x: X[i], y: Y[i] }); }
      } else {                                              // firing
        VX[i] *= 1 - 6 * dt; VY[i] *= 1 - 6 * dt;
        var hit = false;
        for (var b2 = -1; b2 <= 1; b2++) {
          var sg = castRay(X[i], Y[i], P0[i] + b2 * PR_SPREAD, PR_LEN, RAYBUF);
          for (var s2 = 0; s2 < sg; s2++) {
            var kf = 1 - T2[i] / PR_FIRE;
            // body on EBULLETS (non-additive) so crossing beams never wash out;
            // a thin white-hot core on the veil keeps the killing edge readable.
            R.line(L.EBULLETS, RAYBUF[s2 * 4], RAYBUF[s2 * 4 + 1], RAYBUF[s2 * 4 + 2], RAYBUF[s2 * 4 + 3],
              7 * kf, 1, 0.18, 0.30, 0.9);
            R.line(L.VEIL, RAYBUF[s2 * 4], RAYBUF[s2 * 4 + 1], RAYBUF[s2 * 4 + 2], RAYBUF[s2 * 4 + 3],
              2.2 * kf, 1, 0.9, 0.92, 0.95);
            if (!hit && NA.Player.alive &&
                segDist2(px(), py(), RAYBUF[s2 * 4], RAYBUF[s2 * 4 + 1], RAYBUF[s2 * 4 + 2], RAYBUF[s2 * 4 + 3]) < 260)
              hit = true;
          }
        }
        if (hit) NA.Player.damage(1, X[i], Y[i]);
        if (T2[i] >= PR_FIRE) { ST[i] = 0; T2[i] = 0; }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.sprite(L.ENEMIES, 'tri', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      var glow = ST[i] === 1 ? M.clamp01(T2[i] / PR_LOCK) : (ST[i] === 2 ? 1 : 0.2);
      R.dot(L.ENEMIES, X[i], Y[i], sz * (0.24 + glow * 0.18), 1, M.lerp(0.9, 0.25, glow), M.lerp(0.7, 0.3, glow), a);
    },
    onDeath: function (i) {
      if (ST[i] === 1 && T2[i] >= PR_LOCK) {
        // gem burst: a flare of light that reveals invisibles
        revealPulse(X[i], Y[i], 620, 1.4);
        NA.Particles.ring(X[i], Y[i], 12, 620, 0.5, 4, 1, 0.9, 0.7, 1);
        NA.FX.flash(0.12, 90);
      }
    }
  });

  /* --- Siphon ----------------------------------------------------------
   * A green diamond that attaches a cord within 350px, drains 0.2 dashes of
   * mana per second and heals nearby enemies with visible pulses. The cord
   * breaks when you dash through it or leave range. Death refunds a dash. */
  var SI_R = 350, SI_DRAIN = C.DASH_COST * 0.2, SI_HEAL = 0.6;
  /* A dash counts as "through the cord" when it crosses it, not along it. */
  function dashesAcrossCord(i) {
    var cx = X[i] - px(), cy = Y[i] - py();
    var cl = Math.sqrt(cx * cx + cy * cy) || 1;
    var dx = NA.Player.dashVX, dy = NA.Player.dashVY;
    var dl = Math.sqrt(dx * dx + dy * dy) || 1;
    return Math.abs((cx / cl) * (dx / dl) + (cy / cl) * (dy / dl)) < 0.55;
  }
  def('siphon', {
    shape: 'diamond', color: COL.green, size: 17, hp: 60, speed: 140,
    cost: 18, band: 'D', flock: false, contact: 1, sides: 4,
    cap: 6, retireWave: 0,
    init: function (i) { ST[i] = 0; P0[i] = 0; },
    update: function (i, dt) {
      var d2 = M.dist2(X[i], Y[i], px(), py());
      if (P0[i] > 0) P0[i] -= dt;                       // cord cooldown after a break
      if (ST[i] === 1) {
        if (d2 > SI_R * SI_R) { ST[i] = 0; P0[i] = 1.2; }
        else if (NA.Player.dashT > 0 && dashesAcrossCord(i)) {
          // dashing across the cord snaps it
          ST[i] = 0; P0[i] = 2.5;
          NA.Particles.burst((X[i] + px()) * 0.5, (Y[i] + py()) * 0.5, 6, 260, 0.3, 0.22, 1, 0.42, 1);
          if (NA.Audio) NA.Audio.sfx('wall', { x: X[i], y: Y[i], vol: 0.5 });
        }
      } else if (P0[i] <= 0 && d2 < SI_R * SI_R) {
        ST[i] = 1; T2[i] = 0;
      }
      // keep the band
      var d = Math.sqrt(d2) || 1;
      var ang = Math.atan2(py() - Y[i], px() - X[i]);
      var want = (d - 280) / 280;
      seek(i, X[i] + Math.cos(ang) * M.clamp(want, -1, 1) * 160 - Math.sin(ang) * 90,
              Y[i] + Math.sin(ang) * M.clamp(want, -1, 1) * 160 + Math.cos(ang) * 90, 140, 3, dt);

      if (ST[i] === 1) {
        T2[i] += dt;
        if (NA.Player.alive) NA.Player.mana = Math.max(0, NA.Player.mana - SI_DRAIN * dt);
        if (T2[i] >= SI_HEAL) {
          T2[i] = 0;
          var healed = 0;
          var cnt = En.grid.query(X[i], Y[i], 220), out = En.grid.out;
          for (var q = 0; q < cnt && healed < 10; q++) {
            var j = out[q];
            if (j >= En.n || j === i || HP[j] >= MAXHP[j]) continue;
            HP[j] = Math.min(MAXHP[j], HP[j] + MAXHP[j] * 0.12);
            healed++;
          }
          NA.Particles.ring(X[i], Y[i], 8, 200, 0.32, 2, 0.22, 1, 0.42, 0.75);
        }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      if (ST[i] === 1 && NA.Player.alive) {
        // the cord: a pulsing green line, dashes travel along it
        var k = (NA.Time.t * 1.6) % 1;
        R.line(L.VEIL, X[i], Y[i], px(), py(), 2.4, 0.22, 1, 0.42, 0.55);
        var mx = X[i] + (px() - X[i]) * k, my = Y[i] + (py() - Y[i]) * k;
        R.dot(L.VEIL, mx, my, 4, 0.6, 1, 0.7, 0.9);
      }
      R.sprite(L.ENEMIES, 'diamond', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.28, 1, 1, 1, a * (ST[i] === 1 ? 0.9 : 0.4));
    },
    onDeath: function (i) {
      if (NA.Player.alive) NA.Player.addMana(C.DASH_COST, 'kill');
      NA.Particles.ring(X[i], Y[i], 6, 120, 0.35, 3, 0.3, 0.95, 1, 0.9);
    }
  });

  /* --- Rotator ---------------------------------------------------------
   * The boundary, the mirror walls and the floor rotate at ~6 deg/s. Enemies
   * ride the floor (tangential velocity); you do not. Two of them cancel. */
  var ROT_SPEED = 6 * Math.PI / 180;
  def('rotator', {
    shape: 'hex', color: COL.magenta, size: 26, hp: 130, speed: 70,
    cost: 24, band: 'D', flock: false, contact: 1, sides: 6, elite: true,
    cap: 2, retireWave: 0,
    init: function (i) { P0[i] = ROTATOR_N % 2 === 0 ? 1 : -1; },
    update: function (i, dt) {
      seek(i, NA.Arena.cx, NA.Arena.cy, 70, 1.2, dt);
      ROT[i] += P0[i] * 1.6 * dt;
      if (ROTATOR_N < 8) ROTATORS[ROTATOR_N++] = i;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 6, ROT[i], 2.6, cr, cg, cb, a);
      // arrows around the rim show the spin direction
      for (var k = 0; k < 3; k++) {
        var aa = ROT[i] * 2 + k * M.TAU / 3;
        var ax = X[i] + Math.cos(aa) * sz * 1.45, ay = Y[i] + Math.sin(aa) * sz * 1.45;
        var ta = aa + M.HALFPI * P0[i];
        R.line(L.ENEMIES, ax, ay, ax + Math.cos(ta) * 12, ay + Math.sin(ta) * 12, 2, cr, cg, cb, a * 0.8);
      }
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.22, 1, 1, 1, a * 0.7);
    }
  });

  /* --- Husk (Necromancer's raise) --------------------------------------
   * Gray, 30% HP, the same behaviour as the type it was raised from, and no
   * death effect. The source type index rides in the flags field. */
  def('husk', {
    shape: 'circle', color: [0.42, 0.46, 0.5], size: 12, hp: 6, speed: 90,
    cost: 0, band: 'D', flock: false, contact: 1, sides: 6, spawnTime: 0.35,
    cap: 150, retireWave: 0,
    update: function (i, dt) {
      var si = (FLAGS[i] & HUSKSRC_MASK) >>> HUSKSRC_SH;
      var d = En.types[si];
      if (!d) { seek(i, px(), py(), 90, 3, dt); return; }
      if (d.update) d.update(i, dt);
      else seek(i, px(), py(), d.speed, 4, dt);
    },
    render: function (i, a) {
      var si = (FLAGS[i] & HUSKSRC_MASK) >>> HUSKSRC_SH;
      var d = En.types[si], sz = SIZE[i];
      var sides = d ? d.sides : 6;
      var g = 0.44 + (En.flash[i] > 0 ? 0.5 : 0);
      R.poly(L.ENEMIES, X[i], Y[i], sz, sides < 3 ? 3 : (sides > 8 ? 8 : sides), ROT[i], 1.8, g, g * 1.05, g * 1.15, a * 0.85);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.2, g, g, g, a * 0.5);
    }
  });

  /* --- Necromancer ------------------------------------------------------ */
  var NEC_PERIOD = 4, NEC_R = 300, NEC_MAX = 12;
  /* Composites and spawned filler never come back as Husks — a Husk is a body,
   * not a machine that builds more bodies. */
  var NO_RAISE = {
    husk: 1, larva: 1, echo: 1, cathedral: 1, ouroboros: 1, crush: 1, singularity: 1,
    swarmLord: 1, puller: 1, doppel: 1, tetherPair: 1, glazier: 1, rotator: 1,
    eclipse: 1, sunder: 1, herald: 1, necromancer: 1, moteling: 1
  };
  def('necromancer', {
    shape: 'hex', color: [0.10, 0.55, 0.28], size: 24, hp: 120, speed: 85,
    cost: 26, band: 'D', flock: false, contact: 1, sides: 6, eye: true, elite: true,
    cap: 4, retireWave: 0,
    init: function (i) { P0[i] = NA.RNG.range(0, NEC_PERIOD); },
    update: function (i, dt) {
      // hangs back, behind the crowd
      var d = Math.sqrt(M.dist2(X[i], Y[i], px(), py())) || 1;
      var ang = Math.atan2(py() - Y[i], px() - X[i]);
      var want = (d - 460) / 460;
      seek(i, X[i] + Math.cos(ang) * M.clamp(want, -1, 1) * 180,
              Y[i] + Math.sin(ang) * M.clamp(want, -1, 1) * 180, 85, 3, dt);
      P0[i] += dt;
      if (P0[i] < NEC_PERIOD) return;
      P0[i] = 0;
      var cp = En.corpses, raised = 0, husk = tid('husk');
      for (var k = 0; k < cp.n && raised < NEC_MAX; k++) {
        var idx = (cp.head - 1 - k + C.MAX_CORPSES * 2) % C.MAX_CORPSES;
        var st = cp.type[idx];
        if (st < 0) continue;                                    // already raised
        var sd = En.types[st];
        if (!sd || NO_RAISE[sd.id]) continue;
        if (M.dist2(cp.x[idx], cp.y[idx], X[i], Y[i]) > NEC_R * NEC_R) continue;
        var j = En.spawn(husk, cp.x[idx], cp.y[idx]);
        if (j < 0) break;
        FLAGS[j] = (FLAGS[j] & ~HUSKSRC_MASK) | ((st & 0xFF) << HUSKSRC_SH) | F_HUSK;
        if (sd.init) sd.init(j);                  // the source's own scratch, then our stats
        FLAGS[j] = (FLAGS[j] & ~(GROUP_MASK | ROLE_MASK)) | ((st & 0xFF) << HUSKSRC_SH) | F_HUSK;
        SIZE[j] = sd.size; HP[j] = MAXHP[j] = Math.max(3, sd.hp * 0.3);
        cp.type[idx] = -1;
        raised++;
        NA.Particles.ring(cp.x[idx], cp.y[idx], 4, 40, 0.35, 2, 0.2, 0.8, 0.4, 0.7);
      }
      if (raised) {
        NA.Particles.ring(X[i], Y[i], 10, NEC_R, 0.55, 3, 0.16, 0.7, 0.35, 0.55);
        if (NA.Audio) NA.Audio.sfx('spawn', { x: X[i], y: Y[i], vol: 0.5 });
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 6, ROT[i], 2.6, cr, cg, cb, a);
      var k = P0[i] / NEC_PERIOD;
      // the eye
      R.dot(L.ENEMIES, X[i], Y[i], sz * (0.3 + k * 0.14), 0.5 + k * 0.5, 1, 0.6, a * (0.5 + k * 0.5));
      R.ring(L.ENEMIES, X[i], Y[i], sz * 0.55, 1.4, 0.02, 0.05, 0.03, a);
    },
    onDeath: function () { crumbleHusks(); }
  });
  function crumbleHusks() {
    var husk = tid('husk');
    for (var i = En.n - 1; i >= 0; i--) {
      if (TYPE[i] !== husk) continue;
      NA.Particles.burst(X[i], Y[i], 3, 90, 0.28, 0.45, 0.48, 0.52, 0);
      En.pool.free(i);
    }
  }

  /* --- Doppel ----------------------------------------------------------
   * Your cyan twin, mirrored through the arena centre. It fires weak copies
   * of your shot and takes damage from enemy hazards. A puzzle enemy. */
  def('doppel', {
    shape: 'tri', color: COL.player, size: 14, hp: 90, speed: 0,
    cost: 22, band: 'D', flock: false, contact: 1, sides: 3, spawnTime: 0.6,
    cap: 2, retireWave: 0,
    init: function (i) { P0[i] = 0; },
    update: function (i, dt) {
      // position is the player mirrored through the centre
      X[i] = NA.Arena.cx * 2 - px();
      Y[i] = NA.Arena.cy * 2 - py();
      VX[i] = VY[i] = 0;
      ROT[i] = NA.Player.angle + Math.PI;
      P0[i] += dt;
      // En.fireMul carries NA.Player.mods.enemyFireMul (Feedback Loop)
      var period = En.fireMul / Math.max(0.6, NA.Player.stats.fireRate * 0.35);
      if (P0[i] >= period && NA.Player.alive) {
        P0[i] = 0;
        var dx = px() - X[i], dy = py() - Y[i];
        var l = Math.sqrt(dx * dx + dy * dy) || 1;
        NA.Bullets.fireEnemy(X[i] + dx / l * 20, Y[i] + dy / l * 20, dx / l * 620, dy / l * 620,
          { size: 6, life: 3, color: COL.player, dmg: 1 });
        if (NA.Audio) NA.Audio.sfx('shot', { x: X[i], y: Y[i], vol: 0.25 });
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      // an outline of your ship, never filled: it is you, inverted
      R.sprite(L.ENEMIES, 'shipHull', X[i], Y[i], ROT[i], sz * 1.5, sz * 1.3, cr, cg, cb, a * 0.75);
      R.ring(L.ENEMIES, X[i], Y[i], sz * 1.1, 1.2, cr, cg, cb, a * 0.35);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.2, cr, cg, cb, a * 0.8);
    }
  });

  /* --- Chronoform -------------------------------------------------------
   * A rotating magenta square with a 300px field. Inside it you and your
   * bullets move at 60%; the dash is unaffected and takes you out. Fields
   * never stack. Death grants 0.5s of haste. */
  var CF_HALF = 150;
  var CF_CX = [-1, 1, 1, -1, -1], CF_CY = [-1, -1, 1, 1, -1];
  def('chronoform', {
    shape: 'square', color: COL.magenta, size: 22, hp: 100, speed: 55,
    cost: 22, band: 'D', flock: false, contact: 1, sides: 4,
    cap: 4, retireWave: 0,
    update: function (i, dt) {
      seek(i, px(), py(), 55, 1.2, dt);
      ROT[i] += 0.5 * dt;
      if (CHRONO_N < LIST_CAP) CHRONO[CHRONO_N++] = i;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      // the field: a rotating square outline on the floor
      var c = Math.cos(ROT[i]), s = Math.sin(ROT[i]);
      var pxs = 0, pys = 0;
      for (var k = 0; k <= 4; k++) {
        var sx = CF_CX[k] * CF_HALF, sy = CF_CY[k] * CF_HALF;
        var wx = X[i] + sx * c - sy * s, wy = Y[i] + sx * s + sy * c;
        if (k > 0) R.line(L.FLOOR, pxs, pys, wx, wy, 2, cr, cg, cb, 0.3);
        pxs = wx; pys = wy;
      }
      R.disc(L.FLOOR, X[i], Y[i], CF_HALF * 1.1, cr * 0.5, cg * 0.3, cb * 0.5, 0.07);
      R.poly(L.ENEMIES, X[i], Y[i], sz, 4, ROT[i], 2.4, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.5, 4, -ROT[i] * 2, 1.6, 1, 1, 1, a * 0.5);
    },
    onDeath: function () { PLAYER_HASTE = 0.5; }
  });

  /* --- Flak ------------------------------------------------------------
   * A chunky yellow triangle. Its shell flies to where you were when it
   * fired (the burst point is a dim dot the whole way) and bursts into an
   * 8-bolt ring. Ring bolts hurt enemies too. */
  var SHELL_MAX = 48, SHELL = new Float32Array(SHELL_MAX * 7), SHELL_N = 0; // x y vx vy t dur alive
  var FLAK_PERIOD = 3.2, FLAK_TRAVEL = 1.05;
  function addShell(x, y, tx, ty) {
    for (var k = 0; k < SHELL_MAX; k++) {
      var o = k * 7;
      if (SHELL[o + 6] > 0) continue;
      SHELL[o] = x; SHELL[o + 1] = y;
      SHELL[o + 2] = (tx - x) / FLAK_TRAVEL; SHELL[o + 3] = (ty - y) / FLAK_TRAVEL;
      SHELL[o + 4] = 0; SHELL[o + 5] = FLAK_TRAVEL; SHELL[o + 6] = 1;
      if (k >= SHELL_N) SHELL_N = k + 1;
      return;
    }
  }
  def('flak', {
    shape: 'tri', color: COL.yellow, size: 22, hp: 75, speed: 95,
    cost: 16, band: 'D', flock: false, contact: 1, sides: 3, eye: true,
    cap: 20, retireWave: 0,
    init: function (i) { P0[i] = NA.RNG.range(0, FLAK_PERIOD); },
    update: function (i, dt) {
      var d = Math.sqrt(M.dist2(X[i], Y[i], px(), py())) || 1;
      var ang = Math.atan2(py() - Y[i], px() - X[i]);
      var want = (d - 620) / 620;
      seek(i, X[i] + Math.cos(ang) * M.clamp(want, -1, 1) * 200,
              Y[i] + Math.sin(ang) * M.clamp(want, -1, 1) * 200, 95, 3, dt);
      ROT[i] = ang + M.HALFPI;
      P0[i] += dt;
      if (P0[i] >= FLAK_PERIOD * En.fireMul) {
        P0[i] = 0;
        addShell(X[i], Y[i], px(), py());
        if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: X[i], y: Y[i], vol: 0.45 });
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      var tell = M.clamp01((P0[i] - (FLAK_PERIOD * En.fireMul - 0.4)) / 0.4);
      R.sprite(L.ENEMIES, 'tri', X[i], Y[i], ROT[i], sz * 1.15, sz, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.55, 3, ROT[i], 2, cr, cg, cb, a * 0.6);
      R.dot(L.ENEMIES, X[i], Y[i], sz * (0.18 + tell * 0.18), 1, M.lerp(0.85, 0.35, tell), 0.3, a * (0.6 + tell * 0.4));
    }
  });

  /* ============================ Band E ================================= */

  /* --- Wraith -----------------------------------------------------------
   * Fast invisible chaser. Mirror walls and domes do not stop it. A red
   * flare 0.4s before contact is its only tell. Death reveals its neighbours. */
  var WR_SPEED = 250;
  def('wraith', {
    shape: 'circle', color: COL.violet, size: 13, hp: 20, speed: WR_SPEED,
    cost: 10, band: 'E', flock: false, contact: 2, sides: 8, invisible: true,
    spawnTime: 0.4, cap: 40, retireWave: 0,
    update: function (i, dt) {
      seek(i, px(), py(), WR_SPEED, 3.5, dt);
      var d2 = M.dist2(X[i], Y[i], px(), py());
      var warn = WR_SPEED * 0.4 + SIZE[i] + C.SHIP_R;
      if (d2 < warn * warn) {
        // the flare: a red telegraph, drawn above everything
        var k = 1 - Math.sqrt(d2) / warn;
        R.ring(L.VEIL, X[i], Y[i], SIZE[i] * (1.6 + k), 2.4, 1, 0.18, 0.30, 0.55 + k * 0.45);
        R.line(L.VEIL, X[i], Y[i], px(), py(), 1.6, 1, 0.18, 0.30, 0.22 + k * 0.3);
        FLAGS[i] |= F_TELE;
      } else FLAGS[i] &= ~F_TELE;
    },
    render: function (i, a, cr, cg, cb) {
      if (a <= 0.02) return;
      var sz = SIZE[i];
      // a violet smear, stretched along the direction of travel
      var sp = Math.sqrt(VX[i] * VX[i] + VY[i] * VY[i]) || 1;
      var ang = Math.atan2(VY[i], VX[i]);
      R.sprite(L.ENEMIES, 'capsule', X[i], Y[i], ang, sz * (1.2 + sp / WR_SPEED * 0.8), sz * 0.8, cr, cg, cb, a * 0.9);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.28, 1, 1, 1, a * 0.5);
    },
    onDeath: function (i) { revealPulse(X[i], Y[i], 420, 1.1); }
  });

  /* --- Crush ------------------------------------------------------------
   * A pair at opposite rims. The boundary contracts toward the line between
   * them at 10px/s until either half dies. */
  var CRUSH_RATE = 10;
  def('crush', {
    shape: 'hex', color: COL.magenta, size: 30, hp: 200, speed: 26,
    cost: 34, band: 'E', flock: false, contact: 1, sides: 6, elite: true,
    cap: 2, retireWave: 0,
    init: function (i) {
      var partnerOf = -1;
      for (var j = 0; j < En.n; j++) if (j !== i && TYPE[j] === TYPE[i]) { partnerOf = j; break; }
      var ang = Math.atan2(Y[i] - NA.Arena.cy, X[i] - NA.Arena.cx);
      if (partnerOf < 0) {
        P0[i] = ang; ST[i] = 1;                       // the leader spawns its twin
        var oa = ang + Math.PI;
        var rr = NA.Arena.radiusAt(oa) - 40;
        var j2 = En.spawn(TYPE[i], NA.Arena.cx + Math.cos(oa) * rr, NA.Arena.cy + Math.sin(oa) * rr);
        if (j2 >= 0) { ST[j2] = 2; P0[j2] = oa; }
      } else if (ST[i] === 0) { ST[i] = 2; P0[i] = ang; }
    },
    update: function (i, dt) {
      // hug the rim, drifting slowly around it
      P0[i] += 0.06 * dt;
      var rr = NA.Arena.radiusAt(P0[i]) - 40;
      seek(i, NA.Arena.cx + Math.cos(P0[i]) * rr, NA.Arena.cy + Math.sin(P0[i]) * rr, 26, 2, dt);
      if (ST[i] !== 1) return;                        // only the leader contracts
      // a partner must still be alive
      var partner = -1;
      for (var j = 0; j < En.n; j++) if (j !== i && TYPE[j] === TYPE[i]) { partner = j; break; }
      if (partner < 0) { ST[i] = 2; return; }
      // squeeze the two sides perpendicular to the connecting line
      var lineA = Math.atan2(Y[partner] - Y[i], X[partner] - X[i]);
      NA.Arena.shrinkSide(lineA + M.HALFPI, CRUSH_RATE * dt);
      NA.Arena.shrinkSide(lineA - M.HALFPI, CRUSH_RATE * dt);
      if (((NA.Time.frames / 30) | 0) % 4 === 0)
        R.line(L.FLOOR, X[i], Y[i], X[partner], Y[partner], 2, 1, 0.235, 0.675, 0.18);
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 6, ROT[i], 3, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.6, 6, -ROT[i], 2, cr, cg, cb, a * 0.6);
      // inward chevrons: the direction the wall is coming from
      var ia = Math.atan2(NA.Arena.cy - Y[i], NA.Arena.cx - X[i]);
      for (var k = 0; k < 2; k++) {
        var off = 26 + k * 16 + ((NA.Time.t * 40) % 16);
        var cx0 = X[i] + Math.cos(ia) * (sz + off), cy0 = Y[i] + Math.sin(ia) * (sz + off);
        R.line(L.ENEMIES, cx0, cy0, cx0 + Math.cos(ia + 2.4) * 12, cy0 + Math.sin(ia + 2.4) * 12, 2, cr, cg, cb, a * 0.5);
        R.line(L.ENEMIES, cx0, cy0, cx0 + Math.cos(ia - 2.4) * 12, cy0 + Math.sin(ia - 2.4) * 12, 2, cr, cg, cb, a * 0.5);
      }
    }
  });

  /* --- Cathedral --------------------------------------------------------
   * A hex core with six orbiting nodes: two Sentinels, two Hives, two
   * Wardens, spawned as real child enemies and flown around the core. The
   * core is invulnerable until four nodes die, and exactly one node is
   * exposed (brighter) at a time. Death is a 300px blast that also clears
   * every Larva and Husk. */
  var CATH_NODES = 6, CATH_ORBIT = 190;
  def('cathedral', {
    shape: 'hex', color: COL.green, size: 58, hp: 420, speed: 26,
    cost: 90, band: 'E', flock: false, contact: 1, sides: 6, elite: true,
    spawnTime: 1.0, cap: 2, retireWave: 0,
    init: function (i) {
      var g = newGroup();
      setGroup(i, g, 63);                       // role 63 = the core
      P0[i] = 0; P1[i] = 0;
      var kinds = ['sentinel', 'sentinel', 'hive', 'hive', 'warden', 'warden'];
      for (var k = 0; k < CATH_NODES; k++) {
        var id = kinds[k];
        if (!have(id)) id = have('hive') ? 'hive' : 'mote';
        var a = k / CATH_NODES * M.TAU;
        var j = En.spawn(id, X[i] + Math.cos(a) * CATH_ORBIT, Y[i] + Math.sin(a) * CATH_ORBIT);
        if (j >= 0) setGroup(j, g, k);
      }
    },
    update: function (i, dt) {
      seek(i, px(), py(), 26, 0.8, dt);
      P0[i] += dt * 0.55;                       // orbit phase
      P1[i] += dt;
      if (P1[i] >= 3) { P1[i] = 0; ST[i] = (ST[i] + 1) % CATH_NODES; }   // the exposed node rotates
    },
    onDamage: function (i) {
      var g = groupOf(i);
      return GCNT[g] - 1 <= 2;                 // core is invulnerable until 4 nodes die
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      var g = groupOf(i);
      var open = GCNT[g] - 1 <= 2;
      R.poly(L.ENEMIES, X[i], Y[i], sz, 6, ROT[i] * 0.3, 4, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.7, 6, -ROT[i] * 0.4, 2.4, cr, cg, cb, a * 0.7);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.4, 6, ROT[i] * 0.6, 2, cr, cg, cb, a * 0.5);
      if (open) {
        var b = 0.55 + 0.45 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ * 0.5);
        R.dot(L.ENEMIES, X[i], Y[i], sz * 0.3, 1, 1, 1, a * b);
      } else {
        R.ring(L.ENEMIES, X[i], Y[i], sz * 1.2, 2, 0.5, 0.6, 0.55, a * 0.35);
      }
      // tethers to the living nodes
      for (var k = 0; k < CATH_NODES; k++) {
        var j = GMEM[g * GSLOT + k];
        if (j < 0) continue;
        R.line(L.ENEMIES, X[i], Y[i], X[j], Y[j], 1.4, cr, cg, cb, a * 0.22);
      }
    },
    onDeath: function (i) {
      var g = groupOf(i);
      for (var k = 0; k < CATH_NODES; k++) {
        var j = GMEM[g * GSLOT + k];
        if (j >= 0 && j < En.n) clearGroup(j);
      }
      NA.Bullets.explode(X[i], Y[i], 300, 60, 1);
      NA.Particles.ring(X[i], Y[i], 30, 300, 0.6, 6, 0.22, 1, 0.42, 1);
      NA.FX.trauma(0.35); NA.FX.flash(0.18, 130);
      crumbleHusks();
      var larva = tid('larva');
      for (var q = En.n - 1; q >= 0; q--) if (TYPE[q] === larva) En.kill(q, false);
    }
  });

  /* --- Herald ----------------------------------------------------------- */
  var HERALD_PERIOD = 6, HERALD_TARGETS = 15;
  var MUTLIST = null;
  def('herald', {
    shape: 'diamond', color: COL.green, size: 20, hp: 110, speed: 130,
    cost: 40, band: 'E', flock: false, contact: 1, sides: 4, elite: true,
    cap: 2, retireWave: 0,
    init: function (i) { P0[i] = NA.RNG.range(0, HERALD_PERIOD); },
    update: function (i, dt) {
      var d = Math.sqrt(M.dist2(X[i], Y[i], px(), py())) || 1;
      var ang = Math.atan2(py() - Y[i], px() - X[i]);
      var want = (d - 420) / 420;
      seek(i, X[i] + Math.cos(ang) * M.clamp(want, -1, 1) * 200 - Math.sin(ang) * 120,
              Y[i] + Math.sin(ang) * M.clamp(want, -1, 1) * 200 + Math.cos(ang) * 120, 130, 3, dt);
      P0[i] += dt;
      if (P0[i] < HERALD_PERIOD) return;
      P0[i] = 0;
      if (!MUTLIST) { MUTLIST = []; for (var k in En.MUT) MUTLIST.push(En.MUT[k]); }
      var bit = MUTLIST[NA.RNG.int(MUTLIST.length)];
      var applied = 0;
      var cnt = En.grid.query(X[i], Y[i], 520), out = En.grid.out;
      for (var q = 0; q < cnt && applied < HERALD_TARGETS; q++) {
        var j = out[q];
        if (j >= En.n || j === i) continue;
        En.setMutator(j, bit);
        applied++;
      }
      NA.Particles.ring(X[i], Y[i], 12, 520, 0.5, 3, 0.22, 1, 0.42, 0.8);
      if (NA.Audio) NA.Audio.sfx('telegraph', { x: X[i], y: Y[i] });
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.sprite(L.ENEMIES, 'diamond', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      // the halo: kill this first
      var k = P0[i] / HERALD_PERIOD;
      R.ring(L.ENEMIES, X[i], Y[i], sz * 1.7, 2, 1, 0.847, 0.302, a * (0.35 + k * 0.5));
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.24, 1, 1, 1, a * 0.8);
    }
  });

  /* --- Singularity (the enemy) ------------------------------------------
   * Spawns at the centre after a 3s warning swirl. The pull grows every
   * second: inescapable without a dash at 20s, eating the arena at 40s. It
   * destroys what it swallows, bends projectiles, and your damage scales
   * with proximity. Death kills everything within 400px. */
  var SG_WARN = 3, SG_FULL = 40;
  def('singularity', {
    shape: 'circle', color: COL.magenta, size: 22, hp: 900, speed: 0,
    cost: 120, band: 'E', flock: false, contact: 2, sides: 8, elite: true,
    spawnTime: 0.6, cap: 1, retireWave: 0,
    init: function (i) {
      X[i] = NA.Arena.cx; Y[i] = NA.Arena.cy;
      ST[i] = 0; T2[i] = 0;
      INTAN[i] = SG_WARN + 0.6;
    },
    update: function (i, dt) {
      X[i] = NA.Arena.cx; Y[i] = NA.Arena.cy; VX[i] = VY[i] = 0;
      T2[i] += dt;
      if (ST[i] === 0) { if (T2[i] >= SG_WARN) { ST[i] = 1; T2[i] = 0; NA.FX.trauma(0.3); } return; }
      SING = i;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      if (ST[i] === 0) {
        var tc = En.telegraphColor(T2[i], SG_WARN), al = En.telegraphPulse(T2[i], SG_WARN);
        var k = M.clamp01(T2[i] / SG_WARN);
        for (var s = 0; s < 5; s++) {
          var a0 = -NA.Time.t * 2.2 + s * M.TAU / 5;
          R.arc(L.VEIL, X[i], Y[i], (1 - k) * 700 + 60, a0, a0 + 1.2, 3, tc[0], tc[1], tc[2], al * 0.75);
        }
        R.ring(L.VEIL, X[i], Y[i], sz * k, 3, tc[0], tc[1], tc[2], al);
        return;
      }
      var grow = 1 + M.clamp01(T2[i] / SG_FULL) * 2.2;
      // the lensing ring
      R.disc(L.ENEMIES, X[i], Y[i], sz * grow * 1.9, 0.01, 0.01, 0.02, 0.95);
      R.ring(L.ENEMIES, X[i], Y[i], sz * grow, 3, cr, cg, cb, a);
      R.ring(L.ENEMIES, X[i], Y[i], sz * grow * 1.45, 1.6, cr, cg, cb, a * 0.5);
      for (var q = 0; q < 3; q++) {
        var t = (NA.Time.t * 0.7 + q / 3) % 1;
        R.ring(L.FLOOR, X[i], Y[i], (1 - t) * pullRadius(i), 2, cr, cg, cb, 0.18 * t);
      }
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.3 * grow, 1, 1, 1, a * 0.8);
    },
    onDeath: function (i) {
      var x = X[i], y = Y[i];
      NA.Particles.ring(x, y, 30, 400, 0.7, 8, 1, 1, 1, 1);
      NA.FX.flash(0.32, 200); NA.FX.chroma(3, 300); NA.FX.trauma(0.6);
      // everything within 400px dies — collected first, freed highest-index
      // first, so no swap-remove lands in the middle of the sweep
      SWALLOW_N = 0;
      for (var q = 0; q < En.n; q++) {
        if (q === i || M.dist2(X[q], Y[q], x, y) > 400 * 400) continue;
        if (SWALLOW_N < 512) SWALLOW[SWALLOW_N++] = q;
      }
      sortDesc(SWALLOW, SWALLOW_N);
      for (q = 0; q < SWALLOW_N; q++) if (SWALLOW[q] < En.n) En.kill(SWALLOW[q], true);
      if (SG_DMG_BASE >= 0) { NA.Player.stats.damage = SG_DMG_BASE; SG_DMG_BASE = -1; }
      NA.Arena.setRadius(NA.Arena.baseRadius, 2.5);
    }
  });
  function pullRadius(i) { return 360 + M.clamp01(T2[i] / SG_FULL) * 900; }

  /* --- Ouroboros --------------------------------------------------------
   * 24 links on a parametric circle that drifts to you and contracts. Two
   * empty slots make the rotating gap; every link killed leaves its own hole,
   * so three adjacent kills open another gap. Twelve kills dissolve it. */
  var OU_LINKS = 24, OU_SLOTS = 26, OU_R0 = 560, OU_R1 = 230, OU_CONTRACT = 16;
  var OU = [], OU_BUILD = false;                 // per-group ring state
  function ouState(g) {
    var s = OU[g];
    if (!s) { s = OU[g] = { cx: 0, cy: 0, r: OU_R0, gap: 0, killed: 0, frame: -1 }; }
    s.frame = -1;
    return s;
  }
  def('ouroboros', {
    shape: 'diamond', color: COL.orange, size: 17, hp: 40, speed: 200,
    cost: 5, band: 'E', flock: false, contact: 1, sides: 4, spawnTime: 0.45,
    cap: 56, retireWave: 0,
    init: function (i) {
      if (OU_BUILD) return;                      // a link laid down by the head
      var g = newGroup();
      var s = ouState(g);
      s.cx = X[i]; s.cy = Y[i]; s.r = OU_R0; s.gap = 0; s.killed = 0;
      setGroup(i, g, 0);
      OU_BUILD = true;
      for (var k = 1; k < OU_LINKS; k++) {
        var a = k / OU_SLOTS * M.TAU;
        var j = En.spawn(TYPE[i], s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r);
        if (j < 0) break;
        setGroup(j, g, k);
      }
      OU_BUILD = false;
    },
    update: function (i, dt) {
      var g = groupOf(i);
      var s = OU[g];
      if (!s) { seek(i, px(), py(), 200, 3, dt); return; }
      if (roleOf(i) === 0 || GMEM[g * GSLOT + 0] < 0) {
        // the lowest-role living link drives the ring (once per frame is enough)
        if (s.frame !== NA.Time.frames) {
          s.frame = NA.Time.frames;
          s.gap += dt * 0.55;
          s.cx = M.smooth(s.cx, px(), 1.1, dt);
          s.cy = M.smooth(s.cy, py(), 1.1, dt);
          s.r = Math.max(OU_R1, s.r - OU_CONTRACT * dt);
        }
      }
      var slot = (roleOf(i) + s.gap) % OU_SLOTS;
      var ang = slot / OU_SLOTS * M.TAU;
      seek(i, s.cx + Math.cos(ang) * s.r, s.cy + Math.sin(ang) * s.r, 200, 5, dt);
      ROT[i] = ang;
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.sprite(L.ENEMIES, 'diamond', X[i], Y[i], ROT[i], sz, sz, cr, cg, cb, a);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.24, 1, 1, 1, a * 0.6);
    },
    onDeath: function (i) {
      var g = groupOf(i), s = OU[g];
      if (!s) return;
      s.killed++;
      if (s.killed >= 12) {
        for (var q = En.n - 1; q >= 0; q--) {
          if (q === i || groupOf(q) !== g) continue;
          NA.Particles.burst(X[q], Y[q], 3, 160, 0.3, 1, 0.54, 0, 1);
          En.pool.free(q);
        }
        OU[g] = null;
      }
    }
  });

  /* --- Charger Elite ----------------------------------------------------
   * Three chained charges with 0.6s re-telegraphs; the last lock is longest. */
  var CE_LOCK = [0.9, 0.9, 1.35], CE_TELE = [1.3, 0.6, 0.6], CE_DIST = 620, CE_SPEED = 1180;
  def('chargerElite', {
    shape: 'chevron', color: COL.orange, size: 22, hp: 90, speed: 300,
    cost: 24, band: 'E', flock: false, contact: 1, sides: 3, elite: true,
    cap: 10, retireWave: 0,
    init: function (i) { ST[i] = 0; T2[i] = 0; P0[i] = 0; P1[i] = 0; },
    update: function (i, dt) {
      T2[i] += dt;
      var round = P1[i] | 0;
      if (ST[i] === 0) {                               // bait: jitter at range
        var d = Math.sqrt(M.dist2(X[i], Y[i], px(), py())) || 1;
        var ang = Math.atan2(py() - Y[i], px() - X[i]);
        var want = (d - 430) / 430;
        var j = Math.sin(NA.Time.t * 3.1 + SEED[i]) * 0.9;
        seek(i, X[i] + Math.cos(ang) * M.clamp(want, -1, 1) * 200 - Math.sin(ang) * j * 160,
                Y[i] + Math.sin(ang) * M.clamp(want, -1, 1) * 200 + Math.cos(ang) * j * 160, 300, 4, dt);
        ROT[i] = ang;
        if (T2[i] > 1.5) { ST[i] = 1; T2[i] = 0; P1[i] = 0; }
      } else if (ST[i] === 1) {                        // telegraph
        VX[i] *= 1 - 7 * dt; VY[i] *= 1 - 7 * dt;
        FLAGS[i] |= F_TELE;
        var dur = CE_TELE[round], lock = CE_LOCK[round];
        if (T2[i] < lock * 0.6) P0[i] = Math.atan2(py() - Y[i], px() - X[i]);
        ROT[i] = P0[i];
        En.telegraphArrow(X[i], Y[i], P0[i], CE_DIST * 0.55, T2[i], dur, lock);
        if (T2[i] >= dur) {
          ST[i] = 2; T2[i] = 0; FLAGS[i] &= ~F_TELE;
          VX[i] = Math.cos(P0[i]) * CE_SPEED; VY[i] = Math.sin(P0[i]) * CE_SPEED;
          NA.FX.trauma(0.05);
        }
      } else {                                          // charging
        VX[i] *= 1 - 1.1 * dt; VY[i] *= 1 - 1.1 * dt;
        // shoves allies aside
        var cnt = En.grid.query(X[i], Y[i], SIZE[i] * 2.6), out = En.grid.out;
        for (var q = 0; q < cnt; q++) {
          var e = out[q];
          if (e >= En.n || e === i) continue;
          var dx = X[e] - X[i], dy = Y[e] - Y[i];
          var l = Math.sqrt(dx * dx + dy * dy) || 1;
          VX[e] += dx / l * 260; VY[e] += dy / l * 260;
        }
        if (T2[i] >= CE_DIST / CE_SPEED) {
          P1[i] = round + 1;
          if (P1[i] >= 3) { ST[i] = 0; P1[i] = 0; } else { ST[i] = 1; }
          T2[i] = 0;
        }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      var hot = ST[i] === 2 ? 1 : 0;
      R.sprite(L.ENEMIES, 'chevron', X[i], Y[i], ROT[i], sz * 1.2, sz, cr, M.lerp(cg, 0.2, hot), M.lerp(cb, 0.25, hot), a);
      // the elite diamond outline
      R.poly(L.ENEMIES, X[i], Y[i], sz * 1.5, 4, ROT[i] + 0.785, 1.2, 1, 1, 1, a * 0.3);
      // one pip per remaining charge
      for (var k = 0; k < 3 - (P1[i] | 0); k++)
        R.dot(L.ENEMIES, X[i] + Math.cos(ROT[i] + Math.PI) * (sz + 6 + k * 7),
                         Y[i] + Math.sin(ROT[i] + Math.PI) * (sz + 6 + k * 7), 2.4, 1, 0.6, 0.2, a * 0.8);
    }
  });

  /* --- Echo -------------------------------------------------------------
   * Replays recorded enemy paths. Every 5th frame the module records up to
   * 40 live enemies into NA.Enemies.echoBuffer; Echoes replay those tracks,
   * ignoring Pullers and Rotators (their positions are authored). Contact
   * damage only. */
  var ECHO_TRACKS = 40, ECHO_FRAMES = 1800;
  var EB = {
    tracks: ECHO_TRACKS, frames: ECHO_FRAMES,
    x: new Float32Array(ECHO_TRACKS * ECHO_FRAMES),
    y: new Float32Array(ECHO_TRACKS * ECHO_FRAMES),
    len: new Int32Array(ECHO_TRACKS),
    state: new Int32Array(ECHO_TRACKS),          // 0 free, 1 recording, 2 closed
    seen: new Int32Array(ECHO_TRACKS)
  };
  En.echoBuffer = EB;

  def('echo', {
    shape: 'circle', color: [0.62, 0.66, 0.72], size: 13, hp: 14, speed: 0,
    cost: 3, band: 'E', flock: false, contact: 1, sides: 6, spawnTime: 0.5,
    cap: 80, retireWave: 0,
    init: function (i) {
      // pick a track with something recorded on it
      var best = -1, bn = 0;
      for (var k = 0; k < ECHO_TRACKS; k++) {
        if (EB.len[k] > 40 && NA.RNG.f() < 1 / (++bn)) best = k;
      }
      FLAGS[i] |= F_ECHO;
      setGroup(i, 0, best < 0 ? 0 : best + 1);
      P0[i] = 0;                                  // cursor
      P1[i] = NA.RNG.f() * 0.9;                   // start offset (fraction)
      if (best >= 0) { P0[i] = ((EB.len[best] * P1[i]) | 0); X[i] = EB.x[best * ECHO_FRAMES + P0[i]]; Y[i] = EB.y[best * ECHO_FRAMES + P0[i]]; }
    },
    update: function (i, dt) {
      var tr = roleOf(i) - 1;
      VX[i] = VY[i] = 0;
      if (tr < 0 || EB.len[tr] < 2) { seek(i, px(), py(), 90, 2, dt); return; }
      P0[i] += dt * 24;                            // the recording rate: 24 samples/s
      if (P0[i] >= EB.len[tr]) P0[i] = 0;
      var c = P0[i] | 0, o = tr * ECHO_FRAMES + c;
      X[i] = EB.x[o]; Y[i] = EB.y[o];
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 6, ROT[i], 1.6, cr, cg, cb, a * 0.5);
      R.disc(L.ENEMIES, X[i], Y[i], sz * 0.8, cr, cg, cb, a * 0.12);
    }
  });

  /* --- Sunder -----------------------------------------------------------
   * Every 8s it telegraphs a full-arena line for 1.5s, then opens a 40px
   * chasm for 6s. Enemies cannot cross it; you can dash across. */
  var SU_PERIOD = 8, SU_TELE = 1.5, SU_LIFE = 6, SU_W = 40;
  def('sunder', {
    shape: 'square', color: COL.magenta, size: 26, hp: 160, speed: 60,
    cost: 34, band: 'E', flock: false, contact: 1, sides: 4, elite: true,
    cap: 1, retireWave: 0,
    init: function (i) { P0[i] = 0; P1[i] = NA.RNG.f() * M.TAU; ST[i] = 0; },
    update: function (i, dt) {
      seek(i, NA.Arena.cx, NA.Arena.cy, 60, 1, dt);
      P0[i] += dt;
      var Rr = NA.Arena.radius + 60;
      var ax = NA.Arena.cx + Math.cos(P1[i]) * Rr, ay = NA.Arena.cy + Math.sin(P1[i]) * Rr;
      var bx = NA.Arena.cx - Math.cos(P1[i]) * Rr, by = NA.Arena.cy - Math.sin(P1[i]) * Rr;
      if (ST[i] === 0) {
        if (P0[i] >= SU_PERIOD - SU_TELE) { ST[i] = 1; T2[i] = 0; P1[i] = NA.RNG.f() * M.TAU; }
      } else {
        T2[i] += dt;
        var Rr2 = NA.Arena.radius + 60;
        ax = NA.Arena.cx + Math.cos(P1[i]) * Rr2; ay = NA.Arena.cy + Math.sin(P1[i]) * Rr2;
        bx = NA.Arena.cx - Math.cos(P1[i]) * Rr2; by = NA.Arena.cy - Math.sin(P1[i]) * Rr2;
        En.telegraphLine(ax, ay, bx, by, T2[i], SU_TELE, SU_TELE * 0.75, 4);
        if (T2[i] >= SU_TELE) {
          NA.Arena.addChasm(ax, ay, bx, by, SU_W, SU_LIFE);
          NA.FX.trauma(0.25);
          if (NA.Audio) NA.Audio.sfx('explode', { x: X[i], y: Y[i], vol: 0.5 });
          ST[i] = 0; P0[i] = 0;
        }
      }
    },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      R.poly(L.ENEMIES, X[i], Y[i], sz, 4, ROT[i] * 0.4, 3, cr, cg, cb, a);
      // the crack
      R.line(L.ENEMIES, X[i] - sz * 0.7, Y[i] - sz * 0.3, X[i] + sz * 0.1, Y[i] + sz * 0.2, 1.6, 0.05, 0.05, 0.08, a);
      R.line(L.ENEMIES, X[i] + sz * 0.1, Y[i] + sz * 0.2, X[i] + sz * 0.6, Y[i] - sz * 0.5, 1.6, 0.05, 0.05, 0.08, a);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.2, 1, 1, 1, a * 0.5);
    }
  });

  /* --- Swarm Lord -------------------------------------------------------
   * A cyan hexagon inside a sphere of 60 Motelings. The Motelings are its
   * HP: it cannot be hurt while any are attached. Every 5s it bulges for
   * 0.7s and throws 15 of them at you as a cone. Under 10 it flees. */
  var SL_MOTES = 60, SL_ORBIT = 120, SL_PERIOD = 5, SL_BULGE = 0.7, SL_THROW = 15;
  def('swarmLord', {
    shape: 'hex', color: COL.player, size: 30, hp: 260, speed: 70,
    cost: 70, band: 'E', flock: false, contact: 1, sides: 6, elite: true,
    spawnTime: 0.8, cap: 3, retireWave: 0,
    init: function (i) {
      var g = newGroup();
      setGroup(i, g, 63);
      P0[i] = 0; ST[i] = 0;
      var id = have('moteling') ? 'moteling' : (have('mote') ? 'mote' : null);
      if (!id) return;
      for (var k = 0; k < SL_MOTES; k++) {
        var a = k / SL_MOTES * M.TAU * 3;
        var j = En.spawn(id, X[i] + Math.cos(a) * SL_ORBIT, Y[i] + Math.sin(a) * SL_ORBIT);
        if (j < 0) break;
        setGroup(j, g, k % 63);
        En.spawnT[j] = 0.2; INTAN[j] = 0.2;
      }
    },
    update: function (i, dt) {
      var g = groupOf(i);
      var attached = GCNT[g] - 1;
      P0[i] += dt;
      if (attached < 10) {                        // flees
        var fa = Math.atan2(Y[i] - py(), X[i] - px());
        seek(i, X[i] + Math.cos(fa) * 400, Y[i] + Math.sin(fa) * 400, 190, 3, dt);
        return;
      }
      seek(i, px(), py(), 70, 1.2, dt);
      if (ST[i] === 0 && P0[i] >= SL_PERIOD - SL_BULGE) { ST[i] = 1; T2[i] = 0; }
      if (ST[i] === 1) {
        T2[i] += dt;
        En.telegraphCircle(X[i], Y[i], SL_ORBIT * (1 + T2[i] / SL_BULGE * 0.35), T2[i], SL_BULGE, SL_BULGE * 0.8);
        if (T2[i] >= SL_BULGE) {
          ST[i] = 0; P0[i] = 0;
          var ang = Math.atan2(py() - Y[i], px() - X[i]);
          var thrown = 0;
          for (var k = 0; k < 63 && thrown < SL_THROW; k++) {
            var j = GMEM[g * GSLOT + k];
            if (j < 0 || j >= En.n) continue;
            clearGroup(j);
            var sa = ang + (thrown / SL_THROW - 0.5) * 0.9;
            VX[j] = Math.cos(sa) * 720; VY[j] = Math.sin(sa) * 720;
            thrown++;
          }
          if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: X[i], y: Y[i], vol: 0.5 });
          NA.FX.trauma(0.1);
        }
      }
    },
    onDamage: function (i) { return GCNT[groupOf(i)] - 1 <= 0; },
    render: function (i, a, cr, cg, cb) {
      var sz = SIZE[i];
      var g = groupOf(i);
      var attached = GCNT[g] - 1;
      var bulge = ST[i] === 1 ? (1 + T2[i] / SL_BULGE * 0.2) : 1;
      if (attached > 0) R.ring(L.ENEMIES, X[i], Y[i], SL_ORBIT * bulge, 1.4, cr, cg, cb, a * 0.25);
      R.poly(L.ENEMIES, X[i], Y[i], sz * bulge, 6, ROT[i], 3, cr, cg, cb, a);
      R.poly(L.ENEMIES, X[i], Y[i], sz * 0.55, 6, -ROT[i], 2, cr, cg, cb, a * 0.6);
      R.dot(L.ENEMIES, X[i], Y[i], sz * 0.24, 1, 1, 1, a * (attached > 0 ? 0.4 : 0.95));
    }
  });

  /* =====================================================================
   * The module tick — one pass over the enemies, then the field effects.
   * ===================================================================== */
  var anyGroupsLast = false;
  var SWALLOW = new Int32Array(512), SWALLOW_N = 0;
  function sortDesc(a, n) {                       // insertion sort; n is small and nearly sorted
    for (var i = 1; i < n; i++) {
      var v = a[i], j = i - 1;
      while (j >= 0 && a[j] < v) { a[j + 1] = a[j]; j--; }
      a[j + 1] = v;
    }
  }

  function tick(dt) {
    if (!hooked && NA.Game) {
      hooked = true;
      NA.Game.on('waveStart', onWaveStart);
    }

    var n = En.n, i;

    /* ---- one pass: type tally, group membership, haste decay ---------- */
    LIVE.fill(0);
    if (anyGroupsLast) { GMEM.fill(-1); GCNT.fill(0); }
    var anyGroups = false;
    var hasteTick = false;
    HASTE_ACC += dt;
    if (HASTE_ACC >= 0.5) { HASTE_ACC -= 0.5; hasteTick = true; }

    for (i = 0; i < n; i++) {
      var t = TYPE[i];
      if (t >= 0 && t < LIVE.length) LIVE[t]++;
      var f = FLAGS[i];
      var g = (f & GROUP_MASK) >>> GROUP_SH;
      if (g) {
        anyGroups = true;
        var role = (f & ROLE_MASK) >>> ROLE_SH;
        GMEM[g * GSLOT + (role & 63)] = i;
        GCNT[g]++;
      }
      if (hasteTick) {
        var h = (f & HASTE_MASK) >>> HASTE_SH;
        if (h > 0) FLAGS[i] = (f & ~HASTE_MASK) | ((h - 1) << HASTE_SH);
      }
    }
    anyGroupsLast = anyGroups;

    /* ---- reveal pulses ------------------------------------------------ */
    if (GREVEAL > 0) GREVEAL -= dt;
    for (i = 0; i < 8; i++) { var o = i * 4; if (REVEAL[o + 3] > 0) REVEAL[o + 3] -= dt; }

    /* ---- Wisp haste: hasted enemies move faster and leave a trail ----- */
    for (i = 0; i < n; i++) {
      if (!(FLAGS[i] & HASTE_MASK)) continue;
      X[i] += VX[i] * 0.5 * dt; Y[i] += VY[i] * 0.5 * dt;    // +50% while hasted
      if ((NA.Time.frames & 7) === 0)
        NA.Particles.spawn(X[i], Y[i], 0, 0, 0.24, SIZE[i] * 0.5, 0.3, 0.95, 1, 0.5, 0, 0.9);
    }


    /* ---- Cathedral: fly the nodes, expose exactly one ------------------ */
    if (anyGroups) {
      var cathT = tid('cathedral');
      for (i = 0; i < n; i++) {
        if (TYPE[i] !== cathT || roleOf(i) !== 63) continue;
        var cg = groupOf(i);
        for (var k = 0; k < CATH_NODES; k++) {
          var j = GMEM[cg * GSLOT + k];
          if (j < 0 || j >= En.n) continue;
          var a = P0[i] + k / CATH_NODES * M.TAU;
          X[j] = X[i] + Math.cos(a) * CATH_ORBIT;
          Y[j] = Y[i] + Math.sin(a) * CATH_ORBIT;
          VX[j] = VY[j] = 0;
          if (k === ST[i]) R.ring(L.ENEMIES, X[j], Y[j], SIZE[j] * 1.5,
            2, 1, 0.847, 0.302, 0.5 + 0.35 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ));
        }
      }
      /* ---- Swarm Lord: fly the attached motelings ---------------------- */
      var slT = tid('swarmLord');
      for (i = 0; i < n; i++) {
        if (TYPE[i] !== slT || roleOf(i) !== 63) continue;
        var sg = groupOf(i);
        var bulge = ST[i] === 1 ? (1 + T2[i] / SL_BULGE * 0.35) : 1;
        for (var m = 0; m < 63; m++) {
          var e = GMEM[sg * GSLOT + m];
          if (e < 0 || e >= En.n) continue;
          var ma = NA.Time.t * 0.8 + m * 2.399963;      // golden-angle sphere shell
          var rr = SL_ORBIT * bulge * (0.55 + 0.45 * Math.abs(Math.sin(m * 1.7 + NA.Time.t * 0.5)));
          X[e] = X[i] + Math.cos(ma) * rr;
          Y[e] = Y[i] + Math.sin(ma) * rr;
          VX[e] = VY[e] = 0;
        }
      }
    }

    /* ---- Pullers: enemies, the player and projectiles ------------------ */
    var q, o2;
    if (PULLER_N) {
      var doBullets = (NA.Time.frames & 3) === 0;
      for (var p = 0; p < PULLER_N; p++) {
        var pi = PULLERS[p];
        if (pi >= En.n) continue;
        var pxp = X[pi], pyp = Y[pi];
        var cnt = En.grid.query(pxp, pyp, PULL_R), out = En.grid.out;
        for (q = 0; q < cnt; q++) {
          var ei = out[q];
          if (ei >= En.n || ei === pi) continue;
          if (FLAGS[ei] & F_ECHO) continue;                 // echoes ignore pullers
          if (En.hasMutator(ei, En.MUT.ANCHORED)) continue;
          var dx = pxp - X[ei], dy = pyp - Y[ei];
          var l = Math.sqrt(dx * dx + dy * dy) || 1;
          if (l > PULL_R) continue;
          var kk = 1 - l / PULL_R;
          VX[ei] += dx / l * 620 * kk * dt; VY[ei] += dy / l * 620 * kk * dt;
        }
        if (NA.Player.alive) {
          var pdx = pxp - NA.Player.x, pdy = pyp - NA.Player.y;
          var pl2 = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
          if (pl2 < PULL_R) {
            var pk = 1 - pl2 / PULL_R;
            NA.Player.vx += pdx / pl2 * 320 * pk * dt; NA.Player.vy += pdy / pl2 * 320 * pk * dt;
          }
        }
        if (doBullets) pullBullets(pxp, pyp, PULL_R, 900, dt * 4);
      }
    }

    /* ---- Singularity ---------------------------------------------------- */
    if (SING >= 0 && SING < En.n) {
      var si = SING;
      var sr = pullRadius(si), age = T2[si];
      var strength = 420 + age * 46;                       // inescapable ~20s
      var sx = X[si], sy = Y[si];
      var eat = SIZE[si] * (1 + M.clamp01(age / SG_FULL) * 2.2) * 1.2;
      var scnt = En.grid.query(sx, sy, sr), sout = En.grid.out;
      SWALLOW_N = 0;
      for (q = 0; q < scnt; q++) {
        var e2 = sout[q];
        if (e2 >= En.n || e2 === si) continue;
        var ex = sx - X[e2], ey = sy - Y[e2];
        var el = Math.sqrt(ex * ex + ey * ey) || 1;
        if (el < eat) {                                    // swallowed
          NA.Particles.burst(X[e2], Y[e2], 3, 200, 0.25, 1, 0.235, 0.675, 0);
          if (SWALLOW_N < 512) SWALLOW[SWALLOW_N++] = e2;
          continue;
        }
        if (el > sr) continue;
        var ek = 1 - el / sr;
        VX[e2] += ex / el * strength * ek * dt; VY[e2] += ey / el * strength * ek * dt;
      }
      // free them afterwards, highest index first: swap-remove is safe that way
      if (SWALLOW_N > 1) sortDesc(SWALLOW, SWALLOW_N);
      for (q = 0; q < SWALLOW_N; q++) if (SWALLOW[q] < En.n) En.pool.free(SWALLOW[q]);
      if (NA.Player.alive) {
        var qdx = sx - NA.Player.x, qdy = sy - NA.Player.y;
        var ql = Math.sqrt(qdx * qdx + qdy * qdy) || 1;
        if (ql < sr && NA.Player.dashT <= 0) {
          var qk = 1 - ql / sr;
          NA.Player.vx += qdx / ql * strength * 0.62 * qk * dt;
          NA.Player.vy += qdy / ql * strength * 0.62 * qk * dt;
        }
        // damage bonus by proximity: up to +80% at the event horizon
        if (SG_DMG_BASE < 0) SG_DMG_BASE = NA.Player.stats.damage;
        var prox = M.clamp01(1 - ql / Math.max(1, sr));
        NA.Player.stats.damage = SG_DMG_BASE * (1 + prox * 0.8);
      }
      if ((NA.Time.frames & 1) === 0) pullBullets(sx, sy, sr, strength * 0.8, dt * 2);
      // it eats the arena in the last stretch
      if (age > 24) {
        var want = M.lerp(NA.Arena.baseRadius, C.ARENA_MIN_R, M.clamp01((age - 24) / (SG_FULL - 24)));
        if (want < NA.Arena.radius - 14) NA.Arena.setRadius(want, 1.0);
      }
    } else if (SG_DMG_BASE >= 0) {
      NA.Player.stats.damage = SG_DMG_BASE; SG_DMG_BASE = -1;
    }

    /* ---- Rotator: the floor turns, enemies ride it --------------------- */
    if (ROTATOR_N) {
      var dir = 0;
      for (i = 0; i < ROTATOR_N; i++) dir += P0[ROTATORS[i]];
      var rps = dir * ROT_SPEED;
      NA.Arena.rotate(rps);
      if (rps !== 0) {
        var cs = Math.cos(rps * dt), sn = Math.sin(rps * dt);
        // enemies ride the floor
        for (i = 0; i < n; i++) {
          var rx = X[i] - NA.Arena.cx, ry = Y[i] - NA.Arena.cy;
          if (FLAGS[i] & F_ECHO) continue;                  // echoes ignore rotators
          /* Blend TOWARDS the floor's velocity here (v = omega x r), never add
           * it: the old `+=` was an unbounded accumulator, so after a minute
           * of one Rotator every enemy was orbiting the rim at several km/s
           * and the last one alive could not be led, hit or ended. */
          var fvx = -ry * rps, fvy = rx * rps;
          var rk = 0.6 * dt; if (rk > 1) rk = 1;
          VX[i] += (fvx - VX[i]) * rk; VY[i] += (fvy - VY[i]) * rk;
        }
        // the mirror walls turn with the floor
        var ws = NA.Arena.mirrorWalls;
        for (i = 0; i < ws.length; i++) {
          var w = ws[i];
          var ax = w.x1 - NA.Arena.cx, ay = w.y1 - NA.Arena.cy;
          var bx = w.x2 - NA.Arena.cx, by = w.y2 - NA.Arena.cy;
          w.x1 = NA.Arena.cx + ax * cs - ay * sn; w.y1 = NA.Arena.cy + ax * sn + ay * cs;
          w.x2 = NA.Arena.cx + bx * cs - by * sn; w.y2 = NA.Arena.cy + bx * sn + by * cs;
        }
      }
    } else if (NA.Arena.rotSpeed !== 0 && ROT_WAS) {
      NA.Arena.rotate(0);
    }
    ROT_WAS = ROTATOR_N > 0;

    /* ---- Eclipse: the lantern ------------------------------------------ */
    if (ECLIPSE_N > 0) {
      var lantern = ECL_R * Math.pow(0.72, ECLIPSE_N - 1);
      var dark = Math.min(0.9, 0.62 + (ECLIPSE_N - 1) * 0.12);
      NA.FX.darkness(dark, 0);
      NA.R.light(NA.Player.x, NA.Player.y, lantern, 1.0);
      ECL_ON = true;
    } else if (ECL_ON) {
      NA.FX.darkness(0, 0);
      ECL_ON = false;
    }

    /* ---- Chronoform fields: 60% for you and your bullets ---------------- */
    if (CHRONO_N > 0 && NA.Player.alive) {
      var fi = -1;
      for (i = 0; i < CHRONO_N; i++) {
        var ci = CHRONO[i];
        if (ci >= En.n) continue;
        if (inField(ci, NA.Player.x, NA.Player.y)) { fi = ci; break; }   // fields do not stack
      }
      if (fi >= 0 && NA.Player.dashT <= 0) {
        NA.Player.x -= NA.Player.vx * 0.4 * dt;
        NA.Player.y -= NA.Player.vy * 0.4 * dt;
      }
      // bullets on alternate frames with double correction: same slow, half cost
      if ((NA.Time.frames & 1) === 0) {
        var BP = NA.Bullets.P, FR2 = (CF_HALF * 1.45) * (CF_HALF * 1.45);
        for (i = 0; i < BP.n; i++) {
          for (var c2 = 0; c2 < CHRONO_N; c2++) {
            var cj = CHRONO[c2];
            if (cj >= En.n) continue;
            var ddx = BP.x[i] - X[cj], ddy = BP.y[i] - Y[cj];
            if (ddx * ddx + ddy * ddy > FR2) continue;      // cheap reject first
            if (!inField(cj, BP.x[i], BP.y[i])) continue;
            BP.x[i] -= BP.vx[i] * 0.8 * dt; BP.y[i] -= BP.vy[i] * 0.8 * dt;
            break;
          }
        }
      }
    }
    if (PLAYER_HASTE > 0) {
      PLAYER_HASTE -= dt;
      NA.Player.x += NA.Player.vx * 0.45 * dt;
      NA.Player.y += NA.Player.vy * 0.45 * dt;
    }

    /* ---- Sunder chasms: enemies cannot cross, you dash across ---------- */
    if (NA.Arena.chasms.length) {
      for (i = 0; i < n; i++) {
        if (!NA.Arena.inChasm(X[i], Y[i])) continue;
        pushOutOfChasm(i, dt);
      }
      if (NA.Player.alive && NA.Player.dashT <= 0 && NA.Arena.inChasm(NA.Player.x, NA.Player.y)) {
        var ch = nearestChasm(NA.Player.x, NA.Player.y);
        if (ch) {
          var cdx = ch.x2 - ch.x1, cdy = ch.y2 - ch.y1;
          var cl = Math.sqrt(cdx * cdx + cdy * cdy) || 1;
          var nx0 = -cdy / cl, ny0 = cdx / cl;
          var side = (NA.Player.x - ch.x1) * nx0 + (NA.Player.y - ch.y1) * ny0;
          var s0 = side >= 0 ? 1 : -1;
          NA.Player.x += nx0 * s0 * 300 * dt; NA.Player.y += ny0 * s0 * 300 * dt;
        }
      }
    }

    /* ---- Flak shells and their rings ----------------------------------- */
    updateShells(dt);
    // ENEMYHURT now lives in 08_bullets.js (one implementation, one hit each)

    /* ---- Doppels take damage from enemy hazards ------------------------ */
    doppelHazards(dt);

    /* ---- echo recording ------------------------------------------------ */
    if (NA.Time.frames % 5 === 0 && NA.Game && NA.Game.state === 'wave') recordEcho();

    /* ---- reap anything a type marked dead during its own update -------- */
    for (i = En.n - 1; i >= 0; i--) if (HP[i] <= 0) En.kill(i, false);

    PULLER_N = 0; CHRONO_N = 0; ECLIPSE_N = 0; ROTATOR_N = 0; SING = -1;
  }
  var ROT_WAS = false, ECL_ON = false;

  function inField(ci, x, y) {
    var dx = x - X[ci], dy = y - Y[ci];
    var c = Math.cos(-ROT[ci]), s = Math.sin(-ROT[ci]);
    var lx = dx * c - dy * s, ly = dx * s + dy * c;
    return lx > -CF_HALF && lx < CF_HALF && ly > -CF_HALF && ly < CF_HALF;
  }

  function nearestChasm(x, y) {
    var cs = NA.Arena.chasms, best = null, bd = 1e18;
    for (var i = 0; i < cs.length; i++) {
      var d = segDist2(x, y, cs[i].x1, cs[i].y1, cs[i].x2, cs[i].y2);
      if (d < bd) { bd = d; best = cs[i]; }
    }
    return best;
  }
  function pushOutOfChasm(i, dt) {
    var ch = nearestChasm(X[i], Y[i]);
    if (!ch) return;
    var dx = ch.x2 - ch.x1, dy = ch.y2 - ch.y1;
    var l = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / l, ny = dx / l;
    var side = (X[i] - ch.x1) * nx + (Y[i] - ch.y1) * ny;
    var s = side >= 0 ? 1 : -1;
    X[i] += nx * s * 260 * dt; Y[i] += ny * s * 260 * dt;
    var vn = VX[i] * nx + VY[i] * ny;
    if (vn * s < 0) { VX[i] -= nx * vn; VY[i] -= ny * vn; }
  }

  function pullBullets(x, y, r, strength, dt) {
    var pools = 2, k;
    for (k = 0; k < pools; k++) {
      var B = k === 0 ? NA.Bullets.P : NA.Bullets.E;
      for (var i = 0; i < B.n; i++) {
        var dx = x - B.x[i], dy = y - B.y[i];
        var l2 = dx * dx + dy * dy;
        if (l2 > r * r) continue;
        var l = Math.sqrt(l2) || 1;
        var kk = 1 - l / r;
        B.vx[i] += dx / l * strength * kk * dt;
        B.vy[i] += dy / l * strength * kk * dt;
        B.rot[i] = Math.atan2(B.vy[i], B.vx[i]);
      }
    }
  }

  /* Flak shells: authored projectiles with a visible burst point. */
  function updateShells(dt) {
    var live = 0;
    for (var k = 0; k < SHELL_N; k++) {
      var o = k * 7;
      if (SHELL[o + 6] <= 0) continue;
      live++;
      SHELL[o + 4] += dt;
      SHELL[o] += SHELL[o + 2] * dt; SHELL[o + 1] += SHELL[o + 3] * dt;
      if (SHELL[o + 4] >= SHELL[o + 5]) {
        SHELL[o + 6] = 0;
        burstRing(SHELL[o], SHELL[o + 1]);
      }
    }
    if (!live) SHELL_N = 0;
  }
  function burstRing(x, y) {
    var F = NA.Bullets.FLAG;
    for (var k = 0; k < 8; k++) {
      var a = k / 8 * M.TAU + NA.Time.t * 0.3;
      NA.Bullets.fireEnemy(x, y, Math.cos(a) * 380, Math.sin(a) * 380,
        { size: 8, life: 2.2, color: COL.yellow, dmg: 1, flags: F.ENEMYHURT });
    }
    NA.Particles.ring(x, y, 6, 90, 0.3, 3, 1, 0.847, 0.302, 0.9);
    if (NA.Audio) NA.Audio.sfx('explode', { x: x, y: y, vol: 0.4 });
  }
  /* Ring bolts (and any other ENEMYHURT enemy bullet) hurt enemies too. */
  /* SUPERSEDED by 08_bullets.js. Never called. */
  function enemyHurtBullets() {
    return;
    /* eslint-disable no-unreachable */
    var B = NA.Bullets.E, F = NA.Bullets.FLAG;
    if (!En.n) return;
    for (var i = 0; i < B.n; i++) {
      if (!(B.flags[i] & F.ENEMYHURT)) continue;
      var cnt = En.grid.query(B.x[i], B.y[i], B.size[i] + 40), out = En.grid.out;
      for (var q = 0; q < cnt; q++) {
        var e = out[q];
        if (e >= En.n || INTAN[e] > 0) continue;
        var rr = B.size[i] + SIZE[e];
        var dx = X[e] - B.x[i], dy = Y[e] - B.y[i];
        if (dx * dx + dy * dy > rr * rr) continue;
        En.damage(e, 14, 'enemy');
        NA.Bullets.killE(i); i--;
        break;
      }
    }
  }

  /* Doppels are hurt by enemy fire and enemy hazards, never by yours alone. */
  function doppelHazards(dt) {
    var dt2 = tid('doppel');
    if (dt2 < 0 || LIVE[dt2] === 0) return;
    var B = NA.Bullets.E;
    for (var i = 0; i < En.n; i++) {
      if (TYPE[i] !== dt2) continue;
      var dead = false;
      for (var b = 0; b < B.n; b++) {
        if (B.owner[b] === 0) continue;
        var rr = B.size[b] + SIZE[i];
        var dx = X[i] - B.x[b], dy = Y[i] - B.y[b];
        if (dx * dx + dy * dy > rr * rr) continue;
        dead = En.damage(i, 18, 'enemy');
        NA.Bullets.killE(b); b--;
        if (dead) break;
      }
      if (dead) i--;
    }
  }

  /* --- echo recording ---------------------------------------------------- */
  function recordEcho() {
    var k, i, n = En.n;
    EB.seen.fill(0);
    for (i = 0; i < n; i++) {
      var f = FLAGS[i];
      if (f & F_ECHO) continue;
      if ((f & GROUP_MASK) !== 0) continue;
      var tr = ((f & ROLE_MASK) >>> ROLE_SH) - 1;
      if (tr >= 0 && tr < ECHO_TRACKS && EB.state[tr] === 1) {
        EB.seen[tr] = 1;
        var len = EB.len[tr];
        if (len < ECHO_FRAMES) { EB.x[tr * ECHO_FRAMES + len] = X[i]; EB.y[tr * ECHO_FRAMES + len] = Y[i]; EB.len[tr] = len + 1; }
        else EB.state[tr] = 2;
      }
    }
    for (k = 0; k < ECHO_TRACKS; k++) if (EB.state[k] === 1 && !EB.seen[k]) EB.state[k] = 2;  // owner died
    // hand free tracks to unstamped enemies
    for (i = 0; i < n; i++) {
      var f2 = FLAGS[i];
      if ((f2 & (GROUP_MASK | ROLE_MASK | F_ECHO)) !== 0) continue;
      var slot = -1;
      for (k = 0; k < ECHO_TRACKS; k++) if (EB.state[k] === 0) { slot = k; break; }
      if (slot < 0) break;
      EB.state[slot] = 1; EB.len[slot] = 0;
      FLAGS[i] = (f2 & ~ROLE_MASK) | (((slot + 1) & 0x3F) << ROLE_SH);
      EB.x[slot * ECHO_FRAMES] = X[i]; EB.y[slot * ECHO_FRAMES] = Y[i]; EB.len[slot] = 1;
      EB.seen[slot] = 1;
    }
  }

  function onWaveStart() {
    SPLIT_BUDGET = 120;
    GREVEAL = 0;
    for (var k = 0; k < ECHO_TRACKS; k++) { EB.state[k] = 0; EB.len[k] = 0; }
    for (var g = 0; g < OU.length; g++) OU[g] = null;
    SHELL_N = 0; SHELL.fill(0);
    GLAZ_RH = 0; GLAZ_RN = 0;
    ECL_ON = false; NA.FX.darkness(0, 0);
    ROT_WAS = false; NA.Arena.rotate(0);
    if (SG_DMG_BASE >= 0) { NA.Player.stats.damage = SG_DMG_BASE; SG_DMG_BASE = -1; }
    devSpawn();
  }

  /* =====================================================================
   * Module rendering (shells and their burst points).
   * ===================================================================== */
  function renderModule() {
    for (var k = 0; k < SHELL_N; k++) {
      var o = k * 7;
      if (SHELL[o + 6] <= 0) continue;
      var t = SHELL[o + 4], dur = SHELL[o + 5];
      // the burst point is a dim dot the whole flight: a 1.05s telegraph
      var bx = SHELL[o] + SHELL[o + 2] * (dur - t), by = SHELL[o + 1] + SHELL[o + 3] * (dur - t);
      var k2 = t / dur;
      R.ring(L.VEIL, bx, by, 26, 1.4, 1, M.lerp(0.72, 0.3, k2), 0.25, 0.25 + k2 * 0.5);
      R.dot(L.VEIL, bx, by, 3, 1, M.lerp(0.8, 0.3, k2), 0.3, 0.4 + k2 * 0.5);
      R.sprite(L.EBULLETS, 'dotRim', SHELL[o], SHELL[o + 1], 0, 9, 9, 0.86, 0.72, 0.26, 1);
    }
  }

  /* =====================================================================
   * Decorators on the framework entry points (additive, never replacing).
   * ===================================================================== */
  var _spawn = En.spawn;
  En.spawn = function (id, x, y) {
    var ti = typeof id === 'number' ? id : En.byId[id];
    if (ti !== undefined && ti >= 0) {
      var d = En.types[ti];
      if (d && d.cap && LIVE[ti] >= d.cap) return -1;
      var i = _spawn.call(En, id, x, y);
      if (i >= 0 && ti < LIVE.length) LIVE[ti]++;
      return i;
    }
    return _spawn.call(En, id, x, y);
  };

  var _update = En.update;
  En.update = function (dt) { _update.call(En, dt); tick(dt); };

  var _render = En.render;
  En.render = function () { _render.call(En); renderModule(); };

  var _revealOf = En.revealOf;
  En.revealOf = function (i) {
    var a = _revealOf.call(En, i);
    if (a >= 1) return a;
    if (GREVEAL > 0) a = Math.max(a, 0.9);
    for (var k = 0; k < 8; k++) {
      var o = k * 4;
      if (REVEAL[o + 3] <= 0) continue;
      var dx = X[i] - REVEAL[o], dy = Y[i] - REVEAL[o + 1];
      if (dx * dx + dy * dy < REVEAL[o + 2] * REVEAL[o + 2]) a = Math.max(a, 0.85);
    }
    return a;
  };

  /* Cathedral: only the exposed node can be hurt.
   * The same decorator carries a re-entrancy guard: a death whose onDeath
   * damages an area can kill something whose onDeath damages an area, and a
   * long chain of those recurses once per body. Past 16 links the chain is
   * cosmetically identical and the stack is not. */
  var _damage = En.damage, DMG_DEPTH = 0;
  En.damage = function (i, amt, src) {
    if (DMG_DEPTH > 16) return false;
    if (i >= 0 && i < En.n) {
      var g = groupOf(i);
      if (g && GCNT[g] > 1) {
        var role = roleOf(i);
        if (role !== 63) {
          var core = GMEM[g * GSLOT + 63];
          if (core >= 0 && core < En.n && En.types[TYPE[core]].id === 'cathedral' && ST[core] !== role) return false;
        }
      }
    }
    DMG_DEPTH++;
    var r = _damage.call(En, i, amt, src);
    DMG_DEPTH--;
    return r;
  };

  /* Explosions light up the dark: they reveal invisibles briefly. */
  var _explode = NA.Bullets.explode;
  NA.Bullets.explode = function (x, y, r, dmg, owner) {
    _explode.call(NA.Bullets, x, y, r, dmg, owner);
    revealPulse(x, y, r * 1.7, 0.45);
  };

  /* Telegraphs stay bright inside an Eclipse's darkness. */
  function litTelegraph(fn) {
    return function (a1, a2, a3, a4, a5, a6, a7, a8, a9) {
      if (ECL_ON) NA.R.light(a1, a2, 150, 0.9);
      return fn.call(En, a1, a2, a3, a4, a5, a6, a7, a8, a9);
    };
  }
  En.telegraphLine = litTelegraph(En.telegraphLine);
  En.telegraphCircle = litTelegraph(En.telegraphCircle);
  En.telegraphArrow = litTelegraph(En.telegraphArrow);

  /* =====================================================================
   * Dev param: ?spawn=id:count,id:count  (guarded — the Bands A/B module may
   * already provide it; whoever gets there first owns it).
   * ===================================================================== */
  if (!En.devSpawn) {
    En.devSpawn = function (spec) {
      if (!spec) return 0;
      var parts = String(spec).split(','), made = 0;
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split(':');
        var id = kv[0].trim();
        var cnt = kv.length > 1 ? Math.max(1, Math.min(400, parseInt(kv[1], 10) || 1)) : 1;
        if (!have(id)) continue;
        for (var k = 0; k < cnt; k++) {
          var a = NA.RNG.f() * M.TAU;
          if (En.spawnAtRim(id, a, 60) >= 0) made++;
        }
      }
      return made;
    };
  }
  var DEV_DONE = false;
  function devSpawn() {
    if (DEV_DONE || !NA.params || !NA.params.spawn) return;
    DEV_DONE = true;
    En.devSpawn(NA.params.spawn);
  }
})();
