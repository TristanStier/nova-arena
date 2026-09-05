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
    /* Endless boss mutators. 14_waves.js publishes the flag table here when a
     * fight starts and nulls it when the fight ends; the runner below is the
     * only thing that reads it, so no individual fight has to know. */
    mods: null,
    _modsSeen: null,
    twin: null,

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
      b.hitT = 0;
      modsInstall(b);
      NA.Cam.setZoom(NA.Cam.zoom * 1.08, 400);
      if (NA.Audio) NA.Audio.sfx('bossIntro');
      if (NA.Game) NA.Game.emit('bossIntro', id);
      return b;
    },

    /* A fourth-wall fight owns real DOM (the torn draft panel, the page crack
     * shards, the tall scroll spacer) and a page-wide CSS filter. Each of them
     * cleans up in its own onEnd, but a fight that is torn down mid-beat (a
     * death, a restart, a ?boss= jump) never reaches that code — so the
     * framework sweeps the wall itself whenever a fight ends or a run resets.
     * FW.reset() is idempotent and is a no-op when nothing was touched. */
    _fourthWallSweep: fourthWallSweep,

    clear: function () {
      var b = B.active;
      if (b && b.def.onEnd) b.def.onEnd(b);
      if (B.twin && B.twin.def.onEnd) {
        var pv = B.active; B.active = B.twin;
        try { B.twin.def.onEnd(B.twin); } catch (e) { }
        B.active = pv;
      }
      B.twin = null;
      B._modsSeen = null;
      modsTeardown();
      B.active = null;
      fourthWallSweep();
    },

    /* Per-run reset. 13c's persistent-effect list and 13d's ticker list each
     * chain onto this, so NA.Game.newRun() clears every run-long effect in one
     * call — on restart from death and on returning to the title alike. */
    resetRun: function () {
      B.twin = null;
      B.mods = null; B._modsSeen = null;
      modsTeardown();
      ghostReset();
      B.active = null;
      fourthWallSweep();
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

    /* Projectile hit test — NA.Bullets calls this for every player bullet.
     * With the `twin` mutator there are two bodies, so the twin is offered the
     * shot first (it is the nearer, cheaper target). */
    hit: function (x, y, r, dmg) {
      if (B.twin && B.twin.state === 'fight') {
        var pv = B.active;
        B.active = B.twin;
        var th = false;
        try { th = hitOne(x, y, r, dmg); } finally { B.active = pv; }
        if (th) return true;
      }
      return hitOne(x, y, r, dmg);
    },

    damage: function (amt) {
      var b = B.active; if (!b || b.state !== 'fight') return;
      /* A fight (or a ?boss= jump) that set state directly can still be at
       * phase -1; phases[-1] is undefined and the floor below would compute one
       * whole phase ABOVE maxHp, healing the boss out of reach. */
      if (b.phase < 0) return;
      if (b.def.onDamage && b.def.onDamage(b, amt) === false) return;
      var ph = b.def.phases[b.phase];
      b.hp -= amt;
      b.flash = 0.08;
      b.hitT = 0.3;                 // `cloaked` shows the body for 0.3s after a hit
      /* Each phase floors the boss one point ABOVE its threshold until the
       * phase has had its minimum duration, so a burst build cannot skip a
       * beat. The advance test must therefore compare against that same
       * `base + 1`, not against the (by then lowered) floor: comparing against
       * `floor + 0.001` meant a boss pinned at base+1 during the timer needed
       * one MORE landed hit afterwards to advance, and a fight whose weak
       * points had meanwhile all been consumed could never land it. The
       * Congregation deadlocked at exactly 401/600 this way. */
      var phaseHp = b.maxHp / Math.max(1, b.def.phases.length);
      var last = b.phase >= b.def.phases.length - 1;
      var base = (b.def.phases.length - 1 - b.phase) * phaseHp;
      var floor = (!last && ph && b.phaseT < ph.minDuration) ? base + 1 : base;
      if (b.hp < floor) b.hp = floor;
      if (b.hp <= 0) B.die();
      else if (!last && ph && b.phaseT >= ph.minDuration && b.hp <= base + 1.001) B.nextPhase();
    },

    die: function () {
      /* Re-entrant death resets b.t and the 1.4 s 'dying' release never lands. */
      var b = B.active; if (!b || b.state === 'dying' || b.state === 'dead') return;
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
      var b = B.active;
      /* 14_waves.js publishes NA.Bosses.mods from the stateChange('boss')
       * listener, which fires AFTER spawn() — so the table is picked up here,
       * the first step it changes, rather than at spawn time. */
      if (B.mods !== B._modsSeen) {
        B._modsSeen = B.mods;
        if (B.mods) { if (b) modsInstall(b); }
        else modsTeardown();
      }
      var m = B.mods;
      NA.Enemies.telegraphScale = (m && m.hasty) ? HASTY : 1;
      if (!b) { B.twin = null; return; }

      NA.Enemies._tgMark = 0;
      stepBoss(b, dt);
      b.tg = NA.Enemies._tgMark ? 0.18 : Math.max(0, (b.tg || 0) - dt);
      if (b.hitT > 0) b.hitT -= dt;

      // the twin runs the same code with B.active pointed at it, so every
      // fight written against the framework behaves normally
      if (B.twin) {
        var t = B.twin;
        if (t.state === 'dead') B.twin = null;
        else {
          var pv = B.active;
          B.active = t;
          NA.Enemies._tgMark = 0;
          try { stepBoss(t, dt); } catch (e) { B.twin = null; }
          B.active = pv;
          if (B.twin) {
            B.twin.tg = NA.Enemies._tgMark ? 0.18 : Math.max(0, (B.twin.tg || 0) - dt);
            if (B.twin.hitT > 0) B.twin.hitT -= dt;
            // the fight is over when the headline boss goes down
            if (b.state !== 'fight' && b.state !== 'intro' && B.twin.state === 'fight') {
              var pv2 = B.active; B.active = B.twin;
              try { B.die(); } catch (e2) { }
              B.active = pv2;
            }
          }
        }
      }
      if (m && m.looped) ghostTick(dt);
    },

    render: function () {
      var b = B.active; if (!b) return;
      if (B.twin && B.twin.state !== 'dead') {
        var pvr = B.active; B.active = B.twin;
        try { renderBody(B.twin); } catch (e) { }
        B.active = pvr;
      }
      if (B.mods && B.mods.looped) ghostRender();
      var R = NA.R, L = R.L;
      if (b.state === 'dead') return;

      renderBody(b);

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

  /* ==================================================== the boss runner bits
   * hitOne / stepBoss / renderBody are the single-boss halves of hit / update /
   * render, so the twin mutator can drive a second instance through exactly
   * the same code with B.active swapped.
   *
   * The endless boss mutators (NA.Bosses.mods, published by 14_waves.js):
   *   hasty    NA.Enemies.telegraphScale 0.7 - every telegraph locks 30% earlier
   *   cloaked  the body draws at 15% alpha unless it is telegraphing, was hit
   *            in the last 0.3s, or is in its intro / death
   *   shy      hitTest reports "absorbed" while any non-ally enemy lives
   *   twin     a second instance of a cheap, self-contained fight
   *   looped   an input-echo ghost of the ship, 3s late, firing weak shots
   *   crowded / cramped / unstable are applied by 14_waves.js itself.
   */

  function hitOne(x, y, r, dmg) {
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
    /* shy: while anything else of its own is still alive the boss shrugs every
     * shot off. Clear the room first. */
    if (B.mods && B.mods.shy && nonAllyEnemies() > 0) {
      b.hitT = 0.3;
      NA.Particles.burst(x, y, 2, 90, 0.16, 0.55, 0.58, 0.65, 0);
      return true;
    }
    B.damage(dmg);
    NA.Particles.burst(x, y, 4, 180, 0.2, 1, 1, 1, 1);
    return true;
  }

  function stepBoss(b, dt) {
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
    /* A boss already pinned at its phase threshold advances the moment the
     * minimum duration expires, without waiting for one more landed hit —
     * some fights consume their own weak points and cannot offer one. */
    if (ph && b.phase < b.def.phases.length - 1 && b.phaseT >= ph.minDuration) {
      var pHp = b.maxHp / Math.max(1, b.def.phases.length);
      if (b.hp <= (b.def.phases.length - 1 - b.phase) * pHp + 1.001) { B.nextPhase(); return; }
    }
    if (ph && ph.update) ph.update(b, dt);
    if (b.def.update) b.def.update(b, dt);
  }

  /* The body and its phase overlay, under the cloaked fade. The rim health
   * ring is NOT faded: the read of "how much is left" must never disappear. */
  function renderBody(b) {
    if (b.state === 'dead') return;
    var m = B.mods, a = 1;
    if (m && m.cloaked) {
      var visible = (b.hitT > 0) || ((b.tg || 0) > 0) ||
        b.state === 'intro' || b.state === 'dying';
      a = visible ? 1 : CLOAK_A;
    }
    var prev = NA.R.alphaMul;
    NA.R.alphaMul = prev * a;
    try {
      if (b.def.render) b.def.render(b);
      var ph = b.def.phases[b.phase];
      if (ph && ph.render && b.state === 'fight') ph.render(b);
    } finally { NA.R.alphaMul = prev; }
  }

  function nonAllyEnemies() {
    var E = NA.Enemies, n = 0;
    for (var i = 0; i < E.n; i++) {
      if (E.ally[i] > 0) continue;
      if (E.intangible[i] > 0) continue;
      n++;
    }
    return n;
  }

  /* ------------------------------------------------------------- the mods */
  var HASTY = 0.7, CLOAK_A = 0.15;
  /* Only these four fights are cheap and self-contained enough to run twice:
   * everything else keeps module-level state two instances would share. */
  var TWIN_OK = { compactor: 1, constellation: 1, reflector: 1, angler: 1 };

  function modsInstall(b) {
    var m = B.mods;
    ghostReset();
    if (!m) { NA.Enemies.telegraphScale = 1; return; }
    if (m.hasty) NA.Enemies.telegraphScale = HASTY;
    if (m.twin && TWIN_OK[b.id] && !B.twin) {
      B.twin = {
        def: b.def, id: b.id, hp: b.def.hp * 0.6, maxHp: b.def.hp * 0.6,
        x: NA.Arena.cx, y: NA.Arena.cy,
        angle: b.angle + Math.PI, phase: -1, phaseT: 0, t: 0, introT: 0,
        state: 'intro', ringK: 0, flash: 0, hitT: 0, tg: 0, data: {}, isTwin: true
      };
    }
    if (m.looped) ghostStart();
  }

  function modsTeardown() {
    NA.Enemies.telegraphScale = 1;
    NA.R.alphaMul = 1;
    ghostReset();
  }

  /* --------------------------------------------------------- looped ghost
   * An echo of you, three seconds late. It replays the ship's own path from a
   * ring buffer and spits one weak shot at you every 1.4s, telegraphed for
   * 0.5s first - nothing in this game kills without a warning. */
  var GH_HZ = 20, GH_N = 128, GH_DELAY = 3.0;
  var ghX = new Float32Array(GH_N), ghY = new Float32Array(GH_N), ghA = new Float32Array(GH_N);
  var ghHead = 0, ghFill = 0, ghAcc = 0, ghOn = false, ghFire = 0;
  var ghX0 = 0, ghY0 = 0, ghA0 = 0;

  function ghostReset() { ghOn = false; ghHead = 0; ghFill = 0; ghAcc = 0; ghFire = 0; }

  /* Fourth-wall DOM safety net — see NA.Bosses.clear(). Only sweeps when the
   * wall actually has something outstanding, so a normal fight pays one
   * property read. */
  function fourthWallSweep() {
    var F = (NA.UI && NA.UI.fourthWall) || null;
    if (!F || typeof F.reset !== 'function') return;
    var dirty = F._fake || F._tall || F._flash || F._crackEls || F._viewport ||
      F.torn || F._scroll || (F.crack > 0) || (F.pageDim > 0) ||
      (F._digits && F._digits.length);
    if (!dirty) {
      // a page-wide filter left on <body> by an interrupted dimPage()
      try { if (!document.body.style.filter) return; } catch (e) { return; }
    }
    try { F.reset(); } catch (e) { }
  }
  function ghostStart() { ghostReset(); ghOn = true; ghX0 = NA.Player.x; ghY0 = NA.Player.y; }

  function ghostTick(dt) {
    if (!ghOn) return;
    ghAcc += dt;
    while (ghAcc >= 1 / GH_HZ) {
      ghAcc -= 1 / GH_HZ;
      ghX[ghHead] = NA.Player.x; ghY[ghHead] = NA.Player.y; ghA[ghHead] = NA.Player.angle;
      ghHead = (ghHead + 1) % GH_N;
      if (ghFill < GH_N) ghFill++;
    }
    var back = Math.round(GH_DELAY * GH_HZ);
    if (ghFill > back) {
      var i = (ghHead - back + GH_N * 2) % GH_N;
      ghX0 = ghX[i]; ghY0 = ghY[i]; ghA0 = ghA[i];
    }
    ghFire += dt;
    var TELL = 0.5, PERIOD = 1.4;
    if (ghFire > PERIOD - TELL && NA.Player.alive) {
      NA.Enemies.telegraphLine(ghX0, ghY0, NA.Player.x, NA.Player.y,
        ghFire - (PERIOD - TELL), TELL, TELL * 0.7, 2);
    }
    if (ghFire >= PERIOD) {
      ghFire = 0;
      var dx = NA.Player.x - ghX0, dy = NA.Player.y - ghY0;
      var l = Math.sqrt(dx * dx + dy * dy) || 1;
      NA.Bullets.fireEnemy(ghX0, ghY0, dx / l * 420, dy / l * 420,
        { size: 7, life: 3.2, dmg: 1, color: C.COL.violet });
      if (NA.Audio) NA.Audio.sfx('shot', { x: ghX0, y: ghY0, vol: 0.3 });
    }
  }

  function ghostRender() {
    if (!ghOn || ghFill < 4) return;
    var R = NA.R, L = R.L;
    var pulse = 0.35 + 0.2 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
    if (NA.Ship && NA.Ship.render) NA.Ship.render(ghX0, ghY0, ghA0, pulse, 1, C.COL.violet);
    else R.poly(L.ENEMIES, ghX0, ghY0, 14, 3, ghA0, 2, 0.62, 0.35, 1, pulse);
    R.ring(L.ENEMIES, ghX0, ghY0, 22, 1.4, 0.62, 0.35, 1, pulse * 0.8);
  }

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
        // the slab body: solid matter filling everything from the rim to its
        // face, so a slab reads as a crushing wall rather than a bar
        var body = d.depth[k] + 34;
        var mx = NA.Arena.cx + Math.cos(dir) * (sd + body * 0.5);
        var my = NA.Arena.cy + Math.sin(dir) * (sd + body * 0.5);
        R.line(L.ENEMIES, mx + px * half, my + py * half, mx - px * half, my - py * half, body,
          0.14, 0.06, 0.03, 1);
        R.line(L.ENEMIES, cx + px * half, cy + py * half, cx - px * half, cy - py * half, 12,
          0.40, 0.19, 0.07, 1);
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
