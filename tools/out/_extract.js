
"use strict";
/* ===== 01_core.js ===== */
/* 01_core.js — constants, math, seeded RNG, clock, input, settings store.
 *
 * Public API
 *   NA.C          constants + palette (COL.* are [r,g,b] 0..1)
 *   NA.M          clamp lerp lerpAngle len2 dist2 dist norm angDiff smooth ease* noise1 noise2 sign approach
 *   NA.RNG        seed(n) f() range(a,b) int(n) pick(arr) chance(p) sign() fork(salt)
 *   NA.Time       fixed timeScale t frames alpha hitStop begin(msNow) setTimeScale(s,ms) addHitStop(ms) paused
 *   NA.Input      init() keys mouse world axis(out) isDown(a) pressed(a) anyHeld() holdTime consume()
 *   NA.Store      settings get(k,d) set(k,v) save() load() records
 */
var NA = (typeof NA !== 'undefined' && NA) ? NA : {};
NA.version = '1.0.0';

/* ------------------------------------------------------------------ params */
NA.params = (function () {
  var p = {};
  try {
    var q = (typeof location !== 'undefined' ? location.search : '').replace(/^\?/, '');
    if (q) q.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i);
      p[decodeURIComponent(k)] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
    });
  } catch (e) { }
  return p;
})();

/* --------------------------------------------------------------- constants */
NA.C = {
  ARENA_R: 1400,
  ARENA_MIN_R: 420,
  SHIP_R: 10,
  VIEW_W: 1600, VIEW_H: 900,

  MAX_ENEMIES: 1024,
  MAX_PBULLETS: 6144,
  MAX_EBULLETS: 6144,
  MAX_PARTICLES: 4096,
  MAX_RINGS: 512,
  MAX_FRAGS: 1024,
  MAX_AFTER: 256,
  MAX_BOLTS: 64,
  MAX_CORPSES: 100,

  PLAYER_HP: 3,
  MANA_MAX: 100,
  MANA_TRICKLE: 6,
  MANA_GRAZE: 3,
  MANA_KILL: 2,
  MANA_KILL_CAP: 20,
  MANA_IDLE_AFTER: 4,
  DASH_COST: 15,
  DASH_DIST: 140,
  DASH_TIME: 0.15,
  DASH_IFRAME: 0.15,
  INVULN: 0.8,
  GRAZE_R: 34,

  PLAYER_SPEED: 430,
  PLAYER_ACCEL: 4200,
  PLAYER_FRICTION: 9.5,
  FIRE_RATE: 8.5,          // shots/sec base
  BULLET_SPEED: 1250,
  BULLET_LIFE: 1.6,
  BULLET_DMG: 10,

  MERCY_R: 190,
  SOFT_WALL: 60,

  // shared telegraph breathing frequency (Hz) — never change, it is a read convention
  TELEGRAPH_HZ: 2,

  COL: {
    void: [0.020, 0.024, 0.039],
    player: [0.302, 0.953, 1.000],
    core: [0.918, 1.000, 1.000],
    white: [1, 1, 1],
    magenta: [1.000, 0.235, 0.675],
    orange: [1.000, 0.541, 0.000],
    acid: [0.714, 1.000, 0.000],
    violet: [0.608, 0.361, 1.000],
    yellow: [1.000, 0.847, 0.302],
    green: [0.224, 1.000, 0.416],
    red: [1.000, 0.180, 0.302],
    gold: [1.000, 0.847, 0.302],
    navy: [0.086, 0.110, 0.220],
    plum: [0.200, 0.098, 0.180],
    grey: [0.55, 0.58, 0.65]
  }
};

/* -------------------------------------------------------------------- math */
NA.M = (function () {
  var TAU = Math.PI * 2;
  // 1D + 2D value noise (cheap, smooth, deterministic) — used for shake and drift.
  var NP = new Float32Array(512);
  (function () { var s = 1337; for (var i = 0; i < 512; i++) { s = (s * 1664525 + 1013904223) >>> 0; NP[i] = (s >>> 8) / 8388608 - 1; } })();
  function fade(t) { return t * t * (3 - 2 * t); }

  var M = {
    TAU: TAU, PI: Math.PI, HALFPI: Math.PI / 2,
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    clamp01: function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    sign: function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0; },
    len2: function (x, y) { return x * x + y * y; },
    dist2: function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
    dist: function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); },
    norm: function (a) { a = a % TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; },
    angDiff: function (a, b) { return M.norm(b - a); },
    lerpAngle: function (a, b, t) { return a + M.norm(b - a) * t; },
    // frame-rate independent exponential approach
    smooth: function (a, b, rate, dt) { return b + (a - b) * Math.exp(-rate * dt); },
    approach: function (a, b, step) { return a < b ? Math.min(a + step, b) : Math.max(a - step, b); },
    easeOut: function (t) { return 1 - (1 - t) * (1 - t); },
    easeIn: function (t) { return t * t; },
    easeInOut: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    easeOutBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    noise1: function (x) {
      var i = Math.floor(x), f = x - i, a = NP[i & 511], b = NP[(i + 1) & 511];
      return a + (b - a) * fade(f);
    },
    noise2: function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      function h(a, b) { return NP[(a * 57 + b * 131) & 511]; }
      var u = fade(xf), v = fade(yf);
      var a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
    },
    // hsv->rgb into a scratch triple, no allocation
    _c3: [0, 0, 0],
    hsv: function (h, s, v) {
      h = (h % 1 + 1) % 1;
      var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), o = M._c3;
      switch (i % 6) {
        case 0: o[0] = v; o[1] = t; o[2] = p; break;
        case 1: o[0] = q; o[1] = v; o[2] = p; break;
        case 2: o[0] = p; o[1] = v; o[2] = t; break;
        case 3: o[0] = p; o[1] = q; o[2] = v; break;
        case 4: o[0] = t; o[1] = p; o[2] = v; break;
        default: o[0] = v; o[1] = p; o[2] = q; break;
      }
      return o;
    }
  };
  return M;
})();

/* --------------------------------------------------------------------- RNG */
NA.RNG = (function () {
  var s0 = 123456789, s1 = 362436069, s2 = 521288629, s3 = 88675123;
  function next() { // xorshift128
    var t = s0 ^ (s0 << 11);
    s0 = s1; s1 = s2; s2 = s3;
    s3 = (s3 ^ (s3 >>> 19)) ^ (t ^ (t >>> 8));
    return s3 >>> 0;
  }
  var R = {
    seed: function (n) {
      n = (n >>> 0) || 1;
      s0 = n; s1 = (n * 1664525 + 1013904223) >>> 0;
      s2 = (s1 * 1664525 + 1013904223) >>> 0; s3 = (s2 * 1664525 + 1013904223) >>> 0;
      for (var i = 0; i < 12; i++) next();
      return R;
    },
    f: function () { return next() / 4294967296; },
    range: function (a, b) { return a + (b - a) * R.f(); },
    int: function (n) { return (R.f() * n) | 0; },
    pick: function (a) { return a[(R.f() * a.length) | 0]; },
    chance: function (p) { return R.f() < p; },
    sign: function () { return R.f() < 0.5 ? -1 : 1; },
    angle: function () { return R.f() * NA.M.TAU; },
    // deterministic sub-stream (draft offers must not be perturbed by spawn jitter)
    fork: function (salt) {
      var a = ((s0 ^ (salt * 2654435761)) >>> 0) || 1;
      return { f: function () { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; } };
    }
  };
  R.seed(0xC0FFEE);
  return R;
})();

/* -------------------------------------------------------------------- time */
NA.Time = {
  fixed: 1 / 120,
  timeScale: 1,
  _tsTarget: 1, _tsTimer: 0, _tsFrom: 1, _tsDur: 0,
  hitStop: 0,
  acc: 0,
  t: 0,            // simulated seconds
  real: 0,         // wall-clock seconds since boot
  frames: 0,
  alpha: 0,
  paused: false,
  maxSteps: 8,

  setTimeScale: function (s, ms) {
    if (ms) { this._tsFrom = this.timeScale; this._tsTarget = s; this._tsDur = ms / 1000; this._tsTimer = 0; this.timeScale = s; }
    else { this.timeScale = s; this._tsTarget = s; this._tsDur = 0; }
    if (NA.Audio && NA.Audio.setTimeScale) NA.Audio.setTimeScale(s);
  },
  // ramp back to 1 over ms after a slow-mo window
  slowmo: function (scale, ms) {
    this.timeScale = scale; this._tsFrom = scale; this._tsTarget = 1; this._tsDur = ms / 1000; this._tsTimer = 0;
    if (NA.Audio && NA.Audio.setTimeScale) NA.Audio.setTimeScale(scale);
  },
  addHitStop: function (ms) { this.hitStop = Math.max(this.hitStop, ms / 1000); },

  // Advance wall clock, return the number of fixed sim steps to run.
  begin: function (realDt) {
    if (realDt > 0.1) realDt = 0.1;         // tab stalls must not fast-forward the sim
    this.real += realDt;
    if (this._tsDur > 0) {
      this._tsTimer += realDt;
      var k = NA.M.clamp01(this._tsTimer / this._tsDur);
      this.timeScale = NA.M.lerp(this._tsFrom, this._tsTarget, NA.M.easeOutCubic(k));
      if (k >= 1) { this._tsDur = 0; this.timeScale = this._tsTarget; }
      if (NA.Audio && NA.Audio.setTimeScale) NA.Audio.setTimeScale(this.timeScale);
    }
    var scaled = realDt * this.timeScale;
    if (this.hitStop > 0) { this.hitStop -= realDt; scaled = 0; }   // freeze sim, keep rendering
    if (this.paused) scaled = 0;
    this.acc += scaled;
    var steps = 0;
    while (this.acc >= this.fixed && steps < this.maxSteps) { this.acc -= this.fixed; steps++; }
    if (steps === this.maxSteps) this.acc = 0;                      // drop the backlog
    this.alpha = this.acc / this.fixed;
    this.t += steps * this.fixed;
    return steps;
  }
};

/* ------------------------------------------------------------------- store */
NA.Store = {
  settings: {
    volMaster: 0.8, volMusic: 0.6, volSfx: 0.9,
    shake: 1, flash: 1, quality: 3, colorblind: 0,
    reticle: 1, autofire: 1, hints: 1, damageNumbers: 0
  },
  records: { best: 0, beat30: 0, seen: {} },
  load: function () {
    try {
      var s = localStorage.getItem('na.settings');
      if (s) { var o = JSON.parse(s); for (var k in o) if (k in this.settings) this.settings[k] = o[k]; }
      var r = localStorage.getItem('na.records');
      if (r) { var q = JSON.parse(r); for (var j in q) this.records[j] = q[j]; }
    } catch (e) { }
    return this;
  },
  save: function () {
    try {
      localStorage.setItem('na.settings', JSON.stringify(this.settings));
      localStorage.setItem('na.records', JSON.stringify(this.records));
    } catch (e) { }
  },
  get: function (k, d) { var v = this.settings[k]; return v === undefined ? d : v; },
  set: function (k, v) { this.settings[k] = v; this.save(); return v; }
};

/* ------------------------------------------------------------------- input */
NA.Input = (function () {
  var KEYMAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'fire', ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'active',
    Escape: 'pause', Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3', Digit4: 'pick4',
    Enter: 'confirm'
  };
  var I = {
    down: {}, prev: {}, pressedSet: {},
    mouse: { x: 0, y: 0, left: false, right: false, mid: false, wheel: 0, moved: false },
    world: { x: 0, y: 0 },
    holdTime: 0,
    anyPressedThisFrame: false,
    gamepad: null,
    _padIndex: -1,
    _ax: { x: 0, y: 0 },
    _clicks: 0,

    init: function (el) {
      var self = this;
      window.addEventListener('keydown', function (e) {
        var a = KEYMAP[e.code];
        if (a) { if (!self.down[a]) self.pressedSet[a] = 1; self.down[a] = true; }
        self.down['_any'] = true;
        if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) {
        var a = KEYMAP[e.code]; if (a) self.down[a] = false;
        self.down['_any'] = self._anyKey();
      });
      window.addEventListener('blur', function () { self.down = {}; self.mouse.left = self.mouse.right = false; });
      var target = el || window;
      target.addEventListener('mousemove', function (e) {
        self.mouse.x = e.clientX; self.mouse.y = e.clientY; self.mouse.moved = true;
      });
      target.addEventListener('mousedown', function (e) {
        if (e.button === 0) { self.mouse.left = true; if (!self.down.fire) self.pressedSet.fire = 1; self.down.fire = true; self._clicks++; }
        if (e.button === 2) { self.mouse.right = true; if (!self.down.dash) self.pressedSet.dash = 1; self.down.dash = true; }
        if (e.button === 1) { self.mouse.mid = true; self.pressedSet.active = 1; self.down.active = true; }
        self.down['_any'] = true;
        if (NA.Audio && NA.Audio.init) NA.Audio.init();
      });
      target.addEventListener('mouseup', function (e) {
        if (e.button === 0) { self.mouse.left = false; self.down.fire = self.down.fire && !!self._keyFire; }
        if (e.button === 2) { self.mouse.right = false; self.down.dash = false; }
        if (e.button === 1) { self.mouse.mid = false; self.down.active = false; }
        self.down['_any'] = self._anyKey();
      });
      window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      window.addEventListener('gamepadconnected', function (e) { self._padIndex = e.gamepad.index; });
      window.addEventListener('gamepaddisconnected', function (e) {
        if (self._padIndex === e.gamepad.index) { self._padIndex = -1; self.gamepad = null; }
      });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { NA.Time.paused = true; }
        else { NA.Time.paused = false; NA.Time.acc = 0; }
      });
      return this;
    },
    _anyKey: function () { for (var k in this.down) if (k !== '_any' && this.down[k]) return true; return false; },

    // called once per frame before sim.
    // getGamepads() allocates a fresh array on every call and touches the HID
    // stack, so it is only polled once a pad has actually announced itself.
    poll: function (dt) {
      if (this._padIndex >= 0 && navigator.getGamepads) {
        var pads = navigator.getGamepads();
        this.gamepad = (pads && pads[this._padIndex] && pads[this._padIndex].connected) ? pads[this._padIndex] : null;
      } else this.gamepad = null;
      var held = this.anyHeld();
      this.holdTime = held ? this.holdTime + dt : 0;
      this.anyPressedThisFrame = false;
      for (var k in this.pressedSet) if (this.pressedSet[k]) { this.anyPressedThisFrame = true; break; }
    },
    endFrame: function () { this.pressedSet = {}; this.mouse.wheel = 0; this.mouse.moved = false; },

    isDown: function (a) {
      if (this.down[a]) return true;
      var gp = this.gamepad; if (!gp) return false;
      var b = gp.buttons;
      if (a === 'fire') return !!(b[7] && b[7].pressed);
      if (a === 'dash') return !!((b[6] && b[6].pressed) || (b[1] && b[1].pressed));
      if (a === 'active') return !!((b[3] && b[3].pressed) || (b[5] && b[5].pressed));
      if (a === 'pause') return !!(b[9] && b[9].pressed);
      return false;
    },
    pressed: function (a) { return !!this.pressedSet[a]; },
    anyHeld: function () {
      if (this.mouse.left || this.mouse.right || this.mouse.mid) return true;
      if (this._anyKey()) return true;
      var gp = this.gamepad;
      if (gp) for (var i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed) return true;
      return false;
    },
    // movement axis into a shared scratch vector (never allocates)
    axis: function () {
      var x = 0, y = 0;
      if (this.isDown('left')) x -= 1;
      if (this.isDown('right')) x += 1;
      if (this.isDown('up')) y -= 1;
      if (this.isDown('down')) y += 1;
      var gp = this.gamepad;
      if (gp && gp.axes.length >= 2) {
        var gx = gp.axes[0], gy = gp.axes[1];
        if (Math.abs(gx) > 0.18) x += gx;
        if (Math.abs(gy) > 0.18) y += gy;
      }
      var l = Math.sqrt(x * x + y * y);
      if (l > 1) { x /= l; y /= l; }
      this._ax.x = x; this._ax.y = y;
      return this._ax;
    },
    // right stick aim override; returns true when the pad is driving the reticle
    stickAim: function (out) {
      var gp = this.gamepad; if (!gp || gp.axes.length < 4) return false;
      var x = gp.axes[2], y = gp.axes[3];
      if (x * x + y * y < 0.09) return false;
      out.x = x; out.y = y; return true;
    }
  };
  return I;
})();

/* ===== 02_render.js ===== */
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
        u0: x / ATLAS_SIZE, v0: y / ATLAS_SIZE,
        du: size / ATLAS_SIZE, dv: size / ATLAS_SIZE,
        k: 1 / Atlas.INSET
      };
      Atlas.map[id] = e; Atlas.list.push(e); Atlas._dirty = true;
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
    lookahead: 0.25,
    enabled: true,

    setZoom: function (z, ms) {
      if (!ms) { this.zoom = this.tzoom = z; this._zdur = 0; return; }
      this._zfrom = this.zoom; this._zto = z; this._zdur = ms / 1000; this._zt = 0; this.tzoom = z;
    },
    fitArena: function (ms) {
      var need = (NA.Arena ? NA.Arena.radius : NA.C.ARENA_R) * 2.16;
      this.setZoom(NA.C.VIEW_W / need, ms === undefined ? 800 : ms);
      this.tx = NA.Arena ? NA.Arena.cx : 0; this.ty = NA.Arena ? NA.Arena.cy : 0;
    },
    addTrauma: function (t) {
      this.trauma = M.clamp01(this.trauma + t * (NA.Store.settings.shake === undefined ? 1 : NA.Store.settings.shake));
    },
    follow: function (px, py, ax, ay) { this.tx = px + ax * this.lookahead; this.ty = py + ay * this.lookahead; },

    update: function (dt) {
      if (this._zdur > 0) {
        this._zt += dt;
        var k = M.clamp01(this._zt / this._zdur);
        this.zoom = M.lerp(this._zfrom, this._zto, M.easeInOut(k));
        if (k >= 1) this._zdur = 0;
      } else {
        this.zoom = M.smooth(this.zoom, this.tzoom, 6, dt);
      }
      this.x = M.smooth(this.x, this.tx, 8, dt);
      this.y = M.smooth(this.y, this.ty, 8, dt);

      this.trauma = Math.max(0, this.trauma - 1.5 * dt);
      var s = this.trauma * this.trauma;
      var t = NA.Time.real * 26;
      this.shakeX = M.noise1(t) * 8 * s;
      this.shakeY = M.noise1(t + 137.3) * 8 * s;
      this.shakeRot = M.noise1(t + 411.7) * 0.0105 * s;

      // never let the view cross the membrane by more than a hair
      if (NA.Arena) {
        var vw = NA.C.VIEW_W / this.zoom * 0.5, vh = vw * (R.h / Math.max(1, R.w));
        var lim = NA.Arena.radius - Math.min(vw, vh) * 0.15;
        var dx = this.x - NA.Arena.cx, dy = this.y - NA.Arena.cy, d = Math.sqrt(dx * dx + dy * dy);
        if (lim > 0 && d > lim) { this.x = NA.Arena.cx + dx / d * lim; this.y = NA.Arena.cy + dy / d * lim; }
      }
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
  var LAYER_ADD = [0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0];   // 1 = additive blending
  var LAYER_NAME = ['backdrop', 'floor', 'membrane', 'particles', 'ebullets', 'enemies', 'pbullets', 'player', 'veil', 'after', 'hud', 'screen'];

  var LINE_INK = 0.055;                       // half-thickness of the baked line glyph
  var LINE_SY = Atlas.INSET / (4 * LINE_INK);  // world width -> cell height

  var R = NA.R = {
    L: L, LAYER_NAME: LAYER_NAME,
    gl: null, canvas: null, ui: null, uictx: null,
    w: 1600, h: 900, dpr: 1, mode: 'none',
    quality: 3, particleCap: 2000, resScale: 1,
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
      if (a <= 0.002) return;
      var c = R.count[layer];
      if (c >= LAYER_CAP[layer]) return;
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
    /* The line glyph's ink is only 11% of its cell in y (the rest is glow), so
     * the requested width is converted to a cell height that puts exactly `w`
     * world units of ink on screen. */
    line: function (layer, x1, y1, x2, y2, w, r, g, b, a) {
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.0001) return;
      R.sprite(layer, 'line', (x1 + x2) * 0.5, (y1 + y2) * 0.5, Math.atan2(dy, dx),
        len * 0.5, w * LINE_SY, r, g, b, a);
    },
    ring: function (layer, x, y, radius, width, r, g, b, a) {
      var id = (width / Math.max(1, radius) > 0.07) ? 'ringT' : 'ring';
      R.sprite(layer, id, x, y, 0, radius, radius, r, g, b, a);
    },
    softRing: function (layer, x, y, radius, r, g, b, a) {
      R.sprite(layer, 'ringSoft', x, y, 0, radius, radius, r, g, b, a);
    },
    disc: function (layer, x, y, radius, r, g, b, a) {
      R.sprite(layer, 'disc', x, y, 0, radius, radius, r, g, b, a);
    },
    dot: function (layer, x, y, radius, r, g, b, a) {
      R.sprite(layer, 'dot', x, y, 0, radius, radius, r, g, b, a);
    },
    poly: function (layer, x, y, radius, sides, rot, width, r, g, b, a) {
      if (sides >= 3 && sides <= 8) { R.sprite(layer, 'p' + sides, x, y, rot, radius, radius, r, g, b, a); return; }
      var px = x + Math.cos(rot) * radius, py = y + Math.sin(rot) * radius;
      for (var i = 1; i <= sides; i++) {
        var ang = rot + i / sides * M.TAU;
        var nx = x + Math.cos(ang) * radius, ny = y + Math.sin(ang) * radius;
        R.line(layer, px, py, nx, ny, width, r, g, b, a);
        px = nx; py = ny;
      }
    },
    polyFill: function (layer, x, y, radius, sides, rot, r, g, b, a) {
      if (sides >= 3 && sides <= 8) R.sprite(layer, 'f' + sides, x, y, rot, radius, radius, r, g, b, a);
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

    if (gl) { R.gl = gl; R.mode = 'gl'; initGL(gl); }
    else { R.mode = '2d'; R.ctx2d = glCanvas.getContext('2d'); R.particleCap = 500; R.quality = 1; }

    if (uiCanvas) R.uictx = uiCanvas.getContext('2d');
    R.resize();
    window.addEventListener('resize', R.resize);
    return R;
  };

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
  };

  function postActive() {
    var p = R.post;
    if (R.quality < 1) return false;
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
  function flush2D() {
    var ctx = R.ctx2d;
    if (!ctx) return;
    var pw = R.canvas.width, ph = R.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var v = NA.C.COL.void;
    ctx.fillStyle = 'rgb(' + (v[0] * 255 | 0) + ',' + (v[1] * 255 | 0) + ',' + (v[2] * 255 | 0) + ')';
    ctx.fillRect(0, 0, pw, ph);

    for (var li = 0; li < LAYER_CAP.length; li++) {
      var n = R.count[li]; if (!n) continue;
      var f = R.buf[li], kinds = R.kinds[li];
      var screen = (li === L.SCREEN);
      var vw = screen ? R.w : Cam.viewW(), vh = screen ? R.h : Cam.viewH();
      var cx = screen ? R.w * 0.5 : Cam.x + Cam.shakeX, cy = screen ? R.h * 0.5 : Cam.y + Cam.shakeY;
      var scale = pw / vw;
      ctx.globalCompositeOperation = LAYER_ADD[li] ? 'lighter' : 'source-over';
      for (var i = 0; i < n; i++) {
        var o = i * FLOATS;
        var a = f[o + 8]; if (a <= 0.01) continue;
        var e = Atlas.list[kinds[i]]; if (!e) continue;
        var sx = f[o + 3] / (e.k * 2), sy = f[o + 4] / (e.k * 2);
        if (sx * scale < 0.35 && sy * scale < 0.35) continue;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate((f[o] - cx) * scale + pw * 0.5, (f[o + 1] - cy) * (ph / vh) + ph * 0.5);
        ctx.rotate(f[o + 2]);
        var cellScale = (sx * scale) / (e.size * Atlas.INSET);
        var cellScaleY = (sy * (ph / vh)) / (e.size * Atlas.INSET);
        ctx.scale(cellScale, cellScaleY);
        ctx.globalAlpha = Math.min(1, a);
        var col = 'rgb(' + (f[o + 5] * 255 | 0) + ',' + (f[o + 6] * 255 | 0) + ',' + (f[o + 7] * 255 | 0) + ')';
        ctx.fillStyle = col; ctx.strokeStyle = col;
        try { e.draw(ctx, e.size); } catch (err) { }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    var p = R.post;
    if (p.flash > 0.003) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.5, p.flash) + ')';
      ctx.fillRect(0, 0, pw, ph);
    }
  }

  /* ------------------------------------------------------ quality governor */
  var frameHist = new Float32Array(120), fhI = 0, fhN = 0, holdT = 0;
  R.reportFrame = function (ms) {
    frameHist[fhI] = ms; fhI = (fhI + 1) % frameHist.length;
    if (fhN < frameHist.length) fhN++;
    var sum = 0, mx = 0;
    for (var i = 0; i < fhN; i++) { sum += frameHist[i]; if (frameHist[i] > mx) mx = frameHist[i]; }
    R.stats.avgMs = sum / fhN;
    R.stats.frameMs = ms;
    // cheap p95: sort a copy only every 30 frames
    if ((NA.Time.frames & 31) === 0 && fhN > 20) {
      var tmp = Array.prototype.slice.call(frameHist.subarray(0, fhN));
      tmp.sort(function (a, b) { return a - b; });
      R.stats.p95 = tmp[Math.min(tmp.length - 1, Math.floor(tmp.length * 0.95))];
    }
    holdT += ms / 1000;
    if (holdT < 1.2 || fhN < 40) return;           // hysteresis: never thrash tiers
    if (R.stats.avgMs > 21 && R.quality > 0) { R.setQuality(R.quality - 1); holdT = 0; }
    else if (R.stats.avgMs < 12.5 && R.quality < (NA.Store.settings.quality || 3)) { R.setQuality(R.quality + 1); holdT = 0; }
  };
  R.setQuality = function (q) {
    q = M.clamp(q | 0, 0, 3);
    if (R.mode === '2d') q = Math.min(q, 1);   // fallback path: glow off, particle cap 500
    if (q === R.quality) return;
    R.quality = q;
    R.particleCap = R.mode === '2d' ? 500 : [400, 900, 1500, 2000][q];
    var rs = [0.7, 0.85, 1, 1][q];
    if (rs !== R.resScale) { R.resScale = rs; R.resize(); }
  };
  R.setQualityHard = function (q) { NA.Store.settings.quality = q; R.quality = -1; R.setQuality(q); holdT = -1e9; };
})();

/* ===== 03_audio.js ===== */
/* =============================================================================
 * NOVA ARENA — 03_audio.js — NA.Audio
 * Procedural WebAudio: pooled SFX voices + a generative music engine.
 * No files, no fetch, no external assets. Loads standalone (guards every NA.*).
 *
 * PUBLIC API
 * ----------
 *   NA.Audio.init()                    create/resume the AudioContext (call on
 *                                      any user gesture; safe to call repeatedly)
 *   NA.Audio.enabled                   bool; false silences everything
 *   NA.Audio.ready                     bool; true once the context exists
 *   NA.Audio.ctx                       the AudioContext (null before init)
 *   NA.Audio.setVolumes({master, music, sfx})   each 0..1 (caller persists them)
 *   NA.Audio.getVolumes()              -> {master, music, sfx}
 *   NA.Audio.setListener(x, y)         world-space listener for pan/attenuation
 *   NA.Audio.setTimeScale(s)           global slow-mo: pitches SFX + music down
 *   NA.Audio.duck(db, ms)              duck the music bus by db for ms
 *   NA.Audio.suspend() / NA.Audio.resume()
 *   NA.Audio.voiceCount()              live voices (cap 24, oldest-steal)
 *
 *   NA.Audio.sfx(name, opts)           opts = {x, y, pitch, vol, n, tier, dur}
 *   NA.Audio.killCombo(n, opts)        convenience for sfx('killCombo',{n:n})
 *   NA.Audio.names                     array of every valid sfx name:
 *     shot shotHeavy rail kill killCombo hitEnemy hitPlayer dash graze wall
 *     manaFull manaDry spendActive explode lightning supernovaCharge supernova
 *     telegraph lock laser charge spawn bossIntro bossPhase bossDeath
 *     draftHover draftPick draftSkip waveClear death uiTick uiConfirm gate
 *
 *   NA.Audio.music.start() / .stop()
 *   NA.Audio.music.setMode(name)       dorian lydian phrygian aeolian
 *                                      mixolydian finale
 *   NA.Audio.music.mode                current mode name
 *   NA.Audio.music.setIntensity(0..1)  opens the highpass, fades in the arp
 *   NA.Audio.music.intensity
 *   NA.Audio.music.setBpm(n) / .bpm    default 120
 *   NA.Audio.music.beat                current quarter-note index (integer)
 *   NA.Audio.music.bar                 current bar index
 *   NA.Audio.music.onBeat(cb)          cb(beatIndex, timeSeconds); returns an
 *                                      unsubscribe function
 *   NA.Audio.music.setLowpass(0..1)    0 = open, 1 = muffled (low-HP effect)
 *   NA.Audio.music.stinger(name)       'waveClear' | 'bossDeath' | 'victory'
 *   NA.Audio.music.scaleFreq(deg, oct) current-mode scale degree -> Hz
 *
 * SIGNAL PATH
 *   sfx  -> [pan] -> sfxGain  ------\
 *   music -> hp -> lp -> duck -> musicGain -> preMaster -> compressor
 *                                          -> soft-clip -> masterGain -> out
 *   sends -> convolver (1.5s generated noise-decay IR) -> preMaster
 * ============================================================================= */
(function (global) {
  'use strict';

  var NA = global.NA = global.NA || {};

  // ---------------------------------------------------------------------------
  // Small utilities (self-contained; NA.M / NA.C may not exist yet)
  // ---------------------------------------------------------------------------
  var AC = global.AudioContext || global.webkitAudioContext || null;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------------------
  // Musical data. Each mode: a root note, a 7-note scale and a 4-block
  // chord-root progression (degrees into the scale). The kill-pop and every
  // melodic SFX read the *current* mode's scale, so combos always land in key.
  // ---------------------------------------------------------------------------
  var MODES = {
    dorian:     { root: 50, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 5, 4] },
    lydian:     { root: 53, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 4, 1, 4] },
    phrygian:   { root: 49, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 6] },
    aeolian:    { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 4] },
    mixolydian: { root: 48, scale: [0, 2, 4, 5, 7, 9, 10], prog: [0, 6, 3, 4] },
    // 'finale' is the same engine with an authentic cadence; on its last block
    // the bass drops out and the pad holds a resolving chord (see scheduleStep).
    finale:     { root: 48, scale: [0, 2, 4, 5, 7, 9, 11], prog: [3, 5, 4, 0], hold: true }
  };

  // 16th-note bass ostinato: 1 = accent, 0.6 = ghost, 0 = rest. Module-level
  // constants — the beat scheduler must never allocate.
  var BASS_PAT = [1, 0, 0.6, 0, 0, 0.6, 1, 0, 0, 0.6, 0, 0, 1, 0, 0.6, 0];
  var BASS_DEG = [0, 0, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 0, 4, 0];
  var ARP_DEG  = [0, 2, 4, 6, 4, 2, 0, 2, 4, 6, 7, 6, 4, 2, 4, 2];
  var PAD_DEGS = [0, 2, 4, 6];
  var RISE3    = [0, 2, 4];
  var RISE4    = [0, 2, 4, 7];
  var RESOLVE  = [0, 2, 4, 8];
  var DESCEND  = [7, 4, 2, 0];
  var VICTORY  = [0, 2, 4, 7, 9];
  var CHIME    = [0, 4, 7];

  var STEPS_PER_BAR = 16;
  var BARS_PER_BLOCK = 4;          // chord changes every 4 bars
  var LOOKAHEAD_MS = 25;           // Chris Wilson lookahead scheduler
  var SCHEDULE_AHEAD = 0.14;       // seconds of scheduling horizon
  var VOICE_CAP = 24;

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------
  var ctx = null;
  var master = null, preMaster = null, comp = null, shaper = null;
  var sfxGain = null, musicGain = null, duckGain = null;
  var revSend = null, revReturn = null, convolver = null;
  var musIn = null, musHP = null, musLP = null;

  var vol = { master: 0.8, music: 0.55, sfx: 0.9 };
  var listenerX = 0, listenerY = 0;
  var timeScale = 1, pitchScale = 1;

  var voices = [];                 // live voices
  var gainPool = [], filtPool = [], panPool = [];
  var noiseBufs = {};              // duration bucket -> AudioBuffer
  var lastShotAt = -1;             // voice limiter for 'shot'
  var listenersBound = false;

  var Audio = {
    enabled: true,
    ready: false,
    ctx: null,
    names: null,
    version: 1
  };

  // ===========================================================================
  // INIT / MASTER CHAIN
  // ===========================================================================

  /** Soft-clip curve (tanh-ish): tames stacked additive voices without fizz. */
  function softClipCurve(n) {
    var c = new Float32Array(n), i, x;
    for (i = 0; i < n; i++) {
      x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.6) * 0.92;
    }
    return c;
  }

  /** Harder curve for deliberately distorted sounds (player hit, supernova). */
  var hardCurve = (function () {
    var n = 512, c = new Float32Array(n), i, x;
    for (i = 0; i < n; i++) {
      x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 6) * 0.8;
    }
    return c;
  })();

  /** 1.5s exponential noise-decay impulse response — a gentle generic room. */
  function makeImpulse(seconds, decay) {
    var len = Math.max(1, (ctx.sampleRate * seconds) | 0);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate), ch, d, i, t;
    for (ch = 0; ch < 2; ch++) {
      d = buf.getChannelData(ch);
      for (i = 0; i < len; i++) {
        t = i / len;
        // short fade-in so the tail blooms instead of clicking in
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.005 ? t / 0.005 : 1);
      }
    }
    return buf;
  }

  /**
   * Create the context and the whole master chain. Safe to call any number of
   * times; also resumes a suspended context (browsers require a user gesture).
   */
  Audio.init = function () {
    if (!AC) return false;
    if (ctx) { tryResume(); return true; }
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }

    master = ctx.createGain();
    master.gain.value = vol.master;

    shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(1024);
    shaper.oversample = '2x';

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    preMaster = ctx.createGain();
    preMaster.gain.value = 0.9;

    preMaster.connect(comp);
    comp.connect(shaper);
    shaper.connect(master);
    master.connect(ctx.destination);

    // reverb bus
    convolver = ctx.createConvolver();
    try { convolver.buffer = makeImpulse(1.5, 2.6); } catch (e) { /* ignore */ }
    revSend = ctx.createGain(); revSend.gain.value = 1;
    revReturn = ctx.createGain(); revReturn.gain.value = 0.5;
    revSend.connect(convolver);
    convolver.connect(revReturn);
    revReturn.connect(preMaster);

    // sfx bus
    sfxGain = ctx.createGain();
    sfxGain.gain.value = vol.sfx;
    sfxGain.connect(preMaster);

    // music bus: layers -> musIn -> highpass -> lowpass -> duck -> musicGain
    musIn = ctx.createGain(); musIn.gain.value = 1;
    musHP = ctx.createBiquadFilter(); musHP.type = 'highpass'; musHP.frequency.value = 30; musHP.Q.value = 0.7;
    musLP = ctx.createBiquadFilter(); musLP.type = 'lowpass'; musLP.frequency.value = 18000; musLP.Q.value = 0.6;
    duckGain = ctx.createGain(); duckGain.gain.value = 1;
    musicGain = ctx.createGain(); musicGain.gain.value = vol.music;
    musIn.connect(musHP); musHP.connect(musLP); musLP.connect(duckGain);
    duckGain.connect(musicGain); musicGain.connect(preMaster);
    // a little of the music into the room as well
    var musRev = ctx.createGain(); musRev.gain.value = 0.16;
    duckGain.connect(musRev); musRev.connect(revSend);

    Audio.ctx = ctx;
    Audio.ready = true;
    bindLifecycle();
    tryResume();
    return true;
  };

  function tryResume() {
    if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
  }

  function bindLifecycle() {
    if (listenersBound || typeof document === 'undefined') return;
    listenersBound = true;
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) { try { ctx.suspend(); } catch (e) {} }
      else tryResume();
    });
  }

  // Auto-init on the first user gesture so callers that forget still get audio.
  if (typeof document !== 'undefined' && document.addEventListener) {
    (function () {
      var kick = function () { Audio.init(); };
      var evs = ['pointerdown', 'mousedown', 'touchstart', 'keydown'], i;
      for (i = 0; i < evs.length; i++) document.addEventListener(evs[i], kick, { passive: true });
    })();
  }

  Audio.suspend = function () { if (ctx) { try { ctx.suspend(); } catch (e) {} } };
  Audio.resume = function () { tryResume(); };

  Audio.setVolumes = function (v) {
    if (!v) return;
    if (typeof v.master === 'number') vol.master = clamp(v.master, 0, 1);
    if (typeof v.music === 'number') vol.music = clamp(v.music, 0, 1);
    if (typeof v.sfx === 'number') vol.sfx = clamp(v.sfx, 0, 1);
    if (!ctx) return;
    var t = ctx.currentTime;
    master.gain.setTargetAtTime(vol.master, t, 0.02);
    musicGain.gain.setTargetAtTime(vol.music, t, 0.02);
    sfxGain.gain.setTargetAtTime(vol.sfx, t, 0.02);
  };
  Audio.getVolumes = function () { return { master: vol.master, music: vol.music, sfx: vol.sfx }; };

  Audio.setListener = function (x, y) { listenerX = x || 0; listenerY = y || 0; };

  /** Global slow-mo. Pitch follows a soft curve so 0.1x is dark, not inaudible. */
  Audio.setTimeScale = function (s) {
    timeScale = clamp(s || 1, 0.02, 8);
    pitchScale = clamp(Math.pow(timeScale, 0.6), 0.3, 2);
  };
  Audio.getTimeScale = function () { return timeScale; };

  /** Duck the music bus by `db` for `ms`, then recover. */
  Audio.duck = function (db, ms) {
    if (!ctx || !duckGain) return;
    var amt = Math.pow(10, -Math.abs(db === undefined ? 6 : db) / 20);
    var t = ctx.currentTime;
    var hold = (ms || 300) / 1000;
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setValueAtTime(duckGain.gain.value, t);
    duckGain.gain.linearRampToValueAtTime(amt, t + 0.02);
    duckGain.gain.setValueAtTime(amt, t + hold * 0.5);
    duckGain.gain.linearRampToValueAtTime(1, t + hold);
  };

  Audio.voiceCount = function () { return voices.length; };

  // ===========================================================================
  // NODE POOLS + VOICE MANAGEMENT
  // Oscillators/BufferSources are one-shot by spec and cannot be reused, but
  // gains, filters and panners are recycled through free lists, so a busy frame
  // allocates almost nothing and nothing ever leaks: every voice is retired.
  // ===========================================================================

  function takeGain(v) {
    var g = gainPool.length ? gainPool.pop() : ctx.createGain();
    g.gain.cancelScheduledValues(0);
    g.gain.value = 0;
    v.g.push(g);
    return g;
  }
  function takeFilter(v, type, freq, q) {
    var f = filtPool.length ? filtPool.pop() : ctx.createBiquadFilter();
    f.type = type;
    f.frequency.cancelScheduledValues(0);
    f.frequency.value = freq;
    f.Q.cancelScheduledValues(0);
    f.Q.value = (q === undefined) ? 1 : q;
    f.gain.value = 0;
    v.f.push(f);
    return f;
  }
  function takePan(v) {
    if (!ctx.createStereoPanner) return null;
    var p = panPool.length ? panPool.pop() : ctx.createStereoPanner();
    p.pan.cancelScheduledValues(0);
    p.pan.value = 0;
    v.p.push(p);
    return p;
  }
  function takeOsc(v, type, freq, detune) {
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    v.s.push(o);
    return o;
  }
  /** Non-pooled helper node (delay, waveshaper): disconnected on voice death. */
  function keep(v, node) { v.x.push(node); return node; }

  /** Cached mono noise buffers, bucketed to 50ms so we build very few. */
  function noise(seconds) {
    var key = Math.max(1, Math.round(seconds * 20));
    var buf = noiseBufs[key];
    if (!buf) {
      var len = Math.max(64, ((key / 20) * ctx.sampleRate) | 0);
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBufs[key] = buf;
    }
    return buf;
  }
  function takeNoise(v, seconds, loop) {
    var s = ctx.createBufferSource();
    s.buffer = noise(seconds);
    if (loop) s.loop = true;
    v.s.push(s);
    return s;
  }

  function newVoice(endTime) {
    if (voices.length >= VOICE_CAP) {
      // steal the voice that ends soonest (the oldest / least important)
      var oldest = 0, i;
      for (i = 1; i < voices.length; i++) if (voices[i].end < voices[oldest].end) oldest = i;
      killVoice(voices[oldest], true);
    }
    var v = { end: endTime, s: [], g: [], f: [], p: [], x: [], dead: false, timer: 0 };
    voices.push(v);
    return v;
  }

  function killVoice(v, immediate) {
    if (v.dead) return;
    v.dead = true;
    if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
    var i, n, now = ctx ? ctx.currentTime : 0;
    for (i = 0; i < v.s.length; i++) {
      n = v.s[i];
      try { n.stop(immediate ? now + 0.01 : 0); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
      n.onended = null;
    }
    for (i = 0; i < v.g.length; i++) {
      n = v.g[i];
      try { n.disconnect(); } catch (e) {}
      try { n.gain.cancelScheduledValues(now); } catch (e) {}
      if (gainPool.length < 64) gainPool.push(n);
    }
    for (i = 0; i < v.f.length; i++) {
      n = v.f[i];
      try { n.disconnect(); } catch (e) {}
      try { n.frequency.cancelScheduledValues(now); n.Q.cancelScheduledValues(now); } catch (e) {}
      if (filtPool.length < 64) filtPool.push(n);
    }
    for (i = 0; i < v.p.length; i++) {
      n = v.p[i];
      try { n.disconnect(); } catch (e) {}
      try { n.pan.cancelScheduledValues(now); } catch (e) {}
      if (panPool.length < 32) panPool.push(n);
    }
    for (i = 0; i < v.x.length; i++) { try { v.x[i].disconnect(); } catch (e) {} }
    v.s.length = 0; v.g.length = 0; v.f.length = 0; v.p.length = 0; v.x.length = 0;
    var idx = voices.indexOf(v);
    if (idx >= 0) voices.splice(idx, 1);
  }

  /** Schedule the automatic release of a voice shortly after its tail ends. */
  function retire(v) {
    var ms = Math.max(30, (v.end - ctx.currentTime) * 1000 + 90);
    v.timer = setTimeout(function () { v.timer = 0; killVoice(v, false); }, ms);
  }

  /**
   * Build the per-sound input channel: gain -> [panner] -> out -> sfxGain,
   * plus a reverb send. Returns the gain node the generator writes into.
   */
  function channel(v, o, revAmt) {
    var g = takeGain(v);
    g.gain.value = 1;
    var amp = 1, pan = 0;
    if (o && typeof o.x === 'number' && typeof o.y === 'number') {
      var dx = o.x - listenerX, dy = o.y - listenerY;
      var d = Math.sqrt(dx * dx + dy * dy);
      amp = 1 / (1 + d / 700);                 // gentle distance attenuation
      pan = clamp(dx / 900, -1, 1) * 0.85;     // light stereo placement
    }
    amp *= (o && typeof o.vol === 'number') ? clamp(o.vol, 0, 4) : 1;
    var out = takeGain(v);
    out.gain.value = amp;
    var p = takePan(v);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(out); }
    else { g.connect(out); }
    out.connect(sfxGain);
    if (revAmt > 0) {
      var rs = takeGain(v);
      rs.gain.value = revAmt;
      out.connect(rs); rs.connect(revSend);
    }
    return g;
  }

  /** Envelope helper: attack to peak, then an exponential fall to silence. */
  function env(g, t, attack, decay, peak) {
    var p = Math.max(0.0001, peak);
    var a = Math.max(0.0005, attack);
    var d = Math.max(0.01, decay);
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(p, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return t + a + d;
  }

  // ===========================================================================
  // SFX DEFINITIONS
  // Each generator: fn(t, ch, o, v, P) where
  //   t = start time, ch = channel input gain, o = options, v = voice,
  //   P = pitch multiplier (opts.pitch * global time-scale pitch)
  // and returns the absolute end time of its tail.
  // ===========================================================================
  var SFX = {};

  // --- weapons ---------------------------------------------------------------
  SFX.shot = function (t, ch, o, v, P) {
    var f0 = 620 * P * rnd(0.97, 1.03);        // +/-3% random detune per shot
    var osc = takeOsc(v, 'sawtooth', f0);
    var lp = takeFilter(v, 'lowpass', 3200 * P, 4);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.02); // 20ms drop
    lp.frequency.setValueAtTime(3200 * P, t);
    lp.frequency.exponentialRampToValueAtTime(900 * P, t + 0.06);
    osc.connect(lp); lp.connect(g); g.connect(ch);
    var end = env(g, t, 0.001, 0.07, 0.5);
    osc.start(t); osc.stop(end + 0.02);
    return end;
  };

  SFX.shotHeavy = function (t, ch, o, v, P) {
    var f0 = 260 * P * rnd(0.97, 1.03);
    var osc = takeOsc(v, 'sawtooth', f0);
    var sub = takeOsc(v, 'square', f0 * 0.5);
    var lp = takeFilter(v, 'lowpass', 2200 * P, 6);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.05);
    sub.frequency.setValueAtTime(f0 * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(f0 * 0.25, t + 0.08);
    lp.frequency.setValueAtTime(2200 * P, t);
    lp.frequency.exponentialRampToValueAtTime(400 * P, t + 0.14);
    osc.connect(lp); sub.connect(lp); lp.connect(g); g.connect(ch);
    var end = env(g, t, 0.002, 0.18, 0.62);
    osc.start(t); osc.stop(end + 0.02);
    sub.start(t); sub.stop(end + 0.02);
    return end;
  };

  SFX.rail = function (t, ch, o, v, P) {
    // charged whoosh (bandpass noise sweeping up) then a bright crack
    var n = takeNoise(v, 0.5, true);
    var bp = takeFilter(v, 'bandpass', 300 * P, 6);
    var ng = takeGain(v);
    bp.frequency.setValueAtTime(300 * P, t);
    bp.frequency.exponentialRampToValueAtTime(4200 * P, t + 0.22);
    n.connect(bp); bp.connect(ng); ng.connect(ch);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.35, t + 0.2);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    n.start(t); n.stop(t + 0.36);

    var ct = t + 0.2;
    var crack = takeNoise(v, 0.15);
    var hp = takeFilter(v, 'highpass', 1200 * P, 1);
    var cg = takeGain(v);
    crack.connect(hp); hp.connect(cg); cg.connect(ch);
    env(cg, ct, 0.001, 0.12, 0.7);
    crack.start(ct); crack.stop(ct + 0.16);

    var body = takeOsc(v, 'triangle', 900 * P);
    var bg = takeGain(v);
    body.frequency.setValueAtTime(900 * P, ct);
    body.frequency.exponentialRampToValueAtTime(120 * P, ct + 0.18);
    body.connect(bg); bg.connect(ch);
    env(bg, ct, 0.001, 0.2, 0.4);
    body.start(ct); body.stop(ct + 0.24);
    return ct + 0.26;
  };

  SFX.laser = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 0.5;
    var a = takeOsc(v, 'sawtooth', 180 * P);
    var b = takeOsc(v, 'square', 181.5 * P);
    var bp = takeFilter(v, 'bandpass', 900 * P, 3);
    var g = takeGain(v);
    a.connect(bp); b.connect(bp); bp.connect(g); g.connect(ch);
    bp.frequency.setValueAtTime(900 * P, t);
    bp.frequency.linearRampToValueAtTime(2200 * P, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.03);
    g.gain.setValueAtTime(0.3, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    a.start(t); a.stop(t + dur + 0.02);
    b.start(t); b.stop(t + dur + 0.02);
    return t + dur;
  };

  // --- impacts ---------------------------------------------------------------
  SFX.hitEnemy = function (t, ch, o, v, P) {
    // 2ms click: a single short noise grain through a bright bandpass
    var n = takeNoise(v, 0.05);
    var bp = takeFilter(v, 'bandpass', 2600 * P, 1.2);
    var g = takeGain(v);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.start(t); n.stop(t + 0.03);
    return t + 0.03;
  };

  SFX.hitPlayer = function (t, ch, o, v, P) {
    Audio.duck(6, 300);                            // music ducks 6dB for 300ms
    var sq = takeOsc(v, 'square', 320 * P);
    var dist = keep(v, ctx.createWaveShaper());
    dist.curve = hardCurve;
    var lp = takeFilter(v, 'lowpass', 1800 * P, 2);
    var g = takeGain(v);
    sq.frequency.setValueAtTime(320 * P, t);
    sq.frequency.exponentialRampToValueAtTime(60 * P, t + 0.2);   // 200ms ramp
    sq.connect(dist); dist.connect(lp); lp.connect(g); g.connect(ch);
    var end = env(g, t, 0.002, 0.22, 0.55);
    sq.start(t); sq.stop(end + 0.02);

    var sub = takeOsc(v, 'sine', 110 * P);         // sub thump
    var sg = takeGain(v);
    sub.frequency.setValueAtTime(110 * P, t);
    sub.frequency.exponentialRampToValueAtTime(38 * P, t + 0.3);
    sub.connect(sg); sg.connect(ch);
    env(sg, t, 0.004, 0.4, 0.85);
    sub.start(t); sub.stop(t + 0.46);
    return t + 0.46;
  };

  SFX.graze = function (t, ch, o, v, P) {
    var osc = takeOsc(v, 'sine', 3200 * P * rnd(0.96, 1.05));
    var g = takeGain(v);
    osc.connect(g); g.connect(ch);
    var end = env(g, t, 0.001, 0.05, 0.18);
    osc.start(t); osc.stop(end + 0.01);
    return end;
  };

  SFX.wall = function (t, ch, o, v, P) {
    // Karplus-Strong-ish pluck: a noise burst into a feedback delay whose loop
    // time sets the pitch, with a lowpass in the loop shaping the decay.
    var f = 220 * P * rnd(0.95, 1.06);
    var delay = keep(v, ctx.createDelay(0.05));
    delay.delayTime.value = 1 / f;
    var fb = takeGain(v); fb.gain.value = 0.86;
    var damp = takeFilter(v, 'lowpass', 2400, 0.7);
    var g = takeGain(v);
    var n = takeNoise(v, 0.05);
    var ng = takeGain(v);
    n.connect(ng); ng.connect(delay);
    delay.connect(damp); damp.connect(fb); fb.connect(delay);
    damp.connect(g); g.connect(ch);
    ng.gain.setValueAtTime(0.7, t);
    ng.gain.setValueAtTime(0, t + 1 / f);
    g.gain.setValueAtTime(0.6, t);
    g.gain.setTargetAtTime(0.0001, t + 0.05, 0.16);
    n.start(t); n.stop(t + 0.05);
    return t + 0.7;
  };

  // --- kills -----------------------------------------------------------------
  /** Shared kill body; `step` climbs the current scale for combos (0..8). */
  function killBody(t, ch, o, v, P, step) {
    // white-noise burst swept 4k -> 200Hz over 80ms
    var n = takeNoise(v, 0.2);
    var lp = takeFilter(v, 'lowpass', 4000 * P, 3);
    var ng = takeGain(v);
    lp.frequency.setValueAtTime(4000 * P, t);
    lp.frequency.exponentialRampToValueAtTime(200 * P, t + 0.08);
    n.connect(lp); lp.connect(ng); ng.connect(ch);
    env(ng, t, 0.001, 0.13, 0.42);
    n.start(t); n.stop(t + 0.16);

    // sine pop on a note of the current scale; combos climb it
    var f = music.scaleFreq(4 + (step | 0), 1) * P;
    var pop = takeOsc(v, 'sine', f);
    var pg = takeGain(v);
    pop.frequency.setValueAtTime(f * 1.02, t);
    pop.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    pop.connect(pg); pg.connect(ch);
    env(pg, t, 0.002, 0.16 + step * 0.01, 0.3 + step * 0.02);
    pop.start(t); pop.stop(t + 0.3 + step * 0.01);
    return t + 0.32;
  }
  SFX.kill = function (t, ch, o, v, P) { return killBody(t, ch, o, v, P, 0); };
  SFX.killCombo = function (t, ch, o, v, P) {
    var n = (o && typeof o.n === 'number') ? o.n : 1;
    return killBody(t, ch, o, v, P, clamp(n | 0, 0, 8));
  };

  SFX.explode = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.6);
    var lp = takeFilter(v, 'lowpass', 1800 * P, 1.2);
    var ng = takeGain(v);
    lp.frequency.setValueAtTime(1800 * P, t);
    lp.frequency.exponentialRampToValueAtTime(160 * P, t + 0.45);
    n.connect(lp); lp.connect(ng); ng.connect(ch);
    env(ng, t, 0.003, 0.5, 0.5);
    n.start(t); n.stop(t + 0.56);

    var boom = takeOsc(v, 'sine', 150 * P);
    var bg = takeGain(v);
    boom.frequency.setValueAtTime(150 * P, t);
    boom.frequency.exponentialRampToValueAtTime(38 * P, t + 0.4);
    boom.connect(bg); bg.connect(ch);
    env(bg, t, 0.004, 0.5, 0.8);
    boom.start(t); boom.stop(t + 0.56);
    return t + 0.56;
  };

  SFX.lightning = function (t, ch, o, v, P) {
    // a 5ms impulse thrown into the reverb: the tail *is* the sound
    var n = takeNoise(v, 0.05);
    var hp = takeFilter(v, 'highpass', 1800 * P, 0.9);
    var g = takeGain(v);
    n.connect(hp); hp.connect(g); g.connect(ch);
    var send = takeGain(v); send.gain.value = 1.2;
    g.connect(send); send.connect(revSend);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.005);
    n.start(t); n.stop(t + 0.02);
    return t + 0.05;
  };

  // --- movement / mana -------------------------------------------------------
  SFX.dash = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.4, true);
    var bp = takeFilter(v, 'bandpass', 400 * P, 3.5);
    var g = takeGain(v);
    bp.frequency.setValueAtTime(400 * P, t);
    bp.frequency.exponentialRampToValueAtTime(3000 * P, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(500 * P, t + 0.3);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.start(t); n.stop(t + 0.32);
    return t + 0.32;
  };

  SFX.manaFull = function (t, ch, o, v, P) {
    // soft bloom chime: root / fifth / octave with slow attacks
    var i, f, osc, g;
    for (i = 0; i < CHIME.length; i++) {
      f = music.scaleFreq(CHIME[i], 2) * P;
      osc = takeOsc(v, 'sine', f);
      g = takeGain(v);
      osc.connect(g); g.connect(ch);
      env(g, t + i * 0.03, 0.06, 0.7, 0.16);
      osc.start(t); osc.stop(t + 0.95);
    }
    return t + 0.95;
  };

  SFX.manaDry = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.05);
    var bp = takeFilter(v, 'bandpass', 900 * P, 6);
    var g = takeGain(v);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    n.start(t); n.stop(t + 0.05);
    return t + 0.06;
  };

  SFX.spendActive = function (t, ch, o, v, P) {
    var f = music.scaleFreq(2, 1) * P;
    var osc = takeOsc(v, 'triangle', f * 1.5);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    osc.connect(g); g.connect(ch);
    env(g, t, 0.004, 0.22, 0.3);
    osc.start(t); osc.stop(t + 0.32);

    var n = takeNoise(v, 0.15);
    var hp = takeFilter(v, 'highpass', 2200 * P, 1);
    var ng = takeGain(v);
    n.connect(hp); hp.connect(ng); ng.connect(ch);
    env(ng, t, 0.002, 0.1, 0.18);
    n.start(t); n.stop(t + 0.16);
    return t + 0.32;
  };

  // --- supernova (two names, charge then blast) ------------------------------
  SFX.supernovaCharge = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 3.0;
    var a = takeOsc(v, 'sine', 80 * P);
    var b = takeOsc(v, 'sine', 80.6 * P);
    var g = takeGain(v);
    a.frequency.setValueAtTime(80 * P, t);
    a.frequency.exponentialRampToValueAtTime(900 * P, t + dur);
    b.frequency.setValueAtTime(80.6 * P, t);
    b.frequency.exponentialRampToValueAtTime(906 * P, t + dur);
    a.connect(g); b.connect(g); g.connect(ch);
    var send = takeGain(v); send.gain.value = 0.5;
    g.connect(send); send.connect(revSend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + dur * 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    a.start(t); a.stop(t + dur + 0.05);
    b.start(t); b.stop(t + dur + 0.05);
    return t + dur;
  };

  SFX.supernova = function (t, ch, o, v, P) {
    // crushed noise crash + a body boom
    var n = takeNoise(v, 1.2);
    var dist = keep(v, ctx.createWaveShaper());
    dist.curve = hardCurve;
    var lp = takeFilter(v, 'lowpass', 6000 * P, 0.8);
    var g = takeGain(v);
    lp.frequency.setValueAtTime(6000 * P, t);
    lp.frequency.exponentialRampToValueAtTime(200 * P, t + 1.1);
    n.connect(dist); dist.connect(lp); lp.connect(g); g.connect(ch);
    var send = takeGain(v); send.gain.value = 0.7;
    g.connect(send); send.connect(revSend);
    env(g, t, 0.003, 1.2, 0.7);
    n.start(t); n.stop(t + 1.3);

    var boom = takeOsc(v, 'sine', 90 * P);
    var bg = takeGain(v);
    boom.frequency.setValueAtTime(90 * P, t);
    boom.frequency.exponentialRampToValueAtTime(28 * P, t + 0.9);
    boom.connect(bg); bg.connect(ch);
    env(bg, t, 0.005, 1.1, 0.9);
    boom.start(t); boom.stop(t + 1.3);
    Audio.duck(5, 700);
    return t + 1.35;
  };

  // --- telegraphs / states ---------------------------------------------------
  SFX.telegraph = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 0.4;
    var f = music.scaleFreq(0, 1) * P;
    var osc = takeOsc(v, 'triangle', f);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 2, t + dur);
    osc.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
    return t + dur;
  };

  SFX.lock = function (t, ch, o, v, P) {
    var osc = takeOsc(v, 'square', 1400 * P);
    var bp = takeFilter(v, 'bandpass', 1600 * P, 8);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(1400 * P, t);
    osc.frequency.exponentialRampToValueAtTime(500 * P, t + 0.05);
    osc.connect(bp); bp.connect(g); g.connect(ch);
    env(g, t, 0.001, 0.07, 0.4);
    osc.start(t); osc.stop(t + 0.12);
    return t + 0.12;
  };

  SFX.charge = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 0.8;
    var n = takeNoise(v, 0.5, true);
    var lp = takeFilter(v, 'lowpass', 90 * P, 4);
    var g = takeGain(v);
    n.connect(lp); lp.connect(g); g.connect(ch);
    lp.frequency.setValueAtTime(90 * P, t);
    lp.frequency.linearRampToValueAtTime(260 * P, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.start(t); n.stop(t + dur + 0.02);
    return t + dur;
  };

  SFX.spawn = function (t, ch, o, v, P) {
    // "print" sound: soft filtered noise rising, with a quiet pitched shimmer
    var n = takeNoise(v, 0.3);
    var bp = takeFilter(v, 'bandpass', 400 * P, 2);
    var g = takeGain(v);
    bp.frequency.setValueAtTime(400 * P, t);
    bp.frequency.exponentialRampToValueAtTime(1800 * P, t + 0.22);
    n.connect(bp); bp.connect(g); g.connect(ch);
    env(g, t, 0.03, 0.2, 0.2);
    n.start(t); n.stop(t + 0.3);

    var f = music.scaleFreq(4, 2) * P;
    var osc = takeOsc(v, 'sine', f);
    var og = takeGain(v);
    osc.connect(og); og.connect(ch);
    env(og, t + 0.05, 0.02, 0.18, 0.1);
    osc.start(t); osc.stop(t + 0.32);
    return t + 0.32;
  };

  SFX.gate = function (t, ch, o, v, P) {
    // whoosh through a ring: a noise sweep plus a resonant ring tone
    var n = takeNoise(v, 0.6, true);
    var bp = takeFilter(v, 'bandpass', 250 * P, 2);
    var g = takeGain(v);
    bp.frequency.setValueAtTime(250 * P, t);
    bp.frequency.exponentialRampToValueAtTime(2600 * P, t + 0.35);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.start(t); n.stop(t + 0.52);

    var f = music.scaleFreq(4, 1) * P;
    var ring = takeOsc(v, 'sine', f);
    var rg = takeGain(v);
    ring.connect(rg); rg.connect(ch);
    var send = takeGain(v); send.gain.value = 0.6;
    rg.connect(send); send.connect(revSend);
    env(rg, t + 0.1, 0.02, 0.8, 0.22);
    ring.start(t + 0.1); ring.stop(t + 1.05);
    return t + 1.05;
  };

  // --- bosses ----------------------------------------------------------------
  SFX.bossIntro = function (t, ch, o, v, P) {
    var f = music.scaleFreq(0, -2) * P;
    var a = takeOsc(v, 'sawtooth', f);
    var b = takeOsc(v, 'sine', f * 0.5);
    var lp = takeFilter(v, 'lowpass', 220 * P, 3);
    var g = takeGain(v);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.8);
    g.gain.setValueAtTime(0.55, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    a.start(t); a.stop(t + 2.3);
    b.start(t); b.stop(t + 2.3);

    var ht = t + 1.4;                        // the hit that lands the drone
    var n = takeNoise(v, 0.6);
    var nlp = takeFilter(v, 'lowpass', 1600 * P, 1);
    var ng = takeGain(v);
    nlp.frequency.setValueAtTime(1600 * P, ht);
    nlp.frequency.exponentialRampToValueAtTime(120 * P, ht + 0.5);
    n.connect(nlp); nlp.connect(ng); ng.connect(ch);
    env(ng, ht, 0.002, 0.6, 0.6);
    n.start(ht); n.stop(ht + 0.7);
    Audio.duck(4, 900);
    return t + 2.3;
  };

  SFX.bossPhase = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.4);
    var lp = takeFilter(v, 'lowpass', 1400 * P, 1);
    var g = takeGain(v);
    n.connect(lp); lp.connect(g); g.connect(ch);
    lp.frequency.setValueAtTime(1400 * P, t);
    lp.frequency.exponentialRampToValueAtTime(120 * P, t + 0.35);
    env(g, t, 0.002, 0.4, 0.6);
    n.start(t); n.stop(t + 0.46);

    var riser = takeNoise(v, 0.5, true);     // riser after the impact
    var bp = takeFilter(v, 'bandpass', 300 * P, 4);
    var rg = takeGain(v);
    riser.connect(bp); bp.connect(rg); rg.connect(ch);
    bp.frequency.setValueAtTime(300 * P, t + 0.05);
    bp.frequency.exponentialRampToValueAtTime(4000 * P, t + 1.0);
    rg.gain.setValueAtTime(0.0001, t + 0.05);
    rg.gain.linearRampToValueAtTime(0.3, t + 0.9);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    riser.start(t + 0.05); riser.stop(t + 1.08);
    Audio.duck(4, 500);
    return t + 1.1;
  };

  SFX.bossDeath = function (t, ch, o, v, P) {
    var boom = takeOsc(v, 'sine', 110 * P);
    var g = takeGain(v);
    boom.frequency.setValueAtTime(110 * P, t);
    boom.frequency.exponentialRampToValueAtTime(22 * P, t + 1.6);
    boom.connect(g); g.connect(ch);
    env(g, t, 0.006, 2.2, 1.0);
    boom.start(t); boom.stop(t + 2.4);

    var n = takeNoise(v, 1.5);
    var lp = takeFilter(v, 'lowpass', 5000 * P, 0.8);
    var ng = takeGain(v);
    lp.frequency.setValueAtTime(5000 * P, t);
    lp.frequency.exponentialRampToValueAtTime(120 * P, t + 1.8);
    n.connect(lp); lp.connect(ng); ng.connect(ch);
    var send = takeGain(v); send.gain.value = 0.8;
    ng.connect(send); send.connect(revSend);
    env(ng, t, 0.004, 2.0, 0.6);
    n.start(t); n.stop(t + 2.2);
    Audio.duck(6, 1200);
    return t + 2.45;
  };

  // --- UI / draft ------------------------------------------------------------
  SFX.draftHover = function (t, ch, o, v, P) {
    // "assemble" tick
    var osc = takeOsc(v, 'square', 1800 * P);
    var bp = takeFilter(v, 'bandpass', 2000 * P, 10);
    var g = takeGain(v);
    osc.connect(bp); bp.connect(g); g.connect(ch);
    env(g, t, 0.001, 0.04, 0.2);
    osc.start(t); osc.stop(t + 0.07);
    return t + 0.07;
  };

  SFX.draftPick = function (t, ch, o, v, P) {
    // rising chord; a higher tier gets a higher, richer voicing
    var tier = clamp((((o && o.tier) || 1) | 0), 1, 3);
    var oct = tier - 1;
    var degs = (tier >= 3) ? RISE4 : RISE3;
    for (var i = 0; i < degs.length; i++) {
      var f = music.scaleFreq(degs[i], oct) * P;
      var osc = takeOsc(v, i === 0 ? 'triangle' : 'sine', f);
      var g = takeGain(v);
      osc.connect(g); g.connect(ch);
      env(g, t + i * 0.055, 0.01, 0.5 + i * 0.05, 0.22);
      osc.start(t + i * 0.055); osc.stop(t + i * 0.055 + 0.75);
    }
    return t + degs.length * 0.055 + 0.75;
  };

  SFX.draftSkip = function (t, ch, o, v, P) {
    var f0 = music.scaleFreq(2, 0) * P;
    var osc = takeOsc(v, 'triangle', f0);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(music.scaleFreq(0, -1) * P, t + 0.18);
    osc.connect(g); g.connect(ch);
    env(g, t, 0.003, 0.2, 0.22);
    osc.start(t); osc.stop(t + 0.28);
    return t + 0.28;
  };

  SFX.waveClear = function (t, ch, o, v, P) {
    // bright resolve chord (I add9)
    for (var i = 0; i < RESOLVE.length; i++) {
      var f = music.scaleFreq(RESOLVE[i], 1) * P;
      var osc = takeOsc(v, 'sine', f);
      var g = takeGain(v);
      osc.connect(g); g.connect(ch);
      var send = takeGain(v); send.gain.value = 0.4;
      g.connect(send); send.connect(revSend);
      env(g, t + i * 0.02, 0.02, 1.1, 0.2);
      osc.start(t); osc.stop(t + 1.35);
    }
    return t + 1.35;
  };

  SFX.death = function (t, ch, o, v, P) {
    // the draft chord in reverse: descending and darkening
    for (var i = 0; i < DESCEND.length; i++) {
      var st = t + i * 0.12;
      var f = music.scaleFreq(DESCEND[i], 0) * P;
      var osc = takeOsc(v, i === 0 ? 'sine' : 'triangle', f);
      var lp = takeFilter(v, 'lowpass', 2200 * P, 0.8);
      var g = takeGain(v);
      osc.connect(lp); lp.connect(g); g.connect(ch);
      lp.frequency.setValueAtTime(2200 * P, st);
      lp.frequency.exponentialRampToValueAtTime(400 * P, st + 1.0);
      env(g, st, 0.02, 1.2, 0.24);
      osc.start(st); osc.stop(st + 1.45);
    }
    Audio.duck(8, 1600);
    return t + 1.9;
  };

  SFX.uiTick = function (t, ch, o, v, P) {
    var osc = takeOsc(v, 'sine', 2200 * P);
    var g = takeGain(v);
    osc.connect(g); g.connect(ch);
    env(g, t, 0.001, 0.03, 0.14);
    osc.start(t); osc.stop(t + 0.06);
    return t + 0.06;
  };

  SFX.uiConfirm = function (t, ch, o, v, P) {
    var f = music.scaleFreq(0, 1) * P;
    var a = takeOsc(v, 'sine', f);
    var b = takeOsc(v, 'sine', f * 1.5);
    var g = takeGain(v);
    a.connect(g); b.connect(g); g.connect(ch);
    env(g, t, 0.003, 0.22, 0.2);
    a.start(t); a.stop(t + 0.32);
    b.start(t + 0.05); b.stop(t + 0.32);
    return t + 0.32;
  };

  Audio.names = Object.keys(SFX);

  // ===========================================================================
  // SFX ENTRY POINT
  // ===========================================================================
  var EMPTY = {};

  /**
   * Play a sound. Unknown names are ignored. Options:
   *   x, y   world position -> stereo pan + distance attenuation
   *   pitch  multiplier (default 1)
   *   vol    multiplier (default 1)
   *   n      combo step 0..8 for killCombo
   *   tier   1..3 for draftPick
   *   dur    length hint for sustained sounds (laser, charge, telegraph, ...)
   */
  Audio.sfx = function (name, opts) {
    if (!Audio.enabled || !ctx || ctx.state === 'closed') return;
    var gen = SFX[name];
    if (!gen) return;
    if (typeof opts === 'number') opts = { n: opts };   // sfx('killCombo', 3)

    var now = ctx.currentTime;

    // Voice limiter: at most one player shot per 30ms; extras are dropped.
    if (name === 'shot') {
      if (now - lastShotAt < 0.03) return;
      lastShotAt = now;
    }

    var P = pitchScale * ((opts && typeof opts.pitch === 'number') ? opts.pitch : 1);
    var v = newVoice(now + 0.5);
    var rev = (name === 'kill' || name === 'killCombo') ? 0.12 : 0.06;
    var ch = channel(v, opts, rev);
    var end;
    try {
      end = gen(now + 0.002, ch, opts || EMPTY, v, P);
    } catch (e) {
      killVoice(v, true);
      return;
    }
    v.end = end || (now + 0.4);
    retire(v);
  };

  /** Convenience: NA.Audio.killCombo(3) — combo pop n steps up the scale. */
  Audio.killCombo = function (n, opts) {
    opts = opts || {};
    opts.n = clamp(n | 0, 0, 8);
    Audio.sfx('killCombo', opts);
  };

  // ===========================================================================
  // MUSIC — generative, lookahead-scheduled (Chris Wilson pattern)
  // ===========================================================================
  var music = {
    bpm: 120,
    beat: 0,
    bar: 0,
    mode: 'dorian',
    intensity: 0,
    playing: false
  };

  var mStep = 0;                 // absolute 16th-note index
  var mNextTime = 0;             // ctx time of the next 16th
  var mTimer = null;
  var beatCbs = [];
  var lowpassAmt = 0;
  var padGain = null, bassGain = null, arpGain = null;
  var lastChordBlock = -1;
  var curChordRoot = 0;

  function modeDef() { return MODES[music.mode] || MODES.dorian; }

  /**
   * Scale degree -> frequency in the current mode. `deg` may run past the end of
   * the scale (it wraps with an octave carry) and may be negative; `oct` adds
   * whole octaves. Every melodic SFX uses this, so nothing is ever out of key.
   */
  music.scaleFreq = function (deg, oct) {
    var m = modeDef(), sc = m.scale, n = sc.length;
    deg = deg | 0;
    var o = Math.floor(deg / n);
    var i = deg - o * n;
    return mtof(m.root + (o + (oct || 0)) * 12 + sc[i]);
  };

  function ensureMusicNodes() {
    if (padGain || !ctx) return;
    padGain = ctx.createGain(); padGain.gain.value = 0.5; padGain.connect(musIn);
    bassGain = ctx.createGain(); bassGain.gain.value = 0.75; bassGain.connect(musIn);
    arpGain = ctx.createGain(); arpGain.gain.value = 0; arpGain.connect(musIn);
  }

  music.setBpm = function (n) { music.bpm = clamp(n || 120, 30, 300); };

  music.setMode = function (name) {
    if (!MODES[name] || name === music.mode) return;
    music.mode = name;
    lastChordBlock = -1;          // force a fresh pad chord at the next block
  };

  music.setIntensity = function (v) {
    music.intensity = clamp(v || 0, 0, 1);
    if (!ctx) return;
    ensureMusicNodes();
    var t = ctx.currentTime;
    // "Opens" the mix: the highpass climbs so the low mud clears and the track
    // reads as more urgent, while the arp layer fades in and the bass bites.
    musHP.frequency.setTargetAtTime(30 + music.intensity * 170, t, 0.4);
    arpGain.gain.setTargetAtTime(music.intensity * 0.5, t, 0.5);
    bassGain.gain.setTargetAtTime(0.55 + music.intensity * 0.35, t, 0.5);
  };

  /** 0 = fully open, 1 = heavily muffled (the low-HP effect). */
  music.setLowpass = function (v) {
    lowpassAmt = clamp(v || 0, 0, 1);
    if (!ctx) return;
    var f = 18000 * Math.pow(400 / 18000, lowpassAmt);
    musLP.frequency.setTargetAtTime(f, ctx.currentTime, 0.15);
  };

  /** Register a quarter-note callback. Returns an unsubscribe function. */
  music.onBeat = function (cb) {
    if (typeof cb !== 'function') return function () {};
    beatCbs.push(cb);
    return function () {
      var i = beatCbs.indexOf(cb);
      if (i >= 0) beatCbs.splice(i, 1);
    };
  };

  music.start = function () {
    if (!ctx) Audio.init();
    if (!ctx || music.playing) return;
    ensureMusicNodes();
    // clear any fade-out left over from a previous stop()
    padGain.gain.cancelScheduledValues(ctx.currentTime);
    padGain.gain.value = 0.5;
    music.setIntensity(music.intensity);
    music.setLowpass(lowpassAmt);
    music.playing = true;
    mStep = 0; music.beat = 0; music.bar = 0; lastChordBlock = -1;
    mNextTime = ctx.currentTime + 0.08;
    mTimer = setInterval(scheduler, LOOKAHEAD_MS);
  };

  music.stop = function () {
    if (!music.playing) return;
    music.playing = false;
    if (mTimer) { clearInterval(mTimer); mTimer = null; }
    if (padGain && ctx) {
      // let the tails ring out rather than cutting hard
      padGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    }
  };

  /** Seconds per 16th note, tempo-scaled by the global time scale. */
  function sec16() { return (60 / (music.bpm * clamp(timeScale, 0.15, 4))) / 4; }

  /** The lookahead loop: schedules every 16th note inside the horizon. */
  function scheduler() {
    if (!ctx || !music.playing) return;
    var horizon = ctx.currentTime + SCHEDULE_AHEAD;
    var guard = 0;
    while (mNextTime < horizon && guard++ < 64) {
      scheduleStep(mStep, mNextTime);
      mNextTime += sec16();
      mStep++;
    }
    // if we fell far behind (tab throttling), resync instead of catching up
    if (mNextTime < ctx.currentTime - 0.5) mNextTime = ctx.currentTime + 0.02;
  }

  /** Schedules one 16th note. Allocates nothing but the audio nodes it plays. */
  function scheduleStep(step, time) {
    var s = step % STEPS_PER_BAR;
    var bar = (step / STEPS_PER_BAR) | 0;
    var block = (bar / BARS_PER_BLOCK) | 0;
    var m = modeDef();
    var P = pitchScale;

    // --- quarter-note beat callbacks (these also drive the Resonance Pulse) --
    if (s % 4 === 0) {
      var beatIndex = (step / 4) | 0;
      music.beat = beatIndex;
      music.bar = bar;
      fireBeat(beatIndex, time);
    }

    // --- chord change every 4 bars ------------------------------------------
    var holdingNow = !!m.hold && (block % m.prog.length) === m.prog.length - 1;
    if (block !== lastChordBlock && s === 0) {
      lastChordBlock = block;
      curChordRoot = m.prog[block % m.prog.length];
      playPad(time, curChordRoot, holdingNow, P);
    }

    // --- bass ostinato -------------------------------------------------------
    // In 'finale' the last block holds: the bass drops out so the pad's
    // resolving chord is the whole piece for four bars.
    if (!holdingNow) {
      var amp = BASS_PAT[s];
      if (amp > 0) playBass(time, curChordRoot + BASS_DEG[s], amp, P);
    }

    // --- arp layer; density follows intensity --------------------------------
    var it = music.intensity;
    if (it > 0.02) {
      var play;
      if (it > 0.7) play = true;                       // every 16th
      else if (it > 0.4) play = (s % 2) === 0;         // 8ths
      else if (it > 0.15) play = (s % 4) === 0;        // quarters
      else play = (s === 0 || s === 8);                // sparse
      if (play) playArp(time, curChordRoot + ARP_DEG[s], P, it);
    }
  }

  function fireBeat(i, time) {
    if (!beatCbs.length) return;
    var delay = Math.max(0, (time - ctx.currentTime) * 1000);
    setTimeout(function () {
      for (var k = 0; k < beatCbs.length; k++) {
        try { beatCbs[k](i, time); } catch (e) {}
      }
    }, delay);
  }

  // --- music voices: short-lived, self-disconnecting via onended -------------
  function playBass(time, deg, amp, P) {
    var f = music.scaleFreq(deg, -1) * P;
    var o = ctx.createOscillator();
    var o2 = ctx.createOscillator();
    var lp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 0.5;
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(300 + 1200 * music.intensity, time);
    lp.frequency.exponentialRampToValueAtTime(180, time + 0.18);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bassGain);
    var dur = 0.22;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.3 * amp, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.start(time); o.stop(time + dur + 0.02);
    o2.start(time); o2.stop(time + dur + 0.02);
    o.onended = function () {
      o.disconnect(); o2.disconnect(); lp.disconnect(); g.disconnect();
      o.onended = null;
    };
  }

  function playPad(time, rootDeg, holding, P) {
    var barSec = (60 / music.bpm) * 4;
    var dur = barSec * BARS_PER_BLOCK * (holding ? 1.15 : 1);
    for (var i = 0; i < PAD_DEGS.length; i++) {
      var f = music.scaleFreq(rootDeg + PAD_DEGS[i], 0) * P;
      var a = ctx.createOscillator();
      var b = ctx.createOscillator();
      var g = ctx.createGain();
      a.type = 'triangle'; a.frequency.value = f; a.detune.value = -5;
      b.type = 'sine'; b.frequency.value = f; b.detune.value = 6;
      a.connect(g); b.connect(g); g.connect(padGain);
      var peak = (holding ? 0.16 : 0.1) * (i === 0 ? 1.1 : 0.85);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + (holding ? 1.2 : 0.9));
      g.gain.setValueAtTime(peak, time + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, time + dur);
      a.start(time); a.stop(time + dur + 0.05);
      b.start(time); b.stop(time + dur + 0.05);
      (function (a2, b2, g2) {
        a2.onended = function () { a2.disconnect(); b2.disconnect(); g2.disconnect(); a2.onended = null; };
      })(a, b, g);
    }
  }

  function playArp(time, deg, P, it) {
    var f = music.scaleFreq(deg, 1) * P;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    o.connect(g); g.connect(arpGain);
    var dur = 0.12 + 0.1 * (1 - it);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.22, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.start(time); o.stop(time + dur + 0.02);
    o.onended = function () { o.disconnect(); g.disconnect(); o.onended = null; };
  }

  /** One-shot musical punctuation, played on the music bus (not the SFX bus). */
  function padNote(freq, t, attack, hold, release, peak, type) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    o.connect(g); g.connect(padGain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.start(t); o.stop(t + attack + hold + release + 0.05);
    o.onended = function () { o.disconnect(); g.disconnect(); o.onended = null; };
  }

  music.stinger = function (name) {
    if (!ctx || !Audio.enabled) return;
    ensureMusicNodes();
    var t = ctx.currentTime + 0.02, i;
    if (name === 'waveClear') {
      for (i = 0; i < RESOLVE.length; i++) {
        padNote(music.scaleFreq(RESOLVE[i], 1) * pitchScale, t + i * 0.05, 0.03, 0.1, 1.3, 0.16, 'sine');
      }
    } else if (name === 'bossDeath') {
      Audio.sfx('bossDeath');
      for (i = 0; i < DESCEND.length; i++) {
        padNote(music.scaleFreq(DESCEND[i], 0) * pitchScale, t + i * 0.18, 0.05, 0.2, 1.9, 0.14, 'triangle');
      }
    } else if (name === 'victory') {
      for (i = 0; i < VICTORY.length; i++) {
        padNote(music.scaleFreq(VICTORY[i], VICTORY[i] >= 7 ? 1 : 0) * pitchScale,
                t + i * 0.12, 0.08, 1.4, 1.4, 0.18, i % 2 ? 'sine' : 'triangle');
      }
    }
  };

  Audio.music = music;
  NA.Audio = Audio;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ===== 04_icons.js ===== */
// ============================================================================
// NOVA ARENA — 04_icons.js  ::  NA.Icons
// ----------------------------------------------------------------------------
// Text-free vector icon library. Every glyph is pure Canvas2D path work: no
// fonts, no emoji, no images. Loads standalone (depends on nothing else).
//
// PUBLIC API
//   NA.Icons.draw(ctx, id, x, y, size, opts)   upgrade / UI icon, centered
//   NA.Icons.enemy(ctx, shape, x, y, size, opts)
//   NA.Icons.boss(ctx, bossId, x, y, size, opts)
//   NA.Icons.ship(ctx, x, y, size, slots, opts)
//   NA.Icons.digit(ctx, n, x, y, size, opts)
//   NA.Icons.number(ctx, value, x, y, size, opts)
//   NA.Icons.slider(ctx, x, y, size, value01, color)
//   NA.Icons.ids / uiIds / bossIds / enemyShapes / family(id) / has(id)
//
//   opts = { tier:1..3, color:'#rrggbb', glow:0..1, alpha:0..1,
//            frame:bool, wild:bool, rot:radians }
//
// Every glyph is authored inside a 64x64 box centered on the origin (-32..32)
// with lineWidth 2; draw() scales that box to `size`, so strokes stay
// proportional at any size. Glyph art stays inside radius 22 so the tier
// frames (r 25..31) never collide with it.
// ============================================================================
window.NA = window.NA || {};
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // ---- palette -------------------------------------------------------------
  var FAMILY = {
    offense:  '#FF8A00',
    defense:  '#4D8CFF',
    mana:     '#4DF3FF',
    movement: '#39FF6A',
    chaos:    '#FF3CAC',
    wild:     '#FFD84D',
    ui:       '#4DF3FF',
    enemy:    '#FF3CAC',
    boss:     '#FFD84D'
  };

  function hexRGB(h) {
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgba(h, a) {
    var c = hexRGB(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  // Blend toward white; used for the tier-3 "brighter" treatment.
  function lighten(h, t) {
    var c = hexRGB(h);
    return 'rgb(' + Math.round(c[0] + (255 - c[0]) * t) + ',' +
                    Math.round(c[1] + (255 - c[1]) * t) + ',' +
                    Math.round(c[2] + (255 - c[2]) * t) + ')';
  }

  // ---- primitive helpers ---------------------------------------------------
  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function tracePath(ctx, p, close) {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    if (close) ctx.closePath();
  }
  function poly(ctx, p, close) { tracePath(ctx, p, close); ctx.stroke(); }
  function polyFill(ctx, p) { tracePath(ctx, p, true); ctx.fill(); ctx.stroke(); }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  function circF(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function circFS(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke(); }
  function arcp(ctx, x, y, r, a0, a1) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke(); }
  function dot(ctx, st, x, y, r) {
    var f = ctx.fillStyle; ctx.fillStyle = st.ink; circF(ctx, x, y, r); ctx.fillStyle = f;
  }
  function ngonPts(x, y, r, n, rot) {
    var p = [], i, a;
    for (i = 0; i < n; i++) { a = rot + i / n * TAU; p.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    return p;
  }
  function ngon(ctx, x, y, r, n, rot) { poly(ctx, ngonPts(x, y, r, n, rot), true); }
  function ngonF(ctx, x, y, r, n, rot) { polyFill(ctx, ngonPts(x, y, r, n, rot)); }
  function dash(ctx, a, b) { ctx.setLineDash([a, b]); }
  function undash(ctx) { ctx.setLineDash([]); }
  function lw(ctx, w) { ctx.lineWidth = w; }

  // Base shape: an upward projectile triangle (the "bullet" glyph).
  function triUp(ctx, x, y, r, fill) {
    var p = [x, y - r, x + r * 0.78, y + r * 0.72, x - r * 0.78, y + r * 0.72];
    if (fill) polyFill(ctx, p); else poly(ctx, p, true);
  }
  function diamond(ctx, x, y, r, fill) {
    var p = [x, y - r, x + r * 0.78, y, x, y + r, x - r * 0.78, y];
    if (fill) polyFill(ctx, p); else poly(ctx, p, true);
  }
  // Base shape: lightning chain.
  function bolt(ctx, x, y, s, fill) {
    var p = [x - s * 0.36, y - s, x + s * 0.30, y - s * 0.18, x - s * 0.04, y - s * 0.18,
             x + s * 0.40, y + s, x - s * 0.30, y + s * 0.14, x + s * 0.02, y + s * 0.14];
    if (fill) polyFill(ctx, p); else poly(ctx, p, true);
  }
  // Base shape: crit / burst four-point star.
  function star4(ctx, x, y, r) {
    var k = r * 0.26;
    poly(ctx, [x, y - r, x + k, y - k, x + r, y, x + k, y + k,
               x, y + r, x - k, y + k, x - r, y, x - k, y - k], true);
  }
  // Base shape: explosion sun.
  function sun(ctx, x, y, r, rays) {
    circ(ctx, x, y, r * 0.45);
    for (var i = 0; i < rays; i++) {
      var a = i / rays * TAU;
      line(ctx, x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68,
                x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }
  // Base shape: targeting reticle.
  function reticle(ctx, x, y, r) {
    circ(ctx, x, y, r * 0.62);
    line(ctx, x - r, y, x - r * 0.34, y); line(ctx, x + r * 0.34, y, x + r, y);
    line(ctx, x, y - r, x, y - r * 0.34); line(ctx, x, y + r * 0.34, x, y + r);
  }
  // Base shape: the mana half-disc (left half filled).
  function manaHalf(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    circ(ctx, x, y, r);
    line(ctx, x, y - r, x, y + r);
  }
  // Base shape: dash arrow.
  function arrowAt(ctx, x, y, a, head) {
    var c = Math.cos(a), s = Math.sin(a);
    poly(ctx, [x - c * head + s * head * 0.8, y - s * head - c * head * 0.8,
               x, y,
               x - c * head - s * head * 0.8, y - s * head + c * head * 0.8], false);
  }
  function arrowR(ctx, x1, x2, y, head) {
    head = head || 6;
    line(ctx, x1, y, x2, y);
    arrowAt(ctx, x2, y, 0, head);
  }

  // ---- corner modifiers (fixed positions, GAME_PLAN 12.7) ------------------
  // tl = magnitude, tr = count, br = speed, bl = bounce / pierce / regen
  var CORNER = { tl: [-18, -18], tr: [18, -18], br: [18, 18], bl: [-18, 18] };
  function mod(ctx, st, kind, corner) {
    var c = CORNER[corner] || CORNER.tr, x = c[0], y = c[1], s = 5.2, o = ctx.lineWidth;
    lw(ctx, 1.7);
    if (kind === 'plus') { line(ctx, x - s, y, x + s, y); line(ctx, x, y - s, x, y + s); }
    else if (kind === 'up') { line(ctx, x, y + s, x, y - s); arrowAt(ctx, x, y - s, -Math.PI / 2, 3.8); }
    else if (kind === 'speed') {
      poly(ctx, [x - s, y - s, x - s * 0.1, y, x - s, y + s], false);
      poly(ctx, [x + s * 0.2, y - s, x + s * 1.1, y, x + s * 0.2, y + s], false);
    } else if (kind === 'pierce') {
      line(ctx, x - s * 1.1, y, x + s * 1.1, y);
      line(ctx, x, y - s, x, y + s);
      arrowAt(ctx, x + s * 1.1, y, 0, 3.6);
    } else if (kind === 'bounce') {
      ctx.beginPath(); ctx.arc(x, y + s * 0.3, s * 0.9, Math.PI, TAU); ctx.stroke();
      line(ctx, x - s * 0.9, y + s * 0.3, x - s * 0.9, y + s * 0.95);
      arrowAt(ctx, x - s * 0.9, y + s * 0.95, Math.PI / 2, 3.4);
    } else if (kind === 'regen') {
      ctx.beginPath(); ctx.arc(x, y, s * 0.9, -0.35, TAU - 1.5); ctx.stroke();
      arrowAt(ctx, x + Math.cos(-0.35) * s * 0.9, y + Math.sin(-0.35) * s * 0.9, -2.0, 3.6);
    }
    lw(ctx, o);
  }

  // ---- frames --------------------------------------------------------------
  function roundPolyPath(ctx, r, n, rot, corner) {
    var p = ngonPts(0, 0, r, n, rot), i, n2 = p.length / 2;
    ctx.beginPath();
    for (i = 0; i < n2; i++) {
      var ax = p[i * 2], ay = p[i * 2 + 1];
      var bx = p[((i + 1) % n2) * 2], by = p[((i + 1) % n2) * 2 + 1];
      var dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy), t = corner / L;
      if (i === 0) ctx.moveTo(ax + dx * t, ay + dy * t);
      else ctx.lineTo(ax + dx * t, ay + dy * t);
      ctx.lineTo(bx - dx * t, by - dy * t);
      var cx = p[((i + 2) % n2) * 2], cy = p[((i + 2) % n2) * 2 + 1];
      var ex = cx - bx, ey = cy - by, L2 = Math.sqrt(ex * ex + ey * ey), t2 = corner / L2;
      ctx.quadraticCurveTo(bx, by, bx + ex * t2, by + ey * t2);
    }
    ctx.closePath();
  }

  function tierPips(ctx, st, y) {
    var i, x, f = ctx.fillStyle;
    for (i = 0; i < 3; i++) {
      x = (i - 1) * 5.5;
      ctx.fillStyle = i < st.tier ? st.ink : rgba(st.col, 0.22);
      circF(ctx, x, y, 1.5);
    }
    ctx.fillStyle = f;
  }
  function frameHex(ctx, st) {
    var i, r;
    for (i = 0; i < st.tier; i++) {
      r = 31 - i * 3;
      ctx.strokeStyle = rgba(st.col, i === 0 ? 0.85 : 0.42 - i * 0.09);
      lw(ctx, i === 0 ? 2 : 1.2);
      roundPolyPath(ctx, r, 6, -Math.PI / 2, 6); ctx.stroke();
    }
    tierPips(ctx, st, 25.5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }
  function frameCircle(ctx, st) {
    for (var i = 0; i < st.tier; i++) {
      ctx.strokeStyle = rgba(st.col, i === 0 ? 0.85 : 0.42 - i * 0.09);
      lw(ctx, i === 0 ? 2 : 1.2);
      circ(ctx, 0, 0, 31 - i * 3);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }
  function frameSpiked(ctx, st) {
    var i, a, n = 16, p = [];
    for (i = 0; i < n * 2; i++) {
      a = i / (n * 2) * TAU - Math.PI / 2;
      var r = (i & 1) ? 32 : 27;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.strokeStyle = rgba(st.col, 0.9); lw(ctx, 1.6); poly(ctx, p, true);
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.2); circ(ctx, 0, 0, 24.5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }
  function frameWild(ctx, st) {
    var i, a, n = 6, p = [];
    for (i = 0; i < n * 2; i++) {
      a = i / (n * 2) * TAU - Math.PI / 2;
      var r = (i & 1) ? 23 : 32;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.strokeStyle = rgba(st.col, 0.9); lw(ctx, 1.8); poly(ctx, p, true);
    if (st.tier > 1) {
      var q = [];
      for (i = 0; i < n * 2; i++) {
        a = i / (n * 2) * TAU - Math.PI / 2;
        var rr = (i & 1) ? 19 : 27;
        q.push(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.strokeStyle = rgba(st.col, 0.3); lw(ctx, 1.1); poly(ctx, q, true);
    }
    tierPips(ctx, st, 25.5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }

  // ---- registry ------------------------------------------------------------
  var G = {};        // id -> draw(ctx, st)
  var FAM_OF = {};   // id -> family key
  function reg(id, fam, fn) { G[id] = fn; FAM_OF[id] = fam; }

  function makeState(ctx, col, tier) {
    var st = {
      col: col,
      tier: tier,
      stroke: tier >= 3 ? lighten(col, 0.35) : col,
      ink: tier >= 3 ? lighten(col, 0.55) : lighten(col, 0.18),
      dim: rgba(col, 0.35)
    };
    if (tier === 1) st.fill = rgba(col, 0.20);
    else {
      var g = ctx.createLinearGradient(0, -24, 0, 24);
      g.addColorStop(0, rgba(col, tier === 3 ? 0.80 : 0.52));
      g.addColorStop(1, rgba(col, tier === 3 ? 0.16 : 0.06));
      st.fill = g;
    }
    return st;
  }

  function begin(ctx, x, y, size, col, opts) {
    var k = size / 64;
    ctx.save();
    ctx.translate(x, y);
    if (opts.rot) ctx.rotate(opts.rot);
    ctx.scale(k, k);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.glow) { ctx.shadowColor = rgba(col, 0.95); ctx.shadowBlur = opts.glow * size * 0.30; }
  }

  // ---- main entry ----------------------------------------------------------
  function draw(ctx, id, x, y, size, opts) {
    opts = opts || {};
    var fn = G[id];
    var tier = Math.max(1, Math.min(3, opts.tier || 1));
    var col = opts.color || FAMILY[FAM_OF[id]] || FAMILY.ui;
    begin(ctx, x, y, size, col, opts);
    var st = makeState(ctx, col, tier);
    ctx.strokeStyle = st.stroke;
    ctx.fillStyle = st.fill;
    if (opts.wild) frameWild(ctx, st);
    else if (opts.frame) frameHex(ctx, st);
    if (fn) fn(ctx, st);
    undash(ctx);
    ctx.restore();
  }

  // ==========================================================================
  // UPGRADE GLYPHS (42)
  // Grammar: base shape says what it affects, corner modifier says how,
  // family colour says which branch.
  // ==========================================================================

  // --- A. Weapons -----------------------------------------------------------
  // two parallel projectiles
  reg('twinBarrels', 'offense', function (ctx, st) {
    triUp(ctx, -9, 2, 11, true);
    triUp(ctx, 9, 2, 11, true);
    line(ctx, -9, 16, -9, 20); line(ctx, 9, 16, 9, 20);
    mod(ctx, st, 'plus', 'tr');
  });
  // charged rail: long barrel + charge coils, pierces
  reg('railgun', 'offense', function (ctx, st) {
    lw(ctx, 3); line(ctx, 0, 20, 0, -8); lw(ctx, 2);
    triUp(ctx, 0, -12, 8, true);
    line(ctx, -9, 4, 9, 4); line(ctx, -9, 11, 9, 11);
    dot(ctx, st, 0, -20, 2.4);
    mod(ctx, st, 'pierce', 'bl');
  });
  // cone of pellets
  reg('buckshot', 'offense', function (ctx, st) {
    triUp(ctx, 0, 14, 8, true);
    var i, a;
    for (i = 0; i < 5; i++) {
      a = -Math.PI / 2 + (i - 2) * 0.36;
      dot(ctx, st, Math.cos(a) * 21, 12 + Math.sin(a) * 21, 2.6);
      lw(ctx, 1.1);
      line(ctx, Math.cos(a) * 12, 12 + Math.sin(a) * 12, Math.cos(a) * 17, 12 + Math.sin(a) * 17);
      lw(ctx, 2);
    }
  });
  // lobbed shell: ballistic arc into a burst
  reg('mortar', 'offense', function (ctx, st) {
    lw(ctx, 1.6); dash(ctx, 4, 3);
    ctx.beginPath(); ctx.moveTo(-17, 15); ctx.quadraticCurveTo(-2, -24, 15, 8); ctx.stroke();
    undash(ctx); lw(ctx, 2);
    ctx.save(); ctx.translate(-17, 15); ctx.rotate(-0.9); triUp(ctx, 0, -2, 7, true); ctx.restore();
    star4(ctx, 15, 12, 8);
    dot(ctx, st, 15, 12, 2.2);
  });
  // spinning barrel cluster
  reg('gatling', 'offense', function (ctx, st) {
    var i, a;
    for (i = 0; i < 6; i++) {
      a = i / 6 * TAU - Math.PI / 2;
      circ(ctx, Math.cos(a) * 10, Math.sin(a) * 10, 4);
    }
    dot(ctx, st, 0, 0, 2.6);
    lw(ctx, 1.5);
    arcp(ctx, 0, 0, 19, -0.4, 2.3);
    arrowAt(ctx, Math.cos(2.3) * 19, Math.sin(2.3) * 19, 2.3 + Math.PI / 2, 4.2);
    lw(ctx, 2);
    mod(ctx, st, 'speed', 'br');
  });

  // --- B. Projectile modifiers ---------------------------------------------
  // explosion
  reg('blast', 'offense', function (ctx, st) {
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    sun(ctx, 0, 0, 19, 8);
    dot(ctx, st, 0, 0, 3);
    mod(ctx, st, 'up', 'tl');
  });
  // bouncing between walls
  reg('ricochet', 'offense', function (ctx, st) {
    lw(ctx, 2.4);
    ctx.strokeStyle = st.dim;
    line(ctx, -19, -18, -19, 18); line(ctx, 19, -18, 19, 18);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    poly(ctx, [-15, 16, 15, 3, -15, -11], false);
    arrowAt(ctx, -15, -11, Math.PI + 0.42, 6);
    mod(ctx, st, 'bounce', 'bl');
  });
  // pierce through
  reg('drill', 'offense', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 2.4); line(ctx, 8, -17, 8, 17);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    ctx.save(); ctx.translate(-10, 0); ctx.rotate(Math.PI / 2); triUp(ctx, 0, 0, 10, true); ctx.restore();
    lw(ctx, 1.2);
    line(ctx, -16, -4, -12, -4); line(ctx, -16, 0, -11, 0); line(ctx, -16, 4, -12, 4);
    lw(ctx, 2);
    line(ctx, 0, 0, 18, 0); arrowAt(ctx, 20, 0, 0, 6);
  });
  // homing onto a target
  reg('seeker', 'offense', function (ctx, st) {
    circ(ctx, 13, -12, 6); dot(ctx, st, 13, -12, 2.4);
    lw(ctx, 1.5); dash(ctx, 4, 3);
    ctx.beginPath(); ctx.moveTo(-14, 16); ctx.quadraticCurveTo(-18, -8, 7, -10); ctx.stroke();
    undash(ctx); lw(ctx, 2);
    ctx.save(); ctx.translate(-14, 16); ctx.rotate(0.5); triUp(ctx, 0, 0, 8, true); ctx.restore();
  });
  // chain lightning between nodes
  reg('voltaic', 'offense', function (ctx, st) {
    circ(ctx, -16, 13, 5); circ(ctx, 16, -13, 5);
    bolt(ctx, 0, 0, 15, true);
    lw(ctx, 1.2); dash(ctx, 3, 3);
    line(ctx, -12, 9, -5, 3); line(ctx, 6, -3, 12, -9);
    undash(ctx); lw(ctx, 2);
  });

  // --- C. Mana actives ------------------------------------------------------
  // mana burned for fire rate
  reg('overdrive', 'mana', function (ctx, st) {
    manaHalf(ctx, -3, 0, 15);
    mod(ctx, st, 'speed', 'br');
    lw(ctx, 1.6);
    line(ctx, 14, -14, 20, -8);
    lw(ctx, 2);
  });
  // mana clock
  reg('chrono', 'mana', function (ctx, st) {
    manaHalf(ctx, 0, 0, 16);
    lw(ctx, 2.2);
    line(ctx, 0, 0, 0, -10); line(ctx, 0, 0, 8, 5);
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 2.6);
    var i, a;
    lw(ctx, 1.3);
    for (i = 0; i < 4; i++) { a = i / 4 * TAU; line(ctx, Math.cos(a) * 19, Math.sin(a) * 19, Math.cos(a) * 22, Math.sin(a) * 22); }
    lw(ctx, 2);
  });
  // expanding shockwave
  reg('pulse', 'mana', function (ctx, st) {
    dot(ctx, st, 0, 0, 3.4);
    ctx.strokeStyle = rgba(st.col, 0.95); circ(ctx, 0, 0, 8);
    ctx.strokeStyle = rgba(st.col, 0.6); circ(ctx, 0, 0, 14);
    ctx.strokeStyle = rgba(st.col, 0.32); circ(ctx, 0, 0, 20);
    ctx.strokeStyle = st.stroke;
  });
  // mana drawn inward
  reg('siphon', 'mana', function (ctx, st) {
    manaHalf(ctx, 0, 5, 14);
    lw(ctx, 1.8);
    line(ctx, 0, -21, 0, -12); arrowAt(ctx, 0, -10, Math.PI / 2, 5.5);
    ctx.beginPath(); ctx.moveTo(-16, -17); ctx.quadraticCurveTo(-8, -12, -6, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, -17); ctx.quadraticCurveTo(8, -12, 6, -6); ctx.stroke();
    lw(ctx, 2);
  });
  // mana bar overfilled, crowned
  reg('overcharge', 'mana', function (ctx, st) {
    ctx.beginPath(); ctx.arc(0, 4, 14, 0, TAU); ctx.fill(); ctx.stroke();
    circ(ctx, 0, 4, 18.5);
    poly(ctx, [-11, -13, -7, -21, -2, -14, 3, -22, 8, -14, 12, -20], false);
    mod(ctx, st, 'up', 'tl');
  });
  // bullets cost mana: runed round
  reg('arcane', 'mana', function (ctx, st) {
    triUp(ctx, 0, 3, 15, true);
    diamond(ctx, 0, 4, 5, false);
    lw(ctx, 1.3);
    var i, a;
    for (i = 0; i < 6; i++) {
      a = i / 6 * TAU + 0.5;
      line(ctx, Math.cos(a) * 18, Math.sin(a) * 18, Math.cos(a) * 21.5, Math.sin(a) * 21.5);
    }
    lw(ctx, 2);
  });

  // --- D. Movement ----------------------------------------------------------
  // dash with flame trail
  reg('afterburner', 'movement', function (ctx, st) {
    arrowR(ctx, -6, 16, 0, 7);
    var i;
    lw(ctx, 2);
    for (i = 0; i < 3; i++) {
      var x = -10 - i * 6;
      ctx.strokeStyle = rgba(st.col, 0.9 - i * 0.25);
      poly(ctx, [x - 5, -8 + i, x + 1, 0, x - 5, 8 - i], false);
    }
    ctx.strokeStyle = st.stroke;
    mod(ctx, st, 'speed', 'br');
  });
  // dash through a wall of bullets
  reg('phase', 'movement', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 2.4); dash(ctx, 4, 4);
    line(ctx, 3, -19, 3, 19);
    undash(ctx); ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, -20, 0, -6, 0);
    dash(ctx, 3, 3); line(ctx, -6, 0, 10, 0); undash(ctx);
    line(ctx, 10, 0, 15, 0); arrowAt(ctx, 18, 0, 0, 6);
    dot(ctx, st, 3, -11, 2.2); dot(ctx, st, 3, 11, 2.2);
  });
  // sliding momentum with skid marks
  reg('drift', 'movement', function (ctx, st) {
    ctx.beginPath(); ctx.moveTo(-19, 14); ctx.quadraticCurveTo(0, 14, 14, -8); ctx.stroke();
    arrowAt(ctx, 17, -13, -1.0, 6.5);
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.55);
    line(ctx, -16, 20, -5, 19); line(ctx, -6, 21, 5, 16); line(ctx, 4, 19, 12, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // teleport: broken arrow with a landing dot
  reg('blink', 'movement', function (ctx, st) {
    line(ctx, -21, 0, -8, 0);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.4);
    line(ctx, -4, -5, -4, 5); line(ctx, 2, -5, 2, 5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, 7, 0, 14, 0); arrowAt(ctx, 17, 0, 0, 6);
    dot(ctx, st, 20, 0, 3.4);
    circ(ctx, 20, 0, 6.5);
  });

  // --- E. Defense -----------------------------------------------------------
  // extra plated hull
  reg('hullPlating', 'defense', function (ctx, st) {
    diamond(ctx, 0, 0, 20, true);
    lw(ctx, 1.5); diamond(ctx, 0, 0, 12, false); lw(ctx, 2);
    mod(ctx, st, 'plus', 'tr');
  });
  // pressure release
  reg('vent', 'defense', function (ctx, st) {
    diamond(ctx, 0, 0, 19, true);
    lw(ctx, 1.7);
    line(ctx, -6, -4, 6, -4); line(ctx, -7, 1, 7, 1); line(ctx, -6, 6, 6, 6);
    ctx.strokeStyle = rgba(st.col, 0.75);
    line(ctx, -22, -7, -16, -7); arrowAt(ctx, -23, -7, Math.PI, 4.2);
    line(ctx, 16, 7, 22, 7); arrowAt(ctx, 23, 7, 0, 4.2);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // a hit is ignored: spectral hull
  reg('ghost', 'defense', function (ctx, st) {
    dash(ctx, 4, 3.5); diamond(ctx, 0, -2, 19, false); undash(ctx);
    ctx.beginPath();
    ctx.moveTo(-8, 6); ctx.quadraticCurveTo(-8, -10, 0, -10);
    ctx.quadraticCurveTo(8, -10, 8, 6);
    ctx.lineTo(4, 2); ctx.lineTo(0, 6); ctx.lineTo(-4, 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    dot(ctx, st, -3, -4, 1.7); dot(ctx, st, 3, -4, 1.7);
  });

  // --- F. Chain reaction triggers ------------------------------------------
  // on kill: scythe
  reg('reaper', 'chaos', function (ctx, st) {
    lw(ctx, 2.4); line(ctx, -10, 20, 8, -6); lw(ctx, 2);
    ctx.beginPath(); ctx.moveTo(8, -6); ctx.quadraticCurveTo(2, -22, -18, -16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -6); ctx.quadraticCurveTo(0, -14, -18, -16); ctx.stroke();
    dot(ctx, st, -12, 21, 2.6);
    lw(ctx, 1.4); line(ctx, -16, 14, -6, 14); lw(ctx, 2);
  });
  // on hit: crit mark
  reg('impact', 'offense', function (ctx, st) {
    reticle(ctx, 0, 0, 20);
    ctx.beginPath();
    var k = 3.4, r = 11;
    ctx.moveTo(0, -r); ctx.lineTo(k, -k); ctx.lineTo(r, 0); ctx.lineTo(k, k);
    ctx.lineTo(0, r); ctx.lineTo(-k, k); ctx.lineTo(-r, 0); ctx.lineTo(-k, -k);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    dot(ctx, st, 0, 0, 2.2);
  });
  // on dash: rear fan
  reg('wake', 'movement', function (ctx, st) {
    arrowR(ctx, -2, 18, -6, 6.5);
    var i, a;
    lw(ctx, 1.8);
    for (i = 0; i < 5; i++) {
      a = Math.PI - 0.85 + i * 0.425;
      line(ctx, -6 + Math.cos(a) * 7, -6 + Math.sin(a) * 7,
                -6 + Math.cos(a) * 17, -6 + Math.sin(a) * 17);
      dot(ctx, st, -6 + Math.cos(a) * 19, -6 + Math.sin(a) * 19, 1.7);
    }
    lw(ctx, 2);
  });
  // on spend: mana becomes shots
  reg('spendthrift', 'mana', function (ctx, st) {
    manaHalf(ctx, -11, 0, 11);
    lw(ctx, 1.5); dash(ctx, 3, 3); line(ctx, 2, 0, 14, 0); undash(ctx); lw(ctx, 2);
    dot(ctx, st, 6, -9, 2.2); dot(ctx, st, 12, 8, 2.2);
    ctx.save(); ctx.translate(19, 0); ctx.rotate(Math.PI / 2); triUp(ctx, 0, 0, 8, true); ctx.restore();
  });
  // excess damage carries on
  reg('overkill', 'offense', function (ctx, st) {
    ctx.save(); ctx.translate(-18, 0); ctx.rotate(Math.PI / 2); triUp(ctx, 0, 0, 8, true); ctx.restore();
    ctx.strokeStyle = st.dim; lw(ctx, 1.8);
    arcp(ctx, -1, 0, 10, 0.6, 2.6); arcp(ctx, -1, 0, 10, 3.7, 5.7);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, -8, 0, 8, 0); arrowAt(ctx, 10, 0, 0, 5);
    star4(ctx, 17, 0, 9);
  });

  // --- G. Summons and orbitals ---------------------------------------------
  // orbiting shards
  reg('shardOrbit', 'chaos', function (ctx, st) {
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.4); circ(ctx, 0, 0, 17);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    diamond(ctx, 0, -17, 6, true);
    diamond(ctx, 15, 9, 6, true);
    diamond(ctx, -15, 9, 6, true);
    dot(ctx, st, 0, 0, 3.4);
  });
  // a wingman copy
  reg('drone', 'chaos', function (ctx, st) {
    triUp(ctx, -7, 4, 13, true);
    triUp(ctx, 13, -9, 7, false);
    lw(ctx, 1.2); dash(ctx, 3, 3); line(ctx, 1, -3, 9, -8); undash(ctx); lw(ctx, 2);
    dot(ctx, st, 13, -8, 1.7);
  });
  // deployed turret pod
  reg('turret', 'chaos', function (ctx, st) {
    polyFill(ctx, [-14, 18, 14, 18, 9, 8, -9, 8]);
    ctx.beginPath(); ctx.arc(0, 8, 8, Math.PI, TAU); ctx.closePath(); ctx.fill(); ctx.stroke();
    lw(ctx, 3.2); line(ctx, 0, 2, 0, -14); lw(ctx, 2);
    line(ctx, -5, -14, 5, -14);
    dot(ctx, st, 0, -19, 2.4);
  });
  // ghost twin copying you
  reg('mirror', 'chaos', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 1.4); dash(ctx, 3, 3);
    line(ctx, 0, -21, 0, 21);
    undash(ctx); ctx.strokeStyle = st.stroke; lw(ctx, 2);
    triUp(ctx, -11, 3, 12, true);
    dash(ctx, 3.5, 3);
    triUp(ctx, 11, 3, 12, false);
    undash(ctx);
  });

  // --- H. Area and fields ---------------------------------------------------
  function mineGlyph(ctx, st, x, y, r) {
    circF(ctx, x, y, r);
    circ(ctx, x, y, r);
    var i, a;
    lw(ctx, 1.4);
    for (i = 0; i < 6; i++) {
      a = i / 6 * TAU + 0.3;
      line(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 3.6), y + Math.sin(a) * (r + 3.6));
    }
    lw(ctx, 2);
  }
  reg('mines', 'chaos', function (ctx, st) {
    lw(ctx, 1.2); dash(ctx, 3, 3); line(ctx, -14, 12, 14, -12); undash(ctx); lw(ctx, 2);
    mineGlyph(ctx, st, -14, 12, 5);
    mineGlyph(ctx, st, 0, 0, 5);
    mineGlyph(ctx, st, 14, -12, 5);
  });
  // drifting storm cloud
  reg('stormCloud', 'chaos', function (ctx, st) {
    ctx.beginPath();
    ctx.arc(-9, -8, 7, Math.PI * 0.85, Math.PI * 1.9);
    ctx.arc(1, -13, 9, Math.PI * 1.15, Math.PI * 1.95);
    ctx.arc(11, -7, 7, Math.PI * 1.5, Math.PI * 0.25);
    ctx.lineTo(-9, -1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    bolt(ctx, 0, 11, 9, true);
    lw(ctx, 1.3);
    line(ctx, -14, 4, -11, 9); line(ctx, 13, 4, 10, 9);
    lw(ctx, 2);
  });
  // spiral pulled into a point
  reg('gravityWell', 'chaos', function (ctx, st) {
    var t, a, r;
    ctx.beginPath();
    for (t = 0; t <= 1.0001; t += 0.02) {
      a = t * TAU * 2.1; r = 21 * (1 - t * 0.92);
      if (t === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
    dot(ctx, st, 0, 0, 4);
    ctx.strokeStyle = rgba(st.col, 0.45); lw(ctx, 1.2);
    circ(ctx, 0, 0, 9);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // burning engine trail
  reg('burnTrail', 'chaos', function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(4, -20);
    ctx.quadraticCurveTo(16, -4, 11, 8);
    ctx.quadraticCurveTo(6, 20, -3, 17);
    ctx.quadraticCurveTo(-12, 13, -8, 2);
    ctx.quadraticCurveTo(-5, -5, -1, -6);
    ctx.quadraticCurveTo(-3, -14, 4, -20);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    lw(ctx, 1.6); ctx.strokeStyle = rgba(st.col, 0.8);
    ctx.beginPath(); ctx.moveTo(3, 15); ctx.quadraticCurveTo(-3, 6, 2, -2);
    ctx.quadraticCurveTo(7, 5, 3, 15); ctx.stroke();
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.5);
    line(ctx, -18, 20, -12, 20); line(ctx, -21, 12, -14, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });

  // --- I. Wildcards ---------------------------------------------------------
  // invisible bullets
  reg('ghostRounds', 'wild', function (ctx, st) {
    dash(ctx, 3.5, 3);
    triUp(ctx, 2, 2, 15, false);
    undash(ctx);
    dot(ctx, st, 2, -14, 2.6);
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.55);
    line(ctx, -16, 8, -9, 8); line(ctx, -18, 15, -8, 15); line(ctx, 12, 12, 19, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // the arena squeezes in
  reg('claustrophobia', 'wild', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 1.8);
    poly(ctx, [-16, -16, 16, -16, 16, 16, -16, 16], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    poly(ctx, [-6, -13, 0, -7, 6, -13], false);
    poly(ctx, [-6, 13, 0, 7, 6, 13], false);
    poly(ctx, [-13, -6, -7, 0, -13, 6], false);
    poly(ctx, [13, -6, 7, 0, 13, 6], false);
    dot(ctx, st, 0, 0, 3);
  });
  // one hit point, cracked
  reg('glassHull', 'wild', function (ctx, st) {
    diamond(ctx, 0, 0, 20, true);
    // the crack: a dark cut with a bright edge so it reads at every tier
    var crack = [-2, -19, 3, -6, -4, -1, 4, 6, -1, 19];
    var spurs = [[3, -6, 11, -8], [-4, -1, -12, -1], [4, 6, 11, 9]];
    var i;
    ctx.strokeStyle = 'rgba(5,6,10,0.92)'; lw(ctx, 4);
    poly(ctx, crack, false);
    for (i = 0; i < 3; i++) line(ctx, spurs[i][0], spurs[i][1], spurs[i][2], spurs[i][3]);
    ctx.strokeStyle = st.ink; lw(ctx, 1.5);
    poly(ctx, crack, false);
    lw(ctx, 1.2);
    for (i = 0; i < 3; i++) line(ctx, spurs[i][0], spurs[i][1], spurs[i][2], spurs[i][3]);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // power from an empty bar
  reg('berserk', 'wild', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 2.2);
    arcp(ctx, 0, 4, 19, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    polyFill(ctx, [0, -21, 6, -6, 15, -10, 9, 4, 15, 10, 0, 6, -15, 10, -9, 4, -15, -10, -6, -6]);
    dot(ctx, st, 0, -3, 2.2);
  });
  // enemy fire feeds you
  reg('feedbackLoop', 'wild', function (ctx, st) {
    lw(ctx, 2.2);
    arcp(ctx, 0, 0, 15, 0.5, 2.5);
    arrowAt(ctx, Math.cos(2.5) * 15, Math.sin(2.5) * 15, 2.5 + Math.PI / 2, 6);
    arcp(ctx, 0, 0, 15, 3.64, 5.64);
    arrowAt(ctx, Math.cos(5.64) * 15, Math.sin(5.64) * 15, 5.64 + Math.PI / 2, 6);
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 3.2);
    dot(ctx, st, -18, -12, 2.2); dot(ctx, st, 18, 12, 2.2);
  });
  // random everything: a die
  reg('gambler', 'wild', function (ctx, st) {
    ctx.save(); ctx.rotate(0.22);
    polyFill(ctx, [-14.5, -14.5, 14.5, -14.5, 14.5, 14.5, -14.5, 14.5]);
    var f = ctx.fillStyle; ctx.fillStyle = st.ink;
    circF(ctx, -7.5, -7.5, 2.4); circF(ctx, 7.5, -7.5, 2.4); circF(ctx, 0, 0, 2.4);
    circF(ctx, -7.5, 7.5, 2.4); circF(ctx, 7.5, 7.5, 2.4);
    ctx.fillStyle = f;
    ctx.restore();
  });

  // ==========================================================================
  // SETTINGS / UI GLYPHS
  // ==========================================================================
  function speaker(ctx, st) {
    polyFill(ctx, [-19, -6, -11, -6, -3, -15, -3, 15, -11, 6, -19, 6]);
  }
  function eye(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - h, x + w, y);
    ctx.quadraticCurveTo(x, y + h, x - w, y);
    ctx.closePath(); ctx.stroke();
  }

  reg('resume', 'ui', function (ctx, st) {
    polyFill(ctx, [-9, -17, 19, 0, -9, 17]);
  });
  reg('pause', 'ui', function (ctx, st) {
    ctx.lineWidth = 6;
    line(ctx, -8, -16, -8, 16); line(ctx, 8, -16, 8, 16);
    ctx.lineWidth = 2;
  });
  reg('volMaster', 'ui', function (ctx, st) {
    speaker(ctx, st);
    var i;
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(st.col, 0.95 - i * 0.22); lw(ctx, 1.9);
      arcp(ctx, 1, 0, 8 + i * 6, -0.75, 0.75);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('volMusic', 'ui', function (ctx, st) {
    speaker(ctx, st);
    lw(ctx, 2.2);
    line(ctx, 9, 10, 9, -13); line(ctx, 19, 7, 19, -16);
    line(ctx, 9, -13, 19, -16);
    lw(ctx, 2);
    var f = ctx.fillStyle; ctx.fillStyle = st.ink;
    circF(ctx, 6, 11, 3.4); circF(ctx, 16, 8, 3.4);
    ctx.fillStyle = f;
  });
  reg('volSfx', 'ui', function (ctx, st) {
    speaker(ctx, st);
    lw(ctx, 2);
    poly(ctx, [3, 0, 6, -10, 9, 8, 12, -14, 15, 6, 18, -4, 20, 0], false);
  });
  reg('shake', 'ui', function (ctx, st) {
    polyFill(ctx, [-13, -13, -5, -13, -2, -17, 6, -17, 9, -13, 13, -13, 13, 12, -13, 12]);
    var f = ctx.fillStyle; ctx.fillStyle = 'rgba(0,0,0,0)';
    circ(ctx, 0, -1, 6.5); ctx.fillStyle = f;
    lw(ctx, 1.8); ctx.strokeStyle = rgba(st.col, 0.8);
    line(ctx, -19, -6, -17, -6); line(ctx, -22, 0, -18, 0); line(ctx, -19, 6, -17, 6);
    line(ctx, 19, -6, 17, -6); line(ctx, 22, 0, 18, 0); line(ctx, 19, 6, 17, 6);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('flash', 'ui', function (ctx, st) {
    circF(ctx, 0, 0, 8); circ(ctx, 0, 0, 8);
    var i, a;
    lw(ctx, 2.2);
    for (i = 0; i < 8; i++) {
      a = i / 8 * TAU + Math.PI / 8;
      line(ctx, Math.cos(a) * 13, Math.sin(a) * 13, Math.cos(a) * 21, Math.sin(a) * 21);
    }
    lw(ctx, 2);
  });
  reg('quality', 'ui', function (ctx, st) {
    // three stacked squares, each with more internal detail
    ctx.strokeStyle = rgba(st.col, 0.55); lw(ctx, 1.6);
    poly(ctx, [-21, 2, -7, 2, -7, 16, -21, 16], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    poly(ctx, [-8, -6, 8, -6, 8, 10, -8, 10], true);
    line(ctx, 0, -6, 0, 10);
    poly(ctx, [7, -17, 22, -17, 22, -2, 7, -2], true);
    lw(ctx, 1.2);
    line(ctx, 12, -17, 12, -2); line(ctx, 17, -17, 17, -2);
    line(ctx, 7, -12, 22, -12); line(ctx, 7, -7, 22, -7);
    lw(ctx, 2);
  });
  reg('colorblind', 'ui', function (ctx, st) {
    eye(ctx, 0, 0, 21, 20);
    var i, a, f = ctx.fillStyle;
    var wheel = ['#FF8A00', '#4DF3FF', '#39FF6A', '#FF3CAC'];
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU - Math.PI / 2;
      ctx.fillStyle = wheel[i];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 8.5, a, a + TAU / 4); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = f;
    circ(ctx, 0, 0, 8.5);
  });
  reg('reticle', 'ui', function (ctx, st) {
    reticle(ctx, 0, 0, 20);
    dot(ctx, st, 0, 0, 2.4);
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.55);
    circ(ctx, 0, 0, 6);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('autofire', 'ui', function (ctx, st) {
    triUp(ctx, 0, 6, 11, true);
    lw(ctx, 1.6); ctx.strokeStyle = rgba(st.col, 0.6);
    triUp(ctx, 0, 16, 7, false);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    lw(ctx, 1.9);
    arcp(ctx, 0, -2, 18, Math.PI * 1.08, Math.PI * 1.92);
    arrowAt(ctx, Math.cos(Math.PI * 1.92) * 18, -2 + Math.sin(Math.PI * 1.92) * 18, Math.PI * 1.92 + Math.PI / 2, 5);
    lw(ctx, 2);
  });
  reg('hints', 'ui', function (ctx, st) {
    roundPolyPath(ctx, 13, 4, Math.PI / 4, 3.5); ctx.fill(); ctx.stroke();
    dot(ctx, st, 0, 0, 2.6);
    lw(ctx, 1.6); ctx.strokeStyle = rgba(st.col, 0.75);
    arcp(ctx, 0, 0, 18, -0.7, 0.7); arcp(ctx, 0, 0, 22, -0.55, 0.55);
    arcp(ctx, 0, 0, 18, Math.PI - 0.7, Math.PI + 0.7);
    arcp(ctx, 0, 0, 22, Math.PI - 0.55, Math.PI + 0.55);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('quit', 'ui', function (ctx, st) {
    poly(ctx, [-19, -18, 1, -18, 1, 18, -19, 18], true);
    dot(ctx, st, -4, 1, 2.4);
    line(ctx, 6, 0, 17, 0); arrowAt(ctx, 20, 0, 0, 6.5);
  });
  reg('reroll', 'ui', function (ctx, st) {
    lw(ctx, 2.6);
    arcp(ctx, 0, 0, 16, -Math.PI * 0.35, Math.PI * 1.45);
    arrowAt(ctx, Math.cos(Math.PI * 1.45) * 16, Math.sin(Math.PI * 1.45) * 16, Math.PI * 1.95, 7);
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 2.6);
  });
  reg('skip', 'ui', function (ctx, st) {
    // heart-shard: a hollow HP segment carrying a plus (skip a draft, gain 1 HP)
    lw(ctx, 5.5);
    ctx.strokeStyle = rgba(st.col, 0.55);
    arcp(ctx, 0, 2, 22, Math.PI * 1.06, Math.PI * 1.60);
    ctx.strokeStyle = rgba(st.col, 0.9);
    arcp(ctx, 0, 2, 22, Math.PI * 1.66, Math.PI * 1.94);
    ctx.strokeStyle = st.stroke; lw(ctx, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, 19);
    ctx.quadraticCurveTo(-17, 5, -9, -4);
    ctx.quadraticCurveTo(-2, -10, 0, -2);
    ctx.quadraticCurveTo(2, -10, 9, -4);
    ctx.quadraticCurveTo(17, 5, 0, 19);
    ctx.closePath(); ctx.stroke();
    lw(ctx, 3);
    ctx.strokeStyle = st.ink;
    line(ctx, -5, 6, 5, 6); line(ctx, 0, 1, 0, 11);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('gate', 'ui', function (ctx, st) {
    lw(ctx, 2.4); circ(ctx, 0, 0, 19); lw(ctx, 2);
    var i, a;
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + Math.PI / 4;
      var cx = Math.cos(a), cy = Math.sin(a);
      poly(ctx, [cx * 16 - cy * 6, cy * 16 + cx * 6,
                 cx * 9, cy * 9,
                 cx * 16 + cy * 6, cy * 16 - cx * 6], false);
    }
    dot(ctx, st, 0, 0, 2.4);
  });
  reg('home', 'ui', function (ctx, st) {
    polyFill(ctx, [-18, -1, 0, -18, 18, -1, 18, 18, -18, 18]);
    poly(ctx, [-6, 18, -6, 5, 6, 5, 6, 18], false);
  });
  reg('infinity', 'ui', function (ctx, st) {
    lw(ctx, 2.6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-8, -16, -24, -16, -24, 0);
    ctx.bezierCurveTo(-24, 16, -8, 16, 0, 0);
    ctx.bezierCurveTo(8, -16, 24, -16, 24, 0);
    ctx.bezierCurveTo(24, 16, 8, 16, 0, 0);
    ctx.closePath(); ctx.stroke();
    lw(ctx, 2);
  });
  reg('photosensitivity', 'ui', function (ctx, st) {
    eye(ctx, 0, 0, 20, 18);
    circ(ctx, 0, 0, 7); dot(ctx, st, 0, 0, 3);
    var i, a;
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.7);
    for (i = 0; i < 6; i++) {
      a = -Math.PI * 0.9 + i * Math.PI * 0.16;
      line(ctx, Math.cos(a) * 15, Math.sin(a) * 15, Math.cos(a) * 22, Math.sin(a) * 22);
    }
    ctx.strokeStyle = st.stroke;
    lw(ctx, 3);
    line(ctx, -17, 17, 17, -17);
    lw(ctx, 2);
  });

  // ---- radial arc slider ---------------------------------------------------
  // Draws a 280-degree arc gauge around (x,y): dim track, bright value, knob.
  function slider(ctx, x, y, size, v, color) {
    var col = color || FAMILY.ui, r = size * 0.42;
    v = Math.max(0, Math.min(1, v == null ? 0 : v));
    var a0 = Math.PI * 0.72, a1 = Math.PI * 2.28;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, size * 0.055);
    ctx.strokeStyle = rgba(col, 0.22);
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    if (v > 0) {
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + (a1 - a0) * v); ctx.stroke();
    }
    var ka = a0 + (a1 - a0) * v;
    ctx.fillStyle = lighten(col, 0.5);
    ctx.beginPath(); ctx.arc(x + Math.cos(ka) * r, y + Math.sin(ka) * r, size * 0.075, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---- stroke digits (7-segment-like) --------------------------------------
  var SEG = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
    5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd'
  };
  function digit(ctx, n, x, y, size, opts) {
    opts = opts || {};
    n = ((n | 0) % 10 + 10) % 10;
    var col = opts.color || FAMILY.ui;
    var w = size * 0.26, h = size * 0.42, s = SEG[n], i;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.glow) { ctx.shadowColor = rgba(col, 0.95); ctx.shadowBlur = opts.glow * size * 0.30; }
    ctx.strokeStyle = (opts.tier >= 3) ? lighten(col, 0.35) : col;
    ctx.lineWidth = Math.max(1, size * 0.085);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var TL = [x - w, y - h], TR = [x + w, y - h], ML = [x - w, y], MR = [x + w, y],
        BL = [x - w, y + h], BR = [x + w, y + h];
    var segs = { a: [TL, TR], b: [TR, MR], c: [MR, BR], d: [BL, BR], e: [ML, BL], f: [TL, ML], g: [ML, MR] };
    for (i = 0; i < s.length; i++) {
      var g = segs[s.charAt(i)];
      line(ctx, g[0][0], g[0][1], g[1][0], g[1][1]);
    }
    ctx.restore();
  }
  function number(ctx, value, x, y, size, opts) {
    var v = Math.abs(Math.round(value)) + '', i, n = v.length;
    var adv = size * 0.64;
    var x0 = x - (n - 1) * adv * 0.5;
    for (i = n - 1; i >= 0; i--) digit(ctx, +v.charAt(i), x0 + i * adv, y, size, opts);
  }

  // ==========================================================================
  // ENEMY SHAPES  (shape = kind, per GAME_PLAN 7)
  // ==========================================================================
  var ESHAPES = {
    circle: function (ctx, st) { circF(ctx, 0, 0, 17); circ(ctx, 0, 0, 17); },
    tri: function (ctx, st) { triUp(ctx, 0, 1, 19, true); },
    square: function (ctx, st) { polyFill(ctx, [-15, -15, 15, -15, 15, 15, -15, 15]); },
    hex: function (ctx, st) { ngonF(ctx, 0, 0, 18, 6, -Math.PI / 2); },
    diamond: function (ctx, st) { diamond(ctx, 0, 0, 20, true); },
    ring: function (ctx, st) {
      lw(ctx, 3.4); circ(ctx, 0, 0, 16); lw(ctx, 2);
      ctx.strokeStyle = rgba(st.col, 0.45); circ(ctx, 0, 0, 21);
      ctx.strokeStyle = st.stroke;
    },
    needle: function (ctx, st) {
      polyFill(ctx, [0, -22, 4.5, 6, 0, 22, -4.5, 6]);
      lw(ctx, 1.3); line(ctx, 0, -16, 0, 14); lw(ctx, 2);
    },
    chevron: function (ctx, st) {
      polyFill(ctx, [0, -18, 16, 12, 0, 3, -16, 12]);
      lw(ctx, 1.4);
      line(ctx, -10, 13, -14, 20); line(ctx, 10, 13, 14, 20);
      lw(ctx, 2);
    },
    // tether pair: two diamonds joined by a beam
    pair: function (ctx, st) {
      lw(ctx, 2.6); ctx.strokeStyle = rgba(st.col, 0.8);
      line(ctx, -13, 9, 13, -9);
      ctx.strokeStyle = st.stroke; lw(ctx, 2);
      diamond(ctx, -14, 10, 9, true);
      diamond(ctx, 14, -10, 9, true);
    },
    // eclipse disc with a black core
    disc: function (ctx, st) {
      circF(ctx, 0, 0, 19); circ(ctx, 0, 0, 19);
      var f = ctx.fillStyle; ctx.fillStyle = '#05060A';
      circF(ctx, 0, 0, 9); ctx.fillStyle = f;
      circ(ctx, 0, 0, 9);
    },
    // cathedral: hex core with six orbiting nodes
    cathedral: function (ctx, st) {
      ngonF(ctx, 0, 0, 13, 6, -Math.PI / 2);
      var i, a;
      ctx.strokeStyle = rgba(st.col, 0.4); lw(ctx, 1.1); circ(ctx, 0, 0, 23);
      ctx.strokeStyle = st.stroke; lw(ctx, 2);
      for (i = 0; i < 6; i++) {
        a = i / 6 * TAU;
        ngonF(ctx, Math.cos(a) * 23, Math.sin(a) * 23, 5, 6, -Math.PI / 2);
      }
    },
    // ouroboros: a ring made of diamonds
    ouroboros: function (ctx, st) {
      var i, a, n = 10;
      for (i = 0; i < n; i++) {
        if (i === 3) continue; // the rotating gap
        a = i / n * TAU - Math.PI / 2;
        ctx.save(); ctx.translate(Math.cos(a) * 19, Math.sin(a) * 19); ctx.rotate(a);
        diamond(ctx, 0, 0, 5.4, true); ctx.restore();
      }
    },
    // invisible: dashed outline only
    ghost: function (ctx, st) {
      dash(ctx, 4, 4); lw(ctx, 2.2); circ(ctx, 0, 0, 17); undash(ctx); lw(ctx, 2);
      dot(ctx, st, 0, 0, 2.6);
    }
  };

  function enemy(ctx, shape, x, y, size, opts) {
    opts = opts || {};
    var tier = Math.max(1, Math.min(3, opts.tier || 1));
    var col = opts.color || FAMILY.enemy;
    begin(ctx, x, y, size, col, opts);
    var st = makeState(ctx, col, tier);
    ctx.strokeStyle = st.stroke; ctx.fillStyle = st.fill;
    if (opts.frame) frameCircle(ctx, st);
    var fn = ESHAPES[shape];
    if (fn) fn(ctx, st);
    undash(ctx);
    ctx.restore();
  }

  // ==========================================================================
  // BOSS GLYPHS (25) — each drawn inside a spiked circle frame
  // ==========================================================================
  var B = {};
  // walls slamming inward
  B.compactor = function (ctx, st) {
    var i, a;
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + Math.PI / 4;
      var c = Math.cos(a), s = Math.sin(a);
      ctx.save(); ctx.translate(c * 16, s * 16); ctx.rotate(a);
      polyFill(ctx, [-2, -9, 3, -9, 3, 9, -2, 9]);
      ctx.restore();
      line(ctx, c * 11, s * 11, c * 5, s * 5);
      arrowAt(ctx, c * 4, s * 4, a + Math.PI, 4.4);
    }
    dot(ctx, st, 0, 0, 2.6);
  };
  // stars joined by lethal lines
  B.constellation = function (ctx, st) {
    var p = [[-16, -10], [-2, -18], [14, -8], [7, 10], [-11, 12]];
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.75);
    poly(ctx, [p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1], p[4][0], p[4][1]], true);
    line(ctx, p[1][0], p[1][1], p[3][0], p[3][1]);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    for (var i = 0; i < 5; i++) { star4(ctx, p[i][0], p[i][1], 5); dot(ctx, st, p[i][0], p[i][1], 1.8); }
  };
  // a wall of foam with three eyes
  B.tide = function (ctx, st) {
    var r, y;
    for (r = 0; r < 3; r++) {
      y = -12 + r * 12;
      ctx.beginPath();
      ctx.moveTo(-21, y);
      ctx.quadraticCurveTo(-10, y - 6, 0, y);
      ctx.quadraticCurveTo(10, y + 6, 21, y);
      ctx.stroke();
    }
    var f = ctx.fillStyle; ctx.fillStyle = '#05060A';
    circF(ctx, -12, 0, 4.5); circF(ctx, 0, 0, 4.5); circF(ctx, 12, 0, 4.5);
    ctx.fillStyle = f;
    circ(ctx, -12, 0, 4.5); circ(ctx, 0, 0, 4.5); circ(ctx, 12, 0, 4.5);
  };
  // rotating floor with a hub
  B.turntable = function (ctx, st) {
    circ(ctx, 0, 0, 19);
    dot(ctx, st, 0, 0, 4);
    lw(ctx, 1.4); line(ctx, 0, 0, 0, -19); lw(ctx, 2);
    lw(ctx, 2.2);
    arcp(ctx, 0, 0, 12, 0.3, 2.4);
    arrowAt(ctx, Math.cos(2.4) * 12, Math.sin(2.4) * 12, 2.4 + Math.PI / 2, 5.5);
    lw(ctx, 2);
  };
  // pendulum
  B.metronome = function (ctx, st) {
    polyFill(ctx, [-13, 19, 13, 19, 6, -16, -6, -16]);
    lw(ctx, 2.2); ctx.strokeStyle = st.ink;
    line(ctx, 0, 17, 9, -13);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    dot(ctx, st, 7, -6, 4);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.5);
    arcp(ctx, 0, 17, 26, -1.9, -1.15);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a swarm forming a shape
  B.congregation = function (ctx, st) {
    var rows = [1, 2, 3, 4], i, r, y, x0;
    for (r = 0; r < rows.length; r++) {
      y = -16 + r * 10;
      x0 = -(rows[r] - 1) * 5.5;
      for (i = 0; i < rows[r]; i++) triUp(ctx, x0 + i * 11, y, 4.6, true);
    }
    ctx.strokeStyle = rgba(st.col, 0.45); lw(ctx, 1.2);
    poly(ctx, [0, -22, 20, 20, -20, 20], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // darkness punctuated by a flash
  B.strobe = function (ctx, st) {
    var f = ctx.fillStyle; ctx.fillStyle = rgba(st.col, 0.14);
    ctx.beginPath(); ctx.arc(0, 0, 19, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = f;
    circ(ctx, 0, 0, 19);
    line(ctx, 0, -19, 0, 19);
    var i, a;
    lw(ctx, 1.8);
    for (i = 0; i < 5; i++) {
      a = -Math.PI * 0.42 + i * Math.PI * 0.21;
      line(ctx, Math.cos(a) * 7, Math.sin(a) * 7, Math.cos(a) * 17, Math.sin(a) * 17);
    }
    lw(ctx, 2);
    dot(ctx, st, -9, 0, 2.6);
  };
  // a stylus redrawing the walls
  B.cartographer = function (ctx, st) {
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.6); dash(ctx, 4, 3);
    poly(ctx, [-20, 12, -10, -4, 2, 6, 12, -12], false);
    undash(ctx); ctx.strokeStyle = st.stroke; lw(ctx, 2);
    ctx.save(); ctx.translate(13, -12); ctx.rotate(0.7);
    polyFill(ctx, [-4, -18, 4, -18, 4, 4, 0, 12, -4, 4]);
    line(ctx, 0, 4, 0, 10);
    ctx.restore();
  };
  // tuning fork with beat rings
  B.cadence = function (ctx, st) {
    lw(ctx, 2.6);
    line(ctx, -7, -18, -7, 4); line(ctx, 7, -18, 7, 4);
    ctx.beginPath(); ctx.arc(0, 4, 7, 0, Math.PI); ctx.stroke();
    line(ctx, 0, 11, 0, 20);
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.6);
    arcp(ctx, 0, -6, 16, -2.5, -0.6); arcp(ctx, 0, -6, 21, -2.4, -0.7);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // your ship in negative, mirrored
  B.understudy = function (ctx, st) {
    triUp(ctx, 0, -8, 12, true);
    ctx.save(); ctx.scale(1, -1);
    dash(ctx, 3.5, 3); triUp(ctx, 0, -8, 12, false); undash(ctx);
    ctx.restore();
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.2);
    line(ctx, -20, 0, 20, 0);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a torn UI panel with something crawling out
  B.encore = function (ctx, st) {
    ctx.strokeStyle = rgba(st.col, 0.7);
    poly(ctx, [-20, -15, -3, -15, -3, 15, -20, 15], true);
    poly(ctx, [20, -15, 3, -15, 3, 15, 20, 15], true);
    ctx.strokeStyle = st.stroke;
    lw(ctx, 1.6);
    poly(ctx, [-3, -15, 1, -8, -3, -2, 1, 5, -3, 15], false);
    lw(ctx, 2);
    ngonF(ctx, 0, 0, 8, 6, -Math.PI / 2);
    dot(ctx, st, 0, 0, 2.2);
  };
  // a leviathan under the surface
  B.depth = function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(-22, 6); ctx.quadraticCurveTo(-11, 0, 0, 6);
    ctx.quadraticCurveTo(11, 12, 22, 6); ctx.stroke();
    polyFill(ctx, [-12, 6, -4, -16, 0, 6]);
    polyFill(ctx, [6, 6, 12, -8, 16, 6]);
    ctx.strokeStyle = rgba(st.col, 0.45); lw(ctx, 1.3);
    ctx.beginPath();
    ctx.moveTo(-20, 16); ctx.quadraticCurveTo(-6, 22, 6, 15);
    ctx.quadraticCurveTo(14, 10, 20, 16); ctx.stroke();
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a hook and a bait light
  B.angler = function (ctx, st) {
    lw(ctx, 2.2);
    ctx.beginPath();
    ctx.moveTo(4, -21); ctx.lineTo(4, 2);
    ctx.arc(-3, 2, 7, 0, Math.PI * 0.85);
    ctx.stroke();
    lw(ctx, 2);
    circF(ctx, -14, 12, 5);
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.2);
    circ(ctx, -14, 12, 10); circ(ctx, -14, 12, 15);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    circ(ctx, -14, 12, 5);
  };
  // a prism bouncing your shot back
  B.reflector = function (ctx, st) {
    triUp(ctx, 0, 2, 15, true);
    lw(ctx, 1.8);
    line(ctx, -22, -14, -6, -2); arrowAt(ctx, -6, -2, 0.64, 5);
    line(ctx, 6, -2, 22, -14); arrowAt(ctx, 22, -14, -0.64, 5);
    lw(ctx, 2);
    ctx.strokeStyle = rgba(st.col, 0.5);
    line(ctx, -7, 12, 7, 12);
    ctx.strokeStyle = st.stroke;
  };
  // a lens that mirrors your controls
  B.inverter = function (ctx, st) {
    circF(ctx, 0, 0, 17); circ(ctx, 0, 0, 17);
    line(ctx, 0, -17, 0, 17);
    lw(ctx, 1.9);
    line(ctx, -14, -6, -4, -6); arrowAt(ctx, -14, -6, Math.PI, 4.4);
    line(ctx, 4, 6, 14, 6); arrowAt(ctx, 14, 6, 0, 4.4);
    lw(ctx, 2);
    ctx.strokeStyle = rgba(st.col, 0.4); circ(ctx, 0, 0, 22); ctx.strokeStyle = st.stroke;
  };
  // things return later
  B.echo = function (ctx, st) {
    var i;
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(st.col, 0.95 - i * 0.3);
      lw(ctx, 2.4 - i * 0.5);
      arcp(ctx, -4 + i * 7, 0, 12 + i * 3, Math.PI * 0.55, Math.PI * 1.45);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    triUp(ctx, -13, 0, 7, true);
  };
  // a gravity bar you stand on
  B.horizon = function (ctx, st) {
    lw(ctx, 4); ctx.strokeStyle = st.ink; line(ctx, -22, 6, 22, 6);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    triUp(ctx, -6, -3, 9, true);
    var i;
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.6);
    for (i = 0; i < 5; i++) { line(ctx, -18 + i * 9, 12, -18 + i * 9, 19); arrowAt(ctx, -18 + i * 9, 20, Math.PI / 2, 3.4); }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a growing sun
  B.supernova = function (ctx, st) {
    circF(ctx, 0, 0, 11); circ(ctx, 0, 0, 11);
    var i, a;
    lw(ctx, 2.2);
    for (i = 0; i < 12; i++) {
      a = i / 12 * TAU;
      var r2 = (i % 2) ? 17 : 23;
      line(ctx, Math.cos(a) * 13, Math.sin(a) * 13, Math.cos(a) * r2, Math.sin(a) * r2);
    }
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 4);
  };
  // an eye that only opens in the dark
  B.dimmer = function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(-20, 2); ctx.quadraticCurveTo(0, -18, 20, 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-20, 2); ctx.quadraticCurveTo(0, 10, 20, 2); ctx.stroke();
    circF(ctx, 0, -1, 5);
    var i;
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.5);
    for (i = 0; i < 3; i++) line(ctx, -12 + i * 12, 10, -14 + i * 12, 18);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // something hiding behind the HUD
  B.lurker = function (ctx, st) {
    lw(ctx, 4); ctx.strokeStyle = rgba(st.col, 0.55);
    arcp(ctx, 0, 6, 20, Math.PI * 1.1, Math.PI * 1.9);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    ctx.beginPath();
    ctx.moveTo(-11, 18); ctx.lineTo(-11, 0);
    ctx.quadraticCurveTo(0, -12, 11, 0); ctx.lineTo(11, 18);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    dot(ctx, st, -5, 4, 2.4); dot(ctx, st, 5, 4, 2.4);
    lw(ctx, 1.3); line(ctx, -11, 18, 11, 18); lw(ctx, 2);
  };
  // the arena splits in two
  B.schism = function (ctx, st) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-24, -24, 22, 48); ctx.clip();
    circF(ctx, -3, 0, 19); circ(ctx, -3, 0, 19);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(2, -24, 22, 48); ctx.clip();
    circF(ctx, 3, 0, 19); circ(ctx, 3, 0, 19);
    ctx.restore();
    lw(ctx, 1.6); ctx.strokeStyle = st.ink;
    poly(ctx, [0, -22, -3, -10, 2, 0, -3, 10, 0, 22], false);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a song that drags everything in
  B.siren = function (ctx, st) {
    dot(ctx, st, 0, 0, 4);
    var i;
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(st.col, 0.85 - i * 0.22); lw(ctx, 1.7);
      arcp(ctx, 0, 0, 9 + i * 6, -1.1, 1.1);
      arcp(ctx, 0, 0, 9 + i * 6, Math.PI - 1.1, Math.PI + 1.1);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, 0, -22, 0, -13); arrowAt(ctx, 0, -11, Math.PI / 2, 5);
    line(ctx, 0, 22, 0, 13); arrowAt(ctx, 0, 11, -Math.PI / 2, 5);
  };
  // a tumbling die of rules
  B.probability = function (ctx, st) {
    ngonF(ctx, 0, 0, 20, 6, -Math.PI / 2);
    var p = ngonPts(0, 0, 20, 6, -Math.PI / 2);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.7);
    poly(ctx, [p[0], p[1], p[4], p[5], p[8], p[9]], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    dot(ctx, st, 0, -2, 2.6);
    dot(ctx, st, -6, 8, 2.2); dot(ctx, st, 6, 8, 2.2);
  };
  // the page itself
  B.page = function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(-16, -20); ctx.lineTo(8, -20); ctx.lineTo(18, -10);
    ctx.lineTo(18, 20); ctx.lineTo(-16, 20); ctx.closePath();
    ctx.fill(); ctx.stroke();
    poly(ctx, [8, -20, 8, -10, 18, -10], false);
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.65);
    line(ctx, -10, -2, 10, -2); line(ctx, -10, 5, 10, 5); line(ctx, -10, 12, 2, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // everything falls in
  B.singularity = function (ctx, st) {
    var f = ctx.fillStyle; ctx.fillStyle = '#05060A';
    circF(ctx, 0, 0, 7); ctx.fillStyle = f;
    circ(ctx, 0, 0, 7);
    ctx.save(); ctx.scale(1, 0.42);
    ctx.strokeStyle = st.ink; lw(ctx, 2.6); circ(ctx, 0, 0, 21);
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.4); circ(ctx, 0, 0, 15);
    ctx.restore();
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    var i, a;
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.7);
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + 0.5;
      line(ctx, Math.cos(a) * 22, Math.sin(a) * 22, Math.cos(a) * 12, Math.sin(a) * 12);
      arrowAt(ctx, Math.cos(a) * 11, Math.sin(a) * 11, a + Math.PI, 4);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };

  function boss(ctx, id, x, y, size, opts) {
    opts = opts || {};
    var tier = Math.max(1, Math.min(3, opts.tier || 1));
    var col = opts.color || FAMILY.boss;
    begin(ctx, x, y, size, col, opts);
    var st = makeState(ctx, col, tier);
    ctx.strokeStyle = st.stroke; ctx.fillStyle = st.fill;
    if (opts.frame !== false) frameSpiked(ctx, st);
    var fn = B[id];
    if (fn) fn(ctx, st);
    undash(ctx);
    ctx.restore();
  }

  // ==========================================================================
  // THE SHIP (draft preview) — GAME_PLAN 6.2 slots
  // slots = {trail, aura, halo, wings, fins, hull, barrels, core, orbitals, crown}
  // ==========================================================================
  var CYAN = '#4DF3FF', WHITE = '#EAFFFF', GOLD = '#FFD84D';

  function ship(ctx, x, y, size, slots, opts) {
    slots = slots || {};
    opts = opts || {};
    var col = opts.color || CYAN;
    var k = size / 76, i, a, t;
    ctx.save();
    ctx.translate(x, y);
    if (opts.rot) ctx.rotate(opts.rot);
    ctx.scale(k, k);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.glow) { ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = opts.glow * size * 0.28; }
    ctx.strokeStyle = col; ctx.fillStyle = rgba(col, 0.14);

    // aura (below everything)
    t = slots.aura | 0;
    if (t > 0) {
      ctx.fillStyle = rgba(col, 0.07); circF(ctx, 0, 0, 31); ctx.fillStyle = rgba(col, 0.14);
      if (t >= 2) { ctx.strokeStyle = rgba(col, 0.4); lw(ctx, 1.4); circ(ctx, 0, 0, 31); }
      if (t >= 3) {
        ctx.strokeStyle = rgba(col, 0.28); circ(ctx, 0, 0, 26);
        for (i = 0; i < 4; i++) { a = i / 4 * TAU + 0.5; dot(ctx, { ink: rgba(col, 0.6) }, Math.cos(a) * 31, Math.sin(a) * 31, 1.8); }
      }
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // trail (behind, below the ship)
    t = slots.trail | 0;
    if (t > 0) {
      ctx.strokeStyle = rgba(col, 0.7); lw(ctx, t >= 2 ? 3 : 2);
      if (t === 1) line(ctx, 0, 20, 0, 30);
      else if (t === 2) { line(ctx, 0, 20, 0, 34); lw(ctx, 1.4); line(ctx, 0, 34, 0, 38); }
      else {
        line(ctx, -5, 20, -6, 34); line(ctx, 5, 20, 6, 34);
        for (i = 0; i < 3; i++) dot(ctx, { ink: rgba(col, 0.55) }, (i % 2 ? 5 : -5), 30 + i * 5, 1.6);
      }
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // orbitals
    t = slots.orbitals | 0;
    if (t > 0) {
      if (t >= 3) { ctx.strokeStyle = rgba(col, 0.3); lw(ctx, 1.2); circ(ctx, 0, 0, 34); ctx.strokeStyle = col; lw(ctx, 2); }
      var n = t >= 3 ? 4 : t + 1;
      ctx.fillStyle = rgba(col, 0.35);
      for (i = 0; i < n; i++) {
        a = i / n * TAU - Math.PI / 2 + 0.4;
        ngonF(ctx, Math.cos(a) * 34, Math.sin(a) * 34, 4.6, 3 + (i % 3), a);
      }
      ctx.fillStyle = rgba(col, 0.14);
    }

    // wings
    t = slots.wings | 0;
    if (t > 0) {
      var wl = 8 + t * 5;
      ctx.fillStyle = rgba(col, 0.16);
      polyFill(ctx, [-12, 6, -12 - wl, 16 + t * 2, -14, 18]);
      polyFill(ctx, [12, 6, 12 + wl, 16 + t * 2, 14, 18]);
      if (t >= 3) {
        ctx.strokeStyle = rgba(col, 0.55); lw(ctx, 1.2);
        poly(ctx, [-13, 9, -12 - wl + 3, 16, -15, 15], false);
        poly(ctx, [13, 9, 12 + wl - 3, 16, 15, 15], false);
        ctx.strokeStyle = col; lw(ctx, 2);
      }
      ctx.fillStyle = rgba(col, 0.14);
    }

    // fins (rear)
    t = slots.fins | 0;
    if (t > 0) {
      lw(ctx, 2);
      if (t === 1) line(ctx, 0, 10, 0, 24);
      else { line(ctx, -6, 13, -8, 25); line(ctx, 6, 13, 8, 25); }
      if (t >= 3) { dot(ctx, { ink: WHITE }, -8, 26, 2); dot(ctx, { ink: WHITE }, 8, 26, 2); }
    }

    // hull
    ctx.fillStyle = rgba(col, slots.hull >= 3 ? 0.24 : 0.13);
    polyFill(ctx, [0, -30, 18, 20, 0, 10, -18, 20]);
    t = slots.hull | 0;
    if (t >= 1) { ctx.strokeStyle = rgba(col, 0.55); lw(ctx, 1.2); poly(ctx, [0, -21, 11, 13, 0, 6, -11, 13], true); }
    if (t >= 2) { ctx.strokeStyle = WHITE; lw(ctx, 1.1); poly(ctx, [0, -30, 18, 20, 0, 10, -18, 20], true); }
    if (t >= 3) {
      ctx.strokeStyle = rgba(col, 0.4); lw(ctx, 1);
      line(ctx, -9, -2, 9, -2); line(ctx, -13, 8, 13, 8); line(ctx, 0, -21, 0, 6);
    }
    ctx.strokeStyle = col; lw(ctx, 2);

    // barrels
    t = slots.barrels | 0;
    if (t > 0) {
      lw(ctx, 2.4);
      if (t === 1) line(ctx, 0, -30, 0, -37);
      else if (t === 2) { line(ctx, -6, -16, -7, -26); line(ctx, 6, -16, 7, -26); }
      else {
        line(ctx, 0, -30, 0, -38);
        line(ctx, -7, -15, -10, -26); line(ctx, 7, -15, 10, -26);
        line(ctx, -12, 2, -16, -8); line(ctx, 12, 2, 16, -8);
      }
      lw(ctx, 2);
    }

    // halo (mana)
    t = slots.halo | 0;
    if (t > 0) {
      ctx.strokeStyle = t >= 3 ? GOLD : rgba(col, 0.8);
      lw(ctx, 2.2);
      if (t >= 3) circ(ctx, 0, 0, 27);
      else arcp(ctx, 0, 0, 27, Math.PI * 1.12, Math.PI * 1.88);
      if (t >= 2) {
        lw(ctx, 1.4);
        for (i = 0; i < 5; i++) {
          a = Math.PI * 1.15 + i * Math.PI * 0.175;
          line(ctx, Math.cos(a) * 27, Math.sin(a) * 27, Math.cos(a) * 31, Math.sin(a) * 31);
        }
      }
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // crown (wildcards)
    t = slots.crown | 0;
    if (t > 0) {
      ctx.strokeStyle = GOLD; lw(ctx, 1.8);
      poly(ctx, [-9, -34, -6, -42, -2, -35, 2, -43, 6, -35, 9, -41], false);
      if (t >= 2) line(ctx, -9, -34, 9, -34);
      if (t >= 3) dot(ctx, { ink: GOLD }, 0, -47, 2.2);
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // core (always; brightest thing near the ship)
    t = slots.core | 0;
    var cr = 3 + t * 0.9;
    if (t >= 2) { ctx.strokeStyle = rgba(WHITE, 0.5); lw(ctx, 1.2); circ(ctx, 0, 1, cr + 4.5); }
    if (t >= 3) {
      ctx.strokeStyle = rgba(WHITE, 0.45); lw(ctx, 1.2);
      line(ctx, -14, 1, -cr - 3, 1); line(ctx, cr + 3, 1, 14, 1);
    }
    ctx.fillStyle = WHITE; circF(ctx, 0, 1, cr);
    ctx.restore();
  }

  // ==========================================================================
  // exports
  // ==========================================================================
  var UPGRADE_IDS = [
    'twinBarrels', 'railgun', 'buckshot', 'mortar', 'gatling',
    'blast', 'ricochet', 'drill', 'seeker', 'voltaic',
    'overdrive', 'chrono', 'pulse', 'siphon', 'overcharge', 'arcane',
    'afterburner', 'phase', 'drift', 'blink',
    'hullPlating', 'vent', 'ghost',
    'reaper', 'impact', 'wake', 'spendthrift', 'overkill',
    'shardOrbit', 'drone', 'turret', 'mirror',
    'mines', 'stormCloud', 'gravityWell', 'burnTrail',
    'ghostRounds', 'claustrophobia', 'glassHull', 'berserk', 'feedbackLoop', 'gambler'
  ];
  var UI_IDS = [
    'resume', 'pause', 'volMaster', 'volMusic', 'volSfx', 'shake', 'flash',
    'quality', 'colorblind', 'reticle', 'autofire', 'hints', 'quit',
    'reroll', 'skip', 'gate', 'home', 'infinity', 'photosensitivity'
  ];
  var BOSS_IDS = [
    'compactor', 'constellation', 'tide', 'turntable', 'metronome', 'congregation',
    'strobe', 'cartographer', 'cadence', 'understudy', 'encore', 'depth',
    'angler', 'reflector', 'inverter', 'echo', 'horizon', 'supernova',
    'dimmer', 'lurker', 'schism', 'siren', 'probability', 'page', 'singularity'
  ];
  var ENEMY_SHAPES = [
    'circle', 'tri', 'square', 'hex', 'diamond', 'ring', 'needle', 'chevron',
    'pair', 'disc', 'cathedral', 'ouroboros', 'ghost'
  ];

  NA.Icons = {
    draw: draw,
    enemy: enemy,
    boss: boss,
    ship: ship,
    digit: digit,
    number: number,
    slider: slider,
    ids: UPGRADE_IDS,
    uiIds: UI_IDS,
    bossIds: BOSS_IDS,
    enemyShapes: ENEMY_SHAPES,
    colors: FAMILY,
    has: function (id) { return !!G[id]; },
    familyOf: function (id) { return FAM_OF[id] || 'ui'; },
    family: function (id) { return FAMILY[FAM_OF[id]] || FAMILY.ui; }
  };
})();

/* ===== 05_pools.js ===== */
/* 05_pools.js — structure-of-arrays pool factory and uniform spatial hash.
 *
 * Public API
 *   NA.Pool.create(cap, fields)   fields = {name:'f32'|'i32'|'u8'|'u16'|'i16'}
 *     -> pool { cap, n, <field arrays>, alloc() -> i|-1, free(i), clear(), each(cb) }
 *     Pools are dense: live entries are 0..n-1 and free(i) swap-removes, so
 *     indices are NOT stable across frames. Anything that needs a stable handle
 *     stores (index, gen) and checks pool.gen[i].
 *
 *   NA.Grid.create(cellSize, cap) -> grid { begin(), insert(i,x,y), query(x,y,r,out) -> count,
 *                                           queryCb(x,y,r,cb) }
 */
(function () {
  var TYPES = {
    f32: Float32Array, i32: Int32Array, u8: Uint8Array,
    u16: Uint16Array, i16: Int16Array, u32: Uint32Array
  };

  NA.Pool = {
    create: function (cap, fields) {
      var p = { cap: cap, n: 0, _fields: [] };
      for (var k in fields) {
        var T = TYPES[fields[k]] || Float32Array;
        p[k] = new T(cap);
        p._fields.push(k);
      }
      if (!p.gen) { p.gen = new Uint32Array(cap); p._fields.push('gen'); }

      p.alloc = function () {
        if (p.n >= p.cap) return -1;
        var i = p.n++;
        for (var f = 0; f < p._fields.length; f++) {
          var key = p._fields[f];
          if (key !== 'gen') p[key][i] = 0;
        }
        p.gen[i] = (p.gen[i] + 1) >>> 0;
        return i;
      };
      // swap-remove; returns the index that moved into slot i (or -1)
      p.free = function (i) {
        if (i < 0 || i >= p.n) return -1;
        var last = --p.n;
        if (i !== last) {
          for (var f = 0; f < p._fields.length; f++) {
            var key = p._fields[f];
            p[key][i] = p[key][last];
          }
          return last;
        }
        return -1;
      };
      p.clear = function () { p.n = 0; };
      p.each = function (cb) { for (var i = 0; i < p.n; i++) cb(i); };
      return p;
    }
  };

  /* Uniform spatial hash over a fixed bucket table. Rebuilt every frame with
   * begin(); no allocation after construction. Buckets are singly-linked lists
   * stored in two Int32Arrays (head + next). */
  NA.Grid = {
    create: function (cellSize, cap, cols) {
      cols = cols || 128;
      var g = {
        cell: cellSize, inv: 1 / cellSize, cols: cols, rows: cols,
        head: new Int32Array(cols * cols),
        next: new Int32Array(cap),
        px: new Float32Array(cap),
        py: new Float32Array(cap),
        out: new Int32Array(1024),
        count: 0
      };
      g.head.fill(-1);
      g._key = function (cx, cy) {
        // wrap so the hash covers any world position without bounds checks
        var x = cx & (g.cols - 1), y = cy & (g.rows - 1);
        return y * g.cols + x;
      };
      g.begin = function () { g.head.fill(-1); g.count = 0; };
      g.insert = function (i, x, y) {
        if (i >= g.next.length) return;
        var cx = Math.floor(x * g.inv), cy = Math.floor(y * g.inv);
        var k = g._key(cx, cy);
        g.next[i] = g.head[k]; g.head[k] = i;
        g.px[i] = x; g.py[i] = y;
        g.count++;
      };
      /* Calls cb(i) for every candidate within the cell footprint of (x,y,r).
       * Callers still do the exact squared-distance test. */
      g.queryCb = function (x, y, r, cb) {
        var x0 = Math.floor((x - r) * g.inv), x1 = Math.floor((x + r) * g.inv);
        var y0 = Math.floor((y - r) * g.inv), y1 = Math.floor((y + r) * g.inv);
        if (x1 - x0 > g.cols - 1) { x0 = 0; x1 = g.cols - 1; }
        if (y1 - y0 > g.rows - 1) { y0 = 0; y1 = g.rows - 1; }
        for (var cy = y0; cy <= y1; cy++) {
          for (var cx = x0; cx <= x1; cx++) {
            var i = g.head[g._key(cx, cy)];
            while (i !== -1) { cb(i); i = g.next[i]; }
          }
        }
      };
      // fills g.out, returns count (bounded by g.out.length)
      g.query = function (x, y, r) {
        var n = 0, out = g.out, cap2 = out.length;
        var x0 = Math.floor((x - r) * g.inv), x1 = Math.floor((x + r) * g.inv);
        var y0 = Math.floor((y - r) * g.inv), y1 = Math.floor((y + r) * g.inv);
        if (x1 - x0 > g.cols - 1) { x0 = 0; x1 = g.cols - 1; }
        if (y1 - y0 > g.rows - 1) { y0 = 0; y1 = g.rows - 1; }
        var r2 = r * r;
        for (var cy = y0; cy <= y1; cy++) {
          for (var cx = x0; cx <= x1; cx++) {
            var i = g.head[g._key(cx, cy)];
            while (i !== -1) {
              var dx = g.px[i] - x, dy = g.py[i] - y;
              if (dx * dx + dy * dy <= r2) { if (n < cap2) out[n++] = i; }
              i = g.next[i];
            }
          }
        }
        return n;
      };
      return g;
    }
  };
})();

/* ===== 06_arena.js ===== */
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
    },

    setShape: function (s) { A.shape = s; },
    setRadius: function (r, sec) {
      r = M.clamp(r, C.ARENA_MIN_R, C.ARENA_R * 1.4);
      A._rFrom = A.radius; A._rTo = r; A._rDur = sec || 0; A._rT = 0;
      if (!sec) A.radius = r;
      if (r < A.radius) A._markCrush(0, SEG, 2);
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

    depth: function (x, y) {
      var dx = x - A.cx, dy = y - A.cy;
      var d = Math.sqrt(dx * dx + dy * dy);
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
      for (var i = 0; i < SEG; i++) {
        var d = A.sidesTarget[i] - A.sides[i];
        if (d !== 0) A.sides[i] += M.clamp(d, -140 * dt, 90 * dt);
        if (A.crush[i] > 0) A.crush[i] -= dt;
      }
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

    /* -------------------------------------------------------------- render */
    render: function () {
      var R = NA.R, L = R.L;
      var col = A.membraneCol;
      // tint hotter as the arena shrinks: radius is tension without a HUD
      var tr = M.lerp(col[0], 1.0, A.tint * 0.8);
      var tg = M.lerp(col[1], 0.42, A.tint * 0.8);
      var tb = M.lerp(col[2], 0.42, A.tint * 0.8);

      var steps = A.shape === 'hex' ? 96 : 84;
      var pulse = 0.72 + 0.10 * Math.sin(NA.Time.t * 1.7);
      var px = 0, py = 0;
      for (var i = 0; i <= steps; i++) {
        var a = i / steps * M.TAU;
        var rr = A.radiusAt(a);
        var x = A.cx + Math.cos(a) * rr, y = A.cy + Math.sin(a) * rr;
        if (i > 0) {
          R.line(L.MEMBRANE, px, py, x, y, 3.4, tr, tg, tb, pulse);
          // soft inner glow band
          var ir = rr - 22;
          R.line(L.MEMBRANE, A.cx + Math.cos(a - M.TAU / steps) * ir, A.cy + Math.sin(a - M.TAU / steps) * ir,
            A.cx + Math.cos(a) * ir, A.cy + Math.sin(a) * ir, 34, tr, tg, tb, 0.10 + A.tint * 0.06);
        }
        px = x; py = y;
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

/* ===== 07_fx.js ===== */
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
      NA.R.setPost({
        chroma: FX._chroma, vignette: FX.vignette, hue: FX._hue,
        darkness: FX._dark, flash: FX._flash, desat: FX._desat
      });
    },
    reset: function () {
      FX._flash = FX._chroma = FX._desat = FX._hue = FX._dark = 0;
      FX.vignette = 0.32;
    }
  };

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
      for (i = 0; i < AI.n; i++) {
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

/* ===== 08_bullets.js ===== */
/* 08_bullets.js — player and enemy projectile pools (SoA), collision, graze.
 *
 * Public API
 *   NA.Bullets.P / NA.Bullets.E            the two SoA pools (see fields below)
 *   NA.Bullets.firePlayer(x,y,vx,vy,o) -> i
 *   NA.Bullets.fireEnemy(x,y,vx,vy,o) -> i
 *   NA.Bullets.killP(i) / NA.Bullets.killE(i)
 *   NA.Bullets.explode(x,y,radius,dmg,owner)
 *   NA.Bullets.clearArea(x,y,radius,convert) -> n      mercy ring / Pulse; convert steals them
 *   NA.Bullets.update(dt) / render() / reset()
 *   NA.Bullets.FLAG                        {INVISIBLE, WALLPHASE, GRAZED, NOWALL, ENEMYHURT}
 *
 * SoA fields (both pools): x y vx vy rot life maxLife dmg size pierce bounce
 *   homing explode owner flags r g b a hitCd
 *   `owner`  0 = player, 1 = enemy, >=2 = a specific enemy/boss id (for friendly fire rules)
 *   `homing` 0..1 turn strength; `explode` radius in world units, 0 = none.
 */
(function () {
  var M = NA.M, C = NA.C;

  var FIELDS = {
    x: 'f32', y: 'f32', vx: 'f32', vy: 'f32', rot: 'f32',
    life: 'f32', maxLife: 'f32', dmg: 'f32', size: 'f32',
    pierce: 'i16', bounce: 'i16', homing: 'f32', explode: 'f32',
    owner: 'i32', flags: 'i32', r: 'f32', g: 'f32', b: 'f32', a: 'f32',
    hitCd: 'f32', px: 'f32', py: 'f32'
  };

  var P = NA.Pool.create(C.MAX_PBULLETS, FIELDS);
  var E = NA.Pool.create(C.MAX_EBULLETS, FIELDS);

  var FLAG = { INVISIBLE: 1, WALLPHASE: 2, GRAZED: 4, NOWALL: 8, ENEMYHURT: 16, STOLEN: 32 };

  // one reusable hook context — no per-hit allocation
  var HCTX = { x: 0, y: 0, bi: 0, ei: 0, dmg: 0, kill: false, owner: 0, nx: 0, ny: 0 };

  var B = NA.Bullets = {
    P: P, E: E, FLAG: FLAG,
    grazeCount: 0, hits: 0,

    reset: function () { P.clear(); E.clear(); B.grazeCount = 0; },

    firePlayer: function (x, y, vx, vy, o) {
      var i = P.alloc(); if (i < 0) return -1;
      o = o || EMPTY;
      P.x[i] = P.px[i] = x; P.y[i] = P.py[i] = y; P.vx[i] = vx; P.vy[i] = vy;
      P.rot[i] = Math.atan2(vy, vx);
      P.life[i] = P.maxLife[i] = o.life || C.BULLET_LIFE;
      P.dmg[i] = o.dmg === undefined ? C.BULLET_DMG : o.dmg;
      P.size[i] = o.size || 7;
      P.pierce[i] = o.pierce || 0; P.bounce[i] = o.bounce || 0;
      P.homing[i] = o.homing || 0; P.explode[i] = o.explode || 0;
      P.owner[i] = 0; P.flags[i] = o.flags || 0; P.hitCd[i] = 0;
      P.r[i] = o.r === undefined ? 1 : o.r; P.g[i] = o.g === undefined ? 1 : o.g;
      P.b[i] = o.b === undefined ? 1 : o.b; P.a[i] = o.a === undefined ? 1 : o.a;
      return i;
    },

    fireEnemy: function (x, y, vx, vy, o) {
      var i = E.alloc(); if (i < 0) return -1;
      o = o || EMPTY;
      E.x[i] = E.px[i] = x; E.y[i] = E.py[i] = y; E.vx[i] = vx; E.vy[i] = vy;
      E.rot[i] = Math.atan2(vy, vx);
      E.life[i] = E.maxLife[i] = o.life || 5;
      E.dmg[i] = o.dmg === undefined ? 1 : o.dmg;
      E.size[i] = o.size || 8;
      E.pierce[i] = o.pierce || 0; E.bounce[i] = o.bounce || 0;
      E.homing[i] = o.homing || 0; E.explode[i] = o.explode || 0;
      E.owner[i] = o.owner === undefined ? 1 : o.owner;
      E.flags[i] = o.flags || 0; E.hitCd[i] = 0;
      var col = o.color;
      E.r[i] = col ? col[0] : 1; E.g[i] = col ? col[1] : 0.847; E.b[i] = col ? col[2] : 0.302;
      E.a[i] = o.a === undefined ? 1 : o.a;
      return i;
    },

    killP: function (i, silent) {
      if (!silent) {
        NA.Particles.burst(P.x[i], P.y[i], 2, 60, 0.16, P.r[i], P.g[i], P.b[i], 0);
      }
      P.free(i);
    },
    killE: function (i, silent) {
      if (!silent) NA.Particles.burst(E.x[i], E.y[i], 2, 60, 0.16, E.r[i], E.g[i], E.b[i], 0);
      E.free(i);
    },

    /* Area damage. Used by Blast, Mortar shells, Bloats, boss slams. */
    explode: function (x, y, radius, dmg, owner) {
      var col = owner === 0 ? [1, 0.541, 0] : [1, 0.18, 0.30];
      NA.Particles.ring(x, y, radius * 0.25, radius, 0.32, 4, col[0], col[1], col[2], 1);
      NA.Particles.burst(x, y, 10, radius * 2.6, 0.3, col[0], col[1], col[2], 1);
      NA.FX.trauma(0.05 + Math.min(0.12, radius / 1400));
      if (NA.Enemies) NA.Enemies.damageArea(x, y, radius, dmg, owner === 0 ? 'player' : 'enemy');
      if (owner !== 0 && NA.Player && NA.Player.alive) {
        if (M.dist2(x, y, NA.Player.x, NA.Player.y) < radius * radius) NA.Player.damage(1, x, y);
      }
      if (NA.Audio) NA.Audio.sfx('explode', { x: x, y: y });
    },

    /* Mercy ring / Pulse. When convert is true the bullets become yours. */
    clearArea: function (x, y, radius, convert) {
      var r2 = radius * radius, n = 0;
      for (var i = 0; i < E.n; i++) {
        var dx = E.x[i] - x, dy = E.y[i] - y;
        if (dx * dx + dy * dy > r2) continue;
        if (convert) {
          var sp = Math.sqrt(E.vx[i] * E.vx[i] + E.vy[i] * E.vy[i]) || 400;
          var ang = NA.Enemies ? NA.Enemies.nearestAngle(E.x[i], E.y[i]) : Math.atan2(-E.vy[i], -E.vx[i]);
          B.firePlayer(E.x[i], E.y[i], Math.cos(ang) * sp, Math.sin(ang) * sp,
            { dmg: C.BULLET_DMG, size: 7, flags: FLAG.STOLEN });
        }
        NA.Particles.burst(E.x[i], E.y[i], 3, 120, 0.2, 0.6, 0.9, 1, 1);
        E.free(i); i--; n++;
      }
      if (n) NA.Particles.ring(x, y, radius * 0.3, radius, 0.28, 3, 0.6, 0.95, 1, 0.9);
      return n;
    },

    /* ------------------------------------------------------------- update */
    update: function (dt) {
      var i, o;
      var pl = NA.Player;
      var arena = NA.Arena;
      var eg = NA.Enemies ? NA.Enemies.grid : null;

      /* ---- player bullets ------------------------------------------- */
      for (i = 0; i < P.n; i++) {
        P.life[i] -= dt;
        if (P.life[i] <= 0) { P.free(i); i--; continue; }
        P.px[i] = P.x[i]; P.py[i] = P.y[i];

        if (P.homing[i] > 0 && NA.Enemies) {
          var tgt = NA.Enemies.nearestTo(P.x[i], P.y[i], 620);
          if (tgt >= 0) {
            var want = Math.atan2(NA.Enemies.y[tgt] - P.y[i], NA.Enemies.x[tgt] - P.x[i]);
            var cur = P.rot[i];
            var na = cur + M.norm(want - cur) * Math.min(1, P.homing[i] * dt * 9);
            var sp = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]);
            P.vx[i] = Math.cos(na) * sp; P.vy[i] = Math.sin(na) * sp; P.rot[i] = na;
          }
        }
        P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;

        // mirror walls reflect player projectiles
        if (arena.mirrorWalls.length) {
          var w = arena.segmentBlocked(P.px[i], P.py[i], P.x[i], P.y[i]);
          if (w) {
            var ow = arena._out;
            var vn = P.vx[i] * ow.nx + P.vy[i] * ow.ny;
            P.vx[i] -= 2 * vn * ow.nx; P.vy[i] -= 2 * vn * ow.ny;
            P.x[i] = ow.x + ow.nx * (vn > 0 ? -2 : 2); P.y[i] = ow.y + ow.ny * (vn > 0 ? -2 : 2);
            P.rot[i] = Math.atan2(P.vy[i], P.vx[i]);
            NA.Particles.burst(ow.x, ow.y, 3, 130, 0.2, 1, 0.4, 0.8, 0);
          }
        }

        // boundary
        var d = arena.depth(P.x[i], P.y[i]);
        if (d < 0 && !(P.flags[i] & FLAG.WALLPHASE)) {
          if (P.bounce[i] > 0) {
            P.bounce[i]--;
            var ang0 = Math.atan2(P.y[i] - arena.cy, P.x[i] - arena.cx);
            var nx = -Math.cos(ang0), ny = -Math.sin(ang0);
            var vn2 = P.vx[i] * nx + P.vy[i] * ny;
            P.vx[i] -= 2 * vn2 * nx; P.vy[i] -= 2 * vn2 * ny;
            P.rot[i] = Math.atan2(P.vy[i], P.vx[i]);
            var rr = arena.radiusAt(ang0) - 3;
            P.x[i] = arena.cx + Math.cos(ang0) * rr; P.y[i] = arena.cy + Math.sin(ang0) * rr;
            arena.ripple(P.x[i], P.y[i], 0.7, 1, 1, 1);
            if (NA.Audio) NA.Audio.sfx('wall', { x: P.x[i], y: P.y[i] });
          } else {
            arena.ripple(P.x[i], P.y[i], 0.5, 1, 1, 1);
            if (P.explode[i] > 0) B.explode(P.x[i], P.y[i], P.explode[i], P.dmg[i], 0);
            B.killP(i); i--; continue;
          }
        }

        // the boss
        if (NA.Bosses && NA.Bosses.active && NA.Bosses.active.state === 'fight') {
          if (NA.Bosses.hit(P.x[i], P.y[i], P.size[i], P.dmg[i])) {
            if (P.explode[i] > 0) B.explode(P.x[i], P.y[i], P.explode[i], P.dmg[i] * 0.7, 0);
            if (P.pierce[i] > 0) P.pierce[i]--;
            else { B.killP(i, true); i--; continue; }
          }
        }

        // enemies
        if (eg && NA.Enemies.n > 0) {
          var cnt = eg.query(P.x[i], P.y[i], P.size[i] + 46);
          var out = eg.out, dead = false;
          for (var q = 0; q < cnt; q++) {
            var ei = out[q];
            if (ei >= NA.Enemies.n) continue;
            if (NA.Enemies.intangible[ei] > 0) continue;
            var rr2 = P.size[i] + NA.Enemies.size[ei];
            var ddx = NA.Enemies.x[ei] - P.x[i], ddy = NA.Enemies.y[ei] - P.y[i];
            if (ddx * ddx + ddy * ddy > rr2 * rr2) continue;
            if (NA.Enemies.shielded(ei, P.x[i], P.y[i])) continue;

            var dmg = P.dmg[i];
            HCTX.x = P.x[i]; HCTX.y = P.y[i]; HCTX.bi = i; HCTX.ei = ei; HCTX.dmg = dmg;
            HCTX.owner = 0; HCTX.kill = false;
            HCTX.nx = ddx; HCTX.ny = ddy;
            var killed = NA.Enemies.damage(ei, dmg, 'player');
            HCTX.kill = killed;
            B.hits++;
            if (NA.Upgrades) NA.Upgrades.emit('onHit', HCTX);
            if (P.explode[i] > 0) B.explode(P.x[i], P.y[i], P.explode[i], dmg * 0.7, 0);
            NA.Particles.burst(P.x[i], P.y[i], 3, 150, 0.18, 1, 1, 1, 1);
            if (P.pierce[i] > 0) { P.pierce[i]--; }
            else { B.killP(i, true); dead = true; }
            break;
          }
          if (dead) { i--; continue; }
        }
      }

      /* ---- enemy bullets -------------------------------------------- */
      var px = pl ? pl.x : 0, py = pl ? pl.y : 0;
      var grazeR = C.GRAZE_R + (pl ? pl.grazeBonus : 0);
      for (i = 0; i < E.n; i++) {
        E.life[i] -= dt;
        if (E.life[i] <= 0) { E.free(i); i--; continue; }
        E.px[i] = E.x[i]; E.py[i] = E.y[i];
        if (E.homing[i] > 0 && pl && pl.alive) {
          var wa = Math.atan2(py - E.y[i], px - E.x[i]);
          var na2 = E.rot[i] + M.norm(wa - E.rot[i]) * Math.min(1, E.homing[i] * dt * 5);
          var sp2 = Math.sqrt(E.vx[i] * E.vx[i] + E.vy[i] * E.vy[i]);
          E.vx[i] = Math.cos(na2) * sp2; E.vy[i] = Math.sin(na2) * sp2; E.rot[i] = na2;
        }
        E.x[i] += E.vx[i] * dt; E.y[i] += E.vy[i] * dt;

        // enemy bullets pop against the membrane
        if (arena.depth(E.x[i], E.y[i]) < 0) {
          if (E.bounce[i] > 0) {
            E.bounce[i]--;
            var a3 = Math.atan2(E.y[i] - arena.cy, E.x[i] - arena.cx);
            var nx3 = -Math.cos(a3), ny3 = -Math.sin(a3);
            var vn3 = E.vx[i] * nx3 + E.vy[i] * ny3;
            E.vx[i] -= 2 * vn3 * nx3; E.vy[i] -= 2 * vn3 * ny3;
            E.rot[i] = Math.atan2(E.vy[i], E.vx[i]);
            var rr3 = arena.radiusAt(a3) - 3;
            E.x[i] = arena.cx + Math.cos(a3) * rr3; E.y[i] = arena.cy + Math.sin(a3) * rr3;
          } else {
            arena.ripple(E.x[i], E.y[i], 0.35, E.r[i], E.g[i], E.b[i]);
            B.killE(i); i--; continue;
          }
        }

        if (!pl || !pl.alive) continue;
        var bdx = E.x[i] - px, bdy = E.y[i] - py;
        var bd2 = bdx * bdx + bdy * bdy;
        var hitR = E.size[i] + C.SHIP_R;
        if (bd2 <= hitR * hitR) {
          if (pl.invuln <= 0 && pl.dashIFrame <= 0) {
            pl.damage(E.dmg[i], E.x[i], E.y[i]);
            B.killE(i); i--; continue;
          }
        } else if (!(E.flags[i] & FLAG.GRAZED) && bd2 <= (hitR + grazeR) * (hitR + grazeR)) {
          // graze: the skill economy
          E.flags[i] |= FLAG.GRAZED;
          pl.addMana(C.MANA_GRAZE * pl.grazeMul, 'graze');
          B.grazeCount++;
          NA.Particles.burst(E.x[i], E.y[i], 2, 90, 0.2, 0.4, 1, 1, 1);
          if (NA.Audio) NA.Audio.sfx('graze', { x: E.x[i], y: E.y[i] });
        }
      }
    },

    /* ------------------------------------------------------------- render */
    render: function () {
      var R = NA.R, L = R.L, i;
      var reveal = NA.Events ? NA.Events.revealAlpha(0, 0) : 0;
      for (i = 0; i < E.n; i++) {
        var ea = E.a[i];
        if (E.flags[i] & FLAG.INVISIBLE) ea *= reveal;
        if (ea <= 0.01) continue;
        // enemy shots: small filled circles with a dark rim, 80% brightness
        R.sprite(L.EBULLETS, 'dotRim', E.x[i], E.y[i], E.rot[i], E.size[i] * 1.05, E.size[i] * 1.05,
          E.r[i] * 0.86, E.g[i] * 0.86, E.b[i] * 0.86, ea);
      }
      for (i = 0; i < P.n; i++) {
        var pa = P.a[i];
        if (P.flags[i] & FLAG.INVISIBLE) pa *= 0.06;
        if (pa <= 0.01) continue;
        // player shots: short capsules stretched along velocity, pure white
        var stretch = P.size[i] * 2.6;
        R.sprite(L.PBULLETS, 'capsule', P.x[i], P.y[i], P.rot[i], stretch, P.size[i] * 0.72,
          P.r[i], P.g[i], P.b[i], pa);
        R.sprite(L.PBULLETS, 'spark', P.x[i], P.y[i], 0, P.size[i] * 1.7, P.size[i] * 1.7,
          0.30, 0.95, 1.0, pa * 0.55);
      }
    }
  };

  var EMPTY = {};
})();

/* ===== 09_player.js ===== */
/* 09_player.js — the ship: movement, aim, fire, dash, HP, mana, death shatter,
 * and the nine-slot ship visual system.
 *
 * Public API
 *   NA.Player.reset(opts) / update(dt) / render()
 *   NA.Player.x y vx vy angle hp maxHp mana manaMax alive invuln dashIFrame
 *   NA.Player.stats        {fireRate, damage, speed, bulletSpeed, bulletSize, count,
 *                           spread, pierce, bounce, homing, explode, life, manaTrickle,
 *                           dashCost, dashDist, grazeMul}
 *   NA.Player.damage(n, srcX, srcY) -> bool
 *   NA.Player.addMana(n, source) / NA.Player.spend(n, tag) -> bool
 *   NA.Player.dash() -> bool
 *   NA.Player.fire(force)              one volley now, ignoring the cooldown when force
 *   NA.Player.onKill(ei)               called by NA.Enemies on every kill
 *   NA.Player.heal(n) / NA.Player.kill()
 *   NA.Player.aimX / aimY              the reticle in world space
 *
 *   NA.Ship.slots                      {trail,aura,halo,wings,fins,hull,barrels,core,orbitals,crown}
 *   NA.Ship.setSlot(slot, tier)        tier 0..3 (crown 0..1); content agents map upgrades here
 *   NA.Ship.getSlot(slot) -> tier
 *   NA.Ship.reset()
 *   NA.Ship.render(x, y, rot, alpha, scale, colOverride)
 *   NA.Ship.SLOTS                      the ordered slot id list (z-order)
 */
(function () {
  var M = NA.M, C = NA.C;

  /* ================================================================== SHIP */
  var SLOTS = ['aura', 'halo', 'trail', 'wings', 'fins', 'hull', 'barrels', 'orbitals', 'core', 'crown'];
  var Ship = NA.Ship = {
    SLOTS: SLOTS,
    slots: { aura: 0, halo: 0, trail: 0, wings: 0, fins: 0, hull: 0, barrels: 0, orbitals: 0, core: 0, crown: 0 },
    tint: null,          // [r,g,b] override from Hull tint upgrades
    // all rotating parts share exactly two angular speeds
    SPIN_A: 1.15, SPIN_B: -0.62,

    reset: function () {
      for (var k in Ship.slots) Ship.slots[k] = 0;
      Ship.tint = null;
    },
    setSlot: function (slot, tier) {
      if (!(slot in Ship.slots)) return false;
      Ship.slots[slot] = M.clamp(tier | 0, 0, slot === 'crown' ? 1 : 3);
      return true;
    },
    getSlot: function (slot) { return Ship.slots[slot] || 0; },

    /* One machine, always. Parts attach outward; the core dot never changes size
     * and is always the brightest pixel near the ship. */
    render: function (x, y, rot, alpha, scale, colOv) {
      var R = NA.R, L = R.L, s = Ship.slots;
      scale = scale || 1;
      alpha = alpha === undefined ? 1 : alpha;
      var base = C.SHIP_R * scale;
      var col = colOv || Ship.tint || C.COL.player;
      var cr = col[0], cg = col[1], cb = col[2];
      var t = NA.Time.t;
      var sa = t * Ship.SPIN_A, sb = t * Ship.SPIN_B;

      // ---- aura (Ghost, Vent, Feedback Loop)
      if (s.aura > 0) {
        R.disc(L.PLAYER, x, y, base * (2.6 + s.aura * 0.35), cr, cg, cb, 0.05 * alpha);
        if (s.aura >= 2) R.ring(L.PLAYER, x, y, base * 3.1, 1.4, cr, cg, cb, 0.24 * alpha);
        if (s.aura >= 3) {
          R.ring(L.PLAYER, x, y, base * 3.9, 1.2, cr, cg, cb, 0.18 * alpha);
          for (var m = 0; m < 4; m++) {
            var ma = sa + m * M.HALFPI;
            R.dot(L.PLAYER, x + Math.cos(ma) * base * 3.5, y + Math.sin(ma) * base * 3.5, base * 0.15, 1, 1, 1, 0.5 * alpha);
          }
        }
      }
      // ---- halo (mana: Overcharge, Spendthrift) — gold, drawn as an arc behind
      if (s.halo > 0) {
        var g = C.COL.gold;
        var frac = NA.Player ? NA.Player.mana / NA.Player.manaMax : 1;
        var a0 = rot + Math.PI * 0.55, a1 = a0 + Math.PI * 0.9 * (s.halo >= 3 ? 1 : frac);
        R.arc(L.PLAYER, x, y, base * 2.15, a0, a1, 2.2, g[0], g[1], g[2], 0.5 * alpha);
        if (s.halo >= 2) for (var tk = 0; tk < 6; tk++) {
          var ta = a0 + (a1 - a0) * (tk / 5);
          R.line(L.PLAYER, x + Math.cos(ta) * base * 1.95, y + Math.sin(ta) * base * 1.95,
            x + Math.cos(ta) * base * 2.35, y + Math.sin(ta) * base * 2.35, 1.4, g[0], g[1], g[2], 0.45 * alpha);
        }
        if (s.halo >= 3) R.ring(L.PLAYER, x, y, base * 2.15, 1.6, g[0], g[1], g[2],
          (0.4 + 0.3 * Math.sin(t * 4)) * alpha);
      }
      // ---- wings (Afterburner, Phase, Blink, Drift)
      if (s.wings > 0) {
        var wl = base * (1.5 + s.wings * 0.42);
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          var wa = rot + sgn * 2.45;
          var bx = x + Math.cos(rot + sgn * 2.7) * base * 0.9, by = y + Math.sin(rot + sgn * 2.7) * base * 0.9;
          R.line(L.PLAYER, bx, by, bx + Math.cos(wa) * wl, by + Math.sin(wa) * wl, 2.2, cr, cg, cb, 0.85 * alpha);
          if (s.wings >= 3) R.line(L.PLAYER, bx, by, bx + Math.cos(wa - 0.25) * wl * 0.8, by + Math.sin(wa - 0.25) * wl * 0.8,
            1.4, 1, 1, 1, 0.4 * alpha);
        }
      }
      // ---- fins (Ricochet, Reaper, Overkill, Seeker)
      if (s.fins > 0) {
        var fn = s.fins >= 2 ? 2 : 1;
        for (var f = 0; f < fn; f++) {
          var fa = rot + Math.PI + (f === 0 ? 0.45 : -0.45) * (fn > 1 ? 1 : 0);
          var fx = x + Math.cos(rot + Math.PI) * base * 0.7, fy = y + Math.sin(rot + Math.PI) * base * 0.7;
          var ex = fx + Math.cos(fa) * base * 1.2, ey = fy + Math.sin(fa) * base * 1.2;
          R.line(L.PLAYER, fx, fy, ex, ey, 2, cr, cg, cb, 0.8 * alpha);
          if (s.fins >= 3) R.dot(L.PLAYER, ex, ey, base * 0.16, 1, 1, 1, 0.8 * alpha);
        }
      }
      // ---- hull: the dagger silhouette
      R.sprite(L.PLAYER, 'shipHull', x, y, rot, base * 1.55, base * 1.35, cr, cg, cb, 0.95 * alpha);
      if (s.hull >= 2) R.sprite(L.PLAYER, 'shipHull', x, y, rot, base * 1.42, base * 1.22, 1, 1, 1, 0.35 * alpha);
      // ---- barrels (Twin Barrels, Railgun, Buckshot, Gatling, Mortar)
      if (s.barrels > 0) {
        var bn = s.barrels >= 3 ? 3 : s.barrels;
        for (var bq = 0; bq < bn; bq++) {
          var off = (bq - (bn - 1) / 2) * 0.30;
          var bxx = x + Math.cos(rot + off) * base * 1.0, byy = y + Math.sin(rot + off) * base * 1.0;
          R.line(L.PLAYER, bxx, byy, bxx + Math.cos(rot + off * 0.4) * base * 0.9,
            byy + Math.sin(rot + off * 0.4) * base * 0.9, 2.4, cr, cg, cb, 0.9 * alpha);
        }
      }
      // ---- orbitals (Shard Orbit, Drone, Turret, Mirror, Storm Cloud, Mines)
      if (s.orbitals > 0) {
        var on = Math.min(4, s.orbitals + (s.orbitals >= 3 ? 1 : 0));
        for (var o = 0; o < on; o++) {
          var oa = sb + o / on * M.TAU;
          var ox = x + Math.cos(oa) * base * 3.2, oy = y + Math.sin(oa) * base * 3.2;
          R.poly(L.PLAYER, ox, oy, base * 0.34, 4, oa * 2, 1.4, 1, 0.45, 0.85, 0.85 * alpha);
        }
        if (s.orbitals >= 4) R.ring(L.PLAYER, x, y, base * 3.2, 1, 1, 0.45, 0.85, 0.22 * alpha);
      }
      // ---- core: always the brightest pixel near the ship
      var coreK = 1 + (s.core >= 3 ? 0.25 * Math.sin(t * 6) : 0);
      R.sprite(L.PLAYER, 'shipCore', x, y, 0, base * 0.9 * coreK, base * 0.9 * coreK, 1, 1, 1, alpha);
      R.sprite(L.PLAYER, 'spark', x, y, 0, base * 1.5, base * 1.5, C.COL.core[0], C.COL.core[1], C.COL.core[2], 0.55 * alpha);
      if (s.core >= 4 || s.core === 3) {
        R.line(L.PLAYER, x - base * 2.4, y, x + base * 2.4, y, 1.2, 1, 1, 1, 0.22 * alpha);
      }
      // ---- crown (Wildcards): one unique ornament above the ship
      if (s.crown > 0) {
        var ca = rot - M.HALFPI;
        var cxp = x + Math.cos(ca) * base * 2.1, cyp = y + Math.sin(ca) * base * 2.1;
        R.poly(L.PLAYER, cxp, cyp, base * 0.5, 3, sa, 1.6, 1, 0.235, 0.675, 0.85 * alpha);
      }
    }
  };

  /* ================================================================ PLAYER */
  var TRAIL_N = 24;
  var Pl = NA.Player = {
    x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    aimX: 0, aimY: 0,
    hp: 3, maxHp: 3,
    mana: 100, manaMax: 100,
    alive: true,
    invuln: 0, dashIFrame: 0, blink: 0,
    dashT: 0, dashVX: 0, dashVY: 0, dashCd: 0,
    fireCd: 0, firing: false, recoil: 0, muzzle: 0,
    idleT: 0, killManaWindow: 0, killManaSpent: 0,
    grazeMul: 1, grazeBonus: 0,
    deathT: 0,
    kills: 0, wavesUntouched: 0, tookDamageThisWave: false,
    _trail: new Float32Array(TRAIL_N * 3), _trailI: 0,
    _spawnT: 0,

    stats: {
      fireRate: C.FIRE_RATE, damage: C.BULLET_DMG, speed: C.PLAYER_SPEED,
      bulletSpeed: C.BULLET_SPEED, bulletSize: 7, count: 1, spread: 0,
      pierce: 0, bounce: 0, homing: 0, explode: 0, life: C.BULLET_LIFE,
      manaTrickle: C.MANA_TRICKLE, dashCost: C.DASH_COST, dashDist: C.DASH_DIST,
      grazeMul: 1, dashIFrame: C.DASH_IFRAME
    },

    resetStats: function () {
      var s = Pl.stats;
      s.fireRate = C.FIRE_RATE; s.damage = C.BULLET_DMG; s.speed = C.PLAYER_SPEED;
      s.bulletSpeed = C.BULLET_SPEED; s.bulletSize = 7; s.count = 1; s.spread = 0;
      s.pierce = 0; s.bounce = 0; s.homing = 0; s.explode = 0; s.life = C.BULLET_LIFE;
      s.manaTrickle = C.MANA_TRICKLE; s.dashCost = C.DASH_COST; s.dashDist = C.DASH_DIST;
      s.grazeMul = 1; s.dashIFrame = C.DASH_IFRAME;
    },

    reset: function (opts) {
      opts = opts || {};
      Pl.x = NA.Arena.cx; Pl.y = NA.Arena.cy + 120;
      Pl.vx = Pl.vy = 0; Pl.angle = -M.HALFPI;
      Pl.maxHp = opts.hp || C.PLAYER_HP; Pl.hp = Pl.maxHp;
      Pl.manaMax = C.MANA_MAX; Pl.mana = Pl.manaMax;
      Pl.alive = true; Pl.invuln = 0; Pl.dashIFrame = 0; Pl.blink = 0;
      Pl.dashT = 0; Pl.dashCd = 0; Pl.fireCd = 0; Pl.deathT = 0;
      Pl.idleT = 0; Pl.kills = 0; Pl.grazeMul = 1; Pl.grazeBonus = 0;
      Pl.tookDamageThisWave = false;
      Pl.resetStats();
      for (var i = 0; i < TRAIL_N; i++) { Pl._trail[i * 3] = Pl.x; Pl._trail[i * 3 + 1] = Pl.y; Pl._trail[i * 3 + 2] = 0; }
      Pl._trailI = 0;
    },

    /* ------------------------------------------------------------- mana */
    addMana: function (n, src) {
      if (n <= 0) return;
      if (src === 'kill') {
        if (Pl.killManaSpent >= C.MANA_KILL_CAP) return;
        var give = Math.min(n, C.MANA_KILL_CAP - Pl.killManaSpent);
        Pl.killManaSpent += give; n = give;
      }
      var was = Pl.mana;
      Pl.mana = Math.min(Pl.manaMax, Pl.mana + n);
      if (was < Pl.manaMax && Pl.mana >= Pl.manaMax) {
        if (NA.Audio) NA.Audio.sfx('manaFull');
        NA.Particles.ring(Pl.x, Pl.y, C.SHIP_R * 2, C.SHIP_R * 4, 0.35, 2,
          C.COL.gold[0], C.COL.gold[1], C.COL.gold[2], 0.8);
      }
    },
    spend: function (n, tag) {
      if (Pl.mana < n) {
        if (NA.Audio) NA.Audio.sfx('manaDry');
        return false;
      }
      Pl.mana -= n;
      if (NA.Upgrades) { SCTX.amount = n; SCTX.tag = tag || ''; NA.Upgrades.emit('onSpend', SCTX); }
      return true;
    },

    heal: function (n) { Pl.hp = Math.min(Pl.maxHp, Pl.hp + n); },

    /* ------------------------------------------------------------- dash */
    dash: function () {
      if (!Pl.alive || Pl.dashT > 0 || Pl.dashCd > 0) return false;
      if (!Pl.spend(Pl.stats.dashCost, 'dash')) return false;
      var ax = NA.Input.axis();
      var dx = ax.x, dy = ax.y;
      if (dx === 0 && dy === 0) { dx = Math.cos(Pl.angle); dy = Math.sin(Pl.angle); }
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = Pl.stats.dashDist / C.DASH_TIME;
      Pl.dashVX = dx / l * sp; Pl.dashVY = dy / l * sp;
      Pl.dashT = C.DASH_TIME;
      Pl.dashIFrame = Pl.stats.dashIFrame;
      Pl.dashCd = 0.18;
      NA.FX.trauma(0.1);
      NA.Particles.ring(Pl.x, Pl.y, 6, 60, 0.3, 2.5, C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.9);
      for (var i = 0; i < 5; i++) {
        NA.Particles.afterImage(Pl.x - Pl.dashVX * 0.012 * i, Pl.y - Pl.dashVY * 0.012 * i,
          Pl.angle, C.SHIP_R * 1.55, 0.28 + i * 0.02,
          C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.42 - i * 0.06, 0);
      }
      if (NA.Audio) NA.Audio.sfx('dash', { x: Pl.x, y: Pl.y });
      if (NA.Upgrades) { DCTX.x = Pl.x; DCTX.y = Pl.y; DCTX.vx = Pl.dashVX; DCTX.vy = Pl.dashVY; NA.Upgrades.emit('onDash', DCTX); }
      return true;
    },

    /* ------------------------------------------------------------- fire */
    fire: function (force) {
      if (!Pl.alive) return;
      if (!force && Pl.fireCd > 0) return;
      var s = Pl.stats;
      Pl.fireCd = 1 / Math.max(0.5, s.fireRate);
      var ang = Pl.angle;
      var muzzleD = C.SHIP_R * 1.6;
      var mx = Pl.x + Math.cos(ang) * muzzleD, my = Pl.y + Math.sin(ang) * muzzleD;
      for (var k = 0; k < s.count; k++) {
        var off = s.count > 1 ? (k - (s.count - 1) / 2) * s.spread : 0;
        var a = ang + off + (NA.RNG.f() - 0.5) * 0.012;
        NA.Bullets.firePlayer(mx, my, Math.cos(a) * s.bulletSpeed, Math.sin(a) * s.bulletSpeed, {
          dmg: s.damage, size: s.bulletSize, pierce: s.pierce, bounce: s.bounce,
          homing: s.homing, explode: s.explode, life: s.life
        });
      }
      // two-frame additive starburst + 1.5px recoil
      Pl.muzzle = 0.055; Pl.recoil = 1.5;
      NA.R.light(mx, my, 120, 0.5);
      if (NA.Audio) NA.Audio.sfx('shot', { x: Pl.x, y: Pl.y });
      if (NA.Upgrades) { FCTX.x = mx; FCTX.y = my; FCTX.angle = ang; NA.Upgrades.emit('onFire', FCTX); }
    },

    /* ------------------------------------------------------------ damage */
    damage: function (n, sx, sy) {
      if (!Pl.alive || Pl.invuln > 0 || Pl.dashIFrame > 0) return false;
      Pl.hp -= 1;                          // damage is always one HP at a time
      Pl.tookDamageThisWave = true;
      Pl.idleT = 0;
      Pl.invuln = C.INVULN;
      Pl.blink = C.INVULN;
      NA.FX.hitStop(60);
      NA.Time.slowmo(0.5, 300);
      NA.FX.flash(0.28, 90);
      NA.FX.chroma(3, 150);
      NA.FX.trauma(0.35);
      // a hull chip flies off
      NA.Particles.shatter(Pl.x, Pl.y, C.SHIP_R * 1.6, 3, C.COL.player[0], C.COL.player[1], C.COL.player[2], 260);
      // mercy ring clears enemy bullets nearby
      NA.Bullets.clearArea(Pl.x, Pl.y, C.MERCY_R, false);
      NA.Particles.ring(Pl.x, Pl.y, 20, C.MERCY_R, 0.35, 3, 1, 1, 1, 0.9);
      if (NA.Audio) NA.Audio.sfx('hitPlayer', { x: Pl.x, y: Pl.y });
      if (NA.Game) NA.Game.emit('playerHit', Pl.hp);
      if (Pl.hp <= 0) Pl.kill(sx, sy);
      return true;
    },

    kill: function (sx, sy) {
      if (!Pl.alive) return;
      Pl.alive = false;
      Pl.deathT = 0;
      NA.Time.slowmo(0.1, 800);
      NA.FX.flash(0.4, 120);
      NA.FX.chroma(3, 400);
      NA.FX.trauma(0.6);
      NA.FX.desat(0.85, 3000);
      // the ship shatters into its upgrade parts
      var cols = [C.COL.player, C.COL.core, C.COL.gold, C.COL.magenta];
      for (var i = 0; i < 26; i++) {
        var a = NA.RNG.f() * M.TAU, sp = 90 + NA.RNG.f() * 320;
        var c = cols[i % cols.length];
        NA.Particles.frag(Pl.x, Pl.y, Math.cos(a) * sp, Math.sin(a) * sp, a, 16 + NA.RNG.f() * 18,
          1.2 + NA.RNG.f() * 0.8, c[0], c[1], c[2]);
      }
      NA.Particles.ring(Pl.x, Pl.y, 10, 260, 0.6, 3, 1, 1, 1, 1);
      if (NA.Audio) NA.Audio.sfx('death', { x: Pl.x, y: Pl.y });
      if (NA.Game) NA.Game.emit('playerDeath', 0);
    },

    onKill: function (ei) {
      Pl.kills++;
      Pl.idleT = 0;
      Pl.addMana(C.MANA_KILL, 'kill');
    },

    /* ------------------------------------------------------------ update */
    update: function (dt) {
      if (!Pl.alive) { Pl.deathT += dt; return; }
      var s = Pl.stats;

      // aim: the cursor is the reticle
      var mw = NA.Cam.screenToWorld(NA.Input.mouse.x, NA.Input.mouse.y, AIM);
      Pl.aimX = mw.x; Pl.aimY = mw.y;
      if (NA.Input.stickAim(STICK)) {
        Pl.angle = Math.atan2(STICK.y, STICK.x);
        Pl.aimX = Pl.x + Math.cos(Pl.angle) * 420; Pl.aimY = Pl.y + Math.sin(Pl.angle) * 420;
      } else {
        Pl.angle = Math.atan2(Pl.aimY - Pl.y, Pl.aimX - Pl.x);
      }

      // movement
      if (Pl.dashT > 0) {
        Pl.dashT -= dt;
        Pl.x += Pl.dashVX * dt; Pl.y += Pl.dashVY * dt;
        Pl.vx = Pl.dashVX * 0.45; Pl.vy = Pl.dashVY * 0.45;
        if ((NA.Time.frames & 1) === 0)
          NA.Particles.afterImage(Pl.x, Pl.y, Pl.angle, C.SHIP_R * 1.55, 0.22,
            C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.30, 0);
      } else {
        var ax = NA.Input.axis();
        Pl.vx += ax.x * C.PLAYER_ACCEL * dt;
        Pl.vy += ax.y * C.PLAYER_ACCEL * dt;
        var fr = 1 - C.PLAYER_FRICTION * dt; if (fr < 0) fr = 0;
        Pl.vx *= fr; Pl.vy *= fr;
        var sp2 = Pl.vx * Pl.vx + Pl.vy * Pl.vy, mx2 = s.speed * s.speed;
        if (sp2 > mx2) { var k = s.speed / Math.sqrt(sp2); Pl.vx *= k; Pl.vy *= k; }
        Pl.x += Pl.vx * dt; Pl.y += Pl.vy * dt;
      }

      // the membrane is a soft wall: the last 60 units exhale you back
      var pen = NA.Arena.softWall(Pl, dt, C.SHIP_R);
      if (pen > C.SOFT_WALL * 0.75) {
        if (Pl._wallCd === undefined || Pl._wallCd <= 0) {
          NA.Arena.ripple(Pl.x, Pl.y, Pl.dashT > 0 ? 1.4 : 0.6, 1, 1, 1);
          if (Pl.dashT > 0) NA.FX.chroma(2, 140);
          if (NA.Audio) NA.Audio.sfx('wall', { x: Pl.x, y: Pl.y });
          Pl._wallCd = 0.25;
        }
      }
      if (Pl._wallCd > 0) Pl._wallCd -= dt;

      // trail: 24-point speed-tied ribbon, none when idle
      var speed = Math.sqrt(Pl.vx * Pl.vx + Pl.vy * Pl.vy);
      Pl._trailI = (Pl._trailI + 1) % TRAIL_N;
      var ti = Pl._trailI * 3;
      Pl._trail[ti] = Pl.x; Pl._trail[ti + 1] = Pl.y;
      Pl._trail[ti + 2] = M.clamp01(speed / s.speed);

      // firing
      // hold-to-fire; with auto-fire on (the default) the ship keeps firing on
      // its own during combat states so aiming is the only trigger discipline
      var st = NA.Game ? NA.Game.state : '';
      var combat = (st === 'wave' || st === 'boss' || st === 'lastkill' || st === 'overview' || st === 'stress');
      Pl.firing = NA.Input.isDown('fire') || (!!NA.Store.settings.autofire && combat);
      if (Pl.fireCd > 0) Pl.fireCd -= dt;
      if (Pl.firing && Pl.fireCd <= 0) Pl.fire();
      if (Pl.muzzle > 0) Pl.muzzle -= dt;
      if (Pl.recoil > 0) Pl.recoil = Math.max(0, Pl.recoil - dt * 30);

      // dash input
      if (NA.Input.pressed('dash') || (NA.Input.isDown('dash') && Pl.dashT <= 0 && Pl.dashCd <= 0 && NA.Input.mouse.right)) Pl.dash();
      if (Pl.dashCd > 0) Pl.dashCd -= dt;
      if (Pl.dashIFrame > 0) Pl.dashIFrame -= dt;
      if (Pl.invuln > 0) Pl.invuln -= dt;
      if (Pl.blink > 0) Pl.blink -= dt;

      // mana economy
      Pl.idleT += dt;
      var trickle = s.manaTrickle * (Pl.idleT > C.MANA_IDLE_AFTER ? 0.5 : 1);
      Pl.mana = Math.min(Pl.manaMax, Pl.mana + trickle * dt);
      Pl.killManaWindow += dt;
      if (Pl.killManaWindow >= 1) { Pl.killManaWindow = 0; Pl.killManaSpent = 0; }
      s.grazeMul = Pl.grazeMul;

      // the ship is a light source for the darkness mask
      NA.R.light(Pl.x, Pl.y, 260, 0.85);
    },

    /* ------------------------------------------------------------ render */
    render: function () {
      var R = NA.R, L = R.L;
      if (!Pl.alive) return;
      // trail
      var prevX = 0, prevY = 0, have = false;
      for (var i = 1; i <= TRAIL_N; i++) {
        var idx = ((Pl._trailI - i + TRAIL_N * 2) % TRAIL_N) * 3;
        var w = Pl._trail[idx + 2];
        if (w < 0.06) { have = false; continue; }
        var f = 1 - i / TRAIL_N;
        if (have) R.line(L.AFTER, prevX, prevY, Pl._trail[idx], Pl._trail[idx + 1],
          2.6 * f * w + 0.6, C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.30 * f * w);
        prevX = Pl._trail[idx]; prevY = Pl._trail[idx + 1]; have = true;
      }
      // invuln blink at 12Hz
      var alpha = 1;
      if (Pl.blink > 0 && Math.sin(NA.Time.real * M.TAU * 12) < 0) alpha = 0.25;
      var rx = Pl.x - Math.cos(Pl.angle) * Pl.recoil, ry = Pl.y - Math.sin(Pl.angle) * Pl.recoil;
      // hull brightness reacts to HP; at 1 HP the hull leaks red
      var col = null;
      if (Pl.hp <= 1) { TMPC[0] = 1; TMPC[1] = 0.45; TMPC[2] = 0.52; col = TMPC; }
      Ship.render(rx, ry, Pl.angle, alpha, 1, col);
      // muzzle flash
      if (Pl.muzzle > 0) {
        var mx = Pl.x + Math.cos(Pl.angle) * C.SHIP_R * 1.9, my = Pl.y + Math.sin(Pl.angle) * C.SHIP_R * 1.9;
        R.sprite(L.PBULLETS, 'flash', mx, my, Pl.angle, 26, 26, 1, 1, 1, 0.85);
      }
      // low HP heartbeat vignette
      if (Pl.hp <= 1) {
        var hb = 0.5 + 0.5 * Math.sin(NA.Time.real * M.TAU / 1.2);
        NA.FX.vignette = 0.32 + hb * 0.30;
      } else NA.FX.vignette = 0.32;

      // reticle
      if (NA.Store.settings.reticle) {
        var s2 = 10 * NA.Store.settings.reticle;
        R.ring(L.HUD, Pl.aimX, Pl.aimY, s2, 1.2, 1, 1, 1, 0.35);
        R.dot(L.HUD, Pl.aimX, Pl.aimY, 1.6, 1, 1, 1, 0.7);
      }
    }
  };

  var AIM = { x: 0, y: 0 }, STICK = { x: 0, y: 0 }, TMPC = [1, 1, 1];
  var FCTX = { x: 0, y: 0, angle: 0 };
  var DCTX = { x: 0, y: 0, vx: 0, vy: 0 };
  var SCTX = { amount: 0, tag: '' };
})();

/* ===== 10_enemies.js ===== */
/* 10_enemies.js — enemy framework: SoA pool, type registry, shared flock update,
 * telegraph helpers, invisibility, death pops, mutator plumbing, corpse buffer.
 *
 * Public API
 *   NA.Enemies.define(id, def)          see the def shape below
 *   NA.Enemies.spawn(id, x, y) -> i     -1 when the pool is full
 *   NA.Enemies.damage(i, amt, src) -> killed?
 *   NA.Enemies.damageArea(x, y, r, amt, src) -> hits
 *   NA.Enemies.kill(i, byPlayer)
 *   NA.Enemies.killAll(silent) / NA.Enemies.reset()
 *   NA.Enemies.update(dt) / render()
 *   NA.Enemies.n                        live count (entries are 0..n-1, swap-removed)
 *   SoA: x y vx vy hp maxHp type size rot vrot state t t2 flash flags mut
 *        tx ty intangible spawnT invisible seed p0 p1 p2 p3 hitT ally
 *   NA.Enemies.nearestTo(x, y, maxR) -> i | -1
 *   NA.Enemies.nearestAngle(x, y) -> radians
 *   NA.Enemies.forEachInRadius(x, y, r, cb)
 *   NA.Enemies.shielded(i, fromX, fromY) -> bool     (Sentinel domes)
 *   NA.Enemies.domes                    [{x,y,r,owner}] — support agents push here
 *   NA.Enemies.telegraphLine(x1,y1,x2,y2, t, dur, lockAt, w, col)
 *   NA.Enemies.telegraphCircle(x,y,r, t, dur, lockAt, col)
 *   NA.Enemies.telegraphArrow(x,y,angle,len, t, dur, lockAt, col)
 *   NA.Enemies.MUT                      mutator bit flags
 *   NA.Enemies.setMutator(i, bits) / hasMutator(i, bit)
 *   NA.Enemies.corpses                  {x,y,type,t,n,head} ring buffer of the last 100 deaths
 *   NA.Enemies.corpseAt(k) -> index into the ring (0 = most recent)
 *
 * def = { shape:'circle'|'tri'|'square'|'hex'|'diamond'|'needle'|'chevron'|'ring',
 *         color:[r,g,b], size, hp, speed, cost, band, flock:true, contact:1,
 *         sides, spawnTime, invisible:false,
 *         init(i), update(i, dt), onDamage(i, amt, src), onDeath(i), render(i) }
 */
(function () {
  var M = NA.M, C = NA.C;

  var SIDES = { circle: 8, ring: 8, tri: 3, square: 4, hex: 6, diamond: 4, needle: 3, chevron: 3 };
  var SPRITE = { circle: 'circle', ring: 'ring', tri: 'tri', square: 'square', hex: 'hex', diamond: 'diamond', needle: 'needle', chevron: 'chevron' };

  var P = NA.Pool.create(C.MAX_ENEMIES, {
    x: 'f32', y: 'f32', vx: 'f32', vy: 'f32',
    hp: 'f32', maxHp: 'f32', type: 'i32', size: 'f32',
    rot: 'f32', vrot: 'f32', state: 'i32', t: 'f32', t2: 'f32',
    flash: 'f32', flags: 'i32', mut: 'i32',
    tx: 'f32', ty: 'f32', intangible: 'f32', spawnT: 'f32',
    invisible: 'u8', seed: 'f32', hitT: 'f32',
    ally: 'f32',                       // >0 = fighting for the player (Reaper T3), seconds left
    p0: 'f32', p1: 'f32', p2: 'f32', p3: 'f32'
  });

  var En = NA.Enemies = {
    pool: P,
    types: [], byId: Object.create(null),
    grid: NA.Grid.create(96, C.MAX_ENEMIES, 128),
    domes: [],
    MUT: {
      VOLATILE: 1, LINKED: 2, PHASED: 4, ANCHORED: 8, SPLIT: 16, HAUNTED: 32,
      SHROUDED: 64, MAGNETIC: 128, MIRROR: 256, VAMPIRIC: 512, BLOOMED: 1024, SIREN: 2048
    },
    corpses: {
      x: new Float32Array(C.MAX_CORPSES), y: new Float32Array(C.MAX_CORPSES),
      type: new Int32Array(C.MAX_CORPSES), t: new Float32Array(C.MAX_CORPSES),
      head: 0, n: 0
    },
    killCombo: 0, _lastKillT: -9, _lastKillType: -1,
    totalKills: 0,

    get n() { return P.n; },

    /* ---------------------------------------------------------- registry */
    define: function (id, def) {
      if (En.byId[id] !== undefined) { En.types[En.byId[id]] = normalize(id, def); return En.byId[id]; }
      var idx = En.types.length;
      En.types.push(normalize(id, def));
      En.byId[id] = idx;
      return idx;
    },
    typeIndex: function (id) { var v = En.byId[id]; return v === undefined ? -1 : v; },
    typeOf: function (i) { return En.types[P.type[i]]; },

    /* ------------------------------------------------------------- spawn */
    spawn: function (id, x, y) {
      var ti = typeof id === 'number' ? id : En.byId[id];
      if (ti === undefined || ti < 0) return -1;
      var d = En.types[ti];
      var i = P.alloc(); if (i < 0) return -1;
      P.x[i] = x; P.y[i] = y; P.vx[i] = 0; P.vy[i] = 0;
      P.type[i] = ti;
      P.hp[i] = P.maxHp[i] = d.hp;
      P.size[i] = d.size;
      P.rot[i] = NA.RNG.f() * M.TAU;
      P.vrot[i] = (NA.RNG.f() - 0.5) * 0.9;
      P.state[i] = 0; P.t[i] = 0; P.t2[i] = 0; P.flash[i] = 0;
      P.flags[i] = 0; P.mut[i] = 0; P.tx[i] = x; P.ty[i] = y;
      P.spawnT[i] = d.spawnTime;                 // print-in animation
      P.intangible[i] = d.spawnTime;             // materializing enemies don't collide
      P.invisible[i] = d.invisible ? 1 : 0;
      P.seed[i] = NA.RNG.f() * 1000;
      P.hitT[i] = 0;
      P.p0[i] = P.p1[i] = P.p2[i] = P.p3[i] = 0;
      if (d.init) d.init(i);
      if (NA.Audio) NA.Audio.sfx('spawn', { x: x, y: y, vol: 0.35 });
      return i;
    },
    /* Spawn on the rim at a bearing, just inside the membrane. */
    spawnAtRim: function (id, angle, inset) {
      var r = NA.Arena.radiusAt(angle) - (inset === undefined ? 30 : inset);
      return En.spawn(id, NA.Arena.cx + Math.cos(angle) * r, NA.Arena.cy + Math.sin(angle) * r);
    },

    reset: function () {
      P.clear(); En.domes.length = 0;
      En.corpses.head = 0; En.corpses.n = 0;
      En.killCombo = 0; En.totalKills = 0;
    },
    killAll: function (silent) {
      for (var i = P.n - 1; i >= 0; i--) { if (silent) P.free(i); else En.kill(i, false); }
    },

    /* ------------------------------------------------------------ damage */
    damage: function (i, amt, src) {
      if (i < 0 || i >= P.n) return false;
      if (P.intangible[i] > 0) return false;
      var d = En.types[P.type[i]];
      if (d.onDamage) { var r = d.onDamage(i, amt, src); if (r === false) return false; }
      P.hp[i] -= amt;
      P.flash[i] = 2 / 60;               // hit-flash for exactly two frames
      P.hitT[i] = 0.3;                   // damage reveals invisibles for 0.3s
      // 2px knockback away from the player
      var dx = P.x[i] - NA.Player.x, dy = P.y[i] - NA.Player.y;
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      P.x[i] += dx / l * 2; P.y[i] += dy / l * 2;
      if (NA.Audio) NA.Audio.sfx('hitEnemy', { x: P.x[i], y: P.y[i], vol: 0.25 });
      if (P.hp[i] <= 0) { En.kill(i, src === 'player'); return true; }
      return false;
    },

    damageArea: function (x, y, r, amt, src) {
      var hits = 0, r2 = r * r;
      for (var i = 0; i < P.n; i++) {
        var dx = P.x[i] - x, dy = P.y[i] - y;
        if (dx * dx + dy * dy > r2) continue;
        if (En.damage(i, amt, src)) i--;
        hits++;
      }
      return hits;
    },

    kill: function (i, byPlayer) {
      if (i < 0 || i >= P.n) return;
      var d = En.types[P.type[i]];
      var x = P.x[i], y = P.y[i], sz = P.size[i], ty = P.type[i];
      var col = d.color;

      // record the corpse (Necromancer / Reaper read this later)
      var cp = En.corpses;
      cp.x[cp.head] = x; cp.y[cp.head] = y; cp.type[cp.head] = ty; cp.t[cp.head] = NA.Time.t;
      cp.head = (cp.head + 1) % C.MAX_CORPSES;
      if (cp.n < C.MAX_CORPSES) cp.n++;

      if (d.onDeath) d.onDeath(i);

      // kill pop: scale flash + one line fragment per polygon side + a ring
      var sides = d.sides || SIDES[d.shape] || 6;
      // chained kills of the same type within 200ms get bigger and pitch up
      if (byPlayer) {
        if (NA.Time.t - En._lastKillT < 0.2 && En._lastKillType === ty) En.killCombo = Math.min(8, En.killCombo + 1);
        else En.killCombo = 0;
        En._lastKillT = NA.Time.t; En._lastKillType = ty;
      }
      var grow = 1 + En.killCombo * 0.1;
      NA.Particles.shatter(x, y, sz * 1.4 * grow, sides, col[0], col[1], col[2], 170 + sz * 6);
      NA.Particles.burst(x, y, 4, 210, 0.26, col[0], col[1], col[2], 1);
      NA.R.light(x, y, sz * 8, 0.5);
      if (byPlayer) {
        NA.FX.trauma(0.05);
        if (NA.Audio) NA.Audio.sfx(En.killCombo > 0 ? 'killCombo' : 'kill', { x: x, y: y, pitch: En.killCombo });
        if (d.elite) NA.FX.hitStop(40);
        NA.Player.onKill(i);
        En.totalKills++;
        if (NA.Upgrades) { KCTX.x = x; KCTX.y = y; KCTX.ei = i; KCTX.type = ty; NA.Upgrades.emit('onKill', KCTX); }
        if (NA.Game) NA.Game.emit('kill', ty);
      }
      // volatile mutator explodes on death
      if (P.mut[i] & En.MUT.VOLATILE) NA.Bullets.explode(x, y, 110, 12, 1);
      P.free(i);
    },

    /* -------------------------------------------------------- mutators */
    setMutator: function (i, bits) { P.mut[i] |= bits; },
    hasMutator: function (i, bit) { return (P.mut[i] & bit) !== 0; },

    /* --------------------------------------------------------- queries */
    nearestTo: function (x, y, maxR) {
      var best = -1, bd = maxR === undefined ? 1e18 : maxR * maxR;
      var cnt = En.grid.query(x, y, maxR === undefined ? 900 : maxR);
      var out = En.grid.out;
      for (var q = 0; q < cnt; q++) {
        var i = out[q];
        if (i >= P.n || P.intangible[i] > 0) continue;
        var dx = P.x[i] - x, dy = P.y[i] - y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      return best;
    },
    nearestAngle: function (x, y) {
      var i = En.nearestTo(x, y, 1200);
      if (i < 0) return NA.RNG.f() * M.TAU;
      return Math.atan2(P.y[i] - y, P.x[i] - x);
    },
    forEachInRadius: function (x, y, r, cb) {
      var cnt = En.grid.query(x, y, r), out = En.grid.out;
      for (var q = 0; q < cnt; q++) { var i = out[q]; if (i < P.n) cb(i); }
    },
    shielded: function (i, fromX, fromY) {
      var ds = En.domes;
      if (!ds.length) return false;
      for (var k = 0; k < ds.length; k++) {
        var d = ds[k];
        if (d.owner === i) continue;
        var dx = P.x[i] - d.x, dy = P.y[i] - d.y;
        if (dx * dx + dy * dy > d.r * d.r) continue;         // target not inside
        var fx = fromX - d.x, fy = fromY - d.y;
        if (fx * fx + fy * fy > d.r * d.r) return true;      // shooter outside -> blocked
      }
      return false;
    },

    /* ------------------------------------------------------ telegraphs
     * Universal convention: breathing at TELEGRAPH_HZ, orange while pending,
     * snapping to red at lock. That snap is the "move now". */
    telegraphColor: function (t, lockAt) {
      var locked = t >= lockAt;
      TC[0] = 1;
      TC[1] = locked ? 0.18 : 0.541;
      TC[2] = locked ? 0.302 : 0.0;
      return TC;
    },
    telegraphPulse: function (t, lockAt) {
      var breathe = 0.62 + 0.38 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
      return t >= lockAt ? 1 : breathe;
    },
    _cue: function (t, dur, lockAt, x, y) {
      var dt = NA.Time.fixed;
      if (t < dt && t >= 0) { if (NA.Audio) NA.Audio.sfx('telegraph', { x: x, y: y }); }
      if (t >= lockAt && t - dt < lockAt) { if (NA.Audio) NA.Audio.sfx('lock', { x: x, y: y }); }
    },
    telegraphLine: function (x1, y1, x2, y2, t, dur, lockAt, w, col) {
      En._cue(t, dur, lockAt, x1, y1);
      var c = col || En.telegraphColor(t, lockAt);
      var a = En.telegraphPulse(t, lockAt);
      var k = M.clamp01(t / Math.max(0.001, lockAt));
      NA.R.line(NA.R.L.VEIL, x1, y1, x1 + (x2 - x1) * Math.min(1, k * 1.25), y1 + (y2 - y1) * Math.min(1, k * 1.25),
        (w || 3) * (t >= lockAt ? 1.8 : 1), c[0], c[1], c[2], a);
    },
    telegraphCircle: function (x, y, r, t, dur, lockAt, col) {
      En._cue(t, dur, lockAt, x, y);
      var c = col || En.telegraphColor(t, lockAt);
      var a = En.telegraphPulse(t, lockAt);
      var k = M.clamp01(t / Math.max(0.001, lockAt));
      NA.R.ring(NA.R.L.VEIL, x, y, r, 3, c[0], c[1], c[2], a);
      NA.R.disc(NA.R.L.VEIL, x, y, r * k, c[0], c[1], c[2], 0.20 * a);
    },
    telegraphArrow: function (x, y, ang, len, t, dur, lockAt, col) {
      En._cue(t, dur, lockAt, x, y);
      var c = col || En.telegraphColor(t, lockAt);
      var a = En.telegraphPulse(t, lockAt);
      var ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      NA.R.line(NA.R.L.VEIL, x, y, ex, ey, 5, c[0], c[1], c[2], a);
      NA.R.line(NA.R.L.VEIL, ex, ey, ex + Math.cos(ang + 2.5) * 30, ey + Math.sin(ang + 2.5) * 30, 5, c[0], c[1], c[2], a);
      NA.R.line(NA.R.L.VEIL, ex, ey, ex + Math.cos(ang - 2.5) * 30, ey + Math.sin(ang - 2.5) * 30, 5, c[0], c[1], c[2], a);
    },

    /* -------------------------------------------------------- reveal alpha */
    revealOf: function (i) {
      if (!P.invisible[i]) return 1;
      var a = NA.Events ? NA.Events.revealAlpha(P.x[i], P.y[i]) : 0;
      if (P.hitT[i] > 0) a = Math.max(a, 0.9);                       // damage reveals 0.3s
      var d2 = M.dist2(P.x[i], P.y[i], NA.Player.x, NA.Player.y);
      if (d2 < 3600) a = Math.max(a, 0.35 * (1 - d2 / 3600));        // shimmer within 60px
      return a;
    },

    /* -------------------------------------------------------------- update */
    update: function (dt) {
      var g = En.grid;
      g.begin();
      var i;
      for (i = 0; i < P.n; i++) g.insert(i, P.x[i], P.y[i]);

      var px = NA.Player.x, py = NA.Player.y, alive = NA.Player.alive;
      var parity = NA.Time.frames & 1;

      for (i = 0; i < P.n; i++) {
        var d = En.types[P.type[i]];
        P.t[i] += dt;
        if (P.flash[i] > 0) P.flash[i] -= dt;
        if (P.hitT[i] > 0) P.hitT[i] -= dt;
        if (P.spawnT[i] > 0) P.spawnT[i] -= dt;
        if (P.intangible[i] > 0) { P.intangible[i] -= dt; }
        P.rot[i] += P.vrot[i] * dt;

        if (P.spawnT[i] > 0) { continue; }                 // still printing in

        // shared flock behaviour
        if (d.flock) flock(i, d, dt, px, py, alive, parity);

        if (d.update) d.update(i, dt);

        P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
        clampToArena(i);

        // contact damage
        if (alive && d.contact && P.intangible[i] <= 0) {
          var ddx = P.x[i] - px, ddy = P.y[i] - py;
          var rr = P.size[i] + C.SHIP_R;
          if (ddx * ddx + ddy * ddy < rr * rr) NA.Player.damage(d.contact, P.x[i], P.y[i]);
        }
        // stalled-wave rule: after 20s of a wave the remainder drift toward you
        if (En.beacon && !d.flock) {
          var ba = Math.atan2(py - P.y[i], px - P.x[i]);
          P.vx[i] += Math.cos(ba) * 40 * dt; P.vy[i] += Math.sin(ba) * 40 * dt;
        }
      }
      // domes are re-registered every frame by their owners
      En.domes.length = 0;
    },

    /* -------------------------------------------------------------- render */
    render: function () {
      var R = NA.R, L = R.L;
      for (var i = 0; i < P.n; i++) {
        var d = En.types[P.type[i]];
        var a = En.revealOf(i);
        if (a <= 0.02 && P.spawnT[i] <= 0) continue;
        var col = d.color, cr = col[0], cg = col[1], cb = col[2];
        if (P.flash[i] > 0) { cr = cg = cb = 1; }

        // print-in: a scanline outline that fills
        if (P.spawnT[i] > 0) {
          var k = 1 - P.spawnT[i] / Math.max(0.001, d.spawnTime);
          var sz0 = P.size[i] * (0.5 + k * 0.5);
          R.poly(L.ENEMIES, P.x[i], P.y[i], sz0, d.sides || SIDES[d.shape] || 6, P.rot[i], 1.5, cr, cg, cb, 0.35 + k * 0.5);
          for (var s = 0; s < 3; s++) {
            var yy = P.y[i] - P.size[i] + ((k * 3 + s) % 3) / 3 * P.size[i] * 2;
            R.line(L.ENEMIES, P.x[i] - P.size[i], yy, P.x[i] + P.size[i], yy, 1.2, 1, 1, 1, 0.5 * (1 - k));
          }
          continue;
        }

        if (d.render) { d.render(i, a, cr, cg, cb); continue; }
        var sz = P.size[i] * (1 + (P.flash[i] > 0 ? 0.12 : 0));
        R.sprite(L.ENEMIES, SPRITE[d.shape] || 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
        // a dark outline keeps the danger order readable when things overlap
        if (d.eye) {
          var ea = 0.5 + 0.5 * Math.sin(NA.Time.t * 4 + P.seed[i]);
          R.dot(L.ENEMIES, P.x[i], P.y[i], sz * 0.22, cr, cg, cb, a * (0.5 + ea * 0.5));
        }
        // mutator rim
        if (P.mut[i]) R.poly(L.ENEMIES, P.x[i], P.y[i], sz * 1.35, 4, P.rot[i] * -0.6, 1.2, 1, 1, 1, a * 0.35);
      }
    }
  };

  // expose the SoA arrays directly (the brief's contract: NA.Enemies.x[i])
  for (var k in P) if (P[k] && P[k].BYTES_PER_ELEMENT) En[k] = P[k];

  var KCTX = { x: 0, y: 0, ei: 0, type: 0 };
  var TC = [1, 0.541, 0];

  /* Hard boundary clamp for one SoA row (enemies never leave the ring). */
  function clampToArena(i) {
    var dx = P.x[i] - NA.Arena.cx, dy = P.y[i] - NA.Arena.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-4) return;
    var edge = NA.Arena.radiusAt(Math.atan2(dy, dx)) - P.size[i];
    if (d <= edge) return;
    var nx = dx / d, ny = dy / d;
    P.x[i] = NA.Arena.cx + nx * edge; P.y[i] = NA.Arena.cy + ny * edge;
    var vn = P.vx[i] * nx + P.vy[i] * ny;
    if (vn > 0) { P.vx[i] -= nx * vn; P.vy[i] -= ny * vn; }
  }

  function normalize(id, def) {
    var d = def || {};
    return {
      id: id,
      shape: d.shape || 'circle',
      color: d.color || C.COL.white,
      size: d.size || 12,
      hp: d.hp || 10,
      speed: d.speed || 100,
      cost: d.cost || 1,
      band: d.band || 'A',
      flock: d.flock !== false,
      contact: d.contact === undefined ? 1 : d.contact,
      sides: d.sides || SIDES[d.shape || 'circle'] || 6,
      spawnTime: d.spawnTime === undefined ? 0.5 : d.spawnTime,
      invisible: !!d.invisible,
      elite: !!d.elite,
      eye: !!d.eye,
      separation: d.separation === undefined ? 1 : d.separation,
      cohesion: d.cohesion === undefined ? 0.12 : d.cohesion,
      init: d.init, update: d.update, onDamage: d.onDamage, onDeath: d.onDeath, render: d.render
    };
  }

  /* Shared flock: seek the player, separate from neighbours (half-rate, the
   * expensive part), weak cohesion with the same type. Index-based, no allocs. */
  function flock(i, d, dt, px, py, alive, parity) {
    var ax = 0, ay = 0;
    if (alive) {
      var dx = px - P.x[i], dy = py - P.y[i];
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      ax += dx / l; ay += dy / l;
    }
    // separation runs on alternate frames per entity — half the cost, same look
    if (((i + parity) & 1) === 0 && d.separation > 0) {
      var sepR = P.size[i] * 2.4;
      var cnt = En.grid.query(P.x[i], P.y[i], sepR), out = En.grid.out;
      var sx = 0, sy = 0, cx = 0, cy = 0, cn = 0;
      for (var q = 0; q < cnt; q++) {
        var j = out[q];
        if (j === i || j >= P.n) continue;
        var jx = P.x[j] - P.x[i], jy = P.y[j] - P.y[i];
        var d2 = jx * jx + jy * jy;
        if (d2 < 1) d2 = 1;
        if (d2 < sepR * sepR) { var w = 1 / d2; sx -= jx * w; sy -= jy * w; }
        if (P.type[j] === P.type[i]) { cx += P.x[j]; cy += P.y[j]; cn++; }
      }
      var sl = Math.sqrt(sx * sx + sy * sy);
      if (sl > 0.0001) { ax += sx / sl * 1.5 * d.separation; ay += sy / sl * 1.5 * d.separation; }
      if (cn > 0 && d.cohesion > 0) {
        var ccx = cx / cn - P.x[i], ccy = cy / cn - P.y[i];
        var cl = Math.sqrt(ccx * ccx + ccy * ccy) || 1;
        ax += ccx / cl * d.cohesion; ay += ccy / cl * d.cohesion;
      }
      P.p2[i] = ax; P.p3[i] = ay;          // cached for the off frame
    } else {
      ax = P.p2[i] || ax; ay = P.p3[i] || ay;
    }
    var al = Math.sqrt(ax * ax + ay * ay) || 1;
    var sp = d.speed;
    P.vx[i] = M.smooth(P.vx[i], ax / al * sp, 6, dt);
    P.vy[i] = M.smooth(P.vy[i], ay / al * sp, 6, dt);
  }

  /* ================================================================ TYPES
   * Reference implementations. Everything else is the enemy agent's job;
   * these two show the full define() shape. */

  // Mote — small white circle, slow seeker, contact damage.
  // The medium everything else swims in. Pure flock; hundreds are fine.
  En.define('mote', {
    shape: 'circle', color: [0.92, 0.97, 1.0],
    size: 11, hp: 10, speed: 92, cost: 1, band: 'A',
    flock: true, contact: 1, separation: 1, cohesion: 0.18,
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L;
      var sz = P.size[i] * (P.flash[i] > 0 ? 1.25 : 1);
      R.sprite(L.ENEMIES, 'circle', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * 0.22, cr, cg, cb, a * 0.8);
    }
  });

  // Spitter — small yellow triangle. Keeps 250-350px and fires a slow bolt at
  // your *current* position every 2.2s. Its bolts kill Motes in front of it:
  // cover exists.
  var SPIT_PERIOD = 2.2, SPIT_TELL = 0.3, SPIT_SPEED = 130;
  En.define('spitter', {
    shape: 'tri', color: C.COL.yellow,
    size: 14, hp: 20, speed: 130, cost: 3, band: 'A',
    flock: false, contact: 1, eye: true,
    init: function (i) { P.p0[i] = NA.RNG.range(0, SPIT_PERIOD); P.p1[i] = NA.RNG.range(250, 350); },
    update: function (i, dt) {
      var px = NA.Player.x, py = NA.Player.y;
      var dx = px - P.x[i], dy = py - P.y[i];
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var want = P.p1[i];
      // hold the band: push out when too close, close in when too far
      var radial = (dist - want) / want;
      var tx = dx / dist, ty = dy / dist;
      var ang = Math.atan2(dy, dx);
      var strafe = Math.sin(NA.Time.t * 0.7 + P.seed[i]) * 0.7;
      var vx = tx * M.clamp(radial, -1, 1) - ty * strafe;
      var vy = ty * M.clamp(radial, -1, 1) + tx * strafe;
      var l = Math.sqrt(vx * vx + vy * vy) || 1;
      P.vx[i] = M.smooth(P.vx[i], vx / l * SPIT_SPEED, 5, dt);
      P.vy[i] = M.smooth(P.vy[i], vy / l * SPIT_SPEED, 5, dt);
      P.rot[i] = ang + M.HALFPI;

      P.p0[i] += dt;
      if (P.p0[i] >= SPIT_PERIOD) {
        P.p0[i] = 0;
        var sp = 430;
        NA.Bullets.fireEnemy(P.x[i] + tx * 18, P.y[i] + ty * 18, tx * sp, ty * sp, {
          size: 8, life: 4.5, color: C.COL.yellow, owner: 1, dmg: 1
        });
        if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: P.x[i], y: P.y[i], vol: 0.4 });
      }
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L;
      var sz = P.size[i] * (P.flash[i] > 0 ? 1.25 : 1);
      // the eye brightens 300ms before it fires
      var tell = M.clamp01((P.p0[i] - (SPIT_PERIOD - SPIT_TELL)) / SPIT_TELL);
      R.sprite(L.ENEMIES, 'tri', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * (0.2 + tell * 0.2), 1, M.lerp(0.85, 0.3, tell), M.lerp(0.3, 0.2, tell), a * (0.6 + tell * 0.4));
    }
  });
})();

/* ===== 11_upgrades.js ===== */
/* 11_upgrades.js — NA.Upgrades: registry, dispatcher, shared helper library,
 * and upgrades 1–20 (twinBarrels … blink).  Upgrades 21–42 live in
 * src/11b_upgrades_b.js and use the SAME registry and the SAME helpers.
 *
 * ============================================================ PUBLIC API ===
 *   NA.Upgrades.define(id, def)
 *     def = { family, tags:['explode','dash',...], visual:{slot:'barrels'},
 *             maxTier:3, wildcard:false (alias: wild), excludes:['blink'],
 *             tiers:[ { apply(p), onFire(ctx), onHit(ctx), onKill(ctx),
 *                       onDash(ctx), onSpend(ctx), update(dt), render() }, ... ] }
 *   NA.Upgrades.emit(hook, ctx)     hook = onFire|onHit|onKill|onDash|onSpend
 *   NA.Upgrades.tier(id) -> 0..3
 *   NA.Upgrades.take(id) -> newTier      raises the tier, reapplies, updates the slot
 *   NA.Upgrades.owned                    { id: tier } for every owned upgrade
 *   NA.Upgrades.ownedIds() -> [id]
 *   NA.Upgrades.list / get(id) / tagsOf(id) / excludedFor(id) -> blockingId|null
 *   NA.Upgrades.offer(count, rng) -> [id]   draft offer per GAME_PLAN 5.1
 *   NA.Upgrades.update(dt) / render() / reset() / reapply()
 *   NA.Upgrades.mods                     aggregated modifier table (below)
 *   NA.Upgrades.helpers                  the shared helper library (below)
 *
 * Hook semantics: a hook fires for EVERY tier up to the owned tier, low to
 * high, so tier 3 of an upgrade runs its tier 1, 2 and 3 handlers. That is why
 * higher tiers are written as "adds a new mechanic", never as a stat bump.
 *
 * ctx shapes (all shared, never allocated per call):
 *   onFire  {x, y, angle}
 *   onHit   {x, y, bi, ei, dmg, kill, owner, nx, ny}
 *   onKill  {x, y, ei, type}
 *   onDash  {x, y, vx, vy}
 *   onSpend {amount, tag}
 *
 * ================================================ THE MODIFIER PIPELINE ====
 * `NA.Upgrades.mods` is an aggregated multiplier table recomputed on EVERY tier
 * change (take / reapply).  The order is:
 *
 *   1. NA.Player.resetStats()                    — back to the base numbers
 *   2. mods reset to neutral, then every owned tier's apply(p) runs, low to
 *      high.  An apply() may write NA.Player.stats directly AND/OR accumulate
 *      into NA.Upgrades.mods.  Both agents' upgrades can mix freely.
 *   3. mods are folded into NA.Player.stats as DELTAS on top of whatever the
 *      applies left there (multiplicative for damage/fireRate/speed/bulletSpeed/
 *      size/life/dashDist/dashCost/trickle/grazeMul, additive for pierce/bounce/
 *      homing/explodeRadius/count/spread).
 *   4. the resulting values are snapshotted into NA.Upgrades.statics.
 *
 * Per-frame dynamic upgrades (Gatling spin-up, Overdrive, Overcharge, Berserk…)
 * must NOT accumulate: NA.Upgrades.update() restores the statics snapshot into
 * NA.Player.stats at the top of every frame, then the tier update() hooks
 * multiply into stats for that frame only.
 *
 * mods fields (neutral values in brackets):
 *   damage[1] fireRate[1] speed[1] bulletSpeed[1] size[1] life[1] trickle[1]
 *   grazeMul[1] dashDist[1] dashCost[1] manaCost[1]
 *   pierce[0] bounce[0] homing[0] explodeRadius[0] count[0] spread[0]
 *
 * ====================================================== HELPER LIBRARY =====
 * Everything below is generic and safe for both upgrade files.  No helper
 * allocates inside a per-frame loop.
 *
 *   H = NA.Upgrades.helpers
 *
 *   H.explode(x, y, radius, dmg, src)            immediate radius damage + ring FX +
 *                                                the Blast chain hook.  src: 0/'player'
 *                                                or 1/'enemy'.  Returns kills.
 *   H.queueExplode(x, y, radius, dmg, src, hop)  deferred explosion.  At most
 *                                                H.MAX_EXPLOSIONS_PER_FRAME are
 *                                                resolved per frame; the overflow
 *                                                spills into the next frame(s).
 *   H.onExplodeKill                              nullable callback
 *                                                (x, y, radius, dmg, hop) invoked
 *                                                once per enemy an explosion kills
 *                                                (Blast T2 installs the chain here).
 *   H.chainLightning(x, y, dmg, hops, radius, exclude, col)
 *                                                BFS over the enemy grid with a
 *                                                stamped visited set; draws the
 *                                                polyline with NA.Particles.bolt.
 *                                                Returns the number of arcs.
 *   H.nearestEnemy(x, y, r, exclude)             -> enemy index | -1
 *   H.spawnPlayerBullet(x, y, vx, vy, o)         raw player bullet (no mods folded).
 *   H.fireBullet(x, y, angle, o)                 the wrapper every upgrade should
 *                                                use: applies the live player damage
 *                                                multiplier and the projectile
 *                                                modifiers from NA.Player.stats,
 *                                                then overrides with `o`.
 *                                                o = {speed,dmg,dmgMul,size,pierce,
 *                                                     bounce,homing,explode,life,
 *                                                     flags,r,g,b,a,noMods}
 *   H.lastVolley(cb)                             cb(bulletIndex) over the bullets the
 *                                                current NA.Player.fire() volley just
 *                                                created (call from onFire).
 *   H.damageEnemy(ei, dmg, src)                  damage respecting the Charged status
 *                                                (+30%).  -> killed?
 *   H.damageArea(x, y, r, dmg, src, onKill)      area damage with a per-kill callback.
 *   H.playerDamage(base)                         base * the live damage multiplier.
 *   H.spend(n, tag)                              NA.Player.spend + onSpend dispatch
 *                                                (mods.manaCost applied).  -> bool
 *   H.canSpend(n)                                affordability test with mods.manaCost.
 *   H.drain(perSec, dt, tag)                     continuous drain; -> bool (afforded).
 *   H.activeDown() / H.activePressed() / H.activeHeld()
 *                                                the 'active' key (E / mouse-middle /
 *                                                gamepad).  activeHeld() -> seconds.
 *   H.addEnemyField(name, type)                  adds an SoA field to the enemy pool at
 *                                                runtime (swap-remove safe, zeroed on
 *                                                spawn) and mirrors it on NA.Enemies.
 *                                                type: 'f32'|'i32'|'u8'…  -> the array.
 *   H.setCharged(ei, secs) / H.isCharged(ei)     the Voltaic Charged status.
 *   H.setStun(ei, secs) / H.isStunned(ei)        movement-damp stun.
 *   H.enemyStatus                                { charged, stun, rwx, rwy } arrays.
 *   H.combat()                                   true while the sim is in a combat state.
 *
 * ============================================================ DEV PARAM ====
 *   ?upg=blast:3,ricochet:2   applies those tiers once, at boot.
 */
(function () {
  var defs = Object.create(null);
  var list = [];
  var EMPTY_ARR = [];

  var MODS_NEUTRAL = {
    damage: 1, fireRate: 1, speed: 1, bulletSpeed: 1, size: 1, life: 1,
    trickle: 1, grazeMul: 1, dashDist: 1, dashCost: 1, manaCost: 1,
    pierce: 0, bounce: 0, homing: 0, explodeRadius: 0, count: 0, spread: 0
  };

  var U = NA.Upgrades = {
    defs: defs, list: list,
    owned: Object.create(null),
    mods: {
      damage: 1, fireRate: 1, speed: 1, bulletSpeed: 1, size: 1, life: 1,
      trickle: 1, grazeMul: 1, dashDist: 1, dashCost: 1, manaCost: 1,
      pierce: 0, bounce: 0, homing: 0, explodeRadius: 0, count: 0, spread: 0
    },
    /* the post-mods snapshot the per-frame dynamic upgrades rebuild from */
    statics: {
      fireRate: 0, damage: 0, speed: 0, bulletSpeed: 0, bulletSize: 0,
      count: 1, spread: 0, pierce: 0, bounce: 0, homing: 0, explode: 0,
      life: 0, manaTrickle: 0, dashCost: 0, dashDist: 0, grazeMul: 1
    },
    _onReset: [],
    _devDone: false,

    define: function (id, def) {
      def = def || {};
      def.id = id;
      def.family = def.family || 'misc';
      def.tags = def.tags || [];
      def.tiers = def.tiers || [];
      def.maxTier = def.maxTier || Math.max(1, def.tiers.length);
      def.wildcard = !!(def.wildcard || def.wild);
      def.excludes = def.excludes || EMPTY_ARR;
      if (!defs[id]) list.push(id);
      defs[id] = def;
      return def;
    },
    get: function (id) { return defs[id]; },
    tagsOf: function (id) { var d = defs[id]; return d ? d.tags : EMPTY_ARR; },
    tier: function (id) { return U.owned[id] || 0; },
    ownedIds: function () { var a = []; for (var k in U.owned) if (U.owned[k] > 0) a.push(k); return a; },

    /* Mutually exclusive picks (Blink <-> Afterburner). Returns the owned
     * upgrade that blocks `id`, or null. Checked in both directions. */
    excludedFor: function (id) {
      var d = defs[id]; if (!d) return null;
      var i;
      for (i = 0; i < d.excludes.length; i++) if (U.owned[d.excludes[i]]) return d.excludes[i];
      for (var k in U.owned) {
        if (!U.owned[k] || k === id) continue;
        var o = defs[k]; if (!o) continue;
        for (i = 0; i < o.excludes.length; i++) if (o.excludes[i] === id) return k;
      }
      return null;
    },

    take: function (id) {
      var d = defs[id]; if (!d) return 0;
      var t = Math.min(d.maxTier, (U.owned[id] || 0) + 1);
      U.owned[id] = t;
      if (d.visual && d.visual.slot && NA.Ship) {
        var cur = NA.Ship.getSlot(d.visual.slot);
        NA.Ship.setSlot(d.visual.slot, Math.max(cur, t));
      }
      if (d.wildcard && NA.Ship) NA.Ship.setSlot('crown', 1);
      U.reapply();                                   // apply() + mods + statics
      if (NA.Game) NA.Game.emit('draftPick', id);
      return t;
    },

    /* Re-run every apply() from scratch and re-aggregate the modifier table. */
    reapply: function () {
      if (NA.Player) NA.Player.resetStats();
      var m = U.mods, k;
      for (k in MODS_NEUTRAL) m[k] = MODS_NEUTRAL[k];
      for (var id in U.owned) {
        var d = defs[id]; if (!d) continue;
        for (var t = 0; t < U.owned[id]; t++) {
          var td = d.tiers[t];
          if (td && td.apply) td.apply(NA.Player);
        }
      }
      if (!NA.Player) return;
      var s = NA.Player.stats;
      s.damage *= m.damage; s.fireRate *= m.fireRate; s.speed *= m.speed;
      s.bulletSpeed *= m.bulletSpeed; s.bulletSize *= m.size; s.life *= m.life;
      s.manaTrickle *= m.trickle; s.grazeMul *= m.grazeMul;
      s.dashDist *= m.dashDist; s.dashCost *= m.dashCost;
      s.pierce += m.pierce; s.bounce += m.bounce; s.homing += m.homing;
      s.explode += m.explodeRadius; s.count += m.count; s.spread += m.spread;
      if (s.count > 1 && s.spread <= 0) s.spread = 0.12;
      var st = U.statics;
      for (k in st) st[k] = s[k];
      NA.Player.grazeMul = s.grazeMul;
    },

    /* Restore the static snapshot so per-frame dynamic multipliers never
     * compound frame over frame. Called at the top of update(). */
    restoreStatics: function () {
      if (!NA.Player) return;
      var s = NA.Player.stats, st = U.statics;
      for (var k in st) s[k] = st[k];
    },

    reset: function () {
      U.owned = Object.create(null);
      if (NA.Ship) NA.Ship.reset();
      if (NA.Player) NA.Player.resetStats();
      U.reapply();
      U._devDone = false;
      for (var i = 0; i < U._onReset.length; i++) U._onReset[i]();
    },
    /* Modules register per-run state resets here (both upgrade files use it). */
    onReset: function (fn) { U._onReset.push(fn); },

    /* Fan a hook out over every owned tier. Hot path: no allocation, no
     * closures, plain index loops. */
    emit: function (hook, ctx) {
      for (var id in U.owned) {
        var lvl = U.owned[id]; if (!lvl) continue;
        var d = defs[id]; if (!d) continue;
        for (var t = 0; t < lvl; t++) {
          var td = d.tiers[t];
          if (td && td[hook]) td[hook](ctx);
        }
      }
    },

    update: function (dt) {
      if (!U._devDone) { U._devDone = true; applyDevParam(); }
      U.restoreStatics();
      if (U.helpers) U.helpers._preUpdate(dt);
      for (var id in U.owned) {
        var lvl = U.owned[id]; if (!lvl) continue;
        var d = defs[id]; if (!d) continue;
        for (var t = 0; t < lvl; t++) {
          var td = d.tiers[t];
          if (td && td.update) td.update(dt);
        }
      }
      if (U.helpers) U.helpers._postUpdate(dt);
    },
    render: function () {
      for (var id in U.owned) {
        var lvl = U.owned[id]; if (!lvl) continue;
        var d = defs[id]; if (!d) continue;
        for (var t = 0; t < lvl; t++) {
          var td = d.tiers[t];
          if (td && td.render) td.render();
        }
      }
    },

    /* ------------------------------------------------------------- offers
     * GAME_PLAN 5.1:
     *   slot 1  a tier-up of something owned
     *   slot 2  synergy-tag weighted, 60% of the time
     *   slot 3+ uniform, wildcards at half weight
     *   never a maxed upgrade, never two tiers of one upgrade, never three of
     *   one family, always at least one offensive option, excludes respected.
     */
    offer: function (count, rng) {
      rng = rng || NA.RNG;
      count = count || ((NA.Game && NA.Game.wave && NA.Game.wave % 6 === 0) ? 4 : 3);
      var out = OUT; out.length = 0;
      var pool = POOL; pool.length = 0;
      var i, id, d;
      for (i = 0; i < list.length; i++) {
        id = list[i]; d = defs[id];
        if ((U.owned[id] || 0) >= d.maxTier) continue;      // never offer a maxed upgrade
        if (U.excludedFor(id)) continue;                    // mutually exclusive
        pool.push(id);
      }
      if (!pool.length) return out.slice(0);

      // --- slot 1: a tier-up of something owned
      var ups = UPS; ups.length = 0;
      for (i = 0; i < pool.length; i++) if (U.owned[pool[i]]) ups.push(pool[i]);
      if (ups.length) accept(out, ups[(rng.f() * ups.length) | 0]);

      // --- slot 2: synergy — most shared tags with the build, 60% of the time
      if (out.length < count && rng.f() < 0.6) {
        var myTags = TAGCOUNT;
        for (var tk in myTags) myTags[tk] = 0;
        for (var oid in U.owned) {
          if (!U.owned[oid]) continue;
          var td2 = U.tagsOf(oid);
          for (var q = 0; q < td2.length; q++) myTags[td2[q]] = (myTags[td2[q]] || 0) + U.owned[oid];
        }
        var best = null, bestScore = -1;
        for (var s = 0; s < pool.length; s++) {
          var cid = pool[s];
          if (!allowed(out, cid)) continue;
          var tg = U.tagsOf(cid), sc = 0;
          for (var g = 0; g < tg.length; g++) sc += myTags[tg[g]] || 0;
          sc += rng.f() * 0.9;
          if (sc > bestScore) { bestScore = sc; best = cid; }
        }
        if (best) accept(out, best);
      }

      // --- remaining slots: uniform, wildcards at half weight
      var guard = 0;
      while (out.length < count && guard++ < 400) {
        var pick = pool[(rng.f() * pool.length) | 0];
        if (!allowed(out, pick)) continue;
        if (defs[pick].wildcard && rng.f() < 0.5) continue;
        accept(out, pick);
      }
      // --- always at least one offensive option
      if (out.length && !hasOffensive(out)) {
        for (i = 0; i < pool.length; i++) {
          if (!isOffensive(pool[i]) || out.indexOf(pool[i]) >= 0) continue;
          out[out.length - 1] = pool[i]; break;
        }
      }
      // --- relax the family cap only if the pool could not otherwise fill up
      guard = 0;
      while (out.length < count && guard++ < 400) {
        var p2 = pool[(rng.f() * pool.length) | 0];
        if (out.indexOf(p2) >= 0) continue;
        out.push(p2);
      }
      return out.slice(0);
    }
  };

  var OUT = [], POOL = [], UPS = [], TAGCOUNT = Object.create(null);
  var OFFENSIVE_FAMILIES = { weapon: 1, projectile: 1, trigger: 1, summon: 1, zone: 1, active: 1 };

  function isOffensive(id) {
    var d = defs[id]; if (!d) return false;
    if (d.offensive === false) return false;
    return !!OFFENSIVE_FAMILIES[d.family] || d.offensive === true;
  }
  function hasOffensive(a) { for (var i = 0; i < a.length; i++) if (isOffensive(a[i])) return true; return false; }
  function familyCount(a, fam) {
    var n = 0;
    for (var i = 0; i < a.length; i++) if (defs[a[i]] && defs[a[i]].family === fam) n++;
    return n;
  }
  function allowed(out, id) {
    if (!id || out.indexOf(id) >= 0) return false;          // never two tiers of one
    var d = defs[id]; if (!d) return false;
    if (familyCount(out, d.family) >= 2) return false;      // never three of one family
    for (var i = 0; i < out.length; i++) {                  // excludes inside the offer
      var o = defs[out[i]]; if (!o) continue;
      if (o.excludes.indexOf(id) >= 0 || d.excludes.indexOf(out[i]) >= 0) return false;
    }
    return true;
  }
  function accept(out, id) { if (allowed(out, id)) out.push(id); }

  /* ?upg=blast:3,ricochet:2 — apply a build at boot so the wave/boss agents can
   * test against a real loadout. Applied once per run, on the first update. */
  function applyDevParam() {
    var q = NA.params && NA.params.upg;
    if (!q) return;
    var parts = String(q).split(',');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split(':');
      var id = kv[0].trim(); if (!id || !defs[id]) continue;
      var want = kv.length > 1 ? Math.max(1, Math.min(defs[id].maxTier, parseInt(kv[1], 10) || 1)) : 1;
      var guard = 0;
      while ((U.owned[id] || 0) < want && guard++ < 8) U.take(id);
    }
  }
})();

/* ==========================================================================
 * SHARED HELPER LIBRARY — NA.Upgrades.helpers
 * Written first, on purpose: src/11b_upgrades_b.js (upgrades 21–42) is built
 * against exactly this surface. Nothing here allocates inside a loop.
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, M = NA.M, C = NA.C;
  var TYPES = { f32: Float32Array, i32: Int32Array, u8: Uint8Array, u16: Uint16Array, i16: Int16Array };
  var EMPTY = {};

  /* ---- runtime enemy SoA fields -----------------------------------------
   * NA.Pool.create() drives alloc()/free() off pool._fields, so a field added
   * here is zeroed on spawn and swap-removed correctly. No foundation edit. */
  function addEnemyField(name, type) {
    var pool = NA.Enemies && NA.Enemies.pool;
    if (!pool) return null;
    if (pool[name]) return pool[name];
    var T = TYPES[type || 'f32'] || Float32Array;
    var arr = new T(pool.cap);
    pool[name] = arr;
    pool._fields.push(name);
    NA.Enemies[name] = arr;
    return arr;
  }

  var charged = addEnemyField('charged', 'f32');   // Voltaic: seconds of Charged
  var stun = addEnemyField('stun', 'f32');         // movement-damp stun
  var rwx = addEnemyField('rwx', 'f32');           // Chrono rewind anchor
  var rwy = addEnemyField('rwy', 'f32');

  /* ---- explosion queue (capped per frame, overflow spills) --------------- */
  var QCAP = 384;
  var qx = new Float32Array(QCAP), qy = new Float32Array(QCAP);
  var qr = new Float32Array(QCAP), qd = new Float32Array(QCAP);
  var qs = new Int32Array(QCAP), qh = new Int32Array(QCAP);
  var qHead = 0, qTail = 0, qCount = 0;

  /* ---- chain lightning BFS scratch --------------------------------------- */
  var VIS_CAP = C.MAX_ENEMIES;
  var visited = new Int32Array(VIS_CAP);
  var visitStamp = 0;
  var bfs = new Int32Array(64);

  function combat() {
    var s = NA.Game ? NA.Game.state : '';
    return s === 'wave' || s === 'boss' || s === 'lastkill' || s === 'stress' || s === 'sweep' || s === 'overview';
  }

  function nearestEnemy(x, y, r, exclude) {
    var E = NA.Enemies; if (!E || !E.n) return -1;
    r = r || 700;
    var cnt = E.grid.query(x, y, r), out = E.grid.out;
    var best = -1, bd = r * r;
    for (var q = 0; q < cnt; q++) {
      var i = out[q];
      if (i >= E.n || i === exclude) continue;
      if (E.intangible[i] > 0) continue;
      var dx = E.x[i] - x, dy = E.y[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  }

  function isCharged(ei) { return charged && ei >= 0 && charged[ei] > 0; }
  function setCharged(ei, secs) { if (charged && ei >= 0 && ei < NA.Enemies.n) charged[ei] = Math.max(charged[ei], secs); }
  function isStunned(ei) { return stun && ei >= 0 && stun[ei] > 0; }
  function setStun(ei, secs) { if (stun && ei >= 0 && ei < NA.Enemies.n) stun[ei] = Math.max(stun[ei], secs); }

  /* Damage one enemy, honouring the Charged status (+30% damage taken). */
  function damageEnemy(ei, dmg, src) {
    var E = NA.Enemies;
    if (!E || ei < 0 || ei >= E.n) return false;
    if (charged && charged[ei] > 0) dmg *= 1.3;
    return E.damage(ei, dmg, src || 'player');
  }

  /* Area damage with a per-kill callback. onKill(x, y) is called with the
   * position of the enemy that died, before the swap-remove is observed. */
  function damageArea(x, y, r, dmg, src, onKill) {
    var E = NA.Enemies; if (!E) return 0;
    var r2 = r * r, kills = 0;
    for (var i = 0; i < E.n; i++) {
      var dx = E.x[i] - x, dy = E.y[i] - y;
      if (dx * dx + dy * dy > r2) continue;
      var ex = E.x[i], ey = E.y[i];
      if (damageEnemy(i, dmg, src || 'player')) {
        kills++; i--;
        if (onKill) onKill(ex, ey);
      }
    }
    return kills;
  }

  /* Radius damage + FX. `src`: 0 / 'player' (default) or 1 / 'enemy'.
   * Fires H.onExplodeKill(x, y, radius, dmg, hop) for every enemy killed —
   * that is where Blast T2 hangs its chain. */
  var _hop = 0, _radius = 0, _dmg = 0;
  function explodeKillCb(x, y) {
    if (H.onExplodeKill) H.onExplodeKill(x, y, _radius, _dmg, _hop);
  }
  function explode(x, y, radius, dmg, src, hop) {
    var byPlayer = !(src === 1 || src === 'enemy');
    var cr = byPlayer ? 1 : 1, cg = byPlayer ? 0.541 : 0.18, cb = byPlayer ? 0 : 0.30;
    NA.Particles.ring(x, y, radius * 0.22, radius, 0.30, 4, cr, cg, cb, 1);
    NA.Particles.burst(x, y, 8, radius * 2.4, 0.28, cr, cg, cb, 1);
    NA.R.light(x, y, radius * 2.2, 0.55);
    NA.FX.trauma(0.03 + Math.min(0.10, radius / 1600));
    if (NA.Audio) NA.Audio.sfx('explode', { x: x, y: y, vol: 0.6 });
    var kills = 0;
    if (byPlayer) {
      _hop = hop || 0; _radius = radius; _dmg = dmg;
      kills = damageArea(x, y, radius, dmg, 'player', explodeKillCb);
    } else {
      if (NA.Enemies) NA.Enemies.damageArea(x, y, radius, dmg, 'enemy');
      if (NA.Player && NA.Player.alive && M.dist2(x, y, NA.Player.x, NA.Player.y) < radius * radius)
        NA.Player.damage(1, x, y);
    }
    return kills;
  }

  function queueExplode(x, y, radius, dmg, src, hop) {
    if (qCount >= QCAP) return false;
    qx[qTail] = x; qy[qTail] = y; qr[qTail] = radius; qd[qTail] = dmg;
    qs[qTail] = (src === 1 || src === 'enemy') ? 1 : 0; qh[qTail] = hop || 0;
    qTail = (qTail + 1) % QCAP; qCount++;
    return true;
  }

  /* Resolve at most MAX_EXPLOSIONS_PER_FRAME queued blasts; whatever is left
   * (including anything the chain queued while we were working) spills into
   * the next frame. This is the hard cap that keeps a Blast 3 cascade from
   * detonating an entire wave inside one step. */
  function drainExplosions() {
    var budget = H.MAX_EXPLOSIONS_PER_FRAME;
    var todo = qCount < budget ? qCount : budget;
    for (var k = 0; k < todo; k++) {
      var i = qHead;
      qHead = (qHead + 1) % QCAP; qCount--;
      explode(qx[i], qy[i], qr[i], qd[i], qs[i], qh[i]);
    }
  }

  /* Breadth-first arc over the enemy grid. Never revisits a node (stamped
   * visited set), never allocates, draws each arc as a bolt polyline. */
  function chainLightning(x, y, dmg, hops, radius, exclude, col) {
    var E = NA.Enemies; if (!E || !E.n) return 0;
    hops = hops || 3; radius = radius || 260;
    var r = col ? col[0] : 0.30, g = col ? col[1] : 0.95, b = col ? col[2] : 1.0;
    visitStamp++;
    if (exclude !== undefined && exclude >= 0 && exclude < VIS_CAP) visited[exclude] = visitStamp;
    var head = 0, tail = 0, arcs = 0;
    var cx = x, cy = y;
    for (var h = 0; h < hops; h++) {
      var cnt = E.grid.query(cx, cy, radius), out = E.grid.out;
      var best = -1, bd = radius * radius;
      for (var q = 0; q < cnt; q++) {
        var i = out[q];
        if (i >= E.n || i >= VIS_CAP) continue;
        if (visited[i] === visitStamp || E.intangible[i] > 0) continue;
        var dx = E.x[i] - cx, dy = E.y[i] - cy, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (best < 0) break;
      visited[best] = visitStamp;
      var tx = E.x[best], ty = E.y[best];
      NA.Particles.bolt(cx, cy, tx, ty, 0.16, 12, r, g, b, 2);
      NA.R.light(tx, ty, 120, 0.4);
      arcs++;
      if (H.chainCharges) setCharged(best, 3);
      damageEnemy(best, dmg, 'player');
      if (head === tail) { /* keeps the BFS queue referenced; single-path walk */ }
      bfs[(tail++) & 63] = best;
      cx = tx; cy = ty;
    }
    if (arcs && NA.Audio) NA.Audio.sfx('lightning', { x: x, y: y, vol: 0.5 });
    return arcs;
  }

  /* ---- projectiles ------------------------------------------------------- */
  function playerDamage(base) {
    if (!NA.Player) return base;
    return base * (NA.Player.stats.damage / C.BULLET_DMG);
  }

  function spawnPlayerBullet(x, y, vx, vy, o) {
    return NA.Bullets.firePlayer(x, y, vx, vy, o || EMPTY);
  }

  var BOPT = {
    dmg: 0, size: 0, pierce: 0, bounce: 0, homing: 0, explode: 0, life: 0,
    flags: 0, r: 1, g: 1, b: 1, a: 1
  };
  /* The one call every upgrade should use to make a player projectile: it
   * folds in the live player damage multiplier and every projectile modifier
   * from NA.Player.stats (which already carries NA.Upgrades.mods), then lets
   * `o` override any single field. */
  function fireBullet(x, y, angle, o) {
    o = o || EMPTY;
    var s = NA.Player.stats;
    var sp = o.speed === undefined ? s.bulletSpeed : o.speed;
    var d = o.dmg === undefined ? s.damage : (o.noMods ? o.dmg : playerDamage(o.dmg));
    if (o.dmgMul) d *= o.dmgMul;
    BOPT.dmg = d;
    BOPT.size = o.size === undefined ? s.bulletSize : o.size;
    BOPT.pierce = o.pierce === undefined ? s.pierce : o.pierce;
    BOPT.bounce = o.bounce === undefined ? s.bounce : o.bounce;
    BOPT.homing = o.homing === undefined ? s.homing : o.homing;
    BOPT.explode = o.explode === undefined ? s.explode : o.explode;
    BOPT.life = o.life === undefined ? s.life : o.life;
    BOPT.flags = o.flags || 0;
    BOPT.r = o.r === undefined ? 1 : o.r;
    BOPT.g = o.g === undefined ? 1 : o.g;
    BOPT.b = o.b === undefined ? 1 : o.b;
    BOPT.a = o.a === undefined ? 1 : o.a;
    return NA.Bullets.firePlayer(x, y, Math.cos(angle) * sp, Math.sin(angle) * sp, BOPT);
  }

  /* Iterate the bullets the volley currently being dispatched just created.
   * Only meaningful from an onFire handler. */
  function lastVolley(cb) {
    var P = NA.Bullets.P;
    for (var i = H._volleyStart; i < P.n; i++) cb(i);
  }

  /* ---- mana -------------------------------------------------------------- */
  function cost(n) { return n * U.mods.manaCost; }
  function canSpend(n) { return NA.Player.mana >= cost(n); }
  function spend(n, tag) { return NA.Player.spend(cost(n), tag || 'active'); }
  var drainAcc = Object.create(null);
  /* Continuous drain: accumulates fractional mana so a 12/s drain at 120 Hz
   * still emits whole onSpend events (every 1 mana). */
  function drain(perSec, dt, tag) {
    var k = tag || 'drain';
    var need = cost(perSec) * dt;
    if (NA.Player.mana < need) return false;
    drainAcc[k] = (drainAcc[k] || 0) + need;
    if (drainAcc[k] >= 1) {
      var whole = Math.floor(drainAcc[k]);
      drainAcc[k] -= whole;
      return NA.Player.spend(whole, k);
    }
    NA.Player.mana -= need;                 // sub-mana slice, no hook spam
    return true;
  }

  /* ---- the active key ---------------------------------------------------- */
  var heldT = 0, wasDown = false, pressedFlag = false, releasedFlag = false, releaseHeld = 0;
  function activeDown() { return NA.Input.isDown('active') || NA.Input.mouse.right; }
  function activePressed() { return pressedFlag; }
  function activeReleased() { return releasedFlag; }
  function activeHeld() { return heldT; }
  function activeReleaseHeld() { return releaseHeld; }

  var H = U.helpers = {
    MAX_EXPLOSIONS_PER_FRAME: 12,
    onExplodeKill: null,
    chainCharges: false,
    _volleyStart: 0,
    enemyStatus: { charged: charged, stun: stun, rwx: rwx, rwy: rwy },

    addEnemyField: addEnemyField,
    combat: combat,
    nearestEnemy: nearestEnemy,
    isCharged: isCharged, setCharged: setCharged,
    isStunned: isStunned, setStun: setStun,
    damageEnemy: damageEnemy, damageArea: damageArea,
    explode: explode, queueExplode: queueExplode,
    chainLightning: chainLightning,
    playerDamage: playerDamage,
    spawnPlayerBullet: spawnPlayerBullet, fireBullet: fireBullet, lastVolley: lastVolley,
    spend: spend, canSpend: canSpend, drain: drain, cost: cost,
    activeDown: activeDown, activePressed: activePressed, activeReleased: activeReleased,
    activeHeld: activeHeld, activeReleaseHeld: activeReleaseHeld,
    queuedExplosions: function () { return qCount; },

    /* Wrappers installed once, lazily: NA.Player.fire so lastVolley() knows the
     * range, NA.Player.dash so Blink can REPLACE the dash and Afterburner can
     * price a chained dash before the mana is spent. Both call through. */
    _install: function () {
      if (H._installed || !NA.Player) return;
      H._installed = true;
      var origFire = NA.Player.fire;
      NA.Player.fire = function (force) {
        H._volleyStart = NA.Bullets.P.n;
        return origFire.call(NA.Player, force);
      };
      var origDash = NA.Player.dash;
      NA.Player.origDash = origDash;
      NA.Player.dash = function () {
        var pre = H.preDash;
        if (pre) { var r = pre(); if (r === false) return false; }
        var ok = origDash.call(NA.Player);
        if (ok && H.postDash) H.postDash();
        return ok;
      };
    },
    preDash: null, postDash: null,

    _preUpdate: function (dt) {
      H._install();
      // active-key edge detection
      var down = activeDown();
      pressedFlag = down && !wasDown;
      releasedFlag = !down && wasDown;
      if (releasedFlag) releaseHeld = heldT;
      heldT = down ? heldT + dt : 0;
      wasDown = down;
      // status decay + stun damping (runs after NA.Enemies.update integrated)
      var E = NA.Enemies;
      if (E && E.n) {
        for (var i = 0; i < E.n; i++) {
          if (charged[i] > 0) charged[i] -= dt;
          if (stun[i] > 0) {
            stun[i] -= dt;
            E.vx[i] *= 0.06; E.vy[i] *= 0.06;
          }
        }
      }
    },
    _postUpdate: function (dt) { drainExplosions(); },

    _resetState: function () {
      qHead = qTail = qCount = 0;
      visitStamp = 0;
      for (var k in drainAcc) drainAcc[k] = 0;
      H.onExplodeKill = null;
      H.chainCharges = false;
      H.preDash = null; H.postDash = null;
      heldT = 0; wasDown = false;
    }
  };

  U.onReset(H._resetState);

  /* Charged enemies read as a cyan crackle ring. Drawn once for every charged
   * enemy from the upgrade render pass (Voltaic T3 owns the tier gate). */
  H.renderCharged = function () {
    var E = NA.Enemies; if (!E || !E.n) return;
    var R = NA.R, L = R.L, t = NA.Time.t;
    for (var i = 0; i < E.n; i++) {
      if (charged[i] <= 0) continue;
      var a = M.clamp01(charged[i]) * 0.55;
      var s = E.size[i] * 1.5;
      R.poly(L.PARTICLES, E.x[i], E.y[i], s, 3, t * 3.4 + i, 1.3, 0.30, 0.95, 1.0, a);
      R.poly(L.PARTICLES, E.x[i], E.y[i], s, 3, -t * 3.4 - i, 1.3, 0.30, 0.95, 1.0, a * 0.7);
    }
  };
  H.renderStunned = function () {
    var E = NA.Enemies; if (!E || !E.n) return;
    var R = NA.R, L = R.L, t = NA.Time.t;
    for (var i = 0; i < E.n; i++) {
      if (stun[i] <= 0) continue;
      R.ring(L.PARTICLES, E.x[i], E.y[i], E.size[i] * 1.9, 1.2, 0.60, 0.36, 1.0,
        (0.35 + 0.25 * Math.sin(t * 9 + i)) * M.clamp01(stun[i]));
    }
  };
})();

/* ===== 12_events.js ===== */
/* 12_events.js — PLACEHOLDER (owned by the events/waves agent).
 * The registry, the three-phase lifecycle, the biome backdrop, and ONE fully
 * working event: Supernova. Everything an invisible enemy needs to be revealed
 * goes through NA.Events.revealAlpha().
 *
 * Public API
 *   NA.Events.define(id, def)
 *     def = { layer:'backdrop'|'veil', telegraph, active, decay,
 *             onStart(e), onActive(e), onDecay(e), onEnd(e),
 *             update(e, dt), render(e), reveal(e, x, y) -> 0..1 }
 *   NA.Events.trigger(id, opts) -> e | null      at most one per layer at a time
 *   NA.Events.stop(id) / NA.Events.stopAll()
 *   NA.Events.update(dt) / renderBackdrop() / renderVeil()
 *   NA.Events.revealAlpha(x, y) -> 0..1          invisible enemies use this
 *   NA.Events.isActive(id) -> bool
 *   NA.Events.active                             live event objects
 *   NA.Events.setBiome(name)                     'ember'|'pulsar'|'storm'|'horizon'|'core'
 *   NA.Events.biome
 *
 * Event phases: e.phase is 'telegraph' | 'active' | 'decay'; e.t is seconds in
 * the current phase, e.k is 0..1 progress through it.
 */
(function () {
  var M = NA.M, C = NA.C;

  var defs = Object.create(null);
  var BIOMES = {
    ember: { a: [0.32, 0.13, 0.06], b: [0.20, 0.07, 0.16], star: [1, 0.85, 0.7] },
    pulsar: { a: [0.05, 0.14, 0.28], b: [0.03, 0.08, 0.20], star: [0.75, 0.92, 1] },
    storm: { a: [0.16, 0.06, 0.26], b: [0.05, 0.18, 0.12], star: [0.85, 0.8, 1] },
    horizon: { a: [0.03, 0.03, 0.05], b: [0.06, 0.02, 0.10], star: [0.8, 0.8, 0.9] },
    core: { a: [0.30, 0.18, 0.04], b: [0.10, 0.04, 0.16], star: [1, 0.95, 0.85] }
  };

  var STARS = 260;
  var starX = new Float32Array(STARS), starY = new Float32Array(STARS),
    starS = new Float32Array(STARS), starP = new Float32Array(STARS);
  (function () {
    NA.RNG.seed(4242);
    for (var i = 0; i < STARS; i++) {
      var a = NA.RNG.f() * M.TAU, r = Math.sqrt(NA.RNG.f()) * C.ARENA_R * 1.5;
      starX[i] = Math.cos(a) * r; starY[i] = Math.sin(a) * r;
      starS[i] = 1 + NA.RNG.f() * 2.4; starP[i] = NA.RNG.f() * 6.28;
    }
  })();

  var Ev = NA.Events = {
    defs: defs,
    active: [],
    biome: 'ember',
    windX: 0, windY: 0,      // Solar Wind and Tide push everything; read by movement code

    setBiome: function (name) { if (BIOMES[name]) Ev.biome = name; },

    define: function (id, def) {
      def = def || {};
      def.id = id;
      def.layer = def.layer || 'backdrop';
      def.telegraph = def.telegraph || 0;
      def.active = def.active || 1;
      def.decay = def.decay || 0;
      defs[id] = def;
      return def;
    },

    trigger: function (id, opts) {
      var d = defs[id]; if (!d) return null;
      // at most one Veil event and one Backdrop event at a time
      for (var i = Ev.active.length - 1; i >= 0; i--) {
        if (Ev.active[i].def.layer === d.layer) Ev.stopIndex(i);
      }
      var e = {
        def: d, id: id, phase: 'telegraph', t: 0, k: 0, life: 0,
        x: 0, y: 0, angle: NA.RNG.f() * M.TAU, opts: opts || EMPTY, data: {}
      };
      if (opts) { if (opts.angle !== undefined) e.angle = opts.angle; }
      if (!d.telegraph) { e.phase = 'active'; }
      Ev.active.push(e);
      if (d.onStart) d.onStart(e);
      return e;
    },
    stopIndex: function (i) {
      var e = Ev.active[i];
      if (e.def.onEnd) e.def.onEnd(e);
      Ev.active.splice(i, 1);
    },
    stop: function (id) {
      for (var i = Ev.active.length - 1; i >= 0; i--) if (Ev.active[i].id === id) Ev.stopIndex(i);
    },
    stopAll: function () { while (Ev.active.length) Ev.stopIndex(Ev.active.length - 1); },
    isActive: function (id) {
      for (var i = 0; i < Ev.active.length; i++) if (Ev.active[i].id === id && Ev.active[i].phase === 'active') return true;
      return false;
    },

    update: function (dt) {
      for (var i = Ev.active.length - 1; i >= 0; i--) {
        var e = Ev.active[i], d = e.def;
        e.t += dt; e.life += dt;
        var dur = d[e.phase] || 0.001;
        e.k = M.clamp01(e.t / dur);
        if (d.update) d.update(e, dt);
        if (e.t >= dur) {
          if (e.phase === 'telegraph') { e.phase = 'active'; e.t = 0; if (d.onActive) d.onActive(e); }
          else if (e.phase === 'active') {
            if (d.decay > 0) { e.phase = 'decay'; e.t = 0; if (d.onDecay) d.onDecay(e); }
            else Ev.stopIndex(i);
          } else Ev.stopIndex(i);
        }
      }
    },

    /* Invisible enemies read this every frame. Highest contributor wins. */
    revealAlpha: function (x, y) {
      var best = 0;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (!e.def.reveal) continue;
        var v = e.def.reveal(e, x, y);
        if (v > best) best = v;
      }
      return best;
    },

    /* ------------------------------------------------------------ backdrop */
    renderBackdrop: function () {
      var R = NA.R, L = R.L, b = BIOMES[Ev.biome] || BIOMES.ember;
      var t = NA.Time.t;
      // two soft nebula lobes at 10-25% alpha
      R.disc(L.BACKDROP, -C.ARENA_R * 0.5, -C.ARENA_R * 0.35, C.ARENA_R * 1.15,
        b.a[0], b.a[1], b.a[2], 0.20);
      R.disc(L.BACKDROP, C.ARENA_R * 0.55, C.ARENA_R * 0.45, C.ARENA_R * 0.95,
        b.b[0], b.b[1], b.b[2], 0.18);
      for (var i = 0; i < STARS; i++) {
        var tw = 0.45 + 0.35 * Math.sin(t * 1.4 + starP[i]);
        R.sprite(L.BACKDROP, 'spark', starX[i], starY[i], 0, starS[i], starS[i],
          b.star[0], b.star[1], b.star[2], 0.34 * tw);
      }
      for (var e = 0; e < Ev.active.length; e++) {
        var ev = Ev.active[e];
        if (ev.def.layer === 'backdrop' && ev.def.render) ev.def.render(ev);
      }
    },
    renderVeil: function () {
      for (var e = 0; e < Ev.active.length; e++) {
        var ev = Ev.active[e];
        if (ev.def.layer === 'veil' && ev.def.render) ev.def.render(ev);
      }
    },
    reset: function () { Ev.stopAll(); Ev.windX = Ev.windY = 0; }
  };

  var EMPTY = {};

  /* =============================================================== SUPERNOVA
   * Telegraph: a distant star swells for 3s with a countdown arc on the rim.
   * Active:    a white flash floods the arena from one edge (0.35s).
   * Decay:     4s afterglow; invisibles keep faint outlines.
   * Rule:      reveals invisible enemies as hard silhouettes during the flash
   *            and faint outlines through the afterglow; enemies facing the
   *            star are stunned 0.5s. */
  Ev.define('supernova', {
    layer: 'veil',
    telegraph: 3, active: 0.35, decay: 4,
    onStart: function (e) {
      e.data.sx = Math.cos(e.angle) * C.ARENA_R * 1.35;
      e.data.sy = Math.sin(e.angle) * C.ARENA_R * 1.35;
      if (NA.Audio) NA.Audio.sfx('charge', { x: e.data.sx, y: e.data.sy });
    },
    onActive: function (e) {
      NA.FX.flash(0.45, 220);
      NA.FX.chroma(3, 200);
      NA.FX.trauma(0.22);
      if (NA.Audio) NA.Audio.sfx('supernova');
      // enemies facing the star are stunned 0.5s
      var E = NA.Enemies;
      for (var i = 0; i < E.n; i++) {
        var dx = e.data.sx - E.x[i], dy = e.data.sy - E.y[i];
        if (E.vx[i] * dx + E.vy[i] * dy > 0) { E.intangible[i] = Math.max(E.intangible[i], 0); E.p3[i] = 0; E.vx[i] *= 0.05; E.vy[i] *= 0.05; }
      }
    },
    reveal: function (e, x, y) {
      if (e.phase === 'active') return 1;
      if (e.phase === 'decay') return 0.42 * (1 - e.k);
      if (e.phase === 'telegraph' && e.k > 0.92) return 0.12;
      return 0;
    },
    render: function (e) {
      var R = NA.R, L = R.L;
      var sx = e.data.sx, sy = e.data.sy;
      if (e.phase === 'telegraph') {
        // the star swells; the countdown arc on the rim is the most important
        // thing on screen once Shades exist
        var k = e.k;
        R.disc(L.VEIL, sx, sy, 60 + k * 320, 1, 0.95, 0.85, 0.12 + k * 0.35);
        R.dot(L.VEIL, sx, sy, 14 + k * 26, 1, 1, 1, 0.5 + k * 0.5);
        var a0 = e.angle - 0.6, a1 = a0 + 1.2 * k;
        R.arc(L.VEIL, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius + 26, a0, a1, 6,
          1, 0.92, 0.6, 0.55 + 0.3 * Math.sin(NA.Time.t * 12 * k));
      } else if (e.phase === 'active') {
        var f = 1 - e.k;
        R.disc(L.VEIL, sx * 0.4, sy * 0.4, C.ARENA_R * 2.2, 1, 1, 1, 0.55 * f);
        // long shadows streak away from the star
        for (var i = 0; i < 14; i++) {
          var a = e.angle + Math.PI + (i / 14 - 0.5) * 1.6;
          R.line(L.VEIL, NA.Arena.cx, NA.Arena.cy,
            NA.Arena.cx + Math.cos(a) * C.ARENA_R * 1.4, NA.Arena.cy + Math.sin(a) * C.ARENA_R * 1.4,
            40, 0.1, 0.1, 0.15, 0.25 * f);
        }
      } else {
        var g = (1 - e.k);
        R.disc(L.VEIL, sx * 0.6, sy * 0.6, C.ARENA_R * 1.4, 1, 0.95, 0.85, 0.10 * g);
      }
    }
  });
})();

/* ===== 13_bosses.js ===== */
/* 13_bosses.js — PLACEHOLDER REGISTRY (owned by the boss agents) plus ONE
 * complete reference fight, the Compactor, so the whole pipeline — intro,
 * phases with minimum durations, the rim health ring, arena deformation, the
 * death spectacle — is proven end to end.
 *
 * Public API
 *   NA.Bosses.define(id, def)
 *     def = { name, color:[r,g,b], hp, introTime,
 *             intro(b, t) -> done?,          // return true to end the intro early
 *             phases:[ { minDuration, enter(b), update(b, dt), render(b), exit(b) } ],
 *             camZoom,                       // camera zoom during the fight (default 0.95)
 *             onDamage(b, amt) -> false to ignore,
 *             onPhase(b, index), onDeath(b), render(b) }
 *   NA.Bosses.spawn(id) -> b | null
 *   NA.Bosses.active                          the live boss object or null
 *   NA.Bosses.hit(x, y, r, dmg) -> bool       projectile hit test; bullets call this
 *   NA.Bosses.damage(amt)
 *   NA.Bosses.update(dt) / render()
 *   NA.Bosses.clear()
 *   NA.Bosses.list                            defined ids
 *
 * A boss object b: {def, id, hp, maxHp, x, y, phase, phaseT, t, state
 *                   ('intro'|'fight'|'dying'|'dead'), introT, angle, data{}}
 * Phase floors: while phaseT < phase.minDuration the boss cannot drop below
 * 1 HP. A god build still has to dance.
 */
(function () {
  var M = NA.M, C = NA.C;
  var defs = Object.create(null);

  var B = NA.Bosses = {
    defs: defs, list: [], active: null,

    define: function (id, def) {
      def = def || {};
      def.id = id;
      def.name = def.name || id;
      def.color = def.color || C.COL.magenta;
      def.hp = def.hp || 400;
      def.introTime = def.introTime === undefined ? 1.5 : def.introTime;
      def.phases = def.phases || [];
      if (!defs[id]) B.list.push(id);
      defs[id] = def;
      return def;
    },

    spawn: function (id) {
      var d = defs[id]; if (!d) return null;
      var ang = NA.RNG.f() * M.TAU;
      var b = {
        def: d, id: id, hp: d.hp, maxHp: d.hp,
        x: NA.Arena.cx, y: NA.Arena.cy,
        angle: ang, phase: -1, phaseT: 0, t: 0, introT: 0,
        state: 'intro', ringK: 0, flash: 0, data: {}
      };
      B.active = b;
      NA.Cam.setZoom(NA.Cam.zoom * 1.08, 400);
      if (NA.Audio) NA.Audio.sfx('bossIntro');
      if (NA.Game) NA.Game.emit('bossIntro', id);
      return b;
    },

    clear: function () {
      var b = B.active;
      if (b && b.def.onEnd) b.def.onEnd(b);
      B.active = null;
    },

    nextPhase: function () {
      var b = B.active; if (!b) return;
      var ph = b.def.phases[b.phase];
      if (ph && ph.exit) ph.exit(b);
      b.phase++;
      b.phaseT = 0;
      if (b.phase >= b.def.phases.length) return;
      var np = b.def.phases[b.phase];
      if (np && np.enter) np.enter(b);
      if (b.phase > 0) {
        NA.FX.hitStop(120);
        NA.Time.slowmo(0.35, 700);
        NA.FX.chroma(3, 200);
        NA.FX.trauma(0.4);
        if (NA.Audio) NA.Audio.sfx('bossPhase');
      }
      if (b.def.onPhase) b.def.onPhase(b, b.phase);
      if (NA.Game) NA.Game.emit('bossPhase', b.phase);
    },

    /* Projectile hit test — NA.Bullets calls this for every player bullet. */
    hit: function (x, y, r, dmg) {
      var b = B.active;
      if (!b || b.state !== 'fight') return false;
      if (b.def.hitTest) {
        var res = b.def.hitTest(b, x, y, r);
        if (!res) return false;
        if (res === 2) return true;              // absorbed (armour / seam), no damage
      } else {
        var rr = (b.data.radius || 70) + r;
        var dx = b.x - x, dy = b.y - y;
        if (dx * dx + dy * dy > rr * rr) return false;
      }
      B.damage(dmg);
      NA.Particles.burst(x, y, 4, 180, 0.2, 1, 1, 1, 1);
      return true;
    },

    damage: function (amt) {
      var b = B.active; if (!b || b.state !== 'fight') return;
      if (b.def.onDamage && b.def.onDamage(b, amt) === false) return;
      var ph = b.def.phases[b.phase];
      b.hp -= amt;
      b.flash = 0.08;
      // each phase floors the boss at 1 HP for a minimum duration
      var phaseHp = b.maxHp / Math.max(1, b.def.phases.length);
      var floor = (b.def.phases.length - 1 - b.phase) * phaseHp;
      if (ph && b.phaseT < ph.minDuration) floor = Math.max(floor, (b.def.phases.length - 1 - b.phase) * phaseHp + 1);
      if (b.hp < floor) b.hp = floor;
      if (b.hp <= 0) B.die();
      else if (b.phase < b.def.phases.length - 1 && b.hp <= floor + 0.001 &&
        ph && b.phaseT >= ph.minDuration) B.nextPhase();
    },

    die: function () {
      var b = B.active; if (!b) return;
      b.state = 'dying'; b.hp = 0; b.t = 0;
      NA.Time.slowmo(0.25, 1200);
      NA.FX.flash(0.45, 200);
      NA.FX.chroma(3, 400);
      NA.FX.trauma(0.7);
      if (NA.Audio) NA.Audio.sfx('bossDeath');
      if (b.def.onDeath) b.def.onDeath(b);
      if (NA.Game) NA.Game.emit('bossDeath', b.id);
    },

    update: function (dt) {
      var b = B.active; if (!b) return;
      b.t += dt;
      if (b.flash > 0) b.flash -= dt;

      if (b.state === 'intro') {
        b.introT += dt;
        b.ringK = M.clamp01(b.introT / Math.max(0.001, b.def.introTime));
        var done = b.def.intro ? b.def.intro(b, b.introT) : false;
        // skips are hold-not-tap
        if (done || b.introT >= b.def.introTime || NA.Input.holdTime > 0.3) {
          b.state = 'fight'; b.ringK = 1;
          NA.FX.trauma(0.2);
          B.nextPhase();
        }
        return;
      }
      if (b.state === 'dying') {
        if (b.t > 1.4) { b.state = 'dead'; }
        return;
      }
      if (b.state !== 'fight') return;

      b.phaseT += dt;
      var ph = b.def.phases[b.phase];
      if (ph && ph.update) ph.update(b, dt);
      if (b.def.update) b.def.update(b, dt);
    },

    render: function () {
      var b = B.active; if (!b) return;
      var R = NA.R, L = R.L;
      if (b.state === 'dead') return;

      if (b.def.render) b.def.render(b);
      var ph = b.def.phases[b.phase];
      if (ph && ph.render && b.state === 'fight') ph.render(b);

      // boss health ring: thick, boss-coloured, depleting counterclockwise
      // from the spawn bearing, with phase notches
      var col = b.def.color;
      var rad = NA.Arena.radius + 40;
      var frac = M.clamp01(b.hp / b.maxHp) * b.ringK;
      var a0 = b.angle;
      R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, rad, a0, a0 - M.TAU * frac, 11, col[0], col[1], col[2], 0.85);
      var np = b.def.phases.length;
      for (var i = 1; i < np; i++) {
        var a = a0 - M.TAU * (i / np);
        R.line(L.HUD, NA.Arena.cx + Math.cos(a) * (rad - 16), NA.Arena.cy + Math.sin(a) * (rad - 16),
          NA.Arena.cx + Math.cos(a) * (rad + 16), NA.Arena.cy + Math.sin(a) * (rad + 16),
          3, 1, 1, 1, 0.7);
      }
    }
  };

  /* ============================================================== COMPACTOR
   * Boss 1. The rule: four wall slabs slam inward on a metronome; hitting the
   * orange seams delays the slam. Phase 2 slams them asymmetrically to carve
   * corridors. Teaches "the arena is not safe".  */
  var BEARINGS = [0, M.HALFPI, Math.PI, -M.HALFPI];

  function slabDepthAt(b, k) { return b.data.depth[k]; }

  function slabHitsPoint(b, k, x, y, pad) {
    var dir = BEARINGS[k] + NA.Arena.rot;
    var d = (x - NA.Arena.cx) * Math.cos(dir) + (y - NA.Arena.cy) * Math.sin(dir);
    return d > NA.Arena.radius - b.data.depth[k] - (pad || 0);
  }

  NA.Bosses.define('compactor', {
    name: 'Compactor',
    color: [1, 0.541, 0],
    hp: 420,
    introTime: 1.6,
    camZoom: 0.62,          // the rule is arena-wide, so the camera pulls back

    intro: function (b, t) {
      // the membrane dims, a point on the rim cracks white, the slabs slide in
      var R = NA.R, L = R.L;
      var k = M.clamp01(t / 1.6);
      var a = b.angle;
      R.line(L.VEIL, NA.Arena.cx + Math.cos(a) * NA.Arena.radius, NA.Arena.cy + Math.sin(a) * NA.Arena.radius,
        NA.Arena.cx + Math.cos(a) * (NA.Arena.radius - 260 * k), NA.Arena.cy + Math.sin(a) * (NA.Arena.radius - 260 * k),
        6 * (1 - k) + 2, 1, 1, 1, 1 - k * 0.4);
      if (t > 1.5 && !b.data.punched) { b.data.punched = 1; NA.Cam.addTrauma(0.25); }
      return false;
    },

    onPhase: function (b, i) {
      if (!b.data.depth) {
        b.data.depth = new Float32Array(4);
        b.data.target = new Float32Array(4);
        b.data.seamHp = new Float32Array(4);
        b.data.timer = 0;
        b.data.beat = 0;
      }
      b.data.period = i === 0 ? 3.0 : 2.1;
      b.data.radius = 90;
      for (var k = 0; k < 4; k++) b.data.seamHp[k] = 40;
    },

    /* The boss body is the hub at the centre; the seams are separate targets. */
    hitTest: function (b, x, y, r) {
      // seams first: hitting one delays that slab's slam
      for (var k = 0; k < 4; k++) {
        var dir = BEARINGS[k] + NA.Arena.rot;
        var sd = NA.Arena.radius - b.data.depth[k];
        var sx = NA.Arena.cx + Math.cos(dir) * sd, sy = NA.Arena.cy + Math.sin(dir) * sd;
        var dx = sx - x, dy = sy - y;
        if (dx * dx + dy * dy < (46 + r) * (46 + r)) {
          b.data.seamHp[k] -= 10;
          if (b.data.seamHp[k] <= 0) {
            b.data.seamHp[k] = 40;
            b.data.timer -= 0.55;            // delay the slam
            NA.Particles.ring(sx, sy, 10, 90, 0.3, 3, 1, 0.541, 0, 1);
            if (NA.Audio) NA.Audio.sfx('hitEnemy', { x: sx, y: sy });
          }
          NA.Particles.burst(sx, sy, 3, 160, 0.2, 1, 0.6, 0.2, 1);
          return 2;                          // seams absorb the shot
        }
      }
      var hx = b.x - x, hy = b.y - y;
      return (hx * hx + hy * hy < (b.data.radius + r) * (b.data.radius + r)) ? 1 : 0;
    },

    phases: [
      { // Phase 1 — two opposite slabs on a metronome
        minDuration: 12,
        enter: function (b) { b.data.mode = 0; },
        update: function (b, dt) { compactorTick(b, dt, 0); }
      },
      { // Phase 2 — all four, asymmetric, carving corridors
        minDuration: 14,
        enter: function (b) {
          b.data.mode = 1;
          NA.FX.flash(0.25, 120);
        },
        update: function (b, dt) { compactorTick(b, dt, 1); }
      }
    ],

    onDeath: function (b) {
      // slabs explode outward; the arena is 130% for the transition
      for (var k = 0; k < 4; k++) {
        var dir = BEARINGS[k] + NA.Arena.rot;
        var sd = NA.Arena.radius - b.data.depth[k];
        var sx = NA.Arena.cx + Math.cos(dir) * sd, sy = NA.Arena.cy + Math.sin(dir) * sd;
        NA.Particles.ring(sx, sy, 30, 420, 0.7, 6, 1, 0.541, 0, 1);
        NA.Particles.burst(sx, sy, 24, 700, 0.6, 1, 0.6, 0.15, 1);
        b.data.target[k] = 0;
      }
      NA.Arena.setRadius(C.ARENA_R * 1.3, 1.2);
      NA.Arena.ripple(b.x, b.y, 2, 1, 0.7, 0.3);
    },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.depth) return;
      var rad = NA.Arena.radius;
      for (var k = 0; k < 4; k++) {
        var dir = BEARINGS[k] + NA.Arena.rot;
        var sd = rad - d.depth[k];
        var cx = NA.Arena.cx + Math.cos(dir) * sd, cy = NA.Arena.cy + Math.sin(dir) * sd;
        var px = -Math.sin(dir), py = Math.cos(dir);
        var half = rad * 1.05;
        // the slab body
        R.line(L.ENEMIES, cx + px * half, cy + py * half, cx - px * half, cy - py * half, 26,
          0.35, 0.16, 0.06, 0.95);
        // the seam: the hittable orange line that delays the slam
        var seamK = d.seamHp[k] / 40;
        var warn = d.warn && d.warn[k] ? d.warn[k] : 0;
        var cr = warn > 0.5 ? 1 : 1, cg = warn > 0.5 ? 0.18 : 0.541, cb = warn > 0.5 ? 0.30 : 0.0;
        var breathe = 0.6 + 0.4 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
        R.line(L.ENEMIES, cx + px * half, cy + py * half, cx - px * half, cy - py * half, 5,
          cr, cg, cb, (0.45 + 0.5 * seamK) * (warn > 0 ? breathe : 0.6));
        if (warn > 0) {
          NA.Enemies.telegraphLine(cx + px * half, cy + py * half, cx - px * half, cy - py * half,
            warn, 1, 0.62, 4);
        }
      }
      // the hub
      var f = b.flash > 0 ? 1 : 0;
      R.poly(L.ENEMIES, b.x, b.y, d.radius, 4, NA.Time.t * 0.4, 4,
        f ? 1 : 1, f ? 1 : 0.541, f ? 1 : 0.0, 0.95);
      R.poly(L.ENEMIES, b.x, b.y, d.radius * 0.6, 4, -NA.Time.t * 0.6, 3, 1, 0.75, 0.3, 0.8);
      R.dot(L.ENEMIES, b.x, b.y, 16, 1, 1, 1, 0.9);
    }
  });

  /* The metronome. mode 0 = opposite pairs, mode 1 = asymmetric corridors. */
  function compactorTick(b, dt, mode) {
    var d = b.data;
    if (!d.warn) d.warn = new Float32Array(4);
    d.timer += dt;
    var period = d.period;
    if (d.timer >= period) {
      d.timer = 0; d.beat++;
      var slam = [];
      if (mode === 0) { slam = (d.beat & 1) ? [0, 2] : [1, 3]; }
      else {
        var r = d.beat % 4;
        slam = r === 0 ? [0, 1] : r === 1 ? [2, 3] : r === 2 ? [1, 2] : [3, 0];
      }
      for (var s = 0; s < slam.length; s++) {
        var k = slam[s];
        d.target[k] = Math.min(NA.Arena.radius * 0.52, d.target[k] + 210);
        d.warn[k] = 0.0001;
      }
      // the others retract
      for (var q = 0; q < 4; q++) if (slam.indexOf(q) < 0) d.target[q] = Math.max(0, d.target[q] - 150);
    }
    // telegraph window before each slam
    for (var k2 = 0; k2 < 4; k2++) {
      if (d.warn[k2] > 0) { d.warn[k2] += dt; if (d.warn[k2] > 1) d.warn[k2] = 0; }
      var move = d.target[k2] - d.depth[k2];
      var rate = move > 0 ? 900 : 320;
      d.depth[k2] += M.clamp(move, -rate * dt, rate * dt);
    }
    // slabs crush whatever they catch
    var P = NA.Player;
    for (var k3 = 0; k3 < 4; k3++) {
      if (d.depth[k3] < 6) continue;
      if (P.alive && slabHitsPoint(b, k3, P.x, P.y, C.SHIP_R)) {
        var dir = BEARINGS[k3] + NA.Arena.rot;
        P.damage(1, P.x + Math.cos(dir) * 40, P.y + Math.sin(dir) * 40);
        P.vx -= Math.cos(dir) * 700; P.vy -= Math.sin(dir) * 700;
      }
      var E = NA.Enemies;
      for (var i = 0; i < E.n; i++) {
        if (slabHitsPoint(b, k3, E.x[i], E.y[i], E.size[i])) { E.kill(i, false); i--; }
      }
    }
  }
})();

/* ===== 13b_bosses_1.js ===== */
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

  function L() { return NA.R.L; }
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
      NA.Enemies.spawn(id, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
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

/* ===== 14_waves.js ===== */
/* 14_waves.js — PLACEHOLDER (owned by the waves agent).
 * Waves 1-3 are authored with the real spawn choreography; the runner is the
 * finished generic one, so adding wave 4..30 is only data.
 *
 * Public API
 *   NA.Waves.script[n]      { act, biome, newTypes, retire, budget,
 *                             beats:[{t, type, count, gate, pos}], spikes,
 *                             mutators, boss }
 *   NA.Waves.get(n) -> wave definition (falls back to endless(n) past the script)
 *   NA.Waves.endless(n)     procedural remix generator
 *   NA.Waves.start(n)
 *   NA.Waves.update(dt)
 *   NA.Waves.render()       draws the ingress gates on the rim
 *   NA.Waves.done           true once the budget is spent and the arena is clear
 *   NA.Waves.spawned / NA.Waves.budget / NA.Waves.phase ('ingress'|'body'|'spike'|'closer')
 *   NA.Waves.gates          [angle,...] this wave's rim gates
 *   NA.Waves.progress       0..1 of the spawn budget consumed
 *
 * Choreography (GAME_PLAN 8): ingress (first 10s, 2-4 glowing gate segments on
 * the rim, rotated each wave) -> body (steady stream) -> pressure spike (the
 * rim flashes and 20% of the remaining budget arrives at once from a new gate,
 * always a different archetype than the current dominant one) -> closer (the
 * last 10% is problem enemies only). Waves end on kill count, never a timer.
 */
(function () {
  var M = NA.M, C = NA.C;

  var script = [];

  // Wave 1 — Mote. A tutorial that never says so.
  script[1] = {
    act: 1, biome: 'ember', newTypes: ['mote'], retire: [], budget: 15,
    beats: [
      { t: 0, type: 'mote', count: 6, gate: 0 },
      { t: 6, type: 'mote', count: 5, gate: 1 },
      { t: 14, type: 'mote', count: 4, gate: 0 }
    ],
    spikes: [], mutators: [], boss: 'compactor'
  };

  // Wave 2 — more Motes, two streams, first spike.
  script[2] = {
    act: 1, biome: 'ember', newTypes: [], retire: [], budget: 24,
    beats: [
      { t: 0, type: 'mote', count: 8, gate: 0 },
      { t: 7, type: 'mote', count: 8, gate: 1 },
      { t: 18, type: 'mote', count: 8, gate: 2 }
    ],
    spikes: [{ t: 22, frac: 0.2, type: 'mote' }], mutators: [], boss: 'compactor'
  };

  // Wave 3 — Spitter. Their bolts kill Motes in front of them: cover exists.
  script[3] = {
    act: 1, biome: 'ember', newTypes: ['spitter'], retire: [], budget: 35,
    beats: [
      { t: 0, type: 'mote', count: 10, gate: 0 },
      { t: 5, type: 'spitter', count: 3, gate: 1 },
      { t: 14, type: 'mote', count: 10, gate: 2 },
      { t: 22, type: 'spitter', count: 4, gate: 1 },
      { t: 30, type: 'mote', count: 8, gate: 0 }
    ],
    spikes: [{ t: 26, frac: 0.2, type: 'spitter' }],
    mutators: [], boss: 'compactor',
    events: ['supernova']
  };

  var W = NA.Waves = {
    script: script,
    n: 0, current: null,
    spawned: 0, budget: 0, t: 0,
    phase: 'ingress', done: false, running: false,
    gates: [0, Math.PI],
    _beatIdx: 0, _spikeIdx: 0, _closerDone: false, _stall: 0,

    get progress() { return W.budget ? W.spawned / W.budget : 1; },

    get: function (n) { return script[n] || W.endless(n); },

    /* Naive endless: budget keeps climbing, the roster is whatever is defined,
     * one rolled ambient mutator per wave. The waves agent replaces this. */
    endless: function (n) {
      var types = NA.Enemies.types.map(function (t) { return t.id; });
      if (!types.length) types = ['mote'];
      var budget = Math.round(12 * Math.pow(1.28, Math.min(n, 40)));
      var beats = [];
      var streams = 3 + (n % 3);
      for (var i = 0; i < streams; i++) {
        beats.push({
          t: i * 7,
          type: types[(n + i) % types.length],
          count: Math.max(1, Math.round(budget / streams * 0.7)),
          gate: i % 3
        });
      }
      return {
        act: 6, biome: 'core', newTypes: [], retire: [], budget: budget,
        beats: beats,
        spikes: [{ t: 20, frac: 0.2, type: types[(n + 1) % types.length] }],
        mutators: [], boss: NA.Bosses.list[n % Math.max(1, NA.Bosses.list.length)],
        endless: true
      };
    },

    start: function (n) {
      var w = W.get(n);
      W.n = n; W.current = w;
      W.spawned = 0; W.budget = w.budget || 20; W.t = 0;
      W.phase = 'ingress'; W.done = false; W.running = true;
      W._beatIdx = 0; W._spikeIdx = 0; W._closerDone = false; W._stall = 0;
      // gates rotate every wave so the arena never reads the same twice
      var g = 2 + (n % 3);
      W.gates = [];
      for (var i = 0; i < g; i++) W.gates.push(n * 0.7 + i / g * M.TAU);
      if (w.biome && NA.Events) NA.Events.setBiome(w.biome);
      if (NA.Audio) NA.Audio.music.setIntensity(0.3);
      return w;
    },

    stop: function () { W.running = false; },

    _spawnGroup: function (type, count, gateIdx, posX, posY) {
      var made = 0;
      for (var i = 0; i < count; i++) {
        if (W.spawned >= W.budget) break;
        var x, y;
        if (posX !== undefined) {
          x = posX + NA.RNG.range(-40, 40); y = posY + NA.RNG.range(-40, 40);
        } else {
          var a = W.gates[gateIdx % W.gates.length] + NA.RNG.range(-0.22, 0.22);
          var r = NA.Arena.radiusAt(a) - NA.RNG.range(20, 90);
          x = NA.Arena.cx + Math.cos(a) * r; y = NA.Arena.cy + Math.sin(a) * r;
        }
        // nothing spawns within four ship-widths of the player
        if (M.dist2(x, y, NA.Player.x, NA.Player.y) < 160 * 160) continue;
        if (NA.Enemies.spawn(type, x, y) >= 0) { W.spawned++; made++; }
      }
      return made;
    },

    update: function (dt) {
      if (!W.running || !W.current) return;
      var w = W.current;
      W.t += dt;

      if (W.t < 10) W.phase = 'ingress';
      else if (W.progress > 0.9) W.phase = 'closer';
      else W.phase = 'body';

      // scripted beats
      while (W._beatIdx < w.beats.length && W.t >= w.beats[W._beatIdx].t) {
        var b = w.beats[W._beatIdx++];
        W._spawnGroup(b.type, b.count, b.gate || 0, b.pos ? b.pos[0] : undefined, b.pos ? b.pos[1] : undefined);
      }

      // pressure spike: the rim flashes, then 20% of the remaining budget lands
      // at once from a new gate
      if (w.spikes) while (W._spikeIdx < w.spikes.length && W.t >= w.spikes[W._spikeIdx].t) {
        var s = w.spikes[W._spikeIdx++];
        var remaining = W.budget - W.spawned;
        var n = Math.max(1, Math.round(remaining * (s.frac || 0.2)));
        NA.FX.flash(0.16, 120);
        NA.Arena.ripple(NA.Arena.cx + Math.cos(W.t) * NA.Arena.radius, NA.Arena.cy + Math.sin(W.t) * NA.Arena.radius, 1.5, 1, 0.5, 0.2);
        W.gates.push(NA.RNG.f() * M.TAU);
        W._spawnGroup(s.type, n, W.gates.length - 1);
      }

      // closer: the last 10% is problem enemies only
      if (!W._closerDone && W.spawned >= W.budget * 0.9 && W.spawned < W.budget) {
        W._closerDone = true;
        var closer = (w.beats.length ? w.beats[w.beats.length - 1].type : 'mote');
        W._spawnGroup(closer, W.budget - W.spawned, 1);
      }

      // waves end on kill count, never on a timer
      if (W.spawned >= W.budget && NA.Enemies.n === 0) { W.done = true; W.running = false; }

      // if a wave stalls, the remainder gets a rim beacon and drifts toward you
      if (W.spawned >= W.budget && NA.Enemies.n > 0) {
        W._stall += dt;
        NA.Enemies.beacon = W._stall > 20;
      } else NA.Enemies.beacon = false;

      if (NA.Audio) NA.Audio.music.setIntensity(M.clamp01(NA.Enemies.n / 60));
    },

    render: function () {
      if (!W.running) return;
      var R = NA.R, L = R.L;
      // ingress gates glow on the rim while they are feeding
      var k = W.t < 10 ? 1 : 0.35;
      for (var i = 0; i < W.gates.length; i++) {
        var a = W.gates[i];
        var rr = NA.Arena.radiusAt(a);
        var pulse = 0.4 + 0.35 * Math.sin(NA.Time.t * 3 + i);
        R.arc(L.MEMBRANE, NA.Arena.cx, NA.Arena.cy, rr - 8, a - 0.18, a + 0.18, 12,
          1, 0.55, 0.25, k * pulse);
      }
      // the rim spawn-budget ring depletes as the wave is consumed
      R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius + 18, -M.HALFPI,
        -M.HALFPI + M.TAU * (1 - W.progress), 3, 0.30, 0.95, 1.0, 0.35);
    }
  };
})();

/* ===== 15_ui.js ===== */
/* 15_ui.js — PLACEHOLDER (owned by the UI agent).
 * Real enough to play: HUD arcs on the ship, a text-free 3-card draft that
 * actually applies picks, a title gate you fly through, a death screen that
 * restarts on click, and the fourth-wall hooks the bosses call.
 *
 * Public API
 *   NA.HUD.render()                          HP arc under the ship, mana arc over it,
 *                                            rim enemy dots, wave pips, boss ring
 *   NA.HUD.bump()                            re-brighten the arcs for 1.5s
 *   NA.Draft.open(count) / close()
 *   NA.Draft.active / NA.Draft.update(dt) / NA.Draft.render()
 *   NA.Draft.offers                          [id,...] currently offered
 *   NA.Draft.pick(index) / NA.Draft.skip() / NA.Draft.reroll()
 *   NA.UI.renderTitle() / renderDeath() / renderOverlay()
 *   NA.UI.gate                               {x, y, r, active}
 *   NA.UI.gateEntered()                      true on the frame the ship flies through
 *   NA.UI.clicked()                          consumed click
 *   NA.UI.fourthWall.tearDraftPanel(amount)
 *   NA.UI.fourthWall.dimPage(on)
 *   NA.UI.fourthWall.viewportArena(on)
 *   NA.UI.fourthWall.scrollPage(px)
 *   NA.UI.fourthWall.fallHUDDigit(n)
 *   NA.UI.fourthWall.reset()
 */
(function () {
  var M = NA.M, C = NA.C;

  /* ================================================================== HUD */
  var HUD = NA.HUD = {
    bright: 0,
    bump: function () { HUD.bright = 1.5; },
    update: function (dt) { if (HUD.bright > 0) HUD.bright -= dt; },

    render: function () {
      var R = NA.R, L = R.L, P = NA.Player;
      if (!P.alive) return;
      // HUD arcs fade to 25% when all is well and re-brighten on any change
      var a = 0.25 + 0.75 * M.clamp01(HUD.bright);
      var r1 = C.SHIP_R * 2.6;

      // HP: a thin segmented arc UNDER the ship
      var seg = P.maxHp;
      for (var i = 0; i < seg; i++) {
        var a0 = M.HALFPI - 0.55 + (i / seg) * 1.1 + 0.03;
        var a1 = M.HALFPI - 0.55 + ((i + 1) / seg) * 1.1 - 0.03;
        var on = i < P.hp;
        R.arc(L.HUD, P.x, P.y, r1, a0, a1, 3.4,
          on ? 1 : 0.35, on ? (P.hp <= 1 ? 0.3 : 1) : 0.35, on ? (P.hp <= 1 ? 0.35 : 1) : 0.4,
          on ? Math.max(a, 0.55) : a * 0.5);
      }
      // Mana: a cyan arc OVER the ship, with the dash-threshold notch
      var mf = P.mana / P.manaMax;
      var ma0 = -M.HALFPI - 0.62, ma1 = ma0 + 1.24;
      R.arc(L.HUD, P.x, P.y, r1, ma0, ma1, 2.4, 0.2, 0.45, 0.55, a * 0.5);
      var full = mf >= 0.999;
      var mc = full ? C.COL.gold : C.COL.player;
      R.arc(L.HUD, P.x, P.y, r1, ma0, ma0 + (ma1 - ma0) * mf, 3.4,
        mc[0], mc[1], mc[2], Math.max(a, full ? 0.9 : 0.6));
      var notch = ma0 + (ma1 - ma0) * (P.stats.dashCost / P.manaMax);
      R.line(L.HUD, P.x + Math.cos(notch) * (r1 - 5), P.y + Math.sin(notch) * (r1 - 5),
        P.x + Math.cos(notch) * (r1 + 5), P.y + Math.sin(notch) * (r1 + 5),
        1.6, 1, 1, 1, a * 0.8);
      // full mana closes into a halo and pulses gold
      if (full) R.ring(L.HUD, P.x, P.y, r1, 1.6, C.COL.gold[0], C.COL.gold[1], C.COL.gold[2],
        0.35 + 0.25 * Math.sin(NA.Time.t * 5));

      // wave progress: every living enemy as a faint dot at its bearing
      var E = NA.Enemies, cx = NA.Arena.cx, cy = NA.Arena.cy;
      for (var e = 0; e < E.n; e += 1) {
        var ang = Math.atan2(E.y[e] - cy, E.x[e] - cx);
        var rr = NA.Arena.radiusAt(ang) + 9;
        var d = E.types[E.type[e]];
        R.dot(L.HUD, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 2.4,
          d.color[0], d.color[1], d.color[2], 0.35);
      }
    }
  };

  /* ================================================================ DRAFT */
  var Draft = NA.Draft = {
    active: false, offers: [], hover: -1, t: 0, count: 3, picked: -1,
    _cards: [],

    open: function (count) {
      Draft.count = count || 3;
      Draft.offers = NA.Upgrades.offer(Draft.count, NA.RNG);
      Draft.hover = -1; Draft.t = 0; Draft.picked = -1;
      Draft.active = true;
      if (NA.Game) NA.Game.emit('draftOpen', Draft.offers);
      // no upgrades registered yet -> nothing to draft, don't stall the run
      if (!Draft.offers.length) { Draft.active = false; return false; }
      NA.Time.setTimeScale(0.05);
      return true;
    },
    close: function () {
      Draft.active = false;
      NA.Time.setTimeScale(1);
      HUD.bump();
    },
    pick: function (i) {
      if (!Draft.active || i < 0 || i >= Draft.offers.length) return;
      var id = Draft.offers[i];
      NA.Upgrades.take(id);
      Draft.picked = i;
      var c = Draft._cards[i];
      if (c) {
        NA.Particles.ring(NA.Player.x, NA.Player.y, 10, 140, 0.5, 3,
          C.COL.player[0], C.COL.player[1], C.COL.player[2], 1);
      }
      if (NA.Audio) NA.Audio.sfx('draftPick');
      Draft.close();
    },
    skip: function () {
      // declining all cards starts the next wave with full mana and +1 HP
      NA.Player.heal(1);
      NA.Player.mana = NA.Player.manaMax;
      if (NA.Audio) NA.Audio.sfx('draftSkip');
      Draft.close();
    },
    reroll: function () {
      if (!NA.Player.spend(40, 'reroll')) return;
      Draft.offers = NA.Upgrades.offer(Draft.count, NA.RNG);
      if (NA.Audio) NA.Audio.sfx('uiTick');
    },

    update: function (dt) {
      if (!Draft.active) return;
      Draft.t += dt;
      layout();
      var mx = NA.Input.mouse.x, my = NA.Input.mouse.y;
      var h = -1;
      for (var i = 0; i < Draft._cards.length; i++) {
        var c = Draft._cards[i];
        if (Math.abs(mx - c.x) < c.w * 0.5 && Math.abs(my - c.y) < c.h * 0.5) h = i;
      }
      if (h !== Draft.hover) { Draft.hover = h; if (h >= 0 && NA.Audio) NA.Audio.sfx('draftHover'); }
      if (NA.Input.pressed('fire') && h >= 0) Draft.pick(h);
      if (NA.Input.pressed('pick1')) Draft.pick(0);
      if (NA.Input.pressed('pick2')) Draft.pick(1);
      if (NA.Input.pressed('pick3')) Draft.pick(2);
      if (NA.Input.pressed('pick4')) Draft.pick(3);
    },

    render: function () {
      if (!Draft.active) return;
      var R = NA.R;
      // world dims 50% behind the cards
      R.sdisc(R.w * 0.5, R.h * 0.5, Math.max(R.w, R.h), 0.02, 0.024, 0.04, 0.5);
      for (var i = 0; i < Draft._cards.length; i++) {
        var c = Draft._cards[i];
        var hov = Draft.hover === i;
        var s = hov ? 1.08 : 1;
        var col = hov ? C.COL.core : C.COL.player;
        R.spoly(c.x, c.y, c.w * 0.5 * s, 6, 0, hov ? 3 : 2, col[0], col[1], col[2], hov ? 1 : 0.7);
        R.sdisc(c.x, c.y, c.w * 0.48 * s, 0.05, 0.09, 0.12, 0.9);
        // tier pips with the next one blinking
        var tier = NA.Upgrades.tier(Draft.offers[i]);
        for (var t = 0; t < 3; t++) {
          var on = t < tier + 1;
          var bl = (t === tier) ? (0.4 + 0.6 * Math.abs(Math.sin(NA.Time.real * 4))) : 1;
          R.sdisc(c.x + (t - 1) * 18, c.y + c.h * 0.30, 5,
            col[0], col[1], col[2], (on ? 0.9 : 0.2) * bl);
        }
      }
      // reroll / skip hexes below
      var by = Draft._cards.length ? Draft._cards[0].y + Draft._cards[0].h * 0.72 : R.h * 0.7;
      R.spoly(R.w * 0.5 - 60, by, 20, 6, 0, 2, 0.6, 0.8, 1, 0.6);
      R.spoly(R.w * 0.5 + 60, by, 20, 6, 0, 2, 1, 0.45, 0.55, 0.6);
    }
  };

  function layout() {
    var R = NA.R, n = Draft.offers.length;
    Draft._cards.length = 0;
    var w = Math.min(200, R.w / (n + 2));
    for (var i = 0; i < n; i++) {
      var frac = n === 1 ? 0.5 : i / (n - 1);
      var ang = (frac - 0.5) * 0.7;
      Draft._cards.push({
        x: R.w * 0.5 + (frac - 0.5) * w * (n) * 1.25,
        y: R.h * 0.36 + Math.abs(frac - 0.5) * 40,
        w: w, h: w * 1.25, ang: ang
      });
    }
  }

  /* =================================================================== UI */
  var UI = NA.UI = {
    gate: { x: 0, y: -320, r: 68, active: false, passed: false },
    _wasInside: false,

    resetGate: function (x, y) {
      UI.gate.x = x === undefined ? 0 : x;
      UI.gate.y = y === undefined ? -340 : y;
      UI.gate.active = true; UI.gate.passed = false; UI._wasInside = false;
    },

    /* Fly through the gate to start. Returns true on the frame you pass it. */
    gateEntered: function () {
      var g = UI.gate;
      if (!g.active) return false;
      var P = NA.Player;
      var d2 = M.dist2(P.x, P.y, g.x, g.y);
      var inside = d2 < g.r * g.r;
      if (inside && !UI._wasInside) { UI._wasInside = true; g.passed = true; g.active = false; if (NA.Audio) NA.Audio.sfx('gate'); return true; }
      // a click or Enter dashes you through automatically
      if (NA.Input.pressed('fire') || NA.Input.pressed('confirm')) {
        var a = Math.atan2(g.y - P.y, g.x - P.x);
        P.vx = Math.cos(a) * 900; P.vy = Math.sin(a) * 900;
      }
      return false;
    },

    renderGate: function () {
      var g = UI.gate; if (!g.active) return;
      var R = NA.R, L = R.L;
      var pulse = 0.55 + 0.35 * Math.sin(NA.Time.real * M.TAU);
      var P = NA.Player;
      var d = M.dist(P.x, P.y, g.x, g.y);
      var near = M.clamp01(1 - d / 700);
      R.ring(L.VEIL, g.x, g.y, g.r, 4, 1, 1, 1, (0.4 + near * 0.5) * pulse);
      R.ring(L.VEIL, g.x, g.y, g.r * 1.2, 1.5, C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.35 * pulse);
      R.disc(L.VEIL, g.x, g.y, g.r * 1.6, C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.10 + near * 0.10);
      // animated dotted trail leading to the gate
      var steps = 10;
      for (var i = 0; i < steps; i++) {
        var k = ((i / steps) + (NA.Time.real * 0.25 % 1)) % 1;
        R.dot(L.VEIL, M.lerp(P.x, g.x, k), M.lerp(P.y, g.y, k), 2.6, 1, 1, 1, 0.28 * (1 - k));
      }
    },

    renderTitle: function () {
      UI.renderGate();
      var R = NA.R, L = R.L;
      // a ring of pips showing the best wave, spiked every 5th, gold crown at 30
      var best = NA.Store.records.best || 0;
      var g = UI.gate;
      for (var i = 0; i < 30; i++) {
        var a = i / 30 * M.TAU - M.HALFPI;
        var rr = g.r * 2.1 + ((i + 1) % 5 === 0 ? 10 : 0);
        var on = i < best;
        var c = (i === 29) ? C.COL.gold : C.COL.player;
        R.dot(L.VEIL, g.x + Math.cos(a) * rr, g.y + Math.sin(a) * rr, (i + 1) % 5 === 0 ? 3.4 : 2.2,
          c[0], c[1], c[2], on ? 0.85 : 0.18);
      }
      // a slow-rotating ghost ship of the best run's final form
      NA.Ship.render(g.x, g.y, NA.Time.real * 0.35, 0.18, 1.4);
    },

    renderDeath: function () {
      var R = NA.R, L = R.L, P = NA.Player;
      // the ship rebuilt from its shards on a pedestal of light
      var k = M.clamp01((P.deathT - 1.2) / 0.8);
      if (k <= 0) return;
      R.disc(L.VEIL, P.x, P.y, 220 * k, C.COL.player[0], C.COL.player[1], C.COL.player[2], 0.10 * k);
      NA.Ship.render(P.x, P.y, NA.Time.real * 0.5, 0.85 * k, 1.6);
      // a ring of pips for the waves reached
      var reached = NA.Game ? NA.Game.wave : 0;
      for (var i = 0; i < 30; i++) {
        var a = i / 30 * M.TAU - M.HALFPI;
        R.dot(L.VEIL, P.x + Math.cos(a) * 170, P.y + Math.sin(a) * 170, 3,
          i < reached ? 1 : 0.3, i < reached ? 0.85 : 0.3, i < reached ? 0.3 : 0.35, 0.8 * k);
      }
      UI.renderGate();
    },

    /* Icons are Canvas2D; they draw on the #ui overlay above the GL canvas. */
    renderOverlay: function () {
      var ctx = NA.R.uictx; if (!ctx) return;
      var I = NA.Icons;
      var dpr = NA.R.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, NA.R.w, NA.R.h);
      if (Draft.active) {
        for (var i = 0; i < Draft._cards.length; i++) {
          var c = Draft._cards[i];
          if (!I || !I.draw) break;
          I.draw(ctx, Draft.offers[i], c.x, c.y - c.h * 0.06, c.w * 0.55, {
            tier: NA.Upgrades.tier(Draft.offers[i]) + 1,
            color: Draft.hover === i ? [0.92, 1, 1] : [0.30, 0.95, 1.0],
            glow: Draft.hover === i, alpha: 1
          });
        }
        var by = Draft._cards.length ? Draft._cards[0].y + Draft._cards[0].h * 0.72 : NA.R.h * 0.7;
        if (I && I.draw) {
          I.draw(ctx, 'reroll', NA.R.w * 0.5 - 60, by, 34, { color: [0.6, 0.8, 1] });
          I.draw(ctx, 'skip', NA.R.w * 0.5 + 60, by, 34, { color: [1, 0.45, 0.55] });
        }
      }
    },

    /* ------------------------------------------------- fourth-wall stubs
     * Bosses 11 (Encore), 20 (Lurker) and 24 (Page) drive these. The UI agent
     * implements them against #dom; the signatures are fixed. */
    fourthWall: {
      _dom: null,
      _el: function () { return UI.fourthWall._dom || (UI.fourthWall._dom = document.getElementById('dom')); },
      tearDraftPanel: function (amount) { /* stub: split the draft panel in half */ },
      dimPage: function (on) {
        try { document.body.classList.toggle('na-dim', !!on); } catch (e) { }
      },
      viewportArena: function (on) { /* stub: the arena becomes the browser viewport */ },
      scrollPage: function (px) { try { window.scrollBy(0, px); } catch (e) { } },
      fallHUDDigit: function (n) { /* stub: a wave pip falls as a bomb */ },
      heal: function () { /* stub: the UI reassembles */ },
      reset: function () {
        try { document.body.classList.remove('na-dim'); } catch (e) { }
        var el = UI.fourthWall._el(); if (el) el.innerHTML = '';
      }
    }
  };
})();

/* ===== 16_game.js ===== */
/* 16_game.js — the state machine, the event bus, and the main loop.
 *
 * Public API
 *   NA.Game.on(event, cb) / off(event, cb) / emit(event, data)
 *     events: waveStart waveClear draftOpen draftPick bossIntro bossPhase
 *             bossDeath playerHit playerDeath kill stateChange
 *   NA.Game.state      'title'|'wave'|'lastkill'|'sweep'|'draft'|'overview'|'boss'|'death'|'stress'
 *   NA.Game.setState(s)
 *   NA.Game.wave       current wave number
 *   NA.Game.newRun(seed) / NA.Game.startWave(n) / NA.Game.restart()
 *   NA.Game.step(dt)   one fixed simulation step
 *   NA.Game.render()
 *   NA.Game.frame(ts)  the rAF callback (installed by 99_boot.js)
 *   NA.Game.stress()   spawn the stress scene (500 motes, 5000 bullets, 3000 particles)
 *
 * Transition timings are GAME_PLAN 12.4:
 *   last kill 0.6s slow-mo -> sweep 0.4s -> draft -> transform 0.3s ->
 *   zoom out 0.8s (full control) -> materialize 1.0s -> boss intro 1.5s ->
 *   zoom in 0.5s -> a white "go" ring.  Skips are hold-not-tap.
 */
(function () {
  var M = NA.M, C = NA.C;

  var listeners = Object.create(null);

  var G = NA.Game = {
    state: 'title', prevState: '', stateT: 0,
    wave: 0, seed: 1, running: false,
    lastFrame: 0, skipHeld: 0,
    goRing: 0,

    on: function (e, cb) { (listeners[e] || (listeners[e] = [])).push(cb); return cb; },
    off: function (e, cb) { var a = listeners[e]; if (!a) return; var i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); },
    emit: function (e, data) {
      var a = listeners[e]; if (!a) return;
      for (var i = 0; i < a.length; i++) a[i](data);
    },

    setState: function (s) {
      G.prevState = G.state; G.state = s; G.stateT = 0;
      G.emit('stateChange', s);
    },

    /* ------------------------------------------------------------ lifecycle */
    newRun: function (seed) {
      G.seed = seed || ((Date.now() ^ 0x5bf03635) >>> 0);
      NA.RNG.seed(G.seed);
      NA.Arena.reset();
      NA.Enemies.reset();
      NA.Bullets.reset();
      NA.Particles.clear();
      NA.Bosses.clear();
      NA.Events.reset();
      NA.Upgrades.reset();
      NA.Ship.reset();
      NA.Player.reset();
      NA.FX.reset();
      NA.UI.fourthWall.reset();
      NA.Time.setTimeScale(1);
      G.wave = 0;
      NA.Cam.x = NA.Cam.tx = 0; NA.Cam.y = NA.Cam.ty = 0;
      NA.Cam.setZoom(1, 0);
    },

    title: function () {
      G.newRun();
      NA.Cam.fitArena(0);
      NA.UI.resetGate(0, -420);
      G.setState('title');
    },

    startWave: function (n) {
      G.wave = n;
      NA.Waves.start(n);
      NA.Enemies.beacon = false;
      NA.Time.setTimeScale(1);
      NA.Cam.setZoom(1, 500);
      G.goRing = 0.4;
      NA.Particles.ring(NA.Player.x, NA.Player.y, 20, 220, 0.45, 3, 1, 1, 1, 0.9);
      G.setState('wave');
      G.emit('waveStart', n);
    },

    restart: function () {
      G.newRun();
      NA.Cam.setZoom(1, 0);
      G.startWave(1);
    },

    /* Dev entry: ?wave=N starts there with a plausible build. */
    startAt: function (n) {
      G.newRun();
      var ids = NA.Upgrades.list;
      for (var i = 0; i < Math.min(ids.length, Math.floor(n / 2)); i++) NA.Upgrades.take(ids[i % ids.length]);
      G.startWave(n);
    },

    /* ---------------------------------------------------------- stress scene */
    stress: function () {
      G.newRun();
      G.setState('stress');
      NA.Cam.fitArena(0);
      var R = NA.Arena.radius;
      for (var i = 0; i < 500; i++) {
        var a = NA.RNG.f() * M.TAU, r = Math.sqrt(NA.RNG.f()) * R * 0.92;
        var e = NA.Enemies.spawn(i % 7 === 0 ? 'spitter' : 'mote',
          Math.cos(a) * r, Math.sin(a) * r);
        if (e >= 0) { NA.Enemies.spawnT[e] = 0; NA.Enemies.intangible[e] = 0; }
      }
      for (var b = 0; b < 2500; b++) {
        var ba = NA.RNG.f() * M.TAU, br = NA.RNG.f() * R * 0.9;
        var bs = 500 + NA.RNG.f() * 500, bd = NA.RNG.f() * M.TAU;
        NA.Bullets.firePlayer(Math.cos(ba) * br, Math.sin(ba) * br,
          Math.cos(bd) * bs, Math.sin(bd) * bs, { life: 999 });
        NA.Bullets.fireEnemy(Math.cos(ba) * br, Math.sin(ba) * br,
          Math.cos(bd + 1) * bs, Math.sin(bd + 1) * bs, { life: 999, color: C.COL.magenta });
      }
      NA.R.particleCap = 3200;
      for (var p = 0; p < 3000; p++) {
        var pa = NA.RNG.f() * M.TAU, pr = NA.RNG.f() * R;
        NA.Particles.spawn(Math.cos(pa) * pr, Math.sin(pa) * pr,
          NA.RNG.range(-60, 60), NA.RNG.range(-60, 60), 999, 3,
          NA.RNG.f(), NA.RNG.f(), 1, 1, 2, 0.05);
      }
      NA.Events.trigger('supernova');
    },

    /* The stress scene is a steady state, not a one-shot: bullets pop on the
     * membrane and motes die to the player, so the population is topped up
     * every frame. That is the 60fps target, not an average. */
    stressTick: function (dt) {
      var R = NA.Arena.radius;
      NA.Player.invuln = 1;                       // the target is throughput, not survival
      NA.R.particleCap = 3200;
      var E = NA.Enemies;
      for (var g = 0; E.n < 500 && g < 40; g++) {
        var a = NA.RNG.f() * M.TAU, r = Math.sqrt(NA.RNG.f()) * R * 0.92;
        var e = E.spawn(g % 7 === 0 ? 'spitter' : 'mote', Math.cos(a) * r, Math.sin(a) * r);
        if (e < 0) break;
        E.spawnT[e] = 0; E.intangible[e] = 0; E.hp[e] = 1e6;   // keep the crowd alive
      }
      var B = NA.Bullets, made = 0;
      while (B.P.n < 2500 && made++ < 200) {
        var ba = NA.RNG.f() * M.TAU, br = NA.RNG.f() * R * 0.85;
        var bd = NA.RNG.f() * M.TAU, bs = 400 + NA.RNG.f() * 400;
        B.firePlayer(Math.cos(ba) * br, Math.sin(ba) * br, Math.cos(bd) * bs, Math.sin(bd) * bs,
          { life: 8, dmg: 0, bounce: 40 });
      }
      made = 0;
      while (B.E.n < 2500 && made++ < 200) {
        var ea = NA.RNG.f() * M.TAU, er = NA.RNG.f() * R * 0.85;
        var ed = NA.RNG.f() * M.TAU, es = 300 + NA.RNG.f() * 300;
        B.fireEnemy(Math.cos(ea) * er, Math.sin(ea) * er, Math.cos(ed) * es, Math.sin(ed) * es,
          { life: 8, bounce: 40, color: C.COL.magenta, dmg: 0 });
      }
      made = 0;
      while (NA.Particles.pool.n < 3000 && made++ < 300) {
        var pa = NA.RNG.f() * M.TAU, pr = NA.RNG.f() * R;
        NA.Particles.spawn(Math.cos(pa) * pr, Math.sin(pa) * pr,
          NA.RNG.range(-90, 90), NA.RNG.range(-90, 90), 2.5, 3,
          NA.RNG.f(), NA.RNG.f(), 1, 1, 2, 0.05);
      }
    },

    /* ------------------------------------------------------------- sim step */
    step: function (dt) {
      var s = G.state;
      G.stateT += dt;
      if (NA.Audio && NA.Audio.update) NA.Audio.update(dt);   // optional in the real audio module
      NA.Events.update(dt);
      NA.Arena.update(dt);
      NA.HUD.update(dt);

      if (s === 'draft') { NA.Draft.update(dt); if (!NA.Draft.active) G.toOverview(); }

      if (s !== 'draft') {
        NA.Player.update(dt);
        NA.Enemies.update(dt);
        NA.Bullets.update(dt);
        NA.Bosses.update(dt);
        NA.Upgrades.update(dt);
      }
      NA.Particles.update(dt);
      NA.FX.update(dt);
      if (G.goRing > 0) G.goRing -= dt;

      switch (s) {
        case 'stress':
          G.stressTick(dt);
          break;

        case 'title':
          if (NA.UI.gateEntered()) { NA.RNG.seed(G.seed); G.startWave(1); }
          break;

        case 'wave':
          NA.Waves.update(dt);
          if (NA.Waves.done) {
            // last kill: 0.25x time for 700ms, 8% zoom toward the kill
            NA.Time.slowmo(0.25, 700);
            NA.Cam.setZoom(NA.Cam.zoom * 1.15, 300);
            NA.FX.chroma(2.5, 250);
            if (NA.Audio) NA.Audio.sfx('waveClear');
            G.emit('waveClear', G.wave);
            G.setState('lastkill');
          }
          break;

        case 'lastkill':
          // any input ends the slow-mo early
          if (G.stateT > 0.6 || NA.Input.anyPressedThisFrame) G.setState('sweep');
          break;

        case 'sweep':
          if (G.stateT > 0.4) {
            NA.Time.setTimeScale(1);
            if (!NA.Draft.open(G.wave % 6 === 0 ? 4 : 3)) G.toOverview();
            else G.setState('draft');
          }
          break;

        case 'overview':
          // zoom-out with full control; enemies of the next wave materialize
          if (G.stateT > 1.6 || NA.Input.holdTime > 0.3) G.toBoss();
          break;

        case 'boss':
          var b = NA.Bosses.active;
          if (!b || b.state === 'dead') {
            NA.Bosses.clear();
            NA.Arena.setRadius(C.ARENA_R, 1.0);
            NA.Cam.setZoom(1, 500);
            NA.Time.setTimeScale(1);
            G.startWave(G.wave + 1);
          }
          break;

        case 'death':
          if (G.stateT > 1.4) {
            if (!NA.UI.gate.active) NA.UI.resetGate(NA.Player.x, NA.Player.y - 320);
            if (NA.UI.gateEntered() || NA.Input.pressed('fire')) {
              NA.Time.setTimeScale(1);
              G.restart();
            }
          }
          break;
      }
    },

    toOverview: function () {
      // camera eases out over 0.8s until the whole ring fits; time slows to 0.3x
      NA.Cam.fitArena(800);
      NA.Time.setTimeScale(0.3);
      G.setState('overview');
    },

    toBoss: function () {
      NA.Time.setTimeScale(1);
      var w = NA.Waves.get(G.wave);
      var id = (w && w.boss) || NA.Bosses.list[0];
      NA.Enemies.killAll(true);
      NA.Bullets.reset();
      if (id && NA.Bosses.spawn(id)) G.setState('boss');
      else G.startWave(G.wave + 1);
    },

    /* -------------------------------------------------------------- render */
    render: function () {
      var R = NA.R;
      R.begin();
      NA.Events.renderBackdrop();
      NA.Arena.render();
      if (G.state === 'wave') NA.Waves.render();
      NA.Particles.render();
      NA.Bullets.render();
      NA.Enemies.render();
      NA.Bosses.render();
      NA.Player.render();
      NA.Events.renderVeil();
      NA.Upgrades.render();

      if (G.state === 'title') NA.UI.renderTitle();
      if (G.state === 'death') NA.UI.renderDeath();
      if (G.state === 'draft') NA.Draft.render();
      if (G.goRing > 0) {
        var k = 1 - G.goRing / 0.4;
        R.ring(R.L.VEIL, NA.Player.x, NA.Player.y, 20 + k * 260, 3, 1, 1, 1, (1 - k) * 0.9);
      }
      NA.HUD.render();
      NA.FX.apply();
      R.end();
      NA.UI.renderOverlay();
    },

    /* ---------------------------------------------------------- frame loop */
    frame: function (ts) {
      var realDt = G.lastFrame ? (ts - G.lastFrame) / 1000 : 1 / 60;
      G.lastFrame = ts;
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

      NA.Input.poll(realDt);
      var steps = NA.Time.begin(realDt);
      for (var i = 0; i < steps; i++) { G.step(NA.Time.fixed); NA.Time.frames++; }
      if (NA.Audio && NA.Audio.setListener) NA.Audio.setListener(NA.Player.x, NA.Player.y);
      NA.Cam.update(realDt > 0.05 ? 0.05 : realDt);
      // the camera targets the ship plus 25% of the aim vector
      if (G.state !== 'overview' && G.state !== 'title' && G.state !== 'stress') {
        NA.Cam.follow(NA.Player.x, NA.Player.y, NA.Player.aimX - NA.Player.x, NA.Player.aimY - NA.Player.y);
        var want = NA.Enemies.n > 60 ? 0.92 : 1;
        if (G.state === 'boss') {
          var bb = NA.Bosses.active;
          want = (bb && bb.def.camZoom) || 0.95;   // arena bosses ask for a wider view
        }
        if (NA.Cam._zdur <= 0) NA.Cam.tzoom = want;
      }
      if (!NA.params.norender) G.render();
      NA.Input.endFrame();

      var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      NA.R.reportFrame(t1 - t0);
    }
  };

  // player death routes into the death state
  G.on('playerDeath', function () {
    NA.Store.records.best = Math.max(NA.Store.records.best || 0, G.wave);
    NA.Store.save();
    NA.UI.gate.active = false;
    G.setState('death');
  });
  G.on('playerHit', function () { NA.HUD.bump(); });
  G.on('draftPick', function () { NA.HUD.bump(); });
})();

/* ===== 99_boot.js ===== */
/* 99_boot.js — boot, dev overlay, dev URL params, the test harness bridge.
 *
 * Dev params
 *   ?debug=1        fps / entity overlay + on-screen error box
 *   ?wave=N         start at wave N with a plausible build
 *   ?boss=id        jump straight to that boss
 *   ?stress=1       spawn the stress scene (500 enemies, 5000 bullets, 3000 particles)
 *   ?test=1         audio off, deterministic seed, exposes window.__NA_TEST
 *   ?frames=N       with ?test=1: mark the run complete after N frames
 *   ?seed=N         force the run seed
 *   ?quality=0..3   pin the quality tier
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
          entities: { enemies: 0, pbullets: 0, ebullets: 0, particles: 0, instances: 0, draws: 0 }
        };
        if (NA.Audio) NA.Audio.enabled = false;
        NA.Store.settings.autofire = 1;
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
        T.samples.push(ms);
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
      // Stream progress to the console so tools/test.js still has numbers even
      // if the (flaky) headless renderer is killed mid-run.
      if ((T.frames % 30) === 0) {
        var ss = T.samples.slice().sort(function (a, b) { return a - b; });
        var sm = 0; for (var q = 0; q < ss.length; q++) sm += ss[q];
        console.log('NA_STATS ' + JSON.stringify({
          frames: T.frames, mode: T.mode, quality: T.quality,
          avgMs: ss.length ? sm / ss.length : 0,
          p95Ms: ss.length ? ss[Math.min(ss.length - 1, Math.floor(ss.length * 0.95))] : 0,
          maxMs: T.maxMs, state: NA.Game.state, wave: NA.Game.wave,
          entities: T.entities, errors: T.errors.length
        }));
      }
      if (T.targetFrames && T.frames >= T.targetFrames && !T.done) {
        var s = T.samples.slice().sort(function (a, b) { return a - b; });
        var sum = 0; for (var i = 0; i < s.length; i++) sum += s[i];
        T.avgMs = s.length ? sum / s.length : 0;
        T.p95Ms = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
        T.done = true;
      }
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
            '\nhp ' + NA.Player.hp + '  mana ' + NA.Player.mana.toFixed(0) + '  ts ' + NA.Time.timeScale.toFixed(2);
        }
      }
    }

    if (NA.Game.running) requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

