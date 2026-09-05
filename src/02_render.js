/* 02_render.js — WebGL2 instanced sprite renderer, runtime atlas with baked glow,
 * layers, post-process, quality governor, Canvas2D fallback, camera.
 *
 * Public API
 *   NA.Atlas.add(id, size, drawFn)      register a glyph (drawFn(ctx, size) draws white, centred)
 *   NA.Atlas.get(id)                    -> entry {u0,v0,du,dv,k}
 *   NA.R.init(glCanvas, uiCanvas)
 *   NA.R.begin() / NA.R.end()
 *   NA.R.sprite(layer, id, x, y, rot, sx, sy, r, g, b, a)     sx/sy = half extents in world units
 *   NA.R.line(layer, x1, y1, x2, y2, w, r, g, b, a)
 *   NA.R.ring(layer, x, y, radius, width, r, g, b, a)
 *   NA.R.arc(layer, x, y, radius, a0, a1, width, r, g, b, a)
 *   NA.R.disc(layer, x, y, radius, r, g, b, a)                soft
 *   NA.R.poly(layer, x, y, radius, sides, rot, width, r,g,b,a) hollow
 *   NA.R.light(x, y, radius, intensity)
 *   NA.R.setPost({chroma,vignette,hue,darkness,flash,desat})
 *   NA.R.L                              layer id table
 *   NA.R.quality (0..3), NA.R.particleCap, NA.R.stats
 *   NA.Cam.x/y/zoom, follow(), fitArena(), setZoom(), worldToScreen(x,y,out), screenToWorld(x,y,out)
 */
(function () {
  var M = NA.M;

  /* =================================================================== ATLAS */
  var ATLAS_SIZE = 2048;
  var Atlas = NA.Atlas = {
    canvas: null, ctx: null, tex: null,
    map: Object.create(null),
    list: [],           // ordered entries; index used as "kind" for the 2D fallback
    _x: 0, _y: 0, _rowH: 0, _dirty: true,

    /* Registers one glyph. The shape must be drawn white inside a box of
     * half-extent size*INSET so the baked glow has room to bleed. */
    add: function (id, size, drawFn) {
      if (Atlas.map[id]) return Atlas.map[id];
      if (!Atlas.canvas) Atlas._makeCanvas();
      var pad = 2;
      if (Atlas._x + size + pad > ATLAS_SIZE) { Atlas._x = 0; Atlas._y += Atlas._rowH + pad; Atlas._rowH = 0; }
      // shelf allocator: without this a full sheet silently hands out v0 > 1
      if (Atlas._y + size + pad > ATLAS_SIZE) {
        if (typeof console !== 'undefined' && console.warn) console.warn('NA atlas full, dropped glyph: ' + id);
        return Atlas.map.dot || null;
      }
      var x = Atlas._x, y = Atlas._y;
      Atlas._x += size + pad;
      if (size > Atlas._rowH) Atlas._rowH = size;

      var c = Atlas.ctx;
      c.save();
      c.translate(x + size / 2, y + size / 2);
      drawFn(c, size);
      c.restore();

      var e = {
        id: id, size: size, kind: Atlas.list.length, draw: drawFn,
        px: x, py: y,
        u0: x / ATLAS_SIZE, v0: y / ATLAS_SIZE,
        du: size / ATLAS_SIZE, dv: size / ATLAS_SIZE,
        k: 1 / Atlas.INSET
      };
      Atlas.map[id] = e; Atlas.list.push(e); Atlas._dirty = true;
      if (NA.R && NA.R.S) NA.R.S[id] = e.kind;
      return e;
    },
    get: function (id) { return Atlas.map[id] || Atlas.map.dot; },
    INSET: 0.32,   // logical half-extent as a fraction of the cell; the rest is glow

    _makeCanvas: function () {
      var cv = document.createElement('canvas');
      cv.width = cv.height = ATLAS_SIZE;
      Atlas.canvas = cv; Atlas.ctx = cv.getContext('2d');
      Atlas.ctx.fillStyle = '#fff'; Atlas.ctx.strokeStyle = '#fff';
      Atlas.ctx.lineJoin = 'round'; Atlas.ctx.lineCap = 'round';
    }
  };

  /* Draw `body` three times with decreasing alpha and increasing shadow blur,
   * then once crisp. That is the "baked 3-layer glow" — one sprite at runtime. */
  function glow(ctx, size, body, softness) {
    softness = softness || 1;
    var layers = [[0.30 * softness, 0.22], [0.15 * softness, 0.30], [0.06 * softness, 0.45]];
    ctx.shadowColor = 'rgba(255,255,255,1)';
    for (var i = 0; i < layers.length; i++) {
      ctx.shadowBlur = size * layers[i][0];
      ctx.globalAlpha = layers[i][1];
      body(ctx, size);
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    body(ctx, size);
  }

  function regPolyPath(ctx, r, sides, rot) {
    ctx.beginPath();
    for (var i = 0; i <= sides; i++) {
      var a = rot + i / sides * M.TAU;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* Resolve the numeric handles once the atlas exists. Atlas.list only ever
   * grows (12_events adds two glyphs lazily), so indices stay stable. */
  function bindKinds() {
    var t = R.S || (R.S = {});
    for (var i = 0; i < Atlas.list.length; i++) t[Atlas.list[i].id] = i;
    K.dot = t.dot; K.line = t.line; K.disc = t.disc;
    K.ring = t.ring; K.ringT = t.ringT; K.ringSoft = t.ringSoft; K.spark = t.spark;
    for (var n = 3; n <= 8; n++) { POLY_K[n] = t[POLY_ID[n]]; FILL_K[n] = t[FILL_ID[n]]; }
  }
  Atlas.bindKinds = bindKinds;

  function buildAtlas() {
    var S = 128, I = Atlas.INSET;

    // soft radial disc — the workhorse for lights, glows, membrane bands
    Atlas.add('disc', S, function (c, s) {
      var g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.72, 'rgba(255,255,255,0.13)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s * 0.5, 0, M.TAU); c.fill();
      c.fillStyle = '#fff';
    });
    Atlas.map.disc.k = 2.0;  // soft disc: logical radius = half the cell

    Atlas.add('dot', S, function (c, s) {
      glow(c, s, function () { c.beginPath(); c.arc(0, 0, s * I, 0, M.TAU); c.fill(); });
    });
    Atlas.add('dotRim', S, function (c, s) {   // enemy bullet: bright core, dark rim
      glow(c, s, function () { c.beginPath(); c.arc(0, 0, s * I * 0.82, 0, M.TAU); c.fill(); }, 0.7);
      c.globalCompositeOperation = 'destination-out';
      c.lineWidth = s * 0.045; c.strokeStyle = 'rgba(0,0,0,1)';
      c.beginPath(); c.arc(0, 0, s * I * 0.92, 0, M.TAU); c.stroke();
      c.globalCompositeOperation = 'source-over'; c.strokeStyle = '#fff';
    });
    Atlas.add('ring', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.030; c.beginPath(); c.arc(0, 0, s * I, 0, M.TAU); c.stroke(); });
    });
    Atlas.add('ringT', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.10; c.beginPath(); c.arc(0, 0, s * I * 0.95, 0, M.TAU); c.stroke(); });
    });
    Atlas.add('ringSoft', S, function (c, s) {   // membrane inner glow band
      var g = c.createRadialGradient(0, 0, s * I * 0.55, 0, 0, s * I);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s * I, 0, M.TAU); c.fill(); c.fillStyle = '#fff';
    });
    // horizontal capsule, used for every line / stretched bullet
    Atlas.add('line', S, function (c, s) {
      glow(c, s, function () {
        var h = s * 0.055, w = s * I;
        c.lineWidth = h * 2; c.beginPath(); c.moveTo(-w + h, 0); c.lineTo(w - h, 0); c.stroke();
      }, 0.6);
    });
    Atlas.add('capsule', S, function (c, s) {   // player bullet
      glow(c, s, function () {
        var h = s * 0.075, w = s * I;
        c.lineWidth = h * 2; c.beginPath(); c.moveTo(-w + h, 0); c.lineTo(w - h, 0); c.stroke();
      });
    });
    Atlas.add('spark', S, function (c, s) {
      var g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s * 0.5, 0, M.TAU); c.fill(); c.fillStyle = '#fff';
    });
    Atlas.map.spark.k = 2.0;
    Atlas.add('flash', S, function (c, s) {     // 4-point muzzle starburst
      glow(c, s, function () {
        c.beginPath();
        var r = s * I, w = s * 0.05;
        c.moveTo(-r, 0); c.lineTo(0, -w); c.lineTo(r, 0); c.lineTo(0, w); c.closePath();
        c.moveTo(0, -r); c.lineTo(w, 0); c.lineTo(0, r); c.lineTo(-w, 0); c.closePath();
        c.fill();
      });
    });
    Atlas.add('shipCore', S, function (c, s) {
      glow(c, s, function () { c.beginPath(); c.arc(0, 0, s * 0.055, 0, M.TAU); c.fill(); }, 2.2);
    });

    // hollow polygons p3..p8 + filled variants, and the enemy glyph aliases
    for (var n = 3; n <= 8; n++) {
      (function (sides) {
        Atlas.add('p' + sides, S, function (c, s) {
          glow(c, s, function () { c.lineWidth = s * 0.035; regPolyPath(c, s * I, sides, -M.HALFPI); c.stroke(); });
        });
        Atlas.add('f' + sides, S, function (c, s) {
          glow(c, s, function () { regPolyPath(c, s * I, sides, -M.HALFPI); c.fill(); });
        });
      })(n);
    }
    Atlas.add('needle', S, function (c, s) {    // Lancer body
      glow(c, s, function () {
        c.beginPath(); c.moveTo(s * I, 0); c.lineTo(-s * I * 0.6, s * 0.05); c.lineTo(-s * I, 0); c.lineTo(-s * I * 0.6, -s * 0.05); c.closePath(); c.stroke();
      });
    });
    Atlas.add('chevron', S, function (c, s) {   // Charger body
      glow(c, s, function () {
        c.lineWidth = s * 0.05; c.beginPath();
        c.moveTo(-s * I * 0.7, -s * I); c.lineTo(s * I, 0); c.lineTo(-s * I * 0.7, s * I);
        c.stroke();
      });
    });
    Atlas.add('diamond', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.035; regPolyPath(c, s * I, 4, 0); c.stroke(); });
    });
    Atlas.add('star4', S, function (c, s) {
      glow(c, s, function () {
        c.beginPath();
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * M.TAU, r = (i % 2 ? s * I * 0.30 : s * I);
          var x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath(); c.fill();
      });
    });
    Atlas.add('hexRound', S, function (c, s) {  // draft card / icon frame
      glow(c, s, function () { c.lineWidth = s * 0.03; regPolyPath(c, s * I, 6, 0); c.stroke(); });
    });
    Atlas.add('tri', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.045; regPolyPath(c, s * I, 3, -M.HALFPI); c.stroke(); });
    });
    Atlas.add('square', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.04; c.strokeRect(-s * I * 0.8, -s * I * 0.8, s * I * 1.6, s * I * 1.6); });
    });
    Atlas.add('circle', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.05; c.beginPath(); c.arc(0, 0, s * I, 0, M.TAU); c.stroke(); });
    });
    Atlas.add('hex', S, function (c, s) {
      glow(c, s, function () { c.lineWidth = s * 0.04; regPolyPath(c, s * I, 6, 0); c.stroke(); });
    });
    Atlas.add('shipHull', S, function (c, s) {  // the dagger: hollow triangle with a rear notch
      glow(c, s, function () {
        c.lineWidth = s * 0.038; c.beginPath();
        c.moveTo(s * I, 0);
        c.lineTo(-s * I * 0.75, s * I * 0.72);
        c.lineTo(-s * I * 0.42, 0);
        c.lineTo(-s * I * 0.75, -s * I * 0.72);
        c.closePath(); c.stroke();
      });
    });
  }

  /* =================================================================== CAMERA */
  var Cam = NA.Cam = {
    x: 0, y: 0, zoom: 1,
    tx: 0, ty: 0, tzoom: 1,
    trauma: 0, shakeX: 0, shakeY: 0, shakeRot: 0,
    _zt: 0, _zdur: 0, _zfrom: 1, _zto: 1,
    lookahead: 0.10,          // subtle: the ship stays essentially centred
    velLook: 0.085,           // seconds of the ship's own velocity to lead by
    followRate: 10,           // critically damped exponential approach, per second
    enabled: true,

    setZoom: function (z, ms) {
      if (!ms) { this.zoom = this.tzoom = z; this._zdur = 0; return; }
      this._zfrom = this.zoom; this._zto = z; this._zdur = ms / 1000; this._zt = 0; this.tzoom = z;
    },
    /* Fit the WHOLE arena, not just its width. viewH is viewW * (h/w), so on
     * any landscape screen the height is the binding constraint — fitting the
     * width alone left the overview (and the title, draft, death and ending
     * framings, which all come through here) cropping the top and bottom of
     * the ring. */
    fitArena: function (ms) {
      var need = (NA.Arena ? NA.Arena.radius : NA.C.ARENA_R) * 2.16;   // ring + margin
      var ar = R.h / Math.max(1, R.w);
      this.setZoom(NA.C.VIEW_W / need * Math.min(1, ar), ms === undefined ? 800 : ms);
      this.tx = NA.Arena ? NA.Arena.cx : 0; this.ty = NA.Arena ? NA.Arena.cy : 0;
    },
    addTrauma: function (t) {
      this.trauma = M.clamp01(this.trauma + t * (NA.Store.settings.shake === undefined ? 1 : NA.Store.settings.shake));
    },
    /* Small aim lookahead plus a velocity lead, both clamped so the ship never
     * drifts far from the middle of the screen. */
    follow: function (px, py, ax, ay) {
      var lx = ax * this.lookahead + NA.Player.vx * this.velLook;
      var ly = ay * this.lookahead + NA.Player.vy * this.velLook;
      var lim = this.viewW() * 0.13;
      var l2 = lx * lx + ly * ly;
      if (l2 > lim * lim) { var k = lim / Math.sqrt(l2); lx *= k; ly *= k; }
      this.tx = px + lx; this.ty = py + ly;
    },

    update: function (dt) {
      if (this._zdur > 0) {
        this._zt += dt;
        var k = M.clamp01(this._zt / this._zdur);
        this.zoom = M.lerp(this._zfrom, this._zto, M.easeInOut(k));
        if (k >= 1) this._zdur = 0;
      } else {
        this.zoom = M.smooth(this.zoom, this.tzoom, 6, dt);
      }
      // critically damped: exponential approach, no overshoot, and a dead
      // zone of a third of a pixel so a parked ship never jitters
      var ddx = this.tx - this.x, ddy = this.ty - this.y;
      if (ddx * ddx + ddy * ddy < 0.09) { this.x = this.tx; this.y = this.ty; }
      else {
        this.x = M.smooth(this.x, this.tx, this.followRate, dt);
        this.y = M.smooth(this.y, this.ty, this.followRate, dt);
      }

      this.trauma = Math.max(0, this.trauma - 1.5 * dt);
      var s = this.trauma * this.trauma;
      var t = NA.Time.real * 26;
      this.shakeX = M.noise1(t) * 8 * s;
      this.shakeY = M.noise1(t + 137.3) * 8 * s;
      this.shakeRot = M.noise1(t + 411.7) * 0.0105 * s;

      // never let the view cross the membrane by more than a hair
      if (NA.Arena) {
        var vw = NA.C.VIEW_W / this.zoom * 0.5, vh = vw * (R.h / Math.max(1, R.w));
        // Soft clamp. Past `lim` the camera keeps moving but at a third of the
        // rate, so the ship can still touch the membrane and the view never
        // stops dead (which reads as a jerk). At most ~30% void at the rim.
        var lim = NA.Arena.radius - Math.min(vw, vh) * 0.35;
        var cap = NA.Arena.radius + Math.min(vw, vh) * 0.10;
        var dx = this.x - NA.Arena.cx, dy = this.y - NA.Arena.cy, d = Math.sqrt(dx * dx + dy * dy);
        if (lim > 0 && d > lim) {
          var nd = lim + (d - lim) * 0.34;
          if (nd > cap) nd = cap;
          this.x = NA.Arena.cx + dx / d * nd; this.y = NA.Arena.cy + dy / d * nd;
        }
      }
    },
    /* Boss `camZoom` values were authored against the legacy 1600-unit window
     * and a 1400-unit arena, and they all mean "pull back to this much of the
     * arena". Translate them into the live window / arena so the framing an
     * author picked survives the camera and arena rescale (and follows arena
     * shrink/grow while a fight deforms the ring). */
    bossZoom: function (camZoom) {
      if (!camZoom) return 0.95;
      var rad = (NA.Arena ? NA.Arena.radius : NA.C.ARENA_R) || NA.C.ARENA_R;
      // The boss frame is fixed in WORLD units (VIEW_W cancels out), so the
      // reference width is widened to match the ~18% wider combat view.
      return camZoom * (NA.C.VIEW_W / 2080) * (1400 / rad);
    },
    viewW: function () { return NA.C.VIEW_W / this.zoom; },
    viewH: function () { return NA.C.VIEW_W / this.zoom * (R.h / Math.max(1, R.w)); },
    worldToScreen: function (x, y, out) {
      var vw = this.viewW(), vh = this.viewH();
      out.x = (x - (this.x + this.shakeX)) / vw * R.w + R.w * 0.5;
      out.y = (y - (this.y + this.shakeY)) / vh * R.h + R.h * 0.5;
      return out;
    },
    screenToWorld: function (sx, sy, out) {
      var vw = this.viewW(), vh = this.viewH();
      out.x = (sx - R.w * 0.5) / R.w * vw + this.x + this.shakeX;
      out.y = (sy - R.h * 0.5) / R.h * vh + this.y + this.shakeY;
      return out;
    }
  };

  /* ================================================================ RENDERER */
  var FLOATS = 13;   // xy, rot, scale xy, rgba, uv rect
  var L = {
    BACKDROP: 0, FLOOR: 1, MEMBRANE: 2, PARTICLES: 3, EBULLETS: 4, ENEMIES: 5,
    PBULLETS: 6, PLAYER: 7, VEIL: 8, AFTER: 9, HUD: 10, SCREEN: 11
  };
  var LAYER_CAP = [3000, 3000, 3000, 20000, 9000, 9000, 12000, 800, 2000, 1500, 3000, 3000];
  // F1: PLAYER (index 7) is NOT additive. GAME_PLAN 10.1 - enemies and the ship
  // draw normally so a stacked build never washes the hull out to white mush.
  var LAYER_ADD = [0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0];   // 1 = additive blending
  var LAYER_NAME = ['backdrop', 'floor', 'membrane', 'particles', 'ebullets', 'enemies', 'pbullets', 'player', 'veil', 'after', 'hud', 'screen'];

  var LINE_INK = 0.055;                       // half-thickness of the baked line glyph
  var LINE_SY = Atlas.INSET / (4 * LINE_INK);  // world width -> cell height

  /* `'p' + sides` used to allocate a short string on every hollow/filled poly
   * call (hundreds per frame). Index these instead. */
  var POLY_ID = [null, null, null, 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  var FILL_ID = [null, null, null, 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
  /* Numeric sprite handles (index into Atlas.list). Filled by bindKinds();
   * the hot emitters use R.spriteK to skip the string hash on Atlas.map. */
  var K = { dot: 0, line: 0, disc: 0, ring: 0, ringT: 0, ringSoft: 0, spark: 0 };
  var POLY_K = [0, 0, 0, 0, 0, 0, 0, 0, 0], FILL_K = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  var R = NA.R = {
    L: L, LAYER_NAME: LAYER_NAME,
    gl: null, canvas: null, ui: null, uictx: null,
    w: 1600, h: 900, dpr: 1, mode: 'none',
    quality: 3, particleCap: 2000, resScale: 1, alphaMul: 1,
    bloom: true, trails: true,       // quality rungs (see setQuality)
    cap: LAYER_CAP,                  // live per-layer cap; quartered in 2D mode
    S: null,                         // sprite id -> numeric handle (after buildAtlas)
    _cx0: -1e9, _cx1: 1e9, _cy0: -1e9, _cy1: 1e9,   // camera AABB, refreshed in begin()
    stats: { instances: 0, draws: 0, layers: 0, frameMs: 0, avgMs: 16.7, p95: 0 },
    post: { chroma: 0, vignette: 0.35, hue: 0, darkness: 0, flash: 0, desat: 0 },

    buf: [], count: [], kinds: [],
    lights: null, lightCount: 0, MAX_LIGHTS: 256,

    setPost: function (o) {
      var p = R.post;
      if (o.chroma !== undefined) p.chroma = o.chroma;
      if (o.vignette !== undefined) p.vignette = o.vignette;
      if (o.hue !== undefined) p.hue = o.hue;
      if (o.darkness !== undefined) p.darkness = o.darkness;
      if (o.flash !== undefined) p.flash = o.flash;
      if (o.desat !== undefined) p.desat = o.desat;
    },

    /* ---------------------------------------------------------- primitives */
    sprite: function (layer, id, x, y, rot, sx, sy, r, g, b, a) {
      // R.alphaMul is a scoped fade every primitive honours (the endless
      // 'cloaked' boss mutator sets it around one boss's own draw calls).
      if (R.alphaMul !== 1) a *= R.alphaMul;
      if (a <= 0.002) return;
      if (layer !== 11) {   // L.SCREEN is screen-space; every other layer is world
        var rad = sx > sy ? sx : sy;
        if (x + rad < R._cx0 || x - rad > R._cx1 || y + rad < R._cy0 || y - rad > R._cy1) return;
      }
      var c = R.count[layer];
      if (c >= R.cap[layer]) return;
      var e = Atlas.map[id]; if (!e) e = Atlas.map.dot;
      var o = c * FLOATS, f = R.buf[layer];
      var k = e.k;
      f[o] = x; f[o + 1] = y; f[o + 2] = rot;
      f[o + 3] = sx * k * 2; f[o + 4] = sy * k * 2;   // quad verts are -0.5..0.5
      f[o + 5] = r; f[o + 6] = g; f[o + 7] = b; f[o + 8] = a;
      f[o + 9] = e.u0; f[o + 10] = e.v0; f[o + 11] = e.du; f[o + 12] = e.dv;
      R.kinds[layer][c] = e.kind;
      R.count[layer] = c + 1;
    },
    /* Same as sprite() but takes a numeric atlas handle (R.S.*), skipping the
     * string hash into the dictionary-mode Atlas.map. Used by the hot emitters
     * (particles, bullets, enemies, and line/ring/dot below). */
    spriteK: function (layer, kind, x, y, rot, sx, sy, r, g, b, a) {
      if (R.alphaMul !== 1) a *= R.alphaMul;
      if (a <= 0.002) return;
      if (layer !== 11) {
        var rad = sx > sy ? sx : sy;
        if (x + rad < R._cx0 || x - rad > R._cx1 || y + rad < R._cy0 || y - rad > R._cy1) return;
      }
      var c = R.count[layer];
      if (c >= R.cap[layer]) return;
      var e = Atlas.list[kind]; if (!e) e = Atlas.map.dot;
      var o = c * FLOATS, f = R.buf[layer];
      var k = e.k;
      f[o] = x; f[o + 1] = y; f[o + 2] = rot;
      f[o + 3] = sx * k * 2; f[o + 4] = sy * k * 2;
      f[o + 5] = r; f[o + 6] = g; f[o + 7] = b; f[o + 8] = a;
      f[o + 9] = e.u0; f[o + 10] = e.v0; f[o + 11] = e.du; f[o + 12] = e.dv;
      R.kinds[layer][c] = e.kind;
      R.count[layer] = c + 1;
    },
    /* The line glyph's ink is only 11% of its cell in y (the rest is glow), so
     * the requested width is converted to a cell height that puts exactly `w`
     * world units of ink on screen. */
    line: function (layer, x1, y1, x2, y2, w, r, g, b, a) {
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.0001) return;
      R.spriteK(layer, K.line, (x1 + x2) * 0.5, (y1 + y2) * 0.5, Math.atan2(dy, dx),
        len * 0.5, w * LINE_SY, r, g, b, a);
    },
    ring: function (layer, x, y, radius, width, r, g, b, a) {
      R.spriteK(layer, (width / Math.max(1, radius) > 0.07) ? K.ringT : K.ring,
        x, y, 0, radius, radius, r, g, b, a);
    },
    softRing: function (layer, x, y, radius, r, g, b, a) {
      R.spriteK(layer, K.ringSoft, x, y, 0, radius, radius, r, g, b, a);
    },
    disc: function (layer, x, y, radius, r, g, b, a) {
      R.spriteK(layer, K.disc, x, y, 0, radius, radius, r, g, b, a);
    },
    dot: function (layer, x, y, radius, r, g, b, a) {
      R.spriteK(layer, K.dot, x, y, 0, radius, radius, r, g, b, a);
    },
    poly: function (layer, x, y, radius, sides, rot, width, r, g, b, a) {
      if (sides >= 3 && sides <= 8) { R.spriteK(layer, POLY_K[sides], x, y, rot, radius, radius, r, g, b, a); return; }
      var px = x + Math.cos(rot) * radius, py = y + Math.sin(rot) * radius;
      for (var i = 1; i <= sides; i++) {
        var ang = rot + i / sides * M.TAU;
        var nx = x + Math.cos(ang) * radius, ny = y + Math.sin(ang) * radius;
        R.line(layer, px, py, nx, ny, width, r, g, b, a);
        px = nx; py = ny;
      }
    },
    polyFill: function (layer, x, y, radius, sides, rot, r, g, b, a) {
      if (sides >= 3 && sides <= 8) R.spriteK(layer, FILL_K[sides], x, y, rot, radius, radius, r, g, b, a);
      else R.disc(layer, x, y, radius, r, g, b, a);
    },
    /* arc drawn as short chords; segment count scales with sweep so HUD arcs stay cheap */
    arc: function (layer, x, y, radius, a0, a1, width, r, g, b, a) {
      var sweep = a1 - a0;
      var n = M.clamp(Math.ceil(Math.abs(sweep) * radius / 14), 2, 48);
      var px = x + Math.cos(a0) * radius, py = y + Math.sin(a0) * radius;
      for (var i = 1; i <= n; i++) {
        var ang = a0 + sweep * (i / n);
        var nx = x + Math.cos(ang) * radius, ny = y + Math.sin(ang) * radius;
        R.line(layer, px, py, nx, ny, width, r, g, b, a);
        px = nx; py = ny;
      }
    },
    /* Backdrop budget helper: scale a decorative count by the quality rung so
     * the star/dust field is not drawn at full density on a tier-0 machine.
     * Callers: NA.Events.renderBackdrop (stars, dust, lobes). */
    bgQuota: function (n) {
      var q = R.quality;
      var m = q >= 3 ? 1 : q === 2 ? 0.73 : q === 1 ? 0.5 : 0.27;
      var v = (n * m) | 0;
      return v < 8 ? (n < 8 ? n : 8) : v;
    },
    light: function (x, y, radius, intensity) {
      if (R.quality < 2 || R.lightCount >= R.MAX_LIGHTS) return;
      var o = R.lightCount * 4;
      R.lights[o] = x; R.lights[o + 1] = y; R.lights[o + 2] = radius; R.lights[o + 3] = intensity;
      R.lightCount++;
    },

    /* screen-space helpers (HUD chrome, draft cards, title) */
    ssprite: function (id, x, y, rot, sx, sy, r, g, b, a) { R.sprite(L.SCREEN, id, x, y, rot, sx, sy, r, g, b, a); },
    sline: function (x1, y1, x2, y2, w, r, g, b, a) { R.line(L.SCREEN, x1, y1, x2, y2, w, r, g, b, a); },
    sring: function (x, y, rad, w, r, g, b, a) { R.ring(L.SCREEN, x, y, rad, w, r, g, b, a); },
    sarc: function (x, y, rad, a0, a1, w, r, g, b, a) { R.arc(L.SCREEN, x, y, rad, a0, a1, w, r, g, b, a); },
    sdisc: function (x, y, rad, r, g, b, a) { R.disc(L.SCREEN, x, y, rad, r, g, b, a); },
    spoly: function (x, y, rad, sides, rot, w, r, g, b, a) { R.poly(L.SCREEN, x, y, rad, sides, rot, w, r, g, b, a); }
  };

  /* ------------------------------------------------------------------ init */
  R.init = function (glCanvas, uiCanvas) {
    R.canvas = glCanvas; R.ui = uiCanvas;
    for (var i = 0; i < LAYER_CAP.length; i++) {
      R.buf[i] = new Float32Array(LAYER_CAP[i] * FLOATS);
      R.kinds[i] = new Int32Array(LAYER_CAP[i]);
      R.count[i] = 0;
    }
    R.lights = new Float32Array(R.MAX_LIGHTS * 4);
    buildAtlas();

    var gl = null;
    try {
      if (NA.params.nogl) throw new Error('forced Canvas2D');
      gl = glCanvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: true, powerPreference: 'high-performance',
        preserveDrawingBuffer: !!NA.params.test
      });
    } catch (e) { gl = null; }

    bindKinds();

    // Shader compile/link throws on ANGLE fallbacks and some Intel/Mali
    // drivers that hand out a webgl2 context they cannot actually use. That
    // must demote to Canvas2D, never kill boot.
    if (gl) {
      R.gl = gl; R.mode = 'gl';
      try { initGL(gl); }
      catch (e) { R.gl = null; R.mode = '2d'; }
    }
    if (!R.gl) demote2D(glCanvas);

    if (glCanvas && glCanvas.addEventListener) {
      // preventDefault() on 'lost' is mandatory or 'restored' never fires.
      glCanvas.addEventListener('webglcontextlost', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        R.gl = null; R.contextLost = true;
        demote2D(glCanvas);
        R.resize();
      }, false);
      glCanvas.addEventListener('webglcontextrestored', function () {
        var g2 = null;
        try {
          g2 = glCanvas.getContext('webgl2', {
            alpha: false, antialias: false, depth: false, stencil: false,
            premultipliedAlpha: true, powerPreference: 'high-performance',
            preserveDrawingBuffer: !!NA.params.test
          });
        } catch (e2) { g2 = null; }
        if (!g2) return;
        try { initGL(g2); } catch (e3) { return; }
        R.gl = g2; R.mode = 'gl'; R.contextLost = false;
        Atlas._dirty = true; fbW = fbH = 0;
        R.cap = LAYER_CAP;
        R.resize();
      }, false);
    }

    if (uiCanvas) R.uictx = uiCanvas.getContext('2d');
    R.resize();
    window.addEventListener('resize', onResizeEvent);
    armDprWatch();
    return R;
  };

  /* Fall back to the Canvas2D path (init failure or context loss). */
  function demote2D(glCanvas) {
    R.gl = null; R.mode = '2d';
    if (!R.ctx2d && glCanvas) { try { R.ctx2d = glCanvas.getContext('2d'); } catch (e) { R.ctx2d = null; } }
    R.particleCap = 500; R.quality = 1; R.bloom = false;
    // the fallback degrades instead of dying: a quarter of the instance
    // budget on the world layers, HUD/SCREEN chrome untouched.
    R.cap = LAYER_CAP.slice();
    for (var ci = 0; ci <= L.AFTER; ci++) R.cap[ci] = Math.max(96, (LAYER_CAP[ci] * 0.25) | 0);
  }

  /* resize is coalesced to one per frame: a window drag fires it dozens of
   * times a second, and each one recreates both framebuffer textures. */
  var _resizePending = 0;
  function onResizeEvent() {
    if (_resizePending) return;
    _resizePending = 1;
    var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function (f) { setTimeout(f, 16); };
    raf(function () { _resizePending = 0; R.resize(); });
  }

  /* Firefox does not fire 'resize' when a window moves to a monitor with a
   * different DPR; a one-shot matchMedia listener, re-armed each time, does. */
  var _dprMq = null;
  function armDprWatch() {
    if (typeof matchMedia !== 'function') return;
    try {
      if (_dprMq && _dprMq.removeEventListener) _dprMq.removeEventListener('change', onDprChange);
      _dprMq = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      if (_dprMq.addEventListener) _dprMq.addEventListener('change', onDprChange);
      else if (_dprMq.addListener) _dprMq.addListener(onDprChange);
    } catch (e) { _dprMq = null; }
  }
  function onDprChange() { onResizeEvent(); armDprWatch(); }

  R.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = window.innerWidth || 1280, ch = window.innerHeight || 720;
    R.dpr = dpr; R.w = cw; R.h = ch;
    var pw = Math.max(1, Math.round(cw * dpr * R.resScale)), ph = Math.max(1, Math.round(ch * dpr * R.resScale));
    if (R.canvas) { R.canvas.width = pw; R.canvas.height = ph; }
    if (R.ui) { R.ui.width = Math.round(cw * dpr); R.ui.height = Math.round(ch * dpr); }
    if (R.gl) { R.gl.viewport(0, 0, pw, ph); resizeTargets(pw, ph); }
  };

  /* ================================================================== WEBGL */
  var prog, progPost, vaoQuad, quadVBO, instVBO = [], vaos = [];
  var uCam, uTex;
  var sceneFBO, sceneTex, lightFBO, lightTex, postVAO, postVBO;
  var uPost = {};
  var fbW = 0, fbH = 0;

  var VS = [
    '#version 300 es',
    'layout(location=0) in vec2 a_pos;',
    'layout(location=1) in vec2 i_xy;',
    'layout(location=2) in float i_rot;',
    'layout(location=3) in vec2 i_scale;',
    'layout(location=4) in vec4 i_col;',
    'layout(location=5) in vec4 i_uv;',
    'uniform vec4 u_cam;',   // camx, camy, sx, sy
    'uniform float u_rot;',
    'out vec2 v_uv; out vec4 v_col;',
    'void main(){',
    '  float c=cos(i_rot), s=sin(i_rot);',
    '  vec2 p = a_pos * i_scale;',
    '  p = vec2(p.x*c - p.y*s, p.x*s + p.y*c) + i_xy;',
    '  vec2 d = p - u_cam.xy;',
    '  float cr=cos(u_rot), sr=sin(u_rot);',
    '  d = vec2(d.x*cr - d.y*sr, d.x*sr + d.y*cr);',
    '  gl_Position = vec4(d.x*u_cam.z, d.y*u_cam.w, 0.0, 1.0);',
    '  v_uv = i_uv.xy + (a_pos + 0.5) * i_uv.zw;',
    '  v_col = i_col;',
    '}'
  ].join('\n');

  var FS = [
    '#version 300 es',
    'precision mediump float;',
    'in vec2 v_uv; in vec4 v_col;',
    'uniform sampler2D u_tex;',
    'out vec4 o;',
    'void main(){',
    '  float a = texture(u_tex, v_uv).a * v_col.a;',
    '  o = vec4(v_col.rgb * a, a);',   // premultiplied
    '}'
  ].join('\n');

  var VSP = [
    '#version 300 es',
    'layout(location=0) in vec2 a_pos;',
    'out vec2 v_uv;',
    'void main(){ v_uv = a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }'
  ].join('\n');

  var FSP = [
    '#version 300 es',
    'precision mediump float;',
    'in vec2 v_uv;',
    'uniform sampler2D u_scene;',
    'uniform sampler2D u_light;',
    'uniform vec4 u_a;',   // chroma, vignette, hue, darkness
    'uniform vec4 u_b;',   // flash, desat, time, aspect
    'out vec4 o;',
    'vec3 hueRot(vec3 c, float h){',
    '  const vec3 k = vec3(0.57735);',
    '  float ca = cos(h);',
    '  return c*ca + cross(k,c)*sin(h) + k*dot(k,c)*(1.0-ca);',
    '}',
    'void main(){',
    '  vec2 uv = v_uv;',
    '  vec2 d = uv - 0.5;',
    '  vec3 col;',
    '  float ch = u_a.x;',
    '  if (ch > 0.0005) {',
    '    vec2 off = d * ch;',
    '    col.r = texture(u_scene, uv + off).r;',
    '    col.g = texture(u_scene, uv).g;',
    '    col.b = texture(u_scene, uv - off).b;',
    '  } else { col = texture(u_scene, uv).rgb; }',
    '  if (u_a.w > 0.001) {',
    '    float lit = clamp(texture(u_light, uv).r, 0.0, 1.0);',
    '    col *= mix(1.0, max(lit, 0.09), u_a.w);',
    '  }',
    '  if (abs(u_a.z) > 0.001) col = hueRot(col, u_a.z);',
    '  if (u_b.y > 0.001) { float l = dot(col, vec3(0.299,0.587,0.114)); col = mix(col, vec3(l), u_b.y); }',
    '  float r2 = dot(d*vec2(u_b.w,1.0), d*vec2(u_b.w,1.0));',
    '  col *= mix(1.0, clamp(1.0 - r2*1.55, 0.0, 1.0), u_a.y);',
    '  col += vec3(u_b.x);',
    '  o = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }
  function link(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  function initGL(gl) {
    prog = link(gl, VS, FS);
    progPost = link(gl, VSP, FSP);
    uCam = gl.getUniformLocation(prog, 'u_cam');
    uTex = gl.getUniformLocation(prog, 'u_tex');
    R._uRot = gl.getUniformLocation(prog, 'u_rot');
    uPost.scene = gl.getUniformLocation(progPost, 'u_scene');
    uPost.light = gl.getUniformLocation(progPost, 'u_light');
    uPost.a = gl.getUniformLocation(progPost, 'u_a');
    uPost.b = gl.getUniformLocation(progPost, 'u_b');

    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      -0.5, 0.5, 0.5, -0.5, 0.5, 0.5
    ]), gl.STATIC_DRAW);

    for (var i = 0; i < LAYER_CAP.length; i++) {
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      var vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, LAYER_CAP[i] * FLOATS * 4, gl.DYNAMIC_DRAW);
      var st = FLOATS * 4;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 0); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, st, 8); gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, st, 12); gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, st, 20); gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, st, 36); gl.vertexAttribDivisor(5, 1);
      instVBO[i] = vb; vaos[i] = vao;
    }
    // light layer reuses layer buffer slot via its own vao/vbo
    R._lightVAO = gl.createVertexArray();
    gl.bindVertexArray(R._lightVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    R._lightVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, R._lightVBO);
    gl.bufferData(gl.ARRAY_BUFFER, R.MAX_LIGHTS * FLOATS * 4, gl.DYNAMIC_DRAW);
    var s2 = FLOATS * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, s2, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, s2, 8); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, s2, 12); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, s2, 20); gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, s2, 36); gl.vertexAttribDivisor(5, 1);
    R._lightBuf = new Float32Array(R.MAX_LIGHTS * FLOATS);

    postVAO = gl.createVertexArray();
    gl.bindVertexArray(postVAO);
    postVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, postVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // atlas texture
    R.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, R.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Atlas.canvas);
    Atlas._dirty = false;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.clearColor(NA.C.COL.void[0], NA.C.COL.void[1], NA.C.COL.void[2], 1);
  }

  function makeTarget(gl, w, h) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo: f, tex: t, w: w, h: h };
  }

  function resizeTargets(w, h) {
    var gl = R.gl; if (!gl) return;
    if (w === fbW && h === fbH) return;
    fbW = w; fbH = h;
    if (sceneFBO) { gl.deleteFramebuffer(sceneFBO.fbo); gl.deleteTexture(sceneFBO.tex); }
    if (lightFBO) { gl.deleteFramebuffer(lightFBO.fbo); gl.deleteTexture(lightFBO.tex); }
    sceneFBO = makeTarget(gl, w, h);
    lightFBO = makeTarget(gl, Math.max(1, w >> 2), Math.max(1, h >> 2));
    sceneTex = sceneFBO.tex; lightTex = lightFBO.tex;
  }

  /* ----------------------------------------------------------- frame flow */
  R.begin = function () {
    for (var i = 0; i < R.count.length; i++) R.count[i] = 0;
    R.lightCount = 0;
    R.stats.instances = 0; R.stats.draws = 0;
    // camera AABB for the sprite cull: half the view diagonal covers any shake
    // rotation, plus a margin for backdrop parallax and fat glyph glow.
    var vw = Cam.viewW(), vh = Cam.viewH();
    var half = Math.sqrt(vw * vw + vh * vh) * 0.5 + 240;
    var ccx = Cam.x + Cam.shakeX, ccy = Cam.y + Cam.shakeY;
    R._cx0 = ccx - half; R._cx1 = ccx + half;
    R._cy0 = ccy - half; R._cy1 = ccy + half;
  };

  function postActive() {
    var p = R.post;
    if (!R.bloom) return false;
    return p.chroma > 0.0005 || p.vignette > 0.001 || Math.abs(p.hue) > 0.001 ||
      p.darkness > 0.001 || p.flash > 0.001 || p.desat > 0.001;
  }

  R.end = function () {
    var total = 0;
    for (var i = 0; i < R.count.length; i++) total += R.count[i];
    R.stats.instances = total;
    if (R.mode === 'gl') flushGL(); else flush2D();
  };

  function camUniforms(gl, layer) {
    var vw, vh, cx, cy, rot;
    if (layer === L.SCREEN) {
      vw = R.w; vh = R.h; cx = R.w * 0.5; cy = R.h * 0.5; rot = 0;
    } else {
      vw = Cam.viewW(); vh = Cam.viewH();
      cx = Cam.x + Cam.shakeX; cy = Cam.y + Cam.shakeY; rot = Cam.shakeRot;
      if (layer === L.BACKDROP) { // parallax: backdrop shakes at 30%
        cx = Cam.x + Cam.shakeX * 0.3; cy = Cam.y + Cam.shakeY * 0.3; rot = Cam.shakeRot * 0.3;
      }
    }
    gl.uniform4f(uCam, cx, cy, 2 / vw, -2 / vh);
    gl.uniform1f(R._uRot, rot);
  }

  function flushGL() {
    var gl = R.gl;
    if (Atlas._dirty) {
      gl.bindTexture(gl.TEXTURE_2D, R.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Atlas.canvas);
      Atlas._dirty = false;
    }
    var usePost = postActive();
    var pw = R.canvas.width, ph = R.canvas.height;

    // ---- light accumulation (only when the darkness mask is in play)
    if (R.post.darkness > 0.001 && R.quality >= 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFBO.fbo);
      gl.viewport(0, 0, lightFBO.w, lightFBO.h);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (R.lightCount) {
        var e = Atlas.map.disc, lb = R._lightBuf;
        for (var i = 0; i < R.lightCount; i++) {
          var o = i * FLOATS, s = i * 4, rad = R.lights[s + 2] * e.k * 2;
          lb[o] = R.lights[s]; lb[o + 1] = R.lights[s + 1]; lb[o + 2] = 0;
          lb[o + 3] = rad; lb[o + 4] = rad;
          var it = R.lights[s + 3];
          lb[o + 5] = it; lb[o + 6] = it; lb[o + 7] = it; lb[o + 8] = 1;
          lb[o + 9] = e.u0; lb[o + 10] = e.v0; lb[o + 11] = e.du; lb[o + 12] = e.dv;
        }
        gl.useProgram(prog);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex); gl.uniform1i(uTex, 0);
        camUniforms(gl, L.PARTICLES);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(R._lightVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, R._lightVBO);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, lb, 0, R.lightCount * FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, R.lightCount);
        R.stats.draws++;
      }
    }

    // ---- scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, usePost ? sceneFBO.fbo : null);
    gl.viewport(0, 0, pw, ph);
    var v = NA.C.COL.void;
    gl.clearColor(v[0], v[1], v[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, R.tex); gl.uniform1i(uTex, 0);

    for (var li = 0; li < LAYER_CAP.length; li++) {
      var n = R.count[li];
      if (!n) continue;
      camUniforms(gl, li);
      gl.blendFunc(gl.ONE, LAYER_ADD[li] ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vaos[li]);
      gl.bindBuffer(gl.ARRAY_BUFFER, instVBO[li]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, R.buf[li], 0, n * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      R.stats.draws++;
    }

    // ---- post
    if (usePost) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, pw, ph);
      gl.useProgram(progPost);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform1i(uPost.scene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lightTex); gl.uniform1i(uPost.light, 1);
      var p = R.post;
      gl.uniform4f(uPost.a, p.chroma / Math.max(1, R.w) * 3.0, p.vignette, p.hue, p.darkness);
      gl.uniform4f(uPost.b, p.flash, p.desat, NA.Time.real, R.w / Math.max(1, R.h));
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindVertexArray(postVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      R.stats.draws++;
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.bindVertexArray(null);
  }

  /* --------------------------------------------------- Canvas2D fallback */
  /* The atlas canvas is already rasterised, glow and all, so the fallback
   * blits cells out of it instead of re-running each glyph's authoring
   * callback per instance (which was ~6 us/instance). Colour is applied once
   * per (glyph, quantised rgb) pair into a slot of a small cache canvas and
   * then blitted; the cache is flushed wholesale when it fills. */
  var TINT_SLOT = 128, TINT_COLS = 16, TINT_ROWS = 8, TINT_N = TINT_COLS * TINT_ROWS;
  var tintCanvas = null, tintCtx = null, tintMap = null, tintUsed = 0;
  var colStr = new Array(4096);

  function tintSlot(e, cq) {
    var key = e.kind * 4096 + cq;
    var slot = tintMap.get(key);
    if (slot !== undefined) return slot;
    if (tintUsed >= TINT_N) {                 // full: drop everything and refill
      tintMap.clear(); tintUsed = 0;
      tintCtx.setTransform(1, 0, 0, 1, 0, 0);
      tintCtx.globalCompositeOperation = 'source-over';
      tintCtx.clearRect(0, 0, tintCanvas.width, tintCanvas.height);
    }
    slot = tintUsed++;
    tintMap.set(key, slot);
    var sx = (slot % TINT_COLS) * TINT_SLOT, sy = ((slot / TINT_COLS) | 0) * TINT_SLOT;
    var c = colStr[cq];
    if (c === undefined) {
      c = colStr[cq] = 'rgb(' + ((cq >> 8) * 17) + ',' + (((cq >> 4) & 15) * 17) + ',' + ((cq & 15) * 17) + ')';
    }
    tintCtx.setTransform(1, 0, 0, 1, 0, 0);
    tintCtx.globalAlpha = 1;
    tintCtx.globalCompositeOperation = 'source-over';
    tintCtx.clearRect(sx, sy, TINT_SLOT, TINT_SLOT);
    tintCtx.drawImage(Atlas.canvas, e.px, e.py, e.size, e.size, sx, sy, e.size, e.size);
    // source-atop paints the colour only where the glyph already has alpha and
    // leaves every other slot on the shared canvas untouched.
    tintCtx.globalCompositeOperation = 'source-atop';
    tintCtx.fillStyle = c;
    tintCtx.fillRect(sx, sy, e.size, e.size);
    tintCtx.globalCompositeOperation = 'source-over';
    return slot;
  }

  function flush2D() {
    var ctx = R.ctx2d;
    if (!ctx) return;
    if (!tintCanvas) {
      tintCanvas = document.createElement('canvas');
      tintCanvas.width = TINT_COLS * TINT_SLOT; tintCanvas.height = TINT_ROWS * TINT_SLOT;
      tintCtx = tintCanvas.getContext('2d');
      tintMap = new Map();
    }
    var pw = R.canvas.width, ph = R.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    var v = NA.C.COL.void;
    ctx.fillStyle = 'rgb(' + (v[0] * 255 | 0) + ',' + (v[1] * 255 | 0) + ',' + (v[2] * 255 | 0) + ')';
    ctx.fillRect(0, 0, pw, ph);
    var INV_INSET = 1 / Atlas.INSET;

    for (var li = 0; li < LAYER_CAP.length; li++) {
      var n = R.count[li]; if (!n) continue;
      var f = R.buf[li], kinds = R.kinds[li];
      var screen = (li === L.SCREEN);
      var vw = screen ? R.w : Cam.viewW(), vh = screen ? R.h : Cam.viewH();
      var cx = screen ? R.w * 0.5 : Cam.x + Cam.shakeX, cy = screen ? R.h * 0.5 : Cam.y + Cam.shakeY;
      var scale = pw / vw, scaleY = ph / vh;
      ctx.globalCompositeOperation = LAYER_ADD[li] ? 'lighter' : 'source-over';
      try {
        for (var i = 0; i < n; i++) {
          var o = i * FLOATS;
          var a = f[o + 8]; if (a <= 0.01) continue;
          var e = Atlas.list[kinds[i]]; if (!e) continue;
          var ik = 1 / (e.k * 2);
          var sx = f[o + 3] * ik, sy = f[o + 4] * ik;
          var dw = sx * scale, dh = sy * scaleY;
          if (dw < 0.35 && dh < 0.35) continue;
          dw *= INV_INSET; dh *= INV_INSET;

          var qr = f[o + 5] * 15 + 0.5 | 0; if (qr < 0) qr = 0; else if (qr > 15) qr = 15;
          var qg = f[o + 6] * 15 + 0.5 | 0; if (qg < 0) qg = 0; else if (qg > 15) qg = 15;
          var qb = f[o + 7] * 15 + 0.5 | 0; if (qb < 0) qb = 0; else if (qb > 15) qb = 15;
          var slot = tintSlot(e, (qr << 8) | (qg << 4) | qb);

          var tx = (f[o] - cx) * scale + pw * 0.5, ty = (f[o + 1] - cy) * scaleY + ph * 0.5;
          var rot = f[o + 2];
          if (rot) {
            var cs = Math.cos(rot), sn = Math.sin(rot);
            ctx.setTransform(cs, sn, -sn, cs, tx, ty);
          } else ctx.setTransform(1, 0, 0, 1, tx, ty);
          ctx.globalAlpha = a < 1 ? a : 1;
          ctx.drawImage(tintCanvas, (slot % TINT_COLS) * TINT_SLOT, ((slot / TINT_COLS) | 0) * TINT_SLOT,
            e.size, e.size, -dw * 0.5, -dh * 0.5, dw, dh);
        }
      } catch (err) { }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    var p = R.post;
    // Cheap stand-in for the post chain's darkness + vignette. Without it the
    // eclipse / darkPhase / Dimmer beats are a complete no-op in the fallback
    // and the arena loses its frame. One cached radial gradient, rebuilt only
    // when the quantised amounts or the canvas size change.
    var dk = p.darkness > 0 ? (p.darkness < 1 ? p.darkness : 1) : 0;
    var vg = p.vignette > 0 ? (p.vignette < 1 ? p.vignette : 1) : 0;
    if (dk > 0.004 || vg > 0.004) {
      var qd = (dk * 32) | 0, qv = (vg * 32) | 0;
      if (!_vgGrad || _vgQd !== qd || _vgQv !== qv || _vgW !== pw || _vgH !== ph) {
        var inner = dk * 0.82;
        var outer = inner + vg * 0.72; if (outer > 0.96) outer = 0.96;
        var mid = inner + (outer - inner) * 0.35;
        var g = ctx.createRadialGradient(pw * 0.5, ph * 0.5, 0, pw * 0.5, ph * 0.5, Math.max(pw, ph) * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,' + inner.toFixed(3) + ')');
        g.addColorStop(0.55, 'rgba(0,0,0,' + mid.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(0,0,0,' + outer.toFixed(3) + ')');
        _vgGrad = g; _vgQd = qd; _vgQv = qv; _vgW = pw; _vgH = ph;
      }
      ctx.fillStyle = _vgGrad;
      ctx.fillRect(0, 0, pw, ph);
    }
    if (p.flash > 0.003) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.5, p.flash) + ')';
      ctx.fillRect(0, 0, pw, ph);
    }
  }
  var _vgGrad = null, _vgQd = -1, _vgQv = -1, _vgW = 0, _vgH = 0;

  /* ------------------------------------------------------ quality governor */
  /* The CPU timer stops at the last GL call, so it cannot see rasterisation,
   * the post chain or overdraw. The governor therefore drives on the worse of
   * CPU cost and the *presented* frame interval. vsync pins that interval at
   * the display cadence even on an idle frame, so only the excess over the
   * observed cadence counts as back-pressure; tab stalls are excluded. */
  var frameHist = new Float32Array(120), fhI = 0, fhN = 0, holdT = 0;
  var p95Scratch = new Float32Array(120), govFrames = 0, refreshMs = 20;
  var DOWN_MS = 15, UP_MS = 10;

  R.reportFrame = function (ms, realDt) {
    var rafMs = realDt === undefined ? 0 : realDt * 1000;
    var live = rafMs > 0.4 && rafMs < 100;      // 100 ms+ is a tab stall, not us
    var drive = ms;
    if (live) {
      if (rafMs < refreshMs) refreshMs = rafMs;
      else if (refreshMs < 20) refreshMs += 0.002;   // slow drift back up
      var back = rafMs - refreshMs;
      if (back > drive) drive = back;
    }
    frameHist[fhI] = drive; fhI = (fhI + 1) % frameHist.length;
    if (fhN < frameHist.length) fhN++;
    var sum = 0;
    for (var i = 0; i < fhN; i++) sum += frameHist[i];
    R.stats.avgMs = sum / fhN;
    R.stats.frameMs = ms;
    // p95 into a preallocated scratch, insertion sorted — no allocation
    if (((++govFrames) & 31) === 0 && fhN > 20) {
      for (var c = 0; c < fhN; c++) p95Scratch[c] = frameHist[c];
      for (var j = 1; j < fhN; j++) {
        var val = p95Scratch[j], k2 = j - 1;
        while (k2 >= 0 && p95Scratch[k2] > val) { p95Scratch[k2 + 1] = p95Scratch[k2]; k2--; }
        p95Scratch[k2 + 1] = val;
      }
      R.stats.p95 = p95Scratch[Math.min(fhN - 1, Math.floor(fhN * 0.95))];
    }
    holdT += live ? rafMs / 1000 : ms / 1000;    // real wall time, not CPU time
    if (holdT < 1.2 || fhN < 40) return;
    if (R.stats.avgMs > DOWN_MS && R.quality > 0) { R.setQuality(R.quality - 1); holdT = 0; }
    else if (R.stats.avgMs < UP_MS && R.quality < (NA.Store.settings.quality || 3)) { R.setQuality(R.quality + 1); holdT = 0; }
  };
  /* Rungs, weakest first: trails off + bloom off (0), particle caps, resolution
   * scale. See GAME_PLAN §13. */
  R.setQuality = function (q) {
    q = M.clamp(q | 0, 0, 3);
    if (R.mode === '2d') q = Math.min(q, 1);   // fallback path: glow off, particle cap 500
    if (q === R.quality) return;
    R.quality = q;
    R.bloom = R.mode !== '2d' && q >= 1;
    R.trails = q >= 1;
    R.particleCap = R.mode === '2d' ? 500 : [400, 900, 1500, 2000][q];
    var rs = [0.7, 0.85, 1, 1][q];
    if (rs !== R.resScale) { R.resScale = rs; R.resize(); }
  };
  R.setQualityHard = function (q) { NA.Store.settings.quality = q; R.quality = -1; R.setQuality(q); holdT = -1e9; };
})();
