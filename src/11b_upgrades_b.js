/* 11b_upgrades_b.js — UPGRADES-B: the second half of the Upgrade Bible,
 * GAME_PLAN §6 numbers 21–42.  Loads after 11_upgrades.js (filename order:
 * "11_upgrades.js" < "11b_upgrades_b.js" < "12_events.js").
 *
 *   E. Defense            hullPlating vent ghost
 *   F. Chain reactions    reaper impact wake spendthrift overkill
 *   G. Summons/orbitals   shardOrbit drone turret mirror
 *   H. Area and fields    mines stormCloud gravityWell burnTrail
 *   I. Wildcards          ghostRounds claustrophobia glassHull berserk
 *                         feedbackLoop gambler
 *
 * Nothing here writes to 11_upgrades.js.  Shared helpers published by
 * UPGRADES-A as NA.Upgrades.helpers.{explode,chainLightning,fireBullet,
 * nearestEnemy} are preferred at every call site; until they exist the local
 * `_b*` fallbacks below are used, so this file is never blocked.
 *
 * Two things this file owns that other agents may read (never write):
 *   NA.Player.mods.enemyFireMul      -> multiplies every enemy fire COOLDOWN
 *                                       (1/1.3 while Feedback Loop T1 is owned)
 *   NA.Upgrades.enemyFireRateMul()   -> multiplier enemy types should apply to
 *                                       their own fire period (Feedback Loop T1)
 *   NA.Upgrades.mods.{damageB, fireRateB, speedB, trickleB, enemyFireRateB}
 *                                    -> this file's aggregate multipliers,
 *                                       informational; already applied to
 *                                       NA.Player.stats by statTick().
 *
 * Performance contract: every system below is a fixed-size typed-array pool
 * with a hard cap, squared distances only, zero allocation per frame.
 */
(function () {
  var M = NA.M, C = NA.C, U = NA.Upgrades;
  var Pl = NA.Player, B = NA.Bullets, En = NA.Enemies, Ship = NA.Ship;
  var R = NA.R, L = NA.R.L, COL = C.COL;
  var TAU = M.TAU;

  function T(id) { return U.owned[id] || 0; }

  /* ==================================================================== */
  /* Shared helpers — UPGRADES-A's if present, otherwise the local `_b`    */
  /* versions.  Checked per call so they light up the moment they appear.  */
  /* ==================================================================== */
  var BO = { dmg: 10, size: 7, pierce: 0, bounce: 0, homing: 0, explode: 0, life: 1.6, flags: 0, r: 1, g: 1, b: 1, a: 1 };
  function bo(dmg, size, life) {
    BO.dmg = dmg; BO.size = size; BO.life = life;
    BO.pierce = 0; BO.bounce = 0; BO.homing = 0; BO.explode = 0; BO.flags = 0;
    BO.r = 1; BO.g = 1; BO.b = 1; BO.a = 1;
    return BO;
  }

  function _bExplode(x, y, r, dmg) { B.explode(x, y, r, dmg, 0); }
  function _bFireBullet(x, y, vx, vy, o) { return B.firePlayer(x, y, vx, vy, o); }
  function _bNearestEnemy(x, y, r) { return En.nearestTo(x, y, r === undefined ? 900 : r); }
  /* Local chain lightning: hop to distinct neighbours, drawing one bolt each. */
  var CHAIN_SEEN = new Int32Array(8);
  function _bChainLightning(x, y, dmg, hops, radius) {
    var cx = x, cy = y, n = 0;
    hops = Math.min(8, hops | 0); radius = radius || 260;
    for (var h = 0; h < hops; h++) {
      var cnt = En.grid.query(cx, cy, radius), out = En.grid.out;
      var best = -1, bd = 1e18;
      for (var q = 0; q < cnt; q++) {
        var i = out[q];
        if (i >= En.n || En.intangible[i] > 0 || En.ally[i] > 0) continue;
        var seen = false;
        for (var s = 0; s < n; s++) if (CHAIN_SEEN[s] === i) { seen = true; break; }
        if (seen) continue;
        var dx = En.x[i] - cx, dy = En.y[i] - cy, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (best < 0) break;
      NA.Particles.bolt(cx, cy, En.x[best], En.y[best], 0.16, 5, 0.45, 0.95, 1, 2);
      cx = En.x[best]; cy = En.y[best];
      if (n < 8) CHAIN_SEEN[n++] = best;
      hDamage(best, dmg, 'player');
    }
    return n;
  }

  function hExplode(x, y, r, dmg) {
    var h = U.helpers;
    if (h && h.explode) { h.explode(x, y, r, dmg, 0); return; }
    _bExplode(x, y, r, dmg);
  }
  /* Local call shape stays (x, y, vx, vy, o); UPGRADES-A's helper takes
   * (x, y, angle, o) with o.speed, so translate on the way through. */
  function hFire(x, y, vx, vy, o) {
    var h = U.helpers;
    if (h && h.fireBullet) {
      o.speed = Math.sqrt(vx * vx + vy * vy);
      return h.fireBullet(x, y, Math.atan2(vy, vx), o);
    }
    return _bFireBullet(x, y, vx, vy, o);
  }
  /* F12 — the ONLY damage path this file may use.  H.damageEnemy honours the
   * Voltaic Charged status (+30%), which a raw En.damage() silently skips, so
   * every mine, turret, drone, shard, cloud, ally, wall and burn tick below
   * goes through here. */
  function hDamage(ei, dmg, src) {
    var h = U.helpers;
    if (h && h.damageEnemy) return h.damageEnemy(ei, dmg, src || 'player');
    return En.damage(ei, dmg, src || 'player');
  }
  /* F13 — every flat damage constant in this file is quoted at the BASE gun
   * (C.BULLET_DMG) and scaled by the live build, exactly like file A. */
  function hPD(base) {
    var h = U.helpers;
    if (h && h.playerDamage) return h.playerDamage(base);
    return base * (Pl.stats.damage / C.BULLET_DMG);
  }
  /* F23 — one burn status for the whole game: Gatling's burn and Burn Trail's
   * are the same state, so T3's fire pools also light off a Gatling burn. */
  function hBurn(ei, secs, dps) {
    var h = U.helpers;
    if (h && h.setBurn) h.setBurn(ei, secs, dps);
    else if (ei >= 0 && ei < burnT.length) burnT[ei] = secs;
  }
  function hBurning(ei) {
    var h = U.helpers;
    if (h && h.isBurning) return h.isBurning(ei);
    return ei >= 0 && ei < burnT.length && burnT[ei] > 0;
  }
  /* F14 — this file's tap actives share the one active key with file A's.
   * Registration order is priority; successive taps round-robin, so a build
   * with Pulse + Turret + Well + Shards can reach all four instead of paying
   * for all four on one press. */
  if (U.helpers && U.helpers.registerTapActive) {
    U.helpers.registerTapActive('shardOrbit');
    U.helpers.registerTapActive('turret');
    U.helpers.registerTapActive('gravityWell');
  }
  function hActive(id) {
    var h = U.helpers;
    if (h && h.tapClaim && id) return h.tapClaim(id);
    if (h && h.activePressed) return h.activePressed();
    return NA.Input.pressed('active');
  }
  /* Every active in the game pays through NA.Upgrades.mods.manaCost — one
   * path, so Berserk's +30% and any future discount compose instead of
   * one file taxing its own actives and no others. */
  function pay(n, tag) {
    var h = U.helpers;
    if (h && h.spend) return h.spend(n, tag || 'active');
    return Pl.spend(n * (U.mods ? U.mods.manaCost : 1), tag);
  }
  function hNearest(x, y, r) {
    var h = U.helpers;
    if (h && h.nearestEnemy) return h.nearestEnemy(x, y, r);
    return _bNearestEnemy(x, y, r);
  }
  function hChain(x, y, dmg, hops, radius) {
    var h = U.helpers;
    if (h && h.chainLightning) return h.chainLightning(x, y, dmg, hops, radius);
    return _bChainLightning(x, y, dmg, hops, radius);
  }

  /* Nearest enemy that is not one of your own resurrected allies. */
  function nearestFoe(x, y, r) {
    var cnt = En.grid.query(x, y, r), out = En.grid.out, best = -1, bd = 1e18;
    for (var q = 0; q < cnt; q++) {
      var i = out[q];
      if (i >= En.n || En.intangible[i] > 0 || (En.ally && En.ally[i] > 0)) continue;
      var dx = En.x[i] - x, dy = En.y[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  }

  /* A pulse: delete enemy bullets, shove and hurt enemies, one ring. */
  function pulseAt(x, y, radius, dmg, stun) {
    B.clearArea(x, y, radius, false);
    var cnt = En.grid.query(x, y, radius), out = En.grid.out;
    for (var q = 0; q < cnt; q++) {
      var i = out[q];
      if (i >= En.n || (En.ally && En.ally[i] > 0)) continue;
      var dx = En.x[i] - x, dy = En.y[i] - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      En.vx[i] += dx / d * 420; En.vy[i] += dy / d * 420;
      if (stun) En.t2[i] = Math.max(En.t2[i], 0);
      if (dmg > 0) hDamage(i, dmg, 'player');
    }
    NA.Particles.ring(x, y, radius * 0.2, radius, 0.34, 3.2, 0.62, 0.42, 1, 0.95);
    NA.FX.trauma(0.06);
    if (NA.Audio) NA.Audio.sfx('explode', { x: x, y: y, vol: 0.5 });
  }

  /* ==================================================================== */
  /* MINE FIELD — shared by Mines and by Wake T2.  Hard cap 24.           */
  /* ==================================================================== */
  var MINE_MAX = 24;
  var mnX = new Float32Array(MINE_MAX), mnY = new Float32Array(MINE_MAX);
  var mnVX = new Float32Array(MINE_MAX), mnVY = new Float32Array(MINE_MAX);
  var mnLife = new Float32Array(MINE_MAX), mnArm = new Float32Array(MINE_MAX);
  var mnFuse = new Float32Array(MINE_MAX);            // >0 = fuse burning to a chain pop
  var mnN = 0, mineFrame = -1, mineDropT = 0;

  function mineAdd(x, y) {
    var cap = 12;                       // F7: fixed at 12 for all three tiers
    if (mnN >= cap) { mineBoom(0); }
    if (mnN >= MINE_MAX) return;
    var i = mnN++;
    mnX[i] = x; mnY[i] = y; mnVX[i] = 0; mnVY[i] = 0;
    mnLife[i] = 14; mnArm[i] = 0.45; mnFuse[i] = 0;
  }
  function mineFree(i) {
    var last = --mnN;
    if (i !== last) {
      mnX[i] = mnX[last]; mnY[i] = mnY[last]; mnVX[i] = mnVX[last]; mnVY[i] = mnVY[last];
      mnLife[i] = mnLife[last]; mnArm[i] = mnArm[last]; mnFuse[i] = mnFuse[last];
    }
  }
  function mineBoom(i) {
    var x = mnX[i], y = mnY[i];
    mineFree(i);
    hExplode(x, y, 120, hPD(34));
    NA.Particles.ring(x, y, 10, 130, 0.3, 3, 1, 0.54, 0, 0.9);
    // T3: light the fuse on every neighbour within 260 — a visible chain
    if (T('mines') >= 3) {
      for (var k = 0; k < mnN; k++) {
        if (mnFuse[k] > 0) continue;
        var dx = mnX[k] - x, dy = mnY[k] - y;
        if (dx * dx + dy * dy < 260 * 260) { mnFuse[k] = 0.28; }
      }
    }
  }
  function mineTick(dt) {
    if (mineFrame === NA.Time.frames) return;
    mineFrame = NA.Time.frames;
    var magnet = T('mines') >= 2;
    for (var i = 0; i < mnN; i++) {
      mnLife[i] -= dt;
      if (mnArm[i] > 0) mnArm[i] -= dt;
      if (mnFuse[i] > 0) { mnFuse[i] -= dt; if (mnFuse[i] <= 0) { mineBoom(i); i--; continue; } }
      if (mnLife[i] <= 0) { mineBoom(i); i--; continue; }
      if (magnet) {
        var tgt = nearestFoe(mnX[i], mnY[i], 300);
        if (tgt >= 0) {
          var ax = En.x[tgt] - mnX[i], ay = En.y[tgt] - mnY[i];
          var al = Math.sqrt(ax * ax + ay * ay) || 1;
          mnVX[i] = M.smooth(mnVX[i], ax / al * 150, 4, dt);
          mnVY[i] = M.smooth(mnVY[i], ay / al * 150, 4, dt);
        } else { mnVX[i] *= 0.94; mnVY[i] *= 0.94; }
        mnX[i] += mnVX[i] * dt; mnY[i] += mnVY[i] * dt;
      }
      if (mnArm[i] <= 0 && mnFuse[i] <= 0) {
        var hit = nearestFoe(mnX[i], mnY[i], 46);
        if (hit >= 0) { mineBoom(i); i--; continue; }
      }
    }
  }
  function mineRender() {
    var t = NA.Time.t;
    for (var i = 0; i < mnN; i++) {
      var arm = mnArm[i] <= 0;
      var pulse = 0.55 + 0.45 * Math.sin(t * (mnFuse[i] > 0 ? 40 : 5) + i);
      var cr = mnFuse[i] > 0 ? 1 : 1, cg = mnFuse[i] > 0 ? 0.18 : 0.54, cb = mnFuse[i] > 0 ? 0.30 : 0;
      R.poly(L.PARTICLES, mnX[i], mnY[i], 9, 6, t * 0.9 + i, 1.6, cr, cg, cb, arm ? 0.9 : 0.35);
      R.dot(L.PARTICLES, mnX[i], mnY[i], 2.6, 1, 0.92, 0.85, pulse * (arm ? 0.9 : 0.3));
      if (mnFuse[i] > 0) R.ring(L.PARTICLES, mnX[i], mnY[i], 14 + pulse * 5, 1.2, 1, 0.18, 0.3, 0.8);
    }
  }

  /* ==================================================================== */
  /* SOULS — Reaper T2.  Pooled, magnetised, hard cap 60.                 */
  /* ==================================================================== */
  var SOUL_MAX = 60;
  var slX = new Float32Array(SOUL_MAX), slY = new Float32Array(SOUL_MAX);
  var slVX = new Float32Array(SOUL_MAX), slVY = new Float32Array(SOUL_MAX);
  var slLife = new Float32Array(SOUL_MAX), slPull = new Float32Array(SOUL_MAX);
  var slN = 0, soulBonus = 0;                 // 0..0.60, "+2% damage this wave"

  function soulAdd(x, y) {
    if (slN >= SOUL_MAX) return;
    var i = slN++;
    slX[i] = x; slY[i] = y;
    var a = NA.RNG.f() * TAU;
    slVX[i] = Math.cos(a) * 70; slVY[i] = Math.sin(a) * 70;
    slLife[i] = 9; slPull[i] = 0;
  }
  function soulFree(i) {
    var last = --slN;
    if (i !== last) {
      slX[i] = slX[last]; slY[i] = slY[last]; slVX[i] = slVX[last]; slVY[i] = slVY[last];
      slLife[i] = slLife[last]; slPull[i] = slPull[last];
    }
  }
  function soulVacuum() { for (var i = 0; i < slN; i++) slPull[i] = 1; }
  function soulTick(dt) {
    for (var i = 0; i < slN; i++) {
      slLife[i] -= dt;
      if (slLife[i] <= 0) { soulFree(i); i--; continue; }
      var dx = Pl.x - slX[i], dy = Pl.y - slY[i], d2 = dx * dx + dy * dy;
      var pull = slPull[i] > 0 ? 1400 : (d2 < 190 * 190 ? 520 : 0);
      if (pull) {
        var d = Math.sqrt(d2) || 1;
        slVX[i] += dx / d * pull * dt; slVY[i] += dy / d * pull * dt;
      }
      slVX[i] *= 0.97; slVY[i] *= 0.97;
      slX[i] += slVX[i] * dt; slY[i] += slVY[i] * dt;
      if (d2 < 26 * 26) {
        soulBonus = Math.min(0.60, soulBonus + 0.02);
        NA.Particles.burst(slX[i], slY[i], 3, 90, 0.2, 0.22, 1, 0.42, 2);
        if (NA.Audio) NA.Audio.sfx('graze', { x: slX[i], y: slY[i], vol: 0.3 });
        soulFree(i); i--;
      }
    }
  }
  function soulRender() {
    var t = NA.Time.t;
    for (var i = 0; i < slN; i++) {
      var a = M.clamp01(slLife[i] / 1.2) * 0.9;
      R.dot(L.PARTICLES, slX[i], slY[i], 3.2 + Math.sin(t * 7 + i) * 0.6, 0.22, 1, 0.42, a);
      R.disc(L.PARTICLES, slX[i], slY[i], 12, 0.22, 1, 0.42, a * 0.16);
    }
  }

  /* ==================================================================== */
  /* MARKS — Impact T2/T3.  Cap 8.  Marks live on positions and re-bind to */
  /* the nearest enemy every frame, so the swap-remove pool can't rot them.*/
  /* ==================================================================== */
  var MARK_MAX = 8;
  var mkX = new Float32Array(MARK_MAX), mkY = new Float32Array(MARK_MAX);
  var mkLife = new Float32Array(MARK_MAX), mkEi = new Int32Array(MARK_MAX);
  var mkN = 0, dmgAccum = 0, splashT = 0;

  function markAdd(x, y, ei) {
    for (var k = 0; k < mkN; k++) if (mkEi[k] === ei) { mkLife[k] = 8; return; }
    if (mkN >= MARK_MAX) { markFree(0); }
    var i = mkN++;
    mkX[i] = x; mkY[i] = y; mkEi[i] = ei; mkLife[i] = 8;
  }
  function markFree(i) {
    var last = --mkN;
    if (i !== last) { mkX[i] = mkX[last]; mkY[i] = mkY[last]; mkLife[i] = mkLife[last]; mkEi[i] = mkEi[last]; }
  }
  function markIsMarked(ei) { for (var k = 0; k < mkN; k++) if (mkEi[k] === ei) return k; return -1; }

  /* ==================================================================== */
  /* FIRE POOLS — Burn Trail T3.  Cap 20.                                 */
  /* ==================================================================== */
  var POOL_MAX = 20;
  var fpX = new Float32Array(POOL_MAX), fpY = new Float32Array(POOL_MAX);
  var fpR = new Float32Array(POOL_MAX), fpLife = new Float32Array(POOL_MAX);
  var fpTick = new Float32Array(POOL_MAX);
  var fpN = 0;
  function firePoolAdd(x, y, r) {
    if (fpN >= POOL_MAX) { fpFree(0); }
    var i = fpN++;
    fpX[i] = x; fpY[i] = y; fpR[i] = r; fpLife[i] = 5; fpTick[i] = 0;
  }
  function fpFree(i) {
    var last = --fpN;
    if (i !== last) { fpX[i] = fpX[last]; fpY[i] = fpY[last]; fpR[i] = fpR[last]; fpLife[i] = fpLife[last]; fpTick[i] = fpTick[last]; }
  }

  /* ==================================================================== */
  /* BURN state — a per-enemy-slot burn timer (Burn Trail).               */
  /* ==================================================================== */
  var burnT = new Float32Array(C.MAX_ENEMIES);

  /* ==================================================================== */
  /* TRAIL RING BUFFER — Burn Trail, 60 points.                           */
  /* ==================================================================== */
  var TR_N = 60;
  var trX = new Float32Array(TR_N), trY = new Float32Array(TR_N), trA = new Float32Array(TR_N);
  var trHead = 0, trFilled = 0, trTick = 0, wallT = 0;

  /* ==================================================================== */
  /* MIRROR RING BUFFER — 30 samples taken every 2nd frame = 0.5 s.       */
  /* ==================================================================== */
  var MR_N = 30;
  var mrX = new Float32Array(MR_N), mrY = new Float32Array(MR_N), mrA = new Float32Array(MR_N);
  var mrHead = 0, mrFilled = 0;
  var MPOS = { x: 0, y: 0, a: 0 };
  function mirrorPos(k, count) {
    var tier = T('mirror');
    var px = Pl.x, py = Pl.y, pa = Pl.angle;
    if (tier >= 2 && mrFilled >= MR_N) {
      var idx = mrHead % MR_N;                         // oldest sample = 0.5 s ago
      px = mrX[idx]; py = mrY[idx]; pa = mrA[idx];
    }
    if (tier >= 3) {
      var ang = pa + (k === 0 ? 2.094 : -2.094);       // ±120°
      MPOS.x = px + Math.cos(ang) * 80; MPOS.y = py + Math.sin(ang) * 80;
    } else {
      MPOS.x = px + Math.cos(pa + M.HALFPI) * 80; MPOS.y = py + Math.sin(pa + M.HALFPI) * 80;
    }
    MPOS.a = pa;
    return MPOS;
  }

  /* ==================================================================== */
  /* SHARDS — Shard Orbit.  Cap 8, parametric orbit, throw + boomerang.   */
  /* ==================================================================== */
  var SH_MAX = 8;
  var shPh = new Float32Array(SH_MAX), shSt = new Uint8Array(SH_MAX);
  var shX = new Float32Array(SH_MAX), shY = new Float32Array(SH_MAX);
  var shVX = new Float32Array(SH_MAX), shVY = new Float32Array(SH_MAX);
  var shT = new Float32Array(SH_MAX), shCd = new Float32Array(SH_MAX);
  var shLife = new Float32Array(SH_MAX);      // <0 = the two permanent shards
  var SH_BASE = 2, SH_TEMP_LIFE = 12;
  var shN = 0, shOrbR = 74;
  function shardAdd(temp) {
    if (shN >= SH_MAX) return;
    var i = shN++;
    shPh[i] = NA.RNG.f() * TAU; shSt[i] = 0; shT[i] = 0; shCd[i] = 0;
    shX[i] = Pl.x; shY[i] = Pl.y;
    shLife[i] = temp ? SH_TEMP_LIFE : -1;     // F16: kill-grown shards expire
  }
  function shardFree(i) {
    var last = --shN;
    if (i !== last) {
      shPh[i] = shPh[last]; shSt[i] = shSt[last]; shX[i] = shX[last]; shY[i] = shY[last];
      shVX[i] = shVX[last]; shVY[i] = shVY[last]; shT[i] = shT[last]; shCd[i] = shCd[last];
      shLife[i] = shLife[last];
    }
  }
  function shardCount(want) { while (shN < want) shardAdd(false); }

  /* ==================================================================== */
  /* DRONES — cap 2.                                                      */
  /* ==================================================================== */
  var DR_MAX = 2;
  var drX = new Float32Array(DR_MAX), drY = new Float32Array(DR_MAX);
  var drCd = new Float32Array(DR_MAX), drPh = new Float32Array(DR_MAX);
  var drN = 0;
  function droneCount(want) {
    while (drN < want && drN < DR_MAX) {
      var i = drN++;
      drX[i] = Pl.x; drY[i] = Pl.y; drCd[i] = 0; drPh[i] = i * Math.PI;
    }
  }

  /* ==================================================================== */
  /* TURRETS — cap 3, link lasers, expiry explosion.                      */
  /* ==================================================================== */
  var TU_MAX = 3;
  var tuX = new Float32Array(TU_MAX), tuY = new Float32Array(TU_MAX);
  var tuLife = new Float32Array(TU_MAX), tuCd = new Float32Array(TU_MAX);
  var tuLink = new Float32Array(TU_MAX);
  var tuN = 0;
  function turretAdd(x, y) {
    var cap = T('turret') >= 3 ? 3 : 1;
    if (tuN >= cap) turretFree(0, true);
    if (tuN >= TU_MAX) return;
    var i = tuN++;
    tuX[i] = x; tuY[i] = y; tuLife[i] = 10; tuCd[i] = 0; tuLink[i] = 0;
  }
  function turretFree(i, boom) {
    if (boom && T('turret') >= 3) hExplode(tuX[i], tuY[i], 150, hPD(40));
    var last = --tuN;
    if (i !== last) {
      tuX[i] = tuX[last]; tuY[i] = tuY[last]; tuLife[i] = tuLife[last];
      tuCd[i] = tuCd[last]; tuLink[i] = tuLink[last];
    }
  }

  /* ==================================================================== */
  /* ZONES — storm cloud, gravity well, vacuum bubble.                    */
  /* ==================================================================== */
  var cloud = { x: 0, y: 0, r: 170, on: false, tick: 0, bolt: 0 };
  var well = { x: 0, y: 0, t: 0, r: 260, on: false, count: 0 };
  var vac = { x: 0, y: 0, r: 220, t: 0 };
  var SPLIT_BIT = 1024;                        // private flags bit: "tripled by the cloud"

  /* ==================================================================== */
  /* ENEMY-BULLET GRID — Feedback Loop T2 / Ghost Rounds T3.              */
  /* Built only when one of those tiers is owned; per-frame absorb cap.   */
  /* ==================================================================== */
  var ebGrid = null, ebFrame = -1, absorbCursor = 0;
  var ABSORB_CAP = 48, SCAN_CAP = 256;
  var EB_OUT = new Int32Array(1024);          // the well's own query buffer
  function ebBuild() {
    if (ebFrame === NA.Time.frames) return;
    ebFrame = NA.Time.frames;
    if (!ebGrid) ebGrid = NA.Grid.create(64, C.MAX_EBULLETS, 128);
    var E = B.E;
    ebGrid.begin();
    for (var i = 0; i < E.n; i++) ebGrid.insert(i, E.x[i], E.y[i]);
  }

  /* ==================================================================== */
  /* ALLIES — Reaper T3.  One additive NA.Enemies field (`ally`) holds the */
  /* remaining seconds; the rest of the enemy pipeline is reused as-is.   */
  /* ==================================================================== */
  var ALLY_MAX = 3, allyN = 0, allyFrame = -1;
  var allyCd = new Float32Array(C.MAX_ENEMIES);
  function allyRaise(typeIdx, x, y) {
    if (!En.ally || allyN >= ALLY_MAX) return -1;
    var i = En.spawn(typeIdx, x, y);
    if (i < 0) return -1;
    En.spawnT[i] = 0.2;
    En.ally[i] = 5;
    allyCd[i] = 0;
    allyN++;
    NA.Particles.ring(x, y, 6, 70, 0.4, 2.4, 0.22, 1, 0.42, 0.9);
    return i;
  }
  function allyTick(dt) {
    if (!En.ally || allyFrame === NA.Time.frames) return;
    allyFrame = NA.Time.frames;
    var live = 0, foes = 0, i;
    for (i = 0; i < En.n; i++) if (En.ally[i] > 0) live++; else foes++;
    allyN = live;
    if (!live) return;
    for (i = 0; i < En.n; i++) {
      if (En.ally[i] <= 0) continue;
      En.ally[i] -= dt;
      // allies never collide with you and never eat your bullets
      En.intangible[i] = 0.2;
      if (En.ally[i] <= 0 || foes === 0) {
        NA.Particles.burst(En.x[i], En.y[i], 6, 180, 0.3, 0.22, 1, 0.42, 1);
        En.ally[i] = 0;
        En.kill(i, false); i--; allyN--; continue;
      }
      var tgt = nearestFoe(En.x[i], En.y[i], 700);
      if (tgt < 0) continue;
      var dx = En.x[tgt] - En.x[i], dy = En.y[tgt] - En.y[i];
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = 220;
      En.vx[i] = M.smooth(En.vx[i], dx / d * sp, 6, dt);
      En.vy[i] = M.smooth(En.vy[i], dy / d * sp, 6, dt);
      if (allyCd[i] > 0) allyCd[i] -= dt;
      else if (d < En.size[i] + En.size[tgt] + 12) {
        allyCd[i] = 0.35;
        hDamage(tgt, hPD(16), 'player');
      }
    }
  }
  function allyRender() {
    if (!En.ally) return;
    for (var i = 0; i < En.n; i++) {
      if (En.ally[i] <= 0) continue;
      var a = M.clamp01(En.ally[i]);
      R.ring(L.PARTICLES, En.x[i], En.y[i], En.size[i] * 1.6, 1.4, 0.22, 1, 0.42, 0.7 * a);
      R.dot(L.PARTICLES, En.x[i], En.y[i], 2.4, 0.22, 1, 0.42, 0.9 * a);
    }
  }

  /* ==================================================================== */
  /* PLAYER-DAMAGE COMPOSITION                                            */
  /* Ghost, Glass Hull and Feedback Loop all need to act *before* the hit  */
  /* resolves, and Hull Plating / Vent right after it.  NA.Player.damage   */
  /* is wrapped once at runtime (no foundation file is edited).           */
  /* ==================================================================== */
  var damagedThisWave = false;
  function installWrap() {
    if (Pl._bDamageWrapped) return;
    Pl._bDamageWrapped = true;
    var orig = Pl.damage;
    Pl.damage = function (n, sx, sy) {
      if (!Pl.alive || Pl.invuln > 0 || Pl.dashIFrame > 0) return false;
      if (preDamage(sx, sy)) return false;
      var hit = orig.call(Pl, n, sx, sy);
      if (hit) postDamage(sx, sy);
      return hit;
    };
  }

  /* Ghost charge → Glass Hull mana shield → Feedback Loop reflect. */
  function preDamage(sx, sy) {
    if (T('ghost') >= 1 && ghostCharged) {
      ghostCharged = false; ghostCd = 8;
      Pl.invuln = Math.max(Pl.invuln, 0.5);
      NA.Particles.ring(Pl.x, Pl.y, 8, 120, 0.4, 3, 0.7, 0.95, 1, 0.9);
      if (T('ghost') >= 2) ghostPhase = 1.0;             // T2: 1 s of lethal intangibility
      if (NA.Audio) NA.Audio.sfx('manaFull');
      return true;
    }
    if (T('glassHull') >= 2 && Pl.mana >= 50) {
      Pl.spend(50, 'glass');
      Pl.invuln = Math.max(Pl.invuln, 0.5);
      NA.Particles.ring(Pl.x, Pl.y, 8, 140, 0.35, 3, 0.3, 0.95, 1, 0.9);
      NA.FX.chroma(2, 120);
      return true;
    }
    if (T('feedbackLoop') >= 3 && NA.RNG.f() < 0.5) {
      reflectFrom(sx, sy);
      Pl.invuln = Math.max(Pl.invuln, 0.35);
      return true;
    }
    return false;
  }
  function postDamage(sx, sy) {
    damagedThisWave = true;
    if (T('hullPlating') >= 2 && !plateShed) {
      plateShed = true; plateRegrow = 8;
      var a = Pl.angle;
      var o = bo(46, 13, 2.2); o.pierce = 3;
      hFire(Pl.x + Math.cos(a) * 18, Pl.y + Math.sin(a) * 18,
        Math.cos(a) * 720, Math.sin(a) * 720, o);
      NA.Particles.shatter(Pl.x, Pl.y, 22, 4, 0.8, 0.85, 0.9, 240);
    }
    if (T('vent') >= 2 && Pl.mana >= 60) ventFire(false);
  }
  /* Feedback Loop T3: the shot that would have hit you becomes yours. */
  function reflectFrom(sx, sy) {
    var E = B.E, best = -1, bd = 1e18;
    for (var i = 0; i < E.n; i++) {
      var dx = E.x[i] - sx, dy = E.y[i] - sy, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    var tx = sx === undefined ? Pl.x : sx, ty = sy === undefined ? Pl.y : sy;
    var ang = En.n ? En.nearestAngle(tx, ty) : Pl.angle;
    var o = bo(Pl.stats.damage * 1.5, 9, 2.0); o.pierce = 1;
    hFire(tx, ty, Math.cos(ang) * 1100, Math.sin(ang) * 1100, o);
    if (best >= 0 && bd < 90 * 90) B.killE(best, true);
    NA.Particles.burst(tx, ty, 5, 220, 0.24, 0.7, 0.95, 1, 2);
  }

  /* ==================================================================== */
  /* STAT MULTIPLIERS                                                     */
  /* Self-correcting: whenever a stat changes behind our back (any apply() */
  /* or reapply(), including UPGRADES-A's) the new value becomes the clean */
  /* base, so multipliers never compound frame to frame.                  */
  /* ==================================================================== */
  var cleanV = { damage: 0, fireRate: 0, speed: 0, manaTrickle: 0, dashCost: 0 };
  var appliedV = { damage: NaN, fireRate: NaN, speed: NaN, manaTrickle: NaN, dashCost: NaN };
  function mulStat(k, mul) {
    var s = Pl.stats;
    if (s[k] !== appliedV[k]) cleanV[k] = s[k];
    var v = cleanV[k] * mul;
    s[k] = v; appliedV[k] = v;
  }

  var glassStacks = 0, plateShed = false, plateRegrow = 0;
  var trickleBurst = 0;
  var modsB = { damageB: 1, fireRateB: 1, speedB: 1, trickleB: 1, enemyFireRateB: 1 };

  function statTick(dt) {
    var dmg = 1, fr = 1, spd = 1, tri = 1, dc = 1;
    var tHull = T('hullPlating'), tGlass = T('glassHull'), tBerserk = T('berserk');
    var tGhostR = T('ghostRounds'), tClaus = T('claustrophobia');

    // Hull Plating: −8% speed while plated; Adrenaline while the plate is off
    if (tHull >= 1 && !plateShed) spd *= 0.92;
    if (tHull >= 3 && plateShed) { fr *= 1.2; tri *= 2; }

    // Ghost Rounds: +100% / +150% / +200%
    if (tGhostR === 1) dmg *= 2; else if (tGhostR === 2) dmg *= 2.5; else if (tGhostR >= 3) dmg *= 3;

    // Claustrophobia: +25% while an enemy is close
    if (tClaus >= 1 && nearestFoe(Pl.x, Pl.y, 260) >= 0) dmg *= 1.25;

    // Glass Hull: +80%, +50% trickle, +10% per untouched wave (kept for the run)
    if (tGlass >= 1) { dmg *= 1.8; tri *= 1.5; }
    if (glassStacks > 0) dmg *= 1 + glassStacks * 0.1;

    // Berserk: missing mana is damage; ≤20 mana is speed; 0 mana dashes on HP
    if (tBerserk >= 1) {
      dmg *= 1 + (1 - Pl.mana / Pl.manaMax);
      dc *= 1.3;
    }
    if (tBerserk >= 2 && Pl.mana <= 20) { fr *= 1.5; spd *= 1.5; }
    if (tBerserk >= 3 && Pl.mana <= 0.5 && Pl.hp > 1) dc = 0;

    // Reaper souls: +2% each, capped at +60%, for the wave
    if (soulBonus > 0) dmg *= 1 + soulBonus;

    // Spendthrift T2 burst
    if (trickleBurst > 0) { trickleBurst -= dt; tri *= 10; }

    mulStat('damage', dmg);
    mulStat('fireRate', fr);
    mulStat('speed', spd);
    mulStat('manaTrickle', tri);
    mulStat('dashCost', dc);

    modsB.damageB = dmg; modsB.fireRateB = fr; modsB.speedB = spd; modsB.trickleB = tri;
    // F2 — the downside, published where the enemy code actually reads it.
    // NA.Player.mods.enemyFireMul multiplies every enemy fire COOLDOWN, so
    // 1/1.3 = the whole field shoots 30% more often.
    var fbk = T('feedbackLoop') >= 1 ? 1.3 : 1;
    modsB.enemyFireRateB = fbk;
    if (!Pl.mods) Pl.mods = { enemyFireMul: 1 };
    Pl.mods.enemyFireMul = 1 / fbk;

    // Glass Hull is authoritative about max HP, whatever else applied first
    if (tGlass >= 1) { Pl.maxHp = 1; if (Pl.hp > 1) Pl.hp = 1; }

    // hull tint (one deliberate colour per wildcard, highest priority last)
    var tint = null;
    if (tClaus >= 1) tint = TINT_CLAUS;
    if (tGhostR >= 2) tint = TINT_GHOSTR;
    if (tGlass >= 1) tint = TINT_GLASS;
    if (tBerserk >= 1) tint = TINT_BERSERK;
    if (tint) Ship.tint = tint;
  }
  var TINT_CLAUS = [0.75, 0.85, 1.0], TINT_GHOSTR = [0.35, 0.40, 0.48];
  var TINT_GLASS = [0.85, 0.98, 1.0], TINT_BERSERK = [1.0, 0.32, 0.36];

  /* ==================================================================== */
  /* FRAME TICK — every tier-1 update calls this; it runs at most once.    */
  /* ==================================================================== */
  var frameStamp = -1, curWave = -1;
  /* F15 — "the damage the corpse could not absorb" needs the HP the body had
   * BEFORE the hit.  A per-frame prevHp[] snapshot is wrong the moment the
   * swap-remove pool moves a body, so NA.Enemies.damage is wrapped once at
   * runtime (no foundation file is edited) and records the pre-hit HP of the
   * OUTERMOST damage call — which is exactly the hit onHit is about to see. */
  var preEi = -1, preHp = 0, dmgDepth = 0;
  function installEnWrap() {
    if (En._bDmgWrapped) return;
    En._bDmgWrapped = true;
    var orig = En.damage;
    En.damage = function (ei, dmg, src) {
      if (dmgDepth === 0) { preEi = ei; preHp = (ei >= 0 && ei < En.n) ? En.hp[ei] : 0; }
      dmgDepth++;
      var r = orig.call(En, ei, dmg, src);
      dmgDepth--;
      return r;
    };
  }
  var ghostCharged = false, ghostCd = 8, ghostPhase = 0;
  var ventUsed = false;

  function tick(dt) {
    if (frameStamp === NA.Time.frames) return;
    frameStamp = NA.Time.frames;
    U._bTickRan = (U._bTickRan || 0) + 1;   // ?debug diagnostic: frames this file ticked
    installWrap();

    var w = NA.Game ? NA.Game.wave : 0;
    if (w !== curWave) { onWaveStart(w); curWave = w; }

    statTick(dt);
    allyTick(dt);
    soulTick(dt);
    if (T('feedbackLoop') >= 2 || T('ghostRounds') >= 3) ebBuild();

    // mirror ring buffer: 30 samples every 2nd frame = 0.5 s of history
    if (T('mirror') >= 1 && (NA.Time.frames & 1) === 0) {
      mrX[mrHead] = Pl.x; mrY[mrHead] = Pl.y; mrA[mrHead] = Pl.angle;
      mrHead = (mrHead + 1) % MR_N;
      if (mrFilled < MR_N) mrFilled++;
    }

    if (T('overkill') >= 1) installEnWrap();     // F15: exact pre-hit HP, no O(n) snapshot
    if (U.mods) { for (var k in modsB) U.mods[k] = modsB[k]; }
  }

  function onWaveStart(w) {
    // Glass Hull T3: an untouched wave is +10% damage for the rest of the run
    if (curWave > 0 && !damagedThisWave && T('glassHull') >= 3) {
      glassStacks++;
      NA.Particles.ring(Pl.x, Pl.y, 10, 200, 0.6, 3, 0.85, 0.98, 1, 0.9);
    }
    damagedThisWave = false;
    ventUsed = false;
    soulBonus = 0; slN = 0;
    mkN = 0; dmgAccum = 0;
    mnN = 0; tuN = 0; fpN = 0;
    if (shN > SH_BASE) shN = SH_BASE;      // F16: temporary shards do not survive a wave
    okCarry.fill(0); okCarryT = -9;        // F15
    impLastEi = -1; impCount = 0;
    burnT.fill(0);
    well.on = false; cloud.on = false; vac.t = 0;
    gamblerWave(w);
  }

  /* Everything below is published so other agents can read it, never write. */
  U.enemyFireRateMul = function () { return T('feedbackLoop') >= 1 ? 1.3 : 1; };
  if (!U.mods) U.mods = {};
  U.alliesAlive = function () { return allyN; };

  /* ==================================================================== */
  /* 21. HULL PLATING — defense, hull slot                                */
  /* ==================================================================== */
  U.define('hullPlating', {
    family: 'defense', tags: ['mana'], visual: { slot: 'hull' },
    tiers: [
      { // T1: one more plate of hull — +1 max HP for 8% of your speed.
        apply: function (p) {
          if (p.maxHp < C.PLAYER_HP + 1) { p.maxHp = C.PLAYER_HP + 1; p.hp = Math.min(p.maxHp, p.hp + 1); }
        },
        update: function (dt) {
          tick(dt);
          if (plateShed) { plateRegrow -= dt; if (plateRegrow <= 0) { plateShed = false; regrowPop(); } }
        },
        render: function () {
          if (plateShed) return;
          var a = Pl.angle;
          for (var s = -1; s <= 1; s += 2) {
            var pa = a + s * 1.5;
            R.line(L.PLAYER, Pl.x + Math.cos(pa) * 9, Pl.y + Math.sin(pa) * 9,
              Pl.x + Math.cos(pa) * 9 + Math.cos(a) * 12, Pl.y + Math.sin(pa) * 9 + Math.sin(a) * 12,
              3.2, 0.8, 0.86, 0.95, 0.8);
          }
        }
      },
      { // T2: the plate itself is the counter-attack — it flies off as a heavy round.
        render: function () {
          if (!plateShed) return;
          R.ring(L.PLAYER, Pl.x, Pl.y, 22, 1.2, 0.8, 0.86, 0.95, 0.25 + 0.15 * Math.sin(NA.Time.t * 6));
        }
      },
      { // T3: Adrenaline — while the plate is off you fire faster and drink mana.
        render: function () {
          if (!plateShed) return;
          R.disc(L.PBULLETS, Pl.x, Pl.y, 34, 1, 0.32, 0.36, 0.10);
        }
      }
    ]
  });
  function regrowPop() {
    NA.Particles.ring(Pl.x, Pl.y, 26, 10, 0.3, 2.4, 0.8, 0.86, 0.95, 0.8);
    if (NA.Audio) NA.Audio.sfx('manaFull');
  }

  /* ==================================================================== */
  /* 22. VENT — defense, aura slot                                        */
  /* ==================================================================== */
  function ventFire(fromLowHp) {
    var m = Pl.mana;
    if (m < 10) return;
    Pl.spend(m, 'vent');
    var radius = 160 + m * 3.4;                    // proportional to what it burned
    pulseAt(Pl.x, Pl.y, radius, 18 + m * 0.35, true);
    NA.FX.flash(0.18, 90);
    if (T('vent') >= 3) { vac.x = Pl.x; vac.y = Pl.y; vac.r = radius * 0.75; vac.t = 2; }
    if (fromLowHp) ventUsed = true;
  }
  U.define('vent', {
    family: 'defense', tags: ['mana', 'spend'], visual: { slot: 'aura' },
    tiers: [
      { // T1: at 1 HP the ship blows its whole bar as one proportional Pulse.
        update: function (dt) {
          tick(dt);
          if (!ventUsed && Pl.alive && Pl.hp <= 1 && Pl.mana >= 20) ventFire(true);
          if (vac.t > 0) {
            vac.t -= dt;
            var E = B.E, r2 = vac.r * vac.r;
            for (var i = 0; i < E.n; i++) {
              var dx = E.x[i] - vac.x, dy = E.y[i] - vac.y;
              if (dx * dx + dy * dy > r2) continue;
              E.x[i] -= E.vx[i] * dt * 0.78; E.y[i] -= E.vy[i] * dt * 0.78;   // crawl
            }
          }
        },
        render: function () {
          var armed = !ventUsed && Pl.mana >= 20;
          R.ring(L.PLAYER, Pl.x, Pl.y, 26, 1.4, 0.62, 0.42, 1, armed ? 0.4 : 0.14);
        }
      },
      { // T2: any hit while you are holding 60+ mana vents on the spot.
        render: function () {
          if (Pl.mana < 60) return;
          for (var v = 0; v < 4; v++) {
            var a = NA.Time.t * 1.15 + v * M.HALFPI;
            R.dot(L.PLAYER, Pl.x + Math.cos(a) * 24, Pl.y + Math.sin(a) * 24, 1.8, 0.62, 0.42, 1, 0.8);
          }
        }
      },
      { // T3: the vent leaves a 2 s vacuum bubble that enemy bullets crawl through.
        render: function () {
          if (vac.t <= 0) return;
          var a = M.clamp01(vac.t / 2);
          R.ring(L.VEIL, vac.x, vac.y, vac.r, 2, 0.62, 0.42, 1, 0.5 * a);
          R.disc(L.VEIL, vac.x, vac.y, vac.r, 0.62, 0.42, 1, 0.07 * a);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 23. GHOST — defense, aura slot                                       */
  /* ==================================================================== */
  var ghostKillT = new Float32Array(10), ghostKillN = 0;
  U.define('ghost', {
    family: 'defense', tags: ['dash', 'kill'], visual: { slot: 'aura' },
    tiers: [
      { // T1: a wisp charges every 8 s and eats one hit outright.
        update: function (dt) {
          tick(dt);
          if (!ghostCharged) { ghostCd -= dt; if (ghostCd <= 0) { ghostCharged = true; ghostPop(); } }
        },
        render: function () {
          if (!ghostCharged) {
            R.arc(L.PLAYER, Pl.x, Pl.y, 30, -M.HALFPI, -M.HALFPI + TAU * (1 - ghostCd / 8), 1.4, 0.7, 0.95, 1, 0.35);
            return;
          }
          var a = NA.Time.t * 1.15;
          R.dot(L.PLAYER, Pl.x + Math.cos(a) * 30, Pl.y + Math.sin(a) * 30, 3.4, 0.7, 0.95, 1, 0.9);
          R.disc(L.PBULLETS, Pl.x + Math.cos(a) * 30, Pl.y + Math.sin(a) * 30, 12, 0.7, 0.95, 1, 0.2);
        }
      },
      { // T2: spending the wisp makes you intangible for 1 s and lethal to touch.
        update: function (dt) {
          if (ghostPhase <= 0) return;
          ghostPhase -= dt;
          Pl.dashIFrame = Math.max(Pl.dashIFrame, 0.05);
          var cnt = En.grid.query(Pl.x, Pl.y, 44), out = En.grid.out;
          for (var q = 0; q < cnt; q++) {
            var i = out[q];
            if (i >= En.n || (En.ally && En.ally[i] > 0)) continue;
            hDamage(i, hPD(40) * dt * 6, 'player');
          }
          if ((NA.Time.frames & 3) === 0)
            NA.Particles.afterImage(Pl.x, Pl.y, Pl.angle, C.SHIP_R * 1.55, 0.3, 0.7, 0.95, 1, 0.35, 0);
        },
        render: function () {
          if (ghostPhase <= 0) return;
          R.ring(L.PLAYER, Pl.x, Pl.y, 44, 2, 0.7, 0.95, 1, 0.5 * M.clamp01(ghostPhase));
        }
      },
      { // T3: ten kills inside three seconds re-lights the wisp immediately.
        onKill: function (ctx) {
          var t = NA.Time.t;
          if (ghostKillN >= 10) { for (var k = 1; k < 10; k++) ghostKillT[k - 1] = ghostKillT[k]; ghostKillN = 9; }
          ghostKillT[ghostKillN++] = t;
          if (ghostKillN >= 10 && t - ghostKillT[0] <= 3 && !ghostCharged) {
            ghostCharged = true; ghostCd = 8; ghostKillN = 0; ghostPop();
          }
        },
        render: function () {
          for (var s = 0; s < 3; s++) {
            var a = -NA.Time.t * 0.62 + s * (TAU / 3);
            R.poly(L.PLAYER, Pl.x + Math.cos(a) * 38, Pl.y + Math.sin(a) * 38, 3.4, 5, a, 1, 0.7, 0.95, 1, 0.45);
          }
        }
      }
    ]
  });
  function ghostPop() {
    NA.Particles.ring(Pl.x, Pl.y, 4, 40, 0.3, 2, 0.7, 0.95, 1, 0.7);
    if (NA.Audio) NA.Audio.sfx('manaFull');
  }

  /* ==================================================================== */
  /* 24. REAPER — chain reaction (on kill), fins slot                     */
  /* ==================================================================== */
  var reaperDepth = 0, reaperKills = 0;
  U.define('reaper', {
    family: 'trigger', tags: ['kill', 'orbital'], visual: { slot: 'fins' },
    tiers: [
      { // T1: the corpse gets one last shot off at whatever is nearest.
        update: function (dt) { tick(dt); },
        onKill: function (ctx) {
          if (reaperDepth > 2) return;
          reaperDepth++;
          var tgt = nearestFoe(ctx.x, ctx.y, 620);
          if (tgt >= 0) {
            var a = Math.atan2(En.y[tgt] - ctx.y, En.x[tgt] - ctx.x);
            var o = bo(Pl.stats.damage * 0.8, 6, 1.6); o.homing = 0.6;
            o.r = 0.22; o.g = 1; o.b = 0.42;
            hFire(ctx.x, ctx.y, Math.cos(a) * 900, Math.sin(a) * 900, o);
          }
          reaperDepth--;
        },
        render: function () {
          var a = Pl.angle + Math.PI;
          R.line(L.PLAYER, Pl.x + Math.cos(a) * 8, Pl.y + Math.sin(a) * 8,
            Pl.x + Math.cos(a + 0.9) * 22, Pl.y + Math.sin(a + 0.9) * 22, 2, 0.22, 1, 0.42, 0.75);
        }
      },
      { // T2: kills drop souls; each collected soul is +2% damage this wave (cap 60%).
        onKill: function (ctx) { soulAdd(ctx.x, ctx.y); },
        onSpend: function (ctx) { soulVacuum(); },              // spending mana vacuums them
        render: function () {
          soulRender();
          R.ring(L.PLAYER, Pl.x, Pl.y, 20 + soulBonus * 22, 1.2, 0.22, 1, 0.42, 0.2 + soulBonus);
        }
      },
      { // T3: every tenth kill stands the corpse back up as your ally for 5 s.
        onKill: function (ctx) {
          reaperKills++;
          if (reaperKills % 10) return;
          allyRaise(ctx.type, ctx.x, ctx.y);
        },
        render: function () {
          allyRender();
          for (var s = 0; s < 3; s++) {
            var a = NA.Time.t * 1.15 + s * (TAU / 3);
            R.poly(L.PLAYER, Pl.x + Math.cos(a) * 26, Pl.y + Math.sin(a) * 26, 3, 3, a, 1, 0.22, 1, 0.42, 0.5);
          }
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 25. IMPACT — chain reaction (on hit), core slot                      */
  /* ==================================================================== */
  /* F15 — an index alone is not an identity in a swap-remove pool, so the
   * counter is confirmed positionally, the way T2's marks already are. */
  var impLastEi = -1, impLastX = 0, impLastY = 0, impCount = 0;
  U.define('impact', {
    family: 'trigger', tags: ['kill', 'pierce'], visual: { slot: 'core' },
    tiers: [
      { // T1: five hits into the same body and the fifth lands for triple.
        update: function (dt) { tick(dt); },
        onHit: function (ctx) {
          var same = ctx.ei === impLastEi &&
            (ctx.x - impLastX) * (ctx.x - impLastX) + (ctx.y - impLastY) * (ctx.y - impLastY) < 90 * 90;
          if (same) impCount++; else { impLastEi = ctx.ei; impCount = 1; }
          impLastX = ctx.x; impLastY = ctx.y;
          if (impCount % 5) return;
          if (ctx.kill) return;
          hDamage(ctx.ei, ctx.dmg * 2, 'player');
          NA.Particles.ring(ctx.x, ctx.y, 4, 46, 0.24, 3, 1, 0.54, 0, 0.95);
          NA.FX.hitStop(28);
          if (T('impact') >= 2) markAdd(En.x[ctx.ei], En.y[ctx.ei], ctx.ei);
        },
        render: function () {
          R.ring(L.PLAYER, Pl.x + Math.cos(Pl.angle) * 16, Pl.y + Math.sin(Pl.angle) * 16, 6, 1.2, 1, 0.54, 0, 0.7);
        }
      },
      { // T2: crits Mark — a marked body eats 5% of every point of damage you deal.
        update: function (dt) {
          splashT += dt;
          var i;
          for (i = 0; i < mkN; i++) {
            mkLife[i] -= dt;
            if (mkLife[i] <= 0) { markFree(i); i--; continue; }
            var ei = mkEi[i];
            if (ei >= 0 && ei < En.n) { mkX[i] = En.x[ei]; mkY[i] = En.y[ei]; }
            else {                                        // re-bind by position
              var re = nearestFoe(mkX[i], mkY[i], 60);
              if (re < 0) { markFree(i); i--; continue; }
              mkEi[i] = re;
            }
          }
          if (splashT >= 0.25) {
            splashT = 0;
            var share = dmgAccum * 0.05;
            dmgAccum = 0;
            if (share > 0.5) for (i = 0; i < mkN; i++) {
              if (mkEi[i] >= 0 && mkEi[i] < En.n) {
                if (hDamage(mkEi[i], share, 'player')) { markSpread(mkX[i], mkY[i]); markFree(i); i--; }
              }
            }
          }
        },
        onHit: function (ctx) { dmgAccum += ctx.dmg; },
        render: function () {
          for (var i = 0; i < mkN; i++) {
            var a = 0.5 + 0.5 * Math.sin(NA.Time.t * 5 + i);
            R.poly(L.PARTICLES, mkX[i], mkY[i], 18, 4, NA.Time.t * 1.15, 1.4, 1, 0.54, 0, 0.55 * a);
            R.dot(L.PARTICLES, mkX[i], mkY[i], 1.8, 1, 0.54, 0, 0.8 * a);
          }
        }
      },
      { // T3: killing a marked body throws the mark onto the two nearest.
        onKill: function (ctx) {
          var k = markIsMarked(ctx.ei);
          if (k < 0) return;
          markFree(k);
          markSpread(ctx.x, ctx.y);
        },
        render: function () {
          for (var i = 0; i < mkN; i++)
            R.ring(L.PARTICLES, mkX[i], mkY[i], 24, 1, 1, 0.54, 0, 0.3);
        }
      }
    ]
  });
  function markSpread(x, y) {
    if (T('impact') < 3) return;
    var cnt = En.grid.query(x, y, 320), out = En.grid.out, given = 0;
    for (var q = 0; q < cnt && given < 2; q++) {
      var i = out[q];
      if (i >= En.n || (En.ally && En.ally[i] > 0)) continue;
      if (markIsMarked(i) >= 0) continue;
      markAdd(En.x[i], En.y[i], i);
      NA.Particles.bolt(x, y, En.x[i], En.y[i], 0.18, 3, 1, 0.54, 0, 1.6);
      given++;
    }
  }

  /* ==================================================================== */
  /* 26. WAKE — chain reaction (on dash), trail slot                      */
  /* ==================================================================== */
  U.define('wake', {
    family: 'trigger', tags: ['dash', 'explode'], visual: { slot: 'trail' },
    tiers: [
      { // T1: every dash sprays a 180° fan of six rounds out of your exhaust.
        update: function (dt) { tick(dt); mineTick(dt); },
        onDash: function (ctx) {
          var back = Math.atan2(-ctx.vy, -ctx.vx);
          for (var k = 0; k < 6; k++) {
            var a = back - M.HALFPI + (k / 5) * Math.PI;
            var o = bo(Pl.stats.damage * 0.7, 6, 1.1);
            hFire(ctx.x, ctx.y, Math.cos(a) * 900, Math.sin(a) * 900, o);
          }
        },
        render: function () {
          var a = Pl.angle + Math.PI;
          for (var s = -1; s <= 1; s += 2)
            R.line(L.PLAYER, Pl.x + Math.cos(a + s * 0.4) * 10, Pl.y + Math.sin(a + s * 0.4) * 10,
              Pl.x + Math.cos(a + s * 0.4) * 18, Pl.y + Math.sin(a + s * 0.4) * 18, 2.6, 0.3, 0.95, 1, 0.7);
        }
      },
      { // T2: the point you left behind keeps a mine.
        onDash: function (ctx) { mineAdd(ctx.x, ctx.y); },
        render: function () { mineRender(); }
      },
      { // T3: the landing itself is a free 60% Pulse.
        onDash: function (ctx) {
          var ex = ctx.x + ctx.vx * C.DASH_TIME, ey = ctx.y + ctx.vy * C.DASH_TIME;
          pulseAt(ex, ey, 210, hPD(16), false);
        },
        render: function () {
          R.ring(L.PLAYER, Pl.x + Math.cos(Pl.angle) * 14, Pl.y + Math.sin(Pl.angle) * 14, 9, 1.2, 0.62, 0.42, 1, 0.6);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 27. SPENDTHRIFT — chain reaction (on spend), halo slot               */
  /* ==================================================================== */
  var spendAcc = 0, spendAcc100 = 0;
  U.define('spendthrift', {
    family: 'trigger', tags: ['spend', 'mana'], visual: { slot: 'halo' },
    tiers: [
      { // T1: every 25 mana you burn, cumulatively, throws a heavy homing bolt.
        update: function (dt) { tick(dt); },
        onSpend: function (ctx) {
          var amt = ctx.amount * (T('spendthrift') >= 3 && Pl.mana <= 20 ? 2 : 1);
          spendAcc += amt; spendAcc100 += amt;
          while (spendAcc >= 25) {
            spendAcc -= 25;
            var tgt = nearestFoe(Pl.x, Pl.y, 900);
            var a = tgt >= 0 ? Math.atan2(En.y[tgt] - Pl.y, En.x[tgt] - Pl.x) : Pl.angle;
            var o = bo(Pl.stats.damage * 2.2, 11, 3.0);
            o.homing = 0.9; o.explode = 60; o.r = 1; o.g = 0.847; o.b = 0.302;
            hFire(Pl.x, Pl.y, Math.cos(a) * 820, Math.sin(a) * 820, o);
          }
        },
        render: function () {
          var k = spendAcc / 25;
          R.arc(L.PLAYER, Pl.x, Pl.y, 24, -M.HALFPI, -M.HALFPI + TAU * k, 1.8, 1, 0.847, 0.302, 0.7);
        }
      },
      { // T2: each 100 spent opens one second of tenfold trickle.
        onSpend: function (ctx) {
          while (spendAcc100 >= 100) { spendAcc100 -= 100; trickleBurst = 1; ventBurstPop(); }
        },
        render: function () {
          if (trickleBurst <= 0) return;
          R.ring(L.PLAYER, Pl.x, Pl.y, 34, 2, 1, 0.847, 0.302, 0.6 * M.clamp01(trickleBurst));
        }
      },
      { // T3: spending while nearly dry counts double — the gem is cracked.
        render: function () {
          if (Pl.mana > 20) return;
          R.poly(L.PLAYER, Pl.x, Pl.y, 12, 4, NA.Time.t * 1.15, 1.4, 1, 0.847, 0.302, 0.55);
        }
      }
    ]
  });
  function ventBurstPop() {
    NA.Particles.ring(Pl.x, Pl.y, 6, 54, 0.34, 2.4, 1, 0.847, 0.302, 0.9);
    if (NA.Audio) NA.Audio.sfx('manaFull');
  }

  /* ==================================================================== */
  /* 28. OVERKILL — chain reaction, fins slot                             */
  /* ==================================================================== */
  /* F15 — the carry rides the BULLET, not the module.  (bi, gen) is the pool's
   * own identity pair, so a freed or recycled slot can never inherit it. */
  var okCarry = new Float32Array(C.MAX_PBULLETS);
  var okGen = new Uint32Array(C.MAX_PBULLETS);
  var okBank = 0, okRail = false, okCarryT = -9;
  U.define('overkill', {
    family: 'trigger', tags: ['kill', 'pierce'], visual: { slot: 'fins' },
    tiers: [
      { // T1: damage a corpse could not absorb rides the bullet into the next body.
        update: function (dt) { tick(dt); },
        onHit: function (ctx) {
          var bi = ctx.bi, P = B.P;
          var ok = bi >= 0 && bi < okCarry.length;
          if (ctx.kill) {
            var before = (ctx.ei === preEi && preHp > 0) ? preHp : ctx.dmg;
            var excess = M.clamp(ctx.dmg - before, 0, ctx.dmg);
            if (excess > 1) {
              if (ok) { okCarry[bi] = excess; okGen[bi] = P.gen[bi]; okCarryT = NA.Time.t; }
              if (T('overkill') >= 2 && excess >= before) shrapnel(ctx.x, ctx.y);
              if (T('overkill') >= 3) okBank += excess;
            }
          } else if (ok && okCarry[bi] > 1 && okGen[bi] === P.gen[bi]) {
            var carry = okCarry[bi]; okCarry[bi] = 0;
            hDamage(ctx.ei, carry, 'player');
            NA.Particles.burst(ctx.x, ctx.y, 3, 200, 0.2, 1, 0.54, 0, 1);
          }
        },
        render: function () {
          if (NA.Time.t - okCarryT > 0.6) return;
          R.dot(L.PLAYER, Pl.x - Math.cos(Pl.angle) * 14, Pl.y - Math.sin(Pl.angle) * 14, 2.6, 1, 0.54, 0, 0.9);
        }
      },
      { // T2: double overkill bursts the body into three pieces of shrapnel.
        render: function () {
          var a = Pl.angle + Math.PI;
          R.line(L.PLAYER, Pl.x + Math.cos(a) * 12, Pl.y + Math.sin(a) * 12,
            Pl.x + Math.cos(a) * 24, Pl.y + Math.sin(a) * 24, 1.6, 1, 0.54, 0, 0.7);
        }
      },
      { // T3: overkill is banked; at 500 the next shot leaves as a rail worth the bank.
        onFire: function (ctx) {
          if (okBank < 500) return;
          var dmg = okBank; okBank = 0; okRail = true;
          var o = bo(dmg, 16, 1.4); o.pierce = 24; o.r = 1; o.g = 0.54; o.b = 0;
          hFire(ctx.x, ctx.y, Math.cos(ctx.angle) * 2200, Math.sin(ctx.angle) * 2200, o);
          NA.FX.trauma(0.25); NA.FX.chroma(3, 180);
          NA.Particles.ring(ctx.x, ctx.y, 8, 120, 0.3, 4, 1, 0.54, 0, 1);
        },
        render: function () {
          var k = M.clamp01(okBank / 500);
          R.arc(L.PLAYER, Pl.x, Pl.y, 28, Math.PI * 0.6, Math.PI * 0.6 + TAU * k, 2, 1, 0.54, 0, 0.7);
        }
      }
    ]
  });
  function shrapnel(x, y) {
    for (var k = 0; k < 3; k++) {
      var a = NA.RNG.f() * TAU;
      var o = bo(Pl.stats.damage * 0.6, 5, 0.9); o.bounce = 1;
      hFire(x, y, Math.cos(a) * 780, Math.sin(a) * 780, o);
    }
  }

  /* ==================================================================== */
  /* 29. SHARD ORBIT — orbitals slot                                      */
  /* ==================================================================== */
  U.define('shardOrbit', {
    family: 'orbital', tags: ['orbital', 'kill', 'spend'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: two crystals ride a parametric orbit and cut what they touch.
        update: function (dt) {
          tick(dt);
          shardCount(T('shardOrbit') >= 2 ? Math.max(2, shN) : 2);
          var t = NA.Time.t;
          for (var i = 0; i < shN; i++) {
            if (shCd[i] > 0) shCd[i] -= dt;
            if (shLife[i] > 0) {                       // F16: temporary shards
              shLife[i] -= dt;
              if (shLife[i] <= 0 && shN > SH_BASE) {
                NA.Particles.burst(shX[i], shY[i], 3, 130, 0.22, 1, 0.235, 0.675, 1);
                shardFree(i); i--; continue;
              }
            }
            if (shSt[i] === 0) {
              // position is a pure function of ship position and time — no state drift
              var a = t * Ship.SPIN_A + shPh[i] + (i / Math.max(1, shN)) * TAU;
              shX[i] = Pl.x + Math.cos(a) * shOrbR;
              shY[i] = Pl.y + Math.sin(a) * shOrbR;
            } else {
              shT[i] += dt;
              if (shT[i] > 0.42) {                       // boomerang: turn and come home
                var bx = Pl.x - shX[i], by = Pl.y - shY[i];
                var bl = Math.sqrt(bx * bx + by * by) || 1;
                shVX[i] = M.smooth(shVX[i], bx / bl * 1150, 5, dt);
                shVY[i] = M.smooth(shVY[i], by / bl * 1150, 5, dt);
                if (bl < 30) { shSt[i] = 0; shT[i] = 0; }
              }
              shX[i] += shVX[i] * dt; shY[i] += shVY[i] * dt;
              if (shT[i] > 4) { shSt[i] = 0; shT[i] = 0; }
            }
            if (shCd[i] <= 0) {
              var hit = nearestFoe(shX[i], shY[i], 22);
              if (hit >= 0) {
                shCd[i] = shSt[i] ? 0.08 : 0.22;
                hDamage(hit, Pl.stats.damage * (shSt[i] ? 1.4 : 0.9), 'player');
                NA.Particles.burst(shX[i], shY[i], 2, 140, 0.16, 1, 0.235, 0.675, 1);
              }
            }
          }
        },
        render: function () {
          for (var i = 0; i < shN; i++) {
            R.poly(L.PLAYER, shX[i], shY[i], 6.5, 4, NA.Time.t * 2 + i, 1.6, 1, 0.235, 0.675, 0.9);
            R.dot(L.PLAYER, shX[i], shY[i], 1.6, 1, 0.85, 0.94, 0.7);
          }
        }
      },
      { // T2: kills grow the ring with temporary shards, up to eight.
        onKill: function (ctx) { if (shN < SH_MAX && NA.RNG.f() < 0.34) shardAdd(true); },
        render: function () {
          if (shN <= 2) return;
          R.ring(L.PLAYER, Pl.x, Pl.y, shOrbR, 1, 1, 0.235, 0.675, 0.16);
        }
      },
      { // T3: 10 mana throws every shard out as a piercing boomerang.
        update: function (dt) {
          if (!hActive('shardOrbit') || shN === 0) return;
          var any = false;
          for (var i = 0; i < shN; i++) if (shSt[i] === 0) { any = true; break; }
          if (!any || !pay(10, 'shard')) return;
          for (i = 0; i < shN; i++) {
            if (shSt[i] !== 0) continue;
            var tgt = nearestFoe(shX[i], shY[i], 900);
            var a = tgt >= 0 ? Math.atan2(En.y[tgt] - shY[i], En.x[tgt] - shX[i])
              : Math.atan2(shY[i] - Pl.y, shX[i] - Pl.x);
            shSt[i] = 1; shT[i] = 0;
            shVX[i] = Math.cos(a) * 1150; shVY[i] = Math.sin(a) * 1150;
          }
          if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: Pl.x, y: Pl.y });
        },
        render: function () {
          for (var i = 0; i < shN; i++) {
            if (shSt[i] === 0) continue;
            R.line(L.PBULLETS, shX[i] - shVX[i] * 0.012, shY[i] - shVY[i] * 0.012, shX[i], shY[i],
              2.4, 1, 0.235, 0.675, 0.8);
          }
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 30. DRONE — orbitals slot                                            */
  /* ==================================================================== */
  U.define('drone', {
    family: 'summon', tags: ['orbital', 'dash'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: a wingman trails you and plinks a weak copy of your primary.
        update: function (dt) {
          tick(dt);
          droneCount(T('drone') >= 3 ? 2 : 1);
          var s = Pl.stats, inherit = T('drone') >= 2;
          for (var i = 0; i < drN; i++) {
            var a = NA.Time.t * Ship.SPIN_B + drPh[i];
            var tx = Pl.x + Math.cos(a) * 96, ty = Pl.y + Math.sin(a) * 96;
            drX[i] = M.smooth(drX[i], tx, 5, dt);
            drY[i] = M.smooth(drY[i], ty, 5, dt);
            drCd[i] -= dt;
            if (drCd[i] > 0) continue;
            var tgt = nearestFoe(drX[i], drY[i], 760);
            if (tgt < 0) continue;
            drCd[i] = 1 / Math.max(0.5, s.fireRate * 0.5);
            var fa = Math.atan2(En.y[tgt] - drY[i], En.x[tgt] - drX[i]);
            var o = bo(s.damage * 0.35, 5, s.life);
            if (inherit) {
              o.pierce = s.pierce; o.bounce = s.bounce; o.homing = s.homing; o.explode = s.explode;
            }
            o.r = 0.3; o.g = 0.95; o.b = 1;
            hFire(drX[i], drY[i], Math.cos(fa) * s.bulletSpeed * 0.85, Math.sin(fa) * s.bulletSpeed * 0.85, o);
          }
        },
        render: function () {
          for (var i = 0; i < drN; i++) {
            R.poly(L.PLAYER, drX[i], drY[i], 7, 3, NA.Time.t * 1.15, 1.8, 0.3, 0.95, 1, 0.9);
            R.dot(L.PLAYER, drX[i], drY[i], 1.6, 0.75, 0.98, 1, 0.8);
          }
        }
      },
      { // T2: the drone inherits every projectile modifier you own.
        render: function () {
          for (var i = 0; i < drN; i++)
            R.ring(L.PLAYER, drX[i], drY[i], 11, 1, 0.75, 0.98, 1, 0.35);
        }
      },
      { // T3: a second drone, and both dash when you do.
        onDash: function (ctx) {
          for (var i = 0; i < drN; i++) {
            drX[i] += ctx.vx * C.DASH_TIME; drY[i] += ctx.vy * C.DASH_TIME;
            NA.Particles.afterImage(drX[i], drY[i], Pl.angle, 8, 0.24, 0.3, 0.95, 1, 0.4, 0);
          }
        },
        render: function () {
          for (var i = 0; i < drN; i++) {
            var a = Math.atan2(Pl.y - drY[i], Pl.x - drX[i]);
            R.line(L.PLAYER, drX[i], drY[i], drX[i] + Math.cos(a + Math.PI) * 9, drY[i] + Math.sin(a + Math.PI) * 9,
              1.6, 0.3, 0.95, 1, 0.6);
          }
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 31. TURRET — orbitals slot                                           */
  /* ==================================================================== */
  U.define('turret', {
    family: 'summon', tags: ['orbital', 'zone', 'spend'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: 20 mana bolts a ten-second turret to the floor where you stand.
        update: function (dt) {
          tick(dt);
          if (hActive('turret') && tuN < (T('turret') >= 3 ? 3 : 1)) {
            if (pay(20, 'turret')) {
              turretAdd(Pl.x, Pl.y);
              if (NA.Audio) NA.Audio.sfx('spawn', { x: Pl.x, y: Pl.y });
            }
          }
          var s = Pl.stats;
          for (var i = 0; i < tuN; i++) {
            tuLife[i] -= dt;
            if (tuLife[i] <= 0) { turretFree(i, true); i--; continue; }
            tuCd[i] -= dt;
            if (tuCd[i] > 0) continue;
            var tgt = nearestFoe(tuX[i], tuY[i], 620);
            if (tgt < 0) continue;
            tuCd[i] = 0.22;
            var a = Math.atan2(En.y[tgt] - tuY[i], En.x[tgt] - tuX[i]);
            var o = bo(s.damage * 0.55, 6, 1.2); o.r = 1; o.g = 0.18; o.b = 0.30;
            hFire(tuX[i], tuY[i], Math.cos(a) * 1050, Math.sin(a) * 1050, o);
          }
        },
        render: function () {
          for (var i = 0; i < tuN; i++) {
            var k = M.clamp01(tuLife[i] / 10);
            R.poly(L.PARTICLES, tuX[i], tuY[i], 13, 6, NA.Time.t * 0.62, 2, 1, 0.18, 0.30, 0.85);
            R.arc(L.PARTICLES, tuX[i], tuY[i], 17, -M.HALFPI, -M.HALFPI + TAU * k, 1.6, 1, 0.847, 0.302, 0.6);
            R.dot(L.PARTICLES, tuX[i], tuY[i], 2.4, 1, 0.9, 0.85, 0.8);
          }
        }
      },
      { // T2: two turrets inside 300 units string a cutting laser between them.
        update: function (dt) {
          if (tuN < 2) return;
          for (var i = 0; i < tuN; i++) {
            for (var j = i + 1; j < tuN; j++) {
              var dx = tuX[j] - tuX[i], dy = tuY[j] - tuY[i];
              var len2 = dx * dx + dy * dy;
              if (len2 > 300 * 300 || len2 < 1) continue;
              // segment test against the enemy grid around the midpoint
              var mx = (tuX[i] + tuX[j]) * 0.5, my = (tuY[i] + tuY[j]) * 0.5;
              var len = Math.sqrt(len2);
              var cnt = En.grid.query(mx, my, len * 0.5 + 40), out = En.grid.out;
              for (var q = 0; q < cnt; q++) {
                var e = out[q];
                if (e >= En.n || (En.ally && En.ally[e] > 0)) continue;
                var px = En.x[e] - tuX[i], py = En.y[e] - tuY[i];
                var t = (px * dx + py * dy) / len2;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                var qx = px - dx * t, qy = py - dy * t;
                if (qx * qx + qy * qy > 26 * 26) continue;
                hDamage(e, hPD(90) * dt, 'player');
              }
            }
          }
        },
        render: function () {
          for (var i = 0; i < tuN; i++) for (var j = i + 1; j < tuN; j++) {
            var dx = tuX[j] - tuX[i], dy = tuY[j] - tuY[i];
            if (dx * dx + dy * dy > 300 * 300) continue;
            R.line(L.PARTICLES, tuX[i], tuY[i], tuX[j], tuY[j], 2.2, 1, 0.18, 0.30,
              0.5 + 0.25 * Math.sin(NA.Time.t * 8));
          }
        }
      },
      { // T3: three pods at once, and each one detonates when its clock runs out.
        render: function () {
          for (var i = 0; i < tuN; i++) {
            if (tuLife[i] > 1.5) continue;
            R.ring(L.VEIL, tuX[i], tuY[i], 150 * (1 - tuLife[i] / 1.5), 2, 1, 0.54, 0,
              En.telegraphPulse(1.5 - tuLife[i], 1.1));
          }
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 32. MIRROR — orbitals slot                                           */
  /* ==================================================================== */
  U.define('mirror', {
    family: 'summon', tags: ['orbital'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: a translucent twin 80 units off your flank fires at half strength.
        update: function (dt) { tick(dt); },
        onFire: function (ctx) {
          var n = T('mirror') >= 3 ? 2 : 1, s = Pl.stats;
          for (var k = 0; k < n; k++) {
            var m = mirrorPos(k, n);
            var o = bo(s.damage * 0.5, s.bulletSize * 0.9, s.life);
            o.pierce = s.pierce; o.bounce = s.bounce; o.homing = s.homing; o.explode = s.explode;
            o.r = 0.7; o.g = 0.85; o.b = 1; o.a = 0.8;
            hFire(m.x, m.y, Math.cos(m.a) * s.bulletSpeed, Math.sin(m.a) * s.bulletSpeed, o);
          }
        },
        render: function () {
          var n = T('mirror') >= 3 ? 2 : 1;
          for (var k = 0; k < n; k++) {
            var m = mirrorPos(k, n);
            Ship.render(m.x, m.y, m.a, 0.30, 0.9, MIRROR_COL);
          }
        }
      },
      { // T2: the twin is offset in time instead of space — half a second behind you.
        render: function () {
          if (mrFilled < MR_N) return;
          var m = mirrorPos(0, 1);
          R.line(L.AFTER, Pl.x, Pl.y, m.x, m.y, 1, 0.7, 0.85, 1, 0.18);
        }
      },
      { // T3: two twins, held at ±120° around you.
        render: function () {
          for (var k = 0; k < 2; k++) {
            var m = mirrorPos(k, 2);
            R.ring(L.PLAYER, m.x, m.y, 15, 1, 0.7, 0.85, 1, 0.25);
          }
        }
      }
    ]
  });
  var MIRROR_COL = [0.70, 0.85, 1.0];

  /* ==================================================================== */
  /* 33. MINES — area, orbitals slot                                      */
  /* ==================================================================== */
  U.define('mines', {
    family: 'area', tags: ['zone', 'explode', 'dash'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: a mine falls out of the tailpipe every two seconds, twelve at a time.
        update: function (dt) {
          tick(dt); mineTick(dt);
          mineDropT += dt;
          if (mineDropT >= 2) {
            mineDropT = 0;
            var a = Pl.angle + Math.PI;
            mineAdd(Pl.x + Math.cos(a) * 24, Pl.y + Math.sin(a) * 24);
          }
        },
        render: function () { mineRender(); }
      },
      { // T2: mines wake up and crawl toward whatever is nearest.
        render: function () {
          for (var i = 0; i < mnN; i++)
            if (mnVX[i] * mnVX[i] + mnVY[i] * mnVY[i] > 100)
              R.line(L.PARTICLES, mnX[i], mnY[i], mnX[i] - mnVX[i] * 0.06, mnY[i] - mnVY[i] * 0.06,
                1.2, 1, 0.54, 0, 0.5);
        }
      },
      { // T3: one detonation lights a visible fuse into every mine near it.
        render: function () {
          for (var i = 0; i < mnN; i++) {
            if (mnFuse[i] <= 0) continue;
            for (var j = 0; j < mnN; j++) {
              if (j === i || mnFuse[j] > 0) continue;
              var dx = mnX[j] - mnX[i], dy = mnY[j] - mnY[i];
              if (dx * dx + dy * dy > 260 * 260) continue;
              R.line(L.PARTICLES, mnX[i], mnY[i], mnX[j], mnY[j], 1, 1, 0.18, 0.30, 0.45);
            }
          }
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 34. STORM CLOUD — area, orbitals slot                                */
  /* ==================================================================== */
  U.define('stormCloud', {
    family: 'area', tags: ['zone', 'mana'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: a drifting cloud that drags on enemies and gnaws at them.
        update: function (dt) {
          tick(dt);
          if (!cloud.on) { cloud.on = true; cloud.x = Pl.x; cloud.y = Pl.y + 120; }
          if (T('stormCloud') >= 2) {                       // T2 steers it with the cursor
            cloud.x = M.smooth(cloud.x, Pl.aimX, 2.4, dt);
            cloud.y = M.smooth(cloud.y, Pl.aimY, 2.4, dt);
          } else {
            cloud.x += Math.cos(NA.Time.t * 0.3) * 26 * dt;
            cloud.y += Math.sin(NA.Time.t * 0.23) * 26 * dt;
          }
          cloud.tick += dt;
          var doTick = cloud.tick >= 0.4;
          if (doTick) cloud.tick = 0;
          var cnt = En.grid.query(cloud.x, cloud.y, cloud.r), out = En.grid.out;
          for (var q = 0; q < cnt; q++) {
            var i = out[q];
            if (i >= En.n || (En.ally && En.ally[i] > 0)) continue;
            En.vx[i] *= 0.955; En.vy[i] *= 0.955;             // slow
            if (doTick) hDamage(i, hPD(12), 'player');
          }
        },
        render: function () {
          var t = NA.Time.t;
          R.disc(L.FLOOR, cloud.x, cloud.y, cloud.r, 0.36, 0.30, 0.62, 0.22);
          R.ring(L.FLOOR, cloud.x, cloud.y, cloud.r, 1.6, 0.608, 0.361, 1, 0.35);
          for (var k = 0; k < 5; k++) {
            var a = t * 0.4 + k * (TAU / 5);
            R.disc(L.FLOOR, cloud.x + Math.cos(a) * cloud.r * 0.55, cloud.y + Math.sin(a) * cloud.r * 0.55,
              cloud.r * 0.45, 0.36, 0.30, 0.62, 0.16);
          }
        }
      },
      { // T2: the cloud follows your cursor and splits every round fired through it.
        update: function (dt) {
          var P = B.P, r2 = cloud.r * cloud.r;
          for (var i = 0; i < P.n; i++) {
            if (P.flags[i] & SPLIT_BIT) continue;
            var dx = P.x[i] - cloud.x, dy = P.y[i] - cloud.y;
            if (dx * dx + dy * dy > r2) continue;
            P.flags[i] |= SPLIT_BIT;
            var sp = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]) || 900;
            for (var s = -1; s <= 1; s += 2) {
              var a = P.rot[i] + s * 0.20;
              var o = bo(P.dmg[i], P.size[i], P.life[i]);
              o.pierce = P.pierce[i]; o.bounce = P.bounce[i]; o.homing = P.homing[i];
              o.explode = P.explode[i]; o.flags = P.flags[i];
              hFire(P.x[i], P.y[i], Math.cos(a) * sp, Math.sin(a) * sp, o);
            }
          }
        },
        render: function () {
          R.line(L.AFTER, Pl.x, Pl.y, cloud.x, cloud.y, 1, 0.608, 0.361, 1, 0.2);
        }
      },
      { // T3: the cloud discharges lightning into the field twice a second.
        update: function (dt) {
          cloud.bolt -= dt;
          if (cloud.bolt > 0) return;
          cloud.bolt = 0.5;
          var tgt = nearestFoe(cloud.x, cloud.y, cloud.r + 60);
          if (tgt < 0) return;
          hChain(cloud.x, cloud.y, Pl.stats.damage * 1.2, 4, 240);
          if (NA.Audio) NA.Audio.sfx('shotHeavy', { x: cloud.x, y: cloud.y, vol: 0.35 });
        },
        render: function () {
          R.disc(L.FLOOR, cloud.x, cloud.y, cloud.r * 1.05, 0.10, 0.08, 0.2, 0.30);
          var k = 1 - cloud.bolt / 0.5;
          R.ring(L.FLOOR, cloud.x, cloud.y, cloud.r * k, 1.2, 0.608, 0.361, 1, 0.3 * (1 - k));
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 35. GRAVITY WELL — area, orbitals slot                               */
  /* ==================================================================== */
  U.define('gravityWell', {
    family: 'area', tags: ['zone', 'spend', 'explode'], visual: { slot: 'orbitals' },
    tiers: [
      { // T1: 35 mana opens a three-second well that hauls in bodies and their shots.
        update: function (dt) {
          tick(dt);
          if (!well.on && hActive('gravityWell') && pay(35, 'well')) {
            well.on = true; well.t = 3; well.x = Pl.aimX; well.y = Pl.aimY; well.count = 0;
            NA.Particles.ring(well.x, well.y, 6, well.r, 0.5, 3, 0.608, 0.361, 1, 0.9);
            if (NA.Audio) NA.Audio.sfx('explode', { x: well.x, y: well.y, vol: 0.4 });
          }
          if (!well.on) return;
          well.t -= dt;
          var inside = 0;
          var cnt = En.grid.query(well.x, well.y, well.r), out = En.grid.out;
          for (var q = 0; q < cnt; q++) {
            var i = out[q];
            if (i >= En.n) continue;
            var dx = well.x - En.x[i], dy = well.y - En.y[i];
            var d = Math.sqrt(dx * dx + dy * dy) || 1;
            En.vx[i] += dx / d * 620 * dt; En.vy[i] += dy / d * 620 * dt;
            inside++;
          }
          var E = B.E, r2 = well.r * well.r;
          ebBuild();                                   // enemy-bullet grid, once a frame
          var bc = ebGrid ? ebGrid.query(well.x, well.y, well.r, EB_OUT) : 0;
          for (var q2 = 0; q2 < bc; q2++) {
            var b = EB_OUT[q2];
            if (b >= E.n) continue;
            var ex = well.x - E.x[b], ey = well.y - E.y[b];
            var e2 = ex * ex + ey * ey;
            if (e2 > r2) continue;
            var el = Math.sqrt(e2) || 1;
            E.vx[b] += ex / el * 900 * dt; E.vy[b] += ey / el * 900 * dt;
            E.rot[b] = Math.atan2(E.vy[b], E.vx[b]);
            inside++;
          }
          well.count = inside;
          if (well.t <= 0) {
            well.on = false;
            if (T('gravityWell') >= 3) {                    // T3: the collapse itself hurts
              var dmg = 20 + Math.min(60, well.count) * 12;
              hExplode(well.x, well.y, well.r * 1.1, dmg);
              NA.FX.trauma(0.2); NA.FX.chroma(2.5, 200);
            }
            B.clearArea(well.x, well.y, well.r, false);
            NA.Particles.ring(well.x, well.y, well.r, 4, 0.4, 4, 0.608, 0.361, 1, 1);
          }
        },
        render: function () {
          if (!well.on) return;
          var k = M.clamp01(well.t / 3), t = NA.Time.t;
          R.disc(L.FLOOR, well.x, well.y, well.r, 0.608, 0.361, 1, 0.18);
          R.ring(L.FLOOR, well.x, well.y, well.r * (0.4 + 0.6 * k), 2, 0.608, 0.361, 1, 0.6);
          R.dot(L.FLOOR, well.x, well.y, 6, 0.9, 0.8, 1, 0.9);
          for (var s = 0; s < 4; s++) {
            var a = t * 2.2 + s * M.HALFPI, rr = well.r * (0.25 + 0.2 * s) * k;
            R.arc(L.FLOOR, well.x, well.y, rr, a, a + 1.2, 1.4, 0.608, 0.361, 1, 0.5);
          }
        }
      },
      { // T2: your own rounds whip around the rim and leave at double speed.
        update: function (dt) {
          if (!well.on) return;
          var P = B.P, r2 = well.r * well.r;
          for (var i = 0; i < P.n; i++) {
            var dx = well.x - P.x[i], dy = well.y - P.y[i];
            var d2 = dx * dx + dy * dy;
            if (d2 > r2 || d2 < 400) continue;
            var d = Math.sqrt(d2);
            // tangential slingshot: curve, then accelerate outward
            var tx = -dy / d, ty = dx / d;
            P.vx[i] += (tx * 900 + dx / d * 260) * dt;
            P.vy[i] += (ty * 900 + dy / d * 260) * dt;
            var sp = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]);
            var cap = Pl.stats.bulletSpeed * 2;
            if (sp > cap) { var kk = cap / sp; P.vx[i] *= kk; P.vy[i] *= kk; }
            P.rot[i] = Math.atan2(P.vy[i], P.vx[i]);
          }
        },
        render: function () {
          if (!well.on) return;
          R.ring(L.FLOOR, well.x, well.y, well.r * 0.62, 1.2, 0.9, 0.8, 1, 0.3);
        }
      },
      { // T3: the collapse pays out for everything that was caught inside.
        render: function () {
          if (!well.on || well.t > 0.6) return;
          En.telegraphCircle(well.x, well.y, well.r * 1.1, 0.6 - well.t, 0.6, 0.4);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 36. BURN TRAIL — area, trail slot                                    */
  /* ==================================================================== */
  U.define('burnTrail', {
    family: 'area', tags: ['zone', 'dash', 'kill'], visual: { slot: 'trail' },
    tiers: [
      { // T1: the exhaust ribbon itself is hot — 60 points of it, and it burns.
        update: function (dt) {
          tick(dt);
          trTick += dt;
          if (trTick >= 0.03) {
            trTick = 0;
            trX[trHead] = Pl.x; trY[trHead] = Pl.y; trA[trHead] = 1.6;
            trHead = (trHead + 1) % TR_N;
            if (trFilled < TR_N) trFilled++;
          }
          if (wallT > 0) wallT -= dt;
          var burn = 0, i;
          for (i = 0; i < trFilled; i++) if (trA[i] > 0) trA[i] -= dt;
          // damage tick: sample every 4th point so the cost stays flat
          if ((NA.Time.frames & 7) === 0) {
            var rad = wallT > 0 ? 46 : 24, dmg = hPD(wallT > 0 ? 26 : 9);
            for (i = 0; i < trFilled; i += 4) {
              if (trA[i] <= 0) continue;
              var cnt = En.grid.query(trX[i], trY[i], rad), out = En.grid.out;
              for (var q = 0; q < cnt; q++) {
                var e = out[q];
                if (e >= En.n || (En.ally && En.ally[e] > 0)) continue;
                hBurn(e, 2, Pl.stats.damage * 0.35);
                hDamage(e, dmg, 'player');
                burn++;
                if (burn > 40) break;
              }
              if (burn > 40) break;
            }
          }
          if (!(U.helpers && U.helpers.setBurn))          // fallback path only
            for (i = 0; i < En.n; i++) if (burnT[i] > 0) burnT[i] -= dt;
          // fire pools
          for (i = 0; i < fpN; i++) {
            fpLife[i] -= dt;
            if (fpLife[i] <= 0) { fpFree(i); i--; continue; }
            fpTick[i] += dt;
            if (fpTick[i] < 0.4) continue;
            fpTick[i] = 0;
            var c2 = En.grid.query(fpX[i], fpY[i], fpR[i]), o2 = En.grid.out;
            for (var w = 0; w < c2; w++) {
              var ee = o2[w];
              if (ee >= En.n || (En.ally && En.ally[ee] > 0)) continue;
              hBurn(ee, 2, Pl.stats.damage * 0.35);
              hDamage(ee, hPD(16), 'player');
            }
          }
        },
        render: function () {
          // The freshest points sit exactly on the ship and stack additively into
          // an opaque orange blob over the hull, so the readability rule loses its
          // "hull + one white core" silhouette. Skip anything inside the ship
          // footprint: the burn itself is unchanged, only the paint is.
          var hx = Pl.x, hy = Pl.y, NEAR2 = 19 * 19;
          for (var i = 0; i < trFilled; i++) {
            if (trA[i] <= 0) continue;
            var ddx = trX[i] - hx, ddy = trY[i] - hy;
            if (ddx * ddx + ddy * ddy < NEAR2) continue;
            var a = M.clamp01(trA[i] / 1.6);
            var hot = wallT > 0;
            R.dot(L.PARTICLES, trX[i], trY[i], (hot ? 9 : 5) * a + 2,
              1, hot ? 0.85 : 0.45, hot ? 0.9 : 0.05, 0.34 * a);
          }
          for (i = 0; i < fpN; i++) {
            var k = M.clamp01(fpLife[i] / 5);
            R.disc(L.FLOOR, fpX[i], fpY[i], fpR[i], 1, 0.42, 0.05, 0.30 * k);
            R.ring(L.FLOOR, fpX[i], fpY[i], fpR[i] * (0.7 + 0.3 * Math.sin(NA.Time.t * 5 + i)), 1.4, 1, 0.54, 0, 0.5 * k);
          }
        }
      },
      { // T2: a dash ignites the whole ribbon into a three-second wall of fire.
        onDash: function (ctx) {
          wallT = 3;
          for (var i = 0; i < trFilled; i++) trA[i] = Math.max(trA[i], 1.6);
          NA.FX.trauma(0.08);
          if (NA.Audio) NA.Audio.sfx('explode', { x: ctx.x, y: ctx.y, vol: 0.4 });
        },
        render: function () {
          if (wallT <= 0) return;
          var prev = -1;
          for (var i = 0; i < trFilled; i++) {
            if (trA[i] <= 0) { prev = -1; continue; }
            if (prev >= 0) R.line(L.PARTICLES, trX[prev], trY[prev], trX[i], trY[i], 5, 0.6, 0.85, 1, 0.35);
            prev = i;
          }
        }
      },
      { // T3: anything that dies burning leaves a pool of fire behind (cap 20).
        onKill: function (ctx) {
          // F23: reads the SHARED burn state, so a Gatling burn also leaves a pool
          if (ctx.ei < 0 || ctx.ei >= C.MAX_ENEMIES || !hBurning(ctx.ei)) return;
          firePoolAdd(ctx.x, ctx.y, 62);
        },
        render: function () {
          R.disc(L.PBULLETS, Pl.x, Pl.y, 16, 1, 0.42, 0.05, 0.12);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 37. GHOST ROUNDS — wildcard, hull slot                               */
  /* ==================================================================== */
  var grCursor = 0;
  U.define('ghostRounds', {
    family: 'wildcard', tags: ['pierce'], wildcard: true, visual: { slot: 'hull' },
    tiers: [
      { // T1: nobody can see your rounds, and they hit twice as hard.
        update: function (dt) {
          tick(dt);
          var P = B.P, F = B.FLAG.INVISIBLE;
          for (var i = 0; i < P.n; i++) P.flags[i] |= F;
        },
        render: function () {
          R.poly(L.PLAYER, Pl.x, Pl.y, 13, 6, NA.Time.t * -0.62, 1, 0.35, 0.4, 0.48, 0.5);
        }
      },
      { // T2: struck enemies never flinch or light up, so nothing gives you away.
        onHit: function (ctx) {
          if (ctx.ei < 0 || ctx.ei >= En.n) return;
          En.flash[ctx.ei] = 0; En.hitT[ctx.ei] = 0;
        },
        render: function () {
          R.sprite(L.PLAYER, 'shipHull', Pl.x, Pl.y, Pl.angle, 15, 13, 0.12, 0.13, 0.16, 0.5);
        }
      },
      { // T3: rounds flicker into view when they pass an enemy shot.
        render: function () {
          if (!ebGrid) return;
          var P = B.P, n = P.n;
          if (!n) return;
          var scanned = 0;
          for (var s = 0; s < SCAN_CAP && scanned < n; s++, scanned++) {
            var i = (grCursor + s) % n;
            var c = ebGrid.query(P.x[i], P.y[i], 70);
            if (!c) continue;
            R.sprite(L.PBULLETS, 'capsule', P.x[i], P.y[i], P.rot[i], P.size[i] * 1.5, P.size[i] * 0.7,
              1, 1, 1, 0.55);
          }
          grCursor = (grCursor + SCAN_CAP) % n;
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 38. CLAUSTROPHOBIA — wildcard, hull slot                             */
  /* ==================================================================== */
  var clausPulse = 0;
  function clausTarget() {
    var t = T('claustrophobia');
    if (t >= 3) return C.ARENA_R * 0.5;
    if (t === 2) return C.ARENA_R * 0.6;
    if (t === 1) return C.ARENA_R * 0.8;
    return C.ARENA_R;
  }
  U.define('claustrophobia', {
    family: 'wildcard', tags: ['bounce', 'explode'], wildcard: true, visual: { slot: 'hull' },
    tiers: [
      { // T1: the ring closes 20% and being crowded makes you hit 25% harder.
        update: function (dt) {
          tick(dt);
          var want = clausTarget();
          if (Math.abs(NA.Arena.radius - want) > 10 && NA.Arena._rDur <= 0) NA.Arena.setRadius(want, 1.2);
        },
        render: function () {
          R.ring(L.MEMBRANE, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius - 6, 1.2, 1, 0.18, 0.30, 0.18);
        }
      },
      { // T2: another 20%, and the membrane itself grinds enemies that touch it.
        update: function (dt) {
          if ((NA.Time.frames & 3) !== 0) return;
          for (var i = 0; i < En.n; i++) {
            if (En.ally && En.ally[i] > 0) continue;
            if (NA.Arena.depth(En.x[i], En.y[i]) < En.size[i] + 4) {
              hDamage(i, hPD(34) * dt * 4, 'player');
              if ((NA.Time.frames & 15) === 0) NA.Arena.ripple(En.x[i], En.y[i], 0.3, 1, 0.18, 0.3);
            }
          }
        },
        render: function () {
          R.ring(L.MEMBRANE, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius, 2.4, 1, 0.18, 0.30, 0.28);
        }
      },
      { // T3: half an arena, and every five seconds the walls punch inward.
        update: function (dt) {
          clausPulse -= dt;
          if (clausPulse > 0) return;
          clausPulse = 5;
          var r = NA.Arena.radius;
          for (var i = 0; i < En.n; i++) {
            if (En.ally && En.ally[i] > 0) continue;
            var dx = En.x[i] - NA.Arena.cx, dy = En.y[i] - NA.Arena.cy;
            var d = Math.sqrt(dx * dx + dy * dy) || 1;
            if (d < r * 0.62) continue;
            hDamage(i, hPD(60), 'player');
            En.vx[i] -= dx / d * 500; En.vy[i] -= dy / d * 500;
          }
          NA.Arena.ripple(NA.Arena.cx + r * 0.9, NA.Arena.cy, 1.4, 1, 0.18, 0.3);
          NA.FX.trauma(0.15);
        },
        render: function () {
          // ≥0.4 s of warning before every wall punch
          if (clausPulse > 0.9) return;
          En.telegraphCircle(NA.Arena.cx, NA.Arena.cy, NA.Arena.radius * 0.66,
            0.9 - clausPulse, 0.9, 0.5);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 39. GLASS HULL — wildcard, hull slot                                 */
  /* ==================================================================== */
  U.define('glassHull', {
    family: 'wildcard', tags: ['mana'], wildcard: true, visual: { slot: 'hull' },
    tiers: [
      { // T1: one hit point, +80% damage, +50% trickle. That is the whole deal.
        apply: function (p) { p.maxHp = 1; p.hp = 1; },
        update: function (dt) { tick(dt); },
        render: function () {
          R.sprite(L.PLAYER, 'shipHull', Pl.x, Pl.y, Pl.angle, 17, 15, 0.42, 0.92, 1, 0.22);
        }
      },
      { // T2: with 50 mana banked, a hit drains the bar instead of the hull.
        render: function () {
          if (Pl.mana < 50) return;
          R.ring(L.PLAYER, Pl.x, Pl.y, 21, 1.6, 0.3, 0.95, 1, 0.35 + 0.2 * Math.sin(NA.Time.t * 4));
          for (var k = 0; k < 6; k++) {
            var a = NA.Time.t * 1.15 + k * (TAU / 6);
            R.line(L.PLAYER, Pl.x + Math.cos(a) * 19, Pl.y + Math.sin(a) * 19,
              Pl.x + Math.cos(a) * 25, Pl.y + Math.sin(a) * 25, 1.2, 0.3, 0.95, 1, 0.4);
          }
        }
      },
      { // T3: every wave you finish untouched is +10% damage for the rest of the run.
        render: function () {
          for (var k = 0; k < Math.min(8, glassStacks); k++) {
            var a = -NA.Time.t * 0.62 + k * (TAU / 8);
            R.poly(L.PLAYER, Pl.x + Math.cos(a) * 33, Pl.y + Math.sin(a) * 33, 3, 3, a, 1, 0.42, 0.92, 1, 0.55);
          }
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 40. BERSERK — wildcard, hull slot                                    */
  /* ==================================================================== */
  U.define('berserk', {
    family: 'wildcard', tags: ['mana', 'spend', 'dash'], wildcard: true, visual: { slot: 'hull' },
    tiers: [
      { // T1: the emptier the bar the harder you hit (+100% at zero); actives cost +30%.
        // the tax rides the shared modifier table, so EVERY active pays it
        apply: function () { U.mods.manaCost *= 1.3; },
        update: function (dt) { tick(dt); },
        render: function () {
          var k = 1 - Pl.mana / Pl.manaMax;
          R.disc(L.PBULLETS, Pl.x, Pl.y, 24, 1, 0.18, 0.30, 0.05 + k * 0.14);
        }
      },
      { // T2: below 20 mana you are half again as fast, in the trigger and the hull.
        render: function () {
          if (Pl.mana > 20) return;
          for (var s = -1; s <= 1; s += 2) {
            var a = Pl.angle + s * 2.45;
            R.line(L.PLAYER, Pl.x + Math.cos(a) * 12, Pl.y + Math.sin(a) * 12,
              Pl.x + Math.cos(a) * 24, Pl.y + Math.sin(a) * 24, 2, 1, 0.18, 0.30, 0.85);
          }
        }
      },
      { // T3: at zero mana the dash is free — it takes a hull point instead.
        onDash: function (ctx) {
          if (Pl.mana > 0.5 || Pl.hp <= 1) return;
          Pl.hp -= 1;
          Pl.invuln = Math.max(Pl.invuln, C.INVULN * 0.5);
          NA.FX.chroma(2, 160); NA.FX.trauma(0.2);
          NA.Particles.burst(ctx.x, ctx.y, 8, 260, 0.3, 1, 0.18, 0.30, 2);
          if (NA.Game) NA.Game.emit('playerHit', Pl.hp);
        },
        render: function () {
          if (Pl.mana > 0.5) return;
          if ((NA.Time.frames & 7) === 0)
            NA.Particles.spawn(Pl.x, Pl.y, NA.RNG.range(-40, 40), NA.RNG.range(-40, 40),
              0.4, 2.4, 1, 0.18, 0.30, 0.8, 2, 0.9);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 41. FEEDBACK LOOP — wildcard, aura slot                              */
  /* ==================================================================== */
  U.define('feedbackLoop', {
    family: 'wildcard', tags: ['mana', 'bounce'], wildcard: true, visual: { slot: 'aura' },
    tiers: [
      { // T1: the whole field shoots 30% more often — and every graze pays double.
        // F2 — the graze doubling has to ride the shared modifier table: every
        // reapply() rebuilds NA.Player.grazeMul from mods.grazeMul, so a raw
        // write to the player was erased by the very draft that took this.
        apply: function () { U.mods.grazeMul *= 2; },
        update: function (dt) { tick(dt); },
        render: function () {
          R.ring(L.PLAYER, Pl.x, Pl.y, 36, 1.2, 0.55, 0.58, 0.65,
            0.22 + 0.1 * Math.sin(NA.Time.t * 3));
        }
      },
      { // T2: your rounds swallow enemy rounds they touch, +10% damage each.
        update: function (dt) {
          if (!ebGrid) return;
          var P = B.P, E = B.E, absorbed = 0;
          var n = P.n; if (!n) return;
          for (var s = 0; s < SCAN_CAP && absorbed < ABSORB_CAP; s++) {
            var i = (absorbCursor + s) % n;
            var c = ebGrid.query(P.x[i], P.y[i], P.size[i] + 12);
            if (!c) continue;
            var e = ebGrid.out[0];
            if (e >= E.n) continue;
            P.dmg[i] *= 1.1; P.size[i] = Math.min(20, P.size[i] * 1.04);
            NA.Particles.burst(E.x[e], E.y[e], 2, 110, 0.16, 0.55, 0.58, 0.65, 1);
            B.killE(e, true);          // one absorb per bullet per frame, hard-capped
            absorbed++;
          }
          absorbCursor = (absorbCursor + SCAN_CAP) % n;
        },
        render: function () {
          for (var k = 0; k < 4; k++) {
            var a = NA.Time.t * Ship.SPIN_B + k * M.HALFPI;
            R.dot(L.PLAYER, Pl.x + Math.cos(a) * 17, Pl.y + Math.sin(a) * 17, 2, 0.55, 0.58, 0.65, 0.8);
          }
        }
      },
      { // T3: half the shots that would have hit you leave again as yours.
        render: function () {
          R.ring(L.PLAYER, Pl.x, Pl.y, 42, 1, 0.62, 0.70, 0.86, 0.16);
        }
      }
    ]
  });

  /* ==================================================================== */
  /* 42. GAMBLER — wildcard, core slot                                    */
  /* ==================================================================== */
  var WEAPONS = ['twinBarrels', 'railgun', 'buckshot', 'mortar', 'gatling'];
  var gShot = 0;
  var grantIds = [], grantSaved = [];        // temporary T1 grants, this wave only
  var promoId = '', promoSaved = -1;         // the wave's random promotion
  var grantQueue = [];

  /* Approximations of the five T1 weapon shots, fired locally so this file
   * never has to reach into UPGRADES-A's internals. */
  function gamblerShot(x, y, ang) {
    var s = Pl.stats, w = WEAPONS[(NA.RNG.f() * WEAPONS.length) | 0], k, a, o;
    if (w === 'twinBarrels') {
      for (k = -1; k <= 1; k += 2) {
        o = bo(s.damage * 0.75, s.bulletSize, s.life);
        hFire(x + Math.cos(ang + M.HALFPI) * k * 9, y + Math.sin(ang + M.HALFPI) * k * 9,
          Math.cos(ang) * s.bulletSpeed, Math.sin(ang) * s.bulletSpeed, o);
      }
    } else if (w === 'railgun') {
      o = bo(s.damage * 2.4, s.bulletSize * 1.3, s.life); o.pierce = 6;
      hFire(x, y, Math.cos(ang) * s.bulletSpeed * 1.8, Math.sin(ang) * s.bulletSpeed * 1.8, o);
    } else if (w === 'buckshot') {
      for (k = 0; k < 5; k++) {
        a = ang + (k - 2) * 0.11;
        o = bo(s.damage * 0.5, s.bulletSize * 0.85, s.life * 0.6);
        hFire(x, y, Math.cos(a) * s.bulletSpeed * 0.9, Math.sin(a) * s.bulletSpeed * 0.9, o);
      }
    } else if (w === 'mortar') {
      o = bo(s.damage * 1.2, s.bulletSize * 1.6, 0.55); o.explode = 110;
      hFire(x, y, Math.cos(ang) * 620, Math.sin(ang) * 620, o);
    } else {
      for (k = 0; k < 3; k++) {
        a = ang + (NA.RNG.f() - 0.5) * 0.12;
        o = bo(s.damage * 0.5, s.bulletSize * 0.8, s.life);
        hFire(x, y, Math.cos(a) * s.bulletSpeed, Math.sin(a) * s.bulletSpeed, o);
      }
    }
    NA.Particles.burst(x, y, 3, 160, 0.2, 1, 0.847, 0.302, 1);
  }

  /* Wave boundary: hand back last wave's temporary tiers (never below what the
   * player actually earned — nothing here can demote you), then roll new ones. */
  function gamblerWave(w) {
    var i, changed = false;
    for (i = 0; i < grantIds.length; i++) {
      var gid = grantIds[i];
      if ((U.owned[gid] || 0) <= grantSaved[i] + 1) { U.owned[gid] = grantSaved[i]; changed = true; }
    }
    grantIds.length = 0; grantSaved.length = 0; grantQueue.length = 0;
    if (promoId && promoSaved >= 0) {
      if ((U.owned[promoId] || 0) > promoSaved) { U.owned[promoId] = promoSaved; changed = true; }
      promoId = ''; promoSaved = -1;
    }
    if (T('gambler') >= 3 && w > 0) {
      var ids = U.ownedIds(), pick = [];
      for (i = 0; i < ids.length; i++) {
        var d = U.get(ids[i]);
        if (d && U.owned[ids[i]] < d.maxTier) pick.push(ids[i]);
      }
      if (pick.length) {
        promoId = pick[(NA.RNG.f() * pick.length) | 0];
        promoSaved = U.owned[promoId];
        U.take(promoId);                    // F23: through the slot system
        changed = true;
        NA.FX.chroma(3, 300);
        NA.Particles.ring(Pl.x, Pl.y, 8, 180, 0.5, 3, 1, 0.847, 0.302, 0.9);
      }
    }
    if (changed) U.reapply();
  }

  U.define('gambler', {
    family: 'wildcard', tags: ['kill', 'spend', 'explode', 'orbital'], wildcard: true,
    visual: { slot: 'core' },
    tiers: [
      { // T1: every tenth shot comes out of somebody else's gun.
        update: function (dt) {
          tick(dt);
          if (!grantQueue.length) return;
          var id = grantQueue.pop();
          var d = U.get(id);
          if (d && (U.owned[id] || 0) < d.maxTier) {
            grantIds.push(id); grantSaved.push(U.owned[id] || 0);
            // F23 — take() is the one door: it sets the ship slot, fires
            // draftPick (the hull glitches into the new form) and reapplies.
            U.take(id);
            NA.Particles.ring(Pl.x, Pl.y, 6, 120, 0.4, 2.6, 1, 0.847, 0.302, 0.9);
            if (NA.Audio) NA.Audio.sfx('manaFull');
          }
        },
        onFire: function (ctx) {
          if (++gShot % 10) return;
          gamblerShot(ctx.x, ctx.y, ctx.angle);
        },
        render: function () {
          var k = (gShot % 10) / 10;
          R.arc(L.PLAYER, Pl.x, Pl.y, 15, Math.PI * 0.25, Math.PI * 0.25 + TAU * k, 1.6, 1, 0.847, 0.302, 0.7);
        }
      },
      { // T2: one kill in twenty hands you a tier-1 you don't own, for this wave.
        onKill: function (ctx) {
          if (NA.RNG.f() >= 0.05 || grantQueue.length > 2) return;
          var listIds = U.list, tries = 0;
          while (tries++ < 12) {
            var id = listIds[(NA.RNG.f() * listIds.length) | 0];
            if (!id || id === 'gambler' || (U.owned[id] || 0) > 0) continue;
            grantQueue.push(id);                       // applied in update, never mid-emit
            return;
          }
        },
        render: function () {
          for (var k = 0; k < grantIds.length && k < 6; k++) {
            var a = NA.Time.t * 1.15 + k * (TAU / 6);
            R.poly(L.PLAYER, Pl.x + Math.cos(a) * 29, Pl.y + Math.sin(a) * 29, 3.4, 4, a, 1.2, 1, 0.847, 0.302, 0.7);
          }
        }
      },
      { // T3: each wave one upgrade you own glitches up a tier for the wave.
        render: function () {
          if (!promoId) return;
          var f = (Math.sin(NA.Time.t * 23) > 0.6) ? 1 : 0;
          if (!f) return;
          R.sprite(L.PLAYER, 'shipHull', Pl.x + NA.RNG.range(-3, 3), Pl.y + NA.RNG.range(-3, 3),
            Pl.angle, 16, 14, 1, 0.847, 0.302, 0.4);
        }
      }
    ]
  });
})();
