/* 13b_bosses_1.js — BOSSES 1 (waves 2–10), owned by the BOSSES-1 agent.
 * Loads after 13_bosses.js (the registry + the Compactor reference fight).
 *
 * Defines, as rule-based fights with intro cinematics, minimum phase
 * durations, rim-ring integration and death spectacles:
 *
 *   constellation  tide  turntable  metronome  congregation
 *   strobe  cartographer  cadence  understudy
 *
 * Every fight follows GAME_PLAN §9: the intro shows the rule before the boss
 * can touch you (rim crack -> silhouette slide-in -> eye ignition + camera
 * punch -> the health ring draws itself), each phase floors the boss at 1 HP
 * until it has played, every damage source telegraphs for >= 0.4 s, and death
 * deforms the arena, the screen or the run.
 *
 * Performance: every per-fight buffer is a typed array allocated once in
 * enter(); lasers are segment tests; the flock is a flat SoA batch.
 */
(function () {
  var M = NA.M, C = NA.C, CO = C.COL;
  var A = NA.Arena;
  var TAU = M.TAU;

  /* ======================================================== shared helpers */

  function px() { return NA.Player.x; }
  function py() { return NA.Player.y; }

  function hurtPlayer(sx, sy) {
    if (!NA.Player.alive) return false;
    return NA.Player.damage(1, sx, sy);
  }

  function sfx(name, x, y) { if (NA.Audio) NA.Audio.sfx(name, { x: x, y: y }); }

  /* squared distance from a point to a segment — no allocation */
  function segDist2(qx, qy, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    var t = l2 > 1e-6 ? ((qx - x1) * dx + (qy - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var px2 = x1 + dx * t - qx, py2 = y1 + dy * t - qy;
    return px2 * px2 + py2 * py2;
  }

  /* the first enemy id in the list that actually exists (the roster grows
   * file by file, so minions must degrade gracefully) */
  function minionId(a, b2, c2) {
    var E = NA.Enemies;
    if (a && E.byId[a] !== undefined) return a;
    if (b2 && E.byId[b2] !== undefined) return b2;
    if (c2 && E.byId[c2] !== undefined) return c2;
    return null;
  }

  function spawnMinions(id, n, cx, cy, rad) {
    if (!id) return;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + NA.RNG.f() * 0.4;
      var x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      // nothing ever spawns within four ship-widths of the player
      if (M.dist2(x, y, px(), py()) < 160 * 160) continue;
      NA.Enemies.spawn(id, x, y);
    }
  }

  /* ------------------------------------------------------- intro cinematic
   * Shared for every fight in this file (GAME_PLAN §9): the membrane dims, a
   * point on the rim cracks white, the boss slides in silhouette-first, the
   * accent eye ignites with a camera punch. The framework draws the ring.
   * draw(x, y, lit01, alpha) renders the boss silhouette at the slide point. */
  function cine(b, t, draw) {
    var R = NA.R, LL = R.L, dur = b.def.introTime;
    var k = M.clamp01(t / dur);
    var col = b.def.color;
    var ang = b.angle;
    var rr = A.radiusAt(ang);
    var rx = A.cx + Math.cos(ang) * rr, ry = A.cy + Math.sin(ang) * rr;

    // 1. the rim cracks white
    var ck = M.clamp01(k / 0.3);
    var half = 0.22 * ck;
    R.arc(LL.MEMBRANE, A.cx, A.cy, rr, ang - half, ang + half, 4 + 8 * (1 - ck), 1, 1, 1, 0.9);
    for (var s = 0; s < 4; s++) {
      var sa = ang + (s / 3 - 0.5) * 0.5 * ck;
      R.line(LL.MEMBRANE, rx, ry,
        A.cx + Math.cos(sa) * (rr - 150 * ck), A.cy + Math.sin(sa) * (rr - 150 * ck),
        2.5, 1, 1, 1, 0.55 * (1 - ck * 0.5));
    }

    // 2. the silhouette slides in
    var sk = M.easeOutCubic(M.clamp01((k - 0.12) / 0.62));
    var bx = M.lerp(rx, b.x, sk), by = M.lerp(ry, b.y, sk);
    b.data._introX = bx; b.data._introY = by;
    var lit = M.clamp01((k - 0.74) / 0.2);
    if (sk > 0) draw(bx, by, lit, 0.35 + 0.65 * sk);

    // 3. the eye ignites, with a 4% camera punch
    if (k > 0.74) {
      var e = M.clamp01((k - 0.74) / 0.14);
      R.dot(LL.ENEMIES, bx, by, 6 + 16 * e, 1, 1, 1, e);
      R.softRing(LL.VEIL, bx, by, 60 + 260 * e, col[0], col[1], col[2], 0.35 * (1 - e));
      if (!b.data._punched) {
        b.data._punched = 1;
        NA.Cam.addTrauma(0.3);
        NA.Cam.setZoom(NA.Cam.zoom * 0.96, 150);
        NA.FX.flash(0.14, 130);
        NA.FX.chroma(2, 220);
        sfx('lock', bx, by);
      }
    }
    return false;
  }

  /* ------------------------------------------- persistent post-death events
   * Bosses stop updating once they are cleared, so anything that must outlive
   * the fight is parked in NA.Events (which runs and renders every frame). */

  var SKY_N = 9;
  var skyX = new Float32Array(SKY_N), skyY = new Float32Array(SKY_N);
  var skyLink = new Int32Array(SKY_N);
  var skyCount = 0;

  NA.Events.define('naSkyConstellation', {
    layer: 'backdrop', telegraph: 0, active: 1e9, decay: 0,
    render: function () {
      if (skyCount < 2) return;
      var R = NA.R, LL = R.L;
      var tw = 0.5 + 0.2 * Math.sin(NA.Time.t * 0.8);
      for (var i = 0; i < skyCount; i++) {
        var j = skyLink[i];
        if (j >= 0 && j < skyCount) {
          R.line(LL.BACKDROP, skyX[i], skyY[i], skyX[j], skyY[j], 1.6, 1, 0.88, 0.5, 0.16 * tw);
        }
        R.sprite(LL.BACKDROP, 'spark', skyX[i], skyY[i], 0, 4.5, 4.5, 1, 0.93, 0.7, 0.5 * tw);
      }
    }
  });

  NA.Events.define('naFlood', {
    layer: 'backdrop', telegraph: 0, active: 9, decay: 0,
    update: function (e, dt) {
      // the flood slows everything that walks in it; the player skates
      var E = NA.Enemies;
      for (var i = 0; i < E.n; i++) { E.vx[i] *= 0.985; E.vy[i] *= 0.985; }
      NA.Events.windX = Math.cos(e.angle) * 12 * (1 - e.k);
      NA.Events.windY = Math.sin(e.angle) * 12 * (1 - e.k);
    },
    onEnd: function () { NA.Events.windX = NA.Events.windY = 0; },
    render: function (e) {
      var R = NA.R, LL = R.L, t = NA.Time.t;
      var fade = 1 - e.k * 0.55;
      R.disc(LL.FLOOR, A.cx, A.cy, A.radius * 0.98, 0.10, 0.42, 0.75, 0.22 * fade);
      for (var i = 0; i < 9; i++) {
        var rr = A.radius * (0.12 + i * 0.108) + Math.sin(t * 1.6 + i) * 16;
        R.ring(LL.FLOOR, A.cx, A.cy, rr, 2 + (i & 1), 0.4, 0.85, 1, 0.16 * fade);
      }
    }
  });

  /* The Understudy's death gift (GAME_PLAN 9): you keep an after-image trail
   * for the rest of the run.  Parked in NA.Events like the constellation sky
   * and the tide's flood, so it outlives the fight.  Purely cosmetic. */
  var UT_N = 22;
  var utX = new Float32Array(UT_N), utY = new Float32Array(UT_N);
  var utA = new Float32Array(UT_N), utT = new Float32Array(UT_N);
  var utHead = 0, utCount = 0, utDrop = 0;

  NA.Events.define('naUnderstudyTrail', {
    layer: 'backdrop', telegraph: 0, active: 1e9, decay: 0,
    update: function (e, dt) {
      var P = NA.Player;
      if (!P || !P.alive) return;
      utDrop -= dt;
      if (utDrop > 0) return;
      utDrop = 0.055;
      utX[utHead] = P.x; utY[utHead] = P.y; utA[utHead] = P.angle; utT[utHead] = 0;
      utHead = (utHead + 1) % UT_N;
      if (utCount < UT_N) utCount++;
      for (var i = 0; i < utCount; i++) utT[i] += 0.055;
    },
    render: function () {
      if (!utCount) return;
      var R = NA.R, LL = R.L, p = CO.player || [0.3, 0.9, 1];
      for (var k = 0; k < utCount; k++) {
        var i = (utHead - 1 - k + UT_N * 2) % UT_N;
        var age = k / UT_N;
        var al = 0.30 * (1 - age) * (1 - age);
        if (al < 0.01) continue;
        R.sprite(LL.FLOOR, 'shipHull', utX[i], utY[i], utA[i],
          C.SHIP_R * 2 * (1 - age * 0.35), C.SHIP_R * 1.7 * (1 - age * 0.35),
          1 - p[0], 1 - p[1], 1 - p[2], al);
      }
    }
  });

  var inkWaves = 0;
  NA.Events.define('naInkInversion', {
    layer: 'backdrop', telegraph: 0, active: 1e9, decay: 0,
    update: function () {
      // the colour scheme stays inverted for one wave (FX pushes post each frame)
      NA.FX.hue(Math.PI, 120);
      NA.FX.desat(0.35, 120);
    },
    render: function () {
      var R = NA.R, LL = R.L;
      R.disc(LL.BACKDROP, A.cx, A.cy, A.radius * 1.5, 0.02, 0.05, 0.09, 0.5);
    }
  });

  /* wire the run-long hooks once, at runtime (NA.Game loads after this file) */
  var hooked = false;
  function hookGame() {
    if (hooked || !NA.Game || !NA.Game.on) return;
    hooked = true;
    NA.Game.on('waveStart', function () {
      if (inkWaves > 0) { inkWaves--; if (inkWaves <= 0) NA.Events.stop('naInkInversion'); }
      // another backdrop event may have evicted the sky; put it back
      if (skyCount > 1 && !NA.Events.isActive('naSkyConstellation')) {
        NA.Events.trigger('naSkyConstellation');
      }
    });
  }

  /* ============================================================ CONSTELLATION
   * Boss 2 (wave 2). The rule: five stars joined by lethal segment lines. Kill
   * a star and the figure REWIRES itself (the lines go orange and harmless for
   * a beat, then snap taut again). The last three stars form a hunting
   * triangle. Death draws the figure into the sky for the rest of the run. */

  var CN = 9;                 // the arrays hold the ceiling; d.lit ignites 5/7/9

  function cnInit(b) {
    var d = b.data;
    if (d.sa) return;
    d.sa = new Float32Array(CN); d.sr = new Float32Array(CN);
    d.sw = new Float32Array(CN); d.shp = new Float32Array(CN);
    d.sx = new Float32Array(CN); d.sy = new Float32Array(CN);
    d.alive = new Uint8Array(CN);
    d.order = new Int32Array(CN);
    for (var i = 0; i < CN; i++) {
      d.sa[i] = i / CN * TAU;
      d.sr[i] = 300 + (i % 3) * 130;
      d.sw[i] = 0.22 + (i % 2) * 0.09;
      d.shp[i] = 92;
      d.alive[i] = i < 5 ? 1 : 0;        // GAME_PLAN 9: 5-9 stars, 5 to open
    }
    d.lit = 5;
    d.wet = 1.2; d.fireT = 0; d.lastStar = -1; d.nAlive = 5;
    d.hunt = 0; d.hx = 0; d.hy = 0; d.hrot = 0;
  }

  function cnRewire(b) {
    var d = b.data, k = 0;
    for (var i = 0; i < CN; i++) if (d.alive[i]) d.order[k++] = i;
    d.nAlive = k;
    d.wet = 1.1;                       // the figure is harmless while it rewires
  }

  function cnKillStar(b, i, silent) {
    var d = b.data;
    if (!d.alive[i]) return;
    d.alive[i] = 0;
    NA.Particles.shatter(d.sx[i], d.sy[i], 34, 4, 1, 0.88, 0.4, 320);
    NA.Particles.ring(d.sx[i], d.sy[i], 12, 220, 0.5, 4, 1, 0.9, 0.5, 1);
    NA.Cam.addTrauma(0.25);
    if (!silent) sfx('kill', d.sx[i], d.sy[i]);
    cnRewire(b);
  }

  function cnMinAlive(b) { return b.phase >= 2 ? 1 : 3; }

  /* Each phase ignites two more stars: 5 -> 7 -> 9.  Only ever additive, and
   * the figure is harmless for the rewire beat while they arrive. */
  function cnIgnite(b, n) {
    var d = b.data;
    if (n <= d.lit) return;
    for (var i = d.lit; i < n && i < CN; i++) {
      d.alive[i] = 1; d.shp[i] = 92;
      d.sx[i] = A.cx + Math.cos(d.sa[i]) * d.sr[i];
      d.sy[i] = A.cy + Math.sin(d.sa[i]) * d.sr[i];
      NA.Particles.ring(d.sx[i], d.sy[i], 60, 14, 0.45, 4, 1, 0.9, 0.5, 0.9);
    }
    d.lit = Math.min(n, CN);
    cnRewire(b);
    sfx('telegraph', A.cx, A.cy);
  }

  function cnStarPositions(b, dt) {
    var d = b.data;
    if (b.phase >= 2 && d.hunt) {
      // the last three stars are welded into a triangle that hunts you
      var dx = px() - d.hx, dy = py() - d.hy;
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      d.hx += dx / l * 132 * dt; d.hy += dy / l * 132 * dt;
      d.hrot += 0.75 * dt;
      var k = 0;
      for (var i = 0; i < CN; i++) {
        if (!d.alive[i]) continue;
        var a = d.hrot + k * (TAU / Math.max(1, d.nAlive));
        d.sx[i] = d.hx + Math.cos(a) * 210;
        d.sy[i] = d.hy + Math.sin(a) * 210;
        k++;
      }
      b.x = d.hx; b.y = d.hy;
      return;
    }
    var wob = b.phase === 1 ? 1 : 0;
    for (var j = 0; j < CN; j++) {
      if (!d.alive[j]) continue;
      d.sa[j] += d.sw[j] * (b.phase === 1 ? 1.7 : 1) * dt;
      var rr = d.sr[j] + (wob ? Math.sin(NA.Time.t * 0.9 + j) * 90 : 0);
      d.sx[j] = A.cx + Math.cos(d.sa[j]) * rr;
      d.sy[j] = A.cy + Math.sin(d.sa[j]) * rr;
    }
  }

  function cnTick(b, dt) {
    var d = b.data;
    cnStarPositions(b, dt);
    if (d.wet > 0) d.wet -= dt;

    // the lines are the attack: lethal once the figure is taut
    if (d.wet <= 0 && NA.Player.alive) {
      for (var i = 0; i < d.nAlive; i++) {
        var a = d.order[i], c = d.order[(i + 1) % d.nAlive];
        if (a === c) continue;
        if (segDist2(px(), py(), d.sx[a], d.sy[a], d.sx[c], d.sy[c]) < 18 * 18) {
          hurtPlayer((d.sx[a] + d.sx[c]) * 0.5, (d.sy[a] + d.sy[c]) * 0.5);
          break;
        }
      }
    }

    // phase 2: the lines discharge along themselves
    if (b.phase === 1) {
      d.fireT += dt;
      if (d.fireT > 3.2 && d.nAlive > 1) {
        var idx = (b.t * 3 | 0) % d.nAlive;
        var s0 = d.order[idx], s1 = d.order[(idx + 1) % d.nAlive];
        var tt = d.fireT - 3.2;
        NA.Enemies.telegraphLine(d.sx[s0], d.sy[s0], d.sx[s1], d.sy[s1], tt, 0.8, 0.6, 5);
        if (tt >= 0.8) {
          d.fireT = 0;
          var vx = d.sx[s1] - d.sx[s0], vy = d.sy[s1] - d.sy[s0];
          var l = Math.sqrt(vx * vx + vy * vy) || 1;
          for (var q = 0; q < 5; q++) {
            NA.Bullets.fireEnemy(d.sx[s0] + vx * (q * 0.02), d.sy[s0] + vy * (q * 0.02),
              vx / l * 470, vy / l * 470, { size: 9, life: 3.2, color: CO.gold });
          }
          sfx('laser', d.sx[s0], d.sy[s0]);
        }
      }
    }
  }

  function cnDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var col = lit > 0 ? 1 : 0.25;
    for (var i = 0; i < 5; i++) {
      var a0 = i / 5 * TAU - 1.2, a1 = (i + 1) / 5 * TAU - 1.2;
      var x0 = x + Math.cos(a0) * 90, y0 = y + Math.sin(a0) * 90;
      var x1 = x + Math.cos(a1) * 90, y1 = y + Math.sin(a1) * 90;
      R.line(LL.ENEMIES, x0, y0, x1, y1, 2, col, col * 0.88, col * 0.4, alpha * 0.8);
      R.sprite(LL.ENEMIES, 'star4', x0, y0, 0.4, 13, 13, col, col * 0.9, col * 0.45, alpha);
    }
  }

  NA.Bosses.define('constellation', {
    name: 'Constellation', color: [1, 0.86, 0.35], hp: 460,
    introTime: 2.0, camZoom: 0.66,

    intro: function (b, t) { cnInit(b); return cine(b, t, cnDrawSil); },

    onPhase: function (b, i) {
      cnInit(b);
      var d = b.data;
      if (i === 1) cnIgnite(b, 7);
      if (i === 2) cnIgnite(b, 9);
      if (i === 2) {
        // weld the survivors into the hunting triangle
        var extra = d.nAlive - 3;
        for (var k = CN - 1; k >= 0 && extra > 0; k--) {
          if (d.alive[k]) { cnKillStar(b, k, true); extra--; }
        }
        d.hunt = 1; d.hx = A.cx; d.hy = A.cy;
        NA.FX.flash(0.2, 160);
      }
      cnRewire(b);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (!d.sa) return 0;
      for (var i = 0; i < CN; i++) {
        if (!d.alive[i]) continue;
        var dx = d.sx[i] - x, dy = d.sy[i] - y, rr = 30 + r;
        if (dx * dx + dy * dy < rr * rr) { d.lastStar = i; return 1; }
      }
      // taut lines eat projectiles: the geometry is the puzzle
      if (d.wet <= 0) {
        for (var j = 0; j < d.nAlive; j++) {
          var a = d.order[j], c = d.order[(j + 1) % d.nAlive];
          if (a === c) continue;
          if (segDist2(x, y, d.sx[a], d.sy[a], d.sx[c], d.sy[c]) < (12 + r) * (12 + r)) return 2;
        }
      }
      return 0;
    },

    onDamage: function (b, amt) {
      var d = b.data, i = d.lastStar;
      if (i < 0 || !d.alive[i]) return;
      d.shp[i] -= amt;
      if (d.shp[i] <= 0) {
        if (d.nAlive > cnMinAlive(b)) cnKillStar(b, i, false);
        else d.shp[i] = 20;                      // the last stars refuse to go
      }
    },

    phases: [
      { minDuration: 12, enter: function (b) { cnInit(b); cnRewire(b); }, update: cnTick },
      { minDuration: 13, enter: function (b) { b.data.fireT = 0; }, update: cnTick },
      { minDuration: 12, update: cnTick }
    ],

    onDeath: function (b) {
      var d = b.data;
      // the figure is drawn into the backdrop for the rest of the run
      skyCount = 0;
      for (var i = 0; i < CN && skyCount < SKY_N; i++) {
        if (!d.alive[i]) continue;
        skyX[skyCount] = d.sx[i] * 1.25 - 120;
        skyY[skyCount] = d.sy[i] * 1.25 - 420;
        skyCount++;
      }
      for (var q = skyCount; q < 3; q++) {
        var a = q / 3 * TAU;
        skyX[q] = Math.cos(a) * 900 - 120; skyY[q] = Math.sin(a) * 900 - 420;
        skyCount = q + 1;
      }
      for (var k = 0; k < skyCount; k++) skyLink[k] = (k + 1) % skyCount;
      hookGame();
      NA.Events.trigger('naSkyConstellation');
      for (var s = 0; s < CN; s++) {
        if (!d.alive[s]) continue;
        NA.Particles.ring(d.sx[s], d.sy[s], 20, 520, 0.9, 5, 1, 0.9, 0.5, 1);
        NA.Particles.burst(d.sx[s], d.sy[s], 20, 520, 0.7, 1, 0.9, 0.5, 1);
      }
      NA.FX.flash(0.3, 400);
    },

    render: function (b) {
      var d = b.data; if (!d.sa) return;
      var R = NA.R, LL = R.L;
      if (b.state === 'intro') return;
      var wet = d.wet > 0;
      var breathe = 0.6 + 0.4 * Math.sin(NA.Time.t * TAU * C.TELEGRAPH_HZ);
      for (var i = 0; i < d.nAlive; i++) {
        var a = d.order[i], c = d.order[(i + 1) % d.nAlive];
        if (a === c) continue;
        if (wet) {
          R.line(LL.VEIL, d.sx[a], d.sy[a], d.sx[c], d.sy[c], 3, 1, 0.541, 0, breathe);
        } else {
          R.line(LL.ENEMIES, d.sx[a], d.sy[a], d.sx[c], d.sy[c], 9, 1, 0.86, 0.35, 0.35);
          R.line(LL.ENEMIES, d.sx[a], d.sy[a], d.sx[c], d.sy[c], 2.6, 1, 1, 1, 0.95);
        }
      }
      for (var j = 0; j < CN; j++) {
        if (!d.alive[j]) continue;
        var hpk = M.clamp01(d.shp[j] / 92);
        var f = b.flash > 0 ? 1 : 0;
        R.sprite(LL.ENEMIES, 'star4', d.sx[j], d.sy[j], NA.Time.t * 0.5 + j, 26, 26,
          1, f ? 1 : 0.86, f ? 1 : 0.35, 0.95);
        R.ring(LL.ENEMIES, d.sx[j], d.sy[j], 34, 2, 1, 0.9, 0.5, 0.25 + 0.5 * hpk);
        R.dot(LL.ENEMIES, d.sx[j], d.sy[j], 5, 1, 1, 1, 0.9);
        R.light(d.sx[j], d.sy[j], 190, 0.35);
      }
    }
  });

  /* ==================================================================== TIDE
   * Boss 3 (wave 3). The rule: a full-width wall of foam crosses the arena.
   * It is lethal everywhere except at three permeable eyes — and the eyes are
   * the weak points, so the only way to hurt it is to be inside one. Dashing
   * through an open eye as the wall passes tears it open (bonus damage).
   * Phase 2 opens one eye at a time. Phase 3 sends two tides to meet.
   * Death collapses the wall into a knee-deep flood for the transition. */

  var TD_R = 66;                 // eye radius
  var TD_HALF = 26;              // wall half-thickness

  function tdInit(b) {
    var d = b.data;
    if (d.wdir) return;
    d.wdir = new Float32Array(2);
    d.wpos = new Float32Array(2);
    d.wst = new Float32Array(2);        // state timer
    d.wmode = new Int32Array(2);        // 0 = telegraph, 1 = crossing, 2 = rest
    d.wact = new Uint8Array(2);
    d.dashed = new Uint8Array(2);
    d.ey = new Float32Array(6);
    d.eo = new Float32Array(6);
    d.speed = 420;
    d.radius = 70;
    d.surge = 0;
    d.trackW = -1;
    for (var w = 0; w < 2; w++) {
      d.wdir[w] = w ? Math.PI : 0;
      d.wpos[w] = -A.radius - 120;
      d.wmode[w] = 0; d.wst[w] = 0;
      for (var e = 0; e < 3; e++) { d.ey[w * 3 + e] = (e - 1) * 0.44; d.eo[w * 3 + e] = 1; }
    }
    d.wact[0] = 1;
  }

  function tdEyeOpen(b, w, e) { return b.data.eo[w * 3 + e]; }

  function tdReset(b, w, ang) {
    var d = b.data;
    d.wdir[w] = ang;
    d.wpos[w] = -A.radius - 120;
    d.wmode[w] = 0; d.wst[w] = 0;
    d.dashed[w] = 0;
    for (var e = 0; e < 3; e++) d.ey[w * 3 + e] = (e - 1) * (0.30 + NA.RNG.f() * 0.22);
  }

  /* signed distance of (x,y) from the wall plane, and the perpendicular
   * coordinate along it. Written into the shared scratch. */
  var TDS = { s: 0, p: 0 };
  function tdProject(b, w, x, y) {
    var a = b.data.wdir[w];
    var cx2 = x - A.cx, cy2 = y - A.cy;
    TDS.s = cx2 * Math.cos(a) + cy2 * Math.sin(a);
    TDS.p = -cx2 * Math.sin(a) + cy2 * Math.cos(a);
    return TDS;
  }

  function tdInEye(b, w, p) {
    var d = b.data;
    for (var e = 0; e < 3; e++) {
      if (d.eo[w * 3 + e] < 0.5) continue;
      var off = d.ey[w * 3 + e] * A.radius;
      if (Math.abs(p - off) < TD_R) return e;
    }
    return -1;
  }

  function tdTick(b, dt) {
    var d = b.data;
    var walls = b.phase >= 2 ? 2 : 1;
    d.wact[1] = walls > 1 ? 1 : 0;
    var cross = b.phase === 0 ? 360 : b.phase === 1 ? 470 : 430;

    for (var w = 0; w < 2; w++) {
      if (!d.wact[w]) continue;
      d.wst[w] += dt;

      // phase 2: exactly one eye is open, rotating between them
      if (b.phase === 1) {
        var open = ((b.t * 0.7) | 0) % 3;
        for (var e = 0; e < 3; e++) d.eo[w * 3 + e] = (e === open) ? 1 : 0;
      } else if (b.phase === 2) {
        /* Both sheets open their MIDDLE eye (offset 0, always on the arena's
         * centre axis).  The two tides meet head on and so do the two holes:
         * there is one lane through the pair, and it is the lane the surge
         * detonates in.  The old pair of off-centre eyes (indices 2 and 0)
         * rode 500-900 units out along the crests, where nothing could reach
         * them before the sheet had carried them past. */
        var soft = (((b.t * 0.5) | 0) & 1);          // one sheet soft at a time
        for (var e2 = 0; e2 < 3; e2++) d.eo[w * 3 + e2] = (e2 === 1 && w === soft) ? 1 : 0;
      } else {
        for (var e3 = 0; e3 < 3; e3++) d.eo[w * 3 + e3] = 1;
      }

      if (d.wmode[w] === 0) {
        // 1.2 s telegraph: the rim edge the tide will come from lights up
        var a = d.wdir[w];
        var ex = A.cx + Math.cos(a) * -A.radius, ey2 = A.cy + Math.sin(a) * -A.radius;
        var pxv = -Math.sin(a), pyv = Math.cos(a);
        NA.Enemies.telegraphLine(ex + pxv * A.radius, ey2 + pyv * A.radius,
          ex - pxv * A.radius, ey2 - pyv * A.radius, d.wst[w], 1.2, 0.85, 5);
        if (d.wst[w] >= 1.2) { d.wmode[w] = 1; d.wst[w] = 0; sfx('charge', A.cx, A.cy); }
      } else if (d.wmode[w] === 1) {
        d.wpos[w] += cross * dt;
        if (d.wpos[w] > A.radius + 120) {
          d.wmode[w] = 2; d.wst[w] = 0;
        }
      } else {
        if (d.wst[w] > 1.1) tdReset(b, w, d.wdir[w] + (b.phase === 2 ? 0 : 1.9));
      }
    }

    // phase 3: the two tides meet
    if (b.phase === 2 && d.wmode[0] === 1 && d.wmode[1] === 1) {
      var meet = Math.abs(d.wpos[0] + d.wpos[1]);
      if (meet < 40 && d.surge <= 0) {
        d.surge = 0.8;
        NA.Particles.ring(A.cx, A.cy, 40, A.radius, 0.8, 8, 0.4, 0.85, 1, 1);
        NA.Cam.addTrauma(0.5);
        NA.FX.flash(0.2, 200);
        sfx('explode', A.cx, A.cy);
        A.ripple(A.cx, A.cy, 2, 0.4, 0.85, 1);
      }
    }
    if (d.surge > 0) d.surge -= dt;

    /* The body the arena tracks is the open eye -- the one thing that can be
     * shot.  Parked at the centre it made the off-screen marker (and the
     * autopilot's aim) point at empty floor for the whole fight. */
    var bestD = 1e18, found = 0, bestW = -1;
    for (var w3 = 0; w3 < 2; w3++) {
      if (!d.wact[w3] || d.wmode[w3] !== 1) continue;
      var aa = d.wdir[w3], ca = Math.cos(aa), sa = Math.sin(aa);
      var wx = A.cx + ca * d.wpos[w3], wy = A.cy + sa * d.wpos[w3];
      for (var e4 = 0; e4 < 3; e4++) {
        if (d.eo[w3 * 3 + e4] < 0.5) continue;
        var off2 = d.ey[w3 * 3 + e4] * A.radius;
        var ex4 = wx - sa * off2, ey4 = wy + ca * off2;
        var ddx = ex4 - px(), ddy = ey4 - py(), dd2 = ddx * ddx + ddy * ddy;
        /* hysteresis: with two sheets closing symmetrically the nearest eye
         * flips every frame and the marker (and any aim on it) jitters. */
        if (w3 === d.trackW) dd2 *= 0.55;
        if (dd2 < bestD) { bestD = dd2; b.x = ex4; b.y = ey4; found = 1; bestW = w3; }
      }
    }
    if (found) d.trackW = bestW;
    else { b.x = A.cx; b.y = A.cy; d.trackW = -1; }

    // contact: the foam kills, the eyes are safe
    if (NA.Player.alive) {
      for (var q = 0; q < 2; q++) {
        if (!d.wact[q] || d.wmode[q] !== 1) continue;
        tdProject(b, q, px(), py());
        if (Math.abs(TDS.s - d.wpos[q]) > TD_HALF + C.SHIP_R) continue;
        var eye = tdInEye(b, q, TDS.p);
        if (eye < 0) {
          var a2 = d.wdir[q];
          hurtPlayer(px() + Math.cos(a2) * 40, py() + Math.sin(a2) * 40);
          NA.Player.vx += Math.cos(a2) * 420; NA.Player.vy += Math.sin(a2) * 420;
        } else if (NA.Player.dashT > 0 && !d.dashed[q]) {
          // a clean dash through the eye tears it
          d.dashed[q] = 1;
          NA.Bosses.damage(26);
          NA.Time.slowmo(0.45, 260);
          NA.FX.chroma(2.5, 220);
          NA.Particles.ring(px(), py(), 10, 180, 0.4, 4, 1, 1, 1, 1);
          sfx('hitEnemy', px(), py());
        }
      }
      // enemies caught by the foam are swept away
      var E = NA.Enemies;
      for (var w2 = 0; w2 < 2; w2++) {
        if (!d.wact[w2] || d.wmode[w2] !== 1) continue;
        for (var i = 0; i < E.n; i++) {
          tdProject(b, w2, E.x[i], E.y[i]);
          if (Math.abs(TDS.s - d.wpos[w2]) < TD_HALF && tdInEye(b, w2, TDS.p) < 0) { E.kill(i, false); i--; }
        }
      }
    }
  }

  function tdDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 1 : 0.3;
    for (var i = -3; i <= 3; i++) {
      R.line(LL.ENEMIES, x - 150, y + i * 16, x + 150, y + i * 16, 5,
        0.2 * c, 0.6 * c, 0.95 * c, alpha * (0.5 - Math.abs(i) * 0.05));
    }
    R.ring(LL.ENEMIES, x, y, 40, 3, 0.5 * c, 0.9 * c, 1, alpha);
    R.dot(LL.ENEMIES, x, y, 9, 1, 1, 1, alpha * (0.3 + 0.7 * lit));
  }

  NA.Bosses.define('tide', {
    name: 'Tide', color: [0.30, 0.78, 1.0], hp: 480,
    introTime: 2.0, camZoom: 0.66,

    intro: function (b, t) { tdInit(b); return cine(b, t, tdDrawSil); },

    onPhase: function (b, i) {
      tdInit(b);
      tdReset(b, 0, NA.RNG.f() * TAU);
      if (i === 2) { b.data.wact[1] = 1; tdReset(b, 1, b.data.wdir[0] + Math.PI); }
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (!d.wdir) return 0;
      for (var w = 0; w < 2; w++) {
        if (!d.wact[w] || d.wmode[w] !== 1) continue;
        tdProject(b, w, x, y);
        if (Math.abs(TDS.s - d.wpos[w]) > TD_HALF + r) continue;
        return tdInEye(b, w, TDS.p) >= 0 ? 1 : 2;      // foam absorbs, eyes bleed
      }
      return 0;
    },

    phases: [
      { minDuration: 12, update: tdTick },
      { minDuration: 13, update: tdTick },
      { minDuration: 12, update: tdTick }
    ],

    onDeath: function (b) {
      hookGame();
      NA.Events.trigger('naFlood', { angle: b.data.wdir[0] });
      for (var i = 0; i < 26; i++) {
        var a = NA.RNG.f() * TAU, rr = NA.RNG.f() * A.radius;
        NA.Particles.ring(A.cx + Math.cos(a) * rr, A.cy + Math.sin(a) * rr,
          6, 120 + NA.RNG.f() * 160, 0.7, 3, 0.4, 0.85, 1, 0.9);
      }
      A.ripple(A.cx, A.cy, 3, 0.4, 0.85, 1);
      NA.FX.flash(0.25, 320);
    },

    render: function (b) {
      var d = b.data; if (!d.wdir || b.state === 'intro') return;
      var R = NA.R, LL = R.L;
      for (var w = 0; w < 2; w++) {
        if (!d.wact[w] || d.wmode[w] === 2) continue;
        var a = d.wdir[w];
        var cxp = Math.cos(a), cyp = Math.sin(a);
        var pxv = -cyp, pyv = cxp;
        var pos = d.wmode[w] === 0 ? -A.radius - 120 : d.wpos[w];
        var bx = A.cx + cxp * pos, by = A.cy + cyp * pos;
        var half = A.radius * 1.15;
        var alpha = d.wmode[w] === 0 ? 0.25 : 1;
        // the foam body — a solid crushing sheet, never additive
        R.line(LL.ENEMIES, bx + pxv * half, by + pyv * half, bx - pxv * half, by - pyv * half,
          TD_HALF * 2, 0.06, 0.30, 0.52, 0.95 * alpha);
        R.line(LL.ENEMIES, bx + pxv * half, by + pyv * half, bx - pxv * half, by - pyv * half,
          10, 0.5, 0.9, 1.0, 0.85 * alpha);
        // foam crests
        for (var k = -6; k <= 6; k++) {
          var t2 = k * (half / 7) + Math.sin(NA.Time.t * 3 + k) * 10;
          R.dot(LL.ENEMIES, bx + pxv * t2 + cxp * 18, by + pyv * t2 + cyp * 18, 5,
            0.7, 0.95, 1, 0.5 * alpha);
        }
        // the eyes: holes punched through the sheet
        for (var e = 0; e < 3; e++) {
          var off = d.ey[w * 3 + e] * A.radius;
          var ex = bx + pxv * off, ey2 = by + pyv * off;
          var op = d.eo[w * 3 + e];
          if (op > 0.5) {
            R.disc(LL.ENEMIES, ex, ey2, TD_R * 1.1, 0.01, 0.02, 0.04, 0.95 * alpha);
            R.ring(LL.ENEMIES, ex, ey2, TD_R, 3.5, 0.55, 0.95, 1, 0.9 * alpha);
            R.ring(LL.ENEMIES, ex, ey2, TD_R * 0.55, 2, 1, 1, 1, 0.7 * alpha);
            R.dot(LL.ENEMIES, ex, ey2, 6, 1, 1, 1, 0.9 * alpha);
            R.light(ex, ey2, 220, 0.4);
          } else {
            R.ring(LL.ENEMIES, ex, ey2, TD_R * 0.4, 2, 0.3, 0.5, 0.6, 0.4 * alpha);
          }
        }
      }
      if (d.surge > 0) {
        R.ring(LL.VEIL, A.cx, A.cy, (0.8 - d.surge) * 900, 14, 1, 1, 1, d.surge);
      }
      // rim marker: where the tide is coming from
      if (d.wact[0]) {
        var ma = d.wdir[0] + Math.PI;
        R.arc(LL.HUD, A.cx, A.cy, A.radius + 22, ma - 0.25, ma + 0.25, 5, 0.3, 0.78, 1, 0.7);
      }
    }
  });

  /* =============================================================== TURNTABLE
   * Boss 4 (wave 4). The rule: the FLOOR rotates and carries everything
   * standing on it — you, the enemies, the debris — while bullets fly straight.
   * The hub is armoured except inside its spoke beam, and that same beam is
   * charging a laser. Phase 2 reverses the floor with a fling. Phase 3 splits
   * the floor into counter-rotating rings with a lethal shear seam.
   * Death locks the floor and flings every enemy into the walls. */

  function ttInit(b) {
    var d = b.data;
    if (d.omega !== undefined) return;
    d.omega = 0.34;
    d.beam = 0;
    d.laserT = 0;
    d.laserFire = 0;
    d.flingT = 0;
    d.flingWarn = 0;
    d.seamR = 620;
    d.radius = 96;
    d.spin = 0;
  }

  /* rotate a floor entity about the hub — this is what "the floor moves" means */
  function ttCarry(x, y, w, dt, out) {
    var dx = x - A.cx, dy = y - A.cy;
    var s = Math.sin(w * dt), c = Math.cos(w * dt);
    out.x = A.cx + dx * c - dy * s;
    out.y = A.cy + dx * s + dy * c;
  }
  var TTO = { x: 0, y: 0 };

  function ttOmegaAt(b, r) {
    var d = b.data;
    if (b.phase < 2) return d.omega;
    return r < d.seamR ? d.omega : -d.omega * 0.85;
  }

  function ttTick(b, dt) {
    var d = b.data;
    A.rotate(d.omega * 0.5);                 // the membrane pattern turns too
    d.beam += d.omega * dt;
    d.spin += d.omega * dt;

    // carry every floor entity
    var E = NA.Enemies, i;
    for (i = 0; i < E.n; i++) {
      var er = Math.sqrt((E.x[i] - A.cx) * (E.x[i] - A.cx) + (E.y[i] - A.cy) * (E.y[i] - A.cy));
      ttCarry(E.x[i], E.y[i], ttOmegaAt(b, er), dt, TTO);
      E.x[i] = TTO.x; E.y[i] = TTO.y;
    }
    if (NA.Player.alive) {
      var pr = Math.sqrt((px() - A.cx) * (px() - A.cx) + (py() - A.cy) * (py() - A.cy));
      ttCarry(px(), py(), ttOmegaAt(b, pr) * 0.8, dt, TTO);
      NA.Player.x = TTO.x; NA.Player.y = TTO.y;
    }

    // the spoke beam charges a laser
    d.laserT += dt;
    var period = b.phase === 0 ? 4.2 : 3.4;
    if (d.laserFire > 0) {
      d.laserFire -= dt;
      var ex = A.cx + Math.cos(d.beam) * A.radius * 1.2, ey = A.cy + Math.sin(d.beam) * A.radius * 1.2;
      if (NA.Player.alive && segDist2(px(), py(), A.cx, A.cy, ex, ey) < 34 * 34) {
        hurtPlayer(A.cx, A.cy);
      }
      for (i = 0; i < E.n; i++) {
        if (segDist2(E.x[i], E.y[i], A.cx, A.cy, ex, ey) < 30 * 30) { E.kill(i, false); i--; }
      }
    } else if (d.laserT > period) {
      var tt = d.laserT - period;
      var lx = A.cx + Math.cos(d.beam) * A.radius * 1.2, ly = A.cy + Math.sin(d.beam) * A.radius * 1.2;
      NA.Enemies.telegraphLine(A.cx, A.cy, lx, ly, tt, 0.9, 0.65, 6);
      if (tt >= 0.9) { d.laserT = 0; d.laserFire = 0.35; NA.Cam.addTrauma(0.3); sfx('laser', A.cx, A.cy); }
    }

    // phase 2: the reversal fling
    if (b.phase === 1) {
      d.flingT += dt;
      if (d.flingT > 6.0) {
        d.flingWarn += dt;
        var wr = A.radius * 0.9;
        for (var k = 0; k < 6; k++) {
          var aa = d.beam + k / 6 * TAU;
          NA.Enemies.telegraphArrow(A.cx + Math.cos(aa) * wr, A.cy + Math.sin(aa) * wr,
            aa + M.HALFPI * (d.omega > 0 ? -1 : 1), 120, d.flingWarn, 1.2, 0.9);
        }
        if (d.flingWarn >= 1.2) {
          d.flingT = 0; d.flingWarn = 0;
          d.omega = -d.omega * 1.15;
          if (Math.abs(d.omega) > 1.1) d.omega = 1.1 * M.sign(d.omega);
          var imp = d.omega > 0 ? -1 : 1;
          for (i = 0; i < E.n; i++) {
            var dx = E.x[i] - A.cx, dy = E.y[i] - A.cy;
            E.vx[i] += -dy * 1.6 * imp; E.vy[i] += dx * 1.6 * imp;
          }
          if (NA.Player.alive) {
            var pdx = px() - A.cx, pdy = py() - A.cy;
            NA.Player.vx += -pdy * 0.8 * imp; NA.Player.vy += pdx * 0.8 * imp;
          }
          NA.Cam.addTrauma(0.6); NA.FX.chroma(3, 260); NA.FX.hitStop(60);
          sfx('explode', A.cx, A.cy);
        }
      }
    }

    // phase 3: the shear seam between the counter-rotating rings
    if (b.phase === 2) {
      d.seamR = 560 + Math.sin(b.phaseT * 0.35) * 180;
      if (NA.Player.alive) {
        var pr2 = Math.sqrt((px() - A.cx) * (px() - A.cx) + (py() - A.cy) * (py() - A.cy));
        if (Math.abs(pr2 - d.seamR) < 24) hurtPlayer(A.cx, A.cy);
      }
      for (i = 0; i < E.n; i++) {
        var er2 = Math.sqrt((E.x[i] - A.cx) * (E.x[i] - A.cx) + (E.y[i] - A.cy) * (E.y[i] - A.cy));
        if (Math.abs(er2 - d.seamR) < 20) { E.kill(i, false); i--; }
      }
    }
  }

  function ttDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 1 : 0.28;
    R.poly(LL.ENEMIES, x, y, 82, 6, NA.Time.t * 0.4, 4, 0.65 * c, 0.35 * c, 1 * c, alpha);
    R.poly(LL.ENEMIES, x, y, 46, 3, -NA.Time.t * 0.6, 3, 0.8 * c, 0.5 * c, 1 * c, alpha);
    R.dot(LL.ENEMIES, x, y, 10, 1, 1, 1, alpha * (0.3 + 0.7 * lit));
  }

  NA.Bosses.define('turntable', {
    name: 'Turntable', color: [0.62, 0.35, 1.0], hp: 500,
    introTime: 2.0, camZoom: 0.62,

    intro: function (b, t) { ttInit(b); return cine(b, t, ttDrawSil); },

    onPhase: function (b, i) {
      ttInit(b);
      var d = b.data;
      if (i === 1) { d.omega = 0.46; d.flingT = 0; }
      if (i === 2) { d.omega = 0.40; NA.FX.flash(0.2, 180); }
      // a few riders arrive with the floor
      var mid = minionId('drifter', 'skitter', 'mote');
      if (mid && i > 0) spawnMinions(mid, 4 + i * 2, A.cx, A.cy, A.radius * 0.7);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (d.omega === undefined) return 0;
      var dx = x - A.cx, dy = y - A.cy;
      var rr = d.radius + r;
      if (dx * dx + dy * dy > rr * rr) return 0;
      // vulnerable only inside the spoke beam
      var ang = Math.atan2(dy, dx);
      return Math.abs(M.angDiff(ang, d.beam)) < 0.5 ? 1 : 2;
    },

    phases: [
      { minDuration: 12, update: ttTick },
      { minDuration: 13, update: ttTick },
      { minDuration: 12, update: ttTick }
    ],

    onEnd: function () { A.rotate(0); },

    onDeath: function (b) {
      A.rotate(0);
      b.data.omega = 0;
      var E = NA.Enemies;
      for (var i = E.n - 1; i >= 0; i--) {
        var dx = E.x[i] - A.cx, dy = E.y[i] - A.cy;
        var l = Math.sqrt(dx * dx + dy * dy) || 1;
        NA.Particles.frag(E.x[i], E.y[i], dx / l * 1200, dy / l * 1200, Math.atan2(dy, dx),
          26, 0.8, 0.7, 0.45, 1);
        E.kill(i, false);
      }
      NA.Particles.ring(A.cx, A.cy, 30, A.radius, 0.8, 9, 0.65, 0.35, 1, 1);
      NA.Cam.addTrauma(0.8);
      NA.FX.hitStop(90);
      A.ripple(A.cx, A.cy, 3, 0.65, 0.35, 1);
    },

    render: function (b) {
      var d = b.data; if (d.omega === undefined || b.state === 'intro') return;
      var R = NA.R, LL = R.L;
      // the floor: rotating spokes and rings so the rotation is legible
      for (var s = 0; s < 12; s++) {
        var a = d.spin + s / 12 * TAU;
        var r0 = b.phase >= 2 ? d.seamR + 20 : 120;
        R.line(LL.FLOOR, A.cx + Math.cos(a) * r0, A.cy + Math.sin(a) * r0,
          A.cx + Math.cos(a) * A.radius * 0.96, A.cy + Math.sin(a) * A.radius * 0.96,
          2.5, 0.45, 0.25, 0.75, 0.35);
      }
      if (b.phase >= 2) {
        for (var s2 = 0; s2 < 8; s2++) {
          var a2 = -d.spin * 0.85 + s2 / 8 * TAU;
          R.line(LL.FLOOR, A.cx + Math.cos(a2) * 110, A.cy + Math.sin(a2) * 110,
            A.cx + Math.cos(a2) * (d.seamR - 20), A.cy + Math.sin(a2) * (d.seamR - 20),
            2.5, 0.75, 0.35, 0.55, 0.35);
        }
        var breathe = 0.6 + 0.4 * Math.sin(NA.Time.t * TAU * C.TELEGRAPH_HZ);
        R.ring(LL.VEIL, A.cx, A.cy, d.seamR, 8, 1, 0.25, 0.30, 0.55 * breathe);
        R.ring(LL.FLOOR, A.cx, A.cy, d.seamR, 26, 1, 0.4, 0.2, 0.16 * breathe);
      }
      // the hub
      R.polyFill(LL.ENEMIES, A.cx, A.cy, d.radius * 0.9, 6, d.spin, 0.10, 0.05, 0.18, 0.95);
      R.poly(LL.ENEMIES, A.cx, A.cy, d.radius, 6, d.spin, 5, 0.62, 0.35, 1, 0.95);
      R.poly(LL.ENEMIES, A.cx, A.cy, d.radius * 0.55, 3, -d.spin * 1.4, 3, 0.85, 0.6, 1, 0.85);
      R.dot(LL.ENEMIES, A.cx, A.cy, 14, 1, 1, 1, 0.9);
      // the spoke beam: the only soft spot, and the laser barrel
      var bx = A.cx + Math.cos(d.beam) * A.radius, by = A.cy + Math.sin(d.beam) * A.radius;
      var ck = M.clamp01(d.laserT / 4);
      R.arc(LL.FLOOR, A.cx, A.cy, A.radius * 0.5, d.beam - 0.5, d.beam + 0.5, A.radius,
        0.5, 0.8, 1, 0.10 + 0.10 * ck);
      R.line(LL.ENEMIES, A.cx, A.cy, bx, by, 3, 0.6, 0.9, 1, 0.5 + 0.4 * ck);
      if (d.laserFire > 0) {
        var f = M.clamp01(d.laserFire / 0.35);
        R.line(LL.VEIL, A.cx, A.cy, A.cx + Math.cos(d.beam) * A.radius * 1.2,
          A.cy + Math.sin(d.beam) * A.radius * 1.2, 34 * f, 1, 1, 1, 0.9 * f);
      }
    }
  });

  /* =============================================================== METRONOME
   * Boss 5 (wave 5). The rule: time only moves while the bob swings. At each
   * end of the swing the WORLD freezes for 400 ms — but you keep moving, at
   * full speed, through a world that has stopped — and the shots you queue
   * during the freeze burst out at 3x when the swing resumes. The bob is only
   * soft at the bottom of its arc. Phase 2 runs two pendulums; in phase 3 the
   * bob tears loose and rolls, and you kick it with your dash.
   * Death holds the freeze for three seconds with the draft already showing. */

  var MT_FREEZE = 0.40;          // real seconds of world-freeze at each tick
  var MT_SCALE = 0.12;           // how slow the world runs during a freeze
  var MT_SOFT = 0.46;            // |arc angle| under which the bob is soft

  function mtInit(b) {
    var d = b.data;
    if (d.phaseAng !== undefined) return;
    d.phaseAng = 0;               // pendulum phase
    d.w = 0.98;
    d.amp = 0.92;
    d.arm = A.radius * 1.16;
    d.pivX = A.cx; d.pivY = A.cy - A.radius * 1.02;
    d.pivX2 = A.cx; d.pivY2 = A.cy + A.radius * 1.02;
    d.bx = d.pivX; d.by = d.pivY + d.arm;
    d.bx2 = d.pivX2; d.by2 = d.pivY2 - d.arm;
    d.bvx = 0; d.bvy = 0;
    d.freezeEnd = -1;
    d.baseSpeed = 0; d.baseFire = 0;
    d.burstEnd = -1;
    d.queued = 0;
    d.tick = 0;
    d.detached = 0;
    d.radius = 46;
    d.wave = -1;
  }

  function mtBeginFreeze(b) {
    var d = b.data;
    if (d.freezeEnd > 0) return;
    d.freezeEnd = NA.Time.real + MT_FREEZE;
    d.queued = 0;
    d.baseSpeed = NA.Player.stats.speed;
    d.baseFire = NA.Player.stats.fireRate;
    // the world stops; you do not
    NA.Time.setTimeScale(MT_SCALE);
    NA.Player.stats.speed = d.baseSpeed / MT_SCALE;
    NA.FX.chroma(1.6, 200);
    sfx('uiTick', d.bx, d.by);
  }

  function mtEndFreeze(b) {
    var d = b.data;
    if (d.freezeEnd < 0) return;
    d.freezeEnd = -1;
    NA.Time.setTimeScale(1, 120);
    if (d.baseSpeed) NA.Player.stats.speed = d.baseSpeed;
    // queued inputs burst out at 3x
    if (d.queued > 0 && NA.Player.alive) {
      d.burstEnd = NA.Time.real + 0.7;
      NA.Player.stats.fireRate = d.baseFire * 3;
      NA.Player.fire(true);
      NA.Particles.ring(px(), py(), 8, 90, 0.25, 3, 1, 1, 1, 0.9);
    }
    sfx('lock', d.bx, d.by);
  }

  function mtRestore(b) {
    var d = b.data;
    if (!d) return;
    if (d.freezeEnd > 0) { d.freezeEnd = -1; if (d.baseSpeed) NA.Player.stats.speed = d.baseSpeed; }
    if (d.burstEnd > 0) { d.burstEnd = -1; if (d.baseFire) NA.Player.stats.fireRate = d.baseFire; }
    NA.Time.setTimeScale(1);
  }

  function mtTick(b, dt) {
    var d = b.data;
    var real = NA.Time.real;

    // --- freeze bookkeeping runs on the wall clock, not the sim clock ------
    if (d.freezeEnd > 0) {
      if (NA.Input.isDown('fire')) d.queued++;
      if (real >= d.freezeEnd) mtEndFreeze(b);
    } else if (d.burstEnd > 0 && real >= d.burstEnd) {
      d.burstEnd = -1;
      if (d.baseFire) NA.Player.stats.fireRate = d.baseFire;
    }

    var swinging = d.freezeEnd < 0;

    if (!d.detached) {
      if (swinging) d.phaseAng += d.w * dt;
      var ang = d.amp * Math.cos(d.phaseAng);
      var half = Math.floor(d.phaseAng / Math.PI);
      if (half !== d.wave) { d.wave = half; mtBeginFreeze(b); }   // an end of swing
      d.bx = d.pivX + Math.sin(ang) * d.arm;
      d.by = d.pivY + Math.cos(ang) * d.arm;
      if (b.phase >= 1) {
        var ang2 = d.amp * Math.cos(d.phaseAng + Math.PI);
        d.bx2 = d.pivX2 + Math.sin(ang2) * d.arm;
        d.by2 = d.pivY2 - Math.cos(ang2) * d.arm;
      }
      b.x = d.bx; b.y = d.by;
      // the bob is the hazard
      if (NA.Player.alive && swinging) {
        var rr = d.radius + C.SHIP_R;
        if (M.dist2(px(), py(), d.bx, d.by) < rr * rr) hurtPlayer(d.bx, d.by);
        if (b.phase >= 1 && M.dist2(px(), py(), d.bx2, d.by2) < rr * rr) hurtPlayer(d.bx2, d.by2);
      }
    } else {
      // --- phase 3: the bob is loose on the floor -------------------------
      /* A dash into the loose bob kicks it AND hurts it, so this phase is a
       * dash-window fight: publish the read-only hints the autopilot uses
       * (98_bot ~723) so it spends its dash on the kick instead of on dodges. */
      b.dashWindowOpen = true; b.dashHintT = 0;
      d.tick += dt;
      if (d.tick > 2.4) { d.tick = 0; mtBeginFreeze(b); }
      if (swinging) {
        var ax = px() - d.bx, ay = py() - d.by;
        var l = Math.sqrt(ax * ax + ay * ay) || 1;
        d.bvx += ax / l * 90 * dt; d.bvy += ay / l * 90 * dt;
        d.bvx *= (1 - 0.5 * dt); d.bvy *= (1 - 0.5 * dt);
        d.bx += d.bvx * dt; d.by += d.bvy * dt;
        // wall impacts hurt it
        var rad = A.radiusAt(Math.atan2(d.by - A.cy, d.bx - A.cx)) - d.radius;
        var dist = Math.sqrt((d.bx - A.cx) * (d.bx - A.cx) + (d.by - A.cy) * (d.by - A.cy));
        if (dist > rad) {
          var nx = (d.bx - A.cx) / (dist || 1), ny = (d.by - A.cy) / (dist || 1);
          d.bx = A.cx + nx * rad; d.by = A.cy + ny * rad;
          var vn = d.bvx * nx + d.bvy * ny;
          d.bvx -= 2 * vn * nx; d.bvy -= 2 * vn * ny;
          var sp = Math.sqrt(d.bvx * d.bvx + d.bvy * d.bvy);
          if (sp > 480) {
            NA.Bosses.damage(16);
            NA.Cam.addTrauma(0.35);
            A.ripple(d.bx, d.by, 1.6, 1, 0.8, 0.3);
            NA.Particles.burst(d.bx, d.by, 10, 320, 0.4, 1, 0.85, 0.4, 1);
            d.bvx *= 0.5; d.bvy *= 0.5;
          }
        }
        b.x = d.bx; b.y = d.by;
        if (NA.Player.alive) {
          var rr2 = d.radius + C.SHIP_R;
          var near = M.dist2(px(), py(), d.bx, d.by) < (rr2 + 46) * (rr2 + 46);
          if (near && NA.Player.dashT > 0) {
            // a dash kicks it
            var kx = d.bx - px(), ky = d.by - py();
            var kl = Math.sqrt(kx * kx + ky * ky) || 1;
            d.bvx += kx / kl * 1150; d.bvy += ky / kl * 1150;
            NA.Bosses.damage(10);
            NA.FX.hitStop(50); NA.Cam.addTrauma(0.3);
            sfx('hitEnemy', d.bx, d.by);
          } else if (M.dist2(px(), py(), d.bx, d.by) < rr2 * rr2) {
            hurtPlayer(d.bx, d.by);
          }
        }
      }
    }
  }

  function mtDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 1 : 0.3;
    R.line(LL.ENEMIES, x, y - 120, x, y, 4, 0.9 * c, 0.75 * c, 0.3 * c, alpha * 0.8);
    R.polyFill(LL.ENEMIES, x, y, 40, 6, 0.4, 0.10 * c, 0.07 * c, 0.03 * c, alpha);
    R.poly(LL.ENEMIES, x, y, 44, 6, 0.4, 4, 1 * c, 0.82 * c, 0.32 * c, alpha);
    R.dot(LL.ENEMIES, x, y, 9, 1, 1, 1, alpha * (0.25 + 0.75 * lit));
  }

  NA.Bosses.define('metronome', {
    name: 'Metronome', color: [1, 0.82, 0.32], hp: 520,
    introTime: 2.0, camZoom: 0.60,

    intro: function (b, t) { mtInit(b); return cine(b, t, mtDrawSil); },

    onPhase: function (b, i) {
      mtInit(b);
      var d = b.data;
      if (i === 2) {
        d.detached = 1;
        d.bvx = 520; d.bvy = 260;
        NA.FX.hitStop(90); NA.Cam.addTrauma(0.5);
        NA.Particles.ring(d.bx, d.by, 20, 260, 0.6, 5, 1, 0.82, 0.32, 1);
      }
      var mid = minionId('lancer', 'spitter', 'mote');
      if (mid && i === 1) spawnMinions(mid, 4, A.cx, A.cy, A.radius * 0.72);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (d.phaseAng === undefined) return 0;
      var rr = d.radius + r;
      var hit = M.dist2(x, y, d.bx, d.by) < rr * rr;
      var hit2 = b.phase === 1 && M.dist2(x, y, d.bx2, d.by2) < rr * rr;
      if (!hit && !hit2) return 0;
      if (d.detached) return 1;
      /* Soft at the bottom of the arc — and while the world is frozen, which is
       * what the queued burst is FOR: the bob is a 46-unit target crossing at
       * ~2 km/s and the old 0.3 rad window (21% of the swing, all of it at peak
       * speed) meant almost nothing could lead it. The window is MT_SOFT wide
       * now and the stopped bob at each tick is a free, readable shot. */
      if (d.freezeEnd > 0) return 1;
      var ang = d.amp * Math.cos(d.phaseAng);
      return Math.abs(ang) < MT_SOFT ? 1 : 2;
    },

    phases: [
      { minDuration: 11, update: mtTick, exit: function (b) { mtRestore(b); } },
      { minDuration: 12, update: mtTick, exit: function (b) { mtRestore(b); } },
      { minDuration: 11, update: mtTick, exit: function (b) { mtRestore(b); } }
    ],

    onEnd: function (b) { mtRestore(b); },

    onDeath: function (b) {
      mtRestore(b);
      var d = b.data;
      d.draftGhost = 1;
      // time stays nearly stopped for the whole death, with the draft behind it
      NA.Time.setTimeScale(0.45);
      NA.Particles.shatter(d.bx, d.by, 60, 6, 1, 0.82, 0.32, 420);
      NA.Particles.ring(d.bx, d.by, 20, 480, 1.0, 6, 1, 0.9, 0.4, 1);
      NA.FX.chroma(3, 900);
    },

    render: function (b) {
      var d = b.data; if (d.phaseAng === undefined) return;
      var R = NA.R, LL = R.L;
      if (b.state === 'intro') return;
      var frozen = d.freezeEnd > 0;

      if (!d.detached) {
        R.line(LL.ENEMIES, d.pivX, d.pivY, d.bx, d.by, 4, 0.8, 0.62, 0.25, 0.8);
        R.dot(LL.ENEMIES, d.pivX, d.pivY, 10, 1, 0.85, 0.4, 0.8);
        if (b.phase >= 1) {
          R.line(LL.ENEMIES, d.pivX2, d.pivY2, d.bx2, d.by2, 4, 0.8, 0.62, 0.25, 0.8);
          R.dot(LL.ENEMIES, d.pivX2, d.pivY2, 10, 1, 0.85, 0.4, 0.8);
          mtBob(b, d.bx2, d.by2, false);
        }
      }
      mtBob(b, d.bx, d.by, true);

      // the world-freeze reads as a still, chromatic hold
      if (frozen && b.state === 'fight') {
        R.ring(LL.VEIL, px(), py(), 46 + 10 * Math.sin(NA.Time.real * 30), 2, 1, 1, 1, 0.5);
        R.arc(LL.HUD, A.cx, A.cy, A.radius + 60, -M.HALFPI - 0.5, -M.HALFPI + 0.5, 6, 1, 1, 1, 0.6);
      }

      // death: the draft panel is already there, behind the frozen world
      if (d.draftGhost && b.state === 'dying') {
        var w = NA.R.w, h = NA.R.h;
        for (var i = 0; i < 3; i++) {
          var cx2 = w * (0.5 + (i - 1) * 0.22), cy2 = h * 0.5;
          R.spoly(cx2, cy2, w * 0.09, 4, 0.785, 2, 1, 1, 1, 0.16);
          R.sdisc(cx2, cy2, w * 0.05, 0.6, 0.8, 1, 0.05);
        }
      }
    }
  });

  function mtBob(b, x, y, main) {
    var R = NA.R, LL = R.L, d = b.data;
    var soft = d.detached || d.freezeEnd > 0 || Math.abs(d.amp * Math.cos(d.phaseAng)) < MT_SOFT;
    R.polyFill(LL.ENEMIES, x, y, d.radius * 0.85, 6, NA.Time.t * 0.6, 0.12, 0.08, 0.03, 0.95);
    R.poly(LL.ENEMIES, x, y, d.radius, 6, NA.Time.t * 0.6, 5,
      soft ? 1 : 0.6, soft ? 0.85 : 0.5, soft ? 0.35 : 0.2, 0.95);
    if (soft) R.ring(LL.ENEMIES, x, y, d.radius + 12, 2, 1, 1, 1, 0.5);
    R.dot(LL.ENEMIES, x, y, main ? 10 : 7, 1, 1, 1, 0.85);
    R.light(x, y, 220, 0.35);
  }

  /* ============================================================ CONGREGATION
   * Boss 6 (wave 6, act boss). The rule: 460 grey triangles that form shapes,
   * and the SHAPE is the attack. Ten keystone boids hold each figure together;
   * break one and a fifth of the flock is gone for good. Its last form is your
   * own ship at ten times scale, mimicking how you move.
   * Death: the hand opens and the flock drifts up like ash. */

  var CG_N = 460, CG_KEYS = 10;
  var cgPts = null;                 // shape id -> Float32Array(CG_N*2) unit-space points
  var CG_SHAPES = ['eye', 'spear', 'ring', 'wall', 'hand', 'ship'];

  function cgBuildShapes() {
    if (cgPts) return;
    cgPts = Object.create(null);
    var i, t, p;
    for (var s = 0; s < CG_SHAPES.length; s++) cgPts[CG_SHAPES[s]] = new Float32Array(CG_N * 2);

    // ring
    p = cgPts.ring;
    for (i = 0; i < CG_N; i++) { t = i / CG_N * TAU; p[i * 2] = Math.cos(t); p[i * 2 + 1] = Math.sin(t); }
    // eye: an almond outline plus an iris
    p = cgPts.eye;
    for (i = 0; i < CG_N; i++) {
      if (i < CG_N * 0.66) {
        t = (i / (CG_N * 0.66)) * TAU;
        p[i * 2] = Math.cos(t); p[i * 2 + 1] = Math.sin(t) * 0.44 * (0.6 + 0.4 * Math.abs(Math.cos(t)));
      } else {
        t = ((i - CG_N * 0.66) / (CG_N * 0.34)) * TAU;
        var rr = (i & 1) ? 0.24 : 0.13;
        p[i * 2] = Math.cos(t) * rr; p[i * 2 + 1] = Math.sin(t) * rr;
      }
    }
    // spear: a long shaft with a head
    p = cgPts.spear;
    for (i = 0; i < CG_N; i++) {
      var f = i / CG_N;
      if (f < 0.7) { p[i * 2] = -1 + f / 0.7 * 1.6; p[i * 2 + 1] = ((i & 1) ? 1 : -1) * 0.055; }
      else { var g = (f - 0.7) / 0.3; p[i * 2] = 0.6 + g * 0.4; p[i * 2 + 1] = ((i & 1) ? 1 : -1) * 0.30 * (1 - g); }
    }
    // wall: three dense rows
    p = cgPts.wall;
    for (i = 0; i < CG_N; i++) {
      var row = i % 3, k = ((i / 3) | 0) / (CG_N / 3);
      p[i * 2] = (row - 1) * 0.06;
      p[i * 2 + 1] = -1 + k * 2;
    }
    // hand: a palm arc and five fingers
    p = cgPts.hand;
    for (i = 0; i < CG_N; i++) {
      if (i < CG_N * 0.4) {
        t = Math.PI * 0.15 + (i / (CG_N * 0.4)) * Math.PI * 0.7;
        p[i * 2] = Math.cos(t) * 0.75; p[i * 2 + 1] = Math.sin(t) * 0.5 - 0.4;
      } else {
        var fi = ((i - CG_N * 0.4) / (CG_N * 0.6) * 5) | 0;
        var fk = (((i - CG_N * 0.4) / (CG_N * 0.6) * 5) % 1);
        var fa = Math.PI * (0.2 + fi * 0.15);
        p[i * 2] = Math.cos(fa) * (0.55 + fk * 0.55);
        p[i * 2 + 1] = Math.sin(fa) * (0.35 + fk * 0.75) - 0.35;
      }
    }
    // ship: the player's dagger silhouette
    p = cgPts.ship;
    var HX = [1.0, -0.62, -0.30, -0.62], HY = [0, 0.72, 0, -0.72];
    for (i = 0; i < CG_N; i++) {
      var seg = ((i / CG_N) * 4) | 0, sk = ((i / CG_N) * 4) % 1;
      var a0 = seg, a1 = (seg + 1) & 3;
      p[i * 2] = HX[a0] + (HX[a1] - HX[a0]) * sk;
      p[i * 2 + 1] = HY[a0] + (HY[a1] - HY[a0]) * sk;
    }
  }

  function cgInit(b) {
    var d = b.data;
    if (d.bx) return;
    cgBuildShapes();
    d.bx = new Float32Array(CG_N); d.by = new Float32Array(CG_N);
    d.bvx = new Float32Array(CG_N); d.bvy = new Float32Array(CG_N);
    d.alive = new Uint8Array(CG_N);
    d.keyHp = new Float32Array(CG_KEYS);
    d.nAlive = CG_N;
    for (var i = 0; i < CG_N; i++) {
      var a = i / CG_N * TAU, rr = A.radius * (0.55 + (i % 7) * 0.05);
      d.bx[i] = A.cx + Math.cos(a) * rr; d.by[i] = A.cy + Math.sin(a) * rr;
      d.alive[i] = 1;
    }
    for (var k = 0; k < CG_KEYS; k++) d.keyHp[k] = 58;
    d.shape = 0; d.shapeT = 0; d.mode = 0;       // 0 form, 1 telegraph, 2 attack, 3 hold
    d.fx = A.cx; d.fy = A.cy; d.frot = 0; d.fs = 380;
    d.vx = 0; d.vy = 0;
    d.lastKey = -1;
    d.radius = 60;
    d.shotT = 0;
  }

  function cgShapeId(b) {
    var d = b.data;
    if (b.phase === 0) return CG_SHAPES[d.shape % 3];
    if (b.phase === 1) return CG_SHAPES[3 + (d.shape % 2)];
    return 'ship';
  }

  function cgKeyIndex(k) { return ((k * CG_N / CG_KEYS) | 0) % CG_N; }
  var CG_KEYSTEP = (CG_N / CG_KEYS) | 0;
  /* the ten damageable birds — the only thing hitTest reports, so they are
   * never culled by a break and are revived at every phase change */
  function cgIsKey(i) { return (i % CG_KEYSTEP) === 0 && (i / CG_KEYSTEP) < CG_KEYS; }

  function cgBreak(b) {
    /* A broken formation costs the flock a fifth of its bodies.
     *
     * This used to cull from index 0 upward, which is exactly where the ten
     * KEY birds live (cgKeyIndex is k * CG_N / CG_KEYS, so every 46th index
     * starting at 0). Five breaks therefore wiped the whole flock — keys
     * included — and hitTest, which only reports a hit on a *live* key, then
     * returned 0 forever: the boss became invulnerable at ~1/3 health and the
     * run soft-locked. Keys are now never culled, and the loss is spread with
     * a rotating stride so the formation thins evenly instead of from one end. */
    var d = b.data, want = (CG_N / 5) | 0, done = 0;
    var start = (d.breakN = (d.breakN || 0) + 1) * 17;
    for (var s = 0; s < CG_N && done < want; s++) {
      var i = (start + s * 7) % CG_N;
      if (!d.alive[i] || cgIsKey(i)) continue;
      d.alive[i] = 0; d.nAlive--; done++;
      if ((i & 3) === 0) {
        NA.Particles.spawn(d.bx[i], d.by[i], d.bvx[i] * 0.3, d.bvy[i] * 0.3 - 60,
          0.5, 3, 0.75, 0.78, 0.85, 0.8, 1, 1.4);
      }
    }
    d.shape++; d.mode = 0; d.shapeT = 0;
    NA.FX.hitStop(70); NA.Cam.addTrauma(0.4);
    NA.FX.flash(0.16, 160);
    sfx('explode', d.fx, d.fy);
  }

  function cgTick(b, dt) {
    var d = b.data;
    /* Every broken key takes its bird out of the flock, and hitTest only
     * reports a hit on a LIVE key — so a phase that outlives all ten of them
     * is untargetable until the next phase change. The flock re-forms its keys
     * after a short beat instead; the fight stays readable and can always be
     * hurt. */
    var kAlive = 0, kk;
    for (kk = 0; kk < CG_KEYS; kk++) if (d.alive[cgKeyIndex(kk)]) kAlive++;
    if (!kAlive) {
      d.reformT = (d.reformT || 0) + dt;
      if (d.reformT > 1.6) {
        d.reformT = 0;
        for (kk = 0; kk < CG_KEYS; kk++) {
          var ri = cgKeyIndex(kk);
          d.keyHp[kk] = 58;
          if (!d.alive[ri]) { d.alive[ri] = 1; d.nAlive++; }
        }
        NA.FX.flash(0.12, 180);
        sfx('bossPhase', d.fx, d.fy);
      }
    } else d.reformT = 0;
    var shape = cgShapeId(b);
    var pts = cgPts[shape];
    d.shapeT += dt;

    // ---- formation choreography ------------------------------------------
    if (shape === 'ship') {
      // the flock wears your ship at 10x and mimics how you move
      d.frot = NA.Player.angle;
      d.fs = C.SHIP_R * 10 * 1.6;
      var tx = A.cx - (px() - A.cx) * 0.85, ty = A.cy - (py() - A.cy) * 0.85;
      d.fx = M.smooth(d.fx, tx, 2.4, dt); d.fy = M.smooth(d.fy, ty, 2.4, dt);
      d.shotT += dt;
      if (d.shotT > 0.75) {
        d.shotT = 0;
        var aa = Math.atan2(py() - d.fy, px() - d.fx);
        NA.Enemies.telegraphArrow(d.fx, d.fy, aa, 200, 0.45, 0.5, 0.4);
        for (var q = -1; q <= 1; q++) {
          NA.Bullets.fireEnemy(d.fx + Math.cos(aa) * 90, d.fy + Math.sin(aa) * 90,
            Math.cos(aa + q * 0.14) * 520, Math.sin(aa + q * 0.14) * 520,
            { size: 8, life: 3.2, color: CO.white || [1, 1, 1] });
        }
        sfx('shot', d.fx, d.fy);
      }
    } else if (shape === 'eye') {
      d.fx = M.smooth(d.fx, A.cx, 1.2, dt); d.fy = M.smooth(d.fy, A.cy, 1.2, dt);
      d.fs = 420; d.frot = M.lerpAngle(d.frot, Math.atan2(py() - d.fy, px() - d.fx), 1.4 * dt);
      if (d.shapeT > 1.6) {
        var tt = d.shapeT - 1.6;
        var ex = d.fx + Math.cos(d.frot) * A.radius * 2, ey = d.fy + Math.sin(d.frot) * A.radius * 2;
        NA.Enemies.telegraphLine(d.fx, d.fy, ex, ey, tt, 1.0, 0.7, 7);
        if (tt > 1.0 && tt < 1.5 && NA.Player.alive) {
          NA.R.line(NA.R.L.VEIL, d.fx, d.fy, ex, ey, 30, 1, 1, 1, 0.85);
          if (segDist2(px(), py(), d.fx, d.fy, ex, ey) < 32 * 32) hurtPlayer(d.fx, d.fy);
        }
        if (tt > 2.2) { d.shape++; d.shapeT = 0; }
      }
    } else if (shape === 'spear') {
      d.fs = 480;
      if (d.shapeT < 1.2) {
        var sa = Math.atan2(py() - d.fy, px() - d.fx);
        d.frot = M.lerpAngle(d.frot, sa, 2.5 * dt);
        NA.Enemies.telegraphArrow(d.fx, d.fy, d.frot, 420, d.shapeT, 1.2, 0.85);
      } else if (d.shapeT < 2.6) {
        d.fx += Math.cos(d.frot) * 780 * dt; d.fy += Math.sin(d.frot) * 780 * dt;
      } else {
        d.shape++; d.shapeT = 0;
        d.fx = A.cx + (d.fx - A.cx) * 0.2; d.fy = A.cy + (d.fy - A.cy) * 0.2;
      }
    } else if (shape === 'ring') {
      if (d.shapeT < 1.0) {
        d.fx = M.smooth(d.fx, px(), 3, dt); d.fy = M.smooth(d.fy, py(), 3, dt);
        d.fs = 640;
        NA.Enemies.telegraphCircle(d.fx, d.fy, 320, d.shapeT, 1.0, 0.7);
      } else if (d.shapeT < 2.6) {
        d.fs = M.lerp(640, 150, M.easeInOut(M.clamp01((d.shapeT - 1.0) / 1.6)));
      } else { d.shape++; d.shapeT = 0; d.fs = 400; }
    } else if (shape === 'wall') {
      d.fs = A.radius;
      if (d.shapeT < 1.2) {
        d.frot = 0;
        d.fx = A.cx - A.radius * 1.1; d.fy = A.cy;
        NA.Enemies.telegraphLine(d.fx, d.fy - A.radius, d.fx, d.fy + A.radius, d.shapeT, 1.2, 0.85, 6);
      } else if (d.fx < A.cx + A.radius * 1.1) {
        d.fx += 400 * dt;
      } else { d.shape++; d.shapeT = 0; d.fx = A.cx; d.fy = A.cy; }
    } else if (shape === 'hand') {
      if (d.shapeT < 1.3) {
        d.fx = M.smooth(d.fx, px(), 2.2, dt); d.fy = M.smooth(d.fy, py(), 2.2, dt);
        d.frot = M.lerpAngle(d.frot, Math.atan2(py() - d.fy, px() - d.fx) + M.HALFPI, 2 * dt);
        d.fs = 620;
        NA.Enemies.telegraphCircle(d.fx, d.fy, 420, d.shapeT, 1.3, 0.9);
      } else if (d.shapeT < 3.0) {
        d.fs = M.lerp(620, 210, M.easeInOut(M.clamp01((d.shapeT - 1.3) / 1.1)));
      } else { d.shape++; d.shapeT = 0; d.fs = 420; }
    }

    // ---- the flock: one flat pass, no allocation --------------------------
    var cs = Math.cos(d.frot), sn = Math.sin(d.frot);
    var hurt = -1;
    var pxx = px(), pyy = py();
    for (var i = 0; i < CG_N; i++) {
      if (!d.alive[i]) continue;
      var lx = pts[i * 2] * d.fs, ly = pts[i * 2 + 1] * d.fs;
      var txp = d.fx + lx * cs - ly * sn, typ = d.fy + lx * sn + ly * cs;
      var ddx = txp - d.bx[i], ddy = typ - d.by[i];
      d.bvx[i] += ddx * 9 * dt; d.bvy[i] += ddy * 9 * dt;
      d.bvx[i] *= (1 - 3.4 * dt); d.bvy[i] *= (1 - 3.4 * dt);
      d.bx[i] += d.bvx[i] * dt; d.by[i] += d.bvy[i] * dt;
      if (hurt < 0) {
        var hx = d.bx[i] - pxx, hy = d.by[i] - pyy;
        if (hx * hx + hy * hy < 19 * 19) hurt = i;
      }
    }
    if (hurt >= 0 && NA.Player.alive) hurtPlayer(d.bx[hurt], d.by[hurt]);
  }

  function cgDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 0.9 : 0.3;
    for (var i = 0; i < 40; i++) {
      var a = i / 40 * TAU;
      var rr = 110 + Math.sin(a * 5) * 22;
      R.sprite(LL.ENEMIES, 'tri', x + Math.cos(a) * rr, y + Math.sin(a) * rr, a, 7, 7,
        c, c, c * 1.05, alpha * 0.8);
    }
    R.dot(LL.ENEMIES, x, y, 8 + 8 * lit, 1, 1, 1, alpha * (0.2 + 0.8 * lit));
  }

  NA.Bosses.define('congregation', {
    name: 'Congregation', color: [0.78, 0.80, 0.88], hp: 600,
    introTime: 2.2, camZoom: 0.58,

    intro: function (b, t) { cgInit(b); return cine(b, t, cgDrawSil); },

    onPhase: function (b, i) {
      cgInit(b);
      b.data.shape = 0; b.data.shapeT = 0;
      // cgInit only builds the flock once, so a phase change is the one place
      // the keys come back — without this the fight thins to nothing
      for (var k = 0; k < CG_KEYS; k++) {
        b.data.keyHp[k] = 58;
        var ki = cgKeyIndex(k);
        if (!b.data.alive[ki]) { b.data.alive[ki] = 1; b.data.nAlive++; }
      }
      if (i === 2) { NA.FX.flash(0.22, 200); NA.Cam.addTrauma(0.4); }
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (!d.bx) return 0;
      for (var k = 0; k < CG_KEYS; k++) {
        var i = cgKeyIndex(k);
        if (!d.alive[i]) continue;
        var dx = d.bx[i] - x, dy = d.by[i] - y, rr = 30 + r;
        if (dx * dx + dy * dy < rr * rr) { d.lastKey = k; return 1; }
      }
      return 0;
    },

    onDamage: function (b, amt) {
      var d = b.data, k = d.lastKey;
      if (k < 0) return;
      d.keyHp[k] -= amt;
      if (d.keyHp[k] <= 0) {
        d.keyHp[k] = 58;
        var i = cgKeyIndex(k);
        d.alive[i] = 0;
        NA.Particles.shatter(d.bx[i], d.by[i], 26, 3, 1, 1, 1, 280);
        cgBreak(b);
      }
    },

    phases: [
      { minDuration: 13, update: cgTick },
      { minDuration: 14, update: cgTick },
      { minDuration: 14, update: cgTick }
    ],

    onDeath: function (b) {
      // the hand opens and lets you go; the flock drifts up like ash
      var d = b.data;
      for (var i = 0; i < CG_N; i += 2) {
        if (!d.alive[i]) continue;
        NA.Particles.spawn(d.bx[i], d.by[i], (NA.RNG.f() - 0.5) * 60, -70 - NA.RNG.f() * 130,
          1.1 + NA.RNG.f() * 0.6, 3.2, 0.8, 0.82, 0.9, 0.85, 1, 0.35);
        d.alive[i] = 0;
      }
      for (var j = 1; j < CG_N; j += 2) d.alive[j] = 0;
      d.nAlive = 0;
      NA.FX.flash(0.25, 500);
      NA.Particles.ring(d.fx, d.fy, 30, 700, 1.2, 6, 0.85, 0.87, 0.95, 0.9);
    },

    render: function (b) {
      var d = b.data; if (!d.bx || b.state === 'intro') return;
      var R = NA.R, LL = R.L;
      for (var i = 0; i < CG_N; i++) {
        if (!d.alive[i]) continue;
        var rot = Math.atan2(d.bvy[i], d.bvx[i]);
        R.sprite(LL.ENEMIES, 'tri', d.bx[i], d.by[i], rot, 8, 8, 0.62, 0.64, 0.72, 0.92);
      }
      for (var k = 0; k < CG_KEYS; k++) {
        var ki = cgKeyIndex(k);
        if (!d.alive[ki]) continue;
        var hpk = M.clamp01(d.keyHp[k] / 58);
        R.sprite(LL.ENEMIES, 'tri', d.bx[ki], d.by[ki], Math.atan2(d.bvy[ki], d.bvx[ki]), 14, 14,
          1, 0.95, 0.75, 0.98);
        R.ring(LL.ENEMIES, d.bx[ki], d.by[ki], 22, 2, 1, 0.8, 0.35, 0.25 + 0.55 * hpk);
        R.light(d.bx[ki], d.by[ki], 130, 0.25);
      }
    }
  });

  /* ================================================================== STROBE
   * Boss 7 (wave 7). The rule: the arena is dark, and the room only exists
   * when it flashes. The boss moves in the dark and freezes in the light, so
   * every flash is a photograph you have to remember. Your bullets are lights.
   * In phase 3 the ambient flashes stop: your shots are the only light left.
   * Death brings the house lights up on a room that was full the whole time. */

  function stInit(b) {
    var d = b.data;
    if (d.lightT !== undefined) return;
    d.lightT = 0;                 // seconds of light left
    d.nextT = 1.2;                // seconds until the next flash
    d.charge = 0;                 // built while frozen in the light
    d.radius = 62;
    d.vx = 0; d.vy = 0;
    d.speed = 250;
    b.vx = 0; b.vy = 0;
  }

  function stDark(b) { return b.data.lightT <= 0; }

  function stTick(b, dt) {
    var d = b.data;
    if (b.phase < 2) {
      if (d.lightT > 0) d.lightT -= dt;
      else {
        d.nextT -= dt;
        if (d.nextT <= 0) {
          d.lightT = b.phase === 0 ? 0.42 : 0.30;
          d.nextT = 0.7 + NA.RNG.f() * 1.8;      // the interval is never learnable
          NA.FX.flash(0.18, 90);
          sfx('supernovaCharge', b.x, b.y);
        }
      }
    } else {
      d.lightT = 0;                               // only your shots light phase 3
    }

    if (stDark(b)) {
      // it moves only in the dark
      var ax = px() - b.x, ay = py() - b.y;
      var l = Math.sqrt(ax * ax + ay * ay) || 1;
      var sp = d.speed * (b.phase === 2 ? 1.35 : b.phase === 1 ? 1.15 : 1);
      d.vx = M.smooth(d.vx, ax / l * sp, 3, dt);
      d.vy = M.smooth(d.vy, ay / l * sp, 3, dt);
      b.x += d.vx * dt; b.y += d.vy * dt;
      // whatever it charged in the light comes out when the lights die
      if (d.charge > 0.5) {
        var n = 10;
        for (var i = 0; i < n; i++) {
          var a = i / n * TAU + b.t;
          NA.Bullets.fireEnemy(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40,
            Math.cos(a) * 330, Math.sin(a) * 330, { size: 9, life: 3.4, color: CO.violet || [0.6, 0.4, 1] });
        }
        sfx('laser', b.x, b.y);
        d.charge = 0;
      }
    } else {
      d.vx = d.vy = 0;
      d.charge += dt;                              // frozen, but winding up
    }

    if (NA.Player.alive) {
      var rr = d.radius + C.SHIP_R;
      if (M.dist2(px(), py(), b.x, b.y) < rr * rr) hurtPlayer(b.x, b.y);
    }
    b.vx = d.vx; b.vy = d.vy;
    A.clampHard(b, d.radius);
    d.vx = b.vx; d.vy = b.vy;
  }

  function stDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 1 : 0.22;
    R.polyFill(LL.ENEMIES, x, y, 58, 5, NA.Time.t * 0.3, 0.05 * c, 0.03 * c, 0.09 * c, alpha);
    R.poly(LL.ENEMIES, x, y, 64, 5, NA.Time.t * 0.3, 4, 0.75 * c, 0.55 * c, 1 * c, alpha);
    R.dot(LL.ENEMIES, x, y, 7 + 9 * lit, 1, 1, 1, alpha * (0.2 + 0.8 * lit));
  }

  NA.Bosses.define('strobe', {
    name: 'Strobe', color: [0.72, 0.52, 1.0], hp: 520,
    introTime: 2.0, camZoom: 0.72,

    intro: function (b, t) {
      stInit(b);
      NA.FX.darkness(M.clamp01(t / b.def.introTime) * 0.75, 0);
      return cine(b, t, stDrawSil);
    },

    onPhase: function (b, i) {
      stInit(b);
      if (i === 2) { NA.FX.flash(0.3, 260); b.data.nextT = 99; }
    },

    hitTest: function (b, x, y, r) {
      var d = b.data;
      var rr = (d.radius || 62) + r;
      var dx = b.x - x, dy = b.y - y;
      return dx * dx + dy * dy < rr * rr ? 1 : 0;
    },

    phases: [
      { minDuration: 12, update: stTick },
      { minDuration: 13, update: stTick },
      { minDuration: 12, update: stTick }
    ],

    onEnd: function () { NA.FX.darkness(0, 0); },

    onDeath: function (b) {
      // the lights come up: the room was full the whole time, and it pops
      NA.FX.darkness(0, 0);
      NA.FX.flash(0.45, 700);
      var E = NA.Enemies;
      for (var i = E.n - 1; i >= 0; i--) {
        var dx = E.x[i] - A.cx, dy = E.y[i] - A.cy, l = Math.sqrt(dx * dx + dy * dy) || 1;
        E.vx[i] = dx / l * 900; E.vy[i] = dy / l * 900;
        E.kill(i, false);
      }
      for (var k = 0; k < 26; k++) {
        var a = k / 26 * TAU, rr = A.radius * (0.3 + (k % 5) * 0.14);
        NA.Particles.shatter(A.cx + Math.cos(a) * rr, A.cy + Math.sin(a) * rr, 30, 5,
          0.8, 0.7, 1, 360);
      }
      NA.Particles.ring(b.x, b.y, 20, A.radius, 1.0, 8, 1, 1, 1, 1);
      NA.Cam.addTrauma(0.7);
    },

    render: function (b) {
      var d = b.data; if (d.lightT === undefined) return;
      var R = NA.R, LL = R.L;
      if (b.state === 'fight') {
        var dark = b.phase === 2 ? 0.90 : 0.80;
        NA.FX.darkness(d.lightT > 0 ? 0.06 : dark, 0);
      }
      // player bullets are lights
      var P = NA.Bullets.P, cap = Math.min(P.n, 160);
      for (var i = 0; i < cap; i++) R.light(P.x[i], P.y[i], 150, 0.55);
      R.light(px(), py(), 190, 0.35);

      if (b.state === 'intro') return;
      var lit = d.lightT > 0 ? 1 : 0;
      var a = lit ? 0.95 : 0.30;
      R.polyFill(LL.ENEMIES, b.x, b.y, d.radius * 0.9, 5, NA.Time.t * 0.4, 0.06, 0.03, 0.10, a);
      R.poly(LL.ENEMIES, b.x, b.y, d.radius, 5, NA.Time.t * 0.4, lit ? 5 : 2.5,
        0.72, 0.52, 1, a);
      // the eye brightens as it winds up — the telegraph for the dark volley
      var ch = M.clamp01(d.charge / 1.2);
      R.dot(LL.ENEMIES, b.x, b.y, 6 + 8 * ch, 1, lit ? 1 : 0.7, lit ? 1 : 0.9, 0.4 + 0.6 * ch);
      if (lit) { R.light(b.x, b.y, 420, 0.8); R.softRing(LL.VEIL, b.x, b.y, 240, 0.7, 0.5, 1, 0.12); }
    }
  });

  /* =========================================================== CARTOGRAPHER
   * Boss 8 (wave 8). The rule: a stylus redraws the arena boundary into one of
   * eight authored shapes. Wet ink (2 s) is passable; when it dries, whatever
   * the new outline shut out is erased — including the Cartographer itself, if
   * you bait it out there. The stylus TIP is the hitbox while it draws.
   * Phase 3 traces the shape out of your own flight path.
   * Death floods the floor with ink and inverts the palette for a wave. */

  var CT_SEG = 64;                    // matches NA.Arena's per-side resolution

  /* eight hand-authored boundary profiles, each returning 0.5..1 of the radius */
  function ctProfile(shape, a) {
    var n, th;
    switch (shape) {
      case 0: n = 3; break;
      case 1: n = 4; break;
      case 2: n = 5; break;
      case 3: n = 6; break;
      case 4: return 0.62 + 0.38 * Math.abs(Math.cos(a * 2.5));          // star
      case 5: return 0.78 + 0.22 * (Math.sin(a * 8) > 0 ? 1 : 0);        // gear
      case 6: return 0.52 + 0.48 * Math.abs(Math.cos(a));                // hourglass
      default: return M.clamp(0.92 - 0.34 * Math.cos(a), 0.5, 1);        // crescent
    }
    th = ((a % (TAU / n)) + TAU / n) % (TAU / n) - Math.PI / n;
    return Math.cos(Math.PI / n) / Math.cos(th);
  }

  function ctInit(b) {
    var d = b.data;
    if (d.pending) return;
    d.pending = new Float32Array(CT_SEG);
    d.drawn = new Uint8Array(CT_SEG);
    d.path = new Float32Array(CT_SEG);          // the player's own reach, per bearing
    d.shape = 0;
    d.mode = 0;                                  // 0 idle, 1 drawing, 2 wet
    d.modeT = 0;
    d.tipA = 0;
    d.radius = 54;
    d.bx = A.cx + 420; d.by = A.cy;
    d.tvx = 0; d.tvy = 0;
    b.vx = 0; b.vy = 0;
  }

  function ctTargetOffset(b, i) {
    var d = b.data;
    var a = i / CT_SEG * TAU;
    var frac;
    if (b.phase === 2) {
      // phase 3: your own path becomes the wall
      frac = M.clamp(d.path[i] / A.baseRadius, 0.42, 1);
    } else {
      frac = ctProfile(d.shape & 7, a);
    }
    var off = A.baseRadius * (1 - frac) * 0.9;
    return M.clamp(off, 0, A.baseRadius - C.ARENA_MIN_R - 40);
  }

  function ctCommit(b) {
    var d = b.data;
    var killedBoss = false;
    for (var i = 0; i < CT_SEG; i++) A.sidesTarget[i] = d.pending[i];
    // dry ink erases whatever it shut out
    var E = NA.Enemies, j;
    for (j = E.n - 1; j >= 0; j--) {
      var ea = Math.atan2(E.y[j] - A.cy, E.x[j] - A.cx);
      var er = Math.sqrt((E.x[j] - A.cx) * (E.x[j] - A.cx) + (E.y[j] - A.cy) * (E.y[j] - A.cy));
      if (er > A.radius - ctOffAt(b, ea)) E.kill(j, false);
    }
    var ba = Math.atan2(b.y - A.cy, b.x - A.cx);
    var br = Math.sqrt((b.x - A.cx) * (b.x - A.cx) + (b.y - A.cy) * (b.y - A.cy));
    if (br > A.radius - ctOffAt(b, ba) - 10) {
      killedBoss = true;
      NA.Bosses.damage(70);                       // baited into its own ink
      NA.FX.hitStop(90); NA.Cam.addTrauma(0.6);
      NA.Particles.ring(b.x, b.y, 20, 260, 0.6, 6, 0.2, 0.9, 1, 1);
      sfx('explode', b.x, b.y);
    }
    if (NA.Player.alive) {
      var pa = Math.atan2(py() - A.cy, px() - A.cx);
      var pr = Math.sqrt((px() - A.cx) * (px() - A.cx) + (py() - A.cy) * (py() - A.cy));
      if (pr > A.radius - ctOffAt(b, pa)) {
        hurtPlayer(A.cx, A.cy);
        var nr = A.radius - ctOffAt(b, pa) - 60;
        NA.Player.x = A.cx + Math.cos(pa) * nr; NA.Player.y = A.cy + Math.sin(pa) * nr;
      }
    }
    NA.FX.flash(0.16, 200);
    sfx('lock', A.cx, A.cy);
    return killedBoss;
  }

  function ctOffAt(b, a) {
    var d = b.data;
    var t = a / TAU; t = t - Math.floor(t);
    var i = M.clamp(Math.floor(t * CT_SEG), 0, CT_SEG - 1);
    return d.pending[i];
  }

  function ctTick(b, dt) {
    var d = b.data;
    d.modeT += dt;

    // remember where the player has been (phase 3 draws with it)
    if (NA.Player.alive) {
      var pa = Math.atan2(py() - A.cy, px() - A.cx);
      var t = pa / TAU; t = t - Math.floor(t);
      var pi = M.clamp(Math.floor(t * CT_SEG), 0, CT_SEG - 1);
      var pr = Math.sqrt((px() - A.cx) * (px() - A.cx) + (py() - A.cy) * (py() - A.cy));
      if (pr > d.path[pi]) d.path[pi] = pr;
      d.path[pi] = M.smooth(d.path[pi], A.baseRadius * 0.55, 0.05, dt);
    }

    if (d.mode === 0) {
      // between drawings it drifts; bait it toward the rim
      var ax = A.cx + Math.cos(b.t * 0.5) * A.radius * 0.55 - b.x;
      var ay = A.cy + Math.sin(b.t * 0.5) * A.radius * 0.55 - b.y;
      b.x += ax * 0.5 * dt; b.y += ay * 0.5 * dt;
      if (d.modeT > (b.phase === 0 ? 5.5 : 4.5)) {
        d.mode = 1; d.modeT = 0; d.tipA = 0;
        for (var i = 0; i < CT_SEG; i++) d.drawn[i] = 0;
        sfx('telegraph', A.cx, A.cy);
      }
    } else if (d.mode === 1) {
      // the stylus runs the rim; the tip is the hitbox
      var dur = b.phase === 0 ? 3.4 : 2.8;
      d.tipA = M.clamp01(d.modeT / dur) * TAU;
      var upto = M.clamp(Math.floor(d.tipA / TAU * CT_SEG), 0, CT_SEG);
      for (var k = 0; k < upto; k++) {
        if (!d.drawn[k]) { d.drawn[k] = 1; d.pending[k] = ctTargetOffset(b, k); }
      }
      // the boss rides the stylus
      var rr = A.radiusAt(d.tipA) - d.pending[M.clamp(upto - 1, 0, CT_SEG - 1)] - 30;
      b.x = A.cx + Math.cos(d.tipA) * rr; b.y = A.cy + Math.sin(d.tipA) * rr;
      if (d.modeT >= dur) {
        for (var q = 0; q < CT_SEG; q++) if (!d.drawn[q]) { d.drawn[q] = 1; d.pending[q] = ctTargetOffset(b, q); }
        d.mode = 2; d.modeT = 0;
      }
    } else {
      // wet ink: 2 s of grace, then it dries
      if (d.modeT >= 2.0) {
        ctCommit(b);
        d.mode = 0; d.modeT = 0; d.shape++;
      }
    }

    if (NA.Player.alive) {
      var hr = d.radius + C.SHIP_R;
      if (M.dist2(px(), py(), b.x, b.y) < hr * hr) hurtPlayer(b.x, b.y);
    }
  }

  function ctDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 1 : 0.28;
    R.line(LL.ENEMIES, x - 40, y + 60, x + 30, y - 50, 6, 0.2 * c, 0.85 * c, 1 * c, alpha);
    R.polyFill(LL.ENEMIES, x + 34, y - 58, 16, 3, 0.8, 0.1 * c, 0.4 * c, 0.5 * c, alpha);
    R.dot(LL.ENEMIES, x + 34, y - 58, 6 + 6 * lit, 1, 1, 1, alpha * (0.2 + 0.8 * lit));
  }

  NA.Bosses.define('cartographer', {
    name: 'Cartographer', color: [0.25, 0.88, 1.0], hp: 540,
    introTime: 2.0, camZoom: 0.62,

    intro: function (b, t) { ctInit(b); return cine(b, t, ctDrawSil); },

    onPhase: function (b, i) {
      ctInit(b);
      b.data.mode = 0; b.data.modeT = 3.0;
      if (i === 2) {
        for (var k = 0; k < CT_SEG; k++) if (b.data.path[k] <= 0) b.data.path[k] = A.baseRadius * 0.7;
        NA.FX.flash(0.2, 200);
      }
      var mid = minionId('mote', 'spitter');
      if (mid && i > 0) spawnMinions(mid, 5 + i * 2, A.cx, A.cy, A.radius * 0.85);
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (!d.pending) return 0;
      var rr = d.radius + r;
      var dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy > rr * rr) return 0;
      return d.mode === 1 ? 1 : 2;          // only the drawing tip is soft
    },

    phases: [
      { minDuration: 13, update: ctTick },
      { minDuration: 14, update: ctTick },
      { minDuration: 13, update: ctTick }
    ],

    onEnd: function () { A.restoreSides(); },

    onDeath: function (b) {
      A.restoreSides();
      hookGame();
      inkWaves = 1;
      NA.Events.trigger('naInkInversion');
      for (var i = 0; i < 40; i++) {
        var a = NA.RNG.f() * TAU, rr = NA.RNG.f() * A.radius;
        NA.Particles.spawn(A.cx + Math.cos(a) * rr, A.cy + Math.sin(a) * rr,
          Math.cos(a) * 120, Math.sin(a) * 120, 0.9, 6, 0.15, 0.8, 1, 0.9, 1, 1.6);
      }
      NA.Particles.ring(b.x, b.y, 20, A.radius, 1.0, 7, 0.2, 0.9, 1, 1);
      NA.FX.chroma(3, 600);
    },

    render: function (b) {
      var d = b.data; if (!d.pending || b.state === 'intro') return;
      var R = NA.R, LL = R.L;
      // the ink outline: cyan and passable while wet, white-hot as it dries
      if (d.mode !== 0) {
        var wet = d.mode === 2;
        var dry = wet ? M.clamp01(d.modeT / 2.0) : 0;
        var pxp = 0, pyp = 0;
        for (var i = 0; i <= CT_SEG; i++) {
          var idx = i % CT_SEG;
          if (!d.drawn[idx]) { pxp = 0; continue; }
          var a = idx / CT_SEG * TAU;
          var rr = A.radiusAt(a) - d.pending[idx];
          var x = A.cx + Math.cos(a) * rr, y = A.cy + Math.sin(a) * rr;
          if (pxp !== 0 || pyp !== 0) {
            R.line(LL.MEMBRANE, pxp, pyp, x, y, 3 + dry * 4,
              M.lerp(0.25, 1, dry), M.lerp(0.88, 0.35, dry), M.lerp(1, 0.3, dry),
              0.55 + 0.45 * dry);
          }
          pxp = x; pyp = y;
        }
        if (wet) {
          var breathe = 0.6 + 0.4 * Math.sin(NA.Time.t * TAU * C.TELEGRAPH_HZ);
          R.arc(LL.HUD, A.cx, A.cy, A.radius + 54, -M.HALFPI, -M.HALFPI + TAU * dry, 6,
            1, 0.541 * (1 - dry), 0.3 * dry, breathe);
        }
      }
      // the stylus
      var f = b.flash > 0 ? 1 : 0;
      R.polyFill(LL.ENEMIES, b.x, b.y, d.radius * 0.8, 3, d.tipA + M.HALFPI, 0.03, 0.12, 0.16, 0.95);
      R.poly(LL.ENEMIES, b.x, b.y, d.radius, 3, d.tipA + M.HALFPI, d.mode === 1 ? 5 : 3,
        f ? 1 : 0.25, f ? 1 : 0.88, 1, 0.95);
      R.dot(LL.ENEMIES, b.x, b.y, d.mode === 1 ? 10 : 6, 1, 1, 1, d.mode === 1 ? 0.95 : 0.5);
      R.light(b.x, b.y, 240, 0.3);
    }
  });

  /* ================================================================= CADENCE
   * Boss 9 (wave 9). The rule: a tuning fork holds a 120 BPM pulse. Rings
   * bloom on every beat and on the downbeat the floor is only safe ON a ring.
   * Your shots do 3x on the beat and are reflected off it, so the fight is
   * played in time. The fork itself is only soft during its 8-beat rest.
   * Phase 2 changes tempo; phase 3 adds a second fork in 3:4 polyrhythm.
   * Setting 'rhythmAssist' widens every window.  Death cracks the fork and
   * collapses every ring inward. */

  var CD_RINGS = 16;

  function cdAssist() {
    return NA.Store && NA.Store.get ? !!NA.Store.get('rhythmAssist', false) : false;
  }
  function cdWindow() { return cdAssist() ? 0.24 : 0.13; }

  function cdInit(b) {
    var d = b.data;
    if (d.rr) return;
    d.rr = new Float32Array(CD_RINGS);
    d.rsp = new Float32Array(CD_RINGS);
    d.rAlive = new Uint8Array(CD_RINGS);
    d.rFork = new Uint8Array(CD_RINGS);
    d.head = 0;
    d.bpm = 120;
    d.beatT = 0;
    d.beat = -1;
    d.bpm2 = 90;
    d.beatT2 = 0;
    d.beat2 = -1;
    d.radius = 58;
    d.fx2 = A.cx; d.fy2 = A.cy;
    d.rest = 0;
    b.x = A.cx; b.y = A.cy;
  }

  function cdPeriod(b) { return 60 / b.data.bpm; }

  /* distance in seconds to the nearest beat edge */
  function cdOffBeat(b) {
    var d = b.data, p = cdPeriod(b);
    var t = d.beatT % p;
    return Math.min(t, p - t);
  }

  function cdSpawnRing(b, fork) {
    var d = b.data;
    for (var i = 0; i < CD_RINGS; i++) {
      var k = (d.head + i) % CD_RINGS;
      if (!d.rAlive[k]) {
        d.rAlive[k] = 1; d.rr[k] = 40; d.rsp[k] = 300; d.rFork[k] = fork ? 1 : 0;
        d.head = (k + 1) % CD_RINGS;
        return;
      }
    }
  }

  function cdOnRing(b, x, y) {
    var d = b.data;
    var dist = Math.sqrt((x - A.cx) * (x - A.cx) + (y - A.cy) * (y - A.cy));
    var w = cdAssist() ? 58 : 38;
    for (var i = 0; i < CD_RINGS; i++) {
      if (!d.rAlive[i]) continue;
      if (Math.abs(dist - d.rr[i]) < w) return true;
    }
    return false;
  }

  function cdTick(b, dt) {
    var d = b.data;
    // keep the music in step when the audio module is present
    if (NA.Audio && NA.Audio.music && NA.Audio.music.setBpm && d.bpmDirty) {
      NA.Audio.music.setBpm(d.bpm); d.bpmDirty = 0;
    }

    d.beatT += dt;
    var p = cdPeriod(b);
    var beat = Math.floor(d.beatT / p);
    if (beat !== d.beat) {
      d.beat = beat;
      var inRest = (beat % 24) >= 16;               // the 8-beat rest
      d.rest = inRest ? 1 : 0;
      if (!inRest) {
        cdSpawnRing(b, 0);
        sfx('uiTick', A.cx, A.cy);
        if (beat % 4 === 0 && beat > 3) {
          // the downbeat: the floor is lethal except on a ring
          if (NA.Player.alive && !cdOnRing(b, px(), py())) hurtPlayer(A.cx, A.cy);
          NA.FX.flash(0.1, 90);
          NA.Cam.addTrauma(0.18);
          var E = NA.Enemies;
          for (var q = E.n - 1; q >= 0; q--) if (!cdOnRing(b, E.x[q], E.y[q])) E.kill(q, false);
        }
      }
    }

    // phase 3: a second fork in 3:4
    if (b.phase === 2) {
      d.beatT2 += dt;
      var p2 = 60 / d.bpm2;
      var beat2 = Math.floor(d.beatT2 / p2);
      if (beat2 !== d.beat2) { d.beat2 = beat2; cdSpawnRing(b, 1); }
      d.fx2 = A.cx + Math.cos(b.t * 0.5) * 320;
      d.fy2 = A.cy + Math.sin(b.t * 0.5) * 320;
      b.x = A.cx - Math.cos(b.t * 0.5) * 320;
      b.y = A.cy - Math.sin(b.t * 0.5) * 320;
    }

    // phase 2: the tempo moves under you
    if (b.phase === 1) {
      var want = 120 + Math.round(Math.sin(b.phaseT * 0.22) * 30);
      if (want !== d.bpm) { d.bpm = want; d.bpmDirty = 1; }
    }

    for (var i = 0; i < CD_RINGS; i++) {
      if (!d.rAlive[i]) continue;
      d.rr[i] += d.rsp[i] * dt;
      if (d.rr[i] > A.radius * 1.15) d.rAlive[i] = 0;
    }
  }

  function cdDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var c = lit > 0 ? 1 : 0.3;
    R.line(LL.ENEMIES, x, y + 70, x, y - 10, 8, 0.2 * c, 1 * c, 0.72 * c, alpha);
    R.line(LL.ENEMIES, x - 30, y - 10, x - 30, y - 90, 7, 0.2 * c, 1 * c, 0.72 * c, alpha);
    R.line(LL.ENEMIES, x + 30, y - 10, x + 30, y - 90, 7, 0.2 * c, 1 * c, 0.72 * c, alpha);
    R.dot(LL.ENEMIES, x, y - 10, 7 + 7 * lit, 1, 1, 1, alpha * (0.2 + 0.8 * lit));
  }

  function cdFork(b, x, y, main) {
    var R = NA.R, LL = R.L, d = b.data;
    var soft = d.rest > 0;
    var f = b.flash > 0 ? 1 : 0;
    var g = soft ? 1 : 0.62;
    R.line(LL.ENEMIES, x, y + 62, x, y - 8, 9, f ? 1 : 0.16 * g, 1 * g, 0.72 * g, 0.95);
    R.line(LL.ENEMIES, x - 26, y - 8, x - 26, y - 82, 8, f ? 1 : 0.16 * g, 1 * g, 0.72 * g, 0.95);
    R.line(LL.ENEMIES, x + 26, y - 8, x + 26, y - 82, 8, f ? 1 : 0.16 * g, 1 * g, 0.72 * g, 0.95);
    R.dot(LL.ENEMIES, x, y - 8, main ? 9 : 7, 1, 1, 1, soft ? 0.95 : 0.5);
    if (soft) R.ring(LL.ENEMIES, x, y - 8, 60, 2.5, 1, 1, 1, 0.55);
    R.light(x, y, 240, 0.3);
  }

  NA.Bosses.define('cadence', {
    name: 'Cadence', color: [0.20, 1.0, 0.72], hp: 540,
    introTime: 2.0, camZoom: 0.64,

    intro: function (b, t) { cdInit(b); return cine(b, t, cdDrawSil); },

    onPhase: function (b, i) {
      cdInit(b);
      var d = b.data;
      if (i === 1) { d.bpm = 144; d.bpmDirty = 1; }
      if (i === 2) { d.bpm = 120; d.bpm2 = 90; d.bpmDirty = 1; NA.FX.flash(0.2, 200); }
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (!d.rr) return 0;
      var rr = d.radius + r;
      var hit = M.dist2(x, y, b.x, b.y - 20) < rr * rr;
      var hit2 = b.phase === 2 && M.dist2(x, y, d.fx2, d.fy2 - 20) < rr * rr;
      if (!hit && !hit2) return 0;
      if (d.rest > 0) return 1;                       // the rest is the free window
      if (cdOffBeat(b) <= cdWindow()) {
        NA.Bosses.damage(20);                         // on the beat: 3x
        NA.Particles.ring(x, y, 6, 70, 0.22, 3, 0.2, 1, 0.72, 0.9);
        return 1;
      }
      // off the beat it comes back at you
      var ang = Math.atan2(py() - y, px() - x);
      NA.Bullets.fireEnemy(x, y, Math.cos(ang) * 420, Math.sin(ang) * 420,
        { size: 7, life: 2.6, color: CO.acid || [0.2, 1, 0.72] });
      return 2;
    },

    phases: [
      { minDuration: 12, update: cdTick },
      { minDuration: 13, update: cdTick },
      { minDuration: 13, update: cdTick }
    ],

    onDeath: function (b) {
      var d = b.data;
      for (var i = 0; i < CD_RINGS; i++) {
        if (!d.rAlive[i]) continue;
        NA.Particles.ring(A.cx, A.cy, d.rr[i], 20, 0.9, 5, 0.2, 1, 0.72, 0.9);
        d.rAlive[i] = 0;
      }
      NA.Particles.shatter(b.x, b.y, 70, 6, 0.2, 1, 0.72, 380);
      NA.FX.chroma(3, 500);
      NA.Cam.addTrauma(0.6);
      if (NA.Audio && NA.Audio.music && NA.Audio.music.setBpm) NA.Audio.music.setBpm(120);
    },

    render: function (b) {
      var d = b.data; if (!d.rr || b.state === 'intro') return;
      var R = NA.R, LL = R.L;
      // the rings: safe ground on the downbeat
      for (var i = 0; i < CD_RINGS; i++) {
        if (!d.rAlive[i]) continue;
        var c0 = d.rFork[i] ? 0.6 : 0.2, c1 = d.rFork[i] ? 0.8 : 1, c2 = d.rFork[i] ? 1 : 0.72;
        R.ring(LL.FLOOR, A.cx, A.cy, d.rr[i], 26, c0, c1, c2, 0.13);
        R.ring(LL.FLOOR, A.cx, A.cy, d.rr[i], 3, c0, c1, c2, 0.55);
      }
      // the hit window, drawn around the ship: it snaps shut on the beat
      var p = cdPeriod(b);
      var k = (d.beatT % p) / p;
      var w = cdWindow() / p;
      var near = cdOffBeat(b) <= cdWindow();
      R.ring(LL.VEIL, px(), py(), 30 + (1 - k) * 46, near ? 3 : 1.5,
        near ? 1 : 0.4, 1, near ? 1 : 0.7, near ? 0.9 : 0.35);
      R.arc(LL.HUD, A.cx, A.cy, A.radius + 34, -M.HALFPI - TAU * w, -M.HALFPI + TAU * w, 5,
        0.2, 1, 0.72, near ? 0.9 : 0.4);
      R.arc(LL.HUD, A.cx, A.cy, A.radius + 34, -M.HALFPI, -M.HALFPI + TAU * k, 3, 1, 1, 1, 0.5);

      cdFork(b, b.x, b.y, true);
      if (b.phase === 2) cdFork(b, d.fx2, d.fy2, false);
    }
  });

  /* ============================================================== UNDERSTUDY
   * Boss 10 (wave 10). The rule: it is you. Everything you do is written into
   * a ring buffer and played back by a negative-palette copy of your ship,
   * mirrored across the arena, three seconds late — then one, then none. It
   * shoots with YOUR build. The mirror line swaps on a telegraph, so the
   * geometry you learned inverts under you.
   * Death shatters it into copies of your ship. */

  var US_CAP = 1024;                    // ~8.5 s at the fixed 120 Hz step

  function usInit(b) {
    var d = b.data;
    if (d.rx) return;
    d.rx = new Float32Array(US_CAP);
    d.ry = new Float32Array(US_CAP);
    d.ra = new Float32Array(US_CAP);
    d.rf = new Uint8Array(US_CAP);
    d.head = 0;
    d.filled = 0;
    d.delay = 3.0;
    d.mirror = 0;                        // 0 point, 1 vertical, 2 horizontal
    d.nextMirror = 7;
    d.warn = 0;
    d.radius = 26;
    d.shotCd = 0;
    d.ang = 0;
    b.x = A.cx; b.y = A.cy;

    /* GAME_PLAN 9: "your build is the enemy, plus one".  The mirror drafts one
     * extra upgrade of its own -- read through NA.Upgrades.tagsOf, exactly the
     * way understudyPerfect reads its three.  Nothing is taken from the player;
     * the card is the boss's, and it only ever changes the mirror's shots. */
    d.extraId = '';
    d.extraTags = null;
    /* understudyPerfect (13d) seeds d.extraIds with THREE ids before the first
     * phase enters; the plain fight rolls one for itself. */
    var UL = (NA.Upgrades && NA.Upgrades.list) || null;
    var seeded = d.extraIds && d.extraIds.length ? d.extraIds : null;
    if (seeded) {
      d.extraId = seeded[0];
      d.extraTags = [];
      for (var q = 0; q < seeded.length; q++) {
        var tg = NA.Upgrades.tagsOf ? NA.Upgrades.tagsOf(seeded[q]) : null;
        if (tg) for (var r = 0; r < tg.length; r++)
          if (d.extraTags.indexOf(tg[r]) < 0) d.extraTags.push(tg[r]);
      }
    } else if (UL && UL.length) {
      d.extraId = UL[NA.RNG.int(UL.length)];
      d.extraTags = NA.Upgrades.tagsOf ? NA.Upgrades.tagsOf(d.extraId) : null;
    }
    d.exN = seeded ? seeded.length : (d.extraId ? 1 : 0);
    d.exHoming = usTag(d, 'kill') || usTag(d, 'seek') ? 0.3 : 0;
    d.exBig = usTag(d, 'explode') || usTag(d, 'heavy') ? 1 : 0;
    d.exCount = usTag(d, 'spread') || usTag(d, 'count') || usTag(d, 'multi') ? 1 : 0;
    if (seeded) d.exCount += 1;                 // three cards read as one more barrel
  }

  function usTag(d, t) {
    var g = d.extraTags;
    return !!(g && g.indexOf && g.indexOf(t) >= 0);
  }

  function usMirror(b, x, y, out) {
    var d = b.data;
    if (d.mirror === 1) { out.x = 2 * A.cx - x; out.y = y; }
    else if (d.mirror === 2) { out.x = x; out.y = 2 * A.cy - y; }
    else { out.x = 2 * A.cx - x; out.y = 2 * A.cy - y; }
  }
  var USO = { x: 0, y: 0 };

  function usMirrorAngle(b, a) {
    var d = b.data;
    if (d.mirror === 1) return Math.PI - a;
    if (d.mirror === 2) return -a;
    return a + Math.PI;
  }

  function usTick(b, dt) {
    var d = b.data;

    // ---- record ----------------------------------------------------------
    var h = d.head;
    d.rx[h] = px(); d.ry[h] = py(); d.ra[h] = NA.Player.angle;
    d.rf[h] = (NA.Player.alive && (NA.Input.isDown('fire') || !!NA.Store.settings.autofire)) ? 1 : 0;
    d.head = (h + 1) % US_CAP;
    if (d.filled < US_CAP) d.filled++;

    // ---- the mirror line swaps, with a telegraph -------------------------
    d.nextMirror -= dt;
    if (d.nextMirror < 1.0 && d.nextMirror > 0) d.warn = 1;
    if (d.nextMirror <= 0) {
      d.mirror = (d.mirror + 1) % 3;
      d.nextMirror = b.phase === 0 ? 9 : 7;
      d.warn = 0;
      NA.FX.chroma(2.5, 260);
      NA.Cam.addTrauma(0.25);
      sfx('lock', b.x, b.y);
    }

    // ---- replay ----------------------------------------------------------
    var back = Math.min(d.filled - 1, Math.round(d.delay / NA.Time.fixed));
    if (back < 0) back = 0;
    var i = (d.head - 1 - back + US_CAP * 2) % US_CAP;
    usMirror(b, d.rx[i], d.ry[i], USO);
    b.x = USO.x; b.y = USO.y;
    d.ang = usMirrorAngle(b, d.ra[i]);

    // ---- it shoots with your build ---------------------------------------
    d.shotCd -= dt;
    var s = NA.Player.stats;
    if (d.rf[i] && d.shotCd <= 0 && NA.Player.alive) {
      d.shotCd = 1 / Math.max(0.5, s.fireRate * 0.75);
      var mods = NA.Upgrades && NA.Upgrades.mods ? NA.Upgrades.mods : null;
      var count = Math.min(6, (s.count || 1) + d.exCount);   // the extra draft
      for (var k = 0; k < count; k++) {
        var off = count > 1 ? (k - (count - 1) / 2) * (s.spread || 0.12) : 0;
        var a = d.ang + off;
        NA.Bullets.fireEnemy(b.x + Math.cos(a) * 20, b.y + Math.sin(a) * 20,
          Math.cos(a) * (s.bulletSpeed || 900) * 0.62, Math.sin(a) * (s.bulletSpeed || 900) * 0.62,
          { size: (s.bulletSize || 6) + 1 + d.exBig * 4, life: 3.0,
            homing: Math.max(d.exHoming, (mods && mods.homing) || s.homing * 0.5),
            color: d.exBig ? (CO.orange || [1, 0.541, 0]) : (CO.magenta || [1, 0.24, 0.68]) });
      }
      sfx('shot', b.x, b.y);
    }
  }

  function usDrawSil(x, y, lit, alpha) {
    var R = NA.R, LL = R.L;
    var p = CO.player || [0.3, 0.9, 1];
    var neg = lit > 0 ? 1 : 0.35;
    R.sprite(LL.ENEMIES, 'shipHull', x, y, -M.HALFPI, 60, 52,
      (1 - p[0]) * neg, (1 - p[1]) * neg, (1 - p[2]) * neg, alpha);
    R.dot(LL.ENEMIES, x, y, 6 + 8 * lit, 1, 1, 1, alpha * (0.2 + 0.8 * lit));
  }

  NA.Bosses.define('understudy', {
    name: 'Understudy', color: [1, 0.24, 0.68], hp: 520,
    introTime: 2.0, camZoom: 0.72,

    intro: function (b, t) { usInit(b); return cine(b, t, usDrawSil); },

    onPhase: function (b, i) {
      usInit(b);
      b.data.delay = i === 0 ? 3.0 : i === 1 ? 1.0 : 0.0;
      if (i > 0) { NA.FX.flash(0.18, 200); NA.FX.chroma(3, 300); }
    },

    hitTest: function (b, x, y, r) {
      var d = b.data; if (!d.rx) return 0;
      var rr = d.radius + r;
      var dx = b.x - x, dy = b.y - y;
      return dx * dx + dy * dy < rr * rr ? 1 : 0;
    },

    phases: [
      { minDuration: 12, update: usTick },
      { minDuration: 13, update: usTick },
      { minDuration: 12, update: usTick }
    ],

    onDeath: function (b) {
      // it shatters into copies of your ship
      var p = CO.player || [0.3, 0.9, 1];
      for (var i = 0; i < 14; i++) {
        var a = i / 14 * TAU;
        NA.Particles.afterImage(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40,
          a, C.SHIP_R * (1.4 + (i % 3) * 0.5), 0.9 + (i % 4) * 0.15,
          1 - p[0], 1 - p[1], 1 - p[2], 0.7, 0);
        NA.Particles.frag(b.x, b.y, Math.cos(a) * 520, Math.sin(a) * 520, a, 22, 1.1,
          1 - p[0], 1 - p[1], 1 - p[2]);
      }
      NA.Particles.ring(b.x, b.y, 12, 420, 0.9, 6, 1, 0.24, 0.68, 1);
      NA.FX.chroma(3, 700);
      NA.Cam.addTrauma(0.6);
      // and it leaves you the after-image trail, for the rest of the run
      utHead = 0; utCount = 0; utDrop = 0;
      if (!NA.Events.isActive('naUnderstudyTrail')) NA.Events.trigger('naUnderstudyTrail');
    },

    render: function (b) {
      var d = b.data; if (!d.rx || b.state === 'intro') return;
      var R = NA.R, LL = R.L;
      var p = CO.player || [0.3, 0.9, 1];
      // the mirror line itself, and its telegraph before a swap
      var breathe = 0.6 + 0.4 * Math.sin(NA.Time.t * TAU * C.TELEGRAPH_HZ);
      var warn = d.warn ? 1 : 0;
      var lr = A.radius * 1.02;
      if (d.mirror === 1) {
        R.line(LL.FLOOR, A.cx, A.cy - lr, A.cx, A.cy + lr, warn ? 5 : 2,
          warn ? 1 : 0.6, warn ? 0.541 : 0.3, warn ? 0 : 0.7, (warn ? breathe : 0.35));
      } else if (d.mirror === 2) {
        R.line(LL.FLOOR, A.cx - lr, A.cy, A.cx + lr, A.cy, warn ? 5 : 2,
          warn ? 1 : 0.6, warn ? 0.541 : 0.3, warn ? 0 : 0.7, (warn ? breathe : 0.35));
      } else {
        R.ring(LL.FLOOR, A.cx, A.cy, 40, warn ? 5 : 2,
          warn ? 1 : 0.6, warn ? 0.541 : 0.3, warn ? 0 : 0.7, (warn ? breathe : 0.35));
        R.line(LL.FLOOR, px(), py(), b.x, b.y, 1.5, 0.6, 0.3, 0.7, 0.22);
      }
      // the negative ship
      var f = b.flash > 0 ? 1 : 0;
      if (NA.Ship && NA.Ship.render) {
        NEG[0] = f ? 1 : 1 - p[0]; NEG[1] = f ? 1 : 1 - p[1]; NEG[2] = f ? 1 : 1 - p[2];
        NA.Ship.render(b.x, b.y, d.ang, 0.95, 1.7, NEG);
      } else {
        R.sprite(LL.ENEMIES, 'shipHull', b.x, b.y, d.ang, 26, 22, 1 - p[0], 1 - p[1], 1 - p[2], 0.95);
      }
      R.dot(LL.ENEMIES, b.x, b.y, 5, 1, 1, 1, 0.9);
      R.light(b.x, b.y, 200, 0.3);
      // the delay, shown as a lag trail back to where you were
      if (d.delay > 0.05) {
        var back = Math.min(d.filled - 1, Math.round(d.delay / NA.Time.fixed));
        for (var s = 1; s <= 4; s++) {
          var idx = (d.head - 1 - Math.round(back * s / 5) + US_CAP * 2) % US_CAP;
          usMirror(b, d.rx[idx], d.ry[idx], USO);
          R.dot(LL.AFTER, USO.x, USO.y, 3, 1 - p[0], 1 - p[1], 1 - p[2], 0.25 * (1 - s / 5));
        }
      }
    }
  });

  var NEG = [0, 0, 0];
})();
