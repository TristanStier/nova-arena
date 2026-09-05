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
 * ======================================================= ENEMY STATUSES ====
 * Six SoA fields are added to the enemy pool AT RUNTIME by H.addEnemyField()
 * (NA.Pool drives alloc/free off pool._fields, so they are zeroed on spawn and
 * swap-removed correctly).  No foundation file was edited to get them:
 *   charged  f32  Voltaic's Charged status, seconds (+30% damage taken)
 *   stun     f32  movement-damp stun, seconds
 *   rwx rwy  f32  Chrono's rewind anchor (position at Chrono start)
 *   burn     f32  Burn status, seconds     burnDps  f32  its damage per second
 * They are readable as NA.Enemies.charged[i] etc., and via H.enemyStatus.
 *
 * ========================================================== KEY BINDINGS ====
 *   fire   hold           Railgun charges; releasing fires the rail.  While the
 *                         coil is winding the primary does not fire (H.preFire).
 *   dash   press          Blink REPLACES the dash; Afterburner re-prices it
 *   active tap            the tap actives, round-robin (Pulse, and B's)
 *   active hold           Overdrive (while firing) / Chrono (while not) /
 *                         Pulse charge when neither of those is owned
 *
 * ============================================================ DEV PARAM ====
 *   ?upg=blast:3,ricochet:2   applies those tiers once, at boot.
 *   tools/test.js --upg=...   forwards it to the browser harness.
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
      if (!NA.Player) { U._rebuildHooks(); return; }
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
      U._rebuildHooks();
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

    /* ------------------------------------------------------- hook arrays
     * emit/update/render used to run a for-in over a dictionary-mode object
     * plus a string-keyed miss per owned tier — once per BULLET HIT.  The
     * owned set only changes on take()/reset()/reapply(), so the dispatch
     * lists are flattened there and the hot path is a plain index loop over
     * 0-3 monomorphic functions (perf review #6).
     * The loops re-read .length every step because a handler may take an
     * upgrade mid-emit (Gambler), which rebuilds these arrays in place. */
    _hooks: { onFire: [], onHit: [], onKill: [], onDash: [], onSpend: [] },
    _updates: [], _renders: [],

    _rebuildHooks: function () {
      var hk = U._hooks, k;
      for (k in hk) hk[k].length = 0;
      U._updates.length = 0; U._renders.length = 0;
      for (var id in U.owned) {
        var lvl = U.owned[id]; if (!lvl) continue;
        var d = defs[id]; if (!d) continue;
        for (var t = 0; t < lvl; t++) {
          var td = d.tiers[t]; if (!td) continue;
          for (k in hk) if (td[k]) hk[k].push(td[k]);
          if (td.update) U._updates.push(td.update);
          if (td.render) U._renders.push(td.render);
        }
      }
    },

    emit: function (hook, ctx) {
      var a = U._hooks[hook]; if (!a) return;
      for (var i = 0; i < a.length; i++) { var fn = a[i]; if (fn) fn(ctx); }
    },

    update: function (dt) {
      if (!U._devDone) { U._devDone = true; applyDevParam(); }
      U.restoreStatics();
      if (U.helpers) U.helpers._preUpdate(dt);
      var a = U._updates;
      for (var i = 0; i < a.length; i++) { var fn = a[i]; if (fn) fn(dt); }
      if (U.helpers) U.helpers._postUpdate(dt);
    },
    render: function () {
      var a = U._renders;
      for (var i = 0; i < a.length; i++) { var fn = a[i]; if (fn) fn(); }
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
  /* Grid query, not a full scan (perf review #5).  Own destination buffers,
   * never grid.out/out2: this walks its results WHILE killing, and both the
   * enemy pass and any onKill callback may query the same grid underneath us.
   * Descending order keeps the swap-remove from hiding a body behind a kill. */
  var AREA_A = new Int32Array(1024), AREA_B = new Int32Array(1024), areaDepth = 0;
  function damageArea(x, y, r, dmg, src, onKill) {
    var E = NA.Enemies; if (!E || !E.n) return 0;
    var r2 = r * r, kills = 0, i, dx, dy;
    if (areaDepth >= 2) {                       // deep chain: plain scan, no buffer
      for (i = E.n - 1; i >= 0; i--) {
        if (i >= E.n) continue;
        dx = E.x[i] - x; dy = E.y[i] - y;
        if (dx * dx + dy * dy > r2) continue;
        var ex0 = E.x[i], ey0 = E.y[i];
        if (damageEnemy(i, dmg, src || 'player')) { kills++; if (onKill) onKill(ex0, ey0); }
      }
      return kills;
    }
    var dst = areaDepth === 0 ? AREA_A : AREA_B;
    areaDepth++;
    var cnt = E.grid.query(x, y, r, dst);
    for (var q = cnt - 1; q >= 0; q--) {
      i = dst[q];
      if (i >= E.n) continue;
      dx = E.x[i] - x; dy = E.y[i] - y;
      if (dx * dx + dy * dy > r2) continue;
      var ex = E.x[i], ey = E.y[i];
      if (damageEnemy(i, dmg, src || 'player')) {
        kills++;
        if (onKill) onKill(ex, ey);
      }
    }
    areaDepth--;
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
      return NA.Player.spend(whole, k);     // whole mana only, so onSpend fires
    }
    return true;                            // sub-mana slice: banked, not spent yet
  }

  /* ---- the active key ---------------------------------------------------- */
  var heldT = 0, wasDown = false, pressedFlag = false, releasedFlag = false, releaseHeld = 0;
  // NOTE: right mouse is the DASH button in NA.Input, so the active key is
  // strictly 'active' (E / middle mouse / gamepad).
  function activeDown() { return NA.Input.isDown('active'); }
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
        // H.preFire may VETO the primary (Railgun charges on the fire button,
        // so holding to charge has to stop the stream — GAME_PLAN 6 #2).
        var pf = H.preFire;
        if (pf && !force && pf() === false) return;
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
    preDash: null, postDash: null, preFire: null,

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
      H.preDash = null; H.postDash = null; H.preFire = null;
      heldT = 0; wasDown = false;
    }
  };

  U.onReset(H._resetState);
  H._install();          // wrap fire/dash now, so frame 1 already behaves

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

/* ==========================================================================
 * HELPER LIBRARY, PART 2 — bullet flag registry, the Burn status, area push.
 * Also shared with src/11b_upgrades_b.js.
 *
 *   H.FLAG          extra player-bullet flag bits, ABOVE NA.Bullets.FLAG's six.
 *                   RETURN BUCKSHOT ARCANE PHASED SEEK NOSPLIT OD CHRONO
 *                   USER1 USER2 USER3 USER4   (B: take the USERn bits)
 *   H.setBurn(ei, secs, dps) / H.isBurning(ei)   damage-over-time status.
 *   H.pushArea(x, y, radius, force, slamDmg)     radial knockback; enemies slammed
 *                   into the membrane take slamDmg (0 = off).  -> pushed count
 *   H.explodePush   set to a force to make every H.explode() push (Blast T3).
 *   H.explodeSlam   slam damage that goes with it.
 *
 * NOTE ON REPURPOSED PLAYER-BULLET FIELDS (NA.Bullets.P):
 *   `hitCd`   — unused by the foundation for player bullets; Ricochet stores its
 *               bounce count there.
 *   `maxLife` — unused by the foundation for player bullets; Ricochet stores the
 *               bounce count it expects, to detect membrane bounces.
 * Nothing else may write those two fields on P.
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, H = U.helpers, M = NA.M;

  H.FLAG = {
    RETURN: 256, BUCKSHOT: 512, ARCANE: 1024, PHASED: 2048, SEEK: 4096,
    NOSPLIT: 8192, OD: 16384, CHRONO: 32768,
    USER1: 65536, USER2: 131072, USER3: 262144, USER4: 524288
  };

  var burn = H.addEnemyField('burn', 'f32');
  var burnDps = H.addEnemyField('burnDps', 'f32');
  H.enemyStatus.burn = burn;
  H.enemyStatus.burnDps = burnDps;

  H.setBurn = function (ei, secs, dps) {
    if (!burn || ei < 0 || ei >= NA.Enemies.n) return;
    burn[ei] = Math.max(burn[ei], secs);
    burnDps[ei] = Math.max(burnDps[ei], dps);
  };
  H.isBurning = function (ei) { return burn && ei >= 0 && burn[ei] > 0; };

  var burnAcc = 0;
  function tickBurn(dt) {
    var E = NA.Enemies; if (!E || !E.n) return;
    burnAcc += dt;
    var tick = burnAcc >= 0.25;
    if (tick) burnAcc = 0;
    for (var i = 0; i < E.n; i++) {
      if (burn[i] <= 0) continue;
      burn[i] -= dt;
      if (tick) {
        if (NA.RNG.f() < 0.5)
          NA.Particles.spawn(E.x[i], E.y[i], (NA.RNG.f() - 0.5) * 30, -40 - NA.RNG.f() * 40,
            0.3, 3, 1, 0.541, 0, 0.8, 0, 1.5);
        if (H.damageEnemy(i, burnDps[i] * 0.25, 'player')) i--;
      }
    }
  }

  H.pushArea = function (x, y, radius, force, slamDmg) {
    var E = NA.Enemies; if (!E || !E.n) return 0;
    var cnt = E.grid.query(x, y, radius), out = E.grid.out, n = 0;
    for (var q = 0; q < cnt; q++) {
      var i = out[q]; if (i >= E.n) continue;
      var dx = E.x[i] - x, dy = E.y[i] - y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > radius) continue;
      var k = (1 - d / radius) * force;
      E.vx[i] += dx / d * k; E.vy[i] += dy / d * k;
      n++;
      // slammed into the membrane?
      if (slamDmg > 0) {
        var nx = E.x[i] + dx / d * k * 0.08, ny = E.y[i] + dy / d * k * 0.08;
        if (NA.Arena.depth(nx, ny) < E.size[i]) {
          NA.Arena.ripple(nx, ny, 0.5, 1, 0.541, 0);
          if (H.damageEnemy(i, slamDmg, 'player')) { /* swap-remove: the grid list is stale, fine */ }
        }
      }
    }
    return n;
  };
  H.explodePush = 0;
  H.explodeSlam = 0;

  // fold burn + explode-push into the shared update without touching part 1
  var origPre = H._preUpdate;
  H._preUpdate = function (dt) { origPre(dt); tickBurn(dt); };

  var origExplode = H.explode;
  H.explode = function (x, y, radius, dmg, src, hop) {
    var k = origExplode(x, y, radius, dmg, src, hop);
    if (H.explodePush > 0 && !(src === 1 || src === 'enemy'))
      H.pushArea(x, y, radius * 1.15, H.explodePush, H.explodeSlam);
    return k;
  };

  U.onReset(function () { H.explodePush = 0; H.explodeSlam = 0; });

  H.renderBurning = function () {
    var E = NA.Enemies; if (!E || !E.n) return;
    var R = NA.R, L = R.L, t = NA.Time.t;
    for (var i = 0; i < E.n; i++) {
      if (burn[i] <= 0) continue;
      R.ring(L.PARTICLES, E.x[i], E.y[i], E.size[i] * 1.3 + Math.sin(t * 12 + i) * 2, 1.2,
        1, 0.541, 0, 0.4 * M.clamp01(burn[i]));
    }
  };
})();

/* ==========================================================================
 * A. WEAPONS — 1 Twin Barrels · 2 Railgun · 3 Buckshot · 4 Mortar · 5 Gatling
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, H = U.helpers, M = NA.M, C = NA.C, F = H.FLAG;
  var PB = NA.Bullets.P;
  var CY = C.COL.player, OR = C.COL.orange, GO = C.COL.gold;

  function slot(name, tier) { if (NA.Ship) NA.Ship.setSlot(name, Math.max(NA.Ship.getSlot(name), tier)); }

  /* ------------------------------------------------------------ 1. TWIN */
  var twinSide = 0, twinConverge = false, twinRear = false;
  function twinParallel(bi) {
    // lateral offset so the pair flies parallel instead of as a cone
    var a = PB.rot[bi] + M.HALFPI;
    var s = (twinSide++ & 1) ? 1 : -1;
    PB.x[bi] += Math.cos(a) * 9 * s; PB.y[bi] += Math.sin(a) * 9 * s;
    if (twinConverge) {
      // ...and both barrels are re-aimed at the reticle, so they cross there
      var tx = NA.Player.aimX - PB.x[bi], ty = NA.Player.aimY - PB.y[bi];
      var l = Math.sqrt(tx * tx + ty * ty) || 1;
      var sp = Math.sqrt(PB.vx[bi] * PB.vx[bi] + PB.vy[bi] * PB.vy[bi]);
      PB.vx[bi] = tx / l * sp; PB.vy[bi] = ty / l * sp;
      PB.rot[bi] = Math.atan2(PB.vy[bi], PB.vx[bi]);
    }
  }
  U.define('twinBarrels', {
    family: 'weapon', tags: ['explode', 'bounce'], wild: false,
    visual: { slot: 'barrels' },
    tiers: [
      { // T1 — two parallel bullets at 75%
        apply: function (p) { U.mods.count += 1; U.mods.damage *= 0.75; },
        onFire: function () { twinSide = 0; H.lastVolley(twinParallel); }
      },
      { // T2 — the barrels alternate and converge at cursor distance
        apply: function () { twinConverge = true; },
        render: function () {
          var p = NA.Player;
          if (!p.alive) return;
          NA.R.line(NA.R.L.AFTER, p.x, p.y, p.aimX, p.aimY, 0.8, CY[0], CY[1], CY[2], 0.10);
        }
      },
      { // T3 — a rear-facing pair fires behind you at 50%
        apply: function () { twinRear = true; },
        onFire: function (ctx) {
          var a = ctx.angle + Math.PI, p = NA.Player;
          var bx = p.x - Math.cos(ctx.angle) * C.SHIP_R, by = p.y - Math.sin(ctx.angle) * C.SHIP_R;
          H.fireBullet(bx, by, a + 0.10, { dmgMul: 0.5, size: NA.Player.stats.bulletSize * 0.8 });
          H.fireBullet(bx, by, a - 0.10, { dmgMul: 0.5, size: NA.Player.stats.bulletSize * 0.8 });
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle + Math.PI;
          for (var s = -1; s <= 1; s += 2) {
            var bx = p.x + Math.cos(a + s * 0.5) * C.SHIP_R * 1.1, by = p.y + Math.sin(a + s * 0.5) * C.SHIP_R * 1.1;
            NA.R.line(NA.R.L.PLAYER, bx, by, bx + Math.cos(a) * 9, by + Math.sin(a) * 9, 2, CY[0], CY[1], CY[2], 0.8);
          }
        }
      }
    ]
  });

  /* --------------------------------------------------------- 2. RAILGUN */
  var railCharge = 0, railTier = 0, railFired = 0;
  var RAILS = 6;
  var rx1 = new Float32Array(RAILS), ry1 = new Float32Array(RAILS);
  var rx2 = new Float32Array(RAILS), ry2 = new Float32Array(RAILS);
  var rlife = new Float32Array(RAILS), rtick = new Float32Array(RAILS);
  var pullX = 0, pullY = 0, pullA = 0, pullT = 0;

  function addRail(x1, y1, x2, y2) {
    var slotI = -1, worst = 1e9;
    for (var i = 0; i < RAILS; i++) { if (rlife[i] < worst) { worst = rlife[i]; slotI = i; } }
    rx1[slotI] = x1; ry1[slotI] = y1; rx2[slotI] = x2; ry2[slotI] = y2;
    rlife[slotI] = 2.4; rtick[slotI] = 0;
  }
  function fireRail(ang, k, spawnRail) {
    var p = NA.Player;
    var mx = p.x + Math.cos(ang) * C.SHIP_R * 2, my = p.y + Math.sin(ang) * C.SHIP_R * 2;
    H.fireBullet(mx, my, ang, {
      speed: 3200, dmgMul: 1.6 + 2.4 * k, size: 9 + 7 * k,
      pierce: 999, life: 0.55, r: 0.6, g: 0.95, b: 1
    });
    NA.Particles.bolt(mx, my, mx + Math.cos(ang) * 900, my + Math.sin(ang) * 900, 0.18, 6, 0.6, 0.95, 1, 2 + k * 2);
    NA.FX.trauma(0.06 + k * 0.12);
    NA.FX.chroma(1.5 + k, 120);
    if (NA.Audio) NA.Audio.sfx('rail', { x: p.x, y: p.y });
    if (spawnRail) addRail(mx, my, mx + Math.cos(ang) * 1500, my + Math.sin(ang) * 1500);
  }
  /* F17 — vetoes NA.Player.fire() while the rail is charging. */
  function railPreFire() { return !(railTier > 0 && railCharge > 0.02); }
  function railRelease() {
    var k = M.clamp01(railCharge / 1.0);
    if (k < 0.35) { railCharge = 0; return; }
    var p = NA.Player;
    if (railTier >= 3 && k > 0.95) {
      // T3 — two rails in a V, with a pull field between them
      fireRail(p.angle + 0.20, k, railTier >= 2);
      fireRail(p.angle - 0.20, k, railTier >= 2);
      pullX = p.x; pullY = p.y; pullA = p.angle; pullT = 1.3;
    } else {
      fireRail(p.angle, k, railTier >= 2);
    }
    railFired = 0.18;
    railCharge = 0;
  }
  U.define('railgun', {
    family: 'weapon', tags: ['pierce', 'mana', 'zone'], wild: false,
    visual: { slot: 'barrels' },
    tiers: [
      { // T1 — hold FIRE to charge a piercing line.  While the coil is winding
        // up the primary is OFF: the trade is "stop shooting to charge".
        apply: function () { railTier = Math.max(railTier, 1); H.preFire = railPreFire; },
        update: function (dt) {
          if (!H.combat() || !NA.Player.alive) { railCharge = 0; return; }
          if (railFired > 0) railFired -= dt;
          var holding = NA.Input.isDown('fire');
          if (holding) {
            var was = railCharge;
            railCharge = Math.min(1, railCharge + dt);
            if (was < 1 && railCharge >= 1 && NA.Audio) NA.Audio.sfx('charge', { x: NA.Player.x, y: NA.Player.y });
            // the coil cannot hold a full charge: keeping the button down is a
            // rail a second, never a dead trigger (the primary is off meanwhile)
            if (railCharge >= 1) railRelease();
          } else if (railCharge > 0) railRelease();
        },
        render: function () {
          if (railCharge <= 0.02) return;
          var p = NA.Player, k = M.clamp01(railCharge);
          // charge coil: two counter-rotating rings tightening onto the muzzle
          var mx = p.x + Math.cos(p.angle) * C.SHIP_R * 2.1, my = p.y + Math.sin(p.angle) * C.SHIP_R * 2.1;
          NA.R.ring(NA.R.L.PLAYER, mx, my, 22 - k * 13, 1.6, 0.6, 0.95, 1, 0.35 + k * 0.5);
          NA.R.ring(NA.R.L.PLAYER, mx, my, 30 - k * 17, 1.2, 0.6, 0.95, 1, 0.20 + k * 0.4);
          NA.R.dot(NA.R.L.PLAYER, mx, my, 2 + k * 4, 0.78, 0.97, 1, 0.4 + k * 0.45);
          if (k >= 1) NA.R.line(NA.R.L.AFTER, p.x, p.y, p.x + Math.cos(p.angle) * 700,
            p.y + Math.sin(p.angle) * 700, 1, 0.6, 0.95, 1, 0.13);
        }
      },
      { // T2 — the shot leaves a lingering rail that damages crossers
        apply: function () { railTier = Math.max(railTier, 2); },
        update: function (dt) {
          var E = NA.Enemies;
          for (var i = 0; i < RAILS; i++) {
            if (rlife[i] <= 0) continue;
            rlife[i] -= dt; rtick[i] -= dt;
            if (rtick[i] > 0 || !E || !E.n) continue;
            rtick[i] = 0.22;
            var ax = rx1[i], ay = ry1[i], bx = rx2[i] - ax, by = ry2[i] - ay;
            var len2 = bx * bx + by * by || 1;
            for (var e = 0; e < E.n; e++) {
              var px = E.x[e] - ax, py = E.y[e] - ay;
              var t = (px * bx + py * by) / len2;
              if (t < 0 || t > 1) continue;
              var cx = px - bx * t, cy = py - by * t;
              var rr = E.size[e] + 10;
              if (cx * cx + cy * cy > rr * rr) continue;
              if (H.damageEnemy(e, NA.Player.stats.damage * 0.5, 'player')) e--;
            }
          }
        },
        render: function () {
          for (var i = 0; i < RAILS; i++) {
            if (rlife[i] <= 0) continue;
            var a = M.clamp01(rlife[i] / 2.4);
            NA.R.line(NA.R.L.PBULLETS, rx1[i], ry1[i], rx2[i], ry2[i], 2 + a * 2, 0.6, 0.95, 1, a * 0.5);
          }
        }
      },
      { // T3 — a full charge fires a V and pulls everything between the rails in
        apply: function () { railTier = 3; },
        update: function (dt) {
          if (pullT <= 0) return;
          pullT -= dt;
          var E = NA.Enemies; if (!E || !E.n) return;
          for (var i = 0; i < E.n; i++) {
            var dx = E.x[i] - pullX, dy = E.y[i] - pullY;
            var d2 = dx * dx + dy * dy;
            if (d2 > 900 * 900 || d2 < 100) continue;
            var ang = Math.atan2(dy, dx);
            if (Math.abs(M.norm(ang - pullA)) > 0.55) continue;
            // pull toward the centre line, not toward the ship
            var d = Math.sqrt(d2);
            var lx = pullX + Math.cos(pullA) * d, ly = pullY + Math.sin(pullA) * d;
            var tx = lx - E.x[i], ty = ly - E.y[i];
            var tl = Math.sqrt(tx * tx + ty * ty) || 1;
            E.vx[i] += tx / tl * 900 * dt; E.vy[i] += ty / tl * 900 * dt;
          }
        },
        render: function () {
          if (pullT <= 0) return;
          var a = M.clamp01(pullT) * 0.45;
          for (var s = -1; s <= 1; s += 2) {
            NA.R.line(NA.R.L.PBULLETS, pullX, pullY,
              pullX + Math.cos(pullA + s * 0.20) * 1200, pullY + Math.sin(pullA + s * 0.20) * 1200,
              2, 0.6, 0.95, 1, a);
          }
          for (var k = 1; k <= 5; k++) {
            var d = k * 180;
            NA.R.ring(NA.R.L.PBULLETS, pullX + Math.cos(pullA) * d, pullY + Math.sin(pullA) * d,
              14 + Math.sin(NA.Time.t * 6 + k) * 5, 1.2, 0.6, 0.95, 1, a * 0.7);
          }
        }
      }
    ]
  });

  /* -------------------------------------------------------- 3. BUCKSHOT */
  var buckHang = false, buckReloadCd = 0;
  function markBuck(bi) { PB.flags[bi] |= F.BUCKSHOT; }
  U.define('buckshot', {
    family: 'weapon', tags: ['explode', 'zone', 'dash'], wild: false,
    visual: { slot: 'barrels' },
    tiers: [
      { // T1 — a 5-pellet cone
        apply: function () {
          U.mods.count += 4; U.mods.spread += 0.19; U.mods.damage *= 0.42;
          U.mods.life *= 0.75; U.mods.size *= 0.85;
        },
        onFire: function () { H.lastVolley(markBuck); }
      },
      { // T2 — pellets at max range hang as sparks, then fall back toward you
        apply: function () { buckHang = true; },
        update: function (dt) {
          var p = NA.Player;
          for (var i = 0; i < PB.n; i++) {
            if (!(PB.flags[i] & F.BUCKSHOT)) continue;
            if (PB.life[i] > 0.14) continue;
            PB.flags[i] &= ~F.BUCKSHOT;
            PB.flags[i] |= F.RETURN;
            var dx = p.x - PB.x[i], dy = p.y - PB.y[i];
            var l = Math.sqrt(dx * dx + dy * dy) || 1;
            var sp = NA.Player.stats.bulletSpeed * 0.7;
            PB.vx[i] = dx / l * sp; PB.vy[i] = dy / l * sp;
            PB.rot[i] = Math.atan2(PB.vy[i], PB.vx[i]);
            PB.life[i] = 0.9;
            NA.Particles.spawn(PB.x[i], PB.y[i], 0, 0, 0.25, 3, 1, 0.847, 0.302, 0.9, 0, 2);
          }
        }
      },
      { // T3 — a point-blank kill racks the slide: one instant free shot
        update: function (dt) { if (buckReloadCd > 0) buckReloadCd -= dt; },
        onKill: function (ctx) {
          if (buckReloadCd > 0) return;
          var p = NA.Player;
          if (M.dist2(ctx.x, ctx.y, p.x, p.y) > 190 * 190) return;
          buckReloadCd = 0.12;
          p.fire(true);
          NA.Particles.ring(p.x, p.y, 6, 34, 0.2, 2, 1, 0.847, 0.302, 0.9);
          if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: p.x, y: p.y, vol: 0.5 });
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // pump-action slide, racked for a moment after a point-blank kill
          var k = M.clamp01(buckReloadCd / 0.12);
          var a = p.angle;
          var bx = p.x + Math.cos(a) * (C.SHIP_R * (1.4 - k * 0.5));
          var by = p.y + Math.sin(a) * (C.SHIP_R * (1.4 - k * 0.5));
          NA.R.line(NA.R.L.PLAYER, bx, by, bx + Math.cos(a) * 7, by + Math.sin(a) * 7, 3.4, GO[0], GO[1], GO[2], 0.55 + k * 0.45);
        }
      }
    ]
  });

  /* ---------------------------------------------------------- 4. MORTAR */
  var SH = 10;
  var shx = new Float32Array(SH), shy = new Float32Array(SH);
  var sh0x = new Float32Array(SH), sh0y = new Float32Array(SH);
  var shtx = new Float32Array(SH), shty = new Float32Array(SH);
  var sht = new Float32Array(SH), shdur = new Float32Array(SH);
  var shsplit = new Uint8Array(SH), shlive = new Uint8Array(SH);
  var CR = 8;
  var crx = new Float32Array(CR), cry = new Float32Array(CR), crt = new Float32Array(CR);
  var shotCount = 0, mortarTier = 0;

  function addShell(x, y, tx, ty, canSplit) {
    for (var i = 0; i < SH; i++) {
      if (shlive[i]) continue;
      shlive[i] = 1; sh0x[i] = shx[i] = x; sh0y[i] = shy[i] = y;
      shtx[i] = tx; shty[i] = ty; sht[i] = 0;
      shdur[i] = M.clamp(M.dist(x, y, tx, ty) / 900, 0.45, 1.1);
      shsplit[i] = canSplit ? 1 : 0;
      return i;
    }
    return -1;
  }
  function addCrater(x, y) {
    var slotI = 0, worst = 1e9;
    for (var i = 0; i < CR; i++) if (crt[i] < worst) { worst = crt[i]; slotI = i; }
    crx[slotI] = x; cry[slotI] = y; crt[slotI] = 2.0;
  }
  U.define('mortar', {
    family: 'weapon', tags: ['explode', 'zone'], wild: false,
    visual: { slot: 'barrels' },
    tiers: [
      { // T1 — every 4th shot lobs a shell that bursts at the reticle
        apply: function () { mortarTier = Math.max(mortarTier, 1); },
        onFire: function (ctx) {
          if ((++shotCount % 4) !== 0) return;
          addShell(ctx.x, ctx.y, NA.Player.aimX, NA.Player.aimY, mortarTier >= 2);
          if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: ctx.x, y: ctx.y, vol: 0.45 });
        },
        update: function (dt) {
          for (var i = 0; i < SH; i++) {
            if (!shlive[i]) continue;
            sht[i] += dt;
            var k = M.clamp01(sht[i] / shdur[i]);
            shx[i] = M.lerp(sh0x[i], shtx[i], k);
            shy[i] = M.lerp(sh0y[i], shty[i], k);
            if (shsplit[i] && k >= 0.5) {           // T2 apex split
              shsplit[i] = 0;
              for (var s = -1; s <= 1; s += 2) {
                var a = Math.atan2(shty[i] - sh0y[i], shtx[i] - sh0x[i]) + s * 0.5;
                addShell(shx[i], shy[i], shx[i] + Math.cos(a) * 220, shy[i] + Math.sin(a) * 220, false);
              }
              NA.Particles.burst(shx[i], shy[i], 5, 160, 0.24, 1, 0.541, 0, 1);
            }
            // the fall telegraph: a growing ring under the impact point
            NA.Enemies.telegraphCircle(shtx[i], shty[i], 108, sht[i], shdur[i], shdur[i] * 0.75);
            if (k >= 1) {
              shlive[i] = 0;
              H.queueExplode(shtx[i], shty[i], 108, NA.Player.stats.damage * 1.7, 0, 0);
              if (mortarTier >= 3) addCrater(shtx[i], shty[i]);
            }
          }
        },
        render: function () {
          for (var i = 0; i < SH; i++) {
            if (!shlive[i]) continue;
            var k = M.clamp01(sht[i] / shdur[i]);
            var lift = Math.sin(k * Math.PI) * 26;
            NA.R.sprite(NA.R.L.PBULLETS, 'diamond', shx[i], shy[i] - lift, sht[i] * 9, 8, 8, 1, 0.541, 0, 1);
            NA.R.dot(NA.R.L.PBULLETS, shx[i], shy[i] - lift, 3, 1, 1, 1, 0.8);
            NA.R.disc(NA.R.L.FLOOR, shx[i], shy[i], 7, 0, 0, 0, 0.35);
          }
        }
      },
      { // T2 — the shell splits into 3 at its apex
        apply: function () { mortarTier = Math.max(mortarTier, 2); },
        render: function () {   // F21: the triple magazine, three tubes on the spine
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle + Math.PI, t = NA.Time.t;
          var bx = p.x + Math.cos(a) * C.SHIP_R * 0.55, by = p.y + Math.sin(a) * C.SHIP_R * 0.55;
          for (var k = -1; k <= 1; k++) {
            var pa = a + M.HALFPI, ox = Math.cos(pa) * k * 4.6, oy = Math.sin(pa) * k * 4.6;
            NA.R.line(NA.R.L.PLAYER, bx + ox, by + oy,
              bx + ox + Math.cos(a) * C.SHIP_R * 0.85, by + oy + Math.sin(a) * C.SHIP_R * 0.85,
              1.8, 1, 0.541, 0, 0.55);
            NA.R.dot(NA.R.L.PLAYER, bx + ox + Math.cos(a) * C.SHIP_R * 0.85,
              by + oy + Math.sin(a) * C.SHIP_R * 0.85, 1.6, 1, 0.541, 0,
              0.35 + 0.35 * Math.sin(t * 4 + k * 2.1));
          }
        }
      },
      { // T3 — shells leave a 2s crater: slowed, and +40% damage taken
        apply: function () { mortarTier = 3; },
        update: function (dt) {
          var E = NA.Enemies;
          for (var i = 0; i < CR; i++) {
            if (crt[i] <= 0) continue;
            crt[i] -= dt;
            if (!E || !E.n) continue;
            var cnt = E.grid.query(crx[i], cry[i], 108), out = E.grid.out;
            for (var q = 0; q < cnt; q++) {
              var e = out[q]; if (e >= E.n) continue;
              E.vx[e] *= 0.94; E.vy[e] *= 0.94;
            }
          }
        },
        onHit: function (ctx) {
          for (var i = 0; i < CR; i++) {
            if (crt[i] <= 0) continue;
            if (M.dist2(ctx.x, ctx.y, crx[i], cry[i]) > 108 * 108) continue;
            H.damageEnemy(ctx.ei, ctx.dmg * 0.4, 'player');
            return;
          }
        },
        render: function () {
          for (var i = 0; i < CR; i++) {
            if (crt[i] <= 0) continue;
            var a = M.clamp01(crt[i] / 2) * 0.5;
            NA.R.ring(NA.R.L.FLOOR, crx[i], cry[i], 108, 2, 1, 0.541, 0, a);
            NA.R.disc(NA.R.L.FLOOR, crx[i], cry[i], 100, 0.35, 0.12, 0, a * 0.6);
          }
        }
      }
    ]
  });

  /* --------------------------------------------------------- 5. GATLING */
  var spin = 0, gatTier = 0;
  U.define('gatling', {
    family: 'weapon', tags: ['mana', 'spend'], wild: false,
    visual: { slot: 'barrels' },
    tiers: [
      { // T1 — the fire rate ramps to 3x while you hold the trigger
        apply: function () { gatTier = Math.max(gatTier, 1); },
        update: function (dt) {
          var p = NA.Player;
          if (p.firing && p.alive) spin = Math.min(1, spin + dt / 1.6);
          else spin = Math.max(0, spin - dt / 0.7);
          p.stats.fireRate *= 1 + 2 * spin;
        },
        render: function () {
          if (spin <= 0.02) return;
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle, heat = spin * spin;
          for (var b = 0; b < 3; b++) {
            var off = (b - 1) * 0.26;
            var bx = p.x + Math.cos(a + off) * C.SHIP_R * 1.7, by = p.y + Math.sin(a + off) * C.SHIP_R * 1.7;
            NA.R.dot(NA.R.L.PLAYER, bx, by, 2 + heat * 2.4, 1, 0.541 - heat * 0.35, 0.15 * (1 - heat), 0.35 + heat * 0.65);
          }
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * (2.2 + spin * 0.5), 1.2,
            1, 0.541, 0.1, 0.10 + spin * 0.28);
        }
      },
      { // T2 — at full spin the bullets Burn
        apply: function () { gatTier = Math.max(gatTier, 2); },
        onHit: function (ctx) {
          if (spin < 0.95) return;
          H.setBurn(ctx.ei, 2.0, NA.Player.stats.damage * 0.35);
        },
        render: function () { if (spin >= 0.95) H.renderBurning(); }
      },
      { // T3 — at full spin the mana trickle doubles (blue arcs across the barrels)
        apply: function () { gatTier = 3; },
        update: function (dt) { if (spin >= 0.95) NA.Player.stats.manaTrickle *= 2; },
        render: function () {
          if (spin < 0.95) return;
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle;
          for (var k = 0; k < 2; k++) {
            var t = NA.Time.t * 9 + k * 3;
            var x1 = p.x + Math.cos(a - 0.26) * C.SHIP_R * 1.7, y1 = p.y + Math.sin(a - 0.26) * C.SHIP_R * 1.7;
            var x2 = p.x + Math.cos(a + 0.26) * C.SHIP_R * 1.7, y2 = p.y + Math.sin(a + 0.26) * C.SHIP_R * 1.7;
            NA.R.line(NA.R.L.PLAYER, x1, y1, x2, y2, 1.2, CY[0], CY[1], CY[2], 0.3 + 0.3 * Math.sin(t));
          }
        }
      }
    ]
  });

  U.onReset(function () {
    twinSide = 0; twinConverge = false; twinRear = false;
    railCharge = 0; railTier = 0; railFired = 0; pullT = 0;
    for (var i = 0; i < RAILS; i++) rlife[i] = 0;
    buckHang = false; buckReloadCd = 0;
    for (i = 0; i < SH; i++) shlive[i] = 0;
    for (i = 0; i < CR; i++) crt[i] = 0;
    shotCount = 0; mortarTier = 0; spin = 0; gatTier = 0;
  });
})();

/* ==========================================================================
 * B. PROJECTILE MODIFIERS — 6 Blast · 7 Ricochet · 8 Drill · 9 Seeker · 10 Voltaic
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, H = U.helpers, M = NA.M, C = NA.C, F = H.FLAG;
  var PB = NA.Bullets.P;
  var CY = C.COL.player;
  var RICO = 1048576;                 // private bullet flag (see H.FLAG note)

  /* ----------------------------------------------------------- 6. BLAST */
  var blastR = 60, blastChain = false, blastHops = 4;
  function chainCb(x, y, radius, dmg, hop) {
    if (!blastChain || hop >= blastHops) return;
    // radius -20% per hop, at most 4 hops; queued, so the per-frame cap applies
    H.queueExplode(x, y, radius * 0.8, dmg * 0.85, 0, hop + 1);
  }
  U.define('blast', {
    family: 'projectile', tags: ['explode', 'kill'], wild: false,
    visual: { slot: 'core' },
    tiers: [
      { // T1 — bullets explode on hit
        apply: function () { blastR = 60; },
        onHit: function (ctx) {
          H.queueExplode(ctx.x, ctx.y, blastR, ctx.dmg * 0.7, 0, 0);
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // orange nose cap
          NA.R.dot(NA.R.L.PLAYER, p.x + Math.cos(p.angle) * C.SHIP_R * 1.45,
            p.y + Math.sin(p.angle) * C.SHIP_R * 1.45, 2.6, 1, 0.541, 0, 0.9);
        }
      },
      { // T2 — explosion kills chain into more explosions (-20% radius, max 4)
        apply: function () { blastChain = true; H.onExplodeKill = chainCb; },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // ring tattoos, brighter while the chain queue is busy
          var q = M.clamp01(H.queuedExplosions() / 12);
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 1.9, 1.2, 1, 0.541, 0, 0.18 + q * 0.5);
        }
      },
      { // T3 — explosions push, and body/wall slams deal impact damage
        apply: function () {
          blastR = 60;
          H.explodePush = 520;
          H.explodeSlam = 14;
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          var k = 0.5 + 0.5 * Math.sin(NA.Time.t * 3.1);
          // additive glow layer under the ship: L.PLAYER is not additive (F1)
          NA.R.softRing(NA.R.L.PBULLETS, p.x, p.y, C.SHIP_R * (2.6 + k * 0.5), 1, 0.541, 0, 0.10 + k * 0.10);
        }
      }
    ]
  });

  /* -------------------------------------------------------- 7. RICOCHET */
  var ricoEnemy = false, ricoGrow = false;
  function markRico(bi) {
    PB.flags[bi] |= RICO;
    PB.hitCd[bi] = 0;                    // bounce count (see the field note)
    PB.maxLife[bi] = PB.bounce[bi];      // expected bounces, to spot wall hits
  }
  function ricoGrew(bi) {
    PB.hitCd[bi] += 1;
    if (!ricoGrow) return;
    PB.dmg[bi] *= 1.25;
    if (PB.hitCd[bi] <= 6) PB.bounce[bi] += 1;
    // a red comet by the sixth bounce
    var k = M.clamp01(PB.hitCd[bi] / 6);
    PB.r[bi] = 1; PB.g[bi] = 1 - k * 0.82; PB.b[bi] = 1 - k * 0.7;
    PB.size[bi] *= 1.05;
    NA.Particles.burst(PB.x[bi], PB.y[bi], 2, 110, 0.18, 1, 1 - k * 0.8, 1 - k * 0.7, 0);
  }
  U.define('ricochet', {
    family: 'projectile', tags: ['bounce', 'explode'], wild: false,
    visual: { slot: 'fins' },
    tiers: [
      { // T1 — bounce off the walls once (membrane AND mirror walls)
        apply: function () { U.mods.bounce += 1; },
        onFire: function () { H.lastVolley(markRico); },
        update: function (dt) {
          // the membrane bounce is done by NA.Bullets; spot it by the counter drop
          for (var i = 0; i < PB.n; i++) {
            if (!(PB.flags[i] & RICO)) continue;
            if (PB.bounce[i] < PB.maxLife[i]) {
              ricoGrew(i);
              PB.maxLife[i] = PB.bounce[i];
            }
          }
        }
      },
      { // T2 — bounce off enemies toward the nearest other enemy
        apply: function () { ricoEnemy = true; },
        onHit: function (ctx) {
          var bi = ctx.bi;
          if (!(PB.flags[bi] & RICO) || PB.bounce[bi] <= 0) return;
          var t = H.nearestEnemy(PB.x[bi], PB.y[bi], 520, ctx.ei);
          if (t < 0) return;
          PB.bounce[bi] -= 1;
          var E = NA.Enemies;
          var a = Math.atan2(E.y[t] - PB.y[bi], E.x[t] - PB.x[bi]);
          var sp = Math.sqrt(PB.vx[bi] * PB.vx[bi] + PB.vy[bi] * PB.vy[bi]) || NA.Player.stats.bulletSpeed;
          PB.vx[bi] = Math.cos(a) * sp; PB.vy[bi] = Math.sin(a) * sp; PB.rot[bi] = a;
          PB.pierce[bi] = Math.max(PB.pierce[bi], 1);   // survive this hit
          ricoGrew(bi);
          PB.maxLife[bi] = PB.bounce[bi];
          NA.Particles.burst(PB.x[bi], PB.y[bi], 2, 150, 0.16, 1, 1, 1, 0);
        }
      },
      { // T3 — each bounce is +25% damage and +1 bounce, max 6: a red comet
        apply: function () { ricoGrow = true; },
        render: function () {
          for (var i = 0; i < PB.n; i++) {
            if (!(PB.flags[i] & RICO) || PB.hitCd[i] < 3) continue;
            var k = M.clamp01(PB.hitCd[i] / 6);
            NA.R.dot(NA.R.L.PBULLETS, PB.x[i], PB.y[i], PB.size[i] * 1.6, 1, 1 - k * 0.8, 1 - k * 0.7, 0.5);
          }
        }
      }
    ]
  });

  /* ----------------------------------------------------------- 8. DRILL */
  var drillGrow = false, drillShield = false;
  var SHN = 10;
  var sx = new Float32Array(SHN), sy = new Float32Array(SHN);
  var svx = new Float32Array(SHN), svy = new Float32Array(SHN), st = new Float32Array(SHN);
  function addShield(x, y, vx, vy) {
    var k = 0, worst = 1e9;
    for (var i = 0; i < SHN; i++) if (st[i] < worst) { worst = st[i]; k = i; }
    sx[k] = x; sy[k] = y; svx[k] = vx * 0.25; svy[k] = vy * 0.25; st[k] = 0.5;
  }
  U.define('drill', {
    family: 'projectile', tags: ['pierce', 'kill'], wild: false,
    visual: { slot: 'fins' },
    tiers: [
      { // T1 — pierce 2
        apply: function () { U.mods.pierce += 2; },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle, sp = NA.Time.t * 9;
          var nx = p.x + Math.cos(a) * C.SHIP_R * 1.7, ny = p.y + Math.sin(a) * C.SHIP_R * 1.7;
          NA.R.poly(NA.R.L.PLAYER, nx, ny, 3.4, 3, sp, 1.3, CY[0], CY[1], CY[2], 0.85);
        }
      },
      { // T2 — each pierce speeds and elongates the bullet; 4 pierces = a mini-rail
        apply: function () { drillGrow = true; },
        onHit: function (ctx) {
          var bi = ctx.bi;
          if (PB.pierce[bi] <= 0) return;
          var used = Math.max(0, U.statics.pierce - PB.pierce[bi]) + 1;
          PB.vx[bi] *= 1.16; PB.vy[bi] *= 1.16;
          PB.size[bi] *= 1.10;
          if (used >= 4) {                     // mini-rail
            PB.pierce[bi] = 99;
            PB.dmg[bi] *= 1.5;
            PB.size[bi] = Math.min(20, PB.size[bi] * 1.3);
            PB.r[bi] = 0.6; PB.g[bi] = 0.95; PB.b[bi] = 1;
            NA.Particles.bolt(PB.x[bi], PB.y[bi], PB.x[bi] + PB.vx[bi] * 0.12, PB.y[bi] + PB.vy[bi] * 0.12,
              0.14, 5, 0.6, 0.95, 1, 2);
          }
        }
      },
      { // T3 — a pierce-kill carries the corpse as a 0.5s bullet shield
        apply: function () { drillShield = true; },
        onHit: function (ctx) {
          if (!ctx.kill || PB.pierce[ctx.bi] <= 0) return;
          addShield(ctx.x, ctx.y, PB.vx[ctx.bi], PB.vy[ctx.bi]);
        },
        update: function (dt) {
          for (var i = 0; i < SHN; i++) {
            if (st[i] <= 0) continue;
            st[i] -= dt;
            sx[i] += svx[i] * dt; sy[i] += svy[i] * dt;
            svx[i] *= 0.96; svy[i] *= 0.96;
            NA.Bullets.clearArea(sx[i], sy[i], 30, false);
          }
        },
        render: function () {
          for (var i = 0; i < SHN; i++) {
            if (st[i] <= 0) continue;
            var a = M.clamp01(st[i] / 0.5);
            NA.R.poly(NA.R.L.PBULLETS, sx[i], sy[i], 15, 5, NA.Time.t * 4 + i, 1.6, 0.55, 0.58, 0.65, a * 0.8);
            NA.R.dot(NA.R.L.PBULLETS, sx[i], sy[i], 3, 1, 1, 1, a * 0.6);
          }
        }
      }
    ]
  });

  /* ---------------------------------------------------------- 9. SEEKER */
  var seekTurnBack = false, seekSplit = false;
  function markSeek(bi) { PB.flags[bi] |= F.SEEK; }
  U.define('seeker', {
    family: 'projectile', tags: ['bounce', 'pierce'], wild: false,
    visual: { slot: 'fins' },
    tiers: [
      { // T1 — gentle homing.  Retargeting is staggered: each bullet re-picks a
        // target on one frame in six, so 400 seekers cost ~66 grid queries a frame.
        onFire: function () { H.lastVolley(markSeek); },
        update: function (dt) {
          var E = NA.Enemies; if (!E) return;
          var fr = NA.Time.frames;
          for (var i = 0; i < PB.n; i++) {
            if (!(PB.flags[i] & F.SEEK)) continue;
            if (((fr + i) % 6) !== 0) continue;
            var t = H.nearestEnemy(PB.x[i], PB.y[i], 640, -1);
            if (t < 0) continue;
            var want = Math.atan2(E.y[t] - PB.y[i], E.x[t] - PB.x[i]);
            var na = PB.rot[i] + M.norm(want - PB.rot[i]) * 0.22;
            var sp = Math.sqrt(PB.vx[i] * PB.vx[i] + PB.vy[i] * PB.vy[i]);
            PB.vx[i] = Math.cos(na) * sp; PB.vy[i] = Math.sin(na) * sp; PB.rot[i] = na;
          }
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle - M.HALFPI;
          NA.R.line(NA.R.L.PLAYER, p.x, p.y, p.x + Math.cos(a) * C.SHIP_R * 1.6,
            p.y + Math.sin(a) * C.SHIP_R * 1.6, 1.2, CY[0], CY[1], CY[2], 0.7);
        }
      },
      { // T2 — a bullet that missed turns around for a second pass
        apply: function () { seekTurnBack = true; },
        update: function (dt) {
          var E = NA.Enemies; if (!E || !E.n) return;
          for (var i = 0; i < PB.n; i++) {
            if (!(PB.flags[i] & F.SEEK) || (PB.flags[i] & F.RETURN)) continue;
            if (PB.life[i] > 0.12) continue;
            var t = H.nearestEnemy(PB.x[i], PB.y[i], 900, -1);
            if (t < 0) continue;
            PB.flags[i] |= F.RETURN;
            var a = Math.atan2(E.y[t] - PB.y[i], E.x[t] - PB.x[i]);
            var sp = NA.Player.stats.bulletSpeed * 0.85;
            PB.vx[i] = Math.cos(a) * sp; PB.vy[i] = Math.sin(a) * sp; PB.rot[i] = a;
            PB.life[i] = NA.Player.stats.life * 0.9;
            NA.Particles.ring(PB.x[i], PB.y[i], 2, 16, 0.2, 1.4, CY[0], CY[1], CY[2], 0.7);
          }
        }
      },
      { // T3 — a bullet that hits splits into two seekers at 50%
        apply: function () { seekSplit = true; },
        onHit: function (ctx) {
          var bi = ctx.bi;
          if (!(PB.flags[bi] & F.SEEK) || (PB.flags[bi] & F.NOSPLIT)) return;
          var a = PB.rot[bi];
          for (var s = -1; s <= 1; s += 2) {
            var b = H.fireBullet(ctx.x, ctx.y, a + s * 0.9, {
              dmgMul: 0.5, speed: NA.Player.stats.bulletSpeed * 0.8,
              size: NA.Player.stats.bulletSize * 0.8, life: NA.Player.stats.life * 0.8
            });
            if (b >= 0) PB.flags[b] |= F.SEEK | F.NOSPLIT;
          }
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // radar sweep behind the ship
          var a = p.angle + Math.PI, sw = (NA.Time.t * 2.4) % 1;
          NA.R.arc(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 2.4, a - 0.7 + sw * 1.4, a - 0.55 + sw * 1.4,
            1.4, CY[0], CY[1], CY[2], 0.45);
        }
      }
    ]
  });

  /* -------------------------------------------------------- 10. VOLTAIC */
  var voltHits = 0, voltHops = 1, voltFall = 0.6, voltCharge = false;
  U.define('voltaic', {
    family: 'projectile', tags: ['explode', 'zone', 'pierce'], wild: false,
    visual: { slot: 'core' },
    tiers: [
      { // T1 — every 3rd hit arcs to one neighbour
        apply: function () { voltHops = 1; voltFall = 0.6; },
        onHit: function (ctx) {
          if ((++voltHits % 3) !== 0) return;
          H.chainLightning(ctx.x, ctx.y, ctx.dmg * voltFall, voltHops, 250, ctx.ei, CY);
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // tesla coil on the spine
          var a = p.angle + Math.PI, t = NA.Time.t;
          var bx = p.x + Math.cos(a) * C.SHIP_R * 0.5, by = p.y + Math.sin(a) * C.SHIP_R * 0.5;
          NA.R.ring(NA.R.L.PLAYER, bx, by, 4 + Math.sin(t * 7) * 1.2, 1.2, CY[0], CY[1], CY[2], 0.8);
        }
      },
      { // T2 — arcs chain up to 5, with no falloff
        apply: function () { voltHops = 5; voltFall = 1.0; },
        render: function () {   // F21: twin coils — the second one counter-phased
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle + Math.PI, t = NA.Time.t;
          var bx = p.x + Math.cos(a) * C.SHIP_R * 0.95, by = p.y + Math.sin(a) * C.SHIP_R * 0.95;
          NA.R.ring(NA.R.L.PLAYER, bx, by, 4 - Math.sin(t * 7) * 1.2, 1.2, CY[0], CY[1], CY[2], 0.7);
          // the two coils spark across the gap on the beat
          var f = Math.sin(t * 7);
          if (f > 0.86) NA.R.line(NA.R.L.PLAYER, bx, by,
            p.x + Math.cos(a) * C.SHIP_R * 0.5, p.y + Math.sin(a) * C.SHIP_R * 0.5,
            1.2, CY[0], CY[1], CY[2], 0.5);
        }
      },
      { // T3 — struck enemies are Charged: +30% damage taken, and dying
        // releases a stun burst
        apply: function () { voltCharge = true; H.chainCharges = true; },
        onHit: function (ctx) {
          if (H.isCharged(ctx.ei)) H.damageEnemy(ctx.ei, ctx.dmg * 0.3, 'player');
          H.setCharged(ctx.ei, 4);
        },
        onKill: function (ctx) {
          if (!H.isCharged(ctx.ei)) return;
          NA.Particles.ring(ctx.x, ctx.y, 8, 180, 0.35, 3, CY[0], CY[1], CY[2], 0.9);
          if (NA.Audio) NA.Audio.sfx('lightning', { x: ctx.x, y: ctx.y, vol: 0.45 });
          var E = NA.Enemies;
          var cnt = E.grid.query(ctx.x, ctx.y, 190), out = E.grid.out;
          for (var q = 0; q < cnt; q++) {
            var e = out[q]; if (e >= E.n) continue;
            H.setStun(e, 1.1);
          }
        },
        render: function () { H.renderCharged(); H.renderStunned(); }
      }
    ]
  });

  U.onReset(function () {
    blastR = 60; blastChain = false;
    ricoEnemy = false; ricoGrow = false;
    drillGrow = false; drillShield = false;
    for (var i = 0; i < SHN; i++) st[i] = 0;
    seekTurnBack = false; seekSplit = false;
    voltHits = 0; voltHops = 1; voltFall = 0.6; voltCharge = false;
  });
})();

/* ==========================================================================
 * HELPER LIBRARY, PART 3 — the ACTIVE-KEY arbiter.
 *
 * One key ('active' = E / middle mouse / gamepad face+shoulder) drives every
 * held or tapped active, so it needs a referee.  Both upgrade files register
 * with it:
 *
 *   H.registerHoldActive(id)     hold-to-channel actives, priority = order
 *   H.registerTapActive(id)      press-to-cast actives, priority = order
 *   H.holdOwner()  -> id|null    who owns the key while it is held right now
 *   H.tapClaim(id) -> bool       true for exactly one owned tap active on the
 *                                frame the key is tapped; successive taps
 *                                round-robin through everything you own, so a
 *                                build with three tap actives can reach all of
 *                                them.
 *
 * Special case, by design: owning BOTH Overdrive and Chrono splits the hold —
 * Overdrive channels while the fire button is down (it is a gun buff), Chrono
 * channels while it is not (it is an escape).  Blink and Railgun do not use
 * this key at all: Blink replaces the dash, Railgun charges on the fire button.
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, H = U.helpers;
  var holds = [], taps = [], rr = 0, tapWinner = null, tapFrame = -1;

  H.registerHoldActive = function (id) { if (holds.indexOf(id) < 0) holds.push(id); };
  H.registerTapActive = function (id) { if (taps.indexOf(id) < 0) taps.push(id); };

  H.holdOwner = function () {
    var od = U.tier('overdrive') > 0, ch = U.tier('chrono') > 0;
    if (od && ch) return NA.Player.firing ? 'overdrive' : 'chrono';
    for (var i = 0; i < holds.length; i++) if (U.tier(holds[i]) > 0) return holds[i];
    return null;
  };

  H.tapClaim = function (id) {
    if (!H.activeReleased() || H.activeReleaseHeld() > 0.22) return false;
    if (tapFrame !== NA.Time.frames) {
      tapFrame = NA.Time.frames;
      tapWinner = null;
      var owned = 0, i;
      for (i = 0; i < taps.length; i++) if (U.tier(taps[i]) > 0) owned++;
      if (owned) {
        var pick = (rr++) % owned, k = 0;
        for (i = 0; i < taps.length; i++) {
          if (U.tier(taps[i]) <= 0) continue;
          if (k++ === pick) { tapWinner = taps[i]; break; }
        }
      }
    }
    return tapWinner === id;
  };

  U.onReset(function () { rr = 0; tapWinner = null; tapFrame = -1; });
})();

/* ==========================================================================
 * C. MANA ACTIVES — 11 Overdrive · 12 Chrono · 13 Pulse · 14 Siphon ·
 *                   15 Overcharge · 16 Arcane Rounds
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, H = U.helpers, M = NA.M, C = NA.C, F = H.FLAG;
  var PB = NA.Bullets.P;
  var CY = C.COL.player, GO = C.COL.gold, VI = C.COL.violet, RD = C.COL.red;

  H.registerHoldActive('overdrive');
  H.registerHoldActive('chrono');
  H.registerHoldActive('pulse');
  H.registerTapActive('pulse');

  /* ------------------------------------------------------- 11. OVERDRIVE */
  var odOn = false, odT = 0, odTier = 0;
  function odTint(bi) {
    PB.dmg[bi] *= 1.3;
    PB.r[bi] = CY[0]; PB.g[bi] = CY[1]; PB.b[bi] = CY[2];
    PB.flags[bi] |= F.OD;
  }
  U.define('overdrive', {
    family: 'active', tags: ['mana', 'spend'], wild: false,
    visual: { slot: 'core' },
    tiers: [
      { // T1 — hold: drain 12/s to fire twice as fast
        apply: function () { odTier = Math.max(odTier, 1); },
        update: function (dt) {
          var want = H.activeDown() && H.holdOwner() === 'overdrive' && NA.Player.alive && H.combat();
          if (want && H.drain(12, dt, 'overdrive')) {
            if (!odOn && NA.Audio) NA.Audio.sfx('spendActive', { x: NA.Player.x, y: NA.Player.y });
            odOn = true; odT += dt;
            NA.Player.stats.fireRate *= 2;
            if ((NA.Time.frames & 3) === 0)
              NA.Particles.spawn(NA.Player.x, NA.Player.y, (NA.RNG.f() - 0.5) * 60, (NA.RNG.f() - 0.5) * 60,
                0.3, 3, CY[0], CY[1], CY[2], 0.7, 2, 2);
          } else {
            odOn = false;
          }
        },
        render: function () {
          if (!odOn) return;
          var p = NA.Player;
          // cyan veins running up the hull
          for (var k = 0; k < 3; k++) {
            var a = p.angle + (k - 1) * 0.7;
            NA.R.line(NA.R.L.PLAYER, p.x, p.y, p.x + Math.cos(a) * C.SHIP_R * 1.5,
              p.y + Math.sin(a) * C.SHIP_R * 1.5, 1.4, CY[0], CY[1], CY[2],
              0.4 + 0.3 * Math.sin(NA.Time.t * 14 + k));
          }
        }
      },
      { // T2 — Overdrive bullets are cyan and +30%, and refund 1 mana on a near miss
        apply: function () { odTier = Math.max(odTier, 2); },
        onFire: function () { if (odOn) H.lastVolley(odTint); },
        update: function (dt) {
          if ((NA.Time.frames % 3) !== 0) return;
          var E = NA.Enemies; if (!E || !E.n) return;
          var G = NA.Bullets.FLAG.GRAZED;
          for (var i = 0; i < PB.n; i++) {
            if (!(PB.flags[i] & F.OD) || (PB.flags[i] & G)) continue;
            var t = H.nearestEnemy(PB.x[i], PB.y[i], 52, -1);
            if (t < 0) continue;
            var d2 = M.dist2(PB.x[i], PB.y[i], E.x[t], E.y[t]);
            var inner = E.size[t] + PB.size[i] + 4;
            if (d2 <= inner * inner) continue;               // that is a hit, not a miss
            PB.flags[i] |= G;
            NA.Player.addMana(1, 'overdrive');
            NA.Particles.spawn(PB.x[i], PB.y[i], 0, -30, 0.25, 2, CY[0], CY[1], CY[2], 0.8, 0, 1);
          }
        }
      },
      { // T3 — releasing after 2s+ dumps a 360 degree Nova
        apply: function () { odTier = 3; },
        update: function (dt) {
          if (odOn) return;
          if (H.activeReleased() && odT >= 2 && H.holdOwner() === 'overdrive') {
            var p = NA.Player;
            for (var k = 0; k < 28; k++) {
              H.fireBullet(p.x, p.y, k / 28 * M.TAU, {
                dmgMul: 1.2, r: CY[0], g: CY[1], b: CY[2], life: NA.Player.stats.life * 1.4
              });
            }
            NA.Particles.ring(p.x, p.y, 12, 320, 0.45, 4, CY[0], CY[1], CY[2], 1);
            NA.FX.trauma(0.28); NA.FX.flash(0.18, 110); NA.FX.chroma(2.5, 220);
            if (NA.Audio) NA.Audio.sfx('explode', { x: p.x, y: p.y });
          }
          if (!odOn) odT = 0;
        },
        render: function () {
          if (odT < 0.6) return;
          var p = NA.Player, k = M.clamp01(odT / 2);
          // the charge ring closes as the Nova arms
          NA.R.arc(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 3.4, -M.HALFPI, -M.HALFPI + M.TAU * k,
            2, CY[0], CY[1], CY[2], k >= 1 ? 0.9 : 0.45);
        }
      }
    ]
  });

  /* ---------------------------------------------------------- 12. CHRONO */
  var chOn = false, chTier = 0, chWasOn = false, chFrozen = 0;
  function chFreeze(bi) {
    PB.flags[bi] |= F.CHRONO;
    PB.vx[bi] = 0; PB.vy[bi] = 0;
    PB.life[bi] = 12;
    chFrozen++;
  }
  function chRelease() {
    var sp = U.statics.bulletSpeed || C.BULLET_SPEED;
    for (var i = 0; i < PB.n; i++) {
      if (!(PB.flags[i] & F.CHRONO)) continue;
      PB.flags[i] &= ~F.CHRONO;
      PB.vx[i] = Math.cos(PB.rot[i]) * sp; PB.vy[i] = Math.sin(PB.rot[i]) * sp;
      PB.life[i] = U.statics.life || C.BULLET_LIFE;
      NA.Particles.spawn(PB.x[i], PB.y[i], 0, 0, 0.18, 4, 1, 1, 1, 0.7, 1, 1);
    }
    chFrozen = 0;
  }
  function chSnapshot() {
    var E = NA.Enemies, s = H.enemyStatus;
    if (!E) return;
    for (var i = 0; i < E.n; i++) { s.rwx[i] = E.x[i]; s.rwy[i] = E.y[i]; }
  }
  U.define('chrono', {
    family: 'active', tags: ['mana', 'zone'], wild: false,
    visual: { slot: 'hull' },
    tiers: [
      { // T1 — hold: the world runs at 30%, you at 70%.  20 mana/s.
        apply: function () { chTier = Math.max(chTier, 1); },
        update: function (dt) {
          var want = H.activeDown() && H.holdOwner() === 'chrono' && NA.Player.alive && H.combat();
          if (want && H.drain(20, dt, 'chrono')) {
            if (!chOn) {
              chOn = true; chSnapshot();
              NA.Time.setTimeScale(0.3, 90);
              if (NA.Audio) NA.Audio.sfx('spendActive', { x: NA.Player.x, y: NA.Player.y });
            }
            // you keep 70% of real speed while the world crawls at 30%
            NA.Player.stats.speed *= 2.33;
            NA.Player.stats.fireRate *= 2.33;
            NA.FX.desat(0.25, 120);
          } else if (chOn) {
            chOn = false;
            NA.Time.setTimeScale(1, 140);
            if (chTier >= 2) chRelease();
          }
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          if (!chOn) {
            // clock decal
            var a = NA.Time.t * 0.9;
            NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 1.15, 1, 0.75, 0.85, 1, 0.35);
            NA.R.line(NA.R.L.PLAYER, p.x, p.y, p.x + Math.cos(a) * C.SHIP_R * 0.9,
              p.y + Math.sin(a) * C.SHIP_R * 0.9, 1, 0.75, 0.85, 1, 0.5);
            return;
          }
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * (3 + Math.sin(NA.Time.real * 4) * 0.4), 1.6,
            0.75, 0.85, 1, 0.5);
        }
      },
      { // T2 — bullets fired during Chrono freeze, then release at full speed
        apply: function () { chTier = Math.max(chTier, 2); },
        onFire: function () { if (chOn) H.lastVolley(chFreeze); },
        render: function () {
          if (!chFrozen) return;
          // the constellation: consecutive frozen bullets are joined by faint lines
          var px = 0, py = 0, have = false, drawn = 0;
          for (var i = 0; i < PB.n && drawn < 90; i++) {
            if (!(PB.flags[i] & F.CHRONO)) continue;
            NA.R.dot(NA.R.L.PBULLETS, PB.x[i], PB.y[i], PB.size[i] * 0.7, 0.85, 0.92, 1, 0.9);
            if (have) {
              NA.R.line(NA.R.L.PBULLETS, px, py, PB.x[i], PB.y[i], 0.8, 0.75, 0.85, 1, 0.22);
              drawn++;
            }
            px = PB.x[i]; py = PB.y[i]; have = true;
          }
        }
      },
      { // T3 — enemies hit during Chrono are rewound 1s and take the damage again
        apply: function () { chTier = 3; },
        onHit: function (ctx) {
          if (!chOn) return;
          var E = NA.Enemies, s = H.enemyStatus, e = ctx.ei;
          if (e < 0 || e >= E.n) return;
          var ox = s.rwx[e], oy = s.rwy[e];
          if (ox === 0 && oy === 0) return;
          if (M.dist2(ox, oy, E.x[e], E.y[e]) < 4) return;
          NA.Particles.afterImage(E.x[e], E.y[e], E.rot[e], E.size[e], 0.3, 0.75, 0.85, 1, 0.5, 0);
          NA.R.line(NA.R.L.PARTICLES, E.x[e], E.y[e], ox, oy, 1.2, 0.75, 0.85, 1, 0.5);
          E.x[e] = ox; E.y[e] = oy;
          H.damageEnemy(e, ctx.dmg, 'player');
        }
      }
    ]
  });

  /* ----------------------------------------------------------- 13. PULSE */
  var pulseConvert = false, pulseCharged = false, pulseChargeT = 0, pulseConvT = -9;
  function doPulse(radius, stun) {
    var p = NA.Player;
    if (!H.spend(30, 'pulse')) return false;
    NA.Bullets.clearArea(p.x, p.y, radius, pulseConvert);
    if (pulseConvert) pulseConvT = NA.Time.t;      // F21: the rim flares on a conversion
    H.pushArea(p.x, p.y, radius, 620, 0);
    NA.Particles.ring(p.x, p.y, 14, radius, 0.42, 4, VI[0], VI[1], VI[2], 1);
    NA.Particles.ring(p.x, p.y, 8, radius * 0.6, 0.28, 3, 1, 1, 1, 0.8);
    NA.FX.trauma(0.12 + radius / 3000);
    NA.R.light(p.x, p.y, radius * 1.4, 0.7);
    if (stun > 0) {
      var E = NA.Enemies;
      var cnt = E.grid.query(p.x, p.y, radius), out = E.grid.out;
      for (var q = 0; q < cnt; q++) { var e = out[q]; if (e < E.n) H.setStun(e, stun); }
    }
    if (NA.Audio) NA.Audio.sfx('explode', { x: p.x, y: p.y, vol: 0.7 });
    return true;
  }
  U.define('pulse', {
    family: 'active', tags: ['mana', 'spend', 'zone'], wild: false,
    visual: { slot: 'aura' },
    tiers: [
      { // T1 — 30 mana: a shockwave that deletes enemy bullets and knocks back
        update: function (dt) {
          if (!NA.Player.alive) return;
          if (H.tapClaim('pulse')) doPulse(260, 0);
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 1.8, 1.2, VI[0], VI[1], VI[2],
            H.canSpend(30) ? 0.5 : 0.15);
        }
      },
      { // T2 — the deleted bullets become yours
        apply: function () { pulseConvert = true; },
        render: function () {   // F21: the purple rim — it flares as bullets convert
          var p = NA.Player; if (!p.alive) return;
          var k = M.clamp01((NA.Time.t - pulseConvT) / 0.45);
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 2.2, 1.4 + (1 - k) * 1.6,
            VI[0], VI[1], VI[2], 0.22 + (1 - k) * 0.4);
        }
      },
      { // T3 — hold to charge: 2.5x radius, and it stuns
        apply: function () { pulseCharged = true; },
        update: function (dt) {
          if (!NA.Player.alive) return;
          var mine = H.holdOwner() === 'pulse';
          if (mine && H.activeDown()) {
            pulseChargeT = Math.min(1, pulseChargeT + dt / 0.7);
          } else if (pulseChargeT > 0) {
            if (pulseChargeT >= 1) doPulse(650, 1.5);
            pulseChargeT = 0;
          }
        },
        render: function () {
          var p = NA.Player;
          if (pulseChargeT <= 0.02 || !p.alive) return;
          var k = pulseChargeT;
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 2 + k * 90, 1.6 + k * 1.6,
            VI[0], VI[1], VI[2], 0.25 + k * 0.5);
          if (k >= 1) NA.R.ring(NA.R.L.PLAYER, p.x, p.y, 650, 1.4, VI[0], VI[1], VI[2],
            0.25 + 0.2 * Math.sin(NA.Time.real * 12));
        }
      }
    ]
  });

  /* ---------------------------------------------------------- 14. SIPHON */
  var siphonTier = 0, debt = 0, hitHooked = false;
  function onPlayerHit() {
    if (siphonTier < 2) return;
    NA.Player.addMana(40, 'siphon');
    NA.Particles.ring(NA.Player.x, NA.Player.y, 8, 90, 0.3, 2.5, RD[0], RD[1], RD[2], 0.9);
  }
  U.define('siphon', {
    family: 'active', tags: ['mana', 'kill', 'spend'], wild: false,
    visual: { slot: 'hull' },
    tiers: [
      { // T1 — kills within 100px refund +5 mana
        apply: function () { siphonTier = Math.max(siphonTier, 1); },
        onKill: function (ctx) {
          var p = NA.Player;
          if (M.dist2(ctx.x, ctx.y, p.x, p.y) > 100 * 100) return;
          p.addMana(5, 'siphon');
          NA.Particles.spawn(ctx.x, ctx.y, (p.x - ctx.x) * 2, (p.y - ctx.y) * 2, 0.28, 3,
            RD[0], RD[1], RD[2], 0.9, 1, 1);
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          var a = p.angle + Math.PI;
          for (var s = -1; s <= 1; s += 2) {
            var vx = p.x + Math.cos(a + s * 0.55) * C.SHIP_R * 1.1;
            var vy = p.y + Math.sin(a + s * 0.55) * C.SHIP_R * 1.1;
            NA.R.dot(NA.R.L.PLAYER, vx, vy, 1.8, RD[0], RD[1], RD[2], 0.75);
          }
        }
      },
      { // T2 — damage taken refunds double as mana
        apply: function () {
          siphonTier = Math.max(siphonTier, 2);
          if (!hitHooked && NA.Game) { hitHooked = true; NA.Game.on('playerHit', onPlayerHit); }
        },
        update: function (dt) {
          if (!hitHooked && NA.Game) { hitHooked = true; NA.Game.on('playerHit', onPlayerHit); }
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          var k = 0.5 + 0.5 * Math.sin(NA.Time.t * 5);
          NA.R.ring(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 1.5, 1, RD[0], RD[1], RD[2], 0.2 + k * 0.25);
        }
      },
      { // T3 — at 0 mana you may overspend; the hull pays the difference
        apply: function () { siphonTier = 3; },
        render: function () {
          if (debt <= 0) return;
          var p = NA.Player, k = M.clamp01(debt / 55);
          // the red debt band under the ship
          NA.R.arc(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 2.6, Math.PI * 0.6, Math.PI * 0.6 + M.TAU * k,
            2.4, RD[0], RD[1], RD[2], 0.8);
        }
      }
    ]
  });

  /* Overspend: NA.Player.spend is wrapped once, and only ever changes behaviour
   * while Siphon 3 is owned.  The onSpend hook still fires for the full amount. */
  var SPCTX = { amount: 0, tag: '' };   // reused per spend; no hook retains it
  (function () {
    var orig = NA.Player.spend;
    NA.Player.spend = function (n, tag) {
      if (siphonTier < 3 || NA.Player.mana >= n) return orig.call(NA.Player, n, tag);
      var short = n - NA.Player.mana;
      NA.Player.mana = 0;
      debt += short;
      SPCTX.amount = n; SPCTX.tag = tag || '';
      NA.Upgrades.emit('onSpend', SPCTX);
      NA.Particles.burst(NA.Player.x, NA.Player.y, 3, 90, 0.24, RD[0], RD[1], RD[2], 2);
      if (debt >= 55) {
        debt -= 55;
        NA.Player.damage(1, NA.Player.x, NA.Player.y);
      }
      return true;
    };
  })();

  /* ------------------------------------------------------ 15. OVERCHARGE */
  var ocTier = 0;
  function ocTint(bi) {
    PB.dmg[bi] *= 1.5;
    PB.r[bi] = GO[0]; PB.g[bi] = GO[1]; PB.b[bi] = GO[2];
  }
  U.define('overcharge', {
    family: 'active', tags: ['mana', 'spend'], wild: false,
    visual: { slot: 'halo' },
    tiers: [
      { // T1 — the bar overfills to 150
        apply: function (p) { ocTier = Math.max(ocTier, 1); if (p) p.manaMax = Math.max(p.manaMax, 150); },
        render: function () {
          var p = NA.Player; if (!p.alive || p.mana <= 100) return;
          var k = M.clamp01((p.mana - 100) / 50);
          NA.R.arc(NA.R.L.PLAYER, p.x, p.y, C.SHIP_R * 2.9, -M.HALFPI, -M.HALFPI + M.TAU * k,
            2.2, GO[0], GO[1], GO[2], 0.75);
        }
      },
      { // T2 — above 100 the bullets are gold and +50%
        apply: function () { ocTier = Math.max(ocTier, 2); },
        onFire: function () { if (NA.Player.mana > 100) H.lastVolley(ocTint); }
      },
      { // T3 — hitting 150 auto-Discharges a screen-wide lightning storm
        apply: function () { ocTier = 3; },
        update: function (dt) {
          var p = NA.Player;
          if (p.mana < p.manaMax || p.manaMax < 150 || !H.combat()) return;
          var spent = p.mana;
          p.mana = 0;
          DIS.amount = spent;
          U.emit('onSpend', DIS);
          var E = NA.Enemies, n = 0;
          for (var k = 0; k < 10 && E && E.n; k++) {
            var e = (NA.RNG.f() * E.n) | 0;
            n += H.chainLightning(E.x[e], E.y[e], p.stats.damage * 1.4, 6, 320, -1, GO);
          }
          NA.FX.flash(0.22, 140); NA.FX.trauma(0.3); NA.FX.chroma(2.5, 260);
          NA.Particles.ring(p.x, p.y, 20, 700, 0.5, 4, GO[0], GO[1], GO[2], 0.9);
          if (NA.Audio) NA.Audio.sfx('lightning', { x: p.x, y: p.y });
        }
      }
    ]
  });
  var DIS = { amount: 150, tag: 'discharge' };

  /* ---------------------------------------------------------- 16. ARCANE */
  var arcTier = 0, arcActiveShot = false, arcRefundT = -9;
  var ARC_COL = [0.55, 0.62, 1.0];
  function arcTint(bi) {
    if (!NA.Player.spend(0.5, 'arcane')) return;
    arcActiveShot = true;
    PB.dmg[bi] *= 1.6;
    PB.r[bi] = ARC_COL[0]; PB.g[bi] = ARC_COL[1]; PB.b[bi] = ARC_COL[2];
    PB.flags[bi] |= F.ARCANE;
    if (arcTier >= 3) PB.flags[bi] |= NA.Bullets.FLAG.WALLPHASE;
  }
  U.define('arcane', {
    family: 'active', tags: ['mana', 'spend', 'pierce'], wild: false,
    visual: { slot: 'hull' },
    tiers: [
      { // T1 — bullets cost 0.5 mana and hit 60% harder
        apply: function () {
          arcTier = Math.max(arcTier, 1);
          if (NA.Ship) NA.Ship.tint = ARC_COL;
        },
        onFire: function () { arcActiveShot = false; H.lastVolley(arcTint); },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // runes orbiting the hull
          var t = NA.Time.t * 0.8;
          for (var k = 0; k < 3; k++) {
            var a = t + k / 3 * M.TAU;
            NA.R.poly(NA.R.L.PLAYER, p.x + Math.cos(a) * C.SHIP_R * 1.8, p.y + Math.sin(a) * C.SHIP_R * 1.8,
              2.4, 3, -a * 2, 1.1, ARC_COL[0], ARC_COL[1], ARC_COL[2], 0.55);
          }
        }
      },
      { // T2 — an arcane kill refunds triple its cost
        apply: function () { arcTier = Math.max(arcTier, 2); },
        onKill: function (ctx) {
          if (!arcActiveShot) return;
          NA.Player.addMana(1.5, 'arcane');
          arcRefundT = NA.Time.t;
        },
        render: function () {   // F21: a second, brighter rune ring; it pulses on a refund
          var p = NA.Player; if (!p.alive) return;
          var t = NA.Time.t, k = M.clamp01((t - arcRefundT) / 0.5);
          var rr = C.SHIP_R * (2.25 - (1 - k) * 0.25);
          for (var q = 0; q < 3; q++) {
            var a = -t * 0.8 + q / 3 * M.TAU;
            NA.R.poly(NA.R.L.PLAYER, p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr,
              2.6 + (1 - k) * 1.4, 3, a * 2, 1.1, ARC_COL[0], ARC_COL[1], ARC_COL[2],
              0.4 + (1 - k) * 0.35);
          }
        }
      },
      { // T3 — arcane bullets fly through walls
        apply: function () { arcTier = 3; },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // holographic wings
          for (var s = -1; s <= 1; s += 2) {
            var a = p.angle + s * 2.5;
            NA.R.line(NA.R.L.PLAYER, p.x, p.y, p.x + Math.cos(a) * C.SHIP_R * 2.6,
              p.y + Math.sin(a) * C.SHIP_R * 2.6, 1.2, ARC_COL[0], ARC_COL[1], ARC_COL[2],
              0.25 + 0.2 * Math.sin(NA.Time.t * 3 + s));
          }
        }
      }
    ]
  });

  U.onReset(function () {
    odOn = false; odT = 0; odTier = 0;
    chOn = false; chTier = 0; chFrozen = 0;
    pulseConvert = false; pulseCharged = false; pulseChargeT = 0; pulseConvT = -9;
    siphonTier = 0; debt = 0;
    ocTier = 0; arcTier = 0; arcActiveShot = false; arcRefundT = -9;
  });
})();

/* ==========================================================================
 * D. MOVEMENT — 17 Afterburner · 18 Phase · 19 Drift · 20 Blink
 *
 * Afterburner and Blink both rewrite the dash, so they exclude each other
 * (`excludes`), and both go through the single H.preDash / H.postDash pair the
 * helper library installs around NA.Player.dash.
 * ======================================================================== */
(function () {
  var U = NA.Upgrades, H = U.helpers, M = NA.M, C = NA.C, F = H.FLAG;
  var CY = C.COL.player, VI = C.COL.violet, MG = C.COL.magenta;

  var abTier = 0, abChain = 0, abLastDash = -9, abLand = 0;
  var phTier = 0, phStored = 0;
  var dfTier = 0, dfBrakeCd = 0, dfBounceCd = 0;
  var blTier = 0;
  var prevDashT = 0;

  /* -------------------------------------------------- the shared dash gate */
  function preDash() {
    if (blTier > 0) { doBlink(); return false; }        // Blink REPLACES the dash
    if (abTier >= 2) {
      var s = NA.Player.stats;
      var dt = NA.Time.t - abLastDash;
      if (dt < 0.3) {
        abChain = Math.min(2, abChain + 1);
        s.dashCost = abChain >= 2 ? 0 : 5;              // 2nd costs 5, 3rd is free
        s.dashDist = U.statics.dashDist * 1.5;
      } else {
        abChain = 0;
        s.dashCost = U.statics.dashCost;
        s.dashDist = U.statics.dashDist;
      }
    }
    return true;
  }
  function postDash() {
    abLastDash = NA.Time.t;
    if (abTier >= 3) abLand = C.DASH_TIME;
  }
  H.preDash = preDash; H.postDash = postDash;
  U.onReset(function () {
    abTier = abChain = 0; abLastDash = -9; abLand = 0;
    phTier = 0; phStored = 0;
    dfTier = 0; dfBrakeCd = 0; dfBounceCd = 0;
    blTier = 0; decoyT = 0; prevDashT = 0;
    H.preDash = preDash; H.postDash = postDash;
  });

  /* ---------------------------------------------------- 17. AFTERBURNER */
  U.define('afterburner', {
    family: 'movement', tags: ['dash', 'kill'], wild: false,
    visual: { slot: 'trail' }, excludes: ['blink'],
    tiers: [
      { // T1 — dashing through enemies hurts them, and you keep the momentum
        apply: function () {
          abTier = Math.max(abTier, 1);
          if (NA.Ship) NA.Ship.setSlot('wings', Math.max(NA.Ship.getSlot('wings'), 1));
        },
        update: function (dt) {
          var p = NA.Player;
          if (p.dashT > 0) {
            if ((NA.Time.frames % 3) === 0) {
              H.damageArea(p.x, p.y, 46, p.stats.damage * 0.55, 'player', null);
              NA.Particles.spawn(p.x, p.y, -p.dashVX * 0.2, -p.dashVY * 0.2, 0.24, 4,
                1, 0.541, 0, 0.8, 2, 2);
            }
          } else if (prevDashT > 0) {
            p.vx = p.dashVX * 0.75; p.vy = p.dashVY * 0.75;   // momentum is kept
          }
        }
      },
      { // T2 — chain dashes: the 2nd within 0.3s costs 5 and goes 1.5x, the 3rd is free
        apply: function () { abTier = Math.max(abTier, 2); },
        render: function () {
          if (abChain <= 0) return;
          var p = NA.Player;
          for (var k = 0; k <= abChain; k++)
            NA.R.ring(NA.R.L.AFTER, p.x, p.y, C.SHIP_R * (2 + k * 0.8), 1.2,
              1, 0.541, 0, 0.4 - k * 0.1);
        }
      },
      { // T3 — the landing point scatters a mercy ring that deletes bullets
        apply: function () { abTier = 3; },
        update: function (dt) {
          if (abLand <= 0) return;
          abLand -= dt;
          if (abLand > 0 || NA.Player.dashT > 0) return;
          var p = NA.Player;
          NA.Bullets.clearArea(p.x, p.y, 160, false);
          NA.Particles.ring(p.x, p.y, 10, 160, 0.32, 3, 1, 0.541, 0, 0.9);
          abLand = 0;
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // triple exhaust
          var a = p.angle + Math.PI;
          for (var s = -1; s <= 1; s++) {
            var bx = p.x + Math.cos(a + s * 0.32) * C.SHIP_R * 1.1;
            var by = p.y + Math.sin(a + s * 0.32) * C.SHIP_R * 1.1;
            NA.R.dot(NA.R.L.AFTER, bx, by, 2.2, 1, 0.541, 0, 0.5 + 0.25 * Math.sin(NA.Time.t * 18 + s));
          }
        }
      }
    ]
  });

  /* ----------------------------------------------------------- 18. PHASE */
  U.define('phase', {
    family: 'movement', tags: ['dash', 'mana'], wild: false,
    visual: { slot: 'wings' },
    tiers: [
      { // T1 — the dash deletes enemy bullets in your path
        apply: function () { phTier = Math.max(phTier, 1); },
        update: function (dt) {
          var p = NA.Player;
          if (p.dashT <= 0) return;
          var n = NA.Bullets.clearArea(p.x, p.y, 62, false);
          if (n && phTier >= 2) phStored = Math.min(20, phStored + n);
        },
        render: function () {
          var p = NA.Player; if (!p.alive || p.dashT <= 0) return;
          NA.R.ring(NA.R.L.AFTER, p.x, p.y, 62, 1.4, VI[0], VI[1], VI[2], 0.4);
        }
      },
      { // T2 — the deleted bullets are stored (20) and re-fired on your next shot
        apply: function () { phTier = Math.max(phTier, 2); },
        onFire: function (ctx) {
          if (phStored <= 0) return;
          var n = Math.min(4, phStored);
          phStored -= n;
          for (var k = 0; k < n; k++) {
            H.fireBullet(ctx.x, ctx.y, ctx.angle + (k - (n - 1) / 2) * 0.16, {
              dmgMul: 0.9, r: VI[0], g: VI[1], b: VI[2],
              size: NA.Player.stats.bulletSize * 0.9
            });
          }
        },
        render: function () {
          var p = NA.Player; if (!p.alive || phStored <= 0) return;
          // storage cylinder: a stack of stored rounds along the spine
          var a = p.angle + Math.PI;
          for (var k = 0; k < Math.min(10, phStored); k++) {
            var d = C.SHIP_R * (0.6 + k * 0.22);
            NA.R.dot(NA.R.L.PLAYER, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1.5,
              VI[0], VI[1], VI[2], 0.8);
          }
        }
      },
      { // T3 — dash through walls
        apply: function () { phTier = 3; },
        update: function (dt) {
          var p = NA.Player;
          if (p.dashT <= 0) return;
          if (NA.Arena.depth(p.x, p.y) > 0) return;
          // push back through the membrane's spring so the dash actually crosses
          p.x += p.dashVX * dt * 0.9; p.y += p.dashVY * dt * 0.9;
          p.dashIFrame = Math.max(p.dashIFrame, 0.08);
          NA.Arena.ripple(p.x, p.y, 0.8, VI[0], VI[1], VI[2]);
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          NA.R.sprite(NA.R.L.AFTER, 'shipHull', p.x, p.y, p.angle, C.SHIP_R * 1.9, C.SHIP_R * 1.6,
            VI[0], VI[1], VI[2], 0.18);
        }
      }
    ]
  });

  /* ----------------------------------------------------------- 19. DRIFT */
  var SK = 48, skHead = 0;
  var skx = new Float32Array(SK), sky = new Float32Array(SK), skt = new Float32Array(SK);
  var skTick = 0, skDmgTick = 0;
  U.define('drift', {
    family: 'movement', tags: ['dash', 'bounce', 'zone'], wild: false,
    visual: { slot: 'trail' },
    tiers: [
      { // T1 — icy momentum, +40% top speed, braking costs 3 mana
        apply: function () {
          dfTier = Math.max(dfTier, 1);
          U.mods.speed *= 1.4;
          if (NA.Ship) NA.Ship.setSlot('wings', Math.max(NA.Ship.getSlot('wings'), 1));
        },
        update: function (dt) {
          var p = NA.Player;
          if (!p.alive || p.dashT > 0) return;
          if (dfBrakeCd > 0) dfBrakeCd -= dt;
          var sp2 = p.vx * p.vx + p.vy * p.vy;
          if (sp2 < 100) return;
          var sp = Math.sqrt(sp2);
          var ax = NA.Input.axis();
          var dot = (ax.x * p.vx + ax.y * p.vy) / sp;
          if ((ax.x || ax.y) && dot < -0.25) {
            // braking: only if you pay for it, otherwise you keep sliding
            if (dfBrakeCd <= 0 && H.spend(3, 'brake')) {
              dfBrakeCd = 0.3;
              NA.Particles.ring(p.x, p.y, 6, 40, 0.24, 2, CY[0], CY[1], CY[2], 0.7);
            }
            if (dfBrakeCd > 0) { p.vx *= 1 - 5.5 * dt; p.vy *= 1 - 5.5 * dt; return; }
          }
          // counteract most of the base friction: the ship is on ice
          var k = 1 + 6.4 * dt;
          p.vx *= k; p.vy *= k;
          var mx = p.stats.speed;
          var nsp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (nsp > mx) { p.vx = p.vx / nsp * mx; p.vy = p.vy / nsp * mx; }
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // racing stripe along the hull
          NA.R.line(NA.R.L.PLAYER, p.x - Math.cos(p.angle) * C.SHIP_R, p.y - Math.sin(p.angle) * C.SHIP_R,
            p.x + Math.cos(p.angle) * C.SHIP_R, p.y + Math.sin(p.angle) * C.SHIP_R,
            1.2, 1, 1, 1, 0.5);
        }
      },
      { // T2 — sliding sideways lays a damaging skid trail
        apply: function () { dfTier = Math.max(dfTier, 2); },
        update: function (dt) {
          var p = NA.Player, i;
          for (i = 0; i < SK; i++) if (skt[i] > 0) skt[i] -= dt;
          if (!p.alive) return;
          var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (sp > 230) {
            var va = Math.atan2(p.vy, p.vx);
            if (Math.abs(M.norm(va - p.angle)) > 1.1) {          // sliding sideways
              skTick -= dt;
              if (skTick <= 0) {
                skTick = 0.05;
                skx[skHead] = p.x; sky[skHead] = p.y; skt[skHead] = 1.2;
                skHead = (skHead + 1) % SK;
              }
            }
          }
          skDmgTick -= dt;
          if (skDmgTick > 0) return;
          skDmgTick = 0.2;
          var E = NA.Enemies; if (!E || !E.n) return;
          for (i = 0; i < SK; i++) {
            if (skt[i] <= 0) continue;
            var cnt = E.grid.query(skx[i], sky[i], 26), out = E.grid.out;
            for (var q = 0; q < cnt; q++) {
              var e = out[q]; if (e >= E.n) continue;
              H.damageEnemy(e, p.stats.damage * 0.3, 'player');
            }
          }
        },
        render: function () {
          for (var i = 0; i < SK; i++) {
            if (skt[i] <= 0) continue;
            var a = M.clamp01(skt[i] / 1.2);
            NA.R.dot(NA.R.L.FLOOR, skx[i], sky[i], 7 * a + 2, CY[0], CY[1], CY[2], a * 0.35);
          }
        }
      },
      { // T3 — hitting a wall at speed bounces you: i-frames and a shockwave
        apply: function () { dfTier = 3; },
        update: function (dt) {
          var p = NA.Player;
          if (dfBounceCd > 0) dfBounceCd -= dt;
          if (!p.alive || dfBounceCd > 0) return;
          var sp2 = p.vx * p.vx + p.vy * p.vy;
          if (sp2 < 260 * 260) return;
          if (NA.Arena.depth(p.x, p.y) > 26) return;
          var a = Math.atan2(p.y - NA.Arena.cy, p.x - NA.Arena.cx);
          var nx = -Math.cos(a), ny = -Math.sin(a);
          var vn = p.vx * nx + p.vy * ny;
          p.vx -= 2 * vn * nx; p.vy -= 2 * vn * ny;
          p.dashIFrame = Math.max(p.dashIFrame, 0.35);
          dfBounceCd = 0.35;
          NA.Arena.ripple(p.x, p.y, 1.6, CY[0], CY[1], CY[2]);
          NA.Particles.ring(p.x, p.y, 10, 190, 0.35, 3, CY[0], CY[1], CY[2], 0.95);
          H.pushArea(p.x, p.y, 190, 520, 0);
          H.damageArea(p.x, p.y, 190, p.stats.damage * 1.2, 'player', null);
          NA.FX.trauma(0.22);
          if (NA.Audio) NA.Audio.sfx('wall', { x: p.x, y: p.y });
        },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // rubber bumpers on the nose
          for (var s = -1; s <= 1; s += 2) {
            var a = p.angle + s * 0.85;
            NA.R.dot(NA.R.L.PLAYER, p.x + Math.cos(a) * C.SHIP_R * 1.3, p.y + Math.sin(a) * C.SHIP_R * 1.3,
              2.2, 1, 1, 1, 0.55);
          }
        }
      }
    ]
  });

  /* ----------------------------------------------------------- 20. BLINK */
  var decoyX = 0, decoyY = 0, decoyT = 0;
  function doBlink() {
    var p = NA.Player;
    if (!p.alive || p.dashCd > 0) return false;
    if (!H.spend(25, 'blink')) return false;
    var dx = p.aimX - p.x, dy = p.aimY - p.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var range = Math.min(d, 460);
    var tx = p.x + dx / d * range, ty = p.y + dy / d * range;
    // never blink outside the membrane
    var ang = Math.atan2(ty - NA.Arena.cy, tx - NA.Arena.cx);
    var rr = NA.Arena.radiusAt(ang) - C.SHIP_R - 6;
    var td = M.dist(tx, ty, NA.Arena.cx, NA.Arena.cy);
    if (td > rr) { tx = NA.Arena.cx + Math.cos(ang) * rr; ty = NA.Arena.cy + Math.sin(ang) * rr; }

    if (blTier >= 2) { decoyX = p.x; decoyY = p.y; decoyT = 2.2; }   // T2 decoy

    var ox = p.x, oy = p.y;
    for (var k = 0; k < 6; k++) {
      var t = k / 5;
      NA.Particles.afterImage(M.lerp(ox, tx, t), M.lerp(oy, ty, t), p.angle, C.SHIP_R * 1.55,
        0.3, MG[0], MG[1], MG[2], 0.45 - t * 0.3, 0);
    }
    p.x = tx; p.y = ty;
    p.dashIFrame = Math.max(p.dashIFrame, 0.22);
    p.dashCd = 0.22;

    if (blTier >= 3) {
      // T3 — landing on an enemy swaps places with it and stuns it for a 3x hit
      var e = H.nearestEnemy(tx, ty, 70, -1);
      if (e >= 0) {
        var E = NA.Enemies;
        var ex = E.x[e], ey = E.y[e];
        E.x[e] = ox; E.y[e] = oy; E.vx[e] = 0; E.vy[e] = 0;
        p.x = ex; p.y = ey;
        H.setStun(e, 1.5);
        H.damageEnemy(e, p.stats.damage * 3, 'player');
        NA.Particles.ring(ex, ey, 6, 90, 0.32, 3, MG[0], MG[1], MG[2], 1);
        NA.FX.hitStop(50); NA.FX.trauma(0.18);
      }
    }
    NA.Particles.ring(ox, oy, 4, 60, 0.3, 2.4, MG[0], MG[1], MG[2], 0.9);
    NA.Particles.ring(p.x, p.y, 60, 4, 0.3, 2.4, MG[0], MG[1], MG[2], 0.9);
    NA.FX.chroma(2, 140);
    if (NA.Audio) NA.Audio.sfx('dash', { x: p.x, y: p.y });
    return true;
  }
  U.define('blink', {
    family: 'movement', tags: ['dash', 'mana', 'explode'], wild: false,
    visual: { slot: 'wings' }, excludes: ['afterburner'],
    tiers: [
      { // T1 — teleport to the cursor for 25 mana (this REPLACES the dash)
        apply: function () { blTier = Math.max(blTier, 1); },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // portal wingtips
          for (var s = -1; s <= 1; s += 2) {
            var a = p.angle + s * 2.45;
            NA.R.ring(NA.R.L.PLAYER, p.x + Math.cos(a) * C.SHIP_R * 1.9, p.y + Math.sin(a) * C.SHIP_R * 1.9,
              3.2, 1.1, MG[0], MG[1], MG[2], H.canSpend(25) ? 0.8 : 0.25);
          }
        }
      },
      { // T2 — you leave a decoy: enemies chase it, then it detonates
        apply: function () { blTier = Math.max(blTier, 2); },
        update: function (dt) {
          if (decoyT <= 0) return;
          decoyT -= dt;
          var E = NA.Enemies;
          if (E && E.n) {
            var cnt = E.grid.query(decoyX, decoyY, 420), out = E.grid.out;
            for (var q = 0; q < cnt; q++) {
              var e = out[q]; if (e >= E.n) continue;
              var dx = decoyX - E.x[e], dy = decoyY - E.y[e];
              var l = Math.sqrt(dx * dx + dy * dy) || 1;
              E.vx[e] += dx / l * 520 * dt; E.vy[e] += dy / l * 520 * dt;
            }
          }
          NA.Enemies.telegraphCircle(decoyX, decoyY, 150, 2.2 - decoyT, 2.2, 1.6);
          if (decoyT <= 0) {
            H.queueExplode(decoyX, decoyY, 150, NA.Player.stats.damage * 2, 0, 0);
            decoyT = 0;
          }
        },
        render: function () {
          if (decoyT <= 0) return;
          var a = M.clamp01(decoyT / 2.2);
          NA.Ship.render(decoyX, decoyY, NA.Player.angle, 0.28 + 0.2 * (1 - a), 1, MGC);
        }
      },
      { // T3 — blinking onto an enemy swaps places with it
        apply: function () { blTier = 3; },
        render: function () {
          var p = NA.Player; if (!p.alive) return;
          // third-eye decal
          NA.R.dot(NA.R.L.PLAYER, p.x + Math.cos(p.angle) * C.SHIP_R * 0.5,
            p.y + Math.sin(p.angle) * C.SHIP_R * 0.5, 2, MG[0], MG[1], MG[2], 0.9);
        }
      }
    ]
  });
  var MGC = [MG[0], MG[1], MG[2]];

  /* keep prevDashT for the momentum test, once per frame, after every tier */
  var origPost = H._postUpdate;
  H._postUpdate = function (dt) {
    origPost(dt);
    prevDashT = NA.Player ? NA.Player.dashT : 0;
  };
})();
