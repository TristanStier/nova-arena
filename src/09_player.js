/* 09_player.js — the ship: movement, aim, fire, dash, HP, mana, death shatter,
 * and the nine-slot ship visual system.
 *
 * Public API
 *   NA.Player.reset(opts) / update(dt) / render()
 *   NA.Player.x y vx vy angle hp maxHp mana manaMax alive invuln dashIFrame
 *   NA.Player.stats        {fireRate, damage, speed, bulletSpeed, bulletSize, count,
 *                           spread, pierce, bounce, homing, explode, life, manaTrickle,
 *                           dashCost, dashDist, grazeMul}
 *   NA.Player.mods         {enemyFireMul}  published modifiers other systems READ:
 *                          enemyFireMul multiplies every enemy fire COOLDOWN
 *                          (<1 = the field shoots more often; Feedback Loop T1)
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

  /* ---- ornament brightness caps (GAME_PLAN 6.2 "fixed z-order and brightness
   * caps", 10.1 "only your core, your bullets and the thing about to kill you
   * are pure white").  L.PLAYER is non-additive, so ornaments are clamped and
   * the soft glow gets a per-frame budget on the additive layer below. */
  var ORN_MAX = 0.55;                 // max alpha for any slot ornament
  var GLOW_BUDGET = 0.5, gRem = 0;    // additive soft-glow budget per ship
  function oA(a) { return a > ORN_MAX ? ORN_MAX : (a < 0 ? 0 : a); }
  function gA(a) { if (gRem <= 0 || a <= 0) return 0; if (a > gRem) a = gRem; gRem -= a; return a; }
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
     * and is always the brightest pixel near the ship.
     *
     * F1 CONTRACT (GAME_PLAN 10.1 / 6.2): L.PLAYER is NOT additive, so every
     * ornament here obeys two caps:
     *   - oA()  clamps slot-ornament alpha, so a ten-slot build never paints a
     *           solid disc over the hull;
     *   - gA()  spends a per-frame budget of SOFT GLOW, drawn on L.PBULLETS
     *           (additive, one layer BELOW the ship) so the bloom lives around
     *           the ship instead of inside it.
     * Only the core dot is ever pure white; every other highlight uses the
     * half-tint (hr,hg,hb) of the current hull colour. */
    render: function (x, y, rot, alpha, scale, colOv) {
      var R = NA.R, L = R.L, s = Ship.slots;
      var PL = L.PLAYER, GLOW = L.PBULLETS;      // GLOW is additive, below PL
      scale = scale || 1;
      alpha = alpha === undefined ? 1 : alpha;
      var base = C.SHIP_R * scale;
      var col = colOv || Ship.tint || C.COL.player;
      var cr = col[0], cg = col[1], cb = col[2];
      // ornament highlight: never pure white — the core owns white
      var hr = 0.30 + cr * 0.70, hg = 0.30 + cg * 0.70, hb = 0.30 + cb * 0.70;
      var t = NA.Time.t;
      var sa = t * Ship.SPIN_A, sb = t * Ship.SPIN_B;
      gRem = GLOW_BUDGET * alpha;

      // ---- aura (Ghost, Vent, Feedback Loop)
      if (s.aura > 0) {
        R.disc(GLOW, x, y, base * (2.6 + s.aura * 0.35), cr, cg, cb, gA(0.05 * alpha));
        if (s.aura >= 2) R.ring(PL, x, y, base * 3.1, 1.4, cr, cg, cb, oA(0.24) * alpha);
        if (s.aura >= 3) {
          R.ring(PL, x, y, base * 3.9, 1.2, cr, cg, cb, oA(0.18) * alpha);
          for (var m = 0; m < 4; m++) {
            var ma = sa + m * M.HALFPI;
            R.dot(PL, x + Math.cos(ma) * base * 3.5, y + Math.sin(ma) * base * 3.5, base * 0.15, hr, hg, hb, oA(0.5) * alpha);
          }
        }
      }
      // ---- halo (mana: Overcharge, Spendthrift) — gold, drawn as an arc behind
      if (s.halo > 0) {
        var g = C.COL.gold;
        var frac = NA.Player ? NA.Player.mana / NA.Player.manaMax : 1;
        var a0 = rot + Math.PI * 0.55, a1 = a0 + Math.PI * 0.9 * (s.halo >= 3 ? 1 : frac);
        R.arc(PL, x, y, base * 2.15, a0, a1, 2.2, g[0], g[1], g[2], oA(0.5) * alpha);
        if (s.halo >= 2) for (var tk = 0; tk < 6; tk++) {
          var ta = a0 + (a1 - a0) * (tk / 5);
          R.line(PL, x + Math.cos(ta) * base * 1.95, y + Math.sin(ta) * base * 1.95,
            x + Math.cos(ta) * base * 2.35, y + Math.sin(ta) * base * 2.35, 1.4, g[0], g[1], g[2], oA(0.45) * alpha);
        }
        if (s.halo >= 3) R.ring(PL, x, y, base * 2.15, 1.6, g[0], g[1], g[2],
          oA(0.4 + 0.3 * Math.sin(t * 4)) * alpha);
      }
      // ---- wings (Afterburner, Phase, Blink, Drift)
      if (s.wings > 0) {
        var wl = base * (1.5 + s.wings * 0.42);
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          var wa = rot + sgn * 2.45;
          var bx = x + Math.cos(rot + sgn * 2.7) * base * 0.9, by = y + Math.sin(rot + sgn * 2.7) * base * 0.9;
          R.line(PL, bx, by, bx + Math.cos(wa) * wl, by + Math.sin(wa) * wl, 2.2, cr, cg, cb, 0.85 * alpha);
          if (s.wings >= 3) R.line(PL, bx, by, bx + Math.cos(wa - 0.25) * wl * 0.8, by + Math.sin(wa - 0.25) * wl * 0.8,
            1.4, hr, hg, hb, oA(0.4) * alpha);
        }
      }
      // ---- fins (Ricochet, Reaper, Overkill, Seeker)
      if (s.fins > 0) {
        var fn = s.fins >= 2 ? 2 : 1;
        for (var f = 0; f < fn; f++) {
          var fa = rot + Math.PI + (f === 0 ? 0.45 : -0.45) * (fn > 1 ? 1 : 0);
          var fx = x + Math.cos(rot + Math.PI) * base * 0.7, fy = y + Math.sin(rot + Math.PI) * base * 0.7;
          var ex = fx + Math.cos(fa) * base * 1.2, ey = fy + Math.sin(fa) * base * 1.2;
          R.line(PL, fx, fy, ex, ey, 2, cr, cg, cb, 0.8 * alpha);
          if (s.fins >= 3) R.dot(PL, ex, ey, base * 0.16, hr, hg, hb, oA(0.5) * alpha);
        }
      }
      // ---- hull: the dagger silhouette
      R.sprite(PL, 'shipHull', x, y, rot, base * 1.55, base * 1.35, cr, cg, cb, 0.95 * alpha);
      if (s.hull >= 2) R.sprite(PL, 'shipHull', x, y, rot, base * 1.42, base * 1.22, hr, hg, hb, oA(0.22) * alpha);
      // ---- barrels (Twin Barrels, Railgun, Buckshot, Gatling, Mortar)
      if (s.barrels > 0) {
        var bn = s.barrels >= 3 ? 3 : s.barrels;
        for (var bq = 0; bq < bn; bq++) {
          var off = (bq - (bn - 1) / 2) * 0.30;
          var bxx = x + Math.cos(rot + off) * base * 1.0, byy = y + Math.sin(rot + off) * base * 1.0;
          R.line(PL, bxx, byy, bxx + Math.cos(rot + off * 0.4) * base * 0.9,
            byy + Math.sin(rot + off * 0.4) * base * 0.9, 2.4, cr, cg, cb, 0.9 * alpha);
        }
      }
      // ---- orbitals (Shard Orbit, Drone, Turret, Mirror, Storm Cloud, Mines)
      if (s.orbitals > 0) {
        var on = Math.min(4, s.orbitals + (s.orbitals >= 3 ? 1 : 0));
        for (var o = 0; o < on; o++) {
          var oa = sb + o / on * M.TAU;
          var ox = x + Math.cos(oa) * base * 3.2, oy = y + Math.sin(oa) * base * 3.2;
          R.poly(PL, ox, oy, base * 0.34, 4, oa * 2, 1.4, 1, 0.45, 0.85, oA(0.85) * alpha);
        }
        if (s.orbitals >= 4) R.ring(PL, x, y, base * 3.2, 1, 1, 0.45, 0.85, oA(0.22) * alpha);
      }
      // ---- core: always the brightest pixel near the ship.  The soft halo goes
      // to the additive layer BELOW the ship, the white dot on top of the hull.
      var coreK = 1 + (s.core >= 3 ? 0.25 * Math.sin(t * 6) : 0);
      R.sprite(GLOW, 'spark', x, y, 0, base * 1.15, base * 1.15, cr, cg, cb, gA(0.30 * alpha));
      R.sprite(PL, 'shipCore', x, y, 0, base * 1.05 * coreK, base * 1.05 * coreK, 1, 1, 1, alpha);
      // NA.Upgrades.render() paints its ornaments into L.PLAYER *after* the ship,
      // so the one pure white in the game gets a second, smaller pass on the
      // additive veil: nothing an upgrade draws can bury the core dot.
      R.sprite(L.VEIL, 'shipCore', x, y, 0, base * 0.62 * coreK, base * 0.62 * coreK, 1, 1, 1, 0.9 * alpha);
      if (s.core >= 3) {
        R.line(PL, x - base * 2.4, y, x + base * 2.4, y, 1.2, hr, hg, hb, oA(0.22) * alpha);
      }
      // ---- crown (Wildcards): one unique ornament above the ship
      if (s.crown > 0) {
        var ca = rot - M.HALFPI;
        var cxp = x + Math.cos(ca) * base * 2.1, cyp = y + Math.sin(ca) * base * 2.1;
        R.poly(PL, cxp, cyp, base * 0.5, 3, sa, 1.6, 1, 0.235, 0.675, oA(0.85) * alpha);
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
    /* Published modifier table other systems READ (never write, except the
     * upgrade that owns the field).  enemyFireMul multiplies every enemy fire
     * COOLDOWN: <1 = the field shoots more often (Feedback Loop T1 = 1/1.3). */
    mods: { enemyFireMul: 1 },
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
      Pl.killManaSpent = 0; Pl.killManaWindow = 0;   // correctness #10
      Pl.firing = false; Pl.muzzle = 0; Pl.recoil = 0; Pl._wallCd = 0;
      Pl.mods.enemyFireMul = 1;
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
      for (var i = 1; R.trails && i <= TRAIL_N; i++) {
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
        var mc = Ship.tint || C.COL.player;
        R.sprite(L.PBULLETS, 'flash', mx, my, Pl.angle, 13, 13, mc[0], mc[1], mc[2], 0.45 * Math.min(1, Pl.muzzle * 18));
      }
      // low HP heartbeat vignette
      if (Pl.hp <= 1) {
        var hb = 0.5 + 0.5 * Math.sin(NA.Time.real * M.TAU / 1.2);
        NA.FX.vignette = 0.32 + hb * 0.30;
      } else NA.FX.vignette = 0.32;

      // reticle — deliberately minimal: a cyan dot, with a hairline ring at most
      if (NA.Store.settings.reticle) {
        var k2 = Math.min(1.4, NA.Store.settings.reticle);
        var rc = C.COL.player;
        R.ring(L.HUD, Pl.aimX, Pl.aimY, 5.5 * k2, 0.3, rc[0], rc[1], rc[2], 0.16);
        R.dot(L.HUD, Pl.aimX, Pl.aimY, 2 * k2, rc[0], rc[1], rc[2], 0.95);
      }
    }
  };

  var AIM = { x: 0, y: 0 }, STICK = { x: 0, y: 0 }, TMPC = [1, 1, 1];
  var FCTX = { x: 0, y: 0, angle: 0 };
  var DCTX = { x: 0, y: 0, vx: 0, vy: 0 };
  var SCTX = { amount: 0, tag: '' };
})();
