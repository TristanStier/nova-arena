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
  // null-prototype: ?constructor=1 / ?toString=1 must not shadow Object.prototype
  var p = Object.create(null);
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
  // Arena grown 1700 -> 1900 at the owner's request; ARENA_MIN_R is scaled by
  // the same 1.1176 so a shrink wave closes to the same fraction of the arena
  // and feels identical. Every other arena distance in src/ is expressed as a
  // multiple of C.ARENA_R / C.ARENA_MIN_R, so both scale with these two.
  // Pacing pass: arena pulled in 1900 -> 1650 so fights are denser and you
  // cross the ring faster; ARENA_MIN_R scaled by the same 0.868.
  ARENA_R: 1650,
  ARENA_MIN_R: 446,
  SHIP_R: 10,
  // The world window visible at zoom 1 on a 16:9 screen.
  // History: 1100x620 -> 1430x806 -> 2400x1350.  The owner could not read the
  // fight at the old framing, so the combat view was pulled back to 2400 world
  // units wide and then, on a second pass, to 3000 (~79% of the 3800-unit
  // arena diameter). Per the same
  // request, this is now the ONE combat zoom: regular waves and boss fights
  // are framed identically (see NA.Game.frame, which pins Cam.tzoom to 1).
  // fitArena() is unaffected (it solves for the arena, not for VIEW_W).
  // ...and then to 3400 (~103% of the 3300-unit arena diameter) so the whole
  // fight reads at once.
  VIEW_W: 3400, VIEW_H: 1913,

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
  BULLET_SPEED: 1475,
  BULLET_LIFE: 1.42,
  BULLET_DMG: 10,
  /* Global projectile speed trims, applied once at spawn in NA.Bullets
   * (firePlayer / fireEnemy) so they cover every shot in the game, including
   * the ones upgrades and bosses fire with their own hand-picked speeds.
   * Raised at the owner's request ("bullets should move slightly faster");
   * the enemy side is trimmed less so the wider camera does not turn every
   * pattern into a wall you cannot read. */
  BULLET_SPEED_MUL: 1.18,
  EBULLET_SPEED_MUL: 1.10,

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
  simScale: 1,     // ?fast=N — the SIMULATION only; Time.real stays wall clock

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
    var scaled = realDt * this.timeScale * this.simScale;
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
    reticle: 1, autofire: 0, hints: 1, damageNumbers: 0,
    /* bumped whenever a default changes in a way an existing save must adopt;
     * see load(). 2 = auto-fire off by default (hold to shoot). */
    sv: 2
  },
  records: { best: 0, beat30: 0, seen: {} },
  load: function () {
    try {
      var s = localStorage.getItem('na.settings');
      if (s) {
        var o = JSON.parse(s);
        for (var k in o) if (k in this.settings) this.settings[k] = o[k];
        /* A save written before a default changed keeps the OLD value forever,
         * because the merge above always wins. Adopt the new default once. */
        if ((o.sv | 0) < 2) { this.settings.autofire = 0; this.settings.sv = 2; this.save(); }
      }
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
    /* A key may map to one action or to several. Space is both: it still
     * confirms in the menus / draft (where 'fire' is the click) and, at the
     * owner's request, it also triggers the dash in combat. 'dash' is read as
     * an edge (NA.Input.pressed), so holding Space cannot chain-dash. */
    Space: ['dash', 'fire'], ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'active',
    Escape: 'pause', Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3', Digit4: 'pick4',
    Enter: 'confirm'
  };
  // normalise every binding to an array so the handlers have one shape
  for (var _kc in KEYMAP) if (typeof KEYMAP[_kc] === 'string') KEYMAP[_kc] = [KEYMAP[_kc]];
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
    _keyFire: false,

    init: function (el) {
      var self = this;
      window.addEventListener('keydown', function (e) {
        var a = KEYMAP[e.code], j;
        if (a) for (j = 0; j < a.length; j++) {
          if (!self.down[a[j]]) self.pressedSet[a[j]] = 1;
          self.down[a[j]] = true;
          if (a[j] === 'fire') self._keyFire = true;
        }
        self.down['_any'] = true;
        if (e.code === 'Space' || (e.code && e.code.indexOf('Arrow') === 0)) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) {
        var a = KEYMAP[e.code], j;
        if (a) for (j = 0; j < a.length; j++) {
          self.down[a[j]] = false;
          if (a[j] === 'fire') { self._keyFire = false; self.down.fire = !!self.mouse.left; }
        }
        self.down['_any'] = self._anyKey();
      });
      // A button released over browser chrome never reaches the page; clear on
      // blur, pointerup, pointercancel and mouseleave so fire/dash cannot stick.
      var clearButtons = function () {
        self.mouse.left = self.mouse.right = self.mouse.mid = false;
        self.down.fire = !!self._keyFire;
        self.down.dash = false; self.down.active = false;
        self.down['_any'] = self._anyKey();
      };
      self._clearButtons = clearButtons;
      window.addEventListener('blur', function () { self.down = {}; self._keyFire = false; self.mouse.left = self.mouse.right = self.mouse.mid = false; });
      window.addEventListener('pointerup', function () { clearButtons(); });
      window.addEventListener('pointercancel', function () { clearButtons(); });
      document.addEventListener('mouseleave', function () { clearButtons(); });
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
      // Hat/d-pad-as-buttons pads (arcade sticks, retro pads) report 12..15.
      if (gp && gp.buttons && gp.buttons.length > 15) {
        var db = gp.buttons;
        if (db[14] && db[14].pressed) x -= 1;
        if (db[15] && db[15].pressed) x += 1;
        if (db[12] && db[12].pressed) y -= 1;
        if (db[13] && db[13].pressed) y += 1;
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
