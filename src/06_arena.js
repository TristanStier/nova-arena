/* 06_arena.js — the bounded ring: boundary polygon, energy membrane, ripples,
 * shrink / rotate / mirror walls / chasms, soft-wall physics.
 *
 * Public API
 *   NA.Arena.reset(opts)                        opts {radius, shape}
 *   NA.Arena.cx / cy / radius / rot / shape     ('circle' | 'hex')
 *   NA.Arena.setShape(shape)
 *   NA.Arena.setRadius(r, seconds)              global shrink/grow with crush band
 *   NA.Arena.shrinkSide(angle, amount)          per-side inward step (Constrictor)
 *   NA.Arena.restoreSides(seconds)
 *   NA.Arena.rotate(radPerSec)                  floor + walls + mines rotate
 *   NA.Arena.radiusAt(angle) -> number
 *   NA.Arena.contains(x, y) -> bool
 *   NA.Arena.depth(x, y) -> distance inside the boundary (negative when outside)
 *   NA.Arena.ripple(x, y, strength, r, g, b)
 *   NA.Arena.softWall(ent, dt, radius)          springs the player back, returns true on contact
 *   NA.Arena.clampHard(ent, radius)             enemies/bullets: hard clamp, returns true on contact
 *   NA.Arena.addMirrorWall(x1,y1,x2,y2,life,owner) -> id ; removeMirrorWall(id) ; mirrorWalls[]
 *   NA.Arena.segmentBlocked(x0,y0,x1,y1, out)   -> wall index or -1; out gets {nx,ny,t}
 *   NA.Arena.addChasm(x1,y1,x2,y2,width,life) -> id ; chasms[]
 *   NA.Arena.inChasm(x, y) -> bool
 *   NA.Arena.update(dt) / NA.Arena.render()
 */
(function () {
  var M = NA.M, C = NA.C;
  var SEG = 64;             // per-side inward offsets, one per 5.6°
  var MAXR = 96;
  var INNER_MARGIN = 220;   // depth() early-out band (must exceed every caller's threshold)

  /* Cached membrane geometry (perf: the ring is static scenery that used to be
   * rebuilt from scratch — 84-96 radiusAt + ~570 cos/sin — every frame). */
  var RSTEPS_MAX = 97;
  var ringX = new Float32Array(RSTEPS_MAX), ringY = new Float32Array(RSTEPS_MAX);
  var ringIX = new Float32Array(RSTEPS_MAX), ringIY = new Float32Array(RSTEPS_MAX);
  var ringN = 0, ringR = -1, ringRot = 1e9, ringShape = '', ringQ = -1;

  var A = NA.Arena = {
    cx: 0, cy: 0,
    radius: C.ARENA_R, baseRadius: C.ARENA_R,
    _rFrom: C.ARENA_R, _rTo: C.ARENA_R, _rT: 0, _rDur: 0,
    shape: 'circle',
    rot: 0, rotSpeed: 0,
    sides: new Float32Array(SEG),
    sidesTarget: new Float32Array(SEG),
    crush: new Float32Array(SEG),      // seconds of red crush-band warning left
    tint: 0,                            // 0..1 hotter as the arena shrinks
    _ringDirty: true,                   // cached membrane vertices need a rebuild
    membraneCol: [0.30, 0.95, 1.0],
    mirrorWalls: [],
    chasms: [],
    _wallId: 1,

    // ripple ring buffer (no allocation at runtime)
    _rip: null, _ripN: 0, RIP_MAX: 64,
    _out: { nx: 0, ny: 0, t: 0, x: 0, y: 0 },

    reset: function (opts) {
      opts = opts || {};
      A.cx = 0; A.cy = 0;
      A.baseRadius = opts.radius || C.ARENA_R;
      A.radius = A.baseRadius; A._rTo = A._rFrom = A.radius; A._rDur = 0;
      A.shape = opts.shape || 'circle';
      A.rot = 0; A.rotSpeed = 0;
      A.sides.fill(0); A.sidesTarget.fill(0); A.crush.fill(0);
      A.mirrorWalls.length = 0; A.chasms.length = 0;
      A.tint = 0;
      if (!A._rip) A._rip = new Float32Array(A.RIP_MAX * 8); // x,y,t,life,str,r,g,b
      A._ripN = 0;
      A._ringDirty = true;
      A._recalcMin();
    },

    setShape: function (s) { A.shape = s; A._ringDirty = true; },
    setRadius: function (r, sec) {
      r = M.clamp(r, C.ARENA_MIN_R, C.ARENA_R * 1.4);
      // test BEFORE the instant assignment, or the instant path (the one where
      // the player has no frames to react) never draws its own warning
      var shrink = r < A.radius;
      A._rFrom = A.radius; A._rTo = r; A._rDur = sec || 0; A._rT = 0;
      if (!sec) { A.radius = r; A._ringDirty = true; A._recalcMin(); }
      if (shrink) A._markCrush(0, SEG, 2);
    },
    shrinkSide: function (angle, amount) {
      var i = A._segOf(angle);
      // spread the step over a few neighbours so the wall stays smooth
      for (var k = -3; k <= 3; k++) {
        var j = (i + k + SEG) % SEG;
        var w = 1 - Math.abs(k) / 4;
        A.sidesTarget[j] = Math.min(A.sidesTarget[j] + amount * w, A.baseRadius - C.ARENA_MIN_R);
        A.crush[j] = Math.max(A.crush[j], 1.2);
      }
    },
    restoreSides: function () { A.sidesTarget.fill(0); },
    rotate: function (rps) { A.rotSpeed = rps; },

    _segOf: function (a) {
      var t = (a - A.rot) / M.TAU;
      t = t - Math.floor(t);
      return M.clamp(Math.floor(t * SEG), 0, SEG - 1);
    },
    _markCrush: function (i0, i1, sec) { for (var i = i0; i < i1; i++) A.crush[i] = Math.max(A.crush[i], sec); },

    // Boundary radius along a world-space angle.
    radiusAt: function (a) {
      var base = A.radius;
      if (A.shape === 'hex') {
        var d = ((a - A.rot) % (Math.PI / 3) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6;
        var hexR = base * 0.8660254 / Math.cos(d);
        base = base * 0.16 + hexR * 0.84;   // rounded hexagon
      }
      // interpolate the per-side offsets so the wall has no facets
      var t = (a - A.rot) / M.TAU; t = t - Math.floor(t);
      var f = t * SEG, i0 = Math.floor(f) % SEG, i1 = (i0 + 1) % SEG, fr = f - Math.floor(f);
      return base - (A.sides[i0] * (1 - fr) + A.sides[i1] * fr);
    },

    /* Smallest boundary radius over every angle, cached (see _recalcMin).
     * Anything closer to the centre than this is unambiguously inside, which
     * lets depth() skip the atan2 + radiusAt for the 99% of bullets that are
     * nowhere near the membrane. */
    minRadius: C.ARENA_R,
    _innerR: 0,                  // minRadius - INNER_MARGIN, the early-out radius
    _recalcMin: function () {
      var mx = 0;
      for (var i = 0; i < SEG; i++) if (A.sides[i] > mx) mx = A.sides[i];
      // a rounded hexagon is narrowest at its flats: 0.16 + 0.8660254*0.84
      A.minRadius = (A.shape === 'hex' ? A.radius * 0.8874613 : A.radius) - mx;
      A._innerR = A.minRadius - INNER_MARGIN;
      if (A._innerR < 0) A._innerR = 0;
    },

    depth: function (x, y) {
      var dx = x - A.cx, dy = y - A.cy;
      var d2 = dx * dx + dy * dy;
      var inner = A._innerR;
      // deep inside: return an exact lower bound (>= INNER_MARGIN), which every
      // caller's threshold test (all far below INNER_MARGIN) reads identically
      if (d2 < inner * inner) return A.minRadius - Math.sqrt(d2);
      var d = Math.sqrt(d2);
      if (d < 1e-4) return A.radiusAt(0);
      return A.radiusAt(Math.atan2(dy, dx)) - d;
    },
    contains: function (x, y) { return A.depth(x, y) > 0; },

    ripple: function (x, y, strength, r, g, b) {
      var p = A._rip, n = A.RIP_MAX;
      var i = (A._ripN++ % n) * 8;
      p[i] = x; p[i + 1] = y; p[i + 2] = 0; p[i + 3] = 0.55 + strength * 0.25;
      p[i + 4] = strength;
      p[i + 5] = r === undefined ? 1 : r; p[i + 6] = g === undefined ? 1 : g; p[i + 7] = b === undefined ? 1 : b;
    },

    /* Soft wall: the last SOFT_WALL units are a spring that exhales you back.
     * Returns the penetration depth (0 when free). */
    softWall: function (e, dt, rad) {
      rad = rad || 0;
      var dx = e.x - A.cx, dy = e.y - A.cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-4) return 0;
      var nx = dx / d, ny = dy / d;
      var edge = A.radiusAt(Math.atan2(dy, dx)) - rad;
      var pen = d - (edge - C.SOFT_WALL);
      if (pen <= 0) return 0;
      var k = M.clamp01(pen / C.SOFT_WALL);
      // spring push inward, stronger the deeper you are
      e.vx -= nx * k * k * 5200 * dt;
      e.vy -= ny * k * k * 5200 * dt;
      if (d > edge) {
        e.x = A.cx + nx * edge; e.y = A.cy + ny * edge;
        var vn = e.vx * nx + e.vy * ny;
        if (vn > 0) { e.vx -= nx * vn * 1.2; e.vy -= ny * vn * 1.2; }
        return pen;
      }
      return pen;
    },

    // Hard clamp for enemies. Returns true when it touched.
    clampHard: function (e, rad) {
      var dx = e.x - A.cx, dy = e.y - A.cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-4) return false;
      var edge = A.radiusAt(Math.atan2(dy, dx)) - (rad || 0);
      if (d <= edge) return false;
      var nx = dx / d, ny = dy / d;
      e.x = A.cx + nx * edge; e.y = A.cy + ny * edge;
      var vn = e.vx * nx + e.vy * ny;
      if (vn > 0) { e.vx -= nx * vn; e.vy -= ny * vn; }
      return true;
    },

    /* -------------------------------------------------------- mirror walls */
    addMirrorWall: function (x1, y1, x2, y2, life, owner) {
      var w = { id: A._wallId++, x1: x1, y1: y1, x2: x2, y2: y2, life: life === undefined ? 1e9 : life, maxLife: life, owner: owner || 0, t: 0 };
      A.mirrorWalls.push(w);
      return w.id;
    },
    removeMirrorWall: function (id) {
      for (var i = 0; i < A.mirrorWalls.length; i++) if (A.mirrorWalls[i].id === id) { A.mirrorWalls.splice(i, 1); return true; }
      return false;
    },
    clearMirrorWalls: function () { A.mirrorWalls.length = 0; },

    /* Segment (x0,y0)->(x1,y1) against every mirror wall.
     * Fills A._out with {x,y,nx,ny,t}; returns the wall or null. */
    segmentBlocked: function (x0, y0, x1, y1) {
      var ws = A.mirrorWalls, best = null, bestT = 2;
      var rx = x1 - x0, ry = y1 - y0;
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        var sx = w.x2 - w.x1, sy = w.y2 - w.y1;
        var den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        var qx = w.x1 - x0, qy = w.y1 - y0;
        var t = (qx * sy - qy * sx) / den;
        var u = (qx * ry - qy * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) { bestT = t; best = w; }
      }
      if (!best) return null;
      var sx2 = best.x2 - best.x1, sy2 = best.y2 - best.y1;
      var l = Math.sqrt(sx2 * sx2 + sy2 * sy2) || 1;
      var o = A._out;
      o.t = bestT; o.x = x0 + rx * bestT; o.y = y0 + ry * bestT;
      o.nx = -sy2 / l; o.ny = sx2 / l;
      return best;
    },

    /* -------------------------------------------------------------- chasms */
    addChasm: function (x1, y1, x2, y2, width, life) {
      var c = { id: A._wallId++, x1: x1, y1: y1, x2: x2, y2: y2, w: width || 40, life: life || 6, maxLife: life || 6, t: 0 };
      A.chasms.push(c);
      return c.id;
    },
    inChasm: function (x, y) {
      var cs = A.chasms;
      for (var i = 0; i < cs.length; i++) {
        var c = cs[i];
        var dx = c.x2 - c.x1, dy = c.y2 - c.y1;
        var L2 = dx * dx + dy * dy; if (L2 < 1e-6) continue;
        var t = M.clamp01(((x - c.x1) * dx + (y - c.y1) * dy) / L2);
        var px = c.x1 + dx * t - x, py = c.y1 + dy * t - y;
        if (px * px + py * py < c.w * c.w * 0.25) return true;
      }
      return false;
    },

    /* -------------------------------------------------------------- update */
    update: function (dt) {
      A.rot += A.rotSpeed * dt;
      if (A._rDur > 0) {
        A._rT += dt;
        var k = M.clamp01(A._rT / A._rDur);
        A.radius = M.lerp(A._rFrom, A._rTo, M.easeInOut(k));
        if (k >= 1) A._rDur = 0;
      }
      var mx = 0;
      for (var i = 0; i < SEG; i++) {
        var d = A.sidesTarget[i] - A.sides[i];
        if (d !== 0) { A.sides[i] += M.clamp(d, -140 * dt, 90 * dt); A._ringDirty = true; }
        if (A.sides[i] > mx) mx = A.sides[i];
        if (A.crush[i] > 0) A.crush[i] -= dt;
      }
      A.minRadius = (A.shape === 'hex' ? A.radius * 0.8874613 : A.radius) - mx;
      A._innerR = A.minRadius - INNER_MARGIN; if (A._innerR < 0) A._innerR = 0;
      A.tint = M.clamp01(1 - (A.radius - C.ARENA_MIN_R) / (C.ARENA_R - C.ARENA_MIN_R));

      var p = A._rip;
      for (var r = 0; r < A.RIP_MAX; r++) {
        var o = r * 8;
        if (p[o + 3] > 0) { p[o + 2] += dt; if (p[o + 2] >= p[o + 3]) p[o + 3] = 0; }
      }
      for (var w = A.mirrorWalls.length - 1; w >= 0; w--) {
        var mw = A.mirrorWalls[w]; mw.t += dt;
        if (mw.life < 1e8) { mw.life -= dt; if (mw.life <= 0) A.mirrorWalls.splice(w, 1); }
      }
      for (var c = A.chasms.length - 1; c >= 0; c--) {
        var ch = A.chasms[c]; ch.t += dt; ch.life -= dt;
        if (ch.life <= 0) A.chasms.splice(c, 1);
      }
    },

    /* Rebuild the cached membrane vertices only when the ring actually moved.
     * Segment count follows the quality rung: at combat zoom 84 segments is far
     * more than the screen can resolve. */
    _buildRing: function (q) {
      var want = A.shape === 'hex' ? (q >= 2 ? 96 : 60) : (q >= 2 ? 84 : 52);
      if (!A._ringDirty && want === ringN - 1 && A.radius === ringR &&
        A.rot === ringRot && A.shape === ringShape && q === ringQ) return;
      A._ringDirty = false;
      ringR = A.radius; ringRot = A.rot; ringShape = A.shape; ringQ = q;
      ringN = want + 1;
      for (var i = 0; i <= want; i++) {
        var a = i / want * M.TAU;
        var rr = A.radiusAt(a);
        var ca = Math.cos(a), sa = Math.sin(a);
        ringX[i] = A.cx + ca * rr; ringY[i] = A.cy + sa * rr;
        ringIX[i] = A.cx + ca * (rr - 22); ringIY[i] = A.cy + sa * (rr - 22);
      }
    },

    /* -------------------------------------------------------------- render */
    render: function () {
      var R = NA.R, L = R.L;
      var col = A.membraneCol;
      // tint hotter as the arena shrinks: radius is tension without a HUD
      var tr = M.lerp(col[0], 1.0, A.tint * 0.8);
      var tg = M.lerp(col[1], 0.42, A.tint * 0.8);
      var tb = M.lerp(col[2], 0.42, A.tint * 0.8);

      var pulse = 0.72 + 0.10 * Math.sin(NA.Time.t * 1.7);
      A._buildRing(R.quality);
      for (var i = 1; i < ringN; i++) {
        R.line(L.MEMBRANE, ringX[i - 1], ringY[i - 1], ringX[i], ringY[i], 3.4, tr, tg, tb, pulse);
        // soft inner glow band
        R.line(L.MEMBRANE, ringIX[i - 1], ringIY[i - 1], ringIX[i], ringIY[i], 34,
          tr, tg, tb, 0.10 + A.tint * 0.06);
      }

      // crush bands: doomed region flashes red-orange with inward dashes
      for (var s = 0; s < SEG; s++) {
        if (A.crush[s] <= 0) continue;
        var k = M.clamp01(A.crush[s] / 2);
        var a0 = A.rot + s / SEG * M.TAU, a1 = A.rot + (s + 1) / SEG * M.TAU;
        var blink = 0.45 + 0.45 * Math.sin(NA.Time.t * 14);
        var rr2 = A.radiusAt((a0 + a1) * 0.5);
        R.arc(L.FLOOR, A.cx, A.cy, rr2 - 26, a0, a1, 52, 1, 0.42, 0.10, k * blink * 0.5);
        var am = (a0 + a1) * 0.5;
        var dash = (NA.Time.t * 130) % 60;
        R.line(L.FLOOR, A.cx + Math.cos(am) * (rr2 - dash), A.cy + Math.sin(am) * (rr2 - dash),
          A.cx + Math.cos(am) * (rr2 - dash - 26), A.cy + Math.sin(am) * (rr2 - dash - 26),
          3, 1, 0.5, 0.15, k * 0.8);
      }

      // membrane ripples: three expanding tangent arcs at the contact point
      var p = A._rip;
      for (var r2 = 0; r2 < A.RIP_MAX; r2++) {
        var o = r2 * 8;
        if (p[o + 3] <= 0) continue;
        var t = p[o + 2] / p[o + 3];
        var fade = (1 - t) * (1 - t);
        var str = p[o + 4];
        for (var k2 = 0; k2 < 3; k2++) {
          var rad = (14 + t * (90 + str * 60)) * (1 + k2 * 0.45);
          var ang = Math.atan2(p[o + 1] - A.cy, p[o] - A.cx);
          var half = M.clamp(rad / Math.max(60, A.radius) * 1.4, 0.05, 0.7);
          R.arc(L.MEMBRANE, A.cx, A.cy, A.radiusAt(ang) - k2 * 3, ang - half, ang + half, 3 + str,
            p[o + 5], p[o + 6], p[o + 7], fade * 0.7 / (1 + k2));
        }
      }

      // mirror walls: block movement, reflect player bullets
      for (var w = 0; w < A.mirrorWalls.length; w++) {
        var mw = A.mirrorWalls[w];
        var al = mw.life < 1e8 ? M.clamp01(mw.life / 0.6) : 1;
        var sh = 0.55 + 0.3 * Math.sin(NA.Time.t * 3 + mw.id);
        R.line(L.MEMBRANE, mw.x1, mw.y1, mw.x2, mw.y2, 5, 1, 0.235, 0.675, 0.85 * al);
        R.line(L.MEMBRANE, mw.x1, mw.y1, mw.x2, mw.y2, 20, 1, 0.6, 0.9, 0.16 * al * sh);
      }

      // chasms: black slit with a hot rim
      for (var c = 0; c < A.chasms.length; c++) {
        var ch = A.chasms[c];
        var g = M.clamp01(ch.t / 0.4) * M.clamp01(ch.life / 0.5);
        R.line(L.FLOOR, ch.x1, ch.y1, ch.x2, ch.y2, ch.w * g, 0.01, 0.01, 0.02, 1);
        R.line(L.FLOOR, ch.x1, ch.y1, ch.x2, ch.y2, ch.w * g * 1.25, 1, 0.35, 0.6, 0.25 * g);
      }
    }
  };

  A.reset();
})();
