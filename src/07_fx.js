/* 07_fx.js — screen feel and the particle systems.
 *
 * Public API
 *   NA.FX.trauma(t)                     add camera trauma (shake = trauma^2)
 *   NA.FX.hitStop(ms)                   freeze the sim, keep rendering
 *   NA.FX.flash(alpha, ms)              capped white flash (respects the reduce-flash setting)
 *   NA.FX.chroma(px, ms)                chromatic split
 *   NA.FX.desat(amount, ms) / NA.FX.hue(rad, ms) / NA.FX.darkness(v, ms)
 *   NA.FX.update(dt) / NA.FX.apply()    apply() pushes the post state to NA.R
 *
 *   NA.Particles.spawn(x,y,vx,vy,life,size,r,g,b,a,prio,drag) -> i|-1
 *   NA.Particles.burst(x,y,n,speed,life,r,g,b,prio)
 *   NA.Particles.ring(x,y,r0,r1,life,w,r,g,b,a)
 *   NA.Particles.frag(x,y,vx,vy,rot,len,life,r,g,b)
 *   NA.Particles.shatter(x,y,radius,sides,r,g,b)        one line fragment per polygon side
 *   NA.Particles.afterImage(x,y,rot,scale,life,r,g,b,a,spriteId)
 *   NA.Particles.bolt(x1,y1,x2,y2,life,jag,r,g,b)       branching lightning polyline
 *   NA.Particles.update(dt) / render() / clear()
 *   NA.Particles.count
 *
 * Priority: 0 ambient, 1 kills, 2 player. Under load the low priorities are
 * evicted first, so the screen gets *cleaner* when it gets busy.
 */
(function () {
  var M = NA.M, C = NA.C;

  /* ------------------------------------------------------------------- FX */
  var FX = NA.FX = {
    _flash: 0, _flashDecay: 8,
    _chroma: 0, _chromaDecay: 8,
    _desat: 0, _desatT: 0,
    _hue: 0, _hueT: 0,
    _dark: 0, _darkT: 0,
    vignette: 0.32,

    trauma: function (t) { NA.Cam.addTrauma(t); },
    hitStop: function (ms) { NA.Time.addHitStop(ms); },
    flash: function (a, ms) {
      var cap = 0.5 * (NA.Store.settings.flash === undefined ? 1 : NA.Store.settings.flash);
      FX._flash = Math.max(FX._flash, Math.min(a, cap));
      FX._flashDecay = 1000 / Math.max(30, ms || 80);
    },
    chroma: function (px, ms) {
      FX._chroma = Math.max(FX._chroma, Math.min(px, 3));
      FX._chromaDecay = 1000 / Math.max(50, ms || 150);
    },
    desat: function (v, ms) { FX._desat = v; FX._desatT = (ms || 300) / 1000; },
    hue: function (v, ms) { FX._hue = v; FX._hueT = (ms || 300) / 1000; },
    darkness: function (v, ms) { FX._dark = v; FX._darkT = (ms || 0) / 1000; },

    update: function (dt) {
      FX._flash = Math.max(0, FX._flash - FX._flashDecay * dt);
      FX._chroma = Math.max(0, FX._chroma - FX._chromaDecay * dt);
      if (FX._desatT > 0) { FX._desatT -= dt; if (FX._desatT <= 0) FX._desat = 0; }
      if (FX._hueT > 0) { FX._hueT -= dt; if (FX._hueT <= 0) FX._hue = 0; }
    },
    apply: function () {
      // hoisted: setPost only reads the fields, so this must not allocate a
      // fresh literal 60x/second (AGENT_RULES 4).
      POST.chroma = FX._chroma; POST.vignette = FX.vignette; POST.hue = FX._hue;
      POST.darkness = FX._dark; POST.flash = FX._flash; POST.desat = FX._desat;
      NA.R.setPost(POST);
    },
    reset: function () {
      FX._flash = FX._chroma = FX._desat = FX._hue = FX._dark = 0;
      FX.vignette = 0.32;
    }
  };

  var POST = { chroma: 0, vignette: 0.32, hue: 0, darkness: 0, flash: 0, desat: 0 };

  /* ------------------------------------------------------------- particles */
  var P = NA.Pool.create(C.MAX_PARTICLES, {
    x: 'f32', y: 'f32', vx: 'f32', vy: 'f32',
    life: 'f32', max: 'f32', size: 'f32',
    r: 'f32', g: 'f32', b: 'f32', a: 'f32',
    prio: 'u8', drag: 'f32', kind: 'u8'
  });
  var RG = NA.Pool.create(C.MAX_RINGS, {
    x: 'f32', y: 'f32', r0: 'f32', r1: 'f32', t: 'f32', life: 'f32',
    w: 'f32', r: 'f32', g: 'f32', b: 'f32', a: 'f32'
  });
  var FR = NA.Pool.create(C.MAX_FRAGS, {
    x: 'f32', y: 'f32', vx: 'f32', vy: 'f32', rot: 'f32', vrot: 'f32',
    len: 'f32', t: 'f32', life: 'f32', r: 'f32', g: 'f32', b: 'f32'
  });
  var AI = NA.Pool.create(C.MAX_AFTER, {
    x: 'f32', y: 'f32', rot: 'f32', s: 'f32', t: 'f32', life: 'f32',
    r: 'f32', g: 'f32', b: 'f32', a: 'f32', sid: 'u8'
  });
  var BOLT_PTS = 10;
  var BO = NA.Pool.create(C.MAX_BOLTS, {
    t: 'f32', life: 'f32', r: 'f32', g: 'f32', b: 'f32', w: 'f32'
  });
  var boltPts = new Float32Array(C.MAX_BOLTS * BOLT_PTS * 2);
  var AI_SPRITES = ['shipHull', 'dot', 'p3', 'p6', 'capsule'];

  var Pt = NA.Particles = {
    pool: P, rings: RG, frags: FR, after: AI, bolts: BO,
    get count() { return P.n + RG.n + FR.n + AI.n; },

    spawn: function (x, y, vx, vy, life, size, r, g, b, a, prio, drag) {
      prio = prio || 0;
      if (P.n >= NA.R.particleCap) {
        // priority eviction: only a higher-priority particle may take a slot
        if (prio === 0) return -1;
        var victim = -1;
        for (var s = 0; s < 24 && s < P.n; s++) {
          var j = (P.n - 1 - s);
          if (P.prio[j] < prio) { victim = j; break; }
        }
        if (victim < 0) return -1;
        P.free(victim);
      }
      var i = P.alloc(); if (i < 0) return -1;
      P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy;
      P.life[i] = life; P.max[i] = life; P.size[i] = size;
      // particles are capped at 60% brightness so they never wash out the read
      P.r[i] = r * 0.85; P.g[i] = g * 0.85; P.b[i] = b * 0.85;
      P.a[i] = a === undefined ? 0.6 : a * 0.6;
      P.prio[i] = prio; P.drag[i] = drag === undefined ? 2.2 : drag;
      return i;
    },

    burst: function (x, y, n, speed, life, r, g, b, prio) {
      if (NA.R.particleCap < 900) n = Math.max(2, n >> 1);
      if (NA.Bullets && NA.Bullets.E.n > 800) n = Math.max(1, n >> 1);  // density governor
      for (var i = 0; i < n; i++) {
        var a = NA.RNG.f() * M.TAU, s = speed * (0.35 + NA.RNG.f() * 0.9);
        Pt.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s,
          life * (0.6 + NA.RNG.f() * 0.7), 2 + NA.RNG.f() * 2.5, r, g, b, 1, prio || 0, 2.6);
      }
    },

    ring: function (x, y, r0, r1, life, w, r, g, b, a) {
      var i = RG.alloc(); if (i < 0) return -1;
      RG.x[i] = x; RG.y[i] = y; RG.r0[i] = r0; RG.r1[i] = r1;
      RG.t[i] = 0; RG.life[i] = life; RG.w[i] = w || 3;
      RG.r[i] = r; RG.g[i] = g; RG.b[i] = b; RG.a[i] = a === undefined ? 1 : a;
      return i;
    },

    frag: function (x, y, vx, vy, rot, len, life, r, g, b) {
      var i = FR.alloc(); if (i < 0) return -1;
      FR.x[i] = x; FR.y[i] = y; FR.vx[i] = vx; FR.vy[i] = vy;
      FR.rot[i] = rot; FR.vrot[i] = (NA.RNG.f() - 0.5) * 7;
      FR.len[i] = len; FR.t[i] = 0; FR.life[i] = life;
      FR.r[i] = r; FR.g[i] = g; FR.b[i] = b;
      return i;
    },

    /* The kill pop: one line fragment per polygon side, plus a ring. */
    shatter: function (x, y, radius, sides, r, g, b, speed) {
      sides = M.clamp(sides | 0, 3, 8);
      speed = speed || 190;
      for (var i = 0; i < sides; i++) {
        var a = i / sides * M.TAU + NA.RNG.f() * 0.2;
        var mx = x + Math.cos(a) * radius * 0.6, my = y + Math.sin(a) * radius * 0.6;
        var sp = speed * (0.5 + NA.RNG.f() * 0.8);
        Pt.frag(mx, my, Math.cos(a) * sp, Math.sin(a) * sp,
          a + M.HALFPI, radius * 1.05, 0.35, r, g, b);
      }
      Pt.ring(x, y, radius * 0.4, radius * 2.2, 0.3, 2.5, r, g, b, 0.9);
    },

    afterImage: function (x, y, rot, s, life, r, g, b, a, sid) {
      var i = AI.alloc(); if (i < 0) return -1;
      AI.x[i] = x; AI.y[i] = y; AI.rot[i] = rot; AI.s[i] = s;
      AI.t[i] = 0; AI.life[i] = life;
      AI.r[i] = r; AI.g[i] = g; AI.b[i] = b; AI.a[i] = a === undefined ? 0.5 : a;
      AI.sid[i] = sid === undefined ? 0 : sid;
      return i;
    },

    bolt: function (x1, y1, x2, y2, life, jag, r, g, b, w) {
      var i = BO.alloc(); if (i < 0) return -1;
      BO.t[i] = 0; BO.life[i] = life; BO.r[i] = r; BO.g[i] = g; BO.b[i] = b; BO.w[i] = w || 2.5;
      var dx = x2 - x1, dy = y2 - y1;
      var nx = -dy, ny = dx, L = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= L; ny /= L;
      var o = i * BOLT_PTS * 2;
      for (var k = 0; k < BOLT_PTS; k++) {
        var t = k / (BOLT_PTS - 1);
        var off = (k === 0 || k === BOLT_PTS - 1) ? 0 : (NA.RNG.f() - 0.5) * (jag || 40);
        boltPts[o + k * 2] = x1 + dx * t + nx * off;
        boltPts[o + k * 2 + 1] = y1 + dy * t + ny * off;
      }
      return i;
    },

    clear: function () { P.clear(); RG.clear(); FR.clear(); AI.clear(); BO.clear(); },

    update: function (dt) {
      var i;
      for (i = 0; i < P.n; i++) {
        P.life[i] -= dt;
        if (P.life[i] <= 0) { P.free(i); i--; continue; }
        var d = 1 - P.drag[i] * dt; if (d < 0) d = 0;
        P.vx[i] *= d; P.vy[i] *= d;
        P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
      }
      for (i = 0; i < RG.n; i++) {
        RG.t[i] += dt;
        if (RG.t[i] >= RG.life[i]) { RG.free(i); i--; }
      }
      for (i = 0; i < FR.n; i++) {
        FR.t[i] += dt;
        if (FR.t[i] >= FR.life[i]) { FR.free(i); i--; continue; }
        FR.x[i] += FR.vx[i] * dt; FR.y[i] += FR.vy[i] * dt;
        FR.vx[i] *= (1 - 2.4 * dt); FR.vy[i] *= (1 - 2.4 * dt);
        FR.rot[i] += FR.vrot[i] * dt;
      }
      for (i = 0; i < AI.n; i++) {
        AI.t[i] += dt;
        if (AI.t[i] >= AI.life[i]) { AI.free(i); i--; }
      }
      for (i = 0; i < BO.n; i++) {
        BO.t[i] += dt;
        if (BO.t[i] >= BO.life[i]) { BO.free(i); i--; }
      }
    },

    render: function () {
      var R = NA.R, L = R.L, i;
      for (i = 0; i < P.n; i++) {
        var k = P.life[i] / P.max[i];
        var s = P.size[i] * (0.5 + k * 0.7);
        R.sprite(L.PARTICLES, 'spark', P.x[i], P.y[i], 0, s, s, P.r[i], P.g[i], P.b[i], P.a[i] * k);
      }
      for (i = 0; i < RG.n; i++) {
        var t = RG.t[i] / RG.life[i];
        var rad = M.lerp(RG.r0[i], RG.r1[i], M.easeOutCubic(t));
        R.ring(L.PARTICLES, RG.x[i], RG.y[i], rad, RG.w[i], RG.r[i], RG.g[i], RG.b[i], RG.a[i] * (1 - t) * (1 - t));
      }
      for (i = 0; i < FR.n; i++) {
        var ft = 1 - FR.t[i] / FR.life[i];
        var hl = FR.len[i] * 0.5 * ft;
        var cx = FR.x[i], cy = FR.y[i], c = Math.cos(FR.rot[i]) * hl, sn = Math.sin(FR.rot[i]) * hl;
        R.line(L.PARTICLES, cx - c, cy - sn, cx + c, cy + sn, 2.2, FR.r[i], FR.g[i], FR.b[i], ft);
      }
      for (i = 0; R.trails && i < AI.n; i++) {
        var at = 1 - AI.t[i] / AI.life[i];
        R.sprite(L.AFTER, AI_SPRITES[AI.sid[i]] || 'dot', AI.x[i], AI.y[i], AI.rot[i],
          AI.s[i], AI.s[i], AI.r[i], AI.g[i], AI.b[i], AI.a[i] * at);
      }
      for (i = 0; i < BO.n; i++) {
        var bt = 1 - BO.t[i] / BO.life[i];
        var o = i * BOLT_PTS * 2;
        for (var k2 = 0; k2 < BOLT_PTS - 1; k2++) {
          R.line(L.PARTICLES, boltPts[o + k2 * 2], boltPts[o + k2 * 2 + 1],
            boltPts[o + k2 * 2 + 2], boltPts[o + k2 * 2 + 3],
            BO.w[i] * (0.5 + bt), BO.r[i], BO.g[i], BO.b[i], bt);
        }
      }
    }
  };
})();
