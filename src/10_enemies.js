/* 10_enemies.js — enemy framework: SoA pool, type registry, shared flock update,
 * telegraph helpers, invisibility, death pops, mutator plumbing, corpse buffer.
 *
 * Public API
 *   NA.Enemies.define(id, def)          see the def shape below
 *   NA.Enemies.spawn(id, x, y) -> i     -1 when the pool is full
 *   NA.Enemies.damage(i, amt, src) -> killed?
 *   NA.Enemies.damageArea(x, y, r, amt, src) -> hits
 *                                       re-entrant-safe: a blast fired from
 *                                       inside a death chain is QUEUED and
 *                                       drained iteratively, never recursed
 *   NA.Enemies.drainBlasts()            drain the queue now (called for you)
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
    _seenX: 0, _seenY: 0,              // last position enemies could actually see
    corpses: {
      x: new Float32Array(C.MAX_CORPSES), y: new Float32Array(C.MAX_CORPSES),
      type: new Int32Array(C.MAX_CORPSES), t: new Float32Array(C.MAX_CORPSES),
      head: 0, n: 0
    },
    killCombo: 0, _lastKillT: -9, _lastKillType: -1,
    totalKills: 0,
    /* Shared telegraph time scale. 1 = the authored timing; the endless
     * 'hasty' boss mutator drops it to 0.7 so every telegraph in the game
     * locks 30% earlier without a single fight knowing about it. */
    telegraphScale: 1,
    /* Enemy shot-cooldown multiplier, owned by NA.Player.mods.enemyFireMul
     * (Feedback Loop's downside). Refreshed every step; 1 when nothing set it. */
    fireMul: 1,
    _tgMark: 0,                        // set by _cue: "a telegraph drew this step" */

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
      /* A descending loop misses the children a splitter/hive onDeath appends
       * at indices it has already walked past, and those survivors can block
       * the wave-end condition. Drain instead, with a hard iteration budget. */
      var guard = C.MAX_ENEMIES * 4;
      while (P.n > 0 && guard-- > 0) { if (silent) P.free(P.n - 1); else En.kill(P.n - 1, false); }
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

    /* ------------------------------------------------- deferred blast queue
     * `damage -> kill -> onDeath -> damageArea -> damage -> ...` is a real
     * recursion (Volatile chains, Bloat clusters, Popper rings, the Ouroboros).
     * Nested blasts are QUEUED instead of run inline and drained by the
     * outermost caller (and again at the top of every step, so a blast queued
     * from a boss or an upgrade never survives a frame). Chains still chain —
     * they just do it iteratively, with a hard budget. 10b's and 10c's own
     * local guards keep working: they only ever see a non-re-entrant call. */
    _busy: 0,
    _qn: 0,
    _qcap: 64,
    _qx: new Float32Array(64), _qy: new Float32Array(64),
    _qr: new Float32Array(64), _qa: new Float32Array(64), _qs: [],

    damageArea: function (x, y, r, amt, src) {
      if (En._busy > 0) {                       // nested: queue it, drain later
        if (En._qn < En._qcap) {
          var q = En._qn++;
          En._qx[q] = x; En._qy[q] = y; En._qr[q] = r; En._qa[q] = amt; En._qs[q] = src;
        }
        return 0;
      }
      var hits = En._area(x, y, r, amt, src);
      En.drainBlasts();
      return hits;
    },

    _area: function (x, y, r, amt, src) {
      var hits = 0, r2 = r * r;
      En._busy++;
      /* The grid, not a full pool scan: a blast build at wave 29 fires ~20 of
       * these a frame against 500 enemies. out2 (not the shared out) because
       * damage -> onDeath -> hExplode/chainLightning query this same grid while
       * we are still walking our own results. Indices are re-validated: a death
       * swap-removes, so only the exact test and i < P.n decide. */
      var cnt = En.grid.query(x, y, r, En.grid.out2), out = En.grid.out2;
      /* Descending index order: a kill swap-removes the LAST live entity into
       * the freed slot, and every index still ahead of us is lower than that,
       * so nobody can be damaged twice by one blast. (Bounded insertion sort,
       * in place, no allocation; a huge query just falls back to grid order,
       * where the worst case is one enemy taking a blast twice.) */
      if (cnt > 1 && cnt <= 128) {
        for (var a1 = 1; a1 < cnt; a1++) {
          var v = out[a1], b1 = a1 - 1;
          while (b1 >= 0 && out[b1] < v) { out[b1 + 1] = out[b1]; b1--; }
          out[b1 + 1] = v;
        }
      }
      for (var q = 0; q < cnt; q++) {
        var i = out[q];
        if (i >= P.n) continue;
        var dx = P.x[i] - x, dy = P.y[i] - y;
        if (dx * dx + dy * dy > r2) continue;
        En.damage(i, amt, src);
        hits++;
      }
      En._busy--;
      return hits;
    },

    /* Drain the queued blasts iteratively. Each pass may queue more (a chain);
     * the pass budget bounds the whole chain to something finite. */
    drainBlasts: function () {
      var passes = 0;
      while (En._qn > 0 && passes++ < 8) {
        var n = En._qn, i;
        // copy the pass out of the queue so this pass's own children queue behind it
        for (i = 0; i < n; i++) { PASSX[i] = En._qx[i]; PASSY[i] = En._qy[i]; PASSR[i] = En._qr[i]; PASSA[i] = En._qa[i]; PASSS[i] = En._qs[i]; }
        // compact anything queued beyond this pass (there cannot be, but be safe)
        En._qn = 0;
        for (i = 0; i < n; i++) En._area(PASSX[i], PASSY[i], PASSR[i], PASSA[i], PASSS[i]);
      }
      En._qn = 0;
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

      /* onDeath is the recursion door: it spawns, explodes and kills. Run it
       * inside the busy guard (so any damageArea it fires is queued) and stop
       * running it at all once a death chain is absurdly deep. */
      var g0 = P.gen[i];
      if (d.onDeath && En._busy < 8) {
        En._busy++;
        try { d.onDeath(i); } finally { En._busy--; }
      }
      /* An onDeath that frees a slot <= i swap-removes a DIFFERENT live entity
       * into i; the trailing P.free(i) would then delete that innocent. */
      var stillHere = i < P.n && P.gen[i] === g0;

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
      // volatile mutator explodes on death (queued when a chain is running)
      if (P.mut[i] & En.MUT.VOLATILE) {
        if (En._busy > 0) En.damageArea(x, y, 110, 12, 'enemy');   // -> queued
        else NA.Bullets.explode(x, y, 110, 12, 1);
      }
      if (stillHere) P.free(i);
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
      // Pulsar Sweep and Eclipse totality drop every dome (GAME_PLAN 10.3)
      if (NA.Events && NA.Events.domesDown) return false;
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
      En._tgMark = 1;
      var dt = NA.Time.fixed;
      if (t < dt && t >= 0) { if (NA.Audio) NA.Audio.sfx('telegraph', { x: x, y: y }); }
      if (t >= lockAt && t - dt < lockAt) { if (NA.Audio) NA.Audio.sfx('lock', { x: x, y: y }); }
    },
    /* telegraphScale (the endless 'hasty' boss mutator) may never push a
     * telegraph under the 0.4 s floor GAME_PLAN 12.8 promises. */
    _scaleT: function (v) {
      var s = v * En.telegraphScale;
      return s < TELEGRAPH_MIN ? Math.min(v, TELEGRAPH_MIN) : s;
    },
    telegraphLine: function (x1, y1, x2, y2, t, dur, lockAt, w, col) {
      if (En.telegraphScale !== 1) { dur = En._scaleT(dur); lockAt = En._scaleT(lockAt); }
      En._cue(t, dur, lockAt, x1, y1);
      var c = col || En.telegraphColor(t, lockAt);
      var a = En.telegraphPulse(t, lockAt);
      var k = M.clamp01(t / Math.max(0.001, lockAt));
      NA.R.line(NA.R.L.VEIL, x1, y1, x1 + (x2 - x1) * Math.min(1, k * 1.25), y1 + (y2 - y1) * Math.min(1, k * 1.25),
        (w || 3) * (t >= lockAt ? 1.8 : 1), c[0], c[1], c[2], a);
    },
    telegraphCircle: function (x, y, r, t, dur, lockAt, col) {
      if (En.telegraphScale !== 1) { dur = En._scaleT(dur); lockAt = En._scaleT(lockAt); }
      En._cue(t, dur, lockAt, x, y);
      var c = col || En.telegraphColor(t, lockAt);
      var a = En.telegraphPulse(t, lockAt);
      var k = M.clamp01(t / Math.max(0.001, lockAt));
      NA.R.ring(NA.R.L.VEIL, x, y, r, 3, c[0], c[1], c[2], a);
      NA.R.disc(NA.R.L.VEIL, x, y, r * k, c[0], c[1], c[2], 0.20 * a);
    },
    telegraphArrow: function (x, y, ang, len, t, dur, lockAt, col) {
      if (En.telegraphScale !== 1) { dur = En._scaleT(dur); lockAt = En._scaleT(lockAt); }
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
      // Phase Fog conceals as hard as a sweep reveals
      if (NA.Events && NA.Events.hasConcealField) a *= 1 - NA.Events.concealAt(P.x[i], P.y[i]);
      if (P.hitT[i] > 0) a = Math.max(a, 0.9);                       // damage reveals 0.3s
      var d2 = M.dist2(P.x[i], P.y[i], NA.Player.x, NA.Player.y);
      if (d2 < 3600) a = Math.max(a, 0.35 * (1 - d2 / 3600));        // shimmer within 60px
      return a;
    },

    /* -------------------------------------------------------------- update */
    update: function (dt) {
      var g = En.grid;
      if (En._qn > 0) En.drainBlasts();  // nothing survives into the next step
      En.domes.length = 0;               // owners re-register during this pass
      g.begin();
      var i;
      for (i = 0; i < P.n; i++) g.insert(i, P.x[i], P.y[i]);

      var mods = NA.Player.mods;
      var fm = mods ? mods.enemyFireMul : 1;
      En.fireMul = (fm > 0) ? fm : 1;

      var px = NA.Player.x, py = NA.Player.y, alive = NA.Player.alive;
      var parity = NA.Time.frames & 1;

      /* Star Shadow: inside the shadow band enemies cannot SEE you, so for the
       * whole enemy pass the ship's apparent position is the last one they had.
       * Swapping it on NA.Player (and restoring below) is what lets every
       * seeker and shooter in 10b/10c obey the rule without knowing it exists. */
      var hid = (NA.Events && NA.Events.hasHiddenField) ? NA.Events.hiddenAt(px, py) : 0;
      var swapped = false, realX = px, realY = py;
      if (hid > 0.5 && alive) {
        px = En._seenX; py = En._seenY;
        NA.Player.x = px; NA.Player.y = py;
        swapped = true;
      } else { En._seenX = px; En._seenY = py; }

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

        /* d.update may kill its own row (a Bloat detonating, a Popper). The
         * swap-remove moves the LAST entity into slot i; integrating here would
         * run that one twice this frame, clamp it with the wrong type and give
         * it a second contact-damage roll. Stamp, bail, redo the slot. */
        var ug = P.gen[i];
        if (d.update) d.update(i, dt);
        if (i >= P.n || P.gen[i] !== ug) { i--; continue; }

        capSpeed(i);
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
      if (swapped) { NA.Player.x = realX; NA.Player.y = realY; }
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
        else if (P.flags[i] & 1) { cr = 0.55; cg = 0.58; cb = 0.65; }   // HUSK: risen, grey

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
        // off-white: 10.1 keeps pure white off enemies
        if (P.mut[i] && !En.mutRim) R.poly(L.ENEMIES, P.x[i], P.y[i], sz * 1.35, 4, P.rot[i] * -0.6, 1.2, 0.85, 0.88, 0.96, a * 0.35);
      }
    }
  };

  // expose the SoA arrays directly (the brief's contract: NA.Enemies.x[i])
  for (var k in P) if (P[k] && P[k].BYTES_PER_ELEMENT) En[k] = P[k];

  // scratch for one drain pass of the deferred blast queue (never allocated
  // per frame; the queue is capped at 64 entries)
  var PASSX = new Float32Array(64), PASSY = new Float32Array(64);
  var PASSR = new Float32Array(64), PASSA = new Float32Array(64), PASSS = [];

  var TELEGRAPH_MIN = 0.4;             // GAME_PLAN 12.8: every hit gets 0.4 s
  var KCTX = { x: 0, y: 0, ei: 0, type: 0 };
  var TC = [1, 0.541, 0];

  /* Hard runaway cap on one row's velocity.
   *
   * Nothing in the game authors an enemy faster than the Charger Elite's
   * 1180 u/s dash, so a row moving faster than VMAX is an accumulator that got
   * away — a field that ADDS velocity every step instead of blending towards
   * one. That happened for real (the Rotator's rotating floor), and the shape
   * of the failure is nasty: the affected enemies get flung onto the rim,
   * clampToArena kills only the RADIAL component, and they orbit the boundary
   * at several km/s, faster than any lead can track. The last one alive then
   * ends the run, because a wave finishes on kills and never on a timer.
   * One squared compare per enemy per frame makes that survivable wherever
   * the runaway comes from. */
  var VMAX = 1800, VMAX2 = VMAX * VMAX;
  function capSpeed(i) {
    var v2 = P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i];
    if (v2 <= VMAX2) return;
    var s = VMAX / Math.sqrt(v2);
    P.vx[i] *= s; P.vy[i] *= s;
  }

  /* Hard boundary clamp for one SoA row (enemies never leave the ring). */
  function clampToArena(i) {
    var dx = P.x[i] - NA.Arena.cx, dy = P.y[i] - NA.Arena.cy;
    var d2 = dx * dx + dy * dy;
    // deep inside the smallest boundary radius: no atan2, no radiusAt
    var inner = NA.Arena.minRadius - P.size[i];
    if (inner > 0 && d2 < inner * inner) return;
    var d = Math.sqrt(d2);
    if (d < 1e-4) return;
    var edge = NA.Arena.radiusAt(Math.atan2(dy, dx)) - P.size[i];
    if (d <= edge) return;
    var nx = dx / d, ny = dy / d;
    P.x[i] = NA.Arena.cx + nx * edge; P.y[i] = NA.Arena.cy + ny * edge;
    var vn = P.vx[i] * nx + P.vy[i] * ny;
    if (vn > 0) { P.vx[i] -= nx * vn; P.vy[i] -= ny * vn; }
  }

  /* Pacing pass (owner request): every NON-BOSS enemy is a little bigger, so
   * it is easier to hit at the wider camera, and a little faster, so waves
   * come to you instead of being chased.  One funnel, so it covers all 42
   * enemy defs plus anything a boss spawns as a minion.  Bosses have their own
   * registry (13_bosses.js) and are untouched. */
  var SIZE_MUL = 1.25, SPEED_MUL = 1.12;

  function normalize(id, def) {
    var d = def || {};
    return {
      id: id,
      shape: d.shape || 'circle',
      color: d.color || C.COL.white,
      size: (d.size || 12) * SIZE_MUL,
      hp: d.hp || 10,
      speed: (d.speed || 100) * SPEED_MUL,
      cost: d.cost || 1,
      band: d.band || 'A',
      retireWave: d.retireWave || 0,
      cap: d.cap || 0,
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
    size: 11, hp: 10, speed: 92, cost: 1, band: 'A', retireWave: 10,
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
  var SPIT_PERIOD = 2.2, SPIT_TELL = 0.4, SPIT_SPEED = 130;   // 12.8 telegraph floor
  En.define('spitter', {
    shape: 'tri', color: C.COL.yellow,
    size: 14, hp: 20, speed: 130, cost: 3, band: 'A', retireWave: 10,
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
      if (P.p0[i] >= SPIT_PERIOD * En.fireMul) {
        P.p0[i] = 0;
        var sp = 430;
        NA.Bullets.fireEnemy(P.x[i] + tx * 18, P.y[i] + ty * 18, tx * sp, ty * sp, {
          size: 8, life: 4.5, color: C.COL.yellow, owner: 1, dmg: 1,
          flags: NA.Bullets.FLAG.ENEMYHURT
        });
        if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: P.x[i], y: P.y[i], vol: 0.4 });
      }
    },
    render: function (i, a, cr, cg, cb) {
      var R = NA.R, L = R.L;
      var sz = P.size[i] * (P.flash[i] > 0 ? 1.25 : 1);
      // the eye brightens 300ms before it fires
      var per = SPIT_PERIOD * En.fireMul;
      var tell = M.clamp01((P.p0[i] - (per - SPIT_TELL)) / SPIT_TELL);
      R.sprite(L.ENEMIES, 'tri', P.x[i], P.y[i], P.rot[i], sz, sz, cr, cg, cb, a);
      R.dot(L.ENEMIES, P.x[i], P.y[i], sz * (0.2 + tell * 0.2), 1, M.lerp(0.85, 0.3, tell), M.lerp(0.3, 0.2, tell), a * (0.6 + tell * 0.4));
    }
  });
})();
