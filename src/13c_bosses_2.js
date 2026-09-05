/* 13c_bosses_2.js — BOSSES 11–20 (Act II tail through Act IV): the fourth-wall
 * fake-out, the leviathan, the lure, the prism, the lens, the delay line, the
 * gravity bar, the growing sun, the dark, and the thing in your HUD.
 *
 *   encore    (wave 11)  fourth wall  — dies, tears the draft, wears your cards
 *   depth     (wave 12)  background   — a leviathan under the floor
 *   angler    (wave 13)  lure         — a bait that only enemies may trip
 *   reflector (wave 14)  reflect      — your build, aimed back at you
 *   inverter  (wave 15)  arena        — a lens that mirrors you
 *   echo      (wave 16)  time         — everything returns 5 s later
 *   horizon   (wave 17)  arena        — a gravity bar; dash is your jump
 *   supernova (wave 18)  scale        — a disc that only grows (phases 1–2)
 *   dimmer    (wave 19)  lighting     — your muzzle flashes are the only light
 *   lurker    (wave 20)  fourth wall  — it hides behind your HUD
 *
 * Every fight follows GAME_PLAN §9: an intro that shows the rule before the
 * boss touches you (rim crack, silhouette slide, eye ignition + camera punch,
 * the framework draws the rim health ring), phases with `minDuration` floors,
 * a `hitTest` that encodes the rule, and a death spectacle.
 *
 * Exported for the Act V agent:
 *   NA.Bosses.shared.supernova   the disc + flare logic of boss 18, reusable
 *   NA.Bosses.shared.persist     [{update(dt), render(), dead}] run-long effects
 *                                (the Depth's translucent floor, the Angler's
 *                                light companion, the Lurker's HUD crack)
 *
 * Fourth-wall helper calls (AGENT_RULES §9) — every one guarded, every one with
 * a local canvas fallback so the fights work without the UI agent's helper:
 *   tearDraft() healDraft() dimPage(a) pageFlash(ms) pageCrack(k)
 *   hudRects() hudDetach(id) hudAttach(id) dropDigit(x,y)
 */
(function () {
  var M = NA.M, C = NA.C, B = NA.Bosses;
  var Ar = NA.Arena, Pl = NA.Player, En = NA.Enemies, Bu = NA.Bullets;
  var COL = C.COL;

  var shared = B.shared || (B.shared = {});

  /* ==================================================== run-long effects ==
   * A tiny persistent-effect list driven by wrapping NA.Bosses.update/render
   * (both are called every frame by NA.Game). No foundation file is edited. */
  var persist = shared.persist || (shared.persist = []);
  if (!shared._wrapped) {
    shared._wrapped = 1;
    var _bUpd = B.update, _bRen = B.render;
    B.update = function (dt) {
      for (var i = 0; i < persist.length; i++) {
        var p = persist[i];
        if (p.update) p.update(dt);
        if (p.dead) { persist.splice(i, 1); i--; }
      }
      _bUpd(dt);
    };
    B.render = function () {
      for (var i = 0; i < persist.length; i++) if (persist[i].render) persist[i].render();
      _bRen();
    };
    if (NA.Game) {
      NA.Game.on('playerDeath', function () { persist.length = 0; });
      NA.Game.on('stateChange', function (s) { if (s === 'title') persist.length = 0; });
    }
    /* NA.Game.newRun() calls NA.Bosses.resetRun(); chain onto it so a restart
     * (which never passes through the title) also drops every run-long effect. */
    var _prevResetRun = B.resetRun;
    B.resetRun = function () {
      persist.length = 0;
      if (_prevResetRun) _prevResetRun.call(B);
    };
  }

  /* ========================================================= fourth wall ==
   * NA.UI.fourthWall is built by the UI agent in parallel; it may be missing,
   * partial, or still using the older placeholder names. Everything here is
   * name-probed and falls back to a local canvas implementation. */
  function fwObj() { return (NA.UI && NA.UI.fourthWall) || null; }
  function fwFn(name) {
    var f = fwObj();
    return (f && typeof f[name] === 'function') ? f[name] : null;
  }
  function fwCall(name, a, b2) {
    var fn = fwFn(name);
    if (!fn) return undefined;
    try { return fn.call(fwObj(), a, b2); } catch (e) { return undefined; }
  }
  /* dimPage(amount01) in the new API, dimPage(on) in the placeholder — a number
   * is truthy for the old one, so one call serves both. */
  function fwDim(amount) { fwCall('dimPage', amount); }
  function fwFlash(ms) {
    if (fwFn('pageFlash')) fwCall('pageFlash', ms);
    else NA.FX.flash(0.5, ms || 300);
  }

  function markSeen(id) {
    var r = NA.Store.records;
    if (!r.seen) r.seen = {};
    if (!r.seen[id]) { r.seen[id] = 1; try { NA.Store.save(); } catch (e) { } }
  }
  /* The Encore's gag must never be a player's first-ever boss. */
  function seenABossBefore(exceptId) {
    var r = NA.Store.records, n = 0;
    if (r.seen) for (var k in r.seen) if (k !== exceptId) n++;
    if (n > 0) return true;
    if ((r.best || 0) >= 1) return true;
    if (NA.Game && NA.Game.wave > 1) return true;
    return !!(NA.params && NA.params.boss);      // an explicit dev jump opts in
  }

  /* ============================================================= helpers == */
  var SOPT = { x: 0, y: 0, pitch: 1 };
  function sfx(name, x, y, pitch) {
    if (!NA.Audio) return;
    if (x === undefined) NA.Audio.sfx(name);
    else { SOPT.x = x; SOPT.y = y; SOPT.pitch = pitch || 1; NA.Audio.sfx(name, SOPT); }
  }

  /* Minions: the enemy roster lands in another agent's file, so every spawn
   * walks a preference list and falls back to whatever exists. */
  function pickType(a, b2, c2) {
    if (En.byId[a] !== undefined) return a;
    if (b2 && En.byId[b2] !== undefined) return b2;
    if (c2 && En.byId[c2] !== undefined) return c2;
    return En.types.length ? En.types[0].id : null;
  }
  function spawnMinion(pref, alt, x, y) {
    var id = pickType(pref, alt, 'mote');
    if (!id) return -1;
    if (En.n >= C.MAX_ENEMIES - 8) return -1;
    return En.spawn(id, x, y);
  }

  /* The shared intro: the membrane dims, a point on the rim cracks white, the
   * boss slides in silhouette-first, the eye ignites with a camera punch. The
   * framework draws the health ring. */
  function introCommon(b, t, drawSil, quiet) {
    var R = NA.R, L = R.L, d = b.data;
    var dur = b.def.introTime || 1.6;
    var k = M.clamp01(t / dur);
    var a = b.angle;
    var rr = Ar.radiusAt(a);
    var rx = Ar.cx + Math.cos(a) * rr, ry = Ar.cy + Math.sin(a) * rr;
    var px = -Math.sin(a), py = Math.cos(a);
    var crack = 150 * M.easeOut(k);
    var ca = (1 - k * 0.35);
    R.line(L.VEIL, rx, ry, rx + px * crack, ry + py * crack, 3.5 * (1 - k) + 1.2, 1, 1, 1, ca);
    R.line(L.VEIL, rx, ry, rx - px * crack, ry - py * crack, 3.5 * (1 - k) + 1.2, 1, 1, 1, ca);
    R.line(L.VEIL, rx, ry, rx - Math.cos(a) * 90 * k, ry - Math.sin(a) * 90 * k, 2, 1, 1, 1, ca * 0.8);

    var e = M.easeOut(k);
    var sx = M.lerp(rx, b.x, e), sy = M.lerp(ry, b.y, e);
    d._introX = sx; d._introY = sy;
    if (drawSil) drawSil(b, sx, sy, k);

    if (!quiet && k > 0.72 && !d._eye) {
      d._eye = 1;
      NA.Cam.addTrauma(0.34);                       // the camera punch
      NA.Cam.setZoom(NA.Cam.zoom * 0.96, 150);
      NA.FX.chroma(2.2, 220);
      sfx('bossIntro');
    }
    if (d._eye) {
      var col = b.def.color;
      var pu = 0.7 + 0.3 * Math.sin(t * 22);
      R.dot(L.ENEMIES, sx, sy, 9 * pu, col[0], col[1], col[2], 1);
      R.light(sx, sy, 320, 0.7);
    }
    return false;
  }

  /* A soft "absorbed" ping so a shot that cannot hurt the boss still reads. */
  function absorbFx(x, y, r, g, b2) {
    if ((NA.Time.frames & 1) === 0)
      NA.Particles.burst(x, y, 2, 90, 0.16, r, g, b2, 0);
  }

  /* Every fight ends tidy: no lingering walls, domes, tint or page filter. */
  function cleanEnd() {
    Ar.clearMirrorWalls();
    fwDim(0);
    NA.FX.darkness(0, 0);
  }

  /* --------------------------------------------------------------- shots --
   * Boss bullets carry boss-side flags in a private bit range so the engine
   * never has to know about them. */
  var FL = {
    ECHO: 1 << 10,          // an echo projectile: the only thing the Echo fears
    ENCORE: 1 << 11,        // an Encore shot wearing a drafted upgrade
    ANTILIGHT: 1 << 12,     // invisible unless lit (Dimmer)
    LENSED: 1 << 13         // already flipped by an Inverter lens
  };
  shared.FLAG = FL;

  /* Owner tags — the engine only cares that owner !== 0 for enemy bullets. */
  var OWN = { ENCORE: 40, DIMMER: 41, REFLECT: 42, LURKER: 43, DEPTH: 44, ANGLER: 45 };
  B.OWN = OWN;                 // 13d's remix duos need the reflected-shot stamp

  var SHOT = { size: 8, color: null, life: 5, owner: 1, homing: 0, bounce: 0, dmg: 1, a: 1 };
  function bossShot(x, y, vx, vy, size, col, opt) {
    SHOT.size = size; SHOT.color = col;
    SHOT.life = (opt && opt.life) || 5;
    SHOT.owner = (opt && opt.owner) || 1;
    SHOT.homing = (opt && opt.homing) || 0;
    SHOT.bounce = (opt && opt.bounce) || 0;
    SHOT.dmg = 1;
    SHOT.a = (opt && opt.a !== undefined) ? opt.a : 1;
    var i = Bu.fireEnemy(x, y, vx, vy, SHOT);
    if (i >= 0 && opt && opt.flags) Bu.E.flags[i] |= opt.flags;
    return i;
  }

  /* A body that orbits the player at a distance — used by several fights so
   * the boss is always reachable but never parked on top of you. */
  function orbitToward(b, dt, dist, speed, spin) {
    var dx = b.x - Pl.x, dy = b.y - Pl.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / d, uy = dy / d;
    var want = (d - dist) * 1.4;
    var tx = -uy * speed + ux * -want;
    var ty = ux * speed + uy * -want;
    b.x += tx * dt * (spin === undefined ? 1 : spin);
    b.y += ty * dt * (spin === undefined ? 1 : spin);
    var dep = Ar.depth(b.x, b.y);
    if (dep < 60) {
      var a = Math.atan2(b.y - Ar.cy, b.x - Ar.cx);
      var rr = Ar.radiusAt(a) - 60;
      b.x = Ar.cx + Math.cos(a) * rr; b.y = Ar.cy + Math.sin(a) * rr;
    }
  }

  /* ================================================================ 11 ====
   * THE ENCORE — the fake-out. A deliberately generic amber hexagon with a
   * deliberately plain intro. When it "dies" the draft screen appears, the
   * cards ignore your clicks, the panel tears in half and the hex crawls out
   * of the tear wearing the three upgrades you never got to take. Phase 3 it
   * drags your HUD arcs in as orbiting shields. Killing it for real heals the
   * UI and gives the draft back with a fourth bonus card.
   *
   * Fourth-wall calls: tearDraft(), healDraft(), hudDetach('hp'|'mana'),
   * hudAttach(...). All guarded; all with a canvas fallback below. */

  var ENC_COL = [1, 0.72, 0.22];

  /* Draft ids -> what the Encore's shots do. Tier-1 effects only. */
  function encoreApply(d, id) {
    switch (id) {
      case 'ricochet': d.bounce = 2; d.tagB = 1; break;                 // bounce off walls
      case 'blast': d.blast = 1; d.tagB = 1; break;                     // shots burst on expiry
      case 'seeker': d.homing = 0.55; d.tagB = 1; break;                // gentle homing
      case 'twinBarrels': d.twin = 1; break;                            // a parallel pair
      case 'buckshot': d.pellets = 5; break;                            // a cone
      case 'gatling': d.rate = 1.7; break;
      case 'railgun': d.heavy = 1; break;
      case 'mortar': d.mortar = 1; break;
      case 'drill': d.drill = 1; break;
      case 'voltaic': d.arc = 1; break;
      case 'overdrive': d.rate = 1.45; d.tint = 1; break;
      case 'chrono': d.slowShots = 1; break;
      case 'mines': d.mortar = 1; break;
      case 'gravityWell': d.pull = 1; break;
      default: d.homing = Math.max(d.homing, 0.22); break;              // anything else: it aims better
    }
  }

  function encoreOffers(b) {
    var d = b.data;
    if (d.offers) return d.offers;
    var got = null;
    var f = fwObj();
    if (f && f.offers && f.offers.length) got = f.offers;               // the helper's fake cards
    else if (NA.Draft && NA.Draft.offers && NA.Draft.offers.length && NA.Draft.active) got = NA.Draft.offers;
    if (!got && NA.Upgrades && NA.Upgrades.list.length) got = NA.Upgrades.offer(3, NA.RNG);
    if (!got || !got.length) got = ['ricochet', 'blast', 'seeker'];     // the three the plan promises
    d.offers = got.slice(0, 3);
    return d.offers;
  }

  function encoreWearCards(b) {
    var d = b.data, o = encoreOffers(b);
    d.rate = 1; d.homing = 0; d.bounce = 0; d.blast = 0;
    d.twin = 0; d.pellets = 0; d.heavy = 0; d.mortar = 0; d.drill = 0;
    d.arc = 0; d.pull = 0; d.slowShots = 0; d.tint = 0; d.shellK = -1;
    for (var i = 0; i < o.length; i++) encoreApply(d, o[i]);
    d.worn = 1;
  }

  /* --------------------------------------------- the local fallback panel */
  function encoreFakeDraft(b, k, tear) {
    var R = NA.R;
    var w = Math.min(190, R.w / 5), h = w * 1.25;
    var cy = R.h * 0.40;
    R.sdisc(R.w * 0.5, R.h * 0.5, Math.max(R.w, R.h), 0.02, 0.024, 0.04, 0.55 * k);
    for (var i = 0; i < 3; i++) {
      var off = (i - 1) * w * 1.25;
      var cx = R.w * 0.5 + off;
      // the two halves drift apart once the panel tears
      var shift = tear > 0 ? (off < 0 ? -1 : 1) * tear * R.w * 0.35 : 0;
      var rot = tear > 0 ? (off < 0 ? -1 : 1) * tear * 0.25 : 0;
      var a = k * (1 - tear * 0.5);
      R.spoly(cx + shift, cy + tear * 40, w * 0.5, 6, rot, 2, 0.30, 0.95, 1.0, 0.7 * a);
      R.sdisc(cx + shift, cy + tear * 40, w * 0.46, 0.05, 0.09, 0.12, 0.9 * a);
      for (var t = 0; t < 3; t++)
        R.sdisc(cx + shift + (t - 1) * 18, cy + h * 0.30 + tear * 40, 5, 0.30, 0.95, 1.0, 0.5 * a);
    }
    if (tear > 0) {
      // a jagged white split down the middle of the page
      var x0 = R.w * 0.5, seg = 12;
      for (var s = 0; s < seg; s++) {
        var y0 = R.h * (s / seg), y1 = R.h * ((s + 1) / seg);
        var j0 = Math.sin(s * 2.7) * 26 * tear, j1 = Math.sin((s + 1) * 2.7) * 26 * tear;
        R.sline(x0 + j0, y0, x0 + j1, y1, 3 + 5 * tear, 1, 1, 1, 0.9);
      }
    }
  }

  B.define('encore', {
    name: 'Encore', color: ENC_COL, hp: 560,
    introTime: 1.0,                 // deliberately plain: no eye, no punch
    camZoom: 0.9,

    intro: function (b, t) {
      markSeen('encore');
      // the joke needs a boring entrance, so the eye ignition is held back for
      // the moment it crawls out of the torn panel
      return introCommon(b, t, function (bb, x, y, k) {
        NA.R.poly(NA.R.L.ENEMIES, x, y, 44 * (0.4 + 0.6 * k), 6, NA.Time.t * 0.5, 3,
          ENC_COL[0] * 0.7, ENC_COL[1] * 0.7, ENC_COL[2] * 0.7, 0.35 + 0.5 * k);
      }, true);
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.radius = 46; d.shotT = 0; d.rate = 1; d.hidden = 0;
        d.gagT = 0; d.tear = 0; d.panel = 0; d.torn = 0;
        d.shields = 0; d.blastN = 0;
        b.x = Ar.cx; b.y = Ar.cy - 180;
        d.gagOk = seenABossBefore('encore') ? 1 : 0;
      }
      if (i === 1) {
        // "death": it shatters, and the draft screen comes up
        d.hidden = 1; d.gagT = 0; d.tear = 0; d.torn = 0;
        NA.Particles.shatter(b.x, b.y, 60, 6, ENC_COL[0], ENC_COL[1], ENC_COL[2], 320);
        NA.Particles.ring(b.x, b.y, 20, 260, 0.5, 4, ENC_COL[0], ENC_COL[1], ENC_COL[2], 1);
        NA.FX.trauma(0.5); NA.Time.slowmo(0.35, 700);
        sfx('bossDeath');
        encoreOffers(b);
      }
      if (i === 2) {
        // it drags the player's HUD arcs in as physical shields
        d.shields = 1; d.shieldA = 0;
        fwCall('hudDetach', 'hp');
        fwCall('hudDetach', 'mana');
        sfx('bossPhase');
      }
    },

    /* Body, and in phase 3 the stolen HUD arcs, which absorb. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      if (d.hidden) return 0;                        // it is "dead"; nothing to hit
      if (d.shields) {
        var dx = x - b.x, dy = y - b.y;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd > 78 && dd < 112) {
          var ang = Math.atan2(dy, dx);
          for (var s = 0; s < 2; s++) {
            var c0 = d.shieldA + s * Math.PI;
            if (Math.abs(M.norm(ang - c0)) < 0.62) {
              NA.Particles.burst(x, y, 3, 150, 0.2, 0.3, 0.95, 1, 1);
              sfx('wall', x, y);
              return 2;                              // your own HP/mana arc blocks you
            }
          }
        }
      }
      var ddx = b.x - x, ddy = b.y - y, rr = d.radius + r;
      return (ddx * ddx + ddy * ddy < rr * rr) ? 1 : 0;
    },

    phases: [
      { /* 1 — a completely unremarkable amber hexagon */
        minDuration: 11,
        update: function (b, dt) { encoreFight(b, dt, 0); }
      },
      { /* 2 — the tear, then it fights wearing your three cards */
        minDuration: 13,
        update: function (b, dt) {
          var d = b.data;
          d.gagT += dt;
          if (!d.gagOk) {
            // never a player's first-ever boss: with nothing to subvert yet it
            // simply gets back up, keeps the three cards, and fights on
            if (!d.torn && d.gagT > 1.1) d.torn = 1;
          } else {
            if (!d.panel && d.gagT > 0.7) {
              d.panel = 1;
              var res = fwCall('tearDraft');           // the helper, if it exists
              d.usedHelper = fwFn('tearDraft') ? 1 : 0;
              if (res && typeof res.then === 'function') res.then(function () { b.data.torn = 1; });
              sfx('draftHover');
            }
            if (d.panel && !d.torn) {
              // ~2 s of cards that ignore every click, then the tear
              var since = d.gagT - 0.7;
              if (since > 2.0) d.tear = M.clamp01(d.tear + dt * 1.6);
              if (d.tear >= 1) d.torn = 1;
              if (since > 0.4 && NA.Input.pressed('fire')) {
                NA.FX.chroma(1.6, 120);                // the click does nothing but rattle
                sfx('manaDry');
              }
            }
          }
          /* `d.dead`: onDeath sets hidden=1 again, so without this the phase
           * re-runs its entry beat during `dying` and re-creates the 14 page
           * crack divs that onDeath's pageCrack(0) had just removed. */
          if (d.torn && d.hidden && !d.dead) {
            // it crawls out of the tear — this is the real intro beat
            d.hidden = 0;
            b.x = Ar.cx; b.y = Ar.cy;
            encoreWearCards(b);
            NA.Cam.addTrauma(0.6);
            NA.Cam.setZoom(NA.Cam.zoom * 0.94, 200);
            NA.FX.chroma(3, 400); NA.FX.flash(0.3, 160);
            NA.Particles.ring(b.x, b.y, 10, 320, 0.6, 5, 1, 1, 1, 1);
            if (d.gagOk) fwCall('pageCrack', 0.6);
            sfx('bossPhase');
          }
          if (!d.hidden) encoreFight(b, dt, 1);
        },
        render: function (b) {
          var d = b.data;
          if (d.panel && !d.usedHelper && d.hidden) encoreFakeDraft(b, 1, d.tear);
        }
      },
      { /* 3 — your own HUD, orbiting it */
        minDuration: 13,
        update: function (b, dt) {
          var d = b.data;
          d.shieldA += dt * 1.15;
          encoreFight(b, dt, 2);
        }
      }
    ],

    update: function (b, dt) {
      var d = b.data;
      // Mortar: a lobbed shell with a 1.2 s telegraph circle before it lands
      if (d.mortar && d.shellK >= 0) {
        d.shellK += dt;
        En.telegraphCircle(d.shellX, d.shellY, 110, d.shellK, 1.2, 0.8);
        if (d.shellK >= 1.2) { d.shellK = -1; Bu.explode(d.shellX, d.shellY, 110, 1, 1); }
      }
      // Blast: an Encore shot bursts into a visible ring of fragments at the
      // end of its flight (the parent shot is its own telegraph).
      if (!d.blast || d.blastN <= 0) return;
      var E = Bu.E;
      for (var i = 0; i < E.n; i++) {
        if (E.owner[i] !== OWN.ENCORE || E.life[i] > 0.07) continue;
        E.owner[i] = 1; E.life[i] = 0.0001;
        d.blastN--;
        NA.Particles.ring(E.x[i], E.y[i], 6, 70, 0.28, 3, 1, 0.541, 0, 1);
        for (var k = 0; k < 5; k++) {
          var a = k / 5 * M.TAU + NA.Time.t;
          bossShot(E.x[i], E.y[i], Math.cos(a) * 210, Math.sin(a) * 210, 6, ENC_COL, SHOTOPT_FRAG);
        }
        sfx('explode', E.x[i], E.y[i]);
      }
    },

    onDeath: function (b) {
      var d = b.data;
      d.shields = 0; d.hidden = 1; d.dead = 1;
      fwCall('hudAttach', 'hp');
      fwCall('hudAttach', 'mana');
      var healed = fwFn('healDraft') ? 1 : 0;
      fwCall('healDraft');                 // the helper also queues one bonus card
      fwCall('pageCrack', 0);
      NA.Particles.ring(b.x, b.y, 20, 520, 0.9, 7, ENC_COL[0], ENC_COL[1], ENC_COL[2], 1);
      NA.Particles.shatter(b.x, b.y, 70, 6, ENC_COL[0], ENC_COL[1], ENC_COL[2], 420);
      // the UI heals and the draft works again — with a fourth bonus card.
      // (Skipped under ?norender=1, where nothing would drive it.)
      if (NA.Draft && !NA.Draft.active && !(NA.params && NA.params.norender) &&
        NA.Draft.open(healed ? 3 : 4)) {   // 3 + the helper's bonus card = four
        d.bonusDraft = 1; d._draftStart = NA.Time.real;
      }
    },
    onEnd: function (b) {
      if (NA.Draft && NA.Draft.active && b.data.bonusDraft) NA.Draft.close();
      fwCall('hudAttach', 'hp'); fwCall('hudAttach', 'mana');
      cleanEnd();
    },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      /* The bonus draft is a real 'draft' game state now (15_ui drives update
       * and render from UI.tick); all this block does is hold the boss in
       * 'dying' until the card has been taken, and make sure it always is. */
      if (d.bonusDraft) {
        if (NA.Draft.active) {
          var now = NA.Time.real;
          b.t = 0;                                   // hold 'dying' until it closes
          /* Never stall the run.  The card times out on the wall clock, and on
           * autopilot (which drives the draft only from Game.state === 'draft',
           * so it never sees this one) it is taken at once -- otherwise the
           * boss sat in 'dying' for a minute and a half of sim time. */
          var held = now - (d._draftStart || now);
          if (NA.Bot && NA.Bot.on && held > 0.35) {
            if (NA.Draft.offers && NA.Draft.offers.length) NA.Draft.pick(0);
            else NA.Draft.close();
          } else if (held > 25) NA.Draft.close();
        } else d.bonusDraft = 0;
      }
      if (d.hidden) return;
      var f = b.flash > 0 ? 1 : 0;
      var cr = f ? 1 : ENC_COL[0], cg = f ? 1 : ENC_COL[1], cb = f ? 1 : ENC_COL[2];
      R.poly(L.ENEMIES, b.x, b.y, d.radius, 6, NA.Time.t * 0.5, 4, cr, cg, cb, 0.95);
      R.poly(L.ENEMIES, b.x, b.y, d.radius * 0.62, 6, -NA.Time.t * 0.8, 2.4, cr, cg * 0.85, cb * 0.4, 0.8);
      R.dot(L.ENEMIES, b.x, b.y, 9, 1, 1, 1, 0.9);
      R.light(b.x, b.y, 260, 0.45);

      // the three cards it is wearing, as pips on its shell
      if (d.worn) {
        for (var i = 0; i < 3; i++) {
          var a = NA.Time.t * 0.9 + i / 3 * M.TAU;
          var px = b.x + Math.cos(a) * (d.radius + 22), py = b.y + Math.sin(a) * (d.radius + 22);
          R.poly(L.ENEMIES, px, py, 8, 4, a * 2, 2, 1, 1, 1, 0.85);
        }
      }
      // your HP and mana arcs, orbiting it
      if (d.shields) {
        for (var s = 0; s < 2; s++) {
          var c0 = d.shieldA + s * Math.PI;
          var col = s === 0 ? COL.red : COL.player;
          R.arc(L.ENEMIES, b.x, b.y, 95, c0 - 0.6, c0 + 0.6, 6, col[0], col[1], col[2], 0.9);
          R.arc(L.ENEMIES, b.x, b.y, 95, c0 - 0.6, c0 + 0.6, 2, 1, 1, 1, 0.45);
        }
      }
    }
  });

  var SHOTOPT = { life: 5, owner: 1, homing: 0, bounce: 0, flags: 0, a: 1 };
  var SHOTOPT_FRAG = { life: 2.2, owner: 1, homing: 0, bounce: 0, flags: 0, a: 1 };

  /* The fight itself. mode 0 = generic, 1 = wearing the cards, 2 = plus HUD. */
  function encoreFight(b, dt, mode) {
    var d = b.data;
    orbitToward(b, dt, 380, 150 + mode * 40);
    d.shotT -= dt * (d.rate || 1);
    if (d.shotT > 0) return;
    d.shotT = mode === 0 ? 1.15 : 0.95;

    var ang = Math.atan2(Pl.y - b.y, Pl.x - b.x);
    var sp = d.heavy ? 620 : 330;
    SHOTOPT.life = 5; SHOTOPT.owner = 1; SHOTOPT.homing = 0; SHOTOPT.bounce = 0;
    SHOTOPT.flags = 0; SHOTOPT.a = 1;

    if (mode === 0) {
      // a plain six-bullet ring, the most generic attack in the game
      for (var i = 0; i < 6; i++) {
        var a = i / 6 * M.TAU + b.t * 0.4;
        bossShot(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40,
          Math.cos(a) * 300, Math.sin(a) * 300, 8, ENC_COL, SHOTOPT);
      }
      sfx('shot', b.x, b.y, 0.7);
      return;
    }

    SHOTOPT.homing = d.homing || 0;
    SHOTOPT.bounce = d.bounce || 0;
    SHOTOPT.life = d.bounce ? 6 : 5;
    if (d.blast) { SHOTOPT.owner = OWN.ENCORE; SHOTOPT.flags = FL.ENCORE; SHOTOPT.life = 1.5; }

    var shots = d.pellets ? d.pellets : (d.twin ? 2 : 1);
    var spread = d.pellets ? 0.42 : (d.twin ? 0.10 : 0);
    for (var s = 0; s < shots; s++) {
      var off = shots > 1 ? (s - (shots - 1) / 2) * spread : 0;
      var aa = ang + off;
      var sz = d.heavy ? 13 : (d.pellets ? 6 : 9);
      var bi = bossShot(b.x + Math.cos(aa) * (d.radius + 8), b.y + Math.sin(aa) * (d.radius + 8),
        Math.cos(aa) * sp, Math.sin(aa) * sp, sz, ENC_COL, SHOTOPT);
      if (bi >= 0 && d.blast) d.blastN++;
      if (d.arc && bi >= 0 && (NA.Time.frames & 3) === 0)
        NA.Particles.bolt(b.x, b.y, Bu.E.x[bi], Bu.E.y[bi], 0.14, 8, 0.6, 0.9, 1, 1.4);
    }
    // Mortar: a lobbed shell with a proper 1.2 s telegraph circle
    if (d.mortar && d.shellK < 0 && (d.shellT === undefined || b.t - d.shellT > 3)) {
      d.shellT = b.t;
      d.shellX = Pl.x + Pl.vx * 0.4; d.shellY = Pl.y + Pl.vy * 0.4; d.shellK = 0;
    }
    sfx('shot', b.x, b.y, d.heavy ? 0.5 : 0.9);
  }

  /* ================================================================ 12 ====
   * THE DEPTH — the Act II boss. It lives in the parallax backdrop as a huge
   * blurred leviathan. It breaches through the floor as fins (temporary
   * walls), bites with a jaw ring you have to be OUTSIDE of, and finally
   * surfaces so the whole arena tilts on its back: a global gravity vector for
   * eight seconds. It sinks forever and the floor stays translucent. */

  var DEP_COL = [0.32, 0.55, 0.95];

  function distToSeg2(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = x1 + dx * t - px, qy = y1 + dy * t - py;
    return qx * qx + qy * qy;
  }

  /* The silhouette, drawn either far away in the backdrop or up close. */
  function leviathan(layer, x, y, ang, len, alpha, blur) {
    var R = NA.R;
    var cs = Math.cos(ang), sn = Math.sin(ang);
    var seg = 9;
    for (var i = 0; i < seg; i++) {
      var f = i / (seg - 1);
      var w = Math.sin(f * Math.PI) * len * 0.13 + len * 0.02;
      var sx = x + cs * (f - 0.5) * len + Math.cos(ang + M.HALFPI) * Math.sin(f * 6 + NA.Time.t * 0.9) * len * 0.05;
      var sy = y + sn * (f - 0.5) * len + Math.sin(ang + M.HALFPI) * Math.sin(f * 6 + NA.Time.t * 0.9) * len * 0.05;
      R.disc(layer, sx, sy, w * (blur ? 1.5 : 1), DEP_COL[0], DEP_COL[1], DEP_COL[2], alpha);
    }
    // tail fluke and one cold eye
    var tx = x - cs * len * 0.55, ty = y - sn * len * 0.55;
    R.line(layer, tx, ty, tx - cs * len * 0.16 + Math.cos(ang + 1.1) * len * 0.12,
      ty - sn * len * 0.16 + Math.sin(ang + 1.1) * len * 0.12, len * 0.03, DEP_COL[0], DEP_COL[1], DEP_COL[2], alpha);
    R.line(layer, tx, ty, tx - cs * len * 0.16 + Math.cos(ang - 1.1) * len * 0.12,
      ty - sn * len * 0.16 + Math.sin(ang - 1.1) * len * 0.12, len * 0.03, DEP_COL[0], DEP_COL[1], DEP_COL[2], alpha);
    var ex = x + cs * len * 0.36, ey = y + sn * len * 0.36;
    R.dot(layer, ex, ey, len * 0.018, 1, 0.9, 0.7, alpha * 2.2);
  }

  B.define('depth', {
    name: 'Depth', color: DEP_COL, hp: 820,
    introTime: 2.2, camZoom: 0.62,

    intro: function (b, t) {
      markSeen('depth');
      var d = b.data;
      d.bx = Ar.cx; d.by = Ar.cy; d.bang = b.angle;
      // the shape passing far below, in the backdrop layer
      leviathan(NA.R.L.BACKDROP, Ar.cx - 200, Ar.cy + 120, b.angle, 1500, 0.10 + 0.06 * M.clamp01(t / 2.2), true);
      return introCommon(b, t, function (bb, x, y, k) {
        NA.R.disc(NA.R.L.FLOOR, x, y, 120 * k, DEP_COL[0], DEP_COL[1], DEP_COL[2], 0.10);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.bx = Ar.cx; d.by = Ar.cy; d.bang = b.angle;
        d.breachT = 1.6; d.br = -1; d.brT = 0;
        d.finIds = d.finIds || [];
        d.expose = 0; d.exposeX = 0; d.exposeY = 0;
        d.biteT = -1; d.biteX = 0; d.biteY = 0; d.biteR = 300;
        d.surf = 0; d.gx = 0; d.gy = 0; d.gT = 0;
        d.radius = 70; d.sink = 0;
      }
      if (i === 1) { d.biteT = 2.0; sfx('charge'); }
      if (i === 2) {
        d.surf = 1; d.gT = 8; d.gAng = NA.RNG.f() * M.TAU;
        b.x = Ar.cx; b.y = Ar.cy; d.radius = 170;
        NA.FX.trauma(0.8); NA.Time.slowmo(0.4, 900);
        Ar.ripple(Ar.cx, Ar.cy, 3, DEP_COL[0], DEP_COL[1], DEP_COL[2]);
        sfx('bossPhase');
      }
    },

    /* Below the floor it is untouchable. It can only be hurt at a breach — the
     * dorsal fin while a fin set is up, the open jaw during a bite, and the
     * whole body once it has surfaced. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      if (d.surf) {
        var dx = b.x - x, dy = b.y - y, rr = d.radius + r;
        return (dx * dx + dy * dy < rr * rr) ? 1 : 0;
      }
      if (d.expose > 0) {
        var ex = d.exposeX - x, ey = d.exposeY - y;
        if (ex * ex + ey * ey < (62 + r) * (62 + r)) return 1;
      }
      /* Only the shots that actually reach the shape below slap the water.
       * (This used to absorb every player bullet in the arena, every frame.) */
      var bx = d.bx - x, by = d.by - y, br = (d.radius || 70) + r;
      if (bx * bx + by * by > br * br) return 0;
      absorbFx(x, y, DEP_COL[0], DEP_COL[1], DEP_COL[2]);
      return 2;                         // the shot slaps the water and stops
    },

    phases: [
      { /* 1 — telegraphed breaches: fins through the floor, remoras behind */
        minDuration: 13,
        update: function (b, dt) { depthTick(b, dt, 0); }
      },
      { /* 2 — the jaw bite ring: be outside of it */
        minDuration: 14,
        update: function (b, dt) { depthTick(b, dt, 1); }
      },
      { /* 3 — it surfaces and the arena tilts on its back */
        minDuration: 15,
        update: function (b, dt) { depthTick(b, dt, 2); }
      }
    ],

    onDeath: function (b) {
      var d = b.data;
      d.sink = 1;
      for (var i = 0; i < d.finIds.length; i++) Ar.removeMirrorWall(d.finIds[i]);
      d.finIds.length = 0;
      NA.Particles.ring(b.x, b.y, 40, 900, 1.2, 8, DEP_COL[0], DEP_COL[1], DEP_COL[2], 1);
      NA.FX.trauma(0.9);
      Ar.ripple(Ar.cx, Ar.cy, 3.5, DEP_COL[0], DEP_COL[1], DEP_COL[2]);
      // it sinks forever, and the floor stays translucent for the rest of the run
      var sinkT = 0, bx = b.x, by = b.y, bang = d.bang;
      persist.push({
        update: function (dt) { sinkT += dt; },
        render: function () {
          var R = NA.R;
          var k = Math.min(1, sinkT / 6);
          R.disc(R.L.FLOOR, Ar.cx, Ar.cy, Ar.radius * 0.98, DEP_COL[0], DEP_COL[1], DEP_COL[2], 0.05);
          R.ring(R.L.FLOOR, Ar.cx, Ar.cy, Ar.radius * 0.7, 2, DEP_COL[0], DEP_COL[1], DEP_COL[2], 0.10);
          if (k < 1) leviathan(R.L.BACKDROP, bx, by + k * 400, bang, 900 * (1 - k * 0.5), 0.16 * (1 - k), true);
          else leviathan(R.L.BACKDROP, Ar.cx + Math.cos(NA.Time.t * 0.05) * 700,
            Ar.cy + Math.sin(NA.Time.t * 0.04) * 500, NA.Time.t * 0.05, 1400, 0.05, true);
        }
      });
    },
    onEnd: function (b) {
      var d = b.data;
      if (d.finIds) for (var i = 0; i < d.finIds.length; i++) Ar.removeMirrorWall(d.finIds[i]);
      cleanEnd();
    },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      // the blurred shape in the parallax backdrop, always
      if (!d.surf) leviathan(L.BACKDROP, d.bx, d.by, d.bang, 1500, 0.13, true);
      // fins standing in the floor
      if (d.finN) {
        for (var i = 0; i < d.finN; i++) {
          var o = i * 4;
          R.line(L.ENEMIES, d.fin[o], d.fin[o + 1], d.fin[o + 2], d.fin[o + 3], 14,
            DEP_COL[0] * 0.8, DEP_COL[1] * 0.8, DEP_COL[2] * 0.9, 0.95);
          R.line(L.ENEMIES, d.fin[o], d.fin[o + 1], d.fin[o + 2], d.fin[o + 3], 4, 1, 1, 1, 0.35);
        }
      }
      // the exposed dorsal fin: the only thing worth shooting down here
      if (d.expose > 0) {
        var pu = 0.6 + 0.4 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
        R.poly(L.ENEMIES, d.exposeX, d.exposeY, 54, 3, NA.Time.t * 0.8, 5,
          COL.gold[0], COL.gold[1], COL.gold[2], 0.8 * pu + 0.2);
        R.dot(L.ENEMIES, d.exposeX, d.exposeY, 12, 1, 1, 1, 0.9);
        R.light(d.exposeX, d.exposeY, 260, 0.6);
      }
      // the jaw ring closing
      if (d.biteK > 0) {
        var k = M.clamp01(d.biteK / 1.3);
        var col = k > 0.75 ? COL.red : COL.orange;
        R.ring(L.VEIL, d.biteX, d.biteY, d.biteR * (1 - k * 0.12), 5 + 4 * k, col[0], col[1], col[2],
          0.5 + 0.45 * Math.abs(Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ)));
        for (var t = 0; t < 12; t++) {                      // teeth
          var a = t / 12 * M.TAU + NA.Time.t * 0.3;
          var rr = d.biteR * (1 - k * 0.12);
          R.line(L.VEIL, d.biteX + Math.cos(a) * rr, d.biteY + Math.sin(a) * rr,
            d.biteX + Math.cos(a) * (rr - 26 - 20 * k), d.biteY + Math.sin(a) * (rr - 26 - 20 * k),
            4, 1, 1, 1, 0.75);
        }
      }
      // surfaced: the body is in the arena and the floor is tilted
      if (d.surf) {
        leviathan(L.ENEMIES, b.x, b.y, d.bang, 620, 0.55, false);
        R.poly(L.ENEMIES, b.x, b.y, d.radius, 6, d.bang, 5, DEP_COL[0], DEP_COL[1], DEP_COL[2], 0.9);
        R.dot(L.ENEMIES, b.x + Math.cos(d.bang) * 90, b.y + Math.sin(d.bang) * 90, 14, 1, 0.9, 0.6, 1);
        R.light(b.x, b.y, 420, 0.5);
        if (d.gT > 0) {
          // the tilt, drawn as a slope arrow field on the floor
          for (var g = 0; g < 10; g++) {
            var ga = g / 10 * M.TAU;
            var gx = Ar.cx + Math.cos(ga) * Ar.radius * 0.55, gy = Ar.cy + Math.sin(ga) * Ar.radius * 0.55;
            R.line(L.FLOOR, gx, gy, gx + d.gx * 0.12, gy + d.gy * 0.12, 2,
              DEP_COL[0], DEP_COL[1], DEP_COL[2], 0.35);
          }
        }
      }
    }
  });

  function depthTick(b, dt, mode) {
    var d = b.data;
    if (!d.fin) { d.fin = new Float32Array(16); d.finN = 0; d.finLife = 0; }

    // the shape below, circling
    if (!d.surf) {
      d.bang += dt * 0.16;
      d.bx = Ar.cx + Math.cos(d.bang * 0.7) * 380;
      d.by = Ar.cy + Math.sin(d.bang * 0.5) * 300;
      R_light(d.bx, d.by, 300, 0.12);
    }

    /* ---- breaches: telegraph, then fins ---- */
    d.breachT -= dt;
    if (d.br < 0 && d.breachT <= 0) {
      d.br = 1; d.brT = 0;
      var a = Math.atan2(Pl.y - Ar.cy, Pl.x - Ar.cx) + NA.RNG.range(-0.7, 0.7);
      var rr = Ar.radius * 0.95;
      d.bx1 = Ar.cx + Math.cos(a) * rr; d.by1 = Ar.cy + Math.sin(a) * rr;
      d.bx2 = Ar.cx - Math.cos(a) * rr; d.by2 = Ar.cy - Math.sin(a) * rr;
    }
    if (d.br > 0) {
      d.brT += dt;
      En.telegraphLine(d.bx1, d.by1, d.bx2, d.by2, d.brT, 1.1, 0.7, 5);
      if (d.brT >= 1.1) {
        d.br = -1;
        d.breachT = mode === 0 ? 3.4 : 4.6;
        depthBreach(b);
      }
    }
    // fins live for a while, then slide back under
    if (d.finN) {
      d.finLife -= dt;
      if (d.finLife <= 0) {
        for (var q = 0; q < d.finIds.length; q++) Ar.removeMirrorWall(d.finIds[q]);
        d.finIds.length = 0; d.finN = 0; d.expose = 0;
      }
    }
    if (d.expose > 0) d.expose -= dt;

    /* The body the arena tracks (off-screen marker, hitTest, the bot's aim) is
     * whatever is actually shootable: the open weak point while one is up, the
     * circling shape below otherwise.  And a weak point always comes: if none
     * has been open for DEP_DRY seconds the next breach is pulled forward, so
     * the fight can never be gated on nothing. */
    if (!d.surf) {
      if (d.expose > 0) { b.x = d.exposeX; b.y = d.exposeY; d.dryT = 0; }
      else {
        b.x = d.bx; b.y = d.by;
        d.dryT = (d.dryT || 0) + dt;
        if (d.dryT >= DEP_DRY) {
          d.dryT = 0;
          if (d.br < 0 && d.breachT > 0.3) d.breachT = 0.3;
        }
      }
    } else d.dryT = 0;

    /* ---- the jaw bite ---- */
    if (mode >= 1) {
      if (d.biteK > 0) {
        d.biteK += dt;
        if (d.biteK >= 1.3) {
          d.biteK = 0;
          d.biteT = mode === 2 ? 6 : 4.2;
          depthBite(b);
        }
      } else {
        d.biteT -= dt;
        if (d.biteT <= 0) {
          d.biteK = 0.0001;
          d.biteX = Pl.x + Pl.vx * 0.35; d.biteY = Pl.y + Pl.vy * 0.35;
          d.biteR = 300;
          // keep the ring inside the arena so "outside" is always reachable
          var dd = M.dist(d.biteX, d.biteY, Ar.cx, Ar.cy);
          if (dd > Ar.radius - 120) {
            var ba = Math.atan2(d.biteY - Ar.cy, d.biteX - Ar.cx);
            d.biteX = Ar.cx + Math.cos(ba) * (Ar.radius - 120);
            d.biteY = Ar.cy + Math.sin(ba) * (Ar.radius - 120);
          }
          sfx('charge', d.biteX, d.biteY);
        }
      }
    }

    /* ---- surfaced: the global gravity vector ---- */
    if (d.surf) {
      d.bang += dt * 0.25;
      b.x = M.smooth(b.x, Ar.cx + Math.cos(d.bang) * 120, 1.2, dt);
      b.y = M.smooth(b.y, Ar.cy + Math.sin(d.bang) * 120, 1.2, dt);
      if (d.gT > 0) {
        d.gT -= dt;
        d.gAng += dt * 0.22;
        var g = 620;
        d.gx = Math.cos(d.gAng) * g; d.gy = Math.sin(d.gAng) * g;
        if (Pl.alive && Pl.dashT <= 0) { Pl.vx += d.gx * dt; Pl.vy += d.gy * dt; }
        for (var e = 0; e < En.n; e++) { En.vx[e] += d.gx * dt * 0.5; En.vy[e] += d.gy * dt * 0.5; }
        var E = Bu.E;
        for (var k2 = 0; k2 < E.n; k2++) { E.vx[k2] += d.gx * dt * 0.25; E.vy[k2] += d.gy * dt * 0.25; }
      } else if (d.gT > -3) {
        d.gT = 8;                                  // it heaves again
        NA.FX.trauma(0.4);
      }
      // and it still breaches, from under itself
      if (d.finN === 0 && d.br < 0 && d.breachT > 2.2) d.breachT = 2.2;
    }
  }

  /* A breach: fins rise along the telegraphed chord as temporary walls, the
   * line itself hurts on the frame it opens, and remoras come up with it. */
  function depthBreach(b) {
    var d = b.data;
    for (var q = 0; q < d.finIds.length; q++) Ar.removeMirrorWall(d.finIds[q]);
    d.finIds.length = 0;
    d.finN = 0; d.finLife = 5.5;
    var dx = d.bx2 - d.bx1, dy = d.by2 - d.by1;
    var mx = 0, my = 0;
    for (var i = 0; i < 4; i++) {
      var f0 = 0.10 + i * 0.22, f1 = f0 + 0.13;
      var x1 = d.bx1 + dx * f0, y1 = d.by1 + dy * f0;
      var x2 = d.bx1 + dx * f1, y2 = d.by1 + dy * f1;
      var o = d.finN * 4;
      d.fin[o] = x1; d.fin[o + 1] = y1; d.fin[o + 2] = x2; d.fin[o + 3] = y2;
      d.finN++;
      d.finIds.push(Ar.addMirrorWall(x1, y1, x2, y2, 5.5));
      NA.Particles.ring((x1 + x2) * 0.5, (y1 + y2) * 0.5, 8, 120, 0.4, 3,
        DEP_COL[0], DEP_COL[1], DEP_COL[2], 0.9);
      if (i === 1) { mx = (x1 + x2) * 0.5; my = (y1 + y2) * 0.5; }
      // remoras ride up out of the breach
      if (i % 2 === 0) spawnMinion('larva', 'moteling', x1, y1);
    }
    d.expose = 4.4; d.exposeX = mx; d.exposeY = my;
    // the water that opens under you hurts, once, on the frame it opens
    if (Pl.alive && distToSeg2(Pl.x, Pl.y, d.bx1, d.by1, d.bx2, d.by2) < 46 * 46)
      Pl.damage(1, Pl.x, Pl.y);
    NA.FX.trauma(0.45);
    Ar.ripple(mx, my, 1.6, DEP_COL[0], DEP_COL[1], DEP_COL[2]);
    sfx('explode', mx, my, 0.6);
  }

  /* The bite: everything inside the ring is inside the mouth. */
  function depthBite(b) {
    var d = b.data;
    var r2 = d.biteR * d.biteR;
    if (Pl.alive && M.dist2(Pl.x, Pl.y, d.biteX, d.biteY) < r2) Pl.damage(1, d.biteX, d.biteY);
    for (var e = 0; e < En.n; e++) {
      if (M.dist2(En.x[e], En.y[e], d.biteX, d.biteY) < r2) { En.kill(e, false); e--; }
    }
    NA.Particles.ring(d.biteX, d.biteY, d.biteR, 20, 0.35, 8, 1, 1, 1, 1);
    NA.FX.trauma(0.6); NA.FX.chroma(2, 220);
    d.expose = 1.4; d.exposeX = d.biteX; d.exposeY = d.biteY;   // the open jaw is soft
    sfx('explode', d.biteX, d.biteY, 0.5);
  }

  function R_light(x, y, r, i) { NA.R.light(x, y, r, i); }

  /* ================================================================ 13 ====
   * THE ANGLER — a hidden, invulnerable mass and a bait light that looks
   * exactly like a pickup. Enemies are drawn to the bait; when one touches it
   * the Angler surfaces, mouth open, vulnerable for two seconds. When YOU
   * touch it, it bites. Phase 2 puts out three baits, only one of them real —
   * the real one pulses off the shared telegraph tempo. Phase 3 hooks you with
   * a tether. Its light detaches on death and follows you for the run. */

  var ANG_COL = [0.16, 0.52, 0.46];
  var BAIT_COL = COL.gold;
  var MAXBAIT = 3;
  var ANG_DRY = 12;           // seconds without a surface before it comes up anyway
  var DEP_DRY = 12;           // seconds without a weak point before one opens anyway

  function anglerNewBait(d, i) {
    var a = NA.RNG.f() * M.TAU, r = NA.RNG.range(0.25, 0.75) * Ar.radius;
    var o = i * 4;
    d.bait[o] = Ar.cx + Math.cos(a) * r;
    d.bait[o + 1] = Ar.cy + Math.sin(a) * r;
    d.bait[o + 2] = NA.RNG.range(-0.4, 0.4);        // drift phase
    d.bait[o + 3] = 0;                              // bite telegraph timer, -1 = idle
  }

  B.define('angler', {
    name: 'Angler', color: ANG_COL, hp: 660,
    introTime: 2.0, camZoom: 0.8,

    intro: function (b, t) {
      markSeen('angler');
      var d = b.data;
      // the bait is the first thing you see: a friendly little light
      var bx = Ar.cx + 180, by = Ar.cy - 60;
      var pu = 0.6 + 0.4 * Math.sin(t * 5);
      NA.R.dot(NA.R.L.ENEMIES, bx, by, 9 * pu, BAIT_COL[0], BAIT_COL[1], BAIT_COL[2], 1);
      NA.R.light(bx, by, 240 * pu, 0.8);
      return introCommon(b, t, function (bb, x, y, k) {
        NA.R.disc(NA.R.L.ENEMIES, x, y, 90 * k, ANG_COL[0], ANG_COL[1], ANG_COL[2], 0.18);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.bait = new Float32Array(MAXBAIT * 4);
        d.nBait = 1; d.real = 0;
        anglerNewBait(d, 0);
        d.surf = 0; d.radius = 76; d.spawnT = 0;
        d.tether = 0; d.tetherT = 4; d.tetherLock = 0; d.noHook = 0;
        b.x = Ar.cx; b.y = Ar.cy + 260;
      }
      if (i === 1) {
        d.nBait = 3;
        for (var k = 0; k < 3; k++) anglerNewBait(d, k);
        d.real = NA.RNG.int(3);
      }
      if (i === 2) { d.tetherT = 2.2; sfx('bossPhase'); }
    },

    /* A miss is a miss.  The submerged mass only eats the shots that actually
     * reach it -- the old version returned "absorbed" for every player bullet
     * in the arena, which deleted the whole build's output every frame. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      var dx = b.x - x, dy = b.y - y, rr = (d.radius || 76) + r;
      if (dx * dx + dy * dy > rr * rr) return 0;
      if (d.surf > 0) return 1;
      absorbFx(x, y, ANG_COL[0], ANG_COL[1], ANG_COL[2]);
      return 2;                        // the mass is down there somewhere, and armoured
    },

    phases: [
      { minDuration: 12, update: function (b, dt) { anglerTick(b, dt, 0); } },
      { minDuration: 13, update: function (b, dt) { anglerTick(b, dt, 1); } },
      { minDuration: 14, update: function (b, dt) { anglerTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      NA.Particles.ring(b.x, b.y, 30, 480, 0.9, 6, ANG_COL[0], ANG_COL[1], ANG_COL[2], 1);
      NA.Particles.shatter(b.x, b.y, 90, 7, ANG_COL[0], ANG_COL[1], ANG_COL[2], 380);
      // its light detaches and becomes a small companion for the rest of the run
      var ph = 0;
      persist.push({
        update: function (dt) { ph += dt * 1.1; },
        render: function () {
          if (!Pl.alive) return;
          var x = Pl.x + Math.cos(ph) * 58, y = Pl.y + Math.sin(ph) * 58;
          var pu = 0.7 + 0.3 * Math.sin(ph * 3.3);
          NA.R.dot(NA.R.L.PLAYER, x, y, 4.2 * pu, BAIT_COL[0], BAIT_COL[1], BAIT_COL[2], 0.95);
          NA.R.line(NA.R.L.PLAYER, Pl.x, Pl.y, x, y, 1, BAIT_COL[0], BAIT_COL[1], BAIT_COL[2], 0.18);
          NA.R.light(x, y, 200 * pu, 0.55);
        }
      });
    },
    onEnd: function () { cleanEnd(); },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.bait) return;
      // the mass: a dark displacement you can just about see
      if (d.surf <= 0) {
        R.disc(L.ENEMIES, b.x, b.y, d.radius * 1.5, ANG_COL[0], ANG_COL[1], ANG_COL[2], 0.13);
        R.poly(L.ENEMIES, b.x, b.y, d.radius * 1.15, 7, NA.Time.t * 0.2, 2,
          ANG_COL[0], ANG_COL[1], ANG_COL[2], 0.20);
      } else {
        // surfaced: mouth open, gold rimmed, the two-second window
        var k = M.clamp01(d.surf / 2);
        R.poly(L.ENEMIES, b.x, b.y, d.radius, 7, NA.Time.t * 0.6, 6,
          ANG_COL[0] + 0.3, ANG_COL[1] + 0.2, ANG_COL[2], 0.95);
        R.ring(L.ENEMIES, b.x, b.y, d.radius * 1.25, 4, COL.gold[0], COL.gold[1], COL.gold[2], 0.5 + 0.4 * k);
        for (var t = 0; t < 10; t++) {
          var a = t / 10 * M.TAU + NA.Time.t * 0.5;
          R.line(L.ENEMIES, b.x + Math.cos(a) * d.radius * 0.5, b.y + Math.sin(a) * d.radius * 0.5,
            b.x + Math.cos(a) * d.radius, b.y + Math.sin(a) * d.radius, 3, 1, 1, 1, 0.7);
        }
        R.light(b.x, b.y, 320, 0.6);
      }
      // the baits
      for (var i = 0; i < d.nBait; i++) {
        var o = i * 4;
        var real = (i === d.real);
        // the real one pulses off-tempo; the decoys breathe on the shared 2 Hz
        var hz = real ? 1.35 : C.TELEGRAPH_HZ;
        var pu = 0.55 + 0.45 * Math.sin(NA.Time.t * M.TAU * hz + d.bait[o + 2] * 4);
        var bx = d.bait[o], by = d.bait[o + 1];
        R.dot(L.ENEMIES, bx, by, 7.5 * (0.7 + 0.3 * pu), BAIT_COL[0], BAIT_COL[1], BAIT_COL[2], 0.95);
        R.ring(L.ENEMIES, bx, by, 13 + 5 * pu, 1.4, BAIT_COL[0], BAIT_COL[1], BAIT_COL[2], 0.55);
        R.light(bx, by, 220 * (0.6 + 0.4 * pu), 0.7);
        // the attract radius, drawn faintly so the herding is legible
        R.ring(L.FLOOR, bx, by, 420, 1.2, BAIT_COL[0], BAIT_COL[1], BAIT_COL[2], 0.10);
        // the filament back to the mass
        R.line(L.ENEMIES, bx, by, b.x, b.y, 1.2, ANG_COL[0], ANG_COL[1], ANG_COL[2], 0.22);
        if (d.bait[o + 3] > 0)
          En.telegraphCircle(bx, by, 150, d.bait[o + 3], 0.55, 0.35);
      }
      // the hook
      if (d.tether > 0) {
        var pulse = 0.55 + 0.45 * Math.abs(Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ));
        R.line(L.VEIL, b.x, b.y, Pl.x, Pl.y, 3, 1, 0.541, 0, 0.85 * pulse);
        R.dot(L.VEIL, Pl.x, Pl.y, 7, 1, 0.3, 0.2, 0.9);
      } else if (d.tetherLock > 0) {
        En.telegraphLine(b.x, b.y, Pl.x, Pl.y, d.tetherLock, 0.7, 0.45, 3);
      }
    }
  });

  function anglerTick(b, dt, mode) {
    var d = b.data;

    // the mass keeps its distance and stays hidden
    if (d.surf > 0) {
      d.surf -= dt;
      d.dryT = 0;
      if (d.surf <= 0) { sfx('wall', b.x, b.y); }
    } else {
      orbitToward(b, dt, 520, 90);
      /* Nothing may hold the window shut forever: if no enemy has taken the
       * bait for ANG_DRY seconds the mass comes up on its own real bait.  The
       * fight is never gated on a spawn trickle the player cannot control. */
      d.dryT = (d.dryT || 0) + dt;
      if (d.dryT >= ANG_DRY && d.bait) {
        d.dryT = 0;
        var fi = (d.real < d.nBait ? d.real : 0) * 4;
        anglerSurface(b, d.bait[fi], d.bait[fi + 1]);
        anglerNewBait(d, fi / 4);
      }
    }

    // a slow trickle of things to herd
    d.spawnT -= dt;
    if (d.spawnT <= 0 && En.n < 26) {
      d.spawnT = 2.1;
      var sa = NA.RNG.f() * M.TAU, sr = Ar.radiusAt(sa) - 40;
      spawnMinion('mote', 'moteling', Ar.cx + Math.cos(sa) * sr, Ar.cy + Math.sin(sa) * sr);
    }

    for (var i = 0; i < d.nBait; i++) {
      var o = i * 4;
      // drift
      d.bait[o] += Math.cos(NA.Time.t * 0.4 + d.bait[o + 2] * 6) * 22 * dt;
      d.bait[o + 1] += Math.sin(NA.Time.t * 0.33 + d.bait[o + 2] * 6) * 22 * dt;
      var bx = d.bait[o], by = d.bait[o + 1];
      if (Ar.depth(bx, by) < 60) {
        var ba = Math.atan2(by - Ar.cy, bx - Ar.cx);
        var br = Ar.radiusAt(ba) - 70;
        d.bait[o] = bx = Ar.cx + Math.cos(ba) * br;
        d.bait[o + 1] = by = Ar.cy + Math.sin(ba) * br;
      }

      // enemies are attracted to it, which is the whole fight
      var cnt = En.grid.query(bx, by, 420), out = En.grid.out;
      for (var q = 0; q < cnt; q++) {
        var ei = out[q]; if (ei >= En.n) continue;
        var ddx = bx - En.x[ei], ddy = by - En.y[ei];
        var dd2 = ddx * ddx + ddy * ddy;
        if (dd2 > 420 * 420 || dd2 < 1) continue;
        var inv = 1 / Math.sqrt(dd2);
        En.vx[ei] += ddx * inv * 260 * dt;
        En.vy[ei] += ddy * inv * 260 * dt;
        if (dd2 < 44 * 44 && (i === d.real || mode === 0)) {
          // an enemy took the bait: it surfaces, and it is soft for 2 s
          En.kill(ei, false);
          anglerSurface(b, bx, by);
          /* Bait-and-Switch remix: with a prism in the room the bait alone only
           * cracks the mouth open.  A shot banked off the prism opens it wide.
           * (Nothing is taken away -- the short window is still a window.) */
          if (d.bankOnly) d.surf = 0.6;
          anglerNewBait(d, i);
          break;
        }
      }

      // the player touching it is a different story
      if (d.bait[o + 3] > 0) {
        d.bait[o + 3] += dt;
        if (d.bait[o + 3] >= 0.55) {
          d.bait[o + 3] = 0;
          if (Pl.alive && M.dist2(Pl.x, Pl.y, bx, by) < 150 * 150) Pl.damage(1, bx, by);
          NA.Particles.ring(bx, by, 150, 20, 0.3, 6, 1, 0.3, 0.35, 1);
          NA.FX.trauma(0.35);
          sfx('hitEnemy', bx, by, 0.5);
          anglerNewBait(d, i);
        }
      } else if (Pl.alive && M.dist2(Pl.x, Pl.y, bx, by) < 46 * 46) {
        d.bait[o + 3] = 0.0001;                    // 0.55 s of telegraph before the bite
        sfx('telegraph', bx, by);
      }
    }

    /* ---- phase 3: the hook ---- */
    if (mode >= 2) {
      if (d.noHook > 0) d.noHook -= dt;
      if (d.tether > 0) {
        var tx = b.x - Pl.x, ty = b.y - Pl.y;
        var tl = Math.sqrt(tx * tx + ty * ty) || 1;
        if (Pl.alive) { Pl.vx += tx / tl * 420 * dt; Pl.vy += ty / tl * 420 * dt; }
        d.tether -= dt;
        if (Pl.dashT > 0) {                        // a dash snaps the line
          d.tether = 0; d.noHook = 1.6;
          NA.Particles.burst(Pl.x, Pl.y, 8, 300, 0.3, 1, 0.8, 0.3, 2);
          sfx('wall', Pl.x, Pl.y);
        }
        if (d.tether <= 0) d.tetherT = 4;
      } else if (d.tetherLock > 0) {
        d.tetherLock += dt;
        if (d.tetherLock >= 0.7) { d.tetherLock = 0; d.tether = 3.2; sfx('lock', Pl.x, Pl.y); }
      } else {
        d.tetherT -= dt;
        if (d.tetherT <= 0 && d.noHook <= 0) d.tetherLock = 0.0001;
      }
    }
  }

  /* A shot banked off the Reflector into the mass: the full window, opened
   * where the mass actually is.  Used by the duoBaitSwitch remix (13d). */
  B.anglerBank = function (b) {
    var d = b && b.data;
    if (!d || !d.bait) return false;
    anglerSurface(b, b.x, b.y);
    d.surf = 2.6;
    d.dryT = 0;
    NA.Particles.ring(b.x, b.y, 12, 300, 0.5, 6, COL.gold[0], COL.gold[1], COL.gold[2], 1);
    NA.FX.chroma(2, 200);
    return true;
  };

  function anglerSurface(b, x, y) {
    var d = b.data;
    b.x = x; b.y = y;
    d.surf = 2;
    NA.Particles.ring(x, y, 10, 220, 0.45, 5, COL.gold[0], COL.gold[1], COL.gold[2], 1);
    NA.FX.trauma(0.3);
    NA.Time.addHitStop(40);
    sfx('charge', x, y, 0.8);
  }

  /* ================================================================ 14 ====
   * THE REFLECTOR — a chrome faceted hexagonal prism. Player bullets bounce
   * off its facets across the facet normal, keeping their flags, with the
   * owner flipped to the boss: the more absurd your build, the more careful
   * your aim. One matte facet absorbs instead, and that facet is the weak
   * point — and it flickers. Phase 3 shatters it into six orbiting facets with
   * the matte one moving once a second, and the crowd uses them as cover.
   * Death releases every projectile it ever absorbed as friendly fire.
   *
   * The whole reflection is done in the boss's own update against the player
   * bullet pool, so velocity, size and flags survive the bounce exactly;
   * hitTest therefore reports 0 and never intercepts a shot. */

  var REF_COL = [0.80, 0.86, 0.96];
  var REF_R = 92, FACET_R = 44, ABS_CAP = 200;

  function refFacetOf(b, ang) {
    var d = b.data;
    var k = (ang - d.rot) / M.TAU * 6;
    k = Math.round(k) % 6; if (k < 0) k += 6;
    return k;
  }

  function refAbsorb(d, dmg, size) {
    if (d.absN >= ABS_CAP) return;
    d.absDmg[d.absN] = dmg; d.absSize[d.absN] = size;
    d.absN++;
  }

  /* One reflection: v' = v - 2(v·n)n, owner flipped, engine flags carried. */
  function refBounce(b, i, nx, ny) {
    var P = Bu.P;
    var vx = P.vx[i], vy = P.vy[i];
    var vn = vx * nx + vy * ny;
    var rx = vx - 2 * vn * nx, ry = vy - 2 * vn * ny;
    SHOTOPT.life = 4.5; SHOTOPT.owner = OWN.REFLECT;
    SHOTOPT.homing = P.homing[i] * 0.5; SHOTOPT.bounce = P.bounce[i];
    SHOTOPT.flags = P.flags[i] & ~Bu.FLAG.GRAZED; SHOTOPT.a = 1;
    bossShot(P.x[i] + nx * 6, P.y[i] + ny * 6, rx, ry, Math.max(6, P.size[i]), REF_COL, SHOTOPT);
    NA.Particles.burst(P.x[i], P.y[i], 3, 200, 0.18, REF_COL[0], REF_COL[1], REF_COL[2], 1);
    if ((NA.Time.frames & 7) === 0) sfx('wall', P.x[i], P.y[i], 1.4);
    Bu.killP(i, true);
  }

  B.define('reflector', {
    name: 'Reflector', color: REF_COL, hp: 700,
    introTime: 1.8, camZoom: 0.85,

    intro: function (b, t) {
      markSeen('reflector');
      return introCommon(b, t, function (bb, x, y, k) {
        NA.R.poly(NA.R.L.ENEMIES, x, y, REF_R * (0.5 + 0.5 * k), 6, NA.Time.t * 0.6, 4,
          REF_COL[0], REF_COL[1], REF_COL[2], 0.4 + 0.5 * k);
        // one facet already matte, so the rule is legible before it moves
        NA.R.line(NA.R.L.ENEMIES, x + Math.cos(0.5) * REF_R * k, y + Math.sin(0.5) * REF_R * k,
          x + Math.cos(1.55) * REF_R * k, y + Math.sin(1.55) * REF_R * k, 6, 0.25, 0.22, 0.28, 0.9);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.rot = 0; d.matte = 0; d.matteT = 0; d.spin = 0.35;
        d.absDmg = new Float32Array(ABS_CAP); d.absSize = new Float32Array(ABS_CAP); d.absN = 0;
        d.shards = 0; d.shardA = 0; d.radius = REF_R;
        d.shotT = 2; d.spawnT = 3;
        b.x = Ar.cx; b.y = Ar.cy;
      }
      if (i === 1) { d.spin = 0.75; d.matteT = 0; }
      if (i === 2) {
        d.shards = 1; d.spin = 0.9;
        NA.Particles.shatter(b.x, b.y, REF_R, 6, REF_COL[0], REF_COL[1], REF_COL[2], 420);
        NA.FX.trauma(0.6); NA.FX.chroma(3, 300);
        sfx('bossPhase');
      }
    },

    // the framework never intercepts: reflection is handled in update()
    hitTest: function () { return 0; },

    phases: [
      { minDuration: 12, update: function (b, dt) { refTick(b, dt, 0); } },
      { minDuration: 13, update: function (b, dt) { refTick(b, dt, 1); } },
      { minDuration: 14, update: function (b, dt) { refTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      NA.Particles.ring(b.x, b.y, 20, 620, 1.0, 7, REF_COL[0], REF_COL[1], REF_COL[2], 1);
      NA.FX.chroma(3, 500);
      // everything it ever absorbed comes back out, as yours
      var n = Math.min(d.absN, ABS_CAP);
      for (var i = 0; i < n; i++) {
        var a = i / n * M.TAU + NA.RNG.range(-0.05, 0.05);
        Bu.firePlayer(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40,
          Math.cos(a) * 900, Math.sin(a) * 900,
          { dmg: d.absDmg[i], size: d.absSize[i] || 7, life: 3, bounce: 1 });
      }
      d.absN = 0;
      sfx('rail', b.x, b.y);
    },
    onEnd: function () { cleanEnd(); },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (d.rot === undefined) return;
      var flick = 0.45 + 0.55 * Math.abs(Math.sin(NA.Time.t * 9.3));   // the matte facet flickers
      if (!d.shards) {
        R.poly(L.ENEMIES, b.x, b.y, REF_R, 6, d.rot, 5, REF_COL[0], REF_COL[1], REF_COL[2], 0.95);
        R.poly(L.ENEMIES, b.x, b.y, REF_R * 0.62, 6, -d.rot * 0.6, 2.5, 1, 1, 1, 0.5);
        for (var f = 0; f < 6; f++) {
          var a0 = d.rot + (f - 0.5) / 6 * M.TAU, a1 = d.rot + (f + 0.5) / 6 * M.TAU;
          var x0 = b.x + Math.cos(a0) * REF_R, y0 = b.y + Math.sin(a0) * REF_R;
          var x1 = b.x + Math.cos(a1) * REF_R, y1 = b.y + Math.sin(a1) * REF_R;
          if (f === d.matte) {
            R.line(L.ENEMIES, x0, y0, x1, y1, 8, 0.30, 0.26, 0.32, 0.95);
            R.line(L.ENEMIES, x0, y0, x1, y1, 3, COL.gold[0], COL.gold[1], COL.gold[2], flick);
          } else {
            R.line(L.ENEMIES, x0, y0, x1, y1, 3, 1, 1, 1, 0.55);
          }
        }
        R.dot(L.ENEMIES, b.x, b.y, 10, 1, 1, 1, 0.85);
        R.light(b.x, b.y, 280, 0.4);
      } else {
        for (var s = 0; s < 6; s++) {
          var sa = d.shardA + s / 6 * M.TAU;
          var sx = b.x + Math.cos(sa) * 230, sy = b.y + Math.sin(sa) * 230;
          var matte = (s === d.matte);
          R.poly(L.ENEMIES, sx, sy, FACET_R, 3, sa * 1.7, 4,
            matte ? 0.35 : REF_COL[0], matte ? 0.30 : REF_COL[1], matte ? 0.38 : REF_COL[2], 0.95);
          if (matte) R.poly(L.ENEMIES, sx, sy, FACET_R * 0.7, 3, -sa * 1.7, 3,
            COL.gold[0], COL.gold[1], COL.gold[2], flick);
          else R.dot(L.ENEMIES, sx, sy, 5, 1, 1, 1, 0.6);
          R.line(L.ENEMIES, b.x, b.y, sx, sy, 1, REF_COL[0], REF_COL[1], REF_COL[2], 0.15);
        }
        R.dot(L.ENEMIES, b.x, b.y, 12, REF_COL[0], REF_COL[1], REF_COL[2], 0.7);
        R.light(b.x, b.y, 320, 0.35);
      }
      // the absorbed store, drawn as a charge meter under the prism
      if (d.absN) {
        var k = Math.min(1, d.absN / ABS_CAP);
        R.arc(L.ENEMIES, b.x, b.y, REF_R * 1.35, -M.HALFPI, -M.HALFPI + M.TAU * k, 3,
          COL.gold[0], COL.gold[1], COL.gold[2], 0.55);
      }
    }
  });

  function refTick(b, dt, mode) {
    var d = b.data;
    d.rot += d.spin * dt;
    d.shardA += dt * 0.55;
    if (mode === 0) {
      orbitToward(b, dt, 300, 60);
    } else {
      orbitToward(b, dt, 340, 110);
    }

    // the matte facet moves: every 2.5 s in phase 2, every second in phase 3
    d.matteT += dt;
    var period = mode === 0 ? 1e9 : (mode === 1 ? 2.5 : 1.0);
    if (d.matteT >= period) { d.matteT = 0; d.matte = NA.RNG.int(6); sfx('uiTick', b.x, b.y); }

    /* ---- the mirror: every player bullet against every facet ---- */
    var P = Bu.P;
    if (!d.shards) {
      var rr = REF_R;
      for (var i = 0; i < P.n; i++) {
        var dx = P.x[i] - b.x, dy = P.y[i] - b.y;
        var dd2 = dx * dx + dy * dy;
        var lim = rr + P.size[i];
        if (dd2 > lim * lim) continue;
        if (P.vx[i] * dx + P.vy[i] * dy > 0) continue;      // already leaving
        var ang = Math.atan2(dy, dx);
        var f = refFacetOf(b, ang);
        if (f === d.matte) {
          refAbsorb(d, P.dmg[i], P.size[i]);
          B.damage(P.dmg[i]);
          NA.Particles.burst(P.x[i], P.y[i], 4, 190, 0.2, COL.gold[0], COL.gold[1], COL.gold[2], 1);
          Bu.killP(i, true); i--;
        } else {
          var fa = d.rot + f / 6 * M.TAU;
          refBounce(b, i, Math.cos(fa), Math.sin(fa));
          i--;
        }
      }
    } else {
      // six orbiting facets, and the crowd hides behind them
      for (var s = 0; s < 6; s++) {
        var sa = d.shardA + s / 6 * M.TAU;
        var sx = b.x + Math.cos(sa) * 230, sy = b.y + Math.sin(sa) * 230;
        // the facet itself is the cover: nothing crosses it, so anything
        // sheltering behind one is safe until the facet drifts away
        for (var j = 0; j < P.n; j++) {
          var jx = P.x[j] - sx, jy = P.y[j] - sy;
          var j2 = jx * jx + jy * jy;
          var jl = FACET_R + P.size[j];
          if (j2 > jl * jl) continue;
          if (P.vx[j] * jx + P.vy[j] * jy > 0) continue;
          if (s === d.matte) {
            refAbsorb(d, P.dmg[j], P.size[j]);
            B.damage(P.dmg[j]);
            NA.Particles.burst(P.x[j], P.y[j], 4, 190, 0.2, COL.gold[0], COL.gold[1], COL.gold[2], 1);
            Bu.killP(j, true); j--;
          } else {
            var jd = Math.sqrt(j2) || 1;
            refBounce(b, j, jx / jd, jy / jd);
            j--;
          }
        }
      }
    }

    /* ---- it shoots, too: slow chrome bolts, so the mirror is not the only
     * pressure and the fight still reads without a big build ---- */
    d.shotT -= dt;
    if (d.shotT <= 0) {
      d.shotT = mode === 0 ? 2.4 : 1.8;
      var n = 3 + mode;
      var base = Math.atan2(Pl.y - b.y, Pl.x - b.x);
      SHOTOPT.life = 5; SHOTOPT.owner = 1; SHOTOPT.homing = 0; SHOTOPT.bounce = 1;
      SHOTOPT.flags = 0; SHOTOPT.a = 1;
      for (var k2 = 0; k2 < n; k2++) {
        var a2 = base + (k2 - (n - 1) / 2) * 0.24;
        bossShot(b.x + Math.cos(a2) * 100, b.y + Math.sin(a2) * 100,
          Math.cos(a2) * 330, Math.sin(a2) * 330, 8, REF_COL, SHOTOPT);
      }
      sfx('shot', b.x, b.y, 1.2);
    }

    // phase 3 gives the crowd a reason to exist behind the cover
    if (mode >= 2) {
      d.spawnT -= dt;
      if (d.spawnT <= 0 && En.n < 30) {
        d.spawnT = 2.4;
        var ra = NA.RNG.f() * M.TAU, rrr = Ar.radiusAt(ra) - 40;
        spawnMinion('mote', 'moteling', Ar.cx + Math.cos(ra) * rrr, Ar.cy + Math.sin(ra) * rrr);
      }
    }
  }

  /* ================================================================ 15 ====
   * THE INVERTER — a drifting circular lens field. Inside it your controls are
   * mirrored and every projectile that crosses the boundary has its tangential
   * velocity flipped. The boss can only be damaged from inside the glass.
   * Phase 2 adds a second, overlapping lens (two inversions cancel). Phase 3
   * grows the lens over the whole arena, leaving one small bubble of normal
   * space at the core — which is exactly where the boss lives.
   *
   * The mirrored controls are implemented without touching the player: the
   * boss adds -2 × (input × accel) after NA.Player.update has added +1 × of it,
   * so the net is a clean inversion and no upgrade is disabled. */

  var INV_COL = [0.61, 0.36, 1.0];
  var INSIDE0 = 1 << 14, INSIDE1 = 1 << 15;

  /* Mirror the tangential component: the shot keeps going in, but sideways-
   * flipped, which is what a lens looks like. */
  function lensFlip(pool, i, cx, cy) {
    var dx = pool.x[i] - cx, dy = pool.y[i] - cy;
    var l = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / l, ny = dy / l;
    var vn = pool.vx[i] * nx + pool.vy[i] * ny;
    // v' = 2(v·n)n - v  → radial kept, tangential mirrored
    pool.vx[i] = 2 * vn * nx - pool.vx[i];
    pool.vy[i] = 2 * vn * ny - pool.vy[i];
    pool.rot[i] = Math.atan2(pool.vy[i], pool.vx[i]);
    if ((NA.Time.frames & 3) === 0)
      NA.Particles.burst(pool.x[i], pool.y[i], 2, 120, 0.16, INV_COL[0], INV_COL[1], INV_COL[2], 0);
  }

  function lensScan(pool, cx, cy, rad, bit) {
    var r2 = rad * rad;
    for (var i = 0; i < pool.n; i++) {
      var dx = pool.x[i] - cx, dy = pool.y[i] - cy;
      var inside = (dx * dx + dy * dy) < r2;
      var was = (pool.flags[i] & bit) !== 0;
      if (inside === was) continue;
      if (inside) pool.flags[i] |= bit; else pool.flags[i] &= ~bit;
      lensFlip(pool, i, cx, cy);
    }
  }

  B.define('inverter', {
    name: 'Inverter', color: INV_COL, hp: 660,
    introTime: 1.8, camZoom: 0.78,

    intro: function (b, t) {
      markSeen('inverter');
      return introCommon(b, t, function (bb, x, y, k) {
        var R = NA.R;
        R.ring(R.L.MEMBRANE, x, y, 320 * k, 3, INV_COL[0], INV_COL[1], INV_COL[2], 0.7);
        R.disc(R.L.FLOOR, x, y, 320 * k, INV_COL[0], INV_COL[1], INV_COL[2], 0.07);
        R.poly(R.L.ENEMIES, x, y, 54 * k, 4, NA.Time.t, 3, INV_COL[0], INV_COL[1], INV_COL[2], 0.9);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.n = 1; d.radius = 58;
        d.lx = new Float32Array(2); d.ly = new Float32Array(2);
        d.lr = new Float32Array(2); d.lvx = new Float32Array(2); d.lvy = new Float32Array(2);
        d.lx[0] = Ar.cx; d.ly[0] = Ar.cy; d.lr[0] = 340;
        d.lvx[0] = 70; d.lvy[0] = 46;
        d.grow = 0; d.bubble = 0; d.shotT = 1.6;
        b.x = Ar.cx; b.y = Ar.cy;
      }
      if (i === 1) {
        d.n = 2;
        d.lx[1] = Ar.cx - 220; d.ly[1] = Ar.cy + 160; d.lr[1] = 310;
        d.lvx[1] = -60; d.lvy[1] = 74;
      }
      if (i === 2) {
        d.n = 1; d.grow = 1; d.bubble = 175;
        d.lx[0] = Ar.cx; d.ly[0] = Ar.cy; d.lvx[0] = 0; d.lvy[0] = 0;
        b.x = Ar.cx; b.y = Ar.cy;
        NA.FX.chroma(3, 400);
        sfx('bossPhase');
      }
    },

    /* Only a shot that lands in lensed space can hurt it. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      var dx = b.x - x, dy = b.y - y, rr = d.radius + r;
      if (dx * dx + dy * dy > rr * rr) return 0;
      if (d.grow) return 1;                                  // the arena IS the lens now
      for (var i = 0; i < d.n; i++) {
        var ex = x - d.lx[i], ey = y - d.ly[i];
        if (ex * ex + ey * ey < d.lr[i] * d.lr[i]) return 1;
      }
      absorbFx(x, y, INV_COL[0], INV_COL[1], INV_COL[2]);
      return 2;                                              // outside the glass: nothing
    },

    phases: [
      { minDuration: 12, update: function (b, dt) { invTick(b, dt, 0); } },
      { minDuration: 13, update: function (b, dt) { invTick(b, dt, 1); } },
      { minDuration: 14, update: function (b, dt) { invTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      // it shatters into shards that hold frozen, mirrored snapshots of the room
      for (var i = 0; i < 26; i++) {
        var a = i / 26 * M.TAU, sp = 240 + NA.RNG.f() * 420;
        NA.Particles.frag(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp, a, 26 + NA.RNG.f() * 26,
          1.1 + NA.RNG.f() * 0.7, INV_COL[0], INV_COL[1], INV_COL[2]);
      }
      for (var r = 0; r < 4; r++)
        NA.Particles.ring(b.x, b.y, 30 + r * 40, 420 + r * 120, 0.7 + r * 0.15, 4,
          INV_COL[0], INV_COL[1], INV_COL[2], 0.9);
      NA.FX.chroma(3, 700); NA.FX.hue(0.6, 600);
      // every projectile still in the air un-mirrors as the glass goes
      var P = Bu.P;
      for (var q = 0; q < P.n; q++) P.flags[q] &= ~(INSIDE0 | INSIDE1);
      var E = Bu.E;
      for (var q2 = 0; q2 < E.n; q2++) E.flags[q2] &= ~(INSIDE0 | INSIDE1);
    },
    onEnd: function () { cleanEnd(); },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.lr) return;
      for (var i = 0; i < d.n; i++) {
        var x = d.lx[i], y = d.ly[i], r = d.lr[i];
        R.disc(L.FLOOR, x, y, r, INV_COL[0], INV_COL[1], INV_COL[2], 0.07);
        R.ring(L.MEMBRANE, x, y, r, 3, INV_COL[0], INV_COL[1], INV_COL[2], 0.6);
        R.ring(L.MEMBRANE, x, y, r - 7, 1.2, 1, 1, 1, 0.18);
        // mirrored arcs inside the glass so the inversion is visible standing still
        for (var s = 0; s < 3; s++) {
          var a0 = NA.Time.t * (s % 2 ? 0.5 : -0.5) + s * 2.1;
          R.arc(L.FLOOR, x, y, r * (0.35 + s * 0.22), a0, a0 + 1.1, 2,
            INV_COL[0], INV_COL[1], INV_COL[2], 0.22);
        }
      }
      if (d.bubble > 0) {
        // the one bubble of normal space, at the core
        R.ring(L.MEMBRANE, b.x, b.y, d.bubble, 2.5, COL.player[0], COL.player[1], COL.player[2], 0.55);
        R.disc(L.FLOOR, b.x, b.y, d.bubble, 0.02, 0.024, 0.04, 0.45);
      }
      var f = b.flash > 0 ? 1 : 0;
      R.poly(L.ENEMIES, b.x, b.y, d.radius, 4, NA.Time.t * 0.7, 5,
        f ? 1 : INV_COL[0], f ? 1 : INV_COL[1], f ? 1 : INV_COL[2], 0.95);
      R.poly(L.ENEMIES, b.x, b.y, d.radius * 0.55, 4, -NA.Time.t * 1.1, 3, 1, 1, 1, 0.55);
      R.dot(L.ENEMIES, b.x, b.y, 8, 1, 1, 1, 0.9);
      R.light(b.x, b.y, 300, 0.5);
      // the mirrored-input tell: a flipped chevron under the ship
      if (d.mirrored) {
        var mx = Pl.x, my = Pl.y + 34;
        R.line(L.HUD, mx - 12, my, mx, my + 8, 2, INV_COL[0], INV_COL[1], INV_COL[2], 0.8);
        R.line(L.HUD, mx + 12, my, mx, my + 8, 2, INV_COL[0], INV_COL[1], INV_COL[2], 0.8);
      }
    }
  });

  function invTick(b, dt, mode) {
    var d = b.data;

    if (mode === 2) {
      // the lens grows until it is the arena
      d.lr[0] = M.smooth(d.lr[0], Ar.radius * 1.05, 1.1, dt);
      d.lx[0] = Ar.cx; d.ly[0] = Ar.cy;
      b.x = M.smooth(b.x, Ar.cx, 2, dt); b.y = M.smooth(b.y, Ar.cy, 2, dt);
    } else {
      for (var i = 0; i < d.n; i++) {
        d.lx[i] += d.lvx[i] * dt; d.ly[i] += d.lvy[i] * dt;
        var lim = Ar.radius - d.lr[i] * 0.35;
        var dd = M.dist(d.lx[i], d.ly[i], Ar.cx, Ar.cy);
        if (dd > lim) {                       // bounce the lens off the membrane
          var a = Math.atan2(d.ly[i] - Ar.cy, d.lx[i] - Ar.cx);
          d.lx[i] = Ar.cx + Math.cos(a) * lim; d.ly[i] = Ar.cy + Math.sin(a) * lim;
          var nx = Math.cos(a), ny = Math.sin(a);
          var vn = d.lvx[i] * nx + d.lvy[i] * ny;
          d.lvx[i] -= 2 * vn * nx; d.lvy[i] -= 2 * vn * ny;
        }
      }
      // the body hides in the glass, because that is where you have to shoot
      var tx = d.lx[0] + Math.cos(b.t * 0.7) * d.lr[0] * 0.4;
      var ty = d.ly[0] + Math.sin(b.t * 0.7) * d.lr[0] * 0.4;
      b.x = M.smooth(b.x, tx, 1.6, dt); b.y = M.smooth(b.y, ty, 1.6, dt);
    }

    /* ---- projectiles flip on every crossing ---- */
    lensScan(Bu.P, d.lx[0], d.ly[0], d.lr[0], INSIDE0);
    lensScan(Bu.E, d.lx[0], d.ly[0], d.lr[0], INSIDE0);
    if (d.n > 1) {
      lensScan(Bu.P, d.lx[1], d.ly[1], d.lr[1], INSIDE1);
      lensScan(Bu.E, d.lx[1], d.ly[1], d.lr[1], INSIDE1);
    }

    /* ---- mirrored controls inside the glass ---- */
    var inv = 0;
    for (var k = 0; k < d.n; k++) {
      var px = Pl.x - d.lx[k], py = Pl.y - d.ly[k];
      if (px * px + py * py < d.lr[k] * d.lr[k]) inv ^= 1;    // two lenses cancel
    }
    if (d.bubble > 0 && M.dist2(Pl.x, Pl.y, b.x, b.y) < d.bubble * d.bubble) inv = 0;
    d.mirrored = inv;
    if (inv && Pl.alive && Pl.dashT <= 0) {
      var ax = NA.Input.axis();
      // NA.Player.update already added +1×; -2× leaves a clean mirror
      Pl.vx -= 2 * ax.x * C.PLAYER_ACCEL * dt;
      Pl.vy -= 2 * ax.y * C.PLAYER_ACCEL * dt;
    }

    /* ---- it shoots slow, readable violet bolts through its own glass ---- */
    d.shotT -= dt;
    if (d.shotT <= 0) {
      d.shotT = mode === 0 ? 1.9 : 1.5;
      var n = 5 + mode * 2;
      SHOTOPT.life = 6; SHOTOPT.owner = 1; SHOTOPT.homing = 0; SHOTOPT.bounce = 0;
      SHOTOPT.flags = 0; SHOTOPT.a = 1;
      var base = Math.atan2(Pl.y - b.y, Pl.x - b.x);
      for (var s = 0; s < n; s++) {
        var a2 = base + (s - (n - 1) / 2) * 0.30;
        bossShot(b.x + Math.cos(a2) * (d.radius + 8), b.y + Math.sin(a2) * (d.radius + 8),
          Math.cos(a2) * 300, Math.sin(a2) * 300, 8, INV_COL, SHOTOPT);
      }
      sfx('shot', b.x, b.y, 0.8);
    }
  }

  /* ================================================================ 16 ====
   * THE ECHO — everything you kill and every shot you fire comes back five
   * seconds later as a green echo. The ring is damaged ONLY by echo
   * projectiles, so you shoot where it WILL be: a ghost ring shows its
   * position five seconds from now. The delay drifts between two and eight
   * seconds, echoes get echoes (depth 2), and on death the whole delay line
   * rewinds at ten times speed back to where each echo was born.
   *
   * Event ring buffer: 300 entries in typed arrays, no allocation. */

  var ECH_COL = [0.224, 1.0, 0.416];
  var ECAP = 300;
  var EK_SHOT = 0, EK_KILL = 1;
  var EFLAG_ENEMY = 2;            // NA.Enemies flags bit: this body is an echo

  function echoRecord(d, kind, x, y, vx, vy, type, depth) {
    var i = d.head;
    d.ekind[i] = kind; d.ex[i] = x; d.ey[i] = y;
    d.evx[i] = vx; d.evy[i] = vy; d.etype[i] = type;
    d.edepth[i] = depth; d.et[i] = NA.Time.t; d.eplayed[i] = 0;
    d.head = (d.head + 1) % ECAP;
    if (d.en < ECAP) d.en++;
  }

  B.define('echo', {
    name: 'Echo', color: ECH_COL, hp: 640,
    introTime: 1.8, camZoom: 0.8,

    intro: function (b, t) {
      markSeen('echo');
      return introCommon(b, t, function (bb, x, y, k) {
        var R = NA.R;
        R.ring(R.L.ENEMIES, x, y, 120 * k, 6, ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.85);
        // the ghost, already five seconds ahead of itself
        R.ring(R.L.VEIL, x + 160 * k, y - 90 * k, 120 * k, 2, ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.30);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.ex = new Float32Array(ECAP); d.ey = new Float32Array(ECAP);
        d.evx = new Float32Array(ECAP); d.evy = new Float32Array(ECAP);
        d.et = new Float32Array(ECAP); d.etype = new Int32Array(ECAP);
        d.ekind = new Uint8Array(ECAP); d.edepth = new Uint8Array(ECAP);
        d.eplayed = new Uint8Array(ECAP);
        d.head = 0; d.en = 0;
        d.delay = 5; d.orbA = 0; d.orbR = 420; d.orbW = 0.55;
        d.radius = 118; d.corpseHead = En.corpses.head;
        d.wasMuzzle = 0; d.drift = 0; d.maxDepth = 1;
        b.x = Ar.cx + d.orbR; b.y = Ar.cy;
      }
      if (i === 1) { d.drift = 1; d.orbW = 0.7; }             // the delay starts to wander
      if (i === 2) { d.maxDepth = 2; d.orbW = 0.9; sfx('bossPhase'); }
    },

    /* Only echo projectiles touch it — and that test needs the bullet's
     * flags, which hitTest cannot see, so the ring is never intercepted by the
     * framework and does all of its collision in echoTick below. Ordinary
     * shots simply pass through it: it is not really there yet. */
    hitTest: function () { return 0; },

    phases: [
      { minDuration: 12, update: function (b, dt) { echoTick(b, dt, 0); } },
      { minDuration: 13, update: function (b, dt) { echoTick(b, dt, 1); } },
      { minDuration: 14, update: function (b, dt) { echoTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      NA.Particles.ring(b.x, b.y, 20, 640, 1.0, 7, ECH_COL[0], ECH_COL[1], ECH_COL[2], 1);
      NA.FX.chroma(3, 600);
      // the whole delay line rewinds at 10x, back to where each echo was born
      var t = 0;
      persist.push({
        update: function (dt) {
          t += dt;
          for (var i = 0; i < En.n; i++) {
            if (!(En.flags[i] & EFLAG_ENEMY)) continue;
            var dx = En.tx[i] - En.x[i], dy = En.ty[i] - En.y[i];
            var dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < 26) { En.kill(i, false); i--; continue; }
            var sp = 1600;
            En.x[i] += dx / dd * sp * dt; En.y[i] += dy / dd * sp * dt;
            En.vx[i] = 0; En.vy[i] = 0;
            if ((NA.Time.frames & 3) === 0)
              NA.Particles.afterImage(En.x[i], En.y[i], 0, En.size[i], 0.2,
                ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.3, 0);
          }
          var P = Bu.P;
          for (var q = 0; q < P.n; q++) {
            if (P.flags[q] & FL.ECHO) { P.vx[q] *= -10; P.vy[q] *= -10; P.flags[q] &= ~FL.ECHO; }
          }
          if (t > 1.6) this.dead = 1;
        }
      });
    },
    onEnd: function () {
      for (var i = 0; i < En.n; i++) En.flags[i] &= ~EFLAG_ENEMY;
      cleanEnd();
    },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.ex) return;
      var f = b.flash > 0 ? 1 : 0;
      // the ring itself
      R.ring(L.ENEMIES, b.x, b.y, d.radius, 9, f ? 1 : ECH_COL[0], f ? 1 : ECH_COL[1], f ? 1 : ECH_COL[2], 0.9);
      R.ring(L.ENEMIES, b.x, b.y, d.radius * 0.62, 3, 1, 1, 1, 0.45);
      R.dot(L.ENEMIES, b.x, b.y, 9, 1, 1, 1, 0.8);
      R.light(b.x, b.y, 300, 0.45);
      // the ghost ring: where it will be one delay from now — aim here
      var ga = d.orbA + d.orbW * d.delay;
      var gx = Ar.cx + Math.cos(ga) * d.orbR, gy = Ar.cy + Math.sin(ga) * d.orbR;
      var pu = 0.35 + 0.25 * Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ);
      R.ring(L.VEIL, gx, gy, d.radius, 2.5, ECH_COL[0], ECH_COL[1], ECH_COL[2], pu + 0.2);
      R.ring(L.VEIL, gx, gy, d.radius * 0.5, 1.2, 1, 1, 1, pu * 0.5);
      for (var s = 0; s < 8; s++) {                    // a dotted lead from now to then
        var k = s / 8;
        var la = d.orbA + d.orbW * d.delay * k;
        R.dot(L.VEIL, Ar.cx + Math.cos(la) * d.orbR, Ar.cy + Math.sin(la) * d.orbR, 2,
          ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.22);
      }
      // the delay itself, as an arc under the ring
      R.arc(L.HUD, b.x, b.y, d.radius * 1.3, -M.HALFPI, -M.HALFPI + M.TAU * (d.delay / 8), 3,
        ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.5);
      // echo bodies: green translucent, half HP
      for (var e = 0; e < En.n; e++) {
        if (!(En.flags[e] & EFLAG_ENEMY)) continue;
        R.ring(L.ENEMIES, En.x[e], En.y[e], En.size[e] + 5, 1.6,
          ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.55);
        R.disc(L.ENEMIES, En.x[e], En.y[e], En.size[e] * 1.6, ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.10);
      }
    }
  });

  function echoTick(b, dt, mode) {
    var d = b.data;
    d.orbA += d.orbW * dt;
    b.x = Ar.cx + Math.cos(d.orbA) * d.orbR;
    b.y = Ar.cy + Math.sin(d.orbA) * d.orbR;
    if (d.drift) d.delay = 5 + 3 * Math.sin(NA.Time.t * 0.11);        // 2 s .. 8 s

    /* ---- record: every player shot, every kill ---- */
    var muz = Pl.muzzle > 0 ? 1 : 0;
    if (muz && !d.wasMuzzle && Pl.alive) {
      var sp = Pl.stats.bulletSpeed;
      echoRecord(d, EK_SHOT, Pl.x + Math.cos(Pl.angle) * 18, Pl.y + Math.sin(Pl.angle) * 18,
        Math.cos(Pl.angle) * sp, Math.sin(Pl.angle) * sp, 0, 0);
    }
    d.wasMuzzle = muz;

    var cp = En.corpses;
    while (d.corpseHead !== cp.head) {
      echoRecord(d, EK_KILL, cp.x[d.corpseHead], cp.y[d.corpseHead], 0, 0, cp.type[d.corpseHead], 0);
      d.corpseHead = (d.corpseHead + 1) % C.MAX_CORPSES;
    }

    /* ---- replay: everything that is old enough ---- */
    var now = NA.Time.t;
    for (var i = 0; i < d.en; i++) {
      if (d.eplayed[i]) continue;
      if (now - d.et[i] < d.delay) continue;
      d.eplayed[i] = 1;
      if (d.ekind[i] === EK_SHOT) {
        var bi = Bu.firePlayer(d.ex[i], d.ey[i], d.evx[i], d.evy[i], {
          dmg: Pl.stats.damage * 0.5, size: 7, life: 3,
          r: ECH_COL[0], g: ECH_COL[1], b: ECH_COL[2], a: 0.75
        });
        if (bi >= 0) Bu.P.flags[bi] |= FL.ECHO;
        // echoes get echoes, to a depth of two
        if (d.edepth[i] < d.maxDepth)
          echoRecord(d, EK_SHOT, d.ex[i], d.ey[i], d.evx[i], d.evy[i], 0, d.edepth[i] + 1);
      } else {
        var ti = d.etype[i];
        if (ti >= 0 && ti < En.types.length && En.n < C.MAX_ENEMIES - 4) {
          var ei = En.spawn(En.types[ti].id, d.ex[i], d.ey[i]);
          if (ei >= 0) {
            En.hp[ei] = En.maxHp[ei] = Math.max(1, En.maxHp[ei] * 0.5);   // half-HP copy
            En.flags[ei] |= EFLAG_ENEMY;
            En.tx[ei] = d.ex[i]; En.ty[ei] = d.ey[i];                     // its origin, for the rewind
          }
          if (d.edepth[i] < d.maxDepth)
            echoRecord(d, EK_KILL, d.ex[i], d.ey[i], 0, 0, ti, d.edepth[i] + 1);
        }
      }
      NA.Particles.ring(d.ex[i], d.ey[i], 4, 46, 0.3, 2, ECH_COL[0], ECH_COL[1], ECH_COL[2], 0.8);
    }

    /* ---- only echo projectiles hurt the ring ---- */
    var P = Bu.P;
    var inner = d.radius - 16, outer = d.radius + 16;
    for (var q = 0; q < P.n; q++) {
      var dx = P.x[q] - b.x, dy = P.y[q] - b.y;
      var dd2 = dx * dx + dy * dy;
      if (dd2 < inner * inner || dd2 > outer * outer) continue;
      if (!(P.flags[q] & FL.ECHO)) {          // an ordinary shot goes right through
        absorbFx(P.x[q], P.y[q], ECH_COL[0], ECH_COL[1], ECH_COL[2]);
        continue;
      }
      B.damage(P.dmg[q] * 2.2);                     // echoes hit hard: they are the only key
      NA.Particles.burst(P.x[q], P.y[q], 4, 200, 0.2, ECH_COL[0], ECH_COL[1], ECH_COL[2], 1);
      sfx('hitEnemy', P.x[q], P.y[q], 1.3);
      Bu.killP(q, true); q--;
    }

    /* ---- it defends itself with slow green rings ---- */
    d.shotT = (d.shotT === undefined ? 2 : d.shotT) - dt;
    if (d.shotT <= 0) {
      d.shotT = mode === 0 ? 2.6 : 2.0;
      var n = 8 + mode * 2;
      SHOTOPT.life = 6; SHOTOPT.owner = 1; SHOTOPT.homing = 0; SHOTOPT.bounce = 0;
      SHOTOPT.flags = 0; SHOTOPT.a = 0.9;
      for (var s2 = 0; s2 < n; s2++) {
        var a = s2 / n * M.TAU + d.orbA;
        bossShot(b.x + Math.cos(a) * d.radius, b.y + Math.sin(a) * d.radius,
          Math.cos(a) * 260, Math.sin(a) * 260, 7, ECH_COL, SHOTOPT);
      }
      sfx('shot', b.x, b.y, 0.6);
    }
  }

  /* ================================================================ 17 ====
   * THE HORIZON — a violet gravity bar laid across the arena. Signed-distance
   * gravity pulls everything toward it from both sides and the bar itself is
   * solid, so for one fight the game is a platformer: your dash is your jump.
   * The anchors at its ends can only be hurt while you are standing on the
   * bar. Phase 2 tilts it. Phase 3 splits it into two bars with zero-g in the
   * gap. Death snaps the bar and launches everything stacked on it. */

  var HOR_COL = [0.55, 0.30, 1.0];
  var BAR_T = 22, BAR_G = 1150;

  /* Perpendicular signed distance to bar k, and whether we are over it. */
  var BARQ = { d: 0, nx: 0, ny: 0, on: false };
  function barQuery(d, k, x, y) {
    var ang = d.ang, cs = Math.cos(ang), sn = Math.sin(ang);
    var ox = -sn * d.off[k], oy = cs * d.off[k];
    var px = x - (Ar.cx + ox), py = y - (Ar.cy + oy);
    var along = px * cs + py * sn;
    var perp = -px * sn + py * cs;
    BARQ.d = perp;
    BARQ.nx = -sn; BARQ.ny = cs;
    BARQ.on = Math.abs(along) < d.half;
    return BARQ;
  }

  B.define('horizon', {
    name: 'Horizon', color: HOR_COL, hp: 720,
    introTime: 2.0, camZoom: 0.66,

    intro: function (b, t) {
      markSeen('horizon');
      var k = M.clamp01(t / 2.0);
      var R = NA.R;
      var half = Ar.radius * 0.82 * k;
      R.line(R.L.MEMBRANE, Ar.cx - half, Ar.cy, Ar.cx + half, Ar.cy, 4 + 14 * k,
        HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.85);
      // the pull, drawn as falling ticks from both sides
      for (var i = 0; i < 8; i++) {
        var x = Ar.cx - half + (i / 7) * half * 2;
        var f = ((NA.Time.t * 0.9 + i * 0.13) % 1);
        R.line(R.L.FLOOR, x, Ar.cy - 340 * (1 - f), x, Ar.cy - 340 * (1 - f) + 30, 2,
          HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.4 * k);
        R.line(R.L.FLOOR, x, Ar.cy + 340 * (1 - f), x, Ar.cy + 340 * (1 - f) - 30, 2,
          HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.4 * k);
      }
      return introCommon(b, t, function (bb, x, y, kk) {
        NA.R.poly(NA.R.L.ENEMIES, Ar.cx - half, Ar.cy, 30 * kk, 4, 0.78, 4,
          HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.9);
        NA.R.poly(NA.R.L.ENEMIES, Ar.cx + half, Ar.cy, 30 * kk, 4, 0.78, 4,
          HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.9);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.ang = 0; d.tilt = 0; d.half = Ar.radius * 0.82;
        d.nBar = 1; d.off = new Float32Array(2); d.off[0] = 0; d.off[1] = 0;
        d.anchorR = 34; d.shotT = 2.4; d.spawnT = 2;
        d.radius = 40;
        b.x = Ar.cx; b.y = Ar.cy;
      }
      if (i === 1) { d.tilt = 1; }
      if (i === 2) {
        d.nBar = 2; d.off[0] = -230; d.off[1] = 230;
        NA.FX.trauma(0.5);
        sfx('bossPhase');
      }
    },

    /* The anchors are the boss, and you can only reach them from the bar. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      var onBar = false;
      for (var k = 0; k < d.nBar; k++) {
        var q = barQuery(d, k, Pl.x, Pl.y);
        if (q.on && Math.abs(q.d) < 70) { onBar = true; break; }
      }
      var hit = false;
      for (var k2 = 0; k2 < d.nBar; k2++) {
        for (var s = -1; s <= 1; s += 2) {
          var ax = anchorX(d, k2, s), ay = anchorY(d, k2, s);
          var dx = ax - x, dy = ay - y, rr = d.anchorR + r + 6;
          if (dx * dx + dy * dy < rr * rr) { hit = true; break; }
        }
        if (hit) break;
      }
      if (!hit) return 0;
      if (!onBar) { absorbFx(x, y, HOR_COL[0], HOR_COL[1], HOR_COL[2]); return 2; }
      return 1;
    },

    phases: [
      { minDuration: 13, update: function (b, dt) { horTick(b, dt, 0); } },
      { minDuration: 14, update: function (b, dt) { horTick(b, dt, 1); } },
      { minDuration: 15, update: function (b, dt) { horTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      // the bar snaps: everything stacked on it goes skyward
      for (var k = 0; k < d.nBar; k++) {
        for (var e = 0; e < En.n; e++) {
          var q = barQuery(d, k, En.x[e], En.y[e]);
          if (!q.on || Math.abs(q.d) > 120) continue;
          var s = q.d >= 0 ? 1 : -1;
          En.vx[e] += q.nx * s * 2200; En.vy[e] += q.ny * s * 2200;
        }
        var cs = Math.cos(d.ang), sn = Math.sin(d.ang);
        var ox = -sn * d.off[k], oy = cs * d.off[k];
        NA.Particles.ring(Ar.cx + ox, Ar.cy + oy, 20, 700, 0.8, 6,
          HOR_COL[0], HOR_COL[1], HOR_COL[2], 1);
        for (var f = 0; f < 14; f++) {
          var t2 = (f / 13 - 0.5) * 2 * d.half;
          NA.Particles.frag(Ar.cx + ox + cs * t2, Ar.cy + oy + sn * t2,
            -sn * NA.RNG.range(-500, 500), cs * NA.RNG.range(-500, 500),
            d.ang, 40, 1.1, HOR_COL[0], HOR_COL[1], HOR_COL[2]);
        }
      }
      NA.FX.trauma(0.9); NA.FX.chroma(3, 500);
      sfx('rail');
    },
    onEnd: function () { cleanEnd(); },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.off) return;
      var cs = Math.cos(d.ang), sn = Math.sin(d.ang);
      for (var k = 0; k < d.nBar; k++) {
        var ox = -sn * d.off[k], oy = cs * d.off[k];
        var x0 = Ar.cx + ox - cs * d.half, y0 = Ar.cy + oy - sn * d.half;
        var x1 = Ar.cx + ox + cs * d.half, y1 = Ar.cy + oy + sn * d.half;
        R.line(L.MEMBRANE, x0, y0, x1, y1, BAR_T, HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.85);
        R.line(L.MEMBRANE, x0, y0, x1, y1, 4, 1, 1, 1, 0.5);
        // the field: ticks falling toward the bar from both sides
        for (var i = 0; i < 12; i++) {
          var f = i / 11;
          var bx = M.lerp(x0, x1, f), by = M.lerp(y0, y1, f);
          var ph = ((NA.Time.t * 1.1 + i * 0.17) % 1);
          var dist = 300 * (1 - ph);
          R.line(L.FLOOR, bx - sn * dist, by + cs * dist, bx - sn * (dist - 26), by + cs * (dist - 26),
            2, HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.28 * ph);
          R.line(L.FLOOR, bx + sn * dist, by - cs * dist, bx + sn * (dist - 26), by - cs * (dist - 26),
            2, HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.28 * ph);
        }
        // the anchors
        for (var s = -1; s <= 1; s += 2) {
          var ax = anchorX(d, k, s), ay = anchorY(d, k, s);
          var f2 = b.flash > 0 ? 1 : 0;
          R.poly(L.ENEMIES, ax, ay, d.anchorR, 4, d.ang + 0.78, 5,
            f2 ? 1 : HOR_COL[0], f2 ? 1 : HOR_COL[1], f2 ? 1 : HOR_COL[2], 0.95);
          R.dot(L.ENEMIES, ax, ay, 8, 1, 1, 1, 0.85);
          R.light(ax, ay, 240, 0.45);
        }
      }
      if (d.nBar > 1) {
        // the zero-g gap between the two bars
        var gx = Ar.cx, gy = Ar.cy;
        R.disc(L.FLOOR, gx, gy, 200, HOR_COL[0], HOR_COL[1], HOR_COL[2], 0.04);
      }
      // "you are on the bar" tell: the anchors light gold when they can be hurt
      var on = false;
      for (var q2 = 0; q2 < d.nBar; q2++) {
        var qq = barQuery(d, q2, Pl.x, Pl.y);
        if (qq.on && Math.abs(qq.d) < 70) { on = true; break; }
      }
      if (on) for (var k3 = 0; k3 < d.nBar; k3++) for (var s3 = -1; s3 <= 1; s3 += 2)
        R.ring(L.ENEMIES, anchorX(d, k3, s3), anchorY(d, k3, s3), d.anchorR + 12, 2.5,
          COL.gold[0], COL.gold[1], COL.gold[2], 0.7 + 0.25 * Math.sin(NA.Time.t * 6));
    }
  });

  function anchorX(d, k, s) {
    var cs = Math.cos(d.ang), sn = Math.sin(d.ang);
    return Ar.cx - sn * d.off[k] + cs * d.half * s;
  }
  function anchorY(d, k, s) {
    var cs = Math.cos(d.ang), sn = Math.sin(d.ang);
    return Ar.cy + cs * d.off[k] + sn * d.half * s;
  }

  function horTick(b, dt, mode) {
    var d = b.data;
    if (d.tilt) d.ang = Math.sin(NA.Time.t * 0.16) * 0.85;
    b.x = Ar.cx; b.y = Ar.cy;

    /* ---- gravity toward the nearest bar, from both sides ---- */
    var gapFree = false;
    if (Pl.alive && Pl.dashT <= 0) {
      var best = 1e9, bnx = 0, bny = 0, bd = 0, bon = false;
      for (var k = 0; k < d.nBar; k++) {
        var q = barQuery(d, k, Pl.x, Pl.y);
        if (Math.abs(q.d) < best) { best = Math.abs(q.d); bnx = q.nx; bny = q.ny; bd = q.d; bon = q.on; }
      }
      if (d.nBar > 1) {
        // between the bars is zero-g: you float, and that is the safe lane
        var qa = barQuery(d, 0, Pl.x, Pl.y), da = qa.d;
        var qb = barQuery(d, 1, Pl.x, Pl.y), db = qb.d;
        if (da > 0 && db < 0) gapFree = true;
      }
      if (!gapFree && bon) {
        var s = bd >= 0 ? 1 : -1;
        Pl.vx -= bnx * s * BAR_G * dt;
        Pl.vy -= bny * s * BAR_G * dt;
      }
    }
    // the bar is solid: land on it
    for (var k2 = 0; k2 < d.nBar; k2++) {
      var q2 = barQuery(d, k2, Pl.x, Pl.y);
      if (!q2.on) continue;
      var lim = BAR_T * 0.5 + C.SHIP_R;
      if (Math.abs(q2.d) < lim && Pl.alive) {
        var sg = q2.d >= 0 ? 1 : -1;
        var push = lim - Math.abs(q2.d);
        Pl.x += q2.nx * sg * push; Pl.y += q2.ny * sg * push;
        var vn = Pl.vx * q2.nx + Pl.vy * q2.ny;
        if (vn * sg < 0) { Pl.vx -= vn * q2.nx; Pl.vy -= vn * q2.ny; }
      }
    }
    // enemies ride it too, and stack up on the surface
    for (var e = 0; e < En.n; e++) {
      var bestE = 1e9, ex = 0, ey = 0, ed = 0, eon = false;
      for (var k3 = 0; k3 < d.nBar; k3++) {
        var q3 = barQuery(d, k3, En.x[e], En.y[e]);
        if (Math.abs(q3.d) < bestE) { bestE = Math.abs(q3.d); ex = q3.nx; ey = q3.ny; ed = q3.d; eon = q3.on; }
      }
      if (!eon) continue;
      var se = ed >= 0 ? 1 : -1;
      En.vy[e] -= ey * se * BAR_G * 0.6 * dt;
      En.vx[e] -= ex * se * BAR_G * 0.6 * dt;
      var limE = BAR_T * 0.5 + En.size[e];
      if (Math.abs(ed) < limE) {
        var pe = limE - Math.abs(ed);
        En.x[e] += ex * se * pe; En.y[e] += ey * se * pe;
      }
    }
    // and the bar bends light: projectiles curve toward it, gently
    var E = Bu.E;
    for (var q4 = 0; q4 < E.n; q4++) {
      var bq = barQuery(d, 0, E.x[q4], E.y[q4]);
      if (!bq.on) continue;
      var sq = bq.d >= 0 ? 1 : -1;
      E.vx[q4] -= bq.nx * sq * 180 * dt;
      E.vy[q4] -= bq.ny * sq * 180 * dt;
    }

    /* ---- the anchors fire along the bar: a telegraphed sweep ---- */
    d.shotT -= dt;
    if (d.shotT <= 0) {
      d.shotT = mode === 0 ? 2.6 : 2.0;
      var cs = Math.cos(d.ang), sn = Math.sin(d.ang);
      SHOTOPT.life = 6; SHOTOPT.owner = 1; SHOTOPT.homing = 0; SHOTOPT.bounce = 0;
      SHOTOPT.flags = 0; SHOTOPT.a = 1;
      for (var k4 = 0; k4 < d.nBar; k4++) {
        for (var s4 = -1; s4 <= 1; s4 += 2) {
          var ax = anchorX(d, k4, s4), ay = anchorY(d, k4, s4);
          for (var j = -1; j <= 1; j++) {
            var jj = j * 0.22;
            var dx = -cs * s4, dy = -sn * s4;
            var ca = Math.atan2(dy, dx) + jj;
            bossShot(ax, ay, Math.cos(ca) * 330, Math.sin(ca) * 330, 8, HOR_COL, SHOTOPT);
          }
        }
      }
      sfx('shot', Ar.cx, Ar.cy, 0.7);
    }

    // a light crowd so the launch on death has something to launch
    d.spawnT -= dt;
    if (d.spawnT <= 0 && En.n < 34) {
      d.spawnT = 1.6;
      var sa = NA.RNG.f() * M.TAU, sr = Ar.radiusAt(sa) - 50;
      spawnMinion('mote', 'moteling', Ar.cx + Math.cos(sa) * sr, Ar.cy + Math.sin(sa) * sr);
    }
  }

  /* ================================================================ 18 ====
   * THE SUPERNOVA — the Act III boss (phases 1–2 here; the Act V agent reuses
   * this module for the "Heat Death" duo and the finale). A white-gold disc at
   * the centre that only ever grows and pulls everything toward it, player
   * bullets included. Rotating sunspots on its limb are the weak points and
   * shrink it. Solar flares lash along telegraphed filaments and double the
   * pull inside them. Enemies that fall in feed it.
   *
   * Exported as NA.Bosses.shared.supernova:
   *   create(opts) -> s        update(s, dt)      render(s)
   *   hitTest(s, x, y, r)      -> 0 miss | 1 sunspot hit | 2 absorbed
   *   shrink(s, amount)        pull(s, dt)        detonate(s)
   */

  var SUN_COL = [1.0, 0.92, 0.66];
  var SUN_HOT = [1.0, 0.78, 0.25];
  var NSPOT = 4, NFLARE = 3;

  var Sun = shared.supernova = {
    create: function (o) {
      o = o || {};
      var s = {
        x: o.x === undefined ? Ar.cx : o.x,
        y: o.y === undefined ? Ar.cy : o.y,
        r: o.r || 150,
        rMax: o.rMax || Ar.radius * 0.8,
        grow: o.grow || 15,
        pull: o.pull || 520,
        spotA: 0, spotW: o.spotW || 0.5,
        spotHp: new Float32Array(NSPOT),
        spotR: 26,
        flareA: new Float32Array(NFLARE),
        flareT: new Float32Array(NFLARE),      // -1 idle, else seconds since start
        flareOn: 0,
        /* phase 3 (wave 18+): the sunspots must be shot in sequence.  seq < 0
         * means "every spot is a weak point", which is how phases 1-2 and the
         * Heat Death duo use the module. */
        seq: -1, seqT: 0, seqIdle: 0, seqLap: 0,
        eaten: 0, t: 0
      };
      for (var i = 0; i < NFLARE; i++) s.flareT[i] = -1;   // idle, not "just started"
      for (var k = 0; k < NSPOT; k++) s.spotHp[k] = 1;
      return s;
    },

    reset: function (s) {
      for (var i = 0; i < NFLARE; i++) s.flareT[i] = -1;
      for (var k = 0; k < NSPOT; k++) s.spotHp[k] = 1;
      s.eaten = 0; s.t = 0;
      s.seq = -1; s.seqT = 0; s.seqIdle = 0; s.seqLap = 0;
    },

    /* Arm the sequence lock: only one sunspot at a time is a weak point, and
     * each hit walks the lock around the limb.  Purely additive -- it never
     * takes anything back; a sealed spot simply is not a weak point yet. */
    armSequence: function (s) {
      s.seq = 0; s.seqT = 0; s.seqIdle = 0; s.seqLap = 0;
    },

    /* Fire a flare along one filament bearing (phase 3's lapse lash).  It runs
     * through the same 0.95 s telegraphLine as every other flare. */
    lash: function (s, ang) {
      for (var q = 0; q < NFLARE; q++) {
        if (s.flareT[q] >= 0) continue;
        s.flareA[q] = ang; s.flareT[q] = 0.0001;
        sfx('supernovaCharge', s.x, s.y);
        return true;
      }
      return false;
    },

    shrink: function (s, amount) {
      s.r = Math.max(70, s.r - amount);
      NA.Particles.ring(s.x, s.y, s.r, s.r * 0.7, 0.3, 4, SUN_HOT[0], SUN_HOT[1], SUN_HOT[2], 0.9);
    },

    /* Everything is pulled: the player, the crowd, and every projectile in
     * the arena, yours included. Inside an active flare the pull doubles. */
    pull: function (s, dt) {
      var range = s.r * 3.2, r2 = range * range;
      var i, dx, dy, d2, dd, k;
      if (Pl.alive) {
        dx = s.x - Pl.x; dy = s.y - Pl.y; d2 = dx * dx + dy * dy;
        if (d2 < r2 && d2 > 1) {
          dd = Math.sqrt(d2);
          k = (1 - dd / range) * Sun.flareMul(s, Pl.x, Pl.y);
          Pl.vx += dx / dd * s.pull * k * dt;
          Pl.vy += dy / dd * s.pull * k * dt;
        }
      }
      for (i = 0; i < En.n; i++) {
        dx = s.x - En.x[i]; dy = s.y - En.y[i]; d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 < s.r * s.r) {                     // it eats what falls in, and grows
          En.kill(i, false); i--;
          s.r = Math.min(s.rMax, s.r + 5); s.eaten++;
          NA.Particles.burst(s.x, s.y, 3, 240, 0.25, SUN_HOT[0], SUN_HOT[1], SUN_HOT[2], 0);
          continue;
        }
        dd = Math.sqrt(d2) || 1;
        k = (1 - dd / range);
        En.vx[i] += dx / dd * s.pull * 1.3 * k * dt;
        En.vy[i] += dy / dd * s.pull * 1.3 * k * dt;
      }
      var pools = 2;
      for (var p = 0; p < pools; p++) {
        var pool = p === 0 ? Bu.P : Bu.E;
        for (i = 0; i < pool.n; i++) {
          dx = s.x - pool.x[i]; dy = s.y - pool.y[i]; d2 = dx * dx + dy * dy;
          if (d2 > r2 || d2 < 1) continue;
          dd = Math.sqrt(d2);
          k = (1 - dd / range) * Sun.flareMul(s, pool.x[i], pool.y[i]);
          pool.vx[i] += dx / dd * s.pull * 0.8 * k * dt;
          pool.vy[i] += dy / dd * s.pull * 0.8 * k * dt;
          pool.rot[i] = Math.atan2(pool.vy[i], pool.vx[i]);
        }
      }
    },

    /* 2 inside a live flare filament, 1 elsewhere. */
    flareMul: function (s, x, y) {
      if (!s.flareOn) return 1;
      var ang = Math.atan2(y - s.y, x - s.x);
      for (var i = 0; i < NFLARE; i++) {
        if (s.flareT[i] < 0.95) continue;
        if (Math.abs(M.norm(ang - s.flareA[i])) < 0.22) return 2;
      }
      return 1;
    },

    update: function (s, dt, opt) {
      s.t += dt;
      if (s.seq >= 0) { s.seqT += dt; s.seqIdle += dt; }
      s.r = Math.min(s.rMax, s.r + s.grow * dt);
      s.spotA += s.spotW * dt;
      Sun.pull(s, dt);

      // the disc burns whatever is standing in it
      if (Pl.alive && M.dist2(Pl.x, Pl.y, s.x, s.y) < s.r * s.r) Pl.damage(1, s.x, s.y);

      if (opt && opt.flares) {
        s.flareOn = 1;
        var live = 0;
        for (var i = 0; i < NFLARE; i++) {
          if (s.flareT[i] < 0) continue;
          live++;
          s.flareT[i] += dt;
          var len = s.r * 2.4;
          var ax = s.x + Math.cos(s.flareA[i]) * s.r, ay = s.y + Math.sin(s.flareA[i]) * s.r;
          var bx = s.x + Math.cos(s.flareA[i]) * len, by = s.y + Math.sin(s.flareA[i]) * len;
          if (s.flareT[i] < 0.95) {
            En.telegraphLine(ax, ay, bx, by, s.flareT[i], 0.95, 0.62, 7);
          } else if (s.flareT[i] < 1.55) {
            // the lash: a real, brief, wide beam
            if (Pl.alive && distToSeg2(Pl.x, Pl.y, ax, ay, bx, by) < 46 * 46) Pl.damage(1, ax, ay);
            for (var e = 0; e < En.n; e++)
              if (distToSeg2(En.x[e], En.y[e], ax, ay, bx, by) < 46 * 46) { En.kill(e, false); e--; }
          } else {
            s.flareT[i] = -1;
          }
        }
        if (live < (opt.maxFlares || 2) && (s.nextFlare === undefined || s.t > s.nextFlare)) {
          s.nextFlare = s.t + (opt.period || 2.6);
          for (var q = 0; q < NFLARE; q++) {
            if (s.flareT[q] >= 0) continue;
            s.flareA[q] = Math.atan2(Pl.y - s.y, Pl.x - s.x) + NA.RNG.range(-0.6, 0.6);
            s.flareT[q] = 0.0001;
            sfx('supernovaCharge', s.x, s.y);
            break;
          }
        }
      }
    },

    /* 1 = a sunspot took it (and the disc shrinks), 2 = the surface ate it. */
    hitTest: function (s, x, y, r) {
      var dx = x - s.x, dy = y - s.y;
      var d2 = dx * dx + dy * dy;
      var lim = s.r + r + 8;
      if (d2 > lim * lim) return 0;
      for (var i = 0; i < NSPOT; i++) {
        if (s.seq >= 0 && i !== s.seq) continue;         // sequence lock
        var a = s.spotA + i / NSPOT * M.TAU;
        var sx = s.x + Math.cos(a) * s.r * 0.94, sy = s.y + Math.sin(a) * s.r * 0.94;
        var ex = sx - x, ey = sy - y, rr = s.spotR + r;
        if (ex * ex + ey * ey < rr * rr) {
          if (s.seq >= 0) {
            Sun.shrink(s, 18);
            s.seq = (s.seq + 1) % NSPOT; s.seqT = 0; s.seqIdle = 0;
            if (s.seq === 0) {                           // a full lap of the limb
              s.seqLap++;
              Sun.shrink(s, 60);
              NA.Particles.ring(s.x, s.y, s.r, s.r * 1.9, 0.5, 8, 1, 1, 1, 0.9);
              if (NA.FX && NA.FX.trauma) NA.FX.trauma(0.5);
              sfx('bossPhase', s.x, s.y);
            }
          } else {
            Sun.shrink(s, 14);
          }
          NA.Particles.burst(sx, sy, 5, 220, 0.22, 0.2, 0.35, 0.9, 1);
          return 1;
        }
      }
      absorbFx(x, y, SUN_COL[0], SUN_COL[1], SUN_COL[2]);
      return 2;
    },

    render: function (s) {
      var R = NA.R, L = R.L;
      // the disc: white-gold, hot core, hard rim so the edge is legible
      R.disc(L.ENEMIES, s.x, s.y, s.r * 1.35, SUN_HOT[0], SUN_HOT[1], SUN_HOT[2], 0.22);
      R.polyFill(L.ENEMIES, s.x, s.y, s.r, 8, s.spotA * 0.2, SUN_COL[0], SUN_COL[1], SUN_COL[2], 0.92);
      R.ring(L.ENEMIES, s.x, s.y, s.r, 4, 1, 1, 1, 0.9);
      R.light(s.x, s.y, s.r * 4, 0.9);
      // the pull, as filaments drifting inward
      for (var f = 0; f < 12; f++) {
        var fa = f / 12 * M.TAU + s.t * 0.15;
        var ph = ((s.t * 0.5 + f * 0.083) % 1);
        var r0 = s.r + (s.r * 2.2) * ph;
        R.line(L.FLOOR, s.x + Math.cos(fa) * r0, s.y + Math.sin(fa) * r0,
          s.x + Math.cos(fa) * (r0 - 40), s.y + Math.sin(fa) * (r0 - 40),
          2, SUN_HOT[0], SUN_HOT[1], SUN_HOT[2], 0.30 * (1 - ph));
      }
      // sunspots: the weak points, dark on a bright field.  With the sequence
      // lock armed only the live one wears the gold ring; the rest read sealed.
      for (var i = 0; i < NSPOT; i++) {
        var a = s.spotA + i / NSPOT * M.TAU;
        var sx = s.x + Math.cos(a) * s.r * 0.94, sy = s.y + Math.sin(a) * s.r * 0.94;
        R.disc(L.ENEMIES, sx, sy, s.spotR * 1.5, 0.05, 0.04, 0.10, 0.95);
        if (s.seq < 0 || i === s.seq) {
          R.ring(L.ENEMIES, sx, sy, s.spotR, 3, COL.gold[0], COL.gold[1], COL.gold[2],
            0.75 + 0.25 * Math.sin(s.t * 5 + i));
        } else {
          R.ring(L.ENEMIES, sx, sy, s.spotR * 0.8, 2, SUN_COL[0], SUN_COL[1], SUN_COL[2], 0.28);
        }
        if (s.seq >= 0 && i === s.seq) {
          var ak = M.clamp01(s.seqT / 0.45);              // the lock contracting in
          R.ring(L.VEIL, sx, sy, s.spotR * (2.6 - 1.4 * ak), 2.5,
            COL.gold[0], COL.gold[1], COL.gold[2], 0.35 + 0.5 * (1 - ak));
          var na = s.spotA + ((i + 1) % NSPOT) / NSPOT * M.TAU;
          R.line(L.FLOOR, sx, sy,                          // the next link, faint
            s.x + Math.cos(na) * s.r * 0.94, s.y + Math.sin(na) * s.r * 0.94,
            1.5, COL.gold[0], COL.gold[1], COL.gold[2], 0.18);
        }
      }
      // live flares
      if (s.flareOn) for (var q = 0; q < NFLARE; q++) {
        if (s.flareT[q] < 0.95) continue;
        var len = s.r * 2.4;
        var k = M.clamp01((s.flareT[q] - 0.95) / 0.6);
        R.line(L.VEIL, s.x + Math.cos(s.flareA[q]) * s.r, s.y + Math.sin(s.flareA[q]) * s.r,
          s.x + Math.cos(s.flareA[q]) * len, s.y + Math.sin(s.flareA[q]) * len,
          46 * (1 - k) + 8, 1, 0.85, 0.5, 0.9 * (1 - k * 0.5));
      }
    },

    /* The nova: a white ring past the arena, a page flash, and the arena
     * redrawing itself from the centre outward. */
    detonate: function (s) {
      NA.Particles.ring(s.x, s.y, s.r, Ar.radius * 2.2, 1.4, 12, 1, 1, 1, 1);
      NA.FX.flash(0.5, 500); NA.FX.chroma(3, 800); NA.FX.trauma(1.0);
      fwFlash(700);
      sfx('supernova');
      var t = 0, cx = s.x, cy = s.y;
      persist.push({
        update: function (dt) { t += dt; if (t > 2.2) this.dead = 1; },
        render: function () {
          var R = NA.R, k = M.clamp01(t / 1.6);
          // the white ring leaves the arena behind
          R.ring(R.L.VEIL, cx, cy, 100 + k * Ar.radius * 2.4, 14 * (1 - k) + 2, 1, 1, 1, 1 - k);
          // and the arena is drawn again, from the centre out
          var rr = M.easeOut(k) * Ar.radius;
          R.ring(R.L.MEMBRANE, Ar.cx, Ar.cy, rr, 3, COL.player[0], COL.player[1], COL.player[2], 0.8 * (1 - k * 0.4));
          for (var i = 0; i < 24; i++) {
            var a = i / 24 * M.TAU;
            R.dot(R.L.MEMBRANE, Ar.cx + Math.cos(a) * rr, Ar.cy + Math.sin(a) * rr, 3,
              1, 1, 1, 0.5 * (1 - k));
          }
        }
      });
    }
  };

  B.define('supernova', {
    name: 'Supernova', color: SUN_COL, hp: 780,
    introTime: 2.2, camZoom: 0.6,

    intro: function (b, t) {
      markSeen('supernova');
      var d = b.data;
      if (!d.s) { d.s = Sun.create({ r: 120, grow: 0 }); Sun.reset(d.s); }
      var k = M.clamp01(t / 2.2);
      d.s.r = 40 + 90 * k;
      Sun.render(d.s);
      return introCommon(b, t, null);
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        if (!d.s) d.s = Sun.create({ r: 130 });
        Sun.reset(d.s);
        d.s.x = Ar.cx; d.s.y = Ar.cy;
        d.s.r = 150; d.s.grow = 13; d.s.rMax = Ar.radius * 0.72;
        d.flares = 0; d.spawnT = 2; d.radius = 150;
        b.x = Ar.cx; b.y = Ar.cy;
      }
      if (i === 1) {
        d.flares = 1; d.s.grow = 19; d.s.spotW = 0.85; d.s.pull = 640;
        sfx('bossPhase');
      }
      if (i === 2) {
        d.flares = 1; d.s.grow = 24; d.s.spotW = 1.15; d.s.pull = 720;
        d.s.rMax = Ar.radius * 0.92;                 // it has nearly swallowed it
        Sun.armSequence(d.s);
        d.lashT = SEQ_LIMIT;
        sfx('bossPhase');
        if (NA.FX && NA.FX.trauma) NA.FX.trauma(0.6);
      }
    },

    hitTest: function (b, x, y, r) { return Sun.hitTest(b.data.s, x, y, r); },

    phases: [
      { /* 1 — it only grows; the sunspots are the only way back */
        minDuration: 14,
        update: function (b, dt) { sunTick(b, dt, 0); }
      },
      { /* 2 — solar flares along the filaments, double pull inside them */
        minDuration: 16,
        update: function (b, dt) { sunTick(b, dt, 1); }
      },
      { /* 3 — the disc has nearly swallowed the arena.  One sunspot is live
         *     at a time and they must be taken in sequence, while three flares
         *     lash along the filaments, each on its own 0.95 s telegraph. */
        minDuration: 16,
        update: function (b, dt) { sunTick(b, dt, 2); }
      }
    ],

    onDeath: function (b) { Sun.detonate(b.data.s); },
    onEnd: function () { cleanEnd(); },
    render: function (b) { if (b.data.s && b.state === 'fight') Sun.render(b.data.s); }
  });

  var SUNOPT = { flares: 0, maxFlares: 2, period: 2.6 };
  var SEQ_LIMIT = 7;                       // seconds of patience before it lashes
  function sunTick(b, dt, mode) {
    var d = b.data;
    SUNOPT.flares = d.flares;
    SUNOPT.maxFlares = mode === 0 ? 0 : (mode === 2 ? 3 : 2);
    SUNOPT.period = mode === 2 ? 2.0 : 2.6;
    Sun.update(d.s, dt, SUNOPT);
    d.radius = d.s.r;

    /* Phase 3: sit on the lock too long and the sun lashes a flare out along
     * that filament -- telegraphed like every flare, and the sequence itself is
     * never rolled back. */
    if (mode === 2) {
      d.lashT -= dt;
      if (d.lashT <= 0) {
        d.lashT = SEQ_LIMIT * 0.55;
        Sun.lash(d.s, d.s.spotA + d.s.seq / 4 * M.TAU);
      }
      if (d.s.seqIdle < 0.05) d.lashT = SEQ_LIMIT;        // a hit renews its patience
    }
    // a steady trickle of fuel, so the disc's growth is also your problem
    d.spawnT -= dt;
    if (d.spawnT <= 0 && En.n < 30) {
      d.spawnT = 1.9;
      var sa = NA.RNG.f() * M.TAU, sr = Ar.radiusAt(sa) - 40;
      spawnMinion('mote', 'moteling', Ar.cx + Math.cos(sa) * sr, Ar.cy + Math.sin(sa) * sr);
    }
  }

  /* ================================================================ 19 ====
   * THE DIMMER — the page itself goes dark. Your muzzle flashes are the only
   * light in the world, and the eye is only hittable while one of them is
   * burning; it moves only when nothing is looking at it. Its anti-light
   * projectiles are invisible until a flash falls on them. On death every shot
   * you fired in the fight replays as light at once, and the world
   * oversaturates.
   *
   * Fourth-wall calls: dimPage(amount01) each phase (and dimPage(0) at the
   * end), viewportArena(true) when the helper offers it. The canvas fallback
   * is NA.FX.darkness + NA.R.light stamps, so the fight is identical without
   * the helper — only the browser chrome stays bright. */

  var DIM_COL = [0.42, 0.36, 0.62];
  var EYE_COL = [1.0, 0.72, 0.30];
  var LIGHTS = 32, SHOTLOG = 300;

  function dimStamp(d, x, y) {
    var i = d.lHead;
    d.lx[i] = x; d.ly[i] = y; d.lt[i] = 0;
    d.lHead = (d.lHead + 1) % LIGHTS;
    if (d.lN < LIGHTS) d.lN++;
    var j = d.sHead;
    d.sx[j] = x; d.sy[j] = y;
    d.sHead = (d.sHead + 1) % SHOTLOG;
    if (d.sN < SHOTLOG) d.sN++;
  }

  /* Is (x,y) lit right now? A fresh muzzle flash or a recent light stamp. */
  function dimLit(d, x, y, rad) {
    if (Pl.muzzle > 0 && M.dist2(x, y, Pl.x, Pl.y) < 620 * 620) return 1;
    for (var i = 0; i < d.lN; i++) {
      if (d.lt[i] > 0.4) continue;
      var dx = d.lx[i] - x, dy = d.ly[i] - y;
      if (dx * dx + dy * dy < rad * rad) return 1;
    }
    return 0;
  }

  B.define('dimmer', {
    name: 'Dimmer', color: DIM_COL, hp: 660,
    introTime: 2.0, camZoom: 0.85,

    intro: function (b, t) {
      markSeen('dimmer');
      var k = M.clamp01(t / 2.0);
      NA.FX.darkness(0.55 * k, 0);
      fwDim(0.35 * k);
      return introCommon(b, t, function (bb, x, y, kk) {
        // the eye opens: a slit, then a lens
        var R = NA.R;
        R.arc(R.L.ENEMIES, x, y, 40, -0.9 * kk, 0.9 * kk, 5, EYE_COL[0], EYE_COL[1], EYE_COL[2], 0.9);
        R.arc(R.L.ENEMIES, x, y, 40, Math.PI - 0.9 * kk, Math.PI + 0.9 * kk, 5,
          EYE_COL[0], EYE_COL[1], EYE_COL[2], 0.9);
        R.dot(R.L.ENEMIES, x, y, 10 * kk, EYE_COL[0], EYE_COL[1], EYE_COL[2], 1);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        d.lx = new Float32Array(LIGHTS); d.ly = new Float32Array(LIGHTS);
        d.lt = new Float32Array(LIGHTS); d.lHead = 0; d.lN = 0;
        d.sx = new Float32Array(SHOTLOG); d.sy = new Float32Array(SHOTLOG);
        d.sHead = 0; d.sN = 0;
        d.radius = 46; d.wasMuzzle = 0; d.shotT = 1.6;
        d.tx = Ar.cx; d.ty = Ar.cy - 300;
        d.dim = 0.55; d.lit = 0;
        b.x = Ar.cx; b.y = Ar.cy - 300;
        if (fwFn('viewportArena')) fwCall('viewportArena', true);
      }
      if (i === 1) { d.dim = 0.70; }
      if (i === 2) { d.dim = 0.82; sfx('bossPhase'); }
      fwDim(d.dim * 0.6);
    },

    /* Hittable only while lit. In the dark the shot goes straight through it. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      var dx = b.x - x, dy = b.y - y, rr = d.radius + r;
      if (dx * dx + dy * dy > rr * rr) return 0;
      if (!d.lit) { absorbFx(x, y, DIM_COL[0], DIM_COL[1], DIM_COL[2]); return 2; }
      return 1;
    },

    phases: [
      { minDuration: 12, update: function (b, dt) { dimTick(b, dt, 0); } },
      { minDuration: 13, update: function (b, dt) { dimTick(b, dt, 1); } },
      { minDuration: 14, update: function (b, dt) { dimTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      // every shot of the fight replays as light, at once, and then the world
      // oversaturates
      var t = 0, n = Math.min(d.sN, SHOTLOG);
      var sx = d.sx, sy = d.sy;
      NA.FX.chroma(3, 700);
      persist.push({
        update: function (dt) {
          t += dt;
          if (t > 2.4) { this.dead = 1; NA.FX.darkness(0, 0); fwDim(0); }
          if (t > 1.1 && !this.pop) {
            this.pop = 1;
            NA.FX.flash(0.5, 400); NA.FX.desat(-0.6, 900); NA.FX.hue(0.35, 900);
            fwFlash(500);
            sfx('supernova');
          }
          NA.FX.darkness(Math.max(0, 0.8 - t * 0.9), 0);
          fwDim(Math.max(0, 0.5 - t * 0.6));
        },
        render: function () {
          var k = M.clamp01(t / 1.1);
          var lim = Math.floor(n * k);
          for (var i = 0; i < lim; i++) {
            var age = k - i / Math.max(1, n);
            var a = M.clamp01(1 - age * 1.6);
            NA.R.dot(NA.R.L.PBULLETS, sx[i], sy[i], 5, 1, 1, 1, 0.5 * a);
            if ((i & 3) === 0) NA.R.light(sx[i], sy[i], 180, 0.5 * a);
          }
        }
      });
      NA.Particles.ring(b.x, b.y, 20, 560, 0.9, 6, EYE_COL[0], EYE_COL[1], EYE_COL[2], 1);
    },
    onEnd: function () {
      NA.FX.darkness(0, 0);
      fwDim(0);
      if (fwFn('viewportArena')) fwCall('viewportArena', false);
      cleanEnd();
    },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.lx) return;
      // the light you have made, fading
      for (var i = 0; i < d.lN; i++) {
        var a = 1 - M.clamp01(d.lt[i] / 0.6);
        if (a <= 0) continue;
        R.light(d.lx[i], d.ly[i], 240 * a, 0.7 * a);
        R.disc(L.PBULLETS, d.lx[i], d.ly[i], 90 * a, 0.6, 0.8, 1, 0.06 * a);
      }
      // the eye: a lens with a slit pupil, only really visible when lit
      var vis = d.lit ? 1 : 0.18;
      R.disc(L.ENEMIES, b.x, b.y, d.radius * 1.6, DIM_COL[0], DIM_COL[1], DIM_COL[2], 0.25 * vis);
      R.ring(L.ENEMIES, b.x, b.y, d.radius, 4, EYE_COL[0], EYE_COL[1], EYE_COL[2], 0.9 * vis);
      var pa = Math.atan2(Pl.y - b.y, Pl.x - b.x);
      var px = b.x + Math.cos(pa) * d.radius * 0.35, py = b.y + Math.sin(pa) * d.radius * 0.35;
      R.line(L.ENEMIES, px - Math.cos(pa + M.HALFPI) * 16, py - Math.sin(pa + M.HALFPI) * 16,
        px + Math.cos(pa + M.HALFPI) * 16, py + Math.sin(pa + M.HALFPI) * 16, 6,
        1, 1, 1, 0.9 * vis);
      if (d.lit) {
        R.ring(L.ENEMIES, b.x, b.y, d.radius + 10, 2, COL.gold[0], COL.gold[1], COL.gold[2],
          0.6 + 0.3 * Math.sin(NA.Time.t * 8));
        R.light(b.x, b.y, 200, 0.4);
      }
    }
  });

  function dimTick(b, dt, mode) {
    var d = b.data;
    NA.FX.darkness(d.dim, 0);

    // age the stamps
    for (var i = 0; i < d.lN; i++) d.lt[i] += dt;

    // every shot you fire is a light
    var muz = Pl.muzzle > 0 ? 1 : 0;
    if (muz && !d.wasMuzzle && Pl.alive)
      dimStamp(d, Pl.x + Math.cos(Pl.angle) * 20, Pl.y + Math.sin(Pl.angle) * 20);
    d.wasMuzzle = muz;

    d.lit = dimLit(d, b.x, b.y, 340);

    /* ---- it moves only when unobserved ---- */
    if (!d.lit) {
      if (M.dist2(b.x, b.y, d.tx, d.ty) < 60 * 60 || d.retarget === undefined || b.t > d.retarget) {
        d.retarget = b.t + 2.4;
        var a = NA.RNG.f() * M.TAU, r = NA.RNG.range(0.35, 0.85) * Ar.radius;
        d.tx = Ar.cx + Math.cos(a) * r; d.ty = Ar.cy + Math.sin(a) * r;
      }
      var sp = mode === 2 ? 520 : (mode === 1 ? 400 : 320);
      var dx = d.tx - b.x, dy = d.ty - b.y;
      var dd = Math.sqrt(dx * dx + dy * dy) || 1;
      b.x += dx / dd * sp * dt; b.y += dy / dd * sp * dt;
      if ((NA.Time.frames & 7) === 0)
        NA.Particles.afterImage(b.x, b.y, 0, 20, 0.25, DIM_COL[0], DIM_COL[1], DIM_COL[2], 0.16, 0);
    }

    /* ---- anti-light projectiles: invisible until a flash finds them ---- */
    d.shotT -= dt;
    if (d.shotT <= 0) {
      d.shotT = mode === 0 ? 1.9 : (mode === 1 ? 1.5 : 1.15);
      var n = 5 + mode * 2;
      SHOTOPT.life = 6; SHOTOPT.owner = OWN.DIMMER; SHOTOPT.homing = mode >= 1 ? 0.12 : 0;
      SHOTOPT.bounce = 0; SHOTOPT.flags = FL.ANTILIGHT; SHOTOPT.a = 0.06;
      var base = Math.atan2(Pl.y - b.y, Pl.x - b.x) + (mode === 2 ? b.t : 0);
      for (var s = 0; s < n; s++) {
        var a2 = base + (s - (n - 1) / 2) * (mode === 2 ? M.TAU / n : 0.26);
        bossShot(b.x + Math.cos(a2) * 40, b.y + Math.sin(a2) * 40,
          Math.cos(a2) * 250, Math.sin(a2) * 250, 9, DIM_COL, SHOTOPT);
      }
      sfx('shot', b.x, b.y, 0.45);
    }
    // light them if a flash is on them, dim them again when it passes
    var E = Bu.E;
    for (var q = 0; q < E.n; q++) {
      if (!(E.flags[q] & FL.ANTILIGHT)) continue;
      // lit by a flash, or a bare shimmer within a ship's length or two — the
      // same proximity tell the Shade uses, so nothing is ever unavoidable
      var near = M.dist2(E.x[q], E.y[q], Pl.x, Pl.y) < 240 * 240 ? 0.34 : 0.06;
      E.a[q] = dimLit(d, E.x[q], E.y[q], 300) ? 0.95 : near;
    }
  }

  /* ================================================================ 20 ====
   * THE LURKER IN THE HUD — it hides behind your interface and fires it back
   * at you: the mana arc becomes a gun, the wave pips fall as bombs, the build
   * strip lobs mortars, the HP arc sweeps. You hurt it by shooting the HUD
   * element it is hiding behind, and it relocates the moment you connect.
   * Phase 3 tears the whole HUD off and drags it into the arena. Killing it
   * reattaches everything — with a permanent hairline crack.
   *
   * Fourth-wall calls: hudRects() for the real element rects, hudDetach(id) /
   * hudAttach(id) in phase 3 and on death, dropDigit(x,y) for the falling wave
   * pips. Fallback: four world-space rects projected on the rim, and the boss
   * drops its own digit bombs. */

  var LUR_COL = [1.0, 0.30, 0.80];
  var HUD_IDS = ['mana', 'hp', 'wave', 'build'];
  var MAXBOMB = 10;

  /* The element ids come from the helper's hudRects() when it exists; the
   * geometry is always the boss's own, projected onto the rim. The real HUD
   * arcs ride on the ship — hiding behind those would put the Lurker on top
   * of you and make it unshootable — so the fight uses a big readable copy of
   * your interface pinned around the arena, and phase 3 detaches the real one
   * through the helper so both come loose together. */
  function lurkRects(d) {
    var got = fwCall('hudRects');
    if (got && got.length) {
      for (var i = 0; i < 4; i++) d.rid[i] = (got[i] && got[i].id) || HUD_IDS[i];
    }
    d.nRect = 4;
    var R = Ar.radius;
    lurkSet(d, 0, 'mana', Ar.cx, Ar.cy - R * 0.72, 440, 44);
    lurkSet(d, 1, 'hp', Ar.cx, Ar.cy + R * 0.72, 380, 44);
    lurkSet(d, 2, 'wave', Ar.cx + R * 0.74, Ar.cy, 120, 300);
    lurkSet(d, 3, 'build', Ar.cx - R * 0.74, Ar.cy, 120, 380);
  }
  function lurkSet(d, i, id, x, y, w, h) {
    var o = i * 4;
    d.rid[i] = id; d.rect[o] = x; d.rect[o + 1] = y; d.rect[o + 2] = w; d.rect[o + 3] = h;
  }

  function lurkInRect(d, i, x, y, pad) {
    var o = i * 4;
    return Math.abs(x - d.rect[o]) < d.rect[o + 2] * 0.5 + (pad || 0) &&
      Math.abs(y - d.rect[o + 1]) < d.rect[o + 3] * 0.5 + (pad || 0);
  }

  function lurkMove(d, exclude) {
    var n = d.nRect, k = 0;
    do { k = NA.RNG.int(n); } while (n > 1 && k === exclude);
    d.behind = k;
    d.hideT = 0;
  }

  B.define('lurker', {
    name: 'Lurker', color: LUR_COL, hp: 700,
    introTime: 2.0, camZoom: 0.72,

    intro: function (b, t) {
      markSeen('lurker');
      var d = b.data;
      if (!d.rect) { d.rect = new Float32Array(16); d.rid = ['mana', 'hp', 'wave', 'build']; lurkRects(d); }
      var R = NA.R;
      // the HUD lights up one element at a time: something is back there
      for (var i = 0; i < d.nRect; i++) {
        var o = i * 4;
        var k = M.clamp01(t / 2 * 4 - i);
        R.line(R.L.HUD, d.rect[o] - d.rect[o + 2] * 0.5, d.rect[o + 1] - d.rect[o + 3] * 0.5,
          d.rect[o] + d.rect[o + 2] * 0.5, d.rect[o + 1] - d.rect[o + 3] * 0.5, 2,
          LUR_COL[0], LUR_COL[1], LUR_COL[2], 0.5 * k);
        R.line(R.L.HUD, d.rect[o] - d.rect[o + 2] * 0.5, d.rect[o + 1] + d.rect[o + 3] * 0.5,
          d.rect[o] + d.rect[o + 2] * 0.5, d.rect[o + 1] + d.rect[o + 3] * 0.5, 2,
          LUR_COL[0], LUR_COL[1], LUR_COL[2], 0.5 * k);
      }
      return introCommon(b, t, function (bb, x, y, k) {
        NA.R.poly(NA.R.L.ENEMIES, x, y, 40 * k, 5, NA.Time.t * 0.7, 3,
          LUR_COL[0], LUR_COL[1], LUR_COL[2], 0.5 + 0.4 * k);
      });
    },

    onPhase: function (b, i) {
      var d = b.data;
      if (i === 0) {
        if (!d.rect) { d.rect = new Float32Array(16); d.rid = ['mana', 'hp', 'wave', 'build']; }
        lurkRects(d);
        d.behind = 0; d.hideT = 0; d.hitCd = 0; d.radius = 40;
        d.atkT = 1.4; d.detached = 0;
        d.bx = new Float32Array(MAXBOMB); d.by = new Float32Array(MAXBOMB);
        d.bt = new Float32Array(MAXBOMB); d.bn = 0;
        d.drift = new Float32Array(8);
        b.x = d.rect[0]; b.y = d.rect[1];
      }
      if (i === 1) { d.atkT = 1.0; }
      if (i === 2) {
        // it tears the whole HUD off and drags it into the arena
        d.detached = 1;
        for (var k = 0; k < d.nRect; k++) {
          fwCall('hudDetach', d.rid[k]);
          d.drift[k * 2] = NA.RNG.range(-70, 70);
          d.drift[k * 2 + 1] = NA.RNG.range(-70, 70);
        }
        NA.FX.trauma(0.7); NA.FX.chroma(3, 400);
        sfx('bossPhase');
      }
    },

    /* You hurt it by shooting the element it is hiding behind. */
    hitTest: function (b, x, y, r) {
      var d = b.data;
      if (!d.rect) return 0;
      if (lurkInRect(d, d.behind, x, y, r)) return 1;
      for (var i = 0; i < d.nRect; i++) {
        if (i === d.behind) continue;
        if (lurkInRect(d, i, x, y, r)) { absorbFx(x, y, LUR_COL[0], LUR_COL[1], LUR_COL[2]); return 2; }
      }
      return 0;
    },

    onDamage: function (b) {
      var d = b.data;
      if (d.hitCd > 0) return true;
      d.hitCd = 0.45;                      // it relocates as soon as you connect
      return true;
    },

    phases: [
      { minDuration: 12, update: function (b, dt) { lurkTick(b, dt, 0); } },
      { minDuration: 13, update: function (b, dt) { lurkTick(b, dt, 1); } },
      { minDuration: 14, update: function (b, dt) { lurkTick(b, dt, 2); } }
    ],

    onDeath: function (b) {
      var d = b.data;
      for (var k = 0; k < d.nRect; k++) fwCall('hudAttach', d.rid[k]);
      NA.Particles.ring(b.x, b.y, 20, 520, 0.9, 6, LUR_COL[0], LUR_COL[1], LUR_COL[2], 1);
      NA.FX.chroma(3, 500);
      // the HUD reassembles with a permanent cosmetic crack
      try { NA.Store.records.hudCrack = 1; NA.Store.save(); } catch (e) { }
      var seed = NA.RNG.f() * 100;
      persist.push({
        render: function () {
          if (!Pl.alive) return;
          var R = NA.R, r1 = C.SHIP_R * 2.6;
          for (var i = 0; i < 3; i++) {
            var a0 = seed + i * 2.1, a1 = a0 + 0.5 + (i % 2) * 0.3;
            R.line(R.L.HUD, Pl.x + Math.cos(a0) * r1 * 0.8, Pl.y + Math.sin(a0) * r1 * 0.8,
              Pl.x + Math.cos(a1) * r1 * 1.5, Pl.y + Math.sin(a1) * r1 * 1.5,
              1.1, 1, 1, 1, 0.22);
          }
        }
      });
    },
    onEnd: function (b) {
      var d = b.data;
      if (d.rid) for (var k = 0; k < d.nRect; k++) fwCall('hudAttach', d.rid[k]);
      cleanEnd();
    },

    render: function (b) {
      var R = NA.R, L = R.L, d = b.data;
      if (!d.rect) return;
      for (var i = 0; i < d.nRect; i++) {
        var o = i * 4;
        var x = d.rect[o], y = d.rect[o + 1], w = d.rect[o + 2], h = d.rect[o + 3];
        var behind = (i === d.behind);
        // the element itself, drawn as a frame in the world
        var a = behind ? 0.85 : 0.45;
        var cr = behind ? LUR_COL[0] : COL.player[0];
        var cg = behind ? LUR_COL[1] : COL.player[1];
        var cb = behind ? LUR_COL[2] : COL.player[2];
        R.line(L.HUD, x - w * 0.5, y - h * 0.5, x + w * 0.5, y - h * 0.5, 2.4, cr, cg, cb, a);
        R.line(L.HUD, x - w * 0.5, y + h * 0.5, x + w * 0.5, y + h * 0.5, 2.4, cr, cg, cb, a);
        R.line(L.HUD, x - w * 0.5, y - h * 0.5, x - w * 0.5, y + h * 0.5, 2.4, cr, cg, cb, a);
        R.line(L.HUD, x + w * 0.5, y - h * 0.5, x + w * 0.5, y + h * 0.5, 2.4, cr, cg, cb, a);
        // what the element shows: an arc for mana/hp, pips for wave, chips for build
        var id = d.rid[i];
        if (id === 'mana' || id === 'hp') {
          R.line(L.HUD, x - w * 0.42, y, x + w * 0.42 * (id === 'hp' ? Pl.hp / Pl.maxHp : Pl.mana / Pl.manaMax), y,
            8, id === 'hp' ? 1 : COL.player[0], id === 'hp' ? 0.35 : COL.player[1],
            id === 'hp' ? 0.4 : COL.player[2], 0.5);
        } else if (id === 'wave') {
          for (var p = 0; p < 5; p++)
            R.dot(L.HUD, x, y - h * 0.35 + p * h * 0.18, 5, COL.gold[0], COL.gold[1], COL.gold[2], 0.55);
        } else {
          for (var q = 0; q < 6; q++)
            R.poly(L.HUD, x, y - h * 0.38 + q * h * 0.15, 10, 6, 0, 1.6,
              COL.player[0], COL.player[1], COL.player[2], 0.45);
        }
        if (behind) {
          // the silhouette pressed against the back of the element
          var pu = 0.5 + 0.5 * Math.abs(Math.sin(NA.Time.t * M.TAU * C.TELEGRAPH_HZ));
          R.poly(L.ENEMIES, b.x, b.y, d.radius, 5, NA.Time.t * 0.8, 4,
            LUR_COL[0], LUR_COL[1], LUR_COL[2], 0.35 + 0.3 * pu);
          R.dot(L.ENEMIES, b.x, b.y, 7, 1, 1, 1, 0.7 * pu);
          R.light(b.x, b.y, 200, 0.35);
        }
      }
      // its falling digit bombs
      for (var k = 0; k < d.bn; k++) {
        var kx = d.bx[k], ky = d.by[k];
        R.poly(L.ENEMIES, kx, ky, 14, 4, NA.Time.t * 3, 3, COL.gold[0], COL.gold[1], COL.gold[2], 0.9);
        R.dot(L.ENEMIES, kx, ky, 4, 1, 1, 1, 0.8);
      }
    }
  });

  function lurkTick(b, dt, mode) {
    var d = b.data;
    if (!d.detached) lurkRects(d);          // the projected rects follow the rim

    if (d.detached) {
      // the HUD floats loose in the arena and drags its elements around
      for (var i = 0; i < d.nRect; i++) {
        var o = i * 4;
        d.rect[o] += d.drift[i * 2] * dt;
        d.rect[o + 1] += d.drift[i * 2 + 1] * dt;
        var dd = M.dist(d.rect[o], d.rect[o + 1], Ar.cx, Ar.cy);
        var lim = Ar.radius * 0.8;
        if (dd > lim) {
          var a = Math.atan2(d.rect[o + 1] - Ar.cy, d.rect[o] - Ar.cx);
          d.rect[o] = Ar.cx + Math.cos(a) * lim; d.rect[o + 1] = Ar.cy + Math.sin(a) * lim;
          d.drift[i * 2] *= -1; d.drift[i * 2 + 1] *= -1;
        }
      }
    }

    // it sits behind one element, and slides to the next when you find it
    var ob = d.behind * 4;
    b.x = M.smooth(b.x, d.rect[ob], 6, dt);
    b.y = M.smooth(b.y, d.rect[ob + 1], 6, dt);
    if (d.hitCd > 0) {
      d.hitCd -= dt;
      if (d.hitCd <= 0) {
        lurkMove(d, d.behind);
        NA.Particles.burst(b.x, b.y, 6, 260, 0.25, LUR_COL[0], LUR_COL[1], LUR_COL[2], 1);
        sfx('uiTick', b.x, b.y);
      }
    }
    d.hideT += dt;
    if (d.hideT > (mode === 0 ? 7 : 5)) lurkMove(d, d.behind);

    /* ---- it weaponizes whatever it is hiding behind ---- */
    d.atkT -= dt;
    if (d.atkT <= 0) {
      d.atkT = mode === 0 ? 1.9 : (mode === 1 ? 1.5 : 1.2);
      var id = d.rid[d.behind];
      var ox = d.rect[ob], oy = d.rect[ob + 1];
      SHOTOPT.life = 6; SHOTOPT.owner = OWN.LURKER; SHOTOPT.homing = 0;
      SHOTOPT.bounce = 0; SHOTOPT.flags = 0; SHOTOPT.a = 1;
      if (id === 'mana') {
        // the mana arc fires bolts
        var base = Math.atan2(Pl.y - oy, Pl.x - ox);
        for (var s = 0; s < 5; s++) {
          var a2 = base + (s - 2) * 0.16;
          bossShot(ox, oy, Math.cos(a2) * 380, Math.sin(a2) * 380, 8, COL.player, SHOTOPT);
        }
        sfx('spendActive', ox, oy);
      } else if (id === 'wave') {
        // the wave pips fall as bombs
        for (var q = 0; q < 3 && d.bn < MAXBOMB; q++) {
          var bx = Pl.x + NA.RNG.range(-260, 260), by = Pl.y + NA.RNG.range(-260, 260);
          d.bx[d.bn] = bx; d.by[d.bn] = by; d.bt[d.bn] = 0; d.bn++;
          fwCall('dropDigit', bx, by);
        }
        sfx('telegraph', Pl.x, Pl.y);
      } else if (id === 'build') {
        // the build strip mortars you
        d.morX = Pl.x + Pl.vx * 0.5; d.morY = Pl.y + Pl.vy * 0.5; d.morT = 0.0001;
        sfx('charge', ox, oy);
      } else {
        // the HP arc sweeps: a telegraphed line across the arena
        d.sweepA = Math.atan2(Pl.y - oy, Pl.x - ox);
        d.sweepT = 0.0001; d.sweepX = ox; d.sweepY = oy;
        sfx('telegraph', ox, oy);
      }
    }

    // bombs: each falls with its own telegraph circle, then bursts
    for (var k = 0; k < d.bn; k++) {
      d.bt[k] += dt;
      En.telegraphCircle(d.bx[k], d.by[k], 90, d.bt[k], 1.1, 0.75);
      d.by[k] -= 30 * dt;
      if (d.bt[k] >= 1.1) {
        Bu.explode(d.bx[k], d.by[k], 90, 1, 1);
        d.bx[k] = d.bx[d.bn - 1]; d.by[k] = d.by[d.bn - 1]; d.bt[k] = d.bt[d.bn - 1];
        d.bn--; k--;
      }
    }
    // mortar
    if (d.morT > 0) {
      d.morT += dt;
      En.telegraphCircle(d.morX, d.morY, 130, d.morT, 1.2, 0.8);
      if (d.morT >= 1.2) { d.morT = 0; Bu.explode(d.morX, d.morY, 130, 1, 1); }
    }
    // sweep
    if (d.sweepT > 0) {
      d.sweepT += dt;
      var len = Ar.radius * 2;
      var ex = d.sweepX + Math.cos(d.sweepA) * len, ey = d.sweepY + Math.sin(d.sweepA) * len;
      En.telegraphLine(d.sweepX, d.sweepY, ex, ey, d.sweepT, 1.0, 0.65, 6);
      if (d.sweepT >= 1.0) {
        d.sweepT = 0;
        if (Pl.alive && distToSeg2(Pl.x, Pl.y, d.sweepX, d.sweepY, ex, ey) < 42 * 42)
          Pl.damage(1, d.sweepX, d.sweepY);
        NA.Particles.bolt(d.sweepX, d.sweepY, ex, ey, 0.22, 10, 1, 0.3, 0.4, 4);
        NA.FX.trauma(0.3);
        sfx('laser', d.sweepX, d.sweepY);
      }
    }
  }

})();
