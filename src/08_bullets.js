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
 *   NA.Bullets.FLAG                        {INVISIBLE, WALLPHASE, GRAZED, NOWALL,
 *                                           ENEMYHURT, STOLEN}
 *   ENEMYHURT enemy bullets damage ENEMIES too (14 x dmg), armed 0.1s after
 *   they are fired so a shooter cannot kill itself. Handled here and only here.
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
      vx *= C.BULLET_SPEED_MUL; vy *= C.BULLET_SPEED_MUL;
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
      /* Resonance Pulse: shots FIRED on the beat hit 25% harder. Stamped at
       * spawn (not at impact) so the reward is for your trigger timing. */
      if (NA.Events && NA.Events.beatWindow > 0) P.dmg[i] *= 1 + 0.25 * NA.Events.beatWindow;
      return i;
    },

    fireEnemy: function (x, y, vx, vy, o) {
      var i = E.alloc(); if (i < 0) return -1;
      o = o || EMPTY;
      vx *= C.EBULLET_SPEED_MUL; vy *= C.EBULLET_SPEED_MUL;
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
            var hdx = NA.Enemies.x[tgt] - P.x[i], hdy = NA.Enemies.y[tgt] - P.y[i];
            var want = Math.atan2(hdy, hdx);
            var cur = P.rot[i];
            var sp = Math.sqrt(P.vx[i] * P.vx[i] + P.vy[i] * P.vy[i]);
            // A missile only ORBITS its target when its turn radius (sp / turn)
            // is larger than the distance left. So the turn rate scales with
            // 1 / distance: far away it steers gently, up close it cranks over
            // hard enough to actually connect. The 1.6 factor puts the turn
            // radius comfortably inside the remaining gap.
            var hd = Math.sqrt(hdx * hdx + hdy * hdy);
            var turn = P.homing[i] * (9 + 1.6 * sp / (hd < 40 ? 40 : hd));
            var na = cur + M.norm(want - cur) * Math.min(1, turn * dt);
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
          var bdmg = P.dmg[i];
          if (NA.Events && NA.Events.hasDamageField) bdmg *= NA.Events.damageMulAt(P.x[i], P.y[i]);
          if (NA.Bosses.hit(P.x[i], P.y[i], P.size[i], bdmg)) {
            if (P.explode[i] > 0) B.explode(P.x[i], P.y[i], P.explode[i], bdmg * 0.7, 0);
            if (P.pierce[i] > 0) P.pierce[i]--;
            else { B.killP(i, true); i--; continue; }
          }
        }

        // enemies
        if (eg && NA.Enemies.n > 0) {
          /* Swept test: a fast bullet moves further per frame (~29u at base
           * speed, more with upgrades or a long frame) than a small enemy is
           * wide, so a point test at the new position tunnels straight
           * through edges. Test the whole px,py -> x,y segment instead. */
          var sx0 = P.px[i], sy0 = P.py[i];
          var sdx = P.x[i] - sx0, sdy = P.y[i] - sy0;
          var slen2 = sdx * sdx + sdy * sdy;
          var cnt = eg.query((sx0 + P.x[i]) * 0.5, (sy0 + P.y[i]) * 0.5,
            P.size[i] + 46 + Math.sqrt(slen2) * 0.5);
          var out = eg.out, dead = false;
          for (var q = 0; q < cnt; q++) {
            var ei = out[q];
            if (ei >= NA.Enemies.n) continue;
            if (NA.Enemies.intangible[ei] > 0) continue;
            var rr2 = P.size[i] + NA.Enemies.size[ei];
            // closest point on the travel segment to this enemy
            var t = slen2 > 0
              ? M.clamp01(((NA.Enemies.x[ei] - sx0) * sdx + (NA.Enemies.y[ei] - sy0) * sdy) / slen2)
              : 0;
            var hx = sx0 + sdx * t, hy = sy0 + sdy * t;
            var ddx = NA.Enemies.x[ei] - hx, ddy = NA.Enemies.y[ei] - hy;
            if (ddx * ddx + ddy * ddy > rr2 * rr2) continue;
            if (NA.Enemies.shielded(ei, hx, hy)) continue;

            /* The sky is an information source: a Pulsar wedge / Ion Storm /
             * on-beat window multiplies what lands here (GAME_PLAN §10.3). */
            var dmg = P.dmg[i];
            if (NA.Events && NA.Events.hasDamageField) dmg *= NA.Events.damageMulAt(P.x[i], P.y[i]);
            HCTX.x = hx; HCTX.y = hy; HCTX.bi = i; HCTX.ei = ei; HCTX.dmg = dmg;
            HCTX.owner = 0; HCTX.kill = false;
            HCTX.nx = ddx; HCTX.ny = ddy;
            /* damage() -> kill() -> onDeath and the onHit hooks can both free
             * player bullets (a hook that fires, explodes or resets the pool).
             * Stamp the generation and re-validate before touching slot i, or
             * the pierce decrement / free lands on somebody else's bullet. */
            var bg0 = P.gen[i], bx0 = hx, by0 = hy, bex = P.explode[i];
            var killed = NA.Enemies.damage(ei, dmg, 'player');
            HCTX.kill = killed;
            B.hits++;
            if (NA.Upgrades) NA.Upgrades.emit('onHit', HCTX);
            if (bex > 0) B.explode(bx0, by0, bex, dmg * 0.7, 0);
            NA.Particles.burst(bx0, by0, 3, 150, 0.18, 1, 1, 1, 1);
            if (i >= P.n || P.gen[i] !== bg0) { dead = true; break; }   // already gone; slot i is somebody else
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

        /* ENEMYHURT: enemy fire that also hurts enemies (Spitter bolts clearing
         * Motes, Popper ring bolts, ...). Grid-based and cheap, with a short
         * arming delay so a shooter never kills itself point blank. This is the
         * one implementation — 10b and 10c used to each run their own copy,
         * which doubled both the damage and the bullet consumption. */
        if ((E.flags[i] & FLAG.ENEMYHURT) && eg && NA.Enemies.n > 0 &&
          E.maxLife[i] - E.life[i] >= 0.1) {
          var ec = eg.query(E.x[i], E.y[i], E.size[i] + 46), eo = eg.out, egone = false;
          for (var eq = 0; eq < ec; eq++) {
            var eei = eo[eq];
            if (eei >= NA.Enemies.n) continue;
            if (NA.Enemies.intangible[eei] > 0) continue;
            if (NA.Enemies.ally[eei] > 0) continue;          // not your own risen allies
            var err = E.size[i] + NA.Enemies.size[eei];
            var edx = NA.Enemies.x[eei] - E.x[i], edy = NA.Enemies.y[eei] - E.y[i];
            if (edx * edx + edy * edy > err * err) continue;
            NA.Enemies.damage(eei, Math.max(1, E.dmg[i]) * ENEMYHURT_DMG, 'enemy');
            NA.Particles.burst(E.x[i], E.y[i], 2, 110, 0.16, E.r[i], E.g[i], E.b[i], 0);
            if (E.pierce[i] > 0) E.pierce[i]--;
            else { B.killE(i, true); egone = true; }
            break;
          }
          if (egone) { i--; continue; }
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
      // reveal is a FIELD: a sweep wedge or an eclipse reveals what is inside
      // it, so it has to be sampled at each bullet, not once at the centre.
      var Ev = NA.Events, anyReveal = Ev ? Ev.hasRevealField : false;
      for (i = 0; i < E.n; i++) {
        var ea = E.a[i];
        if (E.flags[i] & FLAG.INVISIBLE) ea *= anyReveal ? Ev.revealAlpha(E.x[i], E.y[i]) : 0;
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
        var stretch = P.size[i] * 1.6;
        R.sprite(L.PBULLETS, 'capsule', P.x[i], P.y[i], P.rot[i], stretch, P.size[i] * 0.72,
          P.r[i], P.g[i], P.b[i], pa);
        R.sprite(L.PBULLETS, 'spark', P.x[i], P.y[i], 0, P.size[i] * 1.7, P.size[i] * 1.7,
          0.30, 0.95, 1.0, pa * 0.55);
      }
    }
  };

  var EMPTY = {};
  /* one enemy bolt is worth roughly one player shot against other enemies */
  var ENEMYHURT_DMG = 14;
})();
