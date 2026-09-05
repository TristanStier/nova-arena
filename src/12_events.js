/* =============================================================================
 * NOVA ARENA — 12_events.js — NA.Events
 * The sky is an information source (GAME_PLAN pillar 8 / §10.1 / §10.3 / §10.4).
 *
 * Contains:
 *   - the event registry and the telegraph -> active -> decay lifecycle
 *   - five procedural biome backdrops (three parallax layers each) with a 2 s
 *     crossfade, accent palette, music mode and the hex arena for `core`
 *   - all eighteen background events from the §10.3 table
 *   - the per-act scheduler and the reveal countdown arc
 *   - the between-wave overview flourishes from §10.4
 *
 * PUBLIC API
 * ----------
 *   NA.Events.define(id, def)
 *     def = { layer:'backdrop'|'veil', telegraph, active, decay, reveal:true,
 *             onStart(e) onActive(e) onDecay(e) onEnd(e) update(e,dt) render(e)
 *             reveal(e,x,y)->0..1        invisible enemies
 *             damageMul(e,x,y)->mul      player bullet damage
 *             speedMul(e,x,y)->mul       movement speed of everything
 *             timeMul(e,x,y)->mul        local time (bullets included)
 *             force(e,x,y,out)           adds an acceleration into out.x/out.y
 *             hidden(e,x,y)->0..1        enemies cannot aim at the player }
 *   NA.Events.trigger(id, opts) -> e | null     at most one per layer
 *   NA.Events.stop(id) / stopAll() / isActive(id) / active
 *   NA.Events.update(dt) / renderBackdrop() / renderVeil()
 *   NA.Events.setBiome(id)                'ember'|'pulsar'|'storm'|'horizon'|'core'
 *   NA.Events.biome / accent[3] / biomeK  (crossfade 0..1)
 *   NA.Events.schedule(biome, wave)       arm the act's event set + cadence
 *   NA.Events.strobeMultiplier            Strobe ambient mutator (3 = 3x as often)
 *   NA.Events.overview(enemyList)         §10.4 rim pulses + print-in flourish
 *
 * QUERY API (all allocation-free; safe to call from hot loops)
 * ------------------------------------------------------------
 *   NA.Events.revealAlpha(x, y) -> 0..1     invisible-enemy visibility
 *   NA.Events.damageMulAt(x, y) -> mul      player bullet damage multiplier
 *   NA.Events.speedMulAt(x, y)  -> mul      movement multiplier (aurora, craters)
 *   NA.Events.timeMulAt(x, y)   -> mul      local time multiplier (Time Fracture)
 *   NA.Events.forceAt(x, y, out) -> out     out.x/out.y acceleration (ripple,
 *                                           black hole, solar wind); `out` is
 *                                           written in place, never allocated
 *   NA.Events.hiddenAt(x, y)    -> 0..1     1 = enemies cannot see the player
 *   NA.Events.domesDown         -> bool     Sentinel/Cathedral domes are down
 *   NA.Events.inverted          -> 0..1     Ion Storm hue-swap amount
 *   NA.Events.manaMul           -> mul      mana regen multiplier (Eclipse; the
 *                                           bonus is already paid out by this
 *                                           module, so this is informational)
 *   NA.Events.onBeatWindow()    -> 0..1     1 inside the Resonance Pulse window
 *   NA.Events.windX / windY                 Solar Wind / Tide push
 *   NA.Events.flashScale()      -> 0..1     reduce-flash setting, normalised
 *
 * DEV URL PARAMS (this file only, same spirit as ?boss=id)
 * --------------------------------------------------------
 *   ?event=id       trigger one event at boot and hold the scheduler off
 *   ?biome=id       force a biome (palette, music mode, arena shape)
 *   ?evhold=phase   park every event in 'telegraph'|'active'|'decay' for QA
 *   ?evfit=z        pin the camera zoom so a whole event fits the frame
 *
 * COOPERATION WITH THE WAVE RUNNER
 * --------------------------------
 * 14_waves.js drives the ambient cadence itself whenever a wave script carries
 * a non-empty `events` list. Two schedulers would double-trigger, so this one
 * stands down there and only mirrors the rim countdown arc off the runner's
 * timer. NA.Events.schedule(biome, wave) stays callable and is used for waves
 * (and for endless remixes) that do not name their own event set.
 * ============================================================================= */
(function () {
  var M = NA.M, C = NA.C;
  var EMPTY = {};

  /* ---------------------------------------------------------------- random
   * A private stream: event jitter must never perturb draft offers or spawns. */
  var _s = 0x1F123BB5;
  function rnd() { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; }
  function rr(a, b) { return a + rnd() * (b - a); }

  /* reduce-flash: the store ships 0..1, the settings menu offers 0..3. Both are
   * accepted; the result is always a 0..1 multiplier on flash and strobing. */
  function flashScale() {
    var v = NA.Store.settings.flash;
    if (v === undefined) v = 1;
    return M.clamp01(v > 1 ? v / 3 : v);
  }

  /* Events may only hurt the player while a fight is actually running. */
  function live() {
    var s = NA.Game ? NA.Game.state : 'wave';
    return (s === 'wave' || s === 'boss' || s === 'stress') && NA.Player.alive && NA.Player.invuln <= 0;
  }

  function sfx(name, x, y) {
    if (!NA.Audio) return;
    if (x === undefined) NA.Audio.sfx(name);
    else NA.Audio.sfx(name, { x: x, y: y });
  }

  /* ========================================================== BIOME PALETTES
   * a/b/c are the three nebula-lobe tones (desaturated navies and plums at
   * 10-25% alpha, §10.1), `star` the far-star tint, `dust` the near layer and
   * `accent` the act's signature colour that events borrow. */
  var BIOMES = {
    ember: {
      mode: 'dorian', shape: 'circle',
      a: [0.42, 0.16, 0.05], b: [0.24, 0.06, 0.18], c: [0.30, 0.10, 0.06],
      star: [1.00, 0.86, 0.70], dust: [0.90, 0.50, 0.28], accent: [1.00, 0.541, 0.0],
      events: ['supernova', 'solarWind', 'flareCascade'], cadence: 21
    },
    pulsar: {
      mode: 'lydian', shape: 'circle',
      a: [0.05, 0.17, 0.34], b: [0.02, 0.08, 0.24], c: [0.10, 0.22, 0.30],
      star: [0.76, 0.93, 1.00], dust: [0.35, 0.70, 1.00], accent: [0.30, 0.95, 1.00],
      events: ['pulsarSweep', 'supernova', 'cometPass', 'eclipse'], cadence: 18
    },
    storm: {
      mode: 'phrygian', shape: 'circle',
      a: [0.19, 0.06, 0.30], b: [0.04, 0.20, 0.13], c: [0.12, 0.05, 0.22],
      star: [0.86, 0.80, 1.00], dust: [0.60, 0.35, 1.00], accent: [0.608, 0.361, 1.0],
      events: ['nebulaLightning', 'phaseFog', 'auroraLanes', 'starShadow'], cadence: 16
    },
    horizon: {
      mode: 'aeolian', shape: 'circle',
      a: [0.05, 0.04, 0.09], b: [0.09, 0.03, 0.13], c: [0.03, 0.05, 0.10],
      star: [0.80, 0.82, 0.92], dust: [0.45, 0.42, 0.62], accent: [0.55, 0.45, 0.95],
      events: ['gravityRipple', 'blackHoleBloom', 'timeFracture', 'resonancePulse', 'darkPhase'], cadence: 15
    },
    core: {
      mode: 'mixolydian', shape: 'hex',
      a: [0.42, 0.24, 0.05], b: [0.14, 0.05, 0.20], c: [0.34, 0.12, 0.10],
      star: [1.00, 0.95, 0.86], dust: [1.00, 0.70, 0.35], accent: [1.00, 0.847, 0.302],
      events: ['ionStorm', 'riftSpawn', 'meteorShower', 'supernova', 'flareCascade', 'auroraLanes'], cadence: 13
    }
  };

  /* ========================================================= BACKDROP LAYERS
   * Three procedural parallax layers, all sprites, all preallocated:
   *   far   300 stars   parallax 0.14   twinkle
   *   mid    12 lobes   parallax 0.42   slow counter-rotation
   *   near   96 dust    parallax 0.82   drifts with the wind
   * Positions live in a wrapping tile so the field never runs out under the
   * camera; the tile is re-wrapped per sprite with one modulo, no allocation. */
  var NSTAR = 300, NLOBE = 12, NDUST = 96;
  var TILE_F = 3000, TILE_N = 2600;

  var stX = new Float32Array(NSTAR), stY = new Float32Array(NSTAR),
    stS = new Float32Array(NSTAR), stP = new Float32Array(NSTAR), stH = new Float32Array(NSTAR);
  var lbX = new Float32Array(NLOBE), lbY = new Float32Array(NLOBE), lbR = new Float32Array(NLOBE),
    lbA = new Float32Array(NLOBE), lbW = new Float32Array(NLOBE), lbT = new Int32Array(NLOBE);
  var duX = new Float32Array(NDUST), duY = new Float32Array(NDUST),
    duS = new Float32Array(NDUST), duP = new Float32Array(NDUST);
  var duDX = 0, duDY = 0;                       // accumulated near-dust drift

  (function seedField() {
    var i;
    for (i = 0; i < NSTAR; i++) {
      stX[i] = rr(-TILE_F * 0.5, TILE_F * 0.5);
      stY[i] = rr(-TILE_F * 0.5, TILE_F * 0.5);
      stS[i] = 1.1 + rnd() * rnd() * 4.2;       // squared so most stars are tiny
      stP[i] = rnd() * M.TAU;
      stH[i] = rnd();                            // 0 = biome tint, 1 = white-hot
    }
    for (i = 0; i < NLOBE; i++) {
      var a = i / NLOBE * M.TAU + rr(-0.4, 0.4);
      var d = rr(0.05, 1.45) * C.ARENA_R;
      lbX[i] = Math.cos(a) * d; lbY[i] = Math.sin(a) * d;
      lbR[i] = rr(0.30, 0.78) * C.ARENA_R;
      lbA[i] = rnd() * M.TAU;
      lbW[i] = rr(-0.05, 0.05);
      lbT[i] = i % 3;                            // which palette tone
    }
    for (i = 0; i < NDUST; i++) {
      duX[i] = rr(-TILE_N * 0.5, TILE_N * 0.5);
      duY[i] = rr(-TILE_N * 0.5, TILE_N * 0.5);
      duS[i] = rr(2.5, 9);
      duP[i] = rnd() * M.TAU;
    }
  })();

  function wrap(v, tile) {
    var h = tile * 0.5;
    v = (v + h) % tile;
    if (v < 0) v += tile;
    return v - h;
  }

  /* Two extra atlas glyphs: an organic nebula lobe and a soft dust mote.
   * Registered lazily so the atlas canvas exists (R.init builds the rest). */
  var glyphsReady = false;
  function ensureGlyphs() {
    if (glyphsReady || !NA.Atlas || !NA.Atlas.add) return;
    glyphsReady = true;
    NA.Atlas.add('evLobe', 128, function (c, s) {
      // four overlapping radial blobs -> a cloud silhouette, not a circle
      var i, blob = [[0, 0, 0.30], [0.11, -0.06, 0.20], [-0.10, 0.09, 0.22], [0.05, 0.13, 0.15]];
      c.globalCompositeOperation = 'lighter';
      for (i = 0; i < blob.length; i++) {
        var bx = blob[i][0] * s, by = blob[i][1] * s, br = blob[i][2] * s;
        var g = c.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(bx, by, br, 0, 6.2832); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    });
    NA.Atlas.add('evDust', 64, function (c, s) {
      var g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.30);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s * 0.30, 0, 6.2832); c.fill();
    });
  }

  /* ================================================================ REGISTRY */
  var defs = Object.create(null);
  var FORCE_OUT = { x: 0, y: 0 };
  var TMP = { x: 0, y: 0 };

  var Ev = NA.Events = {
    defs: defs,
    active: [],
    biome: 'ember', biomeFrom: 'ember', biomeK: 1,
    accent: [1, 0.541, 0],
    windX: 0, windY: 0,
    strobeMultiplier: 1,
    domesDown: false,
    inverted: 0,
    beatWindow: 0,                 // resonancePulse: 0..1, refreshed every step
    hasDamageField: false, hasHiddenField: false,
    hasRevealField: false, hasConcealField: false,
    manaMul: 1,
    lastReveal: 0,

    /* internal field flags — the per-frame field application is skipped
     * entirely unless an event that needs it is live */
    _fields: 0,                 // bit 1 speed, 2 time, 4 force, 8 wind
    _revealNextIn: 0, _revealNextTotal: 0, _revealNextId: '',

    flashScale: flashScale,

    /* --------------------------------------------------------------- biome */
    setBiome: function (name) {
      var b = BIOMES[name]; if (!b || name === Ev.biome) return;
      Ev.biomeFrom = Ev.biome; Ev.biome = name; Ev.biomeK = 0;
      if (NA.Audio && NA.Audio.music) NA.Audio.music.setMode(b.mode);
      if (NA.Arena && NA.Arena.shape !== b.shape) NA.Arena.setShape(b.shape);
    },
    biomeDef: function (name) { return BIOMES[name || Ev.biome] || BIOMES.ember; },

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
      var i;
      // at most one Veil and one Backdrop event at a time
      for (i = Ev.active.length - 1; i >= 0; i--) {
        if (Ev.active[i].def.layer === d.layer) Ev.stopIndex(i);
      }
      // explicit incompatibility: darkness and fog never stack
      if (id === 'darkPhase') Ev.stop('phaseFog');
      if (id === 'phaseFog') Ev.stop('darkPhase');
      var e = {
        def: d, id: id, phase: d.telegraph > 0 ? 'telegraph' : 'active',
        t: 0, k: 0, life: 0, x: 0, y: 0,
        angle: rnd() * M.TAU, opts: opts || EMPTY, data: {},
        a: 0, b: 0, c: 0, n: 0, seed: rnd()
      };
      if (opts && opts.angle !== undefined) e.angle = opts.angle;
      Ev.active.push(e);
      if (d.onStart) d.onStart(e);
      if (e.phase === 'active' && d.onActive) d.onActive(e);
      Ev.refreshFields();
      return e;
    },
    /* d.update() above may have triggered or stopped another event, and both
     * splice Ev.active — so this index is no longer trustworthy. Stop by
     * IDENTITY or the wrong event gets its onEnd run. */
    stopEvent: function (e) {
      var k = Ev.active.indexOf(e);
      if (k >= 0) Ev.stopIndex(k);
    },
    stopIndex: function (i) {
      var e = Ev.active[i];
      if (e.def.onEnd) e.def.onEnd(e);
      Ev.active.splice(i, 1);
      Ev.refreshFields();
    },
    stop: function (id) {
      for (var i = Ev.active.length - 1; i >= 0; i--) if (Ev.active[i].id === id) Ev.stopIndex(i);
    },
    stopAll: function () { while (Ev.active.length) Ev.stopIndex(Ev.active.length - 1); },
    isActive: function (id) {
      for (var i = 0; i < Ev.active.length; i++) if (Ev.active[i].id === id && Ev.active[i].phase === 'active') return true;
      return false;
    },
    find: function (id) {
      for (var i = 0; i < Ev.active.length; i++) if (Ev.active[i].id === id) return Ev.active[i];
      return null;
    },

    refreshFields: function () {
      var f = 0, dm = false, hd = false, rv = false, cn = false;
      for (var i = 0; i < Ev.active.length; i++) {
        var d = Ev.active[i].def;
        if (d.speedMul) f |= 1;
        if (d.timeMul) f |= 2;
        if (d.force) f |= 4;
        if (d.damageMul) dm = true;
        if (d.hidden) hd = true;
        if (d.reveal) rv = true;
        if (d.conceal) cn = true;
      }
      Ev._fields = f;
      /* Cheap gates for the hot readers (bullet hits, per-enemy reveal, the
       * enemy pass): no active event carrying the rule means no loop at all. */
      Ev.hasDamageField = dm; Ev.hasHiddenField = hd;
      Ev.hasRevealField = rv; Ev.hasConcealField = cn;
    },

    /* -------------------------------------------------------------- update */
    update: function (dt) {
      var i, e, d;

      if (Ev.biomeK < 1) Ev.biomeK = Math.min(1, Ev.biomeK + dt / 2);     // 2 s crossfade
      var bf = BIOMES[Ev.biomeFrom] || BIOMES.ember, bt = BIOMES[Ev.biome] || BIOMES.ember;
      var k = Ev.biomeK;
      Ev.accent[0] = bf.accent[0] + (bt.accent[0] - bf.accent[0]) * k;
      Ev.accent[1] = bf.accent[1] + (bt.accent[1] - bf.accent[1]) * k;
      Ev.accent[2] = bf.accent[2] + (bt.accent[2] - bf.accent[2]) * k;

      Ev.domesDown = false; Ev.inverted = 0; Ev.manaMul = 1;
      Ev.windX *= Math.max(0, 1 - dt * 1.6); Ev.windY *= Math.max(0, 1 - dt * 1.6);

      for (i = Ev.active.length - 1; i >= 0; i--) {
        e = Ev.active[i]; d = e.def;
        e.t += dt; e.life += dt;
        var dur = d[e.phase] || 0.001;
        // ?evhold=telegraph|active|decay parks an event in one phase for QA
        if (NA.params.evhold === e.phase) e.t = dur * 0.5;
        e.k = M.clamp01(e.t / dur);
        if (d.update) d.update(e, dt);
        if (e.t >= dur) {
          if (e.phase === 'telegraph') { e.phase = 'active'; e.t = 0; e.k = 0; if (d.onActive) d.onActive(e); }
          else if (e.phase === 'active') {
            if (d.decay > 0) { e.phase = 'decay'; e.t = 0; e.k = 0; if (d.onDecay) d.onDecay(e); }
            else { Ev.stopEvent(e); continue; }
          } else { Ev.stopEvent(e); continue; }
        }
      }

      // resonancePulse publishes its window here so a bullet can be stamped at
      // spawn (08_bullets.firePlayer) instead of at impact
      Ev.beatWindow = Ev.onBeatWindow();

      ensureHooks();
      devParams();
      if (NA.params.evfit) { evfitT -= dt; if (evfitT <= 0) { evfitT = 0.1; NA.Cam.setZoom(+NA.params.evfit > 0.1 ? +NA.params.evfit : 0.52, 400); } }
      applyFields(dt);
      duDX += Ev.windX * dt * 0.35; duDY += Ev.windY * dt * 0.35;
      updateSchedule(dt);
      updateOverview(dt);
    },

    /* ---------------------------------------------------------- query API */
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
    damageMulAt: function (x, y) {
      var m = 1;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (e.def.damageMul) m *= e.def.damageMul(e, x, y);
      }
      return m;
    },
    speedMulAt: function (x, y) {
      if (!(Ev._fields & 1)) return 1;
      var m = 1;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (e.def.speedMul) m *= e.def.speedMul(e, x, y);
      }
      return m;
    },
    timeMulAt: function (x, y) {
      if (!(Ev._fields & 2)) return 1;
      var m = 1;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (e.def.timeMul) m *= e.def.timeMul(e, x, y);
      }
      return m;
    },
    forceAt: function (x, y, out) {
      out = out || FORCE_OUT;
      out.x = Ev.windX; out.y = Ev.windY;
      if (!(Ev._fields & 4)) return out;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (e.def.force) e.def.force(e, x, y, out);
      }
      return out;
    },
    /* The mirror of revealAlpha: Phase Fog hides what a sweep would reveal. */
    concealAt: function (x, y) {
      var best = 0;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (!e.def.conceal) continue;
        var v = e.def.conceal(e, x, y);
        if (v > best) best = v;
      }
      return best > 1 ? 1 : best;
    },
    hiddenAt: function (x, y) {
      var best = 0;
      for (var i = 0; i < Ev.active.length; i++) {
        var e = Ev.active[i];
        if (!e.def.hidden) continue;
        var v = e.def.hidden(e, x, y);
        if (v > best) best = v;
      }
      return best;
    },
    onBeatWindow: function () {
      var e = Ev.find('resonancePulse');
      if (!e || e.phase !== 'active') return 0;
      return e.data.win || 0;
    },

    reset: function () {
      Ev.stopAll();
      Ev.windX = Ev.windY = 0;
      Ev.strobeMultiplier = 1;
      Ev.domesDown = false; Ev.inverted = 0; Ev.manaMul = 1; Ev.beatWindow = 0;
      Ev.biome = Ev.biomeFrom = 'ember'; Ev.biomeK = 1;
      schedQueue.length = 0; schedT = 0; schedI = 0; schedOn = false;
      Ev._revealNextIn = 0; Ev._revealNextTotal = 0; Ev._revealNextId = '';
      ovT = 0; ovN = 0;
      duDX = duDY = 0;
      craterN = 0; meteorN = 0; stampN = 0; stunN = 0;
    }
  };

  /* ===================================================== FIELD APPLICATION
   * Events cannot patch the foundation's integrators, so the fields are applied
   * here — Ev.update() runs at the top of NA.Game.step(), before Player,
   * Enemies and Bullets integrate. Speed and time multipliers are applied as a
   * positional counter-nudge (x -= vx*dt*(1-mul)); the integrator then adds
   * vx*dt, so the net displacement is exactly vx*dt*mul and no velocity is ever
   * permanently modified. Forces are real accelerations. */
  function applyFields(dt) {
    var f = Ev._fields, i, mul, ax, ay;
    var wx = Ev.windX, wy = Ev.windY;
    var anyWind = (wx * wx + wy * wy) > 1;
    if (!f && !anyWind && !stunN) return;

    var P = NA.Player, En = NA.Enemies, B = NA.Bullets;

    /* --- the player: wind and forces push, aurora/craters change speed --- */
    if (P.alive) {
      if (f & 4 || anyWind) {
        Ev.forceAt(P.x, P.y, TMP);
        // half strength: the ship always keeps authority over its own heading
        P.x += TMP.x * dt * 0.02; P.y += TMP.y * dt * 0.02;
        P.vx += TMP.x * dt * 0.5; P.vy += TMP.y * dt * 0.5;
      }
      if (f & 1) {
        mul = Ev.speedMulAt(P.x, P.y);
        if (mul !== 1) { P.x -= P.vx * dt * (1 - mul); P.y -= P.vy * dt * (1 - mul); }
      }
    }

    /* --------------------------------------------------------- enemies --- */
    if (En && En.n) {
      var n = En.n;
      for (i = 0; i < n; i++) {
        if (En.spawnT[i] > 0) continue;
        if (f & 1) {
          mul = Ev.speedMulAt(En.x[i], En.y[i]);
          if (mul !== 1) { En.x[i] -= En.vx[i] * dt * (1 - mul); En.y[i] -= En.vy[i] * dt * (1 - mul); }
        }
        if (f & 2) {
          mul = Ev.timeMulAt(En.x[i], En.y[i]);
          if (mul !== 1) { En.x[i] -= En.vx[i] * dt * (1 - mul); En.y[i] -= En.vy[i] * dt * (1 - mul); }
        }
        if (f & 4 || anyWind) {
          Ev.forceAt(En.x[i], En.y[i], TMP);
          En.x[i] += TMP.x * dt * 0.05; En.y[i] += TMP.y * dt * 0.05;
          En.vx[i] += TMP.x * dt; En.vy[i] += TMP.y * dt;
        }
      }
      applyStun(dt);
    }

    /* --------------------------------------------------------- bullets ---
     * There can be twelve thousand of these. The corrections are positional
     * and linear, so running them every fourth step at four times the size is
     * numerically identical and costs a quarter as much. */
    if (B && (NA.Time.frames & 3) === 0) {
      var pool, pn, kk;
      dt *= 4;
      for (kk = 0; kk < 2; kk++) {
        pool = kk === 0 ? B.P : B.E;
        pn = pool.n;
        for (i = 0; i < pn; i++) {
          var vx = pool.vx[i], vy = pool.vy[i];
          if (f & 2) {
            mul = Ev.timeMulAt(pool.x[i], pool.y[i]);
            if (mul !== 1) { pool.x[i] -= vx * dt * (1 - mul); pool.y[i] -= vy * dt * (1 - mul); }
          }
          if (f & 4 || anyWind) {
            Ev.forceAt(pool.x[i], pool.y[i], TMP);
            ax = TMP.x * dt * 0.6; ay = TMP.y * dt * 0.6;
            pool.vx[i] = vx + ax; pool.vy[i] = vy + ay;
            if (ax * ax + ay * ay > 0.02) pool.rot[i] = Math.atan2(pool.vy[i], pool.vx[i]);
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------- the stun
   * Supernova freezes the enemies facing the star for 0.5 s. Enemy indices are
   * swap-removed, so a snapshot stores position + type as a signature and only
   * re-pins a slot that still matches. Capped at the 40 nearest. */
  var STUN_MAX = 40;
  var stunI = new Int32Array(STUN_MAX), stunT = new Int32Array(STUN_MAX);
  var stunX = new Float32Array(STUN_MAX), stunY = new Float32Array(STUN_MAX);
  var stunN = 0, stunLeft = 0;

  function beginStun(sx, sy, seconds) {
    var En = NA.Enemies; stunN = 0; stunLeft = seconds;
    if (!En || !En.n) return;
    for (var i = 0; i < En.n && stunN < STUN_MAX; i++) {
      // "facing the star": its velocity has a component toward the star
      if (En.vx[i] * (sx - En.x[i]) + En.vy[i] * (sy - En.y[i]) <= 0) continue;
      stunI[stunN] = i; stunT[stunN] = En.type[i];
      stunX[stunN] = En.x[i]; stunY[stunN] = En.y[i];
      stunN++;
    }
  }
  function applyStun(dt) {
    if (stunLeft <= 0) { stunN = 0; return; }
    stunLeft -= dt;
    var En = NA.Enemies, k, i;
    for (k = 0; k < stunN; k++) {
      i = stunI[k];
      if (i >= En.n || En.type[i] !== stunT[k]) continue;
      var dx = En.x[i] - stunX[k], dy = En.y[i] - stunY[k];
      if (dx * dx + dy * dy > 40000) continue;       // the slot was recycled
      En.x[i] = stunX[k]; En.y[i] = stunY[k];
      En.vx[i] *= 0.02; En.vy[i] *= 0.02;
    }
    if (stunLeft <= 0) stunN = 0;
  }

  /* =============================================================== BACKDROP */
  function lobeTone(b, t) { return t === 0 ? b.a : (t === 1 ? b.b : b.c); }

  function drawLobes(b, alpha, tsec) {
    var R = NA.R, L = R.L, i;
    var cxp = NA.Cam.x * (1 - 0.42), cyp = NA.Cam.y * (1 - 0.42);
    var n = R.bgQuota(NLOBE);                   // arrays stay full, draw count scales
    for (i = 0; i < n; i++) {
      var tone = lobeTone(b, lbT[i]);
      var breathe = 1 + 0.06 * Math.sin(tsec * 0.21 + lbA[i]);
      var a = (0.075 + 0.095 * (0.5 + 0.5 * Math.sin(tsec * 0.13 + i))) * alpha;
      // the palette stores the tone; the lobe glyph is soft, so it is lifted
      // here to keep the nebula readable without pushing the alpha into a wash
      var tr = tone[0] * 2.2, tg = tone[1] * 2.2, tb = tone[2] * 2.2;
      if (tr > 1) tr = 1; if (tg > 1) tg = 1; if (tb > 1) tb = 1;
      R.sprite(L.BACKDROP, 'evLobe',
        lbX[i] + cxp, lbY[i] + cyp,
        lbA[i] + lbW[i] * tsec, lbR[i] * breathe, lbR[i] * breathe * 0.86,
        tr, tg, tb, a);
    }
  }

  function drawStars(b, alpha, tsec) {
    var R = NA.R, L = R.L, i;
    var camx = NA.Cam.x, camy = NA.Cam.y;
    var sr = b.star[0], sg = b.star[1], sb = b.star[2];
    var n = R.bgQuota(NSTAR);
    for (i = 0; i < n; i++) {
      var px = wrap(stX[i] - camx * 0.14, TILE_F) + camx;
      var py = wrap(stY[i] - camy * 0.14, TILE_F) + camy;
      var tw = 0.5 + 0.5 * Math.sin(tsec * (1.1 + stH[i] * 1.7) + stP[i]);
      var h = stH[i] * stH[i];
      var a = (0.20 + 0.55 * tw) * alpha * (0.5 + 0.5 * h);
      R.sprite(L.BACKDROP, 'spark', px, py, stP[i], stS[i], stS[i],
        sr + (1 - sr) * h, sg + (1 - sg) * h, sb + (1 - sb) * h, a);
    }
  }

  function drawDust(b, alpha, tsec) {
    var R = NA.R, L = R.L, i;
    var camx = NA.Cam.x, camy = NA.Cam.y;
    var dr = b.dust[0], dg = b.dust[1], db = b.dust[2];
    var n = R.bgQuota(NDUST);
    for (i = 0; i < n; i++) {
      var px = wrap(duX[i] + duDX - camx * 0.82, TILE_N) + camx;
      var py = wrap(duY[i] + duDY - camy * 0.82, TILE_N) + camy;
      var a = (0.045 + 0.045 * Math.sin(tsec * 0.6 + duP[i])) * alpha;
      R.sprite(L.BACKDROP, 'evDust', px, py, 0, duS[i], duS[i], dr, dg, db, a);
    }
  }

  Ev.renderBackdrop = function () {
    ensureGlyphs();
    var tsec = NA.Time.t;
    var bf = BIOMES[Ev.biomeFrom] || BIOMES.ember, bt = BIOMES[Ev.biome] || BIOMES.ember;
    // Below quality tier 2 the outgoing biome is skipped entirely: the
    // crossfade doubles the backdrop draw count, and a tier-0/1 machine cannot
    // pay for it. The incoming biome is drawn at full alpha so the swap is a
    // hard cut instead of a fade-through-black.
    var lo = NA.R.quality < 2;
    var k = lo ? 1 : Ev.biomeK;
    // far -> mid -> near, crossfaded biome by biome
    if (k < 1) { drawStars(bf, 1 - k, tsec); drawLobes(bf, 1 - k, tsec); }
    drawStars(bt, k, tsec);
    drawLobes(bt, k, tsec);
    if (k < 1) drawDust(bf, 1 - k, tsec);
    drawDust(bt, k, tsec);

    for (var i = 0; i < Ev.active.length; i++) {
      var e = Ev.active[i];
      if (e.def.layer === 'backdrop' && e.def.render) e.def.render(e);
    }
  };

  Ev.renderVeil = function () {
    for (var i = 0; i < Ev.active.length; i++) {
      var e = Ev.active[i];
      if (e.def.layer === 'veil' && e.def.render) e.def.render(e);
    }
    renderCountdown();
    renderOverview();
  };

  /* ====================================================== REVEAL COUNTDOWN
   * A thin arc on the arena rim fills toward the next reveal event
   * (supernova / pulsarSweep / cometPass) so experts can time their fights. */
  var REVEALERS = { supernova: 1, pulsarSweep: 1, cometPass: 1, eclipse: 1 };

  function renderCountdown() {
    if (!Ev._revealNextTotal || !Ev._revealNextId) return;
    var R = NA.R, L = R.L, A = NA.Arena;
    var k = M.clamp01(1 - Ev._revealNextIn / Ev._revealNextTotal);
    var acc = Ev.accent;
    var rad = A.radius + 30;
    var a0 = -M.HALFPI, a1 = a0 + M.TAU * k;
    var breathe = 0.35 + 0.25 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ * (0.35 + k * 0.65));
    R.arc(L.HUD, A.cx, A.cy, rad, a0, a1, 2.2, acc[0], acc[1], acc[2], (0.18 + 0.4 * k * k) * breathe * 2);
    // the head pip: gold once it is imminent, so it reads as "attention now"
    var hx = A.cx + Math.cos(a1) * rad, hy = A.cy + Math.sin(a1) * rad;
    var imm = k > 0.9 ? 1 : 0;
    R.dot(L.HUD, hx, hy, 3 + imm * 2.5,
      imm ? 1 : acc[0], imm ? 0.847 : acc[1], imm ? 0.302 : acc[2], 0.5 + 0.5 * k);
  }

  /* ============================================================= SCHEDULER */
  var schedQueue = [], schedT = 0, schedI = 0, schedOn = false, schedCad = 20;

  Ev.schedule = function (biome, wave) {
    var b = BIOMES[biome] || BIOMES[Ev.biome] || BIOMES.ember;
    if (biome && BIOMES[biome]) Ev.setBiome(biome);
    schedQueue.length = 0;
    for (var i = 0; i < b.events.length; i++) {
      var id = b.events[i];
      // Eclipse is a once-per-act moment (wave 9 of Act II); Pulsar Sweep is
      // constant in its act, so it opens the queue.
      if (id === 'eclipse' && (wave | 0) !== 9) continue;
      schedQueue.push(id);
    }
    if (!schedQueue.length) { schedOn = false; return; }
    schedCad = b.cadence;
    // later waves in an act breathe a little faster
    var into = ((wave | 0) - 1) % 6;
    schedCad *= (1 - into * 0.045);
    schedI = 0; schedOn = true;
    schedT = schedQueue[0] === 'pulsarSweep' ? 4 : schedCad * 0.55;
    armCountdown();
    return schedQueue;
  };

  function armCountdown() {
    // find the next queued reveal event and expose its countdown
    var n = schedQueue.length;
    if (!n) { Ev._revealNextTotal = 0; return; }
    var t = schedT;
    for (var s = 0; s < n; s++) {
      var id = schedQueue[(schedI + s) % n];
      if (REVEALERS[id]) {
        Ev._revealNextId = id;
        Ev._revealNextIn = t;
        Ev._revealNextTotal = Math.max(t, 0.001);
        return;
      }
      t += schedCad / Math.max(0.2, Ev.strobeMultiplier);
    }
    Ev._revealNextTotal = 0; Ev._revealNextId = '';
  }

  /* The wave runner (14_waves.js) drives the ambient cadence itself whenever a
   * wave script carries an `events` list. Two schedulers would double-trigger,
   * so this one stands down there and only mirrors the countdown arc off the
   * runner's own timer. NA.Events.schedule() stays callable either way. */
  function wavesDrivesEvents() {
    var W = NA.Waves;
    if (!W || !W.current || W._eventT === undefined) return null;
    var w = W.current;
    /* Exactly one driver, and it is the wave runner whenever the wave script
     * carries an events list (wave 3 and up). The gate mirrors 14_waves.js
     * _eventTick() exactly, so neither of them can fire when the other does. */
    return (w.events && w.events.length && W.n >= 3) ? w : null;
  }

  var wavePeriod = 17, waveLastT = 0;

  function armFromWaves(w) {
    var W = NA.Waves, i, hit = -1;
    for (i = 0; i < w.events.length; i++) if (REVEALERS[w.events[i]]) { hit = i; break; }
    // learn the runner's period by watching its timer reset
    var et = W._eventT || 0;
    if (et > waveLastT + 0.001) wavePeriod = et;
    waveLastT = et;
    if (hit < 0) { Ev._revealNextTotal = 0; Ev._revealNextId = ''; return; }
    Ev._revealNextId = w.events[hit];
    Ev._revealNextIn = et < 0 ? 0 : et;
    Ev._revealNextTotal = wavePeriod > 0.001 ? wavePeriod : 17;
  }

  function updateSchedule(dt) {
    var st = NA.Game ? NA.Game.state : 'wave';
    if (st !== 'wave' && st !== 'boss') { Ev._revealNextTotal = 0; return; }
    if (devLock) return;
    var driven = wavesDrivesEvents();
    if (driven) {
      schedOn = false;
      /* The runner's timer only ticks inside NA.Waves.update(), which does not
       * run during a boss fight — so there is nothing to count down to and the
       * rim arc must not sit there frozen on a stale number. */
      if (st !== 'wave' || !NA.Waves.running) { Ev._revealNextTotal = 0; return; }
      armFromWaves(driven);
      return;
    }
    if (Ev._revealNextTotal) Ev._revealNextIn = Math.max(0, Ev._revealNextIn - dt);
    if (!schedOn) {
      // the first wave of a run starts before the event bus is joined
      var w = NA.Waves && NA.Waves.get ? NA.Waves.get(NA.Game ? NA.Game.wave : 1) : null;
      Ev.schedule((w && w.biome) || Ev.biome, (NA.Game ? NA.Game.wave : 1) || 1);
    }
    if (!schedQueue.length) return;
    schedT -= dt;
    if (schedT > 0) return;
    var id = schedQueue[schedI % schedQueue.length];
    schedI++;
    Ev.trigger(id);
    schedT = schedCad / Math.max(0.2, Ev.strobeMultiplier);
    schedT *= 0.82 + rnd() * 0.36;
    armCountdown();
  }

  /* ================================================ §10.4 OVERVIEW VISUALS
   * The framework already prints enemies in (NA.Enemies spawnT scanlines), so
   * this adds what it does not: the membrane spawn pulses and the contracting
   * ring of light per materializing body. Armed by NA.Game.on('stateChange'). */
  var OV_MAX = 48;
  var ovX = new Float32Array(OV_MAX), ovY = new Float32Array(OV_MAX), ovA = new Float32Array(OV_MAX);
  var ovN = 0, ovT = 0, ovDur = 1.6;

  Ev.overview = function (enemyList) {
    ovN = 0; ovT = ovDur;
    var i, ang;
    // rim spawn pulses: the wave's gates if the runner has them, else bearings
    // taken from the enemies that are about to print in
    var g = NA.Waves && NA.Waves.gates;
    if (g && g.length) {
      for (i = 0; i < g.length && ovN < OV_MAX; i++) {
        ang = g[i] + NA.Arena.rot;
        ovA[ovN] = ang;
        ovX[ovN] = NA.Arena.cx + Math.cos(ang) * NA.Arena.radiusAt(ang);
        ovY[ovN] = NA.Arena.cy + Math.sin(ang) * NA.Arena.radiusAt(ang);
        ovN++;
      }
    }
    if (enemyList && enemyList.length) {
      for (i = 0; i < enemyList.length && ovN < OV_MAX; i++) {
        var o = enemyList[i]; if (!o) continue;
        var ex = o.x !== undefined ? o.x : o[0], ey = o.y !== undefined ? o.y : o[1];
        ang = Math.atan2(ey - NA.Arena.cy, ex - NA.Arena.cx);
        ovA[ovN] = ang; ovX[ovN] = ex; ovY[ovN] = ey; ovN++;
      }
    }
    if (!ovN) {                                    // nothing scripted: use the rim
      for (i = 0; i < 3; i++) {
        ang = rnd() * M.TAU; ovA[ovN] = ang;
        ovX[ovN] = NA.Arena.cx + Math.cos(ang) * NA.Arena.radiusAt(ang);
        ovY[ovN] = NA.Arena.cy + Math.sin(ang) * NA.Arena.radiusAt(ang);
        ovN++;
      }
    }
    if (NA.Audio) NA.Audio.sfx('spawn');
    return ovN;
  };

  function updateOverview(dt) { if (ovT > 0) ovT -= dt; }

  function renderOverview() {
    var R = NA.R, L = R.L, acc = Ev.accent, i;
    if (ovT > 0) {
      var k = 1 - ovT / ovDur;
      for (i = 0; i < ovN; i++) {
        // a ring of light contracts to a point on the membrane
        var rad = 190 * (1 - M.easeOut(k));
        var a = (1 - k * k) * 0.85;
        R.ring(L.MEMBRANE, ovX[i], ovY[i], rad + 6, 2.5, acc[0], acc[1], acc[2], a);
        R.dot(L.MEMBRANE, ovX[i], ovY[i], 4 + (1 - k) * 5, acc[0], acc[1], acc[2], a);
        // three short tangent ticks so the gate reads as a door, not a dot
        for (var s = -1; s <= 1; s++) {
          var ta = ovA[i] + M.HALFPI + s * 0.09;
          var r0 = NA.Arena.radiusAt(ovA[i]);
          R.line(L.MEMBRANE,
            NA.Arena.cx + Math.cos(ovA[i]) * r0 + Math.cos(ta) * 8,
            NA.Arena.cy + Math.sin(ovA[i]) * r0 + Math.sin(ta) * 8,
            NA.Arena.cx + Math.cos(ovA[i]) * (r0 - 34) + Math.cos(ta) * 8,
            NA.Arena.cy + Math.sin(ovA[i]) * (r0 - 34) + Math.sin(ta) * 8,
            2, acc[0], acc[1], acc[2], a * 0.7);
        }
      }
    }
    // a contracting halo on every body that is still printing in
    var En = NA.Enemies;
    if (En && En.n) {
      var drawn = 0;
      for (i = 0; i < En.n && drawn < 60; i++) {
        if (En.spawnT[i] <= 0) continue;
        var d = En.types[En.type[i]];
        var kk = 1 - En.spawnT[i] / Math.max(0.001, d.spawnTime || 0.5);
        R.ring(L.MEMBRANE, En.x[i], En.y[i], En.size[i] * (1 + (1 - kk) * 5), 1.4,
          acc[0], acc[1], acc[2], (1 - kk) * 0.5);
        drawn++;
      }
    }
  }

  /* ?event=id / ?biome=id — dev helpers, same spirit as ?boss=id. */
  var devDone = false, devLock = false, evfitT = 0;
  function devParams() {
    var p = NA.params;
    if (devDone) {
      // keep the QA event alive across a restart
      if (p.event && defs[p.event] && !Ev.find(p.event)) Ev.trigger(p.event);
      return;
    }
    devDone = true;
    if (p.biome && BIOMES[p.biome]) { Ev.biome = Ev.biomeFrom = p.biome; Ev.biomeK = 1;
      if (NA.Audio && NA.Audio.music) NA.Audio.music.setMode(BIOMES[p.biome].mode);
      if (NA.Arena.shape !== BIOMES[p.biome].shape) NA.Arena.setShape(BIOMES[p.biome].shape); }
    if (p.event && defs[p.event]) { devLock = true; schedOn = false; schedQueue.length = 0; Ev.trigger(p.event); }
  }

  /* 16_game.js loads after this file, so the bus is joined on the first step. */
  var hooked = false;
  function ensureHooks() {
    if (hooked || !NA.Game || !NA.Game.on) return;
    hooked = true;
    NA.Game.on('stateChange', function (s) { if (s === 'overview') Ev.overview(null); });
    NA.Game.on('waveStart', function (n) {
      var w = NA.Waves && NA.Waves.get ? NA.Waves.get(n) : null;
      Ev.schedule((w && w.biome) || Ev.biome, n);
    });
  }

  /* #########################################################################
   * ###                        THE EIGHTEEN EVENTS                        ###
   * ######################################################################### */

  /* ================================================================ 1 SUPERNOVA
   * telegraph 3 s: the star swells, a rising hum, a rim countdown
   * active  0.35 s: a directional white flood from one edge, long shadows for
   *                 the 40 nearest enemies, invisibles become hard silhouettes
   * decay     4 s: afterglow, faint outlines, 0.5 s stun on the facing enemies */
  var shadowOrder = new Int32Array(40), shadowD = new Float32Array(40), shadowN = 0;

  function pickShadowCasters(sx, sy) {
    var En = NA.Enemies; shadowN = 0;
    if (!En || !En.n) return;
    for (var i = 0; i < En.n; i++) {
      var dx = En.x[i] - sx, dy = En.y[i] - sy, d2 = dx * dx + dy * dy;
      if (shadowN < 40) {
        shadowOrder[shadowN] = i; shadowD[shadowN] = d2; shadowN++;
      } else {
        // replace the current worst
        var worst = 0;
        for (var k = 1; k < 40; k++) if (shadowD[k] > shadowD[worst]) worst = k;
        if (d2 < shadowD[worst]) { shadowD[worst] = d2; shadowOrder[worst] = i; }
      }
    }
  }

  Ev.define('supernova', {
    layer: 'veil',
    telegraph: 3, active: 0.35, decay: 4,
    onStart: function (e) {
      e.data.sx = Math.cos(e.angle) * C.ARENA_R * 1.45;
      e.data.sy = Math.sin(e.angle) * C.ARENA_R * 1.45;
      e.data.hum = 0;
      sfx('supernovaCharge', e.data.sx, e.data.sy);
    },
    update: function (e, dt) {
      if (e.phase !== 'telegraph') return;
      // the hum rises: a second charge voice every 0.9 s, pitched up
      e.data.hum -= dt;
      if (e.data.hum <= 0) {
        e.data.hum = 0.9;
        if (NA.Audio) NA.Audio.sfx('charge', { x: e.data.sx, y: e.data.sy, pitch: 0.7 + e.k * 1.1, vol: 0.35 + e.k * 0.4 });
      }
    },
    onActive: function (e) {
      var fs = flashScale();
      NA.FX.flash(0.55 * fs, 240);
      NA.FX.chroma(3 * fs, 220);
      NA.FX.trauma(0.24);
      sfx('supernova');
      pickShadowCasters(e.data.sx, e.data.sy);
      beginStun(e.data.sx, e.data.sy, 0.5);
      // 10.2 reserves white membrane ripples for PLAYER contact
      NA.Arena.ripple(Math.cos(e.angle) * NA.Arena.radius, Math.sin(e.angle) * NA.Arena.radius,
        1.2, 1, 0.541, 0);
    },
    reveal: function (e, x, y) {
      if (e.phase === 'active') return 1;
      if (e.phase === 'decay') return 0.45 * (1 - e.k);
      if (e.phase === 'telegraph' && e.k > 0.92) return 0.14;
      return 0;
    },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena;
      var sx = e.data.sx, sy = e.data.sy, i;
      if (e.phase === 'telegraph') {
        var k = e.k, ke = M.easeIn ? M.easeIn(k) : k * k;
        R.disc(L.BACKDROP, sx, sy, 90 + ke * 420, 1, 0.92, 0.78, 0.10 + ke * 0.30);
        R.disc(L.VEIL, sx, sy, 40 + ke * 120, 1, 0.97, 0.9, 0.20 + ke * 0.45);
        R.dot(L.VEIL, sx, sy, 12 + ke * 30, 1, 1, 1, 0.55 + 0.45 * k);
        // four lens spikes that lengthen as it swells
        var sp = (30 + ke * 260);
        for (i = 0; i < 4; i++) {
          var a = e.angle + i * M.HALFPI + 0.4;
          R.line(L.VEIL, sx - Math.cos(a) * sp, sy - Math.sin(a) * sp,
            sx + Math.cos(a) * sp, sy + Math.sin(a) * sp, 2.5, 1, 0.95, 0.8, 0.25 + 0.4 * k);
        }
        // the rim countdown arc, centred on the star's bearing
        var a0 = e.angle - 0.75, a1 = a0 + 1.5 * k;
        var col = NA.Enemies.telegraphColor ? NA.Enemies.telegraphColor(k, 0.85) : null;
        var cr = col ? col[0] : 1, cg = col ? col[1] : 0.6, cb = col ? col[2] : 0.2;
        R.arc(L.VEIL, A.cx, A.cy, A.radius + 26, a0, a1, 6, cr, cg, cb,
          0.5 + 0.35 * Math.abs(Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ)));
      } else if (e.phase === 'active') {
        var f = 1 - e.k, fs = flashScale();
        // a DIRECTIONAL flood: brightest at the star's edge, falling off across
        var ux = Math.cos(e.angle), uy = Math.sin(e.angle);
        for (i = 0; i < 7; i++) {
          var q = i / 6;                              // 0 at the star, 1 far side
          var dd = C.ARENA_R * (1.30 - q * 2.5);
          R.disc(L.VEIL, ux * dd, uy * dd, C.ARENA_R * 0.62,
            1, 1, 0.99 - q * 0.06, (0.60 - q * 0.34) * f * fs);
        }
        R.dot(L.VEIL, sx, sy, 140, 1, 1, 1, f);
        // long shadows: one streak per nearby enemy, away from the star
        var En = NA.Enemies;
        for (i = 0; i < shadowN; i++) {
          var ei = shadowOrder[i]; if (ei >= En.n) continue;
          var dx = En.x[ei] - sx, dy = En.y[ei] - sy;
          var l = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= l; dy /= l;
          var len = 620 + En.size[ei] * 14;
          R.line(L.EBULLETS, En.x[ei] + dx * En.size[ei], En.y[ei] + dy * En.size[ei],
            En.x[ei] + dx * len, En.y[ei] + dy * len,
            En.size[ei] * 2.0, 0.015, 0.015, 0.04, 0.8 * f);
        }
      } else {
        var g = 1 - e.k;
        R.disc(L.BACKDROP, sx * 0.7, sy * 0.7, C.ARENA_R * 1.6, 1, 0.94, 0.82, 0.16 * g);
        R.disc(L.VEIL, sx, sy, 180 * g + 40, 1, 0.95, 0.85, 0.14 * g);
        R.dot(L.VEIL, sx, sy, 10 + 30 * g, 1, 1, 0.95, 0.5 * g);
      }
    }
  });

  /* ============================================================ 2 PULSAR SWEEP
   * Two opposed lighthouse wedges completing a turn every 6 s. Inside a wedge:
   * invisibles are visible, Sentinel domes drop, player bullets do 1.5x. */
  var WEDGE = 0.30;                    // half-width in radians

  function inWedge(e, x, y) {
    var dx = x - NA.Arena.cx, dy = y - NA.Arena.cy;
    var a = Math.atan2(dy, dx);
    var d = Math.abs(M.norm(a - e.data.rot));
    if (d > M.HALFPI) d = Math.PI - d;              // the opposed wedge
    if (d > WEDGE) return 0;
    return 1 - (d / WEDGE) * 0.35;                  // softer at the edges
  }

  Ev.define('pulsarSweep', {
    layer: 'veil',
    telegraph: 1.2, active: 24, decay: 1.4,
    onStart: function (e) { e.data.rot = e.angle; e.data.tick = 0; },
    update: function (e, dt) {
      e.data.rot += (M.TAU / 6) * dt;
      if (e.phase !== 'active') return;
      Ev.domesDown = true;
      e.data.tick -= dt;
      if (e.data.tick <= 0) { e.data.tick = 1.5; sfx('telegraph'); }
    },
    reveal: function (e, x, y) { return e.phase === 'active' ? inWedge(e, x, y) : 0; },
    damageMul: function (e, x, y) { return e.phase === 'active' && inWedge(e, x, y) > 0 ? 1.5 : 1; },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      // a lighthouse is cold light, never the biome accent: orange is reserved
      // for telegraphs, and this beam is a gift, not a threat
      var BR = 0.55, BG = 0.86, BB = 1.0;
      var reach = A.radius * 1.35, BANDS = 10;
      for (var s = 0; s < 2; s++) {
        var base = e.data.rot + s * Math.PI;
        // the wedge body: concentric arc bands, so it stays a solid cone at
        // every distance instead of splitting into rays
        for (var i = 0; i < BANDS; i++) {
          var r0 = reach * (i / BANDS), r1 = reach * ((i + 1) / BANDS);
          var rm = (r0 + r1) * 0.5, w = (r1 - r0) * 2.4;
          var fall = 1 - i / (BANDS + 2);
          R.arc(L.FLOOR, A.cx, A.cy, rm, base - WEDGE, base + WEDGE, w,
            BR, BG, BB, 0.045 * fall * amp);
          R.arc(L.FLOOR, A.cx, A.cy, rm, base - WEDGE * 0.45, base + WEDGE * 0.45, w,
            BR, BG, BB, 0.040 * fall * amp);
        }
        // the two crisp edges make the boundary of the buff unambiguous
        for (var g = -1; g <= 1; g += 2) {
          var ae = base + g * WEDGE;
          R.line(L.VEIL, A.cx, A.cy, A.cx + Math.cos(ae) * reach, A.cy + Math.sin(ae) * reach,
            1.8, BR, BG, BB, 0.22 * amp);
        }
        R.line(L.VEIL, A.cx, A.cy, A.cx + Math.cos(base) * reach, A.cy + Math.sin(base) * reach,
          3, 0.85, 0.97, 1, 0.26 * amp);
        // the lamp at the rim
        var lx = A.cx + Math.cos(base) * (A.radiusAt(base) + 18);
        var ly = A.cy + Math.sin(base) * (A.radiusAt(base) + 18);
        R.dot(L.VEIL, lx, ly, 10, 0.85, 0.98, 1, 0.8 * amp);
        R.light(lx, ly, 460, 0.4 * amp);
      }
    }
  });

  /* ============================================================== 3 COMET PASS
   * A huge comet crosses behind the arena; its tail lights everything
   * blue-white for 5 s. Full reveal while it is overhead. */
  Ev.define('cometPass', {
    layer: 'backdrop',
    telegraph: 1.6, active: 5, decay: 1.6,
    onStart: function (e) {
      var a = e.angle;
      e.data.dx = Math.cos(a); e.data.dy = Math.sin(a);
      e.data.px = -e.data.dx * C.ARENA_R * 2.4 - e.data.dy * rr(-500, 500);
      e.data.py = -e.data.dy * C.ARENA_R * 2.4 + e.data.dx * rr(-500, 500);
      e.data.spd = C.ARENA_R * 4.8 / (5 + 1.6);
      e.data.t = 0;
      sfx('charge');
    },
    update: function (e, dt) {
      if (e.phase === 'telegraph') return;
      e.data.px += e.data.dx * e.data.spd * dt;
      e.data.py += e.data.dy * e.data.spd * dt;
      e.data.t += dt;
      if (e.phase === 'active' && (e.data.t % 1.2) < dt) sfx('wall', e.data.px, e.data.py);
    },
    reveal: function (e, x, y) { return e.phase === 'active' ? 1 : (e.phase === 'decay' ? 0.5 * (1 - e.k) : 0); },
    render: function (e) {
      var R = NA.R, L = R.L;
      var amp = e.phase === 'telegraph' ? e.k * 0.4 : (e.phase === 'decay' ? 1 - e.k : 1);
      var px = e.data.px, py = e.data.py, dx = e.data.dx, dy = e.data.dy;
      // the tail: eight tapering strokes behind the head
      for (var i = 0; i < 8; i++) {
        var f = i / 8;
        var l0 = 120 + f * 1500, l1 = l0 + 340;
        R.line(L.BACKDROP, px - dx * l0 - dy * f * 40, py - dy * l0 + dx * f * 40,
          px - dx * l1 - dy * f * 60, py - dy * l1 + dx * f * 60,
          150 - f * 110, 0.55, 0.82, 1, 0.10 * (1 - f) * amp);
      }
      R.disc(L.BACKDROP, px, py, 320, 0.6, 0.85, 1, 0.22 * amp);
      R.disc(L.VEIL, px, py, 90, 0.85, 0.95, 1, 0.30 * amp);
      R.dot(L.VEIL, px, py, 22, 0.85, 0.95, 1, 0.8 * amp);   // blue-white, not white
      // the arena is washed blue-white while it passes
      R.disc(L.FLOOR, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius * 1.1,
        0.35, 0.62, 0.95, 0.10 * amp);
      R.light(px, py, 1400, 0.5 * amp);
    }
  });

  /* ================================================================ 4 ECLIPSE
   * A black disc slides across a bright backdrop sun. During totality domes
   * drop, invisibles glow and mana regen doubles. */
  Ev.define('eclipse', {
    layer: 'backdrop',
    telegraph: 3, active: 6, decay: 3,
    onStart: function (e) {
      e.data.sx = Math.cos(e.angle) * C.ARENA_R * 1.5;
      e.data.sy = Math.sin(e.angle) * C.ARENA_R * 1.5;
      e.data.mx = Math.cos(e.angle + M.HALFPI);
      e.data.my = Math.sin(e.angle + M.HALFPI);
      e.data.p = -1;
      sfx('charge', e.data.sx, e.data.sy);
    },
    update: function (e, dt) {
      var span = 3 + 6 + 3;
      e.data.p = (e.life / span) * 2 - 1;
      if (e.phase === 'active') {
        Ev.domesDown = true;
        Ev.manaMul = 2;
        // pay the second half of the doubled regen here, so no foundation file
        // has to learn about events: NA.Player's own trickle is the first half
        if (NA.Player.alive) NA.Player.addMana(NA.Player.stats.manaTrickle * dt, 'event');
        if (e.t < dt) { sfx('bossPhase'); NA.FX.desat(0.35, 900); }
      }
    },
    reveal: function (e, x, y) {
      if (e.phase === 'active') return 0.85;
      if (e.phase !== 'telegraph') return 0.3 * (1 - e.k);
      return 0.2 * e.k;
    },
    render: function (e) {
      var R = NA.R, L = R.L;
      var sx = e.data.sx, sy = e.data.sy, RS = 300;
      // the sun
      R.disc(L.BACKDROP, sx, sy, RS * 2.4, 1, 0.9, 0.72, 0.16);
      R.disc(L.BACKDROP, sx, sy, RS, 1, 0.95, 0.85, 0.55);
      // the moon, sliding across
      var off = e.data.p * RS * 2.3;
      var mx = sx + e.data.mx * off, my = sy + e.data.my * off;
      R.disc(L.BACKDROP, mx, my, RS * 1.02, 0.02, 0.02, 0.035, 1);
      R.ring(L.BACKDROP, mx, my, RS * 1.04, 4, 1, 0.92, 0.8, 0.5);
      if (e.phase === 'active') {
        // the corona and the diamond ring
        var f = Math.sin(e.k * Math.PI);
        R.softRing(L.VEIL, mx, my, RS * (1.25 + 0.12 * f), 1, 0.93, 0.8, 0.28);
        for (var i = 0; i < 10; i++) {
          var a = e.seed * 6.28 + i / 10 * M.TAU;
          R.line(L.BACKDROP, mx + Math.cos(a) * RS, my + Math.sin(a) * RS,
            mx + Math.cos(a) * RS * (1.4 + 0.35 * Math.sin(i * 2.1 + NA.Time.t)),
            my + Math.sin(a) * RS * (1.4 + 0.35 * Math.sin(i * 2.1 + NA.Time.t)),
            22, 1, 0.93, 0.78, 0.16);
        }
        // mana doubling reads as a cyan breath on the rim
        R.ring(L.MEMBRANE, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius - 6, 3,
          0.30, 0.95, 1, 0.14 + 0.10 * Math.sin(NA.Time.t * 3));
      }
    }
  });

  /* ====================================================== 5 NEBULA LIGHTNING
   * Two cloud lobes brighten, a dotted line charges for 1.5 s, then a branching
   * bolt of 6-10 segments slams across. Capsule collision damages EVERYTHING,
   * enemies included; lightning kills pay double mana. */
  var boltX = new Float32Array(12), boltY = new Float32Array(12), boltN = 0;

  function buildBolt(x0, y0, x1, y1) {
    boltN = 6 + (rnd() * 5) | 0;
    if (boltN > 11) boltN = 11;
    var dx = x1 - x0, dy = y1 - y0;
    var nx = -dy, ny = dx;
    var l = Math.sqrt(nx * nx + ny * ny) || 1; nx /= l; ny /= l;
    for (var i = 0; i <= boltN; i++) {
      var t = i / boltN;
      var j = (i === 0 || i === boltN) ? 0 : (rnd() - 0.5) * 220;
      boltX[i] = x0 + dx * t + nx * j;
      boltY[i] = y0 + dy * t + ny * j;
    }
  }

  function segHit(ax, ay, bx, by, px, py, rad) {
    var vx = bx - ax, vy = by - ay;
    var wx = px - ax, wy = py - ay;
    var vv = vx * vx + vy * vy;
    var t = vv > 0 ? M.clamp01((wx * vx + wy * vy) / vv) : 0;
    var cx = ax + vx * t - px, cy = ay + vy * t - py;
    return (cx * cx + cy * cy) <= rad * rad;
  }

  Ev.define('nebulaLightning', {
    layer: 'veil',
    telegraph: 1.5, active: 0.3, decay: 1.2,
    onStart: function (e) {
      var a = e.angle, r = NA.Arena.radius * 1.05;
      e.data.x0 = Math.cos(a) * r; e.data.y0 = Math.sin(a) * r;
      e.data.x1 = Math.cos(a + Math.PI + rr(-0.5, 0.5)) * r;
      e.data.y1 = Math.sin(a + Math.PI + rr(-0.5, 0.5)) * r;
      buildBolt(e.data.x0, e.data.y0, e.data.x1, e.data.y1);
      sfx('telegraph');
    },
    onActive: function (e) {
      buildBolt(e.data.x0, e.data.y0, e.data.x1, e.data.y1);
      sfx('lightning');
      NA.FX.flash(0.3 * flashScale(), 160);
      NA.FX.trauma(0.3);
      var i;
      for (i = 0; i < boltN; i++) {
        NA.Particles.bolt(boltX[i], boltY[i], boltX[i + 1], boltY[i + 1], 0.32, 26,
          0.75, 0.85, 1, 3);
      }
      // capsule damage along every segment: everything, enemies included
      var En = NA.Enemies, RAD = 34;
      for (i = 0; i < boltN; i++) {
        var ax = boltX[i], ay = boltY[i], bx = boltX[i + 1], by = boltY[i + 1];
        var steps = 5;
        for (var s = 0; s <= steps; s++) {
          var t = s / steps;
          var sxp = ax + (bx - ax) * t, syp = ay + (by - ay) * t;
          if (En && En.n) {
            // out3: En.damage below can run an onDeath that queries this same
            // grid (splitter children, volatile chains) while we iterate
            var cnt = En.grid.query(sxp, syp, RAD + 60, En.grid.out3), out = En.grid.out3;
            for (var q = 0; q < cnt; q++) {
              var ei = out[q];
              if (ei >= En.n || En.intangible[ei] > 0) continue;
              if (!segHit(ax, ay, bx, by, En.x[ei], En.y[ei], RAD + En.size[ei])) continue;
              var killed = En.damage(ei, 26, 'enemy');
              if (killed) {
                NA.Player.addMana(C.MANA_KILL * 2, 'kill');       // double mana
                NA.Particles.burst(En.x[ei], En.y[ei], 4, 200, 0.25, 0.8, 0.9, 1, 1);
              }
            }
          }
        }
        if (live() && segHit(ax, ay, bx, by, NA.Player.x, NA.Player.y, RAD + C.SHIP_R)) {
          NA.Player.damage(1, (ax + bx) * 0.5, (ay + by) * 0.5);
        }
        // and enemy projectiles are blown apart by it
        if (NA.Bullets) NA.Bullets.clearArea((ax + bx) * 0.5, (ay + by) * 0.5, RAD + 20, false);
      }
    },
    render: function (e) {
      var R = NA.R, L = R.L, i;
      // the two cloud lobes brighten at both anchors
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'active' ? 1 : 1 - e.k);
      R.disc(L.BACKDROP, e.data.x0 * 1.25, e.data.y0 * 1.25, 700, 0.50, 0.40, 1, 0.30 * amp);
      R.disc(L.BACKDROP, e.data.x1 * 1.25, e.data.y1 * 1.25, 700, 0.32, 0.72, 0.58, 0.26 * amp);
      if (e.phase === 'telegraph') {
        // the dotted charge line: orange -> red at lock, per the convention
        var col = NA.Enemies.telegraphColor ? NA.Enemies.telegraphColor(e.k, 0.75) : null;
        var cr = col ? col[0] : 1, cg = col ? col[1] : 0.55, cb = col ? col[2] : 0.1;
        var pulse = NA.Enemies.telegraphPulse ? NA.Enemies.telegraphPulse(e.k, 0.75) : 1;
        for (i = 0; i < boltN; i++) {
          var ax = boltX[i], ay = boltY[i], bx = boltX[i + 1], by = boltY[i + 1];
          for (var s = 0; s < 5; s++) {
            var t0 = (s + 0.15) / 5, t1 = (s + 0.6) / 5;
            R.line(L.VEIL, ax + (bx - ax) * t0, ay + (by - ay) * t0,
              ax + (bx - ax) * t1, ay + (by - ay) * t1, 3, cr, cg, cb, 0.55 * pulse * e.k);
          }
        }
      } else if (e.phase === 'active') {
        var f = 1 - e.k;
        for (i = 0; i < boltN; i++) {
          R.line(L.VEIL, boltX[i], boltY[i], boltX[i + 1], boltY[i + 1], 46, 0.35, 0.55, 1, 0.22 * f);
          R.line(L.VEIL, boltX[i], boltY[i], boltX[i + 1], boltY[i + 1], 16, 0.65, 0.82, 1, 0.55 * f);
          R.line(L.VEIL, boltX[i], boltY[i], boltX[i + 1], boltY[i + 1], 5, 1, 1, 1, f);
          R.dot(L.VEIL, boltX[i], boltY[i], 16, 1, 1, 1, 0.8 * f);
          R.light(boltX[i], boltY[i], 380, 0.6 * f);
        }
      } else {
        var g = (1 - e.k) * 0.35;
        for (i = 0; i < boltN; i++)
          R.line(L.VEIL, boltX[i], boltY[i], boltX[i + 1], boltY[i + 1], 6, 0.6, 0.7, 1, g);
      }
    }
  });

  /* =============================================================== 6 PHASE FOG
   * Desaturated fog rolls over half the arena. Enemies inside show only their
   * accent eye (their reveal drops); the player's bullets cut clear tunnels.
   * Tunnels are stamps in a ring buffer, capped at 30 new stamps per frame. */
  var STAMP_MAX = 220;
  var stX2 = new Float32Array(STAMP_MAX), stY2 = new Float32Array(STAMP_MAX),
    stR2 = new Float32Array(STAMP_MAX), stL2 = new Float32Array(STAMP_MAX);
  var stampN = 0, stampHead = 0;

  function addStamp(x, y, r, life) {
    var i = stampHead;
    stX2[i] = x; stY2[i] = y; stR2[i] = r; stL2[i] = life;
    stampHead = (stampHead + 1) % STAMP_MAX;
    if (stampN < STAMP_MAX) stampN++;
  }
  function stampCover(x, y) {
    var best = 0;
    for (var i = 0; i < stampN; i++) {
      if (stL2[i] <= 0) continue;
      var dx = x - stX2[i], dy = y - stY2[i], r = stR2[i];
      var d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      var v = (1 - Math.sqrt(d2) / r) * M.clamp01(stL2[i] * 2);
      if (v > best) best = v;
    }
    return best;
  }
  function decayStamps(dt) {
    for (var i = 0; i < stampN; i++) if (stL2[i] > 0) stL2[i] -= dt;
  }

  var FOG_COLS = 10, FOG_ROWS = 7;

  function fogCover(e, x, y) {
    if (e.phase === 'telegraph') return 0;
    var amp = e.phase === 'decay' ? 1 - e.k : 1;
    // a half-plane with a soft, drifting front
    var nx = Math.cos(e.angle), ny = Math.sin(e.angle);
    var d = (x - NA.Arena.cx) * nx + (y - NA.Arena.cy) * ny;
    var front = e.data.front;
    var k = M.clamp01((front - d) / 260);
    return k * amp;
  }

  Ev.define('phaseFog', {
    layer: 'veil',
    telegraph: 1.4, active: 13, decay: 2.2,
    onStart: function (e) {
      e.data.front = -NA.Arena.radius * 1.4;
      stampN = 0; stampHead = 0;
      sfx('charge');
    },
    update: function (e, dt) {
      var target = e.phase === 'decay' ? -NA.Arena.radius * 1.4 : NA.Arena.radius * 0.15;
      e.data.front = M.smooth(e.data.front, target, 0.8, dt);
      decayStamps(dt);
      if (e.phase !== 'active') return;
      // player bullets cut clear tunnels: at most 30 new stamps a frame
      var B = NA.Bullets, P = B.P, made = 0;
      for (var i = 0; i < P.n && made < 30; i++) {
        if (fogCover(e, P.x[i], P.y[i]) < 0.15) continue;
        addStamp(P.x[i], P.y[i], 60 + P.size[i] * 3, 0.5);
        made++;
      }
    },
    /* Inside the fog only the accent eye shows. reveal() is a MAX across
     * events, so returning 0 concealed nothing; conceal() is the field that
     * actually subtracts, and it beats a sweep happening at the same time. */
    conceal: function (e, x, y) { return fogCover(e, x, y) * 0.95; },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena;
      var acc = Ev.accent;
      var amp = e.phase === 'telegraph' ? e.k * 0.35 : (e.phase === 'decay' ? 1 - e.k : 1);
      // a coarse grid over the arena disc; every cell asks fogCover() how thick
      // the fog is there, so the roll-in, the front and the bullet tunnels all
      // come out of one function. 70 soft lobes, never more.
      var step = (A.radius * 2.1) / FOG_COLS;
      for (var cx2 = 0; cx2 < FOG_COLS; cx2++) {
        for (var ry = 0; ry < FOG_ROWS; ry++) {
          var px = A.cx + (cx2 + 0.5 - FOG_COLS * 0.5) * step;
          var py = A.cy + (ry + 0.5 - FOG_ROWS * 0.5) * step;
          px += Math.sin(NA.Time.t * 0.23 + ry * 1.7) * step * 0.22;
          py += Math.cos(NA.Time.t * 0.19 + cx2 * 1.3) * step * 0.22;
          if (M.dist2(px, py, A.cx, A.cy) > (A.radius + step) * (A.radius + step)) continue;
          var cov = fogCover(e, px, py);
          if (cov <= 0.02) continue;
          var a = 0.15 * cov * amp * (1 - stampCover(px, py));
          if (a <= 0.004) continue;
          /* EBULLETS, not VEIL: VEIL is additive and sits above the enemies,
           * so fog drawn there BRIGHTENED what it is supposed to swallow. This
           * layer is non-additive and below L.ENEMIES, so the fog is a dim
           * grey sheet the enemies sink into. */
          R.sprite(L.EBULLETS, 'evLobe', px, py,
            NA.Time.t * 0.05 + cx2 * 1.7 + ry, step * 1.05, step * 1.05,
            0.24 + acc[0] * 0.10, 0.26 + acc[1] * 0.10, 0.36 + acc[2] * 0.10, a * 2.6);
        }
      }
      // the eyes: an accent pip on every enemy the fog is eating
      var En = NA.Enemies, drawn = 0;
      for (var i = 0; i < En.n && drawn < 120; i++) {
        var cov = fogCover(e, En.x[i], En.y[i]);
        if (cov < 0.25) continue;
        var d2 = En.types[En.type[i]];
        var col = d2.color;
        R.dot(L.VEIL, En.x[i], En.y[i], 3.4 + En.size[i] * 0.10,
          col[0], col[1], col[2], 0.55 + 0.35 * Math.sin(NA.Time.t * 4 + En.seed[i] * 9));
        drawn++;
      }
      // The tunnel is the ABSENCE of fog: 220 overlapping rim rings read as a
      // bright tube, which is exactly backwards, so the cut is left to speak
      // for itself and only its leading edge is hinted.
      for (var s = 0; s < stampN; s++) {
        if (stL2[s] <= 0.34) continue;
        R.disc(L.EBULLETS, stX2[s], stY2[s], stR2[s] * 0.5, 0.10, 0.12, 0.16,
          0.05 * (stL2[s] - 0.34) * amp);
      }
    }
  });

  /* ============================================================ 7 AURORA LANES
   * Three to five drifting sine ribbons. Everything inside a lane moves 40%
   * faster: highways for dashing, death traps for standing. */
  var LANE_MAX = 5, LANE_SEG = 30;
  var laneA = new Float32Array(LANE_MAX), laneOff = new Float32Array(LANE_MAX),
    laneAmp = new Float32Array(LANE_MAX), laneFrq = new Float32Array(LANE_MAX),
    lanePh = new Float32Array(LANE_MAX);

  function laneCover(e, x, y) {
    if (e.phase === 'telegraph') return 0;
    var amp = e.phase === 'decay' ? 1 - e.k : 1;
    var best = 0, W = 90;
    for (var i = 0; i < e.n; i++) {
      var ca = Math.cos(laneA[i]), sa = Math.sin(laneA[i]);
      var u = x * ca + y * sa;                    // along the lane
      var v = -x * sa + y * ca;                   // across it
      var mid = laneOff[i] + laneAmp[i] * Math.sin(u * laneFrq[i] + lanePh[i]);
      var d = Math.abs(v - mid);
      if (d > W) continue;
      var k = 1 - d / W;
      if (k > best) best = k;
    }
    return best * amp;
  }

  Ev.define('auroraLanes', {
    layer: 'backdrop',
    telegraph: 1.2, active: 16, decay: 2.5,
    onStart: function (e) {
      e.n = 3 + ((rnd() * 3) | 0);
      for (var i = 0; i < e.n; i++) {
        laneA[i] = e.angle + rr(-0.5, 0.5) + i * 0.18;
        laneOff[i] = rr(-1, 1) * NA.Arena.radius * 0.7;
        laneAmp[i] = rr(90, 220);
        laneFrq[i] = rr(0.0016, 0.0034);
        lanePh[i] = rnd() * M.TAU;
      }
      sfx('gate');
    },
    update: function (e, dt) {
      for (var i = 0; i < e.n; i++) lanePh[i] += dt * (0.25 + i * 0.05);
    },
    speedMul: function (e, x, y) { return 1 + 0.4 * laneCover(e, x, y); },
    render: function (e) {
      var R = NA.R, L = R.L;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      var reach = NA.Arena.radius * 1.5;
      for (var i = 0; i < e.n; i++) {
        var ca = Math.cos(laneA[i]), sa = Math.sin(laneA[i]);
        var pux = 0, puy = 0, first = 1;
        for (var s = 0; s <= LANE_SEG; s++) {
          var u = (s / LANE_SEG - 0.5) * reach * 2;
          var v = laneOff[i] + laneAmp[i] * Math.sin(u * laneFrq[i] + lanePh[i]);
          var x = u * ca - v * sa, y = u * sa + v * ca;
          if (!first) {
            var glow = 0.5 + 0.5 * Math.sin(s * 0.7 + NA.Time.t * 2 + i);
            R.line(L.FLOOR, pux, puy, x, y, 120, 0.10, 0.80, 0.60, 0.030 * amp * glow);
            R.line(L.FLOOR, pux, puy, x, y, 58, 0.30, 1.0, 0.76, 0.055 * amp * glow);
            R.line(L.FLOOR, pux, puy, x, y, 6, 0.55, 1.0, 0.84, 0.10 * amp * glow);
          }
          pux = x; puy = y; first = 0;
        }
      }
    }
  });

  /* ============================================================= 8 STAR SHADOW
   * A dead ship drifts across the backdrop casting a hard shadow band. Inside
   * it enemies cannot aim at you; neither can you see invisibles. */
  Ev.define('starShadow', {
    layer: 'backdrop',
    telegraph: 1.5, active: 13, decay: 2,
    onStart: function (e) {
      e.data.p = -1.2;
      e.data.w = rr(240, 380);
      sfx('charge');
    },
    update: function (e, dt) {
      e.data.p += dt * 0.11;
    },
    hidden: function (e, x, y) {
      if (e.phase === 'telegraph') return 0;
      var amp = e.phase === 'decay' ? 1 - e.k : 1;
      var nx = Math.cos(e.angle + M.HALFPI), ny = Math.sin(e.angle + M.HALFPI);
      var d = (x - NA.Arena.cx) * nx + (y - NA.Arena.cy) * ny - e.data.p * NA.Arena.radius;
      var k = 1 - M.clamp01(Math.abs(d) / e.data.w);
      return k * amp;
    },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      var nx = Math.cos(e.angle + M.HALFPI), ny = Math.sin(e.angle + M.HALFPI);
      var tx = -ny, ty = nx;
      var mid = e.data.p * A.radius;
      var w = e.data.w;
      // the shadow band: dark, hard-edged, on the floor
      for (var s = -3; s <= 3; s++) {
        var d = mid + s * (w / 3.2);
        var fall = 1 - Math.abs(s) / 4.2;
        R.line(L.EBULLETS,
          A.cx + nx * d - tx * A.radius * 1.4, A.cy + ny * d - ty * A.radius * 1.4,
          A.cx + nx * d + tx * A.radius * 1.4, A.cy + ny * d + ty * A.radius * 1.4,
          w / 2.6, 0.02, 0.02, 0.05, 0.30 * fall * amp);
      }
      // the dead ship itself, drifting in the far layer
      var hx = A.cx + nx * mid + tx * (e.data.p * 900);
      var hy = A.cy + ny * mid + ty * (e.data.p * 900);
      var rot = e.angle + NA.Time.t * 0.07;
      R.poly(L.BACKDROP, hx, hy, 120, 3, rot, 3, 0.35, 0.36, 0.44, 0.55 * amp);
      R.poly(L.BACKDROP, hx, hy, 74, 3, rot + 0.4, 2, 0.28, 0.29, 0.36, 0.4 * amp);
      R.line(L.BACKDROP, hx, hy, hx + Math.cos(rot) * 210, hy + Math.sin(rot) * 210,
        4, 0.30, 0.31, 0.4, 0.35 * amp);
      // the band edges get a cold rim so it reads as geometry, not a bug
      for (var q = -1; q <= 1; q += 2) {
        var dd = mid + q * w;
        R.line(L.MEMBRANE,
          A.cx + nx * dd - tx * A.radius * 1.3, A.cy + ny * dd - ty * A.radius * 1.3,
          A.cx + nx * dd + tx * A.radius * 1.3, A.cy + ny * dd + ty * A.radius * 1.3,
          2, 0.28, 0.34, 0.55, 0.22 * amp);
      }
    }
  });

  /* ========================================================= 9 GRAVITY RIPPLE
   * A dimple appears, then concentric rings expand and the stars bend.
   * Projectiles of both sides curve toward the ring front; enemies are shoved
   * outward. */
  Ev.define('gravityRipple', {
    layer: 'backdrop',
    telegraph: 1.6, active: 9, decay: 1.6,
    onStart: function (e) {
      var r = rr(0, NA.Arena.radius * 0.45);
      e.x = Math.cos(e.angle) * r; e.y = Math.sin(e.angle) * r;
      e.data.front = 0; e.data.tick = 0;
      sfx('charge', e.x, e.y);
    },
    update: function (e, dt) {
      if (e.phase === 'telegraph') return;
      e.data.front += 420 * dt;
      if (e.data.front > NA.Arena.radius * 1.5) e.data.front = 0;
      e.data.tick -= dt;
      if (e.data.tick <= 0 && e.phase === 'active') { e.data.tick = 1.2; sfx('wall', e.x, e.y); }
    },
    force: function (e, x, y, out) {
      if (e.phase === 'telegraph') return;
      var amp = e.phase === 'decay' ? 1 - e.k : 1;
      var dx = e.x - x, dy = e.y - y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      /* 10.3: the ring SHOVES everything outward as it passes. dx/dy point at
       * the dimple, so the outward normal is -(dx,dy)/d. */
      var band = d - e.data.front;
      var g = Math.exp(-(band * band) / 42000) * 900 * amp;
      out.x -= (dx / d) * g;
      out.y -= (dy / d) * g;
    },
    render: function (e) {
      var R = NA.R, L = R.L;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      var acc = Ev.accent;
      // the dimple
      R.disc(L.BACKDROP, e.x, e.y, 220 * amp, 0.02, 0.02, 0.06, 0.55 * amp);
      R.softRing(L.BACKDROP, e.x, e.y, 240 * amp, acc[0], acc[1], acc[2], 0.10 * amp);
      for (var i = 0; i < 4; i++) {
        var r = e.data.front - i * 220;
        if (r <= 8) continue;
        var f = 1 - i / 4;
        R.ring(L.FLOOR, e.x, e.y, r, 4 + f * 3, acc[0], acc[1], acc[2], 0.22 * f * amp);
        R.ring(L.FLOOR, e.x, e.y, r * 0.985, 1.5, 0.85, 0.9, 1, 0.14 * f * amp);
      }
      // stars bend: a short radial smear ring around the dimple
      for (var s = 0; s < 12; s++) {
        var a = s / 12 * M.TAU + NA.Time.t * 0.1;
        var r0 = 250, r1 = 250 + 90 * Math.sin(NA.Time.t + s);
        R.line(L.BACKDROP, e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0,
          e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1, 3, 0.7, 0.72, 0.9, 0.14 * amp);
      }
    }
  });

  /* ======================================================= 10 BLACK HOLE BLOOM
   * A slow vortex with an Einstein ring. It vacuums enemy bullets. */
  Ev.define('blackHoleBloom', {
    layer: 'backdrop',
    telegraph: 2, active: 10, decay: 2,
    onStart: function (e) {
      var r = rr(0, NA.Arena.radius * 0.4);
      e.x = Math.cos(e.angle) * r; e.y = Math.sin(e.angle) * r;
      e.data.eaten = 0;
      sfx('charge', e.x, e.y);
    },
    update: function (e, dt) {
      if (e.phase === 'telegraph') return;
      var amp = e.phase === 'decay' ? 1 - e.k : 1;
      var B = NA.Bullets, E = B.E, R2 = 520 * amp;
      for (var i = 0; i < E.n; i++) {
        var dx = e.x - E.x[i], dy = e.y - E.y[i];
        var d2 = dx * dx + dy * dy;
        if (d2 > R2 * R2) continue;
        var d = Math.sqrt(d2) || 1;
        // swirl in: radial pull plus a tangential component
        var pull = 190000 * amp / Math.max(90, d);      // px/s^2, softened near the core
        var ux = dx / d, uy = dy / d;
        E.vx[i] += (ux * pull - uy * pull * 0.55) * dt;
        E.vy[i] += (uy * pull + ux * pull * 0.55) * dt;
        if (d < 48) {
          B.killE(i, true); i--;
          e.data.eaten++;
          NA.Particles.spawn(e.x, e.y, rr(-40, 40), rr(-40, 40), 0.25, 3, 0.7, 0.5, 1, 0.8, 0, 3);
          if ((e.data.eaten & 7) === 0) sfx('uiTick', e.x, e.y);
        }
      }
    },
    render: function (e) {
      var R = NA.R, L = R.L;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      var t = NA.Time.t;
      R.disc(L.BACKDROP, e.x, e.y, 420 * amp, 0.01, 0.01, 0.03, 0.85 * amp);
      // the accretion swirl: six leading arcs
      for (var i = 0; i < 6; i++) {
        var a0 = t * (0.6 + i * 0.13) + i * 1.05;
        var rr2 = 110 + i * 52;
        R.arc(L.FLOOR, e.x, e.y, rr2 * amp, a0, a0 + 1.7 - i * 0.14, 3 + (6 - i) * 0.5,
          0.55 + i * 0.06, 0.35, 1.0, 0.22 * amp);
      }
      // the Einstein ring
      R.ring(L.FLOOR, e.x, e.y, 96 * amp, 3, 1, 0.94, 0.86, 0.6 * amp);
      R.softRing(L.FLOOR, e.x, e.y, 128 * amp, 1, 0.9, 0.75, 0.28 * amp);
      R.disc(L.EBULLETS, e.x, e.y, 70 * amp, 0.01, 0.01, 0.02, 1);
      R.light(e.x, e.y, 300, -0.2);
    }
  });

  /* =========================================================== 11 TIME FRACTURE
   * A crack spiders across the sky with glass tinks; through it the backdrop
   * runs slow. Everything in the band is 60% speed, enemy bullets included. */
  var crackX = new Float32Array(10), crackY = new Float32Array(10);

  Ev.define('timeFracture', {
    layer: 'veil',
    telegraph: 1.4, active: 11, decay: 2,
    onStart: function (e) {
      var a = e.angle, r = NA.Arena.radius * 1.3;
      var x0 = Math.cos(a) * r, y0 = Math.sin(a) * r;
      var x1 = -x0, y1 = -y0;
      var nx = -(y1 - y0), ny = (x1 - x0);
      var l = Math.sqrt(nx * nx + ny * ny) || 1; nx /= l; ny /= l;
      for (var i = 0; i < 10; i++) {
        var t = i / 9;
        var j = (i === 0 || i === 9) ? 0 : (rnd() - 0.5) * 150;
        crackX[i] = x0 + (x1 - x0) * t + nx * j;
        crackY[i] = y0 + (y1 - y0) * t + ny * j;
      }
      e.data.w = 190;
      e.data.tink = 0;
      sfx('telegraph');
    },
    update: function (e, dt) {
      e.data.tink -= dt;
      if (e.data.tink <= 0 && e.phase !== 'decay') {
        e.data.tink = rr(0.5, 1.4);
        if (NA.Audio) NA.Audio.sfx('graze', { pitch: rr(1.4, 2.2), vol: 0.35 });
      }
    },
    timeMul: function (e, x, y) {
      if (e.phase === 'telegraph') return 1;
      var amp = e.phase === 'decay' ? 1 - e.k : 1;
      var d = bandDist(x, y);
      var k = 1 - M.clamp01(d / e.data.w);
      return 1 - 0.6 * k * amp;                 // 10.3: 60% slower inside the band
    },
    render: function (e) {
      var R = NA.R, L = R.L, i;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      var acc = Ev.accent;
      for (i = 0; i < 9; i++) {
        // the slow band
        R.line(L.FLOOR, crackX[i], crackY[i], crackX[i + 1], crackY[i + 1],
          e.data.w * 1.6, 0.30, 0.36, 0.62, 0.055 * amp);
        R.line(L.FLOOR, crackX[i], crackY[i], crackX[i + 1], crackY[i + 1],
          e.data.w * 0.8, 0.40, 0.48, 0.80, 0.055 * amp);
        // the crack itself
        R.line(L.VEIL, crackX[i], crackY[i], crackX[i + 1], crackY[i + 1], 2.5,
          0.85, 0.92, 1, 0.45 * amp);
        // splinters
        var mx = (crackX[i] + crackX[i + 1]) * 0.5, my = (crackY[i] + crackY[i + 1]) * 0.5;
        var sa = Math.atan2(crackY[i + 1] - crackY[i], crackX[i + 1] - crackX[i]) + (i & 1 ? 1.1 : -1.1);
        var sl = 40 + 60 * (0.5 + 0.5 * Math.sin(i * 2.3 + NA.Time.t * 0.7));
        R.line(L.VEIL, mx, my, mx + Math.cos(sa) * sl, my + Math.sin(sa) * sl, 1.6,
          acc[0], acc[1], acc[2], 0.30 * amp);
      }
    }
  });

  function bandDist(x, y) {
    var best = 1e9;
    for (var i = 0; i < 9; i++) {
      var ax = crackX[i], ay = crackY[i], bx = crackX[i + 1], by = crackY[i + 1];
      var vx = bx - ax, vy = by - ay, wx = x - ax, wy = y - ay;
      var vv = vx * vx + vy * vy;
      var t = vv > 0 ? M.clamp01((wx * vx + wy * vy) / vv) : 0;
      var cx = ax + vx * t - x, cy = ay + vy * t - y;
      var d2 = cx * cx + cy * cy;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  /* ======================================================== 12 RESONANCE PULSE
   * The floor breathes concentric rings on the music beat. Shots fired inside
   * the on-beat window deal +25%. */
  var RING_MAX = 8;
  var rgT = new Float32Array(RING_MAX);
  var rgN = 0, rgHead = 0, beatUnsub = null;

  Ev.define('resonancePulse', {
    layer: 'backdrop',
    telegraph: 1.2, active: 18, decay: 2,
    onStart: function (e) {
      rgN = 0; rgHead = 0; e.data.win = 0; e.data.since = 9;
      if (NA.Audio && NA.Audio.music && NA.Audio.music.onBeat) {
        beatUnsub = NA.Audio.music.onBeat(function () { pushRing(); });
      }
      e.data.fallback = 60 / ((NA.Audio && NA.Audio.music && NA.Audio.music.bpm) || 120);
      e.data.fbT = 0;
    },
    onEnd: function () { if (beatUnsub) { beatUnsub(); beatUnsub = null; } },
    update: function (e, dt) {
      var i;
      for (i = 0; i < rgN; i++) rgT[i] += dt;
      // trim the oldest
      while (rgN > 0 && rgT[(rgHead - rgN + RING_MAX) % RING_MAX] > 2.4) rgN--;
      // when the music engine is silent (test runs), keep the beat ourselves
      /* Also run the metronome when the music engine is attached but silent
       * (a muted tab, a test run): the window may never simply stop opening. */
      if (!beatUnsub || e.data.since > e.data.fallback * 2) {
        e.data.fbT += dt;
        if (e.data.fbT >= e.data.fallback) { e.data.fbT -= e.data.fallback; pushRing(); }
      }
      e.data.since += dt;
      // a 140 ms window centred just after the beat
      e.data.win = e.data.since < 0.14 ? 1 - e.data.since / 0.14 : 0;
      if (e.phase !== 'active') e.data.win = 0;
      e.data.lastWin = e.data.win;
    },
    /* No damageMul here: the +25% is stamped onto the bullet at FIRE time in
     * 08_bullets.firePlayer (via Ev.beatWindow), so the reward belongs to your
     * trigger timing, not to where the shot happened to land. */
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena, acc = Ev.accent;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      for (var i = 0; i < rgN; i++) {
        var idx = (rgHead - 1 - i + RING_MAX * 2) % RING_MAX;
        var t = rgT[idx];
        var r = 40 + t * 620;
        if (r > A.radius * 1.25) continue;
        var a = (1 - t / 2.4) * 0.28 * amp;
        R.ring(L.FLOOR, A.cx, A.cy, r, 3.5, acc[0], acc[1], acc[2], a);
      }
      // the window itself: the rim flashes gold on beat so it is readable
      if (e.data.win > 0) {
        R.ring(L.MEMBRANE, A.cx, A.cy, A.radius - 3, 4, 1, 0.847, 0.302, 0.35 * e.data.win * amp);
      }
    }
  });

  function pushRing() {
    rgT[rgHead] = 0;
    rgHead = (rgHead + 1) % RING_MAX;
    if (rgN < RING_MAX) rgN++;
    var e = Ev.find('resonancePulse');
    if (e) e.data.since = 0;
  }

  /* ============================================================= 13 DARK PHASE
   * Stars wink out region by region; a ring locks at your light radius. Only
   * the ship's light and the player's bullets illuminate. Stamps capped at 60. */
  Ev.define('darkPhase', {
    layer: 'veil',
    telegraph: 2, active: 13, decay: 2,
    onStart: function (e) { e.data.d = 0; sfx('charge'); },
    update: function (e, dt) {
      var target = e.phase === 'telegraph' ? e.k * 0.25
        : (e.phase === 'decay' ? (1 - e.k) * 0.82 : 0.82);
      e.data.d = M.smooth(e.data.d, target * (0.55 + 0.45 * flashScale()), 2.2, dt);
      NA.FX.darkness(e.data.d, 0);
    },
    onEnd: function () { NA.FX.darkness(0, 0); },
    // shooting into darkness reveals: a bullet close by lights an invisible up
    reveal: function (e, x, y) {
      if (e.phase === 'telegraph') return 0;
      var B = NA.Bullets, P = B.P, best = 0;
      var pd2 = M.dist2(x, y, NA.Player.x, NA.Player.y);
      if (pd2 < 240 * 240) best = 0.6 * (1 - Math.sqrt(pd2) / 240);
      var lim = P.n < 200 ? P.n : 200;
      for (var i = 0; i < lim; i++) {
        var dx = P.x[i] - x, dy = P.y[i] - y, d2 = dx * dx + dy * dy;
        if (d2 > 32400) continue;                  // 180 px
        var v = 1 - Math.sqrt(d2) / 180;
        if (v > best) best = v;
        if (best > 0.95) break;
      }
      return best;
    },
    render: function (e) {
      var R = NA.R, L = R.L;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      // ship lantern + a ring that locks at the light radius
      var lr = 260;
      R.light(NA.Player.x, NA.Player.y, lr, 0.95 * amp);
      R.ring(L.MEMBRANE, NA.Player.x, NA.Player.y, lr, 1.6, 0.30, 0.95, 1, 0.16 * amp);
      R.disc(L.FLOOR, NA.Player.x, NA.Player.y, lr * 0.9, 0.10, 0.35, 0.45, 0.07 * amp);
      // every player bullet is a lamp — cap the stamps at 60
      var B = NA.Bullets, P = B.P, made = 0;
      for (var i = 0; i < P.n && made < 59; i++) {
        R.light(P.x[i], P.y[i], 150, 0.55 * amp);
        made++;
      }
      // the stars winking out, region by region
      if (e.phase === 'telegraph') {
        var A = NA.Arena;
        for (var s = 0; s < 6; s++) {
          var a = e.angle + s / 6 * M.TAU;
          var k2 = M.clamp01(e.k * 6 - s);
          R.disc(L.BACKDROP, A.cx + Math.cos(a) * A.radius * 0.8, A.cy + Math.sin(a) * A.radius * 0.8,
            520, 0, 0, 0, 0.75 * k2);
        }
      }
    }
  });

  /* =============================================================== 14 ION STORM
   * The hue rotates until enemy colours swap; a rainbow ring flares at the
   * swap. Enemies that now look like the player take double damage. */
  Ev.define('ionStorm', {
    layer: 'backdrop',
    telegraph: 2.5, active: 12, decay: 2.5,
    onStart: function (e) { e.data.h = 0; e.data.flared = 0; },
    update: function (e, dt) {
      var target = e.phase === 'telegraph' ? e.k * Math.PI * 0.5
        : (e.phase === 'decay' ? (1 - e.k) * Math.PI : Math.PI);
      e.data.h = M.smooth(e.data.h, target, 1.4, dt);
      NA.FX.hue(e.data.h, 220);
      Ev.inverted = M.clamp01(e.data.h / Math.PI) * (e.phase === 'telegraph' ? 0 : 1);
      if (e.phase === 'active' && !e.data.flared) {
        e.data.flared = 1;
        sfx('bossPhase');
        NA.FX.chroma(3 * flashScale(), 500);
        NA.FX.trauma(0.18);
      }
    },
    onEnd: function () { NA.FX.hue(0, 1); Ev.inverted = 0; },
    damageMul: function (e, x, y) {
      // the query form: anything asking "how hard do I hit here" during a full
      // inversion gets 2x. Callers that know the enemy's hue should test
      // NA.Events.inverted themselves.
      return e.phase === 'active' && Ev.inverted > 0.8 ? 2 : 1;
    },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      // the ion sea in the backdrop
      for (var i = 0; i < 6; i++) {
        var a = NA.Time.t * 0.12 + i * 1.05;
        var col = M.hsv((NA.Time.t * 0.05 + i / 6) % 1, 0.55, 1);
        R.sprite(L.BACKDROP, 'evLobe',
          Math.cos(a) * A.radius * 0.9, Math.sin(a) * A.radius * 0.9, a,
          620, 520, col[0], col[1], col[2], 0.07 * amp);
      }
      // the rainbow ring flare at the swap
      if (e.phase === 'active' && e.k < 0.25) {
        var f = 1 - e.k / 0.25;
        for (var s = 0; s < 8; s++) {
          var c2 = M.hsv(s / 8, 0.8, 1);
          R.ring(L.MEMBRANE, A.cx, A.cy, A.radius * (0.2 + e.k * 4.4) - s * 9, 4,
            c2[0], c2[1], c2[2], 0.35 * f);
        }
      }
      R.ring(L.MEMBRANE, A.cx, A.cy, A.radius - 5, 2.5,
        Ev.accent[0], Ev.accent[1], Ev.accent[2], 0.12 * amp);
    }
  });

  var RIFT_SAFE = 300;   // no enemy bullet may exit a rift this close to you

  /* =============================================================== 15 RIFT SPAWN
   * Two hexagonal tears open with sub-bass. Bullets entering one rift exit the
   * opposite one — a position swap that keeps velocity. */
  Ev.define('riftSpawn', {
    layer: 'backdrop',
    telegraph: 1.8, active: 14, decay: 2,
    onStart: function (e) {
      var r = NA.Arena.radius * 0.58;
      e.data.ax = Math.cos(e.angle) * r; e.data.ay = Math.sin(e.angle) * r;
      e.data.bx = -e.data.ax; e.data.by = -e.data.ay;
      e.data.r = 0;
      e.data.flash = 0; e.data.fx = 0; e.data.fy = 0;
      sfx('gate');
    },
    update: function (e, dt) {
      var target = e.phase === 'telegraph' ? e.k * 40 : (e.phase === 'decay' ? (1 - e.k) * 92 : 92);
      e.data.r = M.smooth(e.data.r, target, 3, dt);
      if (e.data.flash > 0) e.data.flash -= dt;
      if (e.phase !== 'active') return;
      var R2 = e.data.r * e.data.r, B = NA.Bullets, kk, pool, i;
      for (kk = 0; kk < 2; kk++) {
        pool = kk === 0 ? B.P : B.E;
        for (i = 0; i < pool.n; i++) {
          var dax = pool.x[i] - e.data.ax, day = pool.y[i] - e.data.ay;
          var dbx = pool.x[i] - e.data.bx, dby = pool.y[i] - e.data.by;
          var inA = dax * dax + day * day < R2, inB = dbx * dbx + dby * dby < R2;
          if (!inA && !inB) continue;
          // exit the opposite rift at the mirrored offset, pushed clear of it
          var ox = inA ? dax : dbx, oy = inA ? day : dby;
          var tx2 = inA ? e.data.bx : e.data.ax, ty2 = inA ? e.data.by : e.data.ay;
          var sp = Math.sqrt(pool.vx[i] * pool.vx[i] + pool.vy[i] * pool.vy[i]) || 1;
          var nx2 = tx2 + ox + (pool.vx[i] / sp) * e.data.r * 1.15;
          var ny2 = ty2 + oy + (pool.vy[i] / sp) * e.data.r * 1.15;
          /* 12.8: a lethal round may not materialise on top of you with no
           * warning. An ENEMY bullet whose exit lands inside the reaction
           * bubble simply flies through the rift instead of taking it; the
           * mouths themselves are permanently telegraphed. */
          if (kk === 1 && NA.Player.alive) {
            var pdx = nx2 - NA.Player.x, pdy = ny2 - NA.Player.y;
            if (pdx * pdx + pdy * pdy < RIFT_SAFE * RIFT_SAFE) continue;
          }
          pool.x[i] = nx2; pool.y[i] = ny2;
          e.data.flash = 0.42;                          // the exit mouth flares
          e.data.fx = tx2; e.data.fy = ty2;
          pool.px[i] = pool.x[i]; pool.py[i] = pool.y[i];
          NA.Particles.spawn(pool.x[i], pool.y[i], 0, 0, 0.2, 4,
            Ev.accent[0], Ev.accent[1], Ev.accent[2], 0.7, 0, 4);
        }
      }
    },
    render: function (e) {
      var R = NA.R, L = R.L, acc = Ev.accent;
      var t = NA.Time.t;
      for (var s = 0; s < 2; s++) {
        var x = s ? e.data.bx : e.data.ax, y = s ? e.data.by : e.data.ay;
        var rot = t * (s ? -0.5 : 0.5);
        R.disc(L.EBULLETS, x, y, e.data.r * 1.5, 0.02, 0.015, 0.05, 0.8);
        R.polyFill(L.EBULLETS, x, y, e.data.r * 0.92, 6, rot, 0.015, 0.01, 0.04, 1);
        R.poly(L.FLOOR, x, y, e.data.r, 6, rot, 3, acc[0], acc[1], acc[2], 0.85);
        R.poly(L.FLOOR, x, y, e.data.r * 1.28, 6, -rot * 0.6, 1.6, acc[0], acc[1], acc[2], 0.30);
        // 10.1: pure white is reserved for the ship core, your bullets and the
        // thing about to kill you. A rift is neither, so it burns accent.
        R.poly(L.VEIL, x, y, e.data.r * (0.5 + 0.12 * Math.sin(t * 3 + s)), 6, rot * 2,
          1.5, acc[0], acc[1], acc[2], 0.45);
        // the mouth something just came out of flares for 0.42 s
        if (e.data.flash > 0 && Math.abs(e.data.fx - x) < 1 && Math.abs(e.data.fy - y) < 1) {
          var fk = e.data.flash / 0.42;
          R.poly(L.VEIL, x, y, e.data.r * (1.3 + (1 - fk) * 0.5), 6, -rot,
            3 + fk * 3, 1, 0.541, 0, 0.8 * fk);
        }
        R.light(x, y, 260, 0.3);
      }
      // a hairline between them so the pairing is legible
      R.line(L.FLOOR, e.data.ax, e.data.ay, e.data.bx, e.data.by, 1.2,
        acc[0], acc[1], acc[2], 0.08);
    }
  });

  /* ============================================================ 16 METEOR SHOWER
   * Warning glints, then target-line dashes, then fiery streaks with lingering
   * craters. Meteors hurt anyone; craters are slow zones for 5 s; meteors that
   * hit enemies shatter them. */
  var MET_MAX = 14, CRAT_MAX = 12;
  var mtX = new Float32Array(MET_MAX), mtY = new Float32Array(MET_MAX),
    mtTX = new Float32Array(MET_MAX), mtTY = new Float32Array(MET_MAX),
    mtT = new Float32Array(MET_MAX), mtS = new Int32Array(MET_MAX);
  var meteorN = 0;
  var crX = new Float32Array(CRAT_MAX), crY = new Float32Array(CRAT_MAX),
    crR = new Float32Array(CRAT_MAX), crT = new Float32Array(CRAT_MAX);
  var craterN = 0;

  var MET_TELE = 0.9;                          // >= 0.4 s telegraph, per the rules

  function spawnMeteor() {
    if (meteorN >= MET_MAX) return;
    var i = meteorN++;
    var a = rnd() * M.TAU, r = Math.sqrt(rnd()) * NA.Arena.radius * 0.86;
    mtTX[i] = Math.cos(a) * r; mtTY[i] = Math.sin(a) * r;
    var ia = a + rr(-1.1, 1.1) + Math.PI;
    mtX[i] = mtTX[i] + Math.cos(ia) * 1500;
    mtY[i] = mtTY[i] + Math.sin(ia) * 1500;
    mtT[i] = 0; mtS[i] = 0;
    sfx('telegraph', mtTX[i], mtTY[i]);
  }

  function addCrater(x, y, r) {
    var i;
    if (craterN < CRAT_MAX) i = craterN++;
    else { i = 0; for (var k = 1; k < CRAT_MAX; k++) if (crT[k] < crT[i]) i = k; }
    crX[i] = x; crY[i] = y; crR[i] = r; crT[i] = 5;
  }

  Ev.define('meteorShower', {
    layer: 'veil',
    telegraph: 1.2, active: 12, decay: 5.5,
    onStart: function (e) { meteorN = 0; e.data.next = 0; sfx('charge'); },
    update: function (e, dt) {
      var i;
      for (i = 0; i < craterN; i++) {
        crT[i] -= dt;
        if (crT[i] <= 0) { crT[i] = crT[craterN - 1]; crX[i] = crX[craterN - 1]; crY[i] = crY[craterN - 1]; crR[i] = crR[craterN - 1]; craterN--; i--; }
      }
      if (e.phase === 'active') {
        e.data.next -= dt;
        if (e.data.next <= 0) { e.data.next = rr(0.35, 0.9); spawnMeteor(); }
      }
      for (i = 0; i < meteorN; i++) {
        mtT[i] += dt;
        if (mtS[i] === 0) {
          if (mtT[i] >= MET_TELE) { mtS[i] = 1; mtT[i] = 0; sfx('lock', mtTX[i], mtTY[i]); }
          continue;
        }
        // the streak: 0.22 s from off-screen to the mark
        var k = M.clamp01(mtT[i] / 0.22);
        var cx = mtX[i] + (mtTX[i] - mtX[i]) * k, cy = mtY[i] + (mtTY[i] - mtY[i]) * k;
        NA.Particles.spawn(cx, cy, rr(-60, 60), rr(-60, 60), 0.22, 3, 1, 0.6, 0.2, 0.8, 0, 2);
        if (k >= 1) {
          // impact
          var IX = mtTX[i], IY = mtTY[i], IR = 96;
          NA.Particles.burst(IX, IY, 16, 380, 0.35, 1, 0.55, 0.15, 1);
          NA.Particles.ring(IX, IY, 10, IR * 1.6, 0.4, 4, 1, 0.6, 0.2, 0.85);
          NA.FX.trauma(0.22);
          sfx('explode', IX, IY);
          // meteors that hit enemies shatter them
          var En = NA.Enemies;
          if (En && En.n) {
            var cnt = En.grid.query(IX, IY, IR + 40, En.grid.out3), out = En.grid.out3;   // nested-safe
            for (var q = 0; q < cnt; q++) {
              var ei = out[q];
              if (ei >= En.n || En.intangible[ei] > 0) continue;
              if (M.dist2(En.x[ei], En.y[ei], IX, IY) > (IR + En.size[ei]) * (IR + En.size[ei])) continue;
              En.damage(ei, 9999, 'enemy');
            }
          }
          if (live() && M.dist2(NA.Player.x, NA.Player.y, IX, IY) < (IR + C.SHIP_R) * (IR + C.SHIP_R))
            NA.Player.damage(1, IX, IY);
          addCrater(IX, IY, IR * 1.15);
          // swap-remove the meteor
          meteorN--;
          mtX[i] = mtX[meteorN]; mtY[i] = mtY[meteorN]; mtTX[i] = mtTX[meteorN];
          mtTY[i] = mtTY[meteorN]; mtT[i] = mtT[meteorN]; mtS[i] = mtS[meteorN];
          i--;
        }
      }
    },
    speedMul: function (e, x, y) {
      for (var i = 0; i < craterN; i++) {
        var dx = x - crX[i], dy = y - crY[i];
        if (dx * dx + dy * dy < crR[i] * crR[i]) return 0.55;
      }
      return 1;
    },
    render: function (e) {
      var R = NA.R, L = R.L, i;
      // craters: slow zones, drawn on the floor with a hot rim
      for (i = 0; i < craterN; i++) {
        var f = M.clamp01(crT[i] / 5);
        R.disc(L.FLOOR, crX[i], crY[i], crR[i], 1, 0.35, 0.10, 0.10 * f);
        R.ring(L.FLOOR, crX[i], crY[i], crR[i], 2.5, 1, 0.5, 0.15, 0.35 * f);
        R.ring(L.FLOOR, crX[i], crY[i], crR[i] * (0.55 + 0.1 * Math.sin(NA.Time.t * 2 + i)), 1.4,
          1, 0.6, 0.2, 0.2 * f);
      }
      for (i = 0; i < meteorN; i++) {
        if (mtS[i] === 0) {
          // target-line dashes + the mark, orange -> red at lock
          var k = M.clamp01(mtT[i] / MET_TELE);
          if (NA.Enemies.telegraphCircle) NA.Enemies.telegraphCircle(mtTX[i], mtTY[i], 96, mtT[i], MET_TELE, 0.72);
          var dx = mtTX[i] - mtX[i], dy = mtTY[i] - mtY[i];
          var l = Math.sqrt(dx * dx + dy * dy) || 1; dx /= l; dy /= l;
          var col = NA.Enemies.telegraphColor ? NA.Enemies.telegraphColor(mtT[i], MET_TELE * 0.72) : null;
          var cr = col ? col[0] : 1, cg = col ? col[1] : 0.55, cb = col ? col[2] : 0.1;
          for (var s = 0; s < 7; s++) {
            var d0 = 60 + s * 90, d1 = d0 + 46;
            R.line(L.VEIL, mtTX[i] - dx * d0, mtTY[i] - dy * d0,
              mtTX[i] - dx * d1, mtTY[i] - dy * d1, 5, cr, cg, cb, 0.85 * k * (1 - s / 11));
          }
          // the warning glint high above
          R.dot(L.VEIL, mtTX[i] - dx * 760, mtTY[i] - dy * 760, 3 + 4 * k, 1, 0.9, 0.7, 0.5 + 0.5 * k);
        } else {
          var kk = M.clamp01(mtT[i] / 0.22);
          var cx = mtX[i] + (mtTX[i] - mtX[i]) * kk, cy = mtY[i] + (mtTY[i] - mtY[i]) * kk;
          var tx2 = mtX[i] + (mtTX[i] - mtX[i]) * Math.max(0, kk - 0.16);
          var ty2 = mtY[i] + (mtTY[i] - mtY[i]) * Math.max(0, kk - 0.16);
          R.line(L.VEIL, tx2, ty2, cx, cy, 16, 1, 0.5, 0.12, 0.45);
          R.line(L.VEIL, tx2, ty2, cx, cy, 5, 1, 0.9, 0.6, 0.9);
          R.dot(L.VEIL, cx, cy, 12, 1, 1, 0.95, 1);
          R.light(cx, cy, 300, 0.6);
        }
      }
    }
  });

  /* ============================================================== 17 SOLAR WIND
   * The whole starfield streams one way for 6 s: a constant push on everything
   * through NA.Events.windX / windY (and therefore through forceAt). */
  Ev.define('solarWind', {
    layer: 'backdrop',
    telegraph: 1.5, active: 6, decay: 2,
    onStart: function (e) {
      e.data.dx = Math.cos(e.angle); e.data.dy = Math.sin(e.angle);
      e.data.mag = 0;
      sfx('charge');
    },
    update: function (e, dt) {
      var target = e.phase === 'telegraph' ? e.k * 60 : (e.phase === 'decay' ? (1 - e.k) * 260 : 260);
      e.data.mag = M.smooth(e.data.mag, target, 2, dt);
      Ev.windX = e.data.dx * e.data.mag;
      Ev.windY = e.data.dy * e.data.mag;
      if (e.phase === 'active' && (e.t % 1.5) < dt) sfx('wall');
    },
    onEnd: function () { Ev.windX = Ev.windY = 0; },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      var dx = e.data.dx, dy = e.data.dy, acc = Ev.accent;
      // the streaming starfield: 40 streaks that scroll with the wind
      var t = NA.Time.t;
      for (var i = 0; i < 40; i++) {
        var ph = (i * 0.618 + t * 0.35) % 1;
        var lat = ((i * 137.5) % 360) / 360 - 0.5;
        var px = A.cx - dx * (A.radius * 1.6) + dx * (ph * A.radius * 3.2) - dy * lat * A.radius * 2.6;
        var py = A.cy - dy * (A.radius * 1.6) + dy * (ph * A.radius * 3.2) + dx * lat * A.radius * 2.6;
        var len = 110 + 130 * Math.sin(i * 2.7);
        R.line(L.BACKDROP, px, py, px + dx * len, py + dy * len, 2.2,
          acc[0], acc[1], acc[2], 0.22 * amp * Math.sin(ph * Math.PI));
      }
      // the direction is also a rim arrow band so it is unmissable
      var a = Math.atan2(dy, dx);
      for (var s = -2; s <= 2; s++) {
        var aa = a + Math.PI + s * 0.12;
        var rx = A.cx + Math.cos(aa) * A.radiusAt(aa), ry = A.cy + Math.sin(aa) * A.radiusAt(aa);
        R.line(L.MEMBRANE, rx, ry, rx + dx * 70, ry + dy * 70, 3,
          acc[0], acc[1], acc[2], 0.30 * amp);
      }
    }
  });

  /* =========================================================== 18 FLARE CASCADE
   * Bursts crawl along the rim ring after ring. Each burst detonates enemy
   * projectiles near the wall: a rolling temporary safe zone. */
  var FL_MAX = 10;
  var flA = new Float32Array(FL_MAX), flT = new Float32Array(FL_MAX);
  var flN = 0;

  Ev.define('flareCascade', {
    layer: 'veil',
    telegraph: 1.2, active: 9, decay: 2,
    onStart: function (e) { flN = 0; e.data.a = e.angle; e.data.next = 0; e.data.dir = rnd() < 0.5 ? -1 : 1; sfx('charge'); },
    update: function (e, dt) {
      var i;
      for (i = 0; i < flN; i++) {
        flT[i] += dt;
        if (flT[i] > 1.1) { flA[i] = flA[flN - 1]; flT[i] = flT[flN - 1]; flN--; i--; }
      }
      if (e.phase !== 'active') return;
      e.data.a += e.data.dir * 2.4 * dt;
      e.data.next -= dt;
      if (e.data.next > 0) return;
      e.data.next = 0.26;
      if (flN < FL_MAX) { flA[flN] = e.data.a; flT[flN] = 0; flN++; }
      // detonate enemy projectiles near the wall at the burst
      var A = NA.Arena;
      var rr2 = A.radiusAt(e.data.a) - 60;
      var bx = A.cx + Math.cos(e.data.a) * rr2, by = A.cy + Math.sin(e.data.a) * rr2;
      var n = NA.Bullets.clearArea(bx, by, 180, false);
      A.ripple(A.cx + Math.cos(e.data.a) * A.radiusAt(e.data.a),
        A.cy + Math.sin(e.data.a) * A.radiusAt(e.data.a), 0.6,
        Ev.accent[0], Ev.accent[1], Ev.accent[2]);
      if (n > 0) sfx('explode', bx, by); else sfx('uiTick', bx, by);
    },
    render: function (e) {
      var R = NA.R, L = R.L, A = NA.Arena, acc = Ev.accent;
      var amp = e.phase === 'telegraph' ? e.k : (e.phase === 'decay' ? 1 - e.k : 1);
      for (var i = 0; i < flN; i++) {
        var k = flT[i] / 1.1, f = 1 - k;
        var a = flA[i];
        var rw = A.radiusAt(a);
        var bx = A.cx + Math.cos(a) * (rw - 60), by = A.cy + Math.sin(a) * (rw - 60);
        R.disc(L.FLOOR, bx, by, 60 + k * 190, acc[0], acc[1], acc[2], 0.22 * f * amp);
        R.ring(L.MEMBRANE, bx, by, 40 + k * 200, 3, acc[0], acc[1], acc[2], 0.5 * f * amp);
        R.arc(L.MEMBRANE, A.cx, A.cy, rw - 4, a - 0.25 * (1 - f), a + 0.25 * (1 - f), 5,
          1, 0.9, 0.7, 0.4 * f * amp);
        R.light(bx, by, 320, 0.4 * f * amp);
      }
      // the leading edge, so the player can read where the safe zone goes next
      if (e.phase === 'active') {
        var a2 = e.data.a + e.data.dir * 0.35;
        var r2 = A.radiusAt(a2);
        R.arc(L.VEIL, A.cx, A.cy, r2 - 30, a2 - 0.12, a2 + 0.12, 3,
          1, 0.55, 0.15, 0.35 + 0.25 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ));
      }
    }
  });

})();
