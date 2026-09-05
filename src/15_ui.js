/* 15_ui.js — NA.UI / NA.HUD / NA.Draft
 *
 * Every menu, HUD element, transition, death screen, pause/settings ring and
 * the ending, with ZERO words anywhere. Shapes, colour, motion, icons, sound.
 *
 * PUBLIC API (everything the rest of the game may call)
 * ----------------------------------------------------
 *   NA.HUD.render() / update(dt) / bump()
 *   NA.HUD.rects()                        -> live world-space HUD element table
 *
 *   NA.Draft.open(count) -> bool          false when there is nothing to offer
 *   NA.Draft.close() / pick(i) / skip() / reroll()
 *   NA.Draft.update(dt) / render()
 *   NA.Draft.active / offers / hover / count / bonusCards
 *
 *   NA.UI.tick(realDt)                    real-time UI driver (menus never
 *                                         run at the simulation's time scale)
 *   NA.UI.renderState()                   screen chrome for the current state
 *   NA.UI.renderOverlay()                 the #ui Canvas2D icon pass
 *   NA.UI.post()                          UI contributions to NA.R.setPost
 *   NA.UI.renderTitle() / renderDeath() / renderPause() / renderEnding()
 *   NA.UI.resetGate(x, y) / gate / gate2 / gateEntered() / gate2Entered()
 *   NA.UI.clicked()                       one consumed click
 *   NA.UI.palette(name) -> [r,g,b]        colourblind-aware palette lookup
 *   NA.UI.paletteIndex / setPalette(i)
 *   NA.UI.flashLevel() -> 0..3
 *   NA.UI.markSeen(kind, id)              bestiary bookkeeping
 *   NA.UI.reset()                         full UI reset (restart / death)
 *
 *   NA.UI.fourthWall.*  — AGENT_RULES §9, exact names:
 *     tearDraft() -> Promise            healDraft() -> Promise
 *     dimPage(amount01)                 viewportArena(on) / obstacles()
 *     scrollPage(dy, ms)                pageFlash(ms)
 *     pageCrack(progress01)             hudRects()
 *     hudDetach(id) / hudAttach(id)     dropDigit(x, y)
 *     torn (flag) / reset()
 *   Legacy aliases kept alive: tearDraftPanel(a), fallHUDDigit(n), heal().
 */
(function () {
  'use strict';

  var M = NA.M, C = NA.C, St = NA.Store;

  /* Extra persisted keys. Declared BEFORE NA.Store.load() runs in boot, so
   * load() (which only copies keys it already knows) picks them up. */
  if (St.settings.palette === undefined) St.settings.palette = St.settings.colorblind | 0;
  if (!St.records.hints) St.records.hints = {};
  if (!St.records.seen) St.records.seen = {};

  /* ==================================================================
   * 0. palette — four colourblind-safe remaps of the Void Neon ladder
   * ================================================================== */
  var PAL_NAMES = ['red', 'green', 'orange', 'acid', 'magenta', 'yellow',
    'gold', 'violet', 'player', 'core', 'white'];
  // 0 default · 1 protan · 2 deutan · 3 tritan
  var PALETTES = [
    null,
    { red: [1, 0.42, 0.18], green: [0.36, 0.76, 1], acid: [0.55, 0.86, 1], gold: [1, 0.86, 0.35], magenta: [0.85, 0.45, 1] },
    { red: [1, 0.36, 0.55], green: [0.30, 0.72, 1], acid: [0.42, 0.90, 1], gold: [1, 0.90, 0.42], magenta: [1, 0.40, 0.90] },
    { red: [1, 0.30, 0.30], green: [0.35, 0.95, 0.55], acid: [0.85, 1, 0.35], gold: [1, 0.55, 0.35], magenta: [1, 0.45, 0.45], violet: [0.75, 0.45, 1] }
  ];
  var _palCache = Object.create(null);

  function paletteOf(name) {
    var p = PALETTES[UI.paletteIndex | 0];
    if (p && p[name]) return p[name];
    return C.COL[name] || C.COL.white;
  }

  /* hex string for NA.Icons (cached per name+palette so nothing allocates
   * inside a redraw loop). */
  function hx(name) {
    var k = name + '|' + UI.paletteIndex;
    var v = _palCache[k];
    if (v) return v;
    var c = paletteOf(name);
    v = '#' + ((1 << 24) + (Math.round(M.clamp01(c[0]) * 255) << 16) +
      (Math.round(M.clamp01(c[1]) * 255) << 8) + Math.round(M.clamp01(c[2]) * 255))
      .toString(16).slice(1);
    _palCache[k] = v;
    return v;
  }
  function hxOf(c) {
    return '#' + ((1 << 24) + (Math.round(M.clamp01(c[0]) * 255) << 16) +
      (Math.round(M.clamp01(c[1]) * 255) << 8) + Math.round(M.clamp01(c[2]) * 255))
      .toString(16).slice(1);
  }

  /* ==================================================================
   * 1. small shared helpers
   * ================================================================== */
  function us() { return M.clamp(Math.min(NA.R.w / 1600, NA.R.h / 900), 0.55, 2.2); }
  function pulse(hz, lo, hi) { return lo + (hi - lo) * (0.5 + 0.5 * Math.sin(NA.Time.real * M.TAU * hz)); }
  function hintDone(k) { return !!(St.records.hints && St.records.hints[k]); }
  function hintMark(k) {
    if (!St.records.hints) St.records.hints = {};
    if (St.records.hints[k]) return;
    St.records.hints[k] = 1; St.save();
  }
  var W2S = { x: 0, y: 0 }, S2W = { x: 0, y: 0 };
  function w2s(x, y) { return NA.Cam.worldToScreen(x, y, W2S); }
  function s2w(x, y) { return NA.Cam.screenToWorld(x, y, S2W); }
  function sfx(n, o) { if (NA.Audio && NA.Audio.sfx) NA.Audio.sfx(n, o); }

  /* a rounded hexagon path on the 2D overlay (cards, menu chips) */
  var _hxp = new Float32Array(14);
  function roundHex(ctx, x, y, r, rot, corner) {
    var i, n = 6;
    for (i = 0; i < n; i++) {
      var a = rot + i / n * M.TAU;
      _hxp[i * 2] = x + Math.cos(a) * r;
      _hxp[i * 2 + 1] = y + Math.sin(a) * r;
    }
    _hxp[12] = _hxp[0]; _hxp[13] = _hxp[1];
    ctx.beginPath();
    ctx.moveTo((_hxp[0] + _hxp[2]) * 0.5, (_hxp[1] + _hxp[3]) * 0.5);
    for (i = 1; i <= n; i++) {
      var cx = _hxp[(i % n) * 2], cy = _hxp[(i % n) * 2 + 1];
      var nx = _hxp[((i + 1) % n) * 2], ny = _hxp[((i + 1) % n) * 2 + 1];
      ctx.arcTo(cx, cy, (cx + nx) * 0.5, (cy + ny) * 0.5, corner);
    }
    ctx.closePath();
  }

  /* a jagged (wildcard) hexagon */
  function jagHex(ctx, x, y, r, rot) {
    var i, n = 12;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var a = rot + i / n * M.TAU;
      var rr = (i & 1) ? r * 0.86 : r;
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /* the "swap" glyph (mutually exclusive picks) — two opposed arrows */
  function swapGlyph(ctx, x, y, r, col) {
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, r * 0.16);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, -2.5, 0.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0.64, 3.54); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + r * 0.42, y - r * 0.72); ctx.lineTo(x + r * 0.74, y - r * 0.36);
    ctx.lineTo(x + r * 0.28, y - r * 0.22); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 0.42, y + r * 0.72); ctx.lineTo(x - r * 0.74, y + r * 0.36);
    ctx.lineTo(x - r * 0.28, y + r * 0.22); ctx.stroke();
    ctx.restore();
  }

  /* ==================================================================
   * 2. gamepad / pointer navigation edge detection
   * ================================================================== */
  var padPrev = new Uint8Array(20), padNow = new Uint8Array(20);
  var navRepeat = 0;

  function padPoll() {
    var gp = NA.Input.gamepad, i;
    for (i = 0; i < 20; i++) padPrev[i] = padNow[i];
    for (i = 0; i < 20; i++) padNow[i] = (gp && gp.buttons[i] && gp.buttons[i].pressed) ? 1 : 0;
  }
  function padPressed(i) { return padNow[i] === 1 && padPrev[i] === 0; }
  /* -1 / 0 / +1 with key repeat, from d-pad, left stick and arrow keys */
  function navAxis(dt, vertical) {
    var v = 0, gp = NA.Input.gamepad;
    if (vertical) {
      if (NA.Input.isDown('up')) v -= 1;
      if (NA.Input.isDown('down')) v += 1;
      if (padNow[12]) v -= 1;
      if (padNow[13]) v += 1;
      if (gp && gp.axes.length > 1 && Math.abs(gp.axes[1]) > 0.55) v += M.sign(gp.axes[1]);
    } else {
      if (NA.Input.isDown('left')) v -= 1;
      if (NA.Input.isDown('right')) v += 1;
      if (padNow[14]) v -= 1;
      if (padNow[15]) v += 1;
      if (gp && gp.axes.length > 0 && Math.abs(gp.axes[0]) > 0.55) v += M.sign(gp.axes[0]);
    }
    v = M.clamp(v, -1, 1);
    if (!v) { navRepeat = 0; return 0; }
    navRepeat -= dt;
    if (navRepeat > 0) return 0;
    navRepeat = navRepeat < -0.5 ? 0.30 : 0.13;
    return v;
  }
  /* the title's settings icon cluster: laid out in drawTitleOverlay, hit-tested
   * in tickTitle, so both must agree on the count and the 54*u pitch. */
  var SETTINGS_STRIP = ['volMaster', 'shake', 'flash', 'quality', 'colorblind', 'reticle', 'autofire'];
  var SETTINGS_STRIP_N = SETTINGS_STRIP.length;

  function confirmPressed() {
    return NA.Input.pressed('confirm') || NA.Input.pressed('fire') || padPressed(0);
  }
  function backPressed() {
    return NA.Input.pressed('pause') || padPressed(1) || padPressed(9);
  }

  /* a mouse wheel channel (the core input module reserves mouse.wheel but
   * never fills it; this is additive and harmless). */
  try {
    window.addEventListener('wheel', function (e) {
      NA.Input.mouse.wheel += (e.deltaY > 0 ? 1 : (e.deltaY < 0 ? -1 : 0));
    }, { passive: true });
  } catch (e) { }

  /* ==================================================================
   * 3. HUD
   * ================================================================== */
  var HUD_IDS = ['mana', 'hp', 'wave', 'build'];
  var hudEls = [];
  for (var hi = 0; hi < HUD_IDS.length; hi++) {
    hudEls.push({ id: HUD_IDS[hi], x: 0, y: 0, w: 60, h: 20, detached: 0, vx: 0, vy: 0, t: 0 });
  }
  function hudEl(id) { for (var i = 0; i < hudEls.length; i++) if (hudEls[i].id === id) return hudEls[i]; return null; }

  var HUD = NA.HUD = {
    bright: 0,
    combo: 0, comboT: 0,
    els: hudEls,

    bump: function () { HUD.bright = 1.5; },
    rects: function () { return hudEls; },

    update: function (dt) {
      if (HUD.bright > 0) HUD.bright -= dt;
      if (HUD.comboT > 0) { HUD.comboT -= dt; if (HUD.comboT <= 0) HUD.combo = 0; }
      // detached HUD elements drift (the Lurker steers them by writing x/y)
      for (var i = 0; i < hudEls.length; i++) {
        var e = hudEls[i];
        if (!e.detached) continue;
        e.t += dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.vx *= 0.995; e.vy *= 0.995;
      }
    },

    /* wave pips are only up during transitions */
    showPips: function () {
      var s = NA.Game ? NA.Game.state : '';
      return s === 'lastkill' || s === 'sweep' || s === 'draft' || s === 'overview' ||
        s === 'pause' || s === 'death' || s === 'ending' ||
        (s === 'boss' && NA.Bosses.active && NA.Bosses.active.state === 'intro');
    },

    render: function () {
      var R = NA.R, L = R.L, P = NA.Player, i;
      var a = 0.25 + 0.75 * M.clamp01(HUD.bright);
      var arcR = C.SHIP_R * 2.6;
      var mEl = hudEl('mana'), hEl = hudEl('hp'), wEl = hudEl('wave'), bEl = hudEl('build');

      /* --- world-space rects (also what fourthWall.hudRects() reports) --- */
      if (!hEl.detached) { hEl.x = P.x; hEl.y = P.y + arcR; }
      if (!mEl.detached) { mEl.x = P.x; mEl.y = P.y - arcR; }
      hEl.w = mEl.w = arcR * 1.35; hEl.h = mEl.h = 14;
      var pipCx = NA.Arena.cx, pipCy = NA.Arena.cy - (NA.Arena.radius + 46);
      if (!wEl.detached) { wEl.x = pipCx; wEl.y = pipCy; }
      wEl.w = NA.Arena.radius * 0.9; wEl.h = 26;
      if (!bEl.detached) { bEl.x = P.x; bEl.y = P.y + arcR * 3.2; }
      bEl.w = 260; bEl.h = 34;

      if (P.alive) {
        /* ---- HP: a segmented arc UNDER the ship ---- */
        var hpc = paletteOf('player'), lowc = paletteOf('red');
        var seg = Math.max(1, P.maxHp | 0);
        var hx0 = hEl.x, hy0 = hEl.y - (hEl.detached ? 0 : arcR);
        for (i = 0; i < seg; i++) {
          var a0 = M.HALFPI - 0.55 + (i / seg) * 1.1 + 0.035;
          var a1 = M.HALFPI - 0.55 + ((i + 1) / seg) * 1.1 - 0.035;
          var on = i < P.hp;
          var lr = P.hp <= 1 ? lowc : hpc;
          R.arc(L.HUD, hx0, hy0, arcR, a0, a1, 3.6,
            on ? lr[0] : 0.35, on ? lr[1] : 0.38, on ? lr[2] : 0.42,
            on ? Math.max(a, 0.6) : a * 0.45);
        }

        /* ---- mana: a cyan arc OVER the ship + the dash notch ---- */
        var mf = P.manaMax ? P.mana / P.manaMax : 0;
        var mx0 = mEl.x, my0 = mEl.y + (mEl.detached ? 0 : arcR);
        var ma0 = -M.HALFPI - 0.62, ma1 = ma0 + 1.24;
        R.arc(L.HUD, mx0, my0, arcR, ma0, ma1, 2.4, 0.20, 0.42, 0.52, a * 0.5);
        var full = mf >= 0.999;
        var mc = full ? paletteOf('gold') : paletteOf('player');
        if (mf > 0.001) {
          R.arc(L.HUD, mx0, my0, arcR, ma0, ma0 + (ma1 - ma0) * mf, 3.4,
            mc[0], mc[1], mc[2], Math.max(a, full ? 0.95 : 0.62));
        }
        var dn = M.clamp01(P.stats.dashCost / P.manaMax);
        var notch = ma0 + (ma1 - ma0) * dn;
        var afford = mf >= dn;
        R.line(L.HUD, mx0 + Math.cos(notch) * (arcR - 5.5), my0 + Math.sin(notch) * (arcR - 5.5),
          mx0 + Math.cos(notch) * (arcR + 5.5), my0 + Math.sin(notch) * (arcR + 5.5),
          1.7, 1, 1, 1, (afford ? 0.9 : 0.35) * Math.max(a, 0.5));
        if (full) {
          R.ring(L.HUD, mx0, my0, arcR, 1.7, mc[0], mc[1], mc[2], 0.30 + 0.28 * Math.sin(NA.Time.t * 5));
        }
      }

      /* ---- the rim HUD (GAME_PLAN 12.2) ----
       * The camera stays zoomed in on the ship (owner's hard rule), so the
       * arena rim is off-screen for most of a fight. During combat the rim is
       * therefore drawn in SCREEN space, projected onto an ellipse just inside
       * the viewport edge: every living enemy is a dot at its bearing from the
       * camera, which doubles as the off-screen indicator the plan asks for,
       * and the spawn-budget ring rides the same ellipse. In the zoomed-out
       * states (overview / draft / title / ending) the real world rim is on
       * screen and gets the world-space version instead. */
      var E = NA.Enemies, cx = NA.Arena.cx, cy = NA.Arena.cy;
      var st = NA.Game ? NA.Game.state : '';
      var combat = (st === 'wave' || st === 'boss' || st === 'lastkill' || st === 'sweep');
      var cap = E.n < 260 ? E.n : 260;
      var beat = E.beacon ? 0.55 + 0.35 * Math.sin(NA.Time.real * 9) : 0;

      if (P.alive && (combat || st === 'pause')) HUD.renderBars();

      if (combat) HUD.renderScreenRim(cap, beat);
      else {
        for (i = 0; i < cap; i++) {
          var ang = Math.atan2(E.y[i] - cy, E.x[i] - cx);
          var rr = NA.Arena.radiusAt(ang) + 9;
          var d = E.types[E.type[i]];
          if (!d) continue;
          var dc = d.color;
          R.dot(L.HUD, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 2.4,
            dc[0], dc[1], dc[2], beat || 0.35);
        }
        /* the idle (full) ring during transitions, so the rim never goes blank */
        if (!(NA.Waves && NA.Waves.running)) {
          R.arc(L.HUD, cx, cy, NA.Arena.radius + 18, -M.HALFPI, -M.HALFPI + M.TAU,
            2, 0.28, 0.9, 1.0, 0.13);
        }
      }

      /* ---- the 30-pip wave cluster (transitions only) ---- */
      if (HUD.showPips()) HUD.renderPips(wEl.x, wEl.y, 1);

      /* ---- off-screen "charging enemy" hull arrows ---- */
      HUD.renderOffscreen();

      /* ---- low-HP red vignette heartbeat (screen space, cheap) ---- */
      if (P.alive && P.hp <= 1) {
        var hb = 0.5 + 0.5 * Math.sin(NA.Time.real * M.TAU / 1.2);
        var rc = paletteOf('red');
        R.ssprite('ringSoft', R.w * 0.5, R.h * 0.5, 0,
          R.w * 0.78, R.h * 0.86, rc[0], rc[1], rc[2], 0.16 + hb * 0.22);
      }
    },

    /* 30 pips clustered at the top of the rim; past 30 an infinity ring and a
     * stroke counter (drawn on the icon overlay). */
    renderPips: function (cx, cy, alpha) {
      var R = NA.R, L = R.L, G = NA.Game;
      var done = G ? Math.max(0, G.wave - (G.state === 'wave' || G.state === 'boss' ? 1 : 0)) : 0;
      if (G && (G.state === 'lastkill' || G.state === 'sweep' || G.state === 'draft' ||
        G.state === 'overview')) done = G.wave;
      var span = 1.35, n = 30;
      var pc = paletteOf('player'), gc = paletteOf('gold');
      for (var i = 0; i < n; i++) {
        var f = n === 1 ? 0.5 : i / (n - 1);
        var ang = -M.HALFPI + (f - 0.5) * span;
        var px = cx + (f - 0.5) * NA.Arena.radius * 1.15;
        var py = cy + Math.abs(f - 0.5) * 26 - Math.cos(ang) * 0;
        var lit = i < Math.min(done, 30);
        var spike = ((i + 1) % 5) === 0;
        var crown = i === 29;
        var col = crown ? gc : pc;
        if (spike && !crown) {
          R.line(L.HUD, px, py - 8, px, py + 8, 2.2, col[0], col[1], col[2],
            (lit ? 0.9 : 0.16) * alpha);
        } else if (crown) {
          // gold crown pip: a tiny 5-point spike cluster
          for (var k = -2; k <= 2; k++) {
            R.line(L.HUD, px + k * 3.2, py + 6, px + k * 3.2, py - 6 - Math.abs(k) * -2.5,
              1.7, col[0], col[1], col[2], (lit ? 1 : 0.18) * alpha);
          }
        } else {
          R.dot(L.HUD, px, py, 2.6, col[0], col[1], col[2], (lit ? 0.85 : 0.14) * alpha);
        }
      }
      // past 30: the pips become an infinity ring
      if (done > 30) {
        var ex = cx + NA.Arena.radius * 0.62 + 44, ey = cy + 4;
        var s = 11;
        R.ring(L.HUD, ex - s, ey, s, 2.2, gc[0], gc[1], gc[2], 0.85 * alpha);
        R.ring(L.HUD, ex + s, ey, s, 2.2, gc[0], gc[1], gc[2], 0.85 * alpha);
      }
    },

    /* An enemy that is off-screen and winding up gets a flickering arrow on
     * the hull, pointing at it. Capped hard. */
    /* ------------------------------------------------------------------
     * F5: the screen-space rim.
     *
     * One ellipse just inside the viewport edge. Every living enemy is a dot
     * on it at its bearing from the camera, in its own type colour; anything
     * currently OFF screen reads brighter and a touch larger, so the ring is
     * simultaneously the wave-wide census and the off-screen threat readout.
     * The spawn-budget ring depletes clockwise from the top on the same
     * ellipse. Zero text, no allocation: the ellipse is walked with the two
     * radii and a bearing, and the budget arc is 48 chords worst case.
     * ------------------------------------------------------------------ */
    /* ---- the corner bars (owner request, 2026-09-05) ----
     * The arcs hugging the ship are unreadable at the wide combat zoom, so HP
     * and mana also get a fixed pair of screen-space bars in the bottom-left
     * corner: segmented HP on top (one cell per max HP, red at the last cell),
     * a continuous mana bar under it with a tick at the dash cost and a gold
     * fill when it is full. Screen space, so they never move or scale. */
    renderBars: function () {
      var R = NA.R, P = NA.Player;
      var w = 260, x0 = 46, x1 = x0 + w;
      var hy = R.h - 66, my = R.h - 42;
      var a = 0.25 + 0.75 * M.clamp01(HUD.bright);
      var lit = Math.max(a, 0.85);

      /* HP: one cell per max HP */
      var seg = Math.max(1, P.maxHp | 0);
      var hpc = P.hp <= 1 ? paletteOf('red') : paletteOf('player');
      var gap = seg > 1 ? 3 : 0, cw = (w - gap * (seg - 1)) / seg;
      for (var i = 0; i < seg; i++) {
        var cx0 = x0 + i * (cw + gap), on = i < P.hp;
        R.sline(cx0, hy, cx0 + cw, hy, 11,
          on ? hpc[0] : 0.34, on ? hpc[1] : 0.37, on ? hpc[2] : 0.42,
          on ? lit : a * 0.4);
      }

      /* mana: a single continuous bar */
      var mf = P.manaMax ? M.clamp01(P.mana / P.manaMax) : 0;
      var full = mf >= 0.999;
      var mc = full ? paletteOf('gold') : paletteOf('player');
      R.sline(x0, my, x1, my, 8, 0.18, 0.38, 0.48, a * 0.45);
      if (mf > 0.002) {
        R.sline(x0, my, x0 + w * mf, my, 8, mc[0], mc[1], mc[2],
          full ? Math.max(a, 0.95) : Math.max(a, 0.7));
      }
      /* the dash-cost tick */
      var dn = M.clamp01(P.stats.dashCost / P.manaMax);
      var tx = x0 + w * dn;
      R.sline(tx, my - 6, tx, my + 6, 1.6, 1, 1, 1, (mf >= dn ? 0.9 : 0.32) * Math.max(a, 0.5));
    },

    renderScreenRim: function (cap, beat) {
      var R = NA.R, L = R.L, E = NA.Enemies;
      var w = R.w, h = R.h;
      var scx = w * 0.5, scy = h * 0.5;
      // inset enough to clear the ship's own arcs at screen centre
      var mgn = 22;
      var rx = scx - mgn, ry = scy - mgn;
      if (rx < 40 || ry < 40) return;
      // half the visible world extent, for the on/off-screen test
      var hvw = NA.Cam.viewW() * 0.5, hvh = NA.Cam.viewH() * 0.5;
      var camx = NA.Cam.x, camy = NA.Cam.y;

      /* Off-screen enemies get a real chevron (~11-14 px) at the rim pointing
       * back INWARD along the bearing, in the enemy's own type colour: a 4 px
       * dot at the screen edge is not a usable indicator. The last few enemies
       * of a wave are the ones you are hunting, so they read brighter, larger
       * and — at 3 or fewer left — pulse. On-screen enemies stay tiny dots so
       * the rim is still the wave census without competing with the arena. */
      var alive = E.n;
      var hunt = alive <= 6 ? 1 : 0;                 // "last few" band
      var few = alive <= 3 ? 1 : 0;                  // pulse band
      var pul = few ? 0.72 + 0.28 * Math.sin(NA.Time.real * 7.5) : 1;
      var offA = beat ? beat : (few ? pul : (hunt ? 0.88 : 0.66));
      var offS = few ? 5.4 * (0.92 + 0.08 * pul) : (hunt ? 4.8 : 4.3);
      for (var i = 0; i < cap; i++) {
        var d = E.types[E.type[i]]; if (!d) continue;
        var dx = E.x[i] - camx, dy = E.y[i] - camy;
        if (dx === 0 && dy === 0) continue;
        var off = (dx < -hvw || dx > hvw || dy < -hvh || dy > hvh) ? 1 : 0;
        var ang = Math.atan2(dy, dx);
        var px = scx + Math.cos(ang) * rx, py = scy + Math.sin(ang) * ry;
        var dc = d.color;
        if (off) {
          // chevron points +x at rot 0, so ang + PI aims it back into the arena
          R.ssprite('chevron', px, py, ang + Math.PI, offS, offS, dc[0], dc[1], dc[2], offA);
        } else {
          R.sdisc(px, py, 2.1, dc[0], dc[1], dc[2], beat ? beat : 0.24);
        }
      }

      /* the spawn-budget ring, projected onto the same ellipse */
      var prog = (NA.Waves && NA.Waves.running) ? NA.Waves.progress : 0;
      var left = 1 - (prog > 0 ? (prog < 1 ? prog : 1) : 0);
      var full = !(NA.Waves && NA.Waves.running);
      var a0 = -M.HALFPI, span = M.TAU * (full ? 1 : left);
      if (span > 0.001) {
        var seg = 48, pxo = 0, pyo = 0;
        for (var q = 0; q <= seg; q++) {
          var aa = a0 + span * (q / seg);
          var qx = scx + Math.cos(aa) * rx, qy = scy + Math.sin(aa) * ry;
          if (q) R.sline(pxo, pyo, qx, qy, 2.2, 0.30, 0.95, 1.0, full ? 0.13 : 0.34);
          pxo = qx; pyo = qy;
        }
      }
    },

    renderOffscreen: function () {
      var G = NA.Game; if (!G) return;
      if (G.state !== 'wave' && G.state !== 'boss') return;
      var P = NA.Player; if (!P.alive) return;
      var E = NA.Enemies, R = NA.R, L = R.L;
      var vw = NA.Cam.viewW() * 0.5, vh = NA.Cam.viewH() * 0.5;
      var shown = 0, i;
      var oc = paletteOf('orange');
      var fl = (Math.sin(NA.Time.real * 22) > -0.2) ? 1 : 0.25;
      for (i = 0; i < E.n && shown < 6; i++) {
        var d = E.types[E.type[i]];
        if (!d || !d.eye) continue;                      // "charging" == has an eye
        var dx = E.x[i] - NA.Cam.x, dy = E.y[i] - NA.Cam.y;
        if (Math.abs(dx) < vw && Math.abs(dy) < vh) continue;   // on screen
        var ax = E.x[i] - P.x, ay = E.y[i] - P.y;
        var d2 = ax * ax + ay * ay;
        if (d2 > 1300 * 1300) continue;
        var ang = Math.atan2(ay, ax);
        var hr = C.SHIP_R * 4.2;
        var bx = P.x + Math.cos(ang) * hr, by = P.y + Math.sin(ang) * hr;
        R.sprite(L.HUD, 'chevron', bx, by, ang, 8, 8, oc[0], oc[1], oc[2], 0.75 * fl);
        shown++;
      }
    }
  };

  /* ==================================================================
   * 4. DRAFT
   * ================================================================== */
  var TAGSIM = ['explode', 'bounce', 'dash', 'spend', 'kill', 'orbital', 'zone', 'pierce', 'mana'];

  function makeSim() {
    var b = [], i;
    for (i = 0; i < 6; i++) b.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, hit: 0 });
    return {
      t: 0, fireT: 0, b: b, ring: 0, chain: 0, flash: 0,
      dash: 0, orbit: 0, mana: 0, zone: 0, shipX: 0
    };
  }

  var Draft = NA.Draft = {
    active: false, offers: [], hover: -1, t: 0, count: 3, picked: -1,
    bonusCards: 0, rerolled: false, skipStreak: 0, fake: false,
    _cards: [], _frame: -1, _prevSlots: null, _shatter: 0, _shatterI: -1,
    _seq: 0,                     // bumped whenever the offer set changes
    _upF: -1, _rnF: -1,          // per-frame reentrancy guards

    open: function (count) {
      var n = count | 0;
      if (!n) {
        if (NA.Waves && NA.Waves.draftCards && NA.Game) n = NA.Waves.draftCards(NA.Game.wave) | 0;
        else if (NA.Waves && NA.Waves.current && NA.Waves.current.draftCards) n = NA.Waves.current.draftCards | 0;
      }
      if (!n) n = 5;
      if (NA.Game && NA.Game.nextDraftCards) { n = NA.Game.nextDraftCards | 0; NA.Game.nextDraftCards = 0; }
      n += Draft.bonusCards; Draft.bonusCards = 0;
      /* Owner request: a draft is FIVE cards, always -- the wave table's 3/4
       * only ever raises the floor now, never lowers it. Scripted single-card
       * moments (a boss handing you one card) still pass count explicitly and
       * are respected, so the floor applies to the normal between-wave draft. */
      if (!(count | 0)) n = Math.max(n, 5);
      Draft.count = M.clamp(n, 1, 5);
      Draft.offers = NA.Upgrades.offer(Draft.count, NA.RNG);
      Draft.hover = -1; Draft.t = 0; Draft.picked = -1;
      Draft._seq++;
      Draft.rerolled = false; Draft._shatter = 0; Draft._shatterI = -1;
      Draft.active = true;
      // the emptiness check comes FIRST: listeners must never see a draftOpen
      // with zero offers, and a zero-card draft is not a draft.
      if (!Draft.offers.length) { Draft.active = false; return false; }
      if (NA.Game) NA.Game.emit('draftOpen', Draft.offers);
      buildCards();
      NA.Time.setTimeScale(0.05);
      UI.ovDirty = true;
      return true;
    },

    close: function () {
      Draft.unpreview();
      Draft.active = false;
      NA.Time.setTimeScale(1);
      HUD.bump();
      UI.buildStripT = 2.0;
      UI.ovDirty = true;
    },

    /* hover morphs the REAL ship: a temporary slot set, always restored */
    preview: function (i) {
      var id = Draft.offers[i]; if (!id) return;
      var def = NA.Upgrades.get(id); if (!def) return;
      Draft.unpreview();
      if (!def.visual || !def.visual.slot) return;
      var slot = def.visual.slot;
      Draft._prevSlots = { slot: slot, tier: NA.Ship.getSlot(slot) };
      var want = Math.min(slot === 'crown' ? 1 : 3, (NA.Upgrades.tier(id) || 0) + 1);
      NA.Ship.setSlot(slot, Math.max(Draft._prevSlots.tier, want));
      sfx('uiTick', { pitch: 1.25 });
    },
    unpreview: function () {
      if (!Draft._prevSlots) return;
      NA.Ship.setSlot(Draft._prevSlots.slot, Draft._prevSlots.tier);
      Draft._prevSlots = null;
    },

    pick: function (i) {
      if (!Draft.active || Draft.fake) return;
      if (i < 0 || i >= Draft.offers.length) return;
      var id = Draft.offers[i];
      var c = Draft._cards[i];
      Draft.unpreview();
      var tier = (NA.Upgrades.tier(id) || 0) + 1;
      NA.Upgrades.take(id);
      Draft.picked = i;
      Draft.skipStreak = 0;
      if (NA.Waves) NA.Waves.skipStreak = 0;
      if (NA.Game) NA.Game.notePick(id);

      /* the card shatters into particles that fly onto the ship */
      if (c) {
        var P = NA.Player;
        var col = NA.Icons && NA.Icons.familyOf ? famColor(id) : paletteOf('player');
        for (var k = 0; k < 22; k++) {
          var sx = c.x + (NA.RNG.f() - 0.5) * c.w, sy = c.y + (NA.RNG.f() - 0.5) * c.h;
          var w = s2w(sx, sy);
          var dx = P.x - w.x, dy = P.y - w.y;
          var L = Math.sqrt(dx * dx + dy * dy) || 1;
          NA.Particles.spawn(w.x, w.y, dx / L * 900, dy / L * 900, 0.45, 3.2,
            col[0], col[1], col[2], 1, 2, 0.2);
        }
        NA.Particles.ring(P.x, P.y, 8, 150, 0.45, 3, col[0], col[1], col[2], 1);
        NA.FX.trauma(0.12);
        NA.FX.chroma(1.6, 140);
        Draft._shatter = 0.35; Draft._shatterI = i;
      }
      sfx('draftPick', { tier: tier });
      Draft.close();
    },

    skip: function () {
      if (!Draft.active || Draft.fake) return;
      NA.Player.heal(1);
      NA.Player.mana = NA.Player.manaMax;
      Draft.skipStreak++;
      if (NA.Waves) {
        NA.Waves.skipStreak = Draft.skipStreak;
        NA.Waves.harder = Draft.skipStreak >= 2;
      }
      NA.Particles.ring(NA.Player.x, NA.Player.y, 6, 120, 0.4, 3,
        1, 0.45, 0.55, 0.9);
      sfx('draftSkip');
      Draft.close();
    },

    reroll: function () {
      if (!Draft.active || Draft.rerolled || Draft.fake) return;
      if (NA.Player.mana < 40) { sfx('manaDry'); return; }
      // offer() BEFORE spend(): a pool that has nothing left to give must not
      // cost 40 mana and leave an empty panel.
      var fresh = NA.Upgrades.offer(Draft.count, NA.RNG);
      if (!fresh || !fresh.length) { sfx('manaDry'); return; }
      if (!NA.Player.spend(40, 'reroll')) { sfx('manaDry'); return; }
      Draft.unpreview();
      Draft.rerolled = true;
      Draft.offers = fresh; Draft._seq++;
      buildCards();
      Draft.hover = -1;
      sfx('uiTick');
      UI.ovDirty = true;
    },

    /* Runs at REAL time from NA.UI.tick — a 5% simulation must not make the
     * menu feel like treacle, and NA.Input.pressed() only lives one frame. */
    update: function (dt) {
      if (!Draft.active) return;
      // Once per frame only. The Encore drives the bonus draft from its own
      // render() as well; UI.tick runs first, so that second call is a no-op
      // and one click can never be spent twice.
      if (Draft._upF === UI.frameN) return;
      Draft._upF = UI.frameN;
      Draft.t += dt;
      layout();

      var mx = NA.Input.mouse.x, my = NA.Input.mouse.y, i, c;
      var h = -1;
      for (i = 0; i < Draft._cards.length; i++) {
        c = Draft._cards[i];
        if (Math.abs(mx - c.x) < c.r * 0.86 && Math.abs(my - c.y) < c.r * 0.98) h = i;
      }
      /* gamepad / keyboard navigation */
      var nav = navAxis(dt, false);
      if (nav) {
        h = Draft.hover < 0 ? (nav > 0 ? 0 : Draft.offers.length - 1)
          : M.clamp(Draft.hover + nav, 0, Draft.offers.length - 1);
      } else if (h < 0 && Draft.hover >= 0 && !NA.Input.mouse.moved) h = Draft.hover;

      if (h !== Draft.hover) {
        Draft.hover = h;
        UI.ovDirty = true;
        if (h >= 0) { sfx('draftHover'); Draft.preview(h); }
        else Draft.unpreview();
      }

      /* the two hexes below */
      var by = Draft.hexY, hr = Draft.hexR;
      Draft.hoverReroll = M.dist2(mx, my, NA.R.w * 0.5 - Draft.hexX, by) < hr * hr;
      Draft.hoverSkip = M.dist2(mx, my, NA.R.w * 0.5 + Draft.hexX, by) < hr * hr;

      /* live mini-simulations */
      for (i = 0; i < Draft._cards.length; i++) simUpdate(Draft._cards[i], dt);

      if (Draft.fake) return;   // the Encore's fake panel ignores every click

      if (NA.Input.pressed('fire') || padPressed(0)) {
        if (Draft.hoverReroll) { Draft.reroll(); return; }
        if (Draft.hoverSkip) { Draft.skip(); return; }
        if (h >= 0) { Draft.pick(h); return; }
      }
      if (NA.Input.pressed('confirm') && Draft.hover >= 0) { Draft.pick(Draft.hover); return; }
      if (NA.Input.pressed('pick1')) return Draft.pick(0);
      if (NA.Input.pressed('pick2')) return Draft.pick(1);
      if (NA.Input.pressed('pick3')) return Draft.pick(2);
      if (NA.Input.pressed('pick4')) return Draft.pick(3);
      if (padPressed(2) || NA.Input.pressed('active')) return Draft.reroll();   // X
      if (padPressed(3)) return Draft.skip();                                   // Y
    },

    render: function () {
      if (!Draft.active) return;
      if (Draft._rnF === UI.frameN) return;    // never draw the cards twice
      Draft._rnF = UI.frameN;
      var R = NA.R, i;
      layout();
      /* the world dims 50% behind the cards (post darkness; the ship keeps a
       * light stamp so it stays readable) */
      NA.R.light(NA.Player.x, NA.Player.y, 230, 0.7);

      for (i = 0; i < Draft._cards.length; i++) {
        var c = Draft._cards[i];
        var hov = Draft.hover === i;
        var s = hov ? 1.07 : 1;
        c.scale = M.smooth(c.scale, s, 16, 1 / 60);
        var col = c.col;
        var rr = c.r * c.scale;
        /* a soft card body in screen space; the crisp rounded-hex frame and
         * everything inside it is drawn on the 2D overlay. */
        R.sdisc(c.x, c.y, rr * 0.94, 0.03, 0.05, 0.075, hov ? 0.98 : 0.88);
        if (hov) R.sring(c.x, c.y, rr * 1.14, 1.4, col[0], col[1], col[2], pulse(1.4, 0.25, 0.55));
      }

      /* reroll + skip hexes */
      var by = Draft.hexY, u = us(), hr = Draft.hexR;
      var canRr = !Draft.rerolled && NA.Player.mana >= 40;
      var rc = canRr ? paletteOf('player') : paletteOf('grey');
      R.sdisc(R.w * 0.5 - Draft.hexX, by, hr, 0.03, 0.05, 0.075, 0.85);
      R.spoly(R.w * 0.5 - Draft.hexX, by, hr, 6, M.HALFPI, Draft.hoverReroll ? 2.4 : 1.5,
        rc[0], rc[1], rc[2], Draft.hoverReroll ? 0.95 : 0.5);
      /* the reroll cost as a draining mana arc (40 of manaMax) */
      var need = M.clamp01(40 / NA.Player.manaMax);
      var have = M.clamp01(NA.Player.mana / NA.Player.manaMax);
      R.sarc(R.w * 0.5 - Draft.hexX, by, hr * 1.22, -M.HALFPI, -M.HALFPI + M.TAU * need, 3,
        0.22, 0.32, 0.4, 0.6);
      R.sarc(R.w * 0.5 - Draft.hexX, by, hr * 1.22, -M.HALFPI,
        -M.HALFPI + M.TAU * Math.min(need, have), 3, rc[0], rc[1], rc[2], canRr ? 0.95 : 0.35);

      var sc = paletteOf('red');
      R.sdisc(R.w * 0.5 + Draft.hexX, by, hr, 0.03, 0.05, 0.075, 0.85);
      R.spoly(R.w * 0.5 + Draft.hexX, by, hr, 6, M.HALFPI, Draft.hoverSkip ? 2.4 : 1.5,
        sc[0], sc[1], sc[2], Draft.hoverSkip ? 0.95 : 0.5);
      if (Draft.skipStreak >= 1) {
        /* skipping twice in a row is louder: a warning halo */
        R.sring(R.w * 0.5 + Draft.hexX, by, hr * 1.35, 1.6, 1, 0.55, 0.2, pulse(2, 0.2, 0.5));
      }
    }
  };

  var COL_DEFENSE = [0.30, 0.55, 1.0];
  function famColor(id) {
    if (!NA.Icons || !NA.Icons.familyOf) return paletteOf('player');
    switch (NA.Icons.familyOf(id)) {
      case 'offense': return paletteOf('orange');
      case 'defense': return COL_DEFENSE;
      case 'movement': return paletteOf('green');
      case 'chaos': return paletteOf('magenta');
      case 'wild': return paletteOf('gold');
      default: return paletteOf('player');
    }
  }

  function buildCards() {
    Draft._cards.length = 0;
    for (var i = 0; i < Draft.offers.length; i++) {
      var id = Draft.offers[i];
      var def = NA.Upgrades.get(id) || {};
      var tags = NA.Upgrades.tagsOf(id) || [];
      var after = {}; for (var k in NA.Ship.slots) after[k] = NA.Ship.slots[k];
      var tier = (NA.Upgrades.tier(id) || 0) + 1;
      if (def.visual && def.visual.slot) {
        after[def.visual.slot] = Math.max(after[def.visual.slot] || 0,
          def.visual.slot === 'crown' ? 1 : Math.min(3, tier));
      }
      if (def.wildcard) after.crown = 1;
      /* mutually exclusive pick? (def.excludes = ['afterburner'], optional) */
      var swap = false;
      if (def.excludes) for (var e = 0; e < def.excludes.length; e++) {
        if (NA.Upgrades.tier(def.excludes[e]) > 0) swap = true;
      }
      Draft._cards.push({
        id: id, x: 0, y: 0, w: 100, h: 130, scale: 1, tier: tier,
        col: famColor(id), hexcol: hxOf(famColor(id)),
        wild: !!def.wildcard, swap: swap, slot: (def.visual && def.visual.slot) || '',
        after: after, tags: tags, sim: makeSim()
      });
    }
  }

  /* Cards are regular hexagons with a vertex up: for radius r the silhouette
   * is 1.732r wide and 2r tall, and everything inside is placed in units of r,
   * so nothing ever spills past the frame. */
  function layout() {
    var R = NA.R, n = Draft._cards.length, u = us();
    if (!n) return;
    var r = Math.min(118 * u, (R.w - 90) / (n * 2.05), R.h * 0.21);
    var gap = r * 2.05;
    for (var i = 0; i < n; i++) {
      var frac = n === 1 ? 0.5 : i / (n - 1);
      var c = Draft._cards[i];
      c.r = r;
      c.x = R.w * 0.5 + (frac - 0.5) * gap * (n - 1);
      c.y = R.h * 0.34 + Math.abs(frac - 0.5) * r * 0.28;   // an arc above the ship
      c.w = r * 1.732; c.h = r * 2;
    }
    Draft.hexY = R.h * 0.85;
    Draft.hexX = 104 * u;
    Draft.hexR = 28 * u;
  }

  /* ---- the per-card live mini-simulation, driven by the upgrade's tags ---- */
  function simUpdate(c, dt) {
    var s = c.sim, i, b, t = c.tags;
    s.t += dt;
    var W = 1, H = 0.62;                 // normalised sandbox
    var dumX = 0.80;
    var has = simHas;
    s.orbit += dt * 2.2;
    if (has(t, 'mana')) s.mana = (s.mana + dt * 0.55) % 1.15;
    if (has(t, 'dash')) {
      s.dash += dt;
      if (s.dash > 1.5) s.dash = 0;
      s.shipX = s.dash < 0.25 ? M.easeOut(s.dash / 0.25) * 0.22 : (s.dash < 0.6 ? (1 - (s.dash - 0.25) / 0.35) * 0.22 : 0);
    }
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = 0.34;
      for (i = 0; i < s.b.length; i++) {
        b = s.b[i];
        if (b.life > 0) continue;
        b.x = 0.13 + s.shipX; b.y = H * 0.5;
        b.vx = 1.15; b.vy = has(t, 'bounce') ? (i & 1 ? 0.55 : -0.55) : 0;
        b.life = 1.6; b.hit = 0;
        break;
      }
    }
    for (i = 0; i < s.b.length; i++) {
      b = s.b[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (has(t, 'bounce')) {
        if (b.y < 0.06) { b.y = 0.06; b.vy = -b.vy; }
        if (b.y > H - 0.06) { b.y = H - 0.06; b.vy = -b.vy; }
      }
      if (!b.hit && b.x >= dumX - 0.05 && Math.abs(b.y - H * 0.5) < 0.10) {
        b.hit = 1;
        s.flash = 0.18;
        if (has(t, 'explode')) s.ring = 0.42;
        if (has(t, 'kill') || has(t, 'spend')) s.chain = 0.32;
        if (!has(t, 'pierce')) b.life = 0;
        else b.vx *= 0.92;
      }
      if (b.x > W + 0.1) b.life = 0;
    }
    if (s.ring > 0) s.ring -= dt;
    if (s.chain > 0) s.chain -= dt;
    if (s.flash > 0) s.flash -= dt;
    if (has(t, 'zone')) s.zone = 0.5 + 0.5 * Math.sin(s.t * 3);
  }
  function simHas(tags, k) {
    for (var i = 0; i < tags.length; i++) if (tags[i] === k) return true;
    return false;
  }

  /* the mini-sim, drawn into a w x h box whose top-left is (x, y) */
  function simDraw(ctx, c, x, y, w, h) {
    var s = c.sim, t = c.tags, i, b;
    var col = c.hexcol;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    // sandbox floor: two hairlines, no box
    ctx.strokeStyle = 'rgba(120,190,220,0.20)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.06, y + h - 0.5); ctx.lineTo(x + w * 0.94, y + h - 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,190,220,0.08)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.06, y + 0.5); ctx.lineTo(x + w * 0.94, y + 0.5);
    ctx.stroke();
    var sx = function (u) { return x + u * w; };
    var sy = function (v) { return y + v / 0.62 * h; };

    // the mini ship
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    var shx = sx(0.13 + s.shipX), shy = sy(0.31);
    ctx.beginPath();
    ctx.moveTo(shx + 7, shy); ctx.lineTo(shx - 5, shy - 5.5);
    ctx.lineTo(shx - 2.5, shy); ctx.lineTo(shx - 5, shy + 5.5);
    ctx.closePath(); ctx.stroke();
    if (simHas(t, 'orbital')) {
      for (i = 0; i < 2; i++) {
        var a = s.orbit + i * Math.PI;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(shx + Math.cos(a) * 11, shy + Math.sin(a) * 11, 1.7, 0, M.TAU);
        ctx.fill();
      }
    }
    if (simHas(t, 'mana')) {
      ctx.strokeStyle = 'rgba(77,243,255,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(shx, shy, 13, Math.PI * 0.78, Math.PI * 0.78 + Math.PI * 1.44 * M.clamp01(s.mana));
      ctx.stroke();
    }
    // the dummy
    var dx = sx(0.80), dy = sy(0.31);
    ctx.strokeStyle = s.flash > 0 ? '#FFFFFF' : 'rgba(255,60,172,0.85)';
    ctx.lineWidth = s.flash > 0 ? 2.2 : 1.4;
    ctx.beginPath();
    for (i = 0; i < 6; i++) {
      var aa = i / 6 * M.TAU;
      var px = dx + Math.cos(aa) * 8, py = dy + Math.sin(aa) * 8;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    if (simHas(t, 'zone')) {
      ctx.strokeStyle = 'rgba(77,243,255,' + (0.18 + s.zone * 0.22).toFixed(3) + ')';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(dx, dy, 15 + s.zone * 4, 0, M.TAU); ctx.stroke();
    }
    // bullets
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.6;
    for (i = 0; i < s.b.length; i++) {
      b = s.b[i];
      if (b.life <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(sx(b.x) - 5, sy(b.y)); ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
    // explosion ring
    if (s.ring > 0) {
      var k = 1 - s.ring / 0.42;
      ctx.strokeStyle = 'rgba(255,138,0,' + (1 - k).toFixed(3) + ')';
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(dx, dy, 6 + k * 16, 0, M.TAU); ctx.stroke();
    }
    // chain lightning to a second dummy
    if (s.chain > 0) {
      var dx2 = sx(0.80), dy2 = sy(0.52);
      ctx.strokeStyle = 'rgba(180,240,255,' + (s.chain / 0.32).toFixed(3) + ')';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo((dx + dx2) * 0.5 + 5, (dy + dy2) * 0.5);
      ctx.lineTo(dx2, dy2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,60,172,0.5)';
      ctx.beginPath(); ctx.arc(dx2, dy2, 5, 0, M.TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ==================================================================
   * 5. PAUSE / SETTINGS ring
   * ================================================================== */
  function vol() {
    if (NA.Audio && NA.Audio.setVolumes) NA.Audio.setVolumes({
      master: St.settings.volMaster, music: St.settings.volMusic, sfx: St.settings.volSfx
    });
  }
  var MENU = [
    { id: 'resume', kind: 'btn', act: function () { if (NA.Game) NA.Game.resume(); } },
    { id: 'volMaster', kind: 'slider', steps: 10, get: function () { return St.settings.volMaster; }, set: function (v) { St.settings.volMaster = v; vol(); } },
    { id: 'volMusic', kind: 'slider', steps: 10, get: function () { return St.settings.volMusic; }, set: function (v) { St.settings.volMusic = v; vol(); } },
    { id: 'volSfx', kind: 'slider', steps: 10, get: function () { return St.settings.volSfx; }, set: function (v) { St.settings.volSfx = v; vol(); sfx('uiTick'); } },
    { id: 'shake', kind: 'slider', steps: 3, get: function () { return St.settings.shake / 3; }, set: function (v) { St.settings.shake = Math.round(v * 3); NA.Cam.addTrauma(0.25); } },
    { id: 'flash', kind: 'slider', steps: 3, get: function () { return St.settings.flash; }, set: function (v) { St.settings.flash = v; NA.FX.flash(0.3, 90); } },
    { id: 'quality', kind: 'slider', steps: 3, get: function () { return St.settings.quality / 3; }, set: function (v) { St.settings.quality = Math.round(v * 3); if (NA.R.setQualityHard) NA.R.setQualityHard(St.settings.quality); } },
    { id: 'colorblind', kind: 'slider', steps: 3, get: function () { return St.settings.palette / 3; }, set: function (v) { UI.setPalette(Math.round(v * 3)); } },
    { id: 'reticle', kind: 'slider', steps: 3, get: function () { return St.settings.reticle / 3; }, set: function (v) { St.settings.reticle = Math.round(v * 3) * 0.66; } },
    { id: 'autofire', kind: 'toggle', get: function () { return St.settings.autofire ? 1 : 0; }, set: function (v) { St.settings.autofire = v > 0.5 ? 1 : 0; } },
    { id: 'hints', kind: 'btn', act: function () { St.records.hints = {}; St.save(); sfx('uiConfirm'); } },
    { id: 'quit', kind: 'btn', act: function () { if (NA.Game) NA.Game.toTitle(); } }
  ];

  var Menu = {
    open: false, sel: 0, t: 0, hover: -1, shakeHover: 0,
    _pos: [],

    show: function () {
      Menu.open = true; Menu.t = 0; Menu.sel = 0; Menu.hover = -1;
      UI.ovDirty = true;
      sfx('uiConfirm');
    },
    hide: function () {
      Menu.open = false; St.save(); UI.ovDirty = true;
    },

    layout: function () {
      var R = NA.R, u = us();
      var w = w2s(NA.Player.x, NA.Player.y);
      var cx = M.clamp(w.x, R.w * 0.34, R.w * 0.66);
      var cy = M.clamp(w.y, R.h * 0.36, R.h * 0.64);
      var rad = Math.min(R.w, R.h) * 0.33;
      Menu.cx = cx; Menu.cy = cy; Menu.rad = rad; Menu.isz = 46 * u;
      for (var i = 0; i < MENU.length; i++) {
        var a = -M.HALFPI + i / MENU.length * M.TAU;
        if (!Menu._pos[i]) Menu._pos[i] = { x: 0, y: 0 };
        Menu._pos[i].x = cx + Math.cos(a) * rad;
        Menu._pos[i].y = cy + Math.sin(a) * rad;
      }
    },

    update: function (dt) {
      Menu.t += dt;
      Menu.layout();
      var mx = NA.Input.mouse.x, my = NA.Input.mouse.y, i;
      var h = -1, r = Menu.isz * 0.85;
      for (i = 0; i < MENU.length; i++) {
        var p = Menu._pos[i];
        if (M.dist2(mx, my, p.x, p.y) < r * r) h = i;
      }
      if (h >= 0 && h !== Menu.hover) { sfx('draftHover'); Menu.sel = h; }
      if (h !== Menu.hover) { Menu.hover = h; UI.ovDirty = true; }

      /* gamepad / keys: up-down walks the ring, left-right moves the slider */
      var nv = navAxis(dt, true);
      if (nv) {
        Menu.sel = (Menu.sel + nv + MENU.length) % MENU.length;
        sfx('draftHover'); UI.ovDirty = true;
      }
      var hz = navAxis(dt, false);
      var it = MENU[Menu.sel];
      if (hz) Menu.nudge(it, hz);

      var wheel = NA.Input.mouse.wheel;
      if (wheel && Menu.hover >= 0) Menu.nudge(MENU[Menu.hover], -wheel);

      if (NA.Input.pressed('fire') && Menu.hover >= 0) {
        var hit = MENU[Menu.hover];
        if (hit.kind === 'btn') hit.act();
        else if (hit.kind === 'toggle') { hit.set(hit.get() > 0.5 ? 0 : 1); sfx('uiTick'); UI.ovDirty = true; }
        else Menu.nudge(hit, mx > Menu._pos[Menu.hover].x ? 1 : -1);
      } else if ((NA.Input.pressed('confirm') || padPressed(0)) && Menu.hover < 0) {
        // keyboard/gamepad only: confirmPressed() includes a left click, so a
        // click on empty space used to fire the keyboard-selected item (which
        // can be "quit run") with no confirmation.

        var sel = MENU[Menu.sel];
        if (sel.kind === 'btn') sel.act();
        else if (sel.kind === 'toggle') { sel.set(sel.get() > 0.5 ? 0 : 1); sfx('uiTick'); UI.ovDirty = true; }
      }
      if (backPressed()) { if (NA.Game) NA.Game.resume(); }
      Menu.shakeHover = (Menu.hover >= 0 && MENU[Menu.hover].id === 'shake') ? 1 : 0;
    },

    nudge: function (it, dir) {
      if (!it || it.kind === 'btn') return;
      if (it.kind === 'toggle') { it.set(dir > 0 ? 1 : 0); sfx('uiTick'); UI.ovDirty = true; return; }
      var step = 1 / it.steps;
      var v = M.clamp01(Math.round((it.get() + dir * step) / step) * step);
      it.set(v);
      sfx('uiTick', { pitch: 0.9 + v * 0.5 });
      UI.ovDirty = true;
    },

    render: function () {
      var R = NA.R;
      Menu.layout();
      /* the ship stays crisp inside the frost */
      NA.R.light(NA.Player.x, NA.Player.y, 210, 0.7);
      var k = M.clamp01(Menu.t / 0.25);
      for (var i = 0; i < MENU.length; i++) {
        var p = Menu._pos[i], it = MENU[i];
        var hov = (Menu.hover === i) || (Menu.hover < 0 && Menu.sel === i);
        var col = hov ? paletteOf('core') : paletteOf('player');
        var rr = Menu.isz * 0.62 * (hov ? 1.12 : 1) * k;
        R.sdisc(p.x, p.y, rr * 1.25, 0.03, 0.055, 0.08, 0.9 * k);
        R.spoly(p.x, p.y, rr, 6, M.HALFPI, hov ? 2.4 : 1.4, col[0], col[1], col[2], (hov ? 0.95 : 0.42) * k);
      }
      /* a soft ring tying the menu to the ship */
      R.sring(Menu.cx, Menu.cy, Menu.rad, 1, 0.3, 0.85, 1, 0.10 * k);
    }
  };

  /* ==================================================================
   * 6. NA.UI
   * ================================================================== */
  var UI = NA.UI = {
    gate: { x: 0, y: -340, r: 68, active: false, passed: false, kind: 'start' },
    gate2: { x: 0, y: 0, r: 44, active: false, passed: false, kind: 'endless' },
    gate3: { x: 0, y: 0, r: 40, active: false, passed: false, kind: 'home' },
    _wasInside: false, _wasInside2: false, _wasInside3: false,
    _clicks: 0,
    paletteIndex: 0,
    buildStripT: 0,
    ovDirty: true,
    ovT: 0, frameN: 0, _ovSig: '', _ovSg: ['', 0, 0, -2, -2, -2, -2, -2, -2, -2, -2],
    settingsPeek: 0,
    endT: 0, endPhase: 0,
    hintDash: 0, hintMove: 0, hintFire: 0, hintDraft: 0,
    photo: 0,

    /* --------------------------------------------------- pause menu */
    openMenu: function () { Menu.show(); },
    closeMenu: function () { Menu.hide(); },
    menuOpen: function () { return Menu.open; },

    /* ------------------------------------------------------- palette */
    palette: function (name) { return paletteOf(name); },
    setPalette: function (i) {
      UI.paletteIndex = M.clamp(i | 0, 0, 3);
      St.settings.palette = UI.paletteIndex;
      St.settings.colorblind = UI.paletteIndex;
      _palCache = Object.create(null);
      UI.ovDirty = true;
    },
    flashLevel: function () { return Math.round(M.clamp01(St.settings.flash) * 3); },

    markSeen: function (kind, id) {
      if (!id) return;
      var k = kind + ':' + id;
      if (St.records.seen[k]) return;
      St.records.seen[k] = 1;
      St.save();
    },

    reset: function () {
      Draft.unpreview();
      Draft.active = false; Draft.fake = false; Draft.bonusCards = 0;
      Draft.skipStreak = 0; Draft._cards.length = 0;
      Menu.open = false;
      HUD.bright = 0; HUD.combo = 0;
      UI.buildStripT = 0; UI.endT = 0; UI.endPhase = 0;
      UI.gate.active = UI.gate2.active = UI.gate3.active = false;
      UI._wasInside = UI._wasInside2 = UI._wasInside3 = false;
      UI.hintDash = UI.hintMove = UI.hintFire = UI.hintDraft = 0;
      for (var i = 0; i < hudEls.length; i++) { hudEls[i].detached = 0; hudEls[i].vx = hudEls[i].vy = 0; }
      UI.ovDirty = true;
      FW.reset();
    },

    clicked: function () {
      if (NA.Input.pressed('fire')) return true;
      return false;
    },

    /* ---------------------------------------------------------- gates */
    resetGate: function (x, y) {
      UI.gate.x = x === undefined ? 0 : x;
      UI.gate.y = y === undefined ? -340 : y;
      UI.gate.active = true; UI.gate.passed = false; UI._wasInside = false;
      UI.gate.kind = 'start';
    },
    setGate2: function (x, y, kind) {
      UI.gate2.x = x; UI.gate2.y = y; UI.gate2.active = true;
      UI.gate2.passed = false; UI._wasInside2 = false;
      UI.gate2.kind = kind || 'endless';
    },
    setGate3: function (x, y) {
      UI.gate3.x = x; UI.gate3.y = y; UI.gate3.active = true;
      UI.gate3.passed = false; UI._wasInside3 = false;
      UI.gate3.kind = 'home';
    },

    _enter: function (g, flagName, autoDash) {
      if (!g.active) return false;
      var P = NA.Player;
      var inside = M.dist2(P.x, P.y, g.x, g.y) < g.r * g.r;
      if (inside && !UI[flagName]) {
        UI[flagName] = true; g.passed = true; g.active = false;
        sfx('gate');
        NA.Particles.ring(g.x, g.y, 10, g.r * 3.2, 0.5, 4, 1, 1, 1, 0.9);
        NA.FX.flash(0.2, 90);
        return true;
      }
      if (autoDash && (NA.Input.pressed('fire') || NA.Input.pressed('confirm') || padPressed(0))) {
        var a = Math.atan2(g.y - P.y, g.x - P.x);
        P.vx = Math.cos(a) * 950; P.vy = Math.sin(a) * 950;
        P.dashIFrame = Math.max(P.dashIFrame, 0.4);
        sfx('dash', { x: P.x, y: P.y });
      }
      return false;
    },
    gateEntered: function () { return UI._enter(UI.gate, '_wasInside', true); },
    gate2Entered: function () { return UI._enter(UI.gate2, '_wasInside2', false); },
    gate3Entered: function () { return UI._enter(UI.gate3, '_wasInside3', false); },

    renderGate: function (g, col, dotted) {
      if (!g.active) return;
      var R = NA.R, L = R.L, P = NA.Player, i;
      var pl = 0.55 + 0.35 * Math.sin(NA.Time.real * M.TAU);
      var d = M.dist(P.x, P.y, g.x, g.y);
      var near = M.clamp01(1 - d / 800);
      /* the gate leans toward the ship and brightens as you approach */
      var lean = Math.atan2(P.y - g.y, P.x - g.x);
      var sq = 1 + near * 0.10;
      R.ring(L.VEIL, g.x, g.y, g.r * sq, 4, col[0], col[1], col[2], (0.38 + near * 0.5) * pl);
      R.ring(L.VEIL, g.x, g.y, g.r * 1.22, 1.5, col[0], col[1], col[2], 0.30 * pl);
      R.disc(L.VEIL, g.x, g.y, g.r * 1.7, col[0], col[1], col[2], 0.08 + near * 0.12);
      R.light(g.x, g.y, g.r * 4, 0.5 + near * 0.4);
      /* three lean ticks facing the ship */
      for (i = -1; i <= 1; i++) {
        var a = lean + i * 0.5;
        R.line(L.VEIL, g.x + Math.cos(a) * g.r * 0.86, g.y + Math.sin(a) * g.r * 0.86,
          g.x + Math.cos(a) * g.r * 1.14, g.y + Math.sin(a) * g.r * 1.14,
          2, col[0], col[1], col[2], 0.5 * pl);
      }
      if (g.kind === 'endless') {
        /* an infinity ring instead of a plain circle */
        var s = g.r * 0.55;
        R.ring(L.VEIL, g.x - s, g.y, s, 3, col[0], col[1], col[2], 0.85 * pl);
        R.ring(L.VEIL, g.x + s, g.y, s, 3, col[0], col[1], col[2], 0.85 * pl);
      }
      /* the 'home' glyph itself is an icon on the 2D overlay */
      if (dotted) {
        var steps = 12;
        for (i = 0; i < steps; i++) {
          var k = ((i / steps) + (NA.Time.real * 0.3) % 1) % 1;
          R.dot(L.VEIL, M.lerp(P.x, g.x, k), M.lerp(P.y, g.y, k), 2.6 + k * 1.4,
            col[0], col[1], col[2], 0.30 * (1 - k * 0.7));
        }
      }
    },

    /* ============================================== the real-time driver */
    tick: function (dt) {
      if (dt > 0.1) dt = 0.1;
      padPoll();
      var G = NA.Game; if (!G) return;
      var s = G.state;
      UI.frameN++;
      UI.ovT += dt;
      if (UI.buildStripT > 0) { UI.buildStripT -= dt; if (UI.buildStripT <= 0) UI.ovDirty = true; }
      /* a one-time photosensitivity glyph, the first time a supernova charges */
      if (UI.photo > 0) { UI.photo -= dt; if (UI.photo <= 0) UI.ovDirty = true; }
      else if (!hintDone('photo') && NA.Events && NA.Events.isActive &&
        NA.Events.isActive('supernova')) {
        hintMark('photo'); UI.photo = 3.0; UI.ovDirty = true;
      }
      FW.tick(dt);

      /* pause is available in every playable state */
      if (NA.Input.pressed('pause') || padPressed(9)) {
        if (s === 'pause') G.resume();
        else if (s === 'wave' || s === 'boss' || s === 'overview' || s === 'lastkill' ||
          s === 'sweep' || s === 'draft' || s === 'title') G.pause();
      }

      if (s === 'pause') { Menu.update(dt); return; }
      if (s === 'draft') { Draft.update(dt); return; }
      if (s === 'title') { UI.tickTitle(dt); return; }
      if (s === 'death') { UI.tickDeath(dt); return; }
      if (s === 'ending') { UI.tickEnding(dt); return; }
      UI.tickHints(dt);
    },

    /* ----------------------------------------------------- title screen */
    tickTitle: function (dt) {
      UI.tickHints(dt);
      /* settings icons slide up from the bottom rim when the mouse drifts near */
      var near = NA.Input.mouse.y > NA.R.h * 0.80 ? 1 : 0;
      var was = UI.settingsPeek;
      UI.settingsPeek = M.smooth(UI.settingsPeek, near, 8, dt);
      if (Math.abs(UI.settingsPeek - was) > 0.01) UI.ovDirty = true;
      if (UI.settingsPeek > 0.6 && NA.Input.pressed('fire')) {
        // hit-test the real icon cluster, not a full-width band: on the title a
        // low click is also the "dash toward the gate" input.
        var u = us(), y = NA.R.h - 46 * u;
        var halfW = (SETTINGS_STRIP_N - 1) * 0.5 * 54 * u + 27 * u;
        if (Math.abs(NA.Input.mouse.y - y) < 34 * u &&
          Math.abs(NA.Input.mouse.x - NA.R.w * 0.5) < halfW) { NA.Game.pause(); return; }
      }
    },

    tickHints: function (dt) {
      var P = NA.Player, G = NA.Game;
      if (!P.alive) return;
      /* move hint: blank keycaps under the ship until you move */
      if (!hintDone('move')) {
        var ax = NA.Input.axis();
        if (ax.x || ax.y) { hintMark('move'); UI.hintMove = 0; }
        else UI.hintMove = M.clamp01(UI.hintMove + dt * 2);
      } else UI.hintMove = 0;
      /* fire hint: a mouse glyph at the reticle until you shoot */
      if (!hintDone('fire')) {
        if (P.kills > 0 || NA.Bullets.P.n > 0) hintMark('fire');
        else UI.hintFire = M.clamp01(UI.hintFire + dt * 2);
      } else UI.hintFire = 0;
      /* dash hint: the first time a projectile is ~0.5s from the hull */
      if (!hintDone('dash')) {
        if (P.dashT > 0 || NA.Input.pressed('dash')) hintMark('dash');
        else {
          var B = NA.Bullets.E, i, threat = 0;
          var cap = Math.min(B.n, 400);
          for (i = 0; i < cap; i++) {
            var rx = P.x - B.x[i], ry = P.y - B.y[i];
            var d2 = rx * rx + ry * ry;
            if (d2 > 520 * 520) continue;
            var vv = B.vx[i] * rx + B.vy[i] * ry;
            if (vv <= 0) continue;
            var d = Math.sqrt(d2), sp = Math.sqrt(B.vx[i] * B.vx[i] + B.vy[i] * B.vy[i]) || 1;
            if (d / sp < 0.55) { threat = 1; break; }
          }
          UI.hintDash = threat ? M.clamp01(UI.hintDash + dt * 4) : Math.max(0, UI.hintDash - dt * 1.5);
        }
      } else UI.hintDash = 0;
      /* draft pointer nudge, once */
      if (Draft.active && !hintDone('draft')) UI.hintDraft = M.clamp01(UI.hintDraft + dt * 2);
    },

    /* ----------------------------------------------------- death screen */
    tickDeath: function (dt) {
      var G = NA.Game;
      if (G.stateT < 1.2) return;
      /* Infinite lives: THREE gates now.  The primary one (above the wreck,
       * the one 'confirm' also triggers) replays the wave you died on with
       * your build intact; gate2 starts a fresh run from wave 1; gate3 goes
       * home.  Continuing is the default because this is a fun game, not a
       * fair one -- the price of a death is the counter, nothing else. */
      if (!UI.gate.active && !UI.gate.passed) {
        UI.resetGate(NA.Player.x, NA.Player.y - 330);
        UI.setGate2(NA.Player.x - 330, NA.Player.y + 190, 'restart');
        UI.setGate3(NA.Player.x + 330, NA.Player.y + 190);
      }
      if (UI.gateEntered() || NA.Input.pressed('confirm') || padPressed(0)) {
        NA.Time.setTimeScale(1);
        G.continueRun();
        return;
      }
      if (UI.gate2Entered()) { NA.Time.setTimeScale(1); G.restart(); return; }
      if (UI.gate3Entered()) { NA.Time.setTimeScale(1); G.toTitle(); }
    },

    /* -------------------------------------------------- ending sequence */
    /* fromBoss: the Singularity already played the white ring, the page flash
     * and the "one second of nothing", so the calm picks up mid-redraw. */
    startEnding: function (fromBoss) {
      UI.endT = fromBoss ? 1.8 : 0;
      UI.endPhase = fromBoss ? 1 : 0;
      UI.gate.active = UI.gate2.active = UI.gate3.active = false;
      UI._wasInside = UI._wasInside2 = UI._wasInside3 = false;
      if (!fromBoss) {
        FW.pageFlash(260);
        NA.FX.flash(0.5, 200);
        NA.FX.darkness(1, 400);
      }
      NA.Time.setTimeScale(0.6, 600);
      if (NA.Audio && NA.Audio.music) {
        if (NA.Audio.music.setLowpass) NA.Audio.music.setLowpass(0);
        if (NA.Audio.music.setIntensity) NA.Audio.music.setIntensity(0);
      }
    },

    tickEnding: function (dt) {
      UI.endT += dt;
      var t = UI.endT;
      /* hold any input to fast-forward to the choice */
      if (NA.Input.holdTime > 0.3 && t < 8.6) UI.endT = 8.6;

      if (UI.endPhase === 0 && t > 1.0) {                  // the arena redraws
        UI.endPhase = 1;
        NA.FX.darkness(0, 900);
        NA.Events.setBiome('ember');
      }
      if (UI.endPhase === 1 && t > 2.6) {                  // the ship drifts home
        UI.endPhase = 2;
      }
      if (UI.endPhase === 2 && t > 5.0) {                  // the chord resolves
        UI.endPhase = 3;
        if (NA.Audio && NA.Audio.music && NA.Audio.music.stinger) NA.Audio.music.stinger('victory');
        UI.ovDirty = true;
      }
      if (UI.endPhase === 3 && t > 6.2) {                  // the gate appears
        UI.endPhase = 4;
        UI.resetGate(NA.Arena.cx, NA.Arena.cy - 420);
        UI.gate.kind = 'start';
      }
      if (UI.endPhase === 4 && t > 7.4) {                  // the page cracks
        UI.endPhase = 5;
        sfx('bossPhase');
        NA.FX.chroma(3, 400);
      }
      if (UI.endPhase >= 5 && UI.endPhase < 6) {
        FW.pageCrack(M.clamp01((t - 7.4) / 1.0));
        if (t > 8.4) {
          UI.endPhase = 6;                                 // rings shatter, Encore peeks
          NA.FX.trauma(0.5);
          for (var i = 0; i < 40; i++) {
            var a = NA.RNG.f() * M.TAU, sp = 150 + NA.RNG.f() * 420;
            NA.Particles.frag(NA.Arena.cx, NA.Arena.cy, Math.cos(a) * sp, Math.sin(a) * sp,
              a, 18, 1.4, 1, 0.84, 0.3);
          }
          UI.gate.kind = 'endless';                        // the gate becomes infinity
          UI.setGate3(NA.Arena.cx + 430, NA.Arena.cy + 210);
          UI.ovDirty = true;
        }
      }
      /* the ship drifts to centre on its own during the calm */
      if (UI.endPhase >= 2 && UI.endPhase < 6) {
        var P = NA.Player;
        P.x = M.smooth(P.x, NA.Arena.cx, 1.6, dt);
        P.y = M.smooth(P.y, NA.Arena.cy, 1.6, dt);
      }
      if (UI.endPhase >= 6) {
        if (UI.gateEntered()) { NA.Game.toEndless(); return; }
        if (UI.gate3Entered()) { NA.Game.toTitle(); return; }
      }
    },

    /* ============================================ per-state GL chrome */
    renderState: function () {
      var G = NA.Game; if (!G) return;
      var s = G.state;
      if (s === 'title') UI.renderTitle();
      else if (s === 'death') UI.renderDeath();
      else if (s === 'draft') Draft.render();
      else if (s === 'pause') UI.renderPause();
      else if (s === 'ending') UI.renderEnding();
      UI.renderHints();
      FW.render();
    },

    /* UI contributions to the post chain — called after NA.FX.apply() */
    post: function () {
      var G = NA.Game; if (!G) return;
      var s = G.state;
      if (s === 'death') {
        NA.R.setPost({ desat: Math.max(NA.R.post.desat, 0.55) });
      } else if (s === 'pause') {
        NA.R.setPost({ desat: 0.72, darkness: 0.55 });
      } else if (s === 'draft') {
        NA.R.setPost({ darkness: 0.44 });
      } else if (s === 'title') {
        NA.R.setPost({ darkness: 0.20 });
      }
      if (FW.pageDim > 0) NA.R.setPost({ darkness: Math.max(0.2, FW.pageDim) });
    },

    /* ----------------------------------------------------------- title */
    renderTitle: function () {
      var R = NA.R, L = R.L, g = UI.gate, i;
      UI.renderGate(g, paletteOf('core'), true);
      if (UI.gate2.active) UI.renderGate(UI.gate2, paletteOf('gold'), false);

      /* the best-wave pip ring around the gate */
      var best = St.records.best || 0;
      var pc = paletteOf('player'), gc = paletteOf('gold');
      for (i = 0; i < 30; i++) {
        var a = i / 30 * M.TAU - M.HALFPI;
        var spike = ((i + 1) % 5) === 0, crown = i === 29;
        var rr = g.r * 2.15 + (spike ? 9 : 0);
        var on = i < best;
        var col = crown ? gc : pc;
        var px = g.x + Math.cos(a) * rr, py = g.y + Math.sin(a) * rr;
        if (crown) {
          /* a three-spike crown pip */
          var ca = on ? 1 : 0.2;
          for (var k = -1; k <= 1; k++) {
            var ka = a + k * 0.055;
            var hgt = k === 0 ? 15 : 9;
            R.line(L.VEIL, g.x + Math.cos(ka) * (rr - 3), g.y + Math.sin(ka) * (rr - 3),
              g.x + Math.cos(ka) * (rr + hgt), g.y + Math.sin(ka) * (rr + hgt),
              2, col[0], col[1], col[2], ca);
          }
          R.line(L.VEIL, g.x + Math.cos(a - 0.062) * (rr - 3), g.y + Math.sin(a - 0.062) * (rr - 3),
            g.x + Math.cos(a + 0.062) * (rr - 3), g.y + Math.sin(a + 0.062) * (rr - 3),
            2, col[0], col[1], col[2], ca);
        } else if (spike) {
          R.line(L.VEIL, g.x + Math.cos(a) * (rr - 5), g.y + Math.sin(a) * (rr - 5),
            g.x + Math.cos(a) * (rr + 6), g.y + Math.sin(a) * (rr + 6),
            2.2, col[0], col[1], col[2], on ? 0.9 : 0.18);
        } else {
          R.dot(L.VEIL, px, py, 2.4, col[0], col[1], col[2], on ? 0.85 : 0.16);
        }
      }

      /* the ghost ship of the best run's final form, inside the gate */
      var bs = St.records.bestSlots;
      withSlots(bs, function () {
        NA.Ship.render(g.x, g.y, NA.Time.real * 0.35, 0.26, 2.1);
      });
    },

    /* ----------------------------------------------------------- death */
    renderDeath: function () {
      var R = NA.R, L = R.L, P = NA.Player, G = NA.Game, i;
      var k = M.clamp01((P.deathT - 1.0) / 0.9);
      /* the faint ghost replay of the last 2 s, behind everything */
      if (G && G.replayN > 0) {
        var rp = G.replay, n = G.replayN;
        var head = G.replayHead;
        var loopT = (NA.Time.real * 0.5) % 1;
        for (i = 0; i < n; i++) {
          var idx = ((head - n + i) + G.REPLAY_MAX) % G.REPLAY_MAX;
          var f = i / n;
          var al = 0.10 + 0.12 * Math.max(0, 1 - Math.abs(f - loopT) * 6);
          R.dot(L.AFTER, rp[idx * 5], rp[idx * 5 + 1], 2.2, 0.55, 0.85, 1, al);
          if (rp[idx * 5 + 4] > 0) {
            R.dot(L.AFTER, rp[idx * 5 + 2], rp[idx * 5 + 3], 2.6, 1, 0.30, 0.35, al * 1.4);
          }
        }
        /* the killer, highlighted */
        if ((G.killerX || G.killerY) && M.dist2(G.killerX, G.killerY, P.x, P.y) > 60 * 60) {
          var kp = pulse(1.4, 0.25, 0.6);
          R.ring(L.VEIL, G.killerX, G.killerY, 22 + kp * 6, 1.8, 1, 0.22, 0.28, kp);
          R.dot(L.VEIL, G.killerX, G.killerY, 3, 1, 1, 1, kp);
        }
      }
      if (k <= 0) return;

      /* the ship, rebuilt from its shards, rotating on a pedestal of light */
      R.disc(L.VEIL, P.x, P.y, 230 * k, 0.30, 0.85, 1, 0.10 * k);
      for (i = 0; i < 3; i++) {
        var a0 = -M.HALFPI + (i - 1) * 0.5;
        R.line(L.VEIL, P.x + Math.cos(a0) * 40, P.y + 120,
          P.x + Math.cos(a0) * 12, P.y + 26, 3, 0.3, 0.85, 1, 0.18 * k);
      }
      NA.Ship.render(P.x, P.y, NA.Time.real * 0.5, 0.9 * k, 1.65);
      NA.R.light(P.x, P.y, 300, 0.8 * k);

      /* the run's ring of pips (boss waves are spikes) vs the best-run ghost */
      var reached = G ? G.wave : 0;
      var best = St.records.best || 0;
      var isRecord = reached > best || (G && G.newRecord);
      var pc = paletteOf('player'), gc = paletteOf('gold');
      var total = Math.max(30, reached);
      for (i = 0; i < Math.min(total, 60); i++) {
        var a = i / Math.min(total, 60) * M.TAU - M.HALFPI;
        var lit = i < reached;
        var boss = ((i + 1) % 5) === 0;
        var rr = 175;
        if (boss) {
          R.line(L.VEIL, P.x + Math.cos(a) * (rr - 6), P.y + Math.sin(a) * (rr - 6),
            P.x + Math.cos(a) * (rr + 9), P.y + Math.sin(a) * (rr + 9),
            2.2, pc[0], pc[1], pc[2], (lit ? 0.95 : 0.16) * k);
        } else {
          R.dot(L.VEIL, P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr, 3,
            pc[0], pc[1], pc[2], (lit ? 0.85 : 0.14) * k);
        }
      }
      /* best-run ghost ring outside; gold flare + expansion on a new record */
      var ghostR = 205 + (isRecord ? Math.sin(M.clamp01(P.deathT - 1.4) * 3) * 10 : 0);
      R.ring(L.VEIL, P.x, P.y, ghostR, isRecord ? 2.0 : 1.3,
        gc[0], gc[1], gc[2], (isRecord ? pulse(1.2, 0.35, 0.62) : 0.20) * k);
      if (isRecord && P.deathT < 2.6) {
        var fk = M.clamp01((P.deathT - 1.4) / 1.2);
        R.ring(L.VEIL, P.x, P.y, ghostR + fk * 90, 2.2 * (1 - fk),
          gc[0], gc[1], gc[2], (1 - fk) * 0.42);
      }
      /* past 30, an infinity segment for endless depth */
      if (reached > 30) {
        var s2 = 13;
        R.ring(L.VEIL, P.x - s2, P.y - 240, s2, 2.2, gc[0], gc[1], gc[2], 0.8 * k);
        R.ring(L.VEIL, P.x + s2, P.y - 240, s2, 2.2, gc[0], gc[1], gc[2], 0.8 * k);
      }
      UI.gate.kind = 'endless';        // the continue gate wears the infinity ring
      UI.renderGate(UI.gate, paletteOf('gold'), true);
      UI.renderGate(UI.gate2, paletteOf('core'), false);
      UI.renderGate(UI.gate3, paletteOf('player'), false);
    },

    /* ----------------------------------------------------------- pause */
    renderPause: function () {
      Menu.render();
    },

    /* ---------------------------------------------------------- ending */
    renderEnding: function () {
      var R = NA.R, L = R.L, i, t = UI.endT;
      var cx = NA.Arena.cx, cy = NA.Arena.cy;
      // F23: while the finale boss still holds the frame it draws its own
      // arena redraw and its own ship. Do not draw a second set on top.
      var bossOwns = !!(NA.Game && NA.Game._endBossOwns);
      /* the arena redraws itself from the centre outward */
      if (UI.endPhase >= 1 && !bossOwns) {
        var k = M.clamp01((t - 1.0) / 1.5);
        R.ring(L.MEMBRANE, cx, cy, NA.Arena.radius * M.easeOut(k), 3,
          1, 0.62, 0.32, 0.55 * (1 - k * 0.4));
        for (i = 0; i < 5; i++) {
          var rk = M.clamp01((t - 1.0 - i * 0.12) / 1.5);
          R.ring(L.FLOOR, cx, cy, NA.Arena.radius * M.easeOut(rk) * (0.35 + i * 0.16),
            1.4, 1, 0.55, 0.28, 0.20 * (1 - rk));
        }
      }
      /* two orbiting rings: upgrade icons (GL rings here, glyphs on the
       * overlay) and boss silhouettes */
      if (UI.endPhase >= 2) {
        /* the two rings live in screen space so they read at any camera zoom */
        var p = w2s(NA.Player.x, NA.Player.y);
        var md = Math.min(R.w, R.h);
        var pc = paletteOf('player'), gc = paletteOf('gold');
        R.sring(p.x, p.y, md * endRad(1), 1, pc[0], pc[1], pc[2],
          UI.endPhase >= 6 ? 0.05 : 0.15);
        R.sring(p.x, p.y, md * endRad(2), 1, gc[0], gc[1], gc[2],
          UI.endPhase >= 6 ? 0.05 : 0.12);
      }
      /* the Encore's inside-out hex peeking through the crack */
      if (UI.endPhase >= 6) {
        var pk = pulse(0.6, 0.35, 0.8);
        R.poly(L.VEIL, cx, cy - 250, 110, 6, NA.Time.real * 0.2, 3,
          1, 0.24, 0.68, pk * 0.5);
        R.poly(L.VEIL, cx, cy - 250, 70, 6, -NA.Time.real * 0.3, 2,
          1, 0.24, 0.68, pk * 0.35);
      }
      UI.renderGate(UI.gate, UI.gate.kind === 'endless' ? paletteOf('gold') : paletteOf('core'), true);
      UI.renderGate(UI.gate3, paletteOf('player'), false);
    },

    /* -------------------------------------------------- diegetic hints */
    renderHints: function () {
      var R = NA.R, L = R.L, P = NA.Player, i;
      if (!P.alive) return;
      var wc = paletteOf('white');
      var z = 1 / M.clamp(NA.Cam.zoom, 0.25, 1.4);      // hints read at any zoom
      if (UI.hintMove > 0.02) {
        /* four blank keycaps under the ship (W / A S D), no letters */
        var b = 11 * z, y0 = P.y + 66 * z + b * 2.6;
        var al = UI.hintMove * pulse(1, 0.35, 0.75);
        keycap(P.x, y0 - b * 2.6, b, al);
        keycap(P.x - b * 2.6, y0, b, al * 0.85);
        keycap(P.x, y0, b, al * 0.85);
        keycap(P.x + b * 2.6, y0, b, al * 0.85);
      }
      if (UI.hintFire > 0.02) {
        /* a mouse glyph blinking by the reticle */
        var mr = 12 * z;
        var mx = P.aimX + mr * 2.6, my = P.aimY - mr * 0.5;
        var a2 = UI.hintFire * pulse(1.3, 0.3, 0.8);
        R.poly(L.VEIL, mx, my, mr, 4, 0, 1.6, wc[0], wc[1], wc[2], a2);
        R.line(L.VEIL, mx, my - mr, mx, my - mr * 0.1, 1.4, wc[0], wc[1], wc[2], a2);
        R.dot(L.VEIL, mx - mr * 0.4, my - mr * 0.55, 2.6, 1, 0.55, 0.2, a2);
      }
      if (UI.hintDash > 0.02) {
        /* a dash chevron pair plus a highlighted mana notch */
        var da = UI.hintDash * pulse(2.5, 0.4, 1);
        var ang = Math.atan2(P.vy, P.vx) || 0;
        for (i = 0; i < 2; i++) {
          var dr = (32 + i * 13) * z;
          R.sprite(L.VEIL, 'chevron', P.x - Math.cos(ang) * dr, P.y - Math.sin(ang) * dr,
            ang, 9 * z, 9 * z, 0.3, 1, 0.42, da * (1 - i * 0.35));
        }
        R.ring(L.VEIL, P.x, P.y - C.SHIP_R * 2.6, 4, 1.6, 0.3, 1, 0.42, da);
      }
      if (Draft.active && UI.hintDraft > 0.02 && Draft._cards.length) {
        /* a pointer nudge at the middle card (screen space) */
        var c = Draft._cards[Draft._cards.length >> 1];
        var bob = Math.sin(NA.Time.real * 4) * 8;
        var al2 = UI.hintDraft * 0.85;
        R.sline(c.x, c.y + c.r * 1.55 + bob, c.x, c.y + c.r * 1.20 + bob, 2.4, 1, 1, 1, al2);
        R.spoly(c.x, c.y + c.r * 1.20 + bob, 8, 3, -M.HALFPI, 2, 1, 1, 1, al2);
      }
    },

    /* ==================================================================
     * the #ui Canvas2D icon pass — redrawn only when something changes
     * ================================================================== */
    renderOverlay: function () {
      var ctx = NA.R.uictx; if (!ctx) return;
      var sg = UI._ovSg;
      var I = NA.Icons;
      var G = NA.Game, s = G ? G.state : '';
      /* cheap change detection: a signature plus a 30 Hz animation tick for
       * the screens that actually move. */
      var live = (s === 'draft' || s === 'pause' || s === 'title' || s === 'death' || s === 'ending');
      /* The signature is compared component by component against cached
       * scalars - no string is built per frame. The camera is part of it: every
       * w2s()-anchored glyph (the endless wave number, the detached HUD rects)
       * would otherwise freeze in place through a camera move in a non-live
       * state and slide off its anchor. */
      var camQ = ((NA.Cam.x | 0) * 8192 + (NA.Cam.y | 0)) + (NA.Cam.zoom * 512 | 0) * 0.0001;
      var stripQ = UI.buildStripT > 0 ? countOwned() : -1;
      if (sg[0] !== s || sg[1] !== NA.R.w || sg[2] !== NA.R.h ||
        sg[3] !== (Draft.active ? Draft._seq : -1) || sg[4] !== Draft.hover ||
        sg[5] !== Menu.hover || sg[6] !== Menu.sel || sg[7] !== stripQ ||
        sg[8] !== UI.paletteIndex || sg[9] !== FW.digitN || sg[10] !== camQ) {
        sg[0] = s; sg[1] = NA.R.w; sg[2] = NA.R.h;
        sg[3] = Draft.active ? Draft._seq : -1; sg[4] = Draft.hover;
        sg[5] = Menu.hover; sg[6] = Menu.sel; sg[7] = stripQ;
        sg[8] = UI.paletteIndex; sg[9] = FW.digitN; sg[10] = camQ;
        UI.ovDirty = true;
      }
      if (!UI.ovDirty) {
        if (!live && FW.digitN === 0) return;
        if (UI.ovT < 1 / 30) return;
      }
      UI.ovT = 0; UI.ovDirty = false;

      var dpr = NA.R.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, NA.R.w, NA.R.h);
      if (!I || !I.draw) return;
      var u = us();

      if (Draft.active) drawDraftOverlay(ctx, I, u);
      if (s === 'pause') drawMenuOverlay(ctx, I, u);
      if (s === 'title') drawTitleOverlay(ctx, I, u);
      if (s === 'death') drawDeathOverlay(ctx, I, u);
      if (s === 'ending') drawEndingOverlay(ctx, I, u);
      if (UI.buildStripT > 0 || s === 'pause') drawBuildStrip(ctx, I, u);
      if (UI.photo > 0 && s !== 'pause') {
        I.draw(ctx, 'photosensitivity', NA.R.w * 0.5, NA.R.h * 0.18, 56 * u,
          { color: hx('gold'), glow: 0.7, alpha: M.clamp01(UI.photo) * 0.9 });
      }
      if (HUD.showPips() && NA.Game && NA.Game.wave > 30) {
        var wEl = hudEl('wave');
        var p = w2s(wEl.x + NA.Arena.radius * 0.62 + 78, wEl.y + 4);
        I.number(ctx, NA.Game.wave, p.x, p.y, 22 * u, { color: hx('gold'), glow: 0.5 });
      }
      FW.drawDigits(ctx, I, u);
    },

    /* legacy names other modules may still call */
    fourthWall: null
  };

  function countOwned() { var n = 0; for (var k in NA.Upgrades.owned) n++; return n; }

  function keycap(x, y, b, a) {
    var R = NA.R, L = R.L;
    R.poly(L.VEIL, x, y, b, 4, M.HALFPI * 0.5, 2, 1, 1, 1, a);
    R.disc(L.VEIL, x, y, b * 1.2, 1, 1, 1, a * 0.10);
  }

  function withSlots(slots, fn) {
    if (!slots) { fn(); return; }
    var save = {}, k;
    for (k in NA.Ship.slots) save[k] = NA.Ship.slots[k];
    for (k in NA.Ship.slots) NA.Ship.slots[k] = slots[k] | 0;
    try { fn(); } finally { for (k in NA.Ship.slots) NA.Ship.slots[k] = save[k]; }
  }

  /* ---- draft card text (the one place in the game that has words) -------
   * AGENT_RULES §5 forbids text everywhere else; the owner asked for a name
   * and a one-line effect on every draft card so a pick is a decision and not
   * a guess. The strings live in src/11c_upgrade_text.js (pure data).
   * Wraps into WRAP (reused, never reallocated) at most MAX_DESC_LINES. */
  var TEXT_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  var WRAP = [];
  var MAX_DESC_LINES = 3;

  /* Greedy word wrap against the live ctx.font. Returns the number of lines
   * written into WRAP; the last line is ellipsised if the text overflows. */
  function wrapText(ctx, s, maxW) {
    WRAP.length = 0;
    if (!s) return 0;
    var words = s.split(' '), line = '';
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + ' ' + words[i] : words[i];
      if (line && ctx.measureText(next).width > maxW) {
        WRAP.push(line);
        line = words[i];
        if (WRAP.length === MAX_DESC_LINES) break;
      } else line = next;
    }
    if (WRAP.length < MAX_DESC_LINES && line) WRAP.push(line);
    else if (line) {
      /* overflow: fold what is left onto the last line with an ellipsis */
      var last = WRAP[MAX_DESC_LINES - 1];
      while (last.length > 4 && ctx.measureText(last + '…').width > maxW)
        last = last.slice(0, -1).replace(/\s+$/, '');
      WRAP[MAX_DESC_LINES - 1] = last + '…';
    }
    return WRAP.length;
  }

  /* Name above the hex, effect below it. Both centred on c.x; the hex
   * silhouette narrows to a point at top and bottom, so neither fits inside.
   * The text column is kept inside the card pitch (gap = r * 2.05) so two
   * neighbours can never collide. */
  function drawCardText(ctx, c, r, hov, u) {
    var UT = NA.UpgradeText;
    if (!UT) return;
    var maxW = r * 1.62;   /* pitch is r * 2.05: leaves a clear gutter */
    var ns = Math.min(13 * u, r * 0.130);
    var ds = Math.min(11 * u, r * 0.105);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    /* the name, in the card colour, just above the top vertex */
    var name = UT.nameOf(c.id);
    ctx.font = '600 ' + ns.toFixed(1) + 'px ' + TEXT_FONT;
    ctx.fillStyle = c.hexcol;
    ctx.shadowColor = c.hexcol;
    ctx.shadowBlur = hov ? 10 : 4;
    ctx.globalAlpha = hov ? 1 : 0.9;
    ctx.fillText(name, c.x, c.y - r - ns * 0.5);
    ctx.shadowBlur = 0;

    /* the effect of the tier being offered, muted, below the hex */
    var desc = UT.descOf(c.id, c.tier);
    if (!desc) { ctx.globalAlpha = 1; return; }
    ctx.font = ds.toFixed(1) + 'px ' + TEXT_FONT;
    ctx.fillStyle = hov ? 'rgba(222,238,248,0.92)' : 'rgba(190,215,230,0.72)';
    ctx.globalAlpha = 1;
    var n = wrapText(ctx, desc, maxW);
    var lh = ds * 1.28;
    for (var i = 0; i < n; i++) ctx.fillText(WRAP[i], c.x, c.y + r + ds * 1.15 + i * lh);
  }

  /* -------------------------------------------------- overlay painters */
  function drawDraftOverlay(ctx, I, u) {
    for (var i = 0; i < Draft._cards.length; i++) {
      var c = Draft._cards[i];
      var hov = Draft.hover === i;
      var r = c.r * c.scale;
      ctx.save();
      ctx.globalAlpha = 1;
      /* the crisp rounded-hex (or jagged wildcard) frame */
      ctx.strokeStyle = c.hexcol;
      ctx.lineWidth = hov ? 2.4 : 1.5;
      ctx.shadowColor = c.hexcol; ctx.shadowBlur = hov ? 14 : 6;
      if (c.wild) jagHex(ctx, c.x, c.y, r, M.HALFPI);
      else roundHex(ctx, c.x, c.y, r, M.HALFPI, r * 0.22);
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* icon with tier frame and pips (the NEXT pip blinks) */
      I.draw(ctx, c.id, c.x, c.y - r * 0.54, r * 0.60, {
        tier: c.tier, color: c.hexcol, frame: !c.wild, wild: c.wild,
        glow: hov ? 0.9 : 0.4
      });
      var bl = 0.35 + 0.65 * Math.abs(Math.sin(NA.Time.real * 4));
      for (var t = 0; t < 3; t++) {
        ctx.globalAlpha = t < c.tier - 1 ? 0.95 : (t === c.tier - 1 ? bl : 0.18);
        ctx.fillStyle = c.hexcol;
        ctx.beginPath();
        ctx.arc(c.x + (t - 1) * r * 0.10, c.y - r * 0.20, r * 0.030, 0, M.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* the live mini-simulation */
      var sw = r * 1.20, sh = r * 0.42;
      simDraw(ctx, c, c.x - sw * 0.5, c.y + r * 0.06, sw, sh);

      /* the ship silhouette after the pick, with the new slot highlighted */
      I.ship(ctx, c.x, c.y + r * 0.68, r * 0.44, c.after,
        { color: hov ? '#FFFFFF' : c.hexcol, alpha: hov ? 0.95 : 0.6, glow: hov ? 0.7 : 0 });
      if (c.slot) {
        var si = NA.Ship.SLOTS.indexOf(c.slot);
        var n = NA.Ship.SLOTS.length;
        for (var q = 0; q < n; q++) {
          var px = c.x + (q - (n - 1) * 0.5) * r * 0.070;
          var py = c.y - r * 0.06;
          ctx.fillStyle = c.hexcol;
          ctx.globalAlpha = q === si ? (0.4 + 0.6 * Math.abs(Math.sin(NA.Time.real * 5))) : 0.16;
          ctx.beginPath(); ctx.arc(px, py, r * 0.023, 0, M.TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      /* a swap glyph for a mutually exclusive pick */
      if (c.swap) swapGlyph(ctx, c.x + r * 0.54, c.y - r * 0.70, r * 0.13, c.hexcol);
      /* the card's name and the effect of the tier on offer */
      drawCardText(ctx, c, r, hov, u);
      ctx.restore();
    }
    /* reroll + skip glyphs */
    var by = Draft.hexY;
    var canRr = !Draft.rerolled && NA.Player.mana >= 40;
    I.draw(ctx, 'reroll', NA.R.w * 0.5 - Draft.hexX, by, Draft.hexR * 1.4,
      { color: canRr ? hx('player') : '#4A5560', glow: Draft.hoverReroll ? 0.8 : 0.2, alpha: canRr ? 1 : 0.5 });
    I.draw(ctx, 'skip', NA.R.w * 0.5 + Draft.hexX, by, Draft.hexR * 1.4,
      { color: hx('red'), glow: Draft.hoverSkip ? 0.8 : 0.2 });
  }

  function drawMenuOverlay(ctx, I, u) {
    for (var i = 0; i < MENU.length; i++) {
      var it = MENU[i], p = Menu._pos[i];
      if (!p) continue;
      var hov = (Menu.hover === i) || (Menu.hover < 0 && Menu.sel === i);
      var col = hov ? '#FFFFFF' : hx('player');
      var ox = 0, oy = 0;
      if (it.id === 'shake' && hov) {
        var mag = St.settings.shake * 1.6;
        ox = (Math.random() - 0.5) * mag; oy = (Math.random() - 0.5) * mag;
      }
      if (it.kind !== 'btn') {
        var v = it.kind === 'toggle' ? it.get() : it.get();
        I.slider(ctx, p.x, p.y, Menu.isz * 1.5, M.clamp01(v), col);
      }
      I.draw(ctx, it.id, p.x + ox, p.y + oy, Menu.isz * 0.78,
        { color: col, glow: hov ? 0.8 : 0.25, alpha: it.kind === 'toggle' && it.get() < 0.5 ? 0.45 : 1 });
      /* colourblind: a live preview strip of enemy colours */
      if (it.id === 'colorblind') {
        var names = ['red', 'orange', 'acid', 'green', 'magenta'];
        for (var q = 0; q < names.length; q++) {
          ctx.fillStyle = hx(names[q]);
          ctx.globalAlpha = 0.9;
          ctx.fillRect(p.x - 26 * u + q * 11 * u, p.y + Menu.isz * 0.72, 8 * u, 5 * u);
        }
        ctx.globalAlpha = 1;
      }
    }
    /* the one-time photosensitivity glyph before the first supernova */
    if (UI.photo > 0) {
      I.draw(ctx, 'photosensitivity', NA.R.w * 0.5, NA.R.h * 0.16, 54 * u,
        { color: hx('gold'), glow: 0.7, alpha: M.clamp01(UI.photo) });
    }
  }

  function drawTitleOverlay(ctx, I, u) {
    /* the bestiary ring on the outer rim: everything you have ever killed */
    var seen = St.records.seen || {}, ids = [], k;
    for (k in seen) ids.push(k);
    if (ids.length > 28) ids.length = 28;
    var cx = NA.Arena.cx, cy = NA.Arena.cy;
    var rot = NA.Time.real * 0.04;
    for (var i = 0; i < ids.length; i++) {
      var a = rot + i / ids.length * M.TAU;
      var p = w2s(cx + Math.cos(a) * (NA.Arena.radius + 78), cy + Math.sin(a) * (NA.Arena.radius + 78));
      if (p.x < -40 || p.x > NA.R.w + 40 || p.y < -40 || p.y > NA.R.h + 40) continue;
      var parts = ids[i].split(':');
      if (parts[0] === 'b') I.boss(ctx, parts[1], p.x, p.y, 26 * u, { color: hx('gold'), alpha: 0.42 });
      else I.enemy(ctx, parts[1], p.x, p.y, 22 * u, { color: hx('magenta'), alpha: 0.38 });
    }
    /* settings icons sliding up from the bottom rim */
    if (UI.settingsPeek > 0.02) {
      var y = NA.R.h - 46 * u * UI.settingsPeek + (1 - UI.settingsPeek) * 40;
      var strip = SETTINGS_STRIP;
      for (var q = 0; q < strip.length; q++) {
        var x = NA.R.w * 0.5 + (q - (strip.length - 1) * 0.5) * 54 * u;
        I.draw(ctx, strip[q], x, y, 34 * u,
          { color: hx('player'), alpha: UI.settingsPeek * 0.9, glow: 0.3 });
      }
    }
    /* the endless infinity marker, once wave 30 is beaten */
    if (St.records.beat30) {
      var g2 = w2s(UI.gate2.x, UI.gate2.y);
      I.draw(ctx, 'infinity', g2.x, g2.y, 40 * u, { color: hx('gold'), glow: 0.8 });
    }
  }

  /* Death tally -- zero text (AGENT_RULES 5), so the count is pips: one dim
   * dot per death, and every tenth death collapses into one bright dot on the
   * row above.  Reads at a glance up to a few hundred, which is more deaths
   * than any run will survive the patience for. */
  function drawDeathTally(ctx, u, y, alpha) {
    var n = (NA.Game && NA.Game.deaths) | 0;
    if (n <= 0) return;
    var tens = (n / 10) | 0, ones = n % 10;
    var cx = NA.R.w * 0.5, gap = 11 * u, i, x0;
    ctx.save();
    if (tens > 0) {
      var tn = Math.min(tens, 40);
      x0 = cx - (tn - 1) * gap * 0.5;
      ctx.fillStyle = hx('gold');
      for (i = 0; i < tn; i++) {
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(x0 + i * gap, y, 3.4 * u, 0, M.TAU); ctx.fill();
      }
    }
    if (ones > 0) {
      x0 = cx - (ones - 1) * gap * 0.5;
      ctx.fillStyle = hx('white');
      for (i = 0; i < ones; i++) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.arc(x0 + i * gap, y + (tens > 0 ? 13 * u : 0), 2.4 * u, 0, M.TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawDeathOverlay(ctx, I, u) {
    var G = NA.Game; if (!G) return;
    if (UI.gate.active) {
      /* the continue gate reads as the endless glyph: the run does not end */
      var pc = w2s(UI.gate.x, UI.gate.y);
      I.draw(ctx, 'infinity', pc.x, pc.y, 44 * u,
        { color: hx('gold'), glow: pulse(0.8, 0.55, 0.9), alpha: 0.95 });
    }
    if (UI.gate2.active) {
      var pr = w2s(UI.gate2.x, UI.gate2.y);
      I.draw(ctx, 'reroll', pr.x, pr.y, 32 * u, { color: hx('white'), glow: 0.4, alpha: 0.7 });
    }
    if (UI.gate3.active) {
      var ph = w2s(UI.gate3.x, UI.gate3.y);
      I.draw(ctx, 'home', ph.x, ph.y, 34 * u, { color: hx('player'), glow: 0.5, alpha: 0.85 });
    }
    drawDeathTally(ctx, u, 26 * u, 0.75);
    var picks = G.picks || [];
    if (!picks.length) return;
    /* the upgrade timeline strip: what you took, in the order you took it */
    var n = Math.min(picks.length, 14);
    var sz = 34 * u, gap = sz * 1.18;
    var y = NA.R.h - 76 * u;
    var x0 = NA.R.w * 0.5 - (n - 1) * gap * 0.5;
    for (var i = 0; i < n; i++) {
      var id = picks[picks.length - n + i];
      ctx.strokeStyle = 'rgba(120,190,220,0.30)';
      ctx.lineWidth = 1;
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(x0 + (i - 1) * gap + sz * 0.5, y);
        ctx.lineTo(x0 + i * gap - sz * 0.5, y);
        ctx.stroke();
      }
      I.draw(ctx, id, x0 + i * gap, y, sz, {
        tier: NA.Upgrades.tier(id) || 1, color: hxOf(famColor(id)), frame: true, alpha: 0.9
      });
    }
  }

  function endRad(which) { return which === 1 ? 0.22 : 0.36; }

  function drawEndingOverlay(ctx, I, u) {
    var G = NA.Game; if (!G) return;
    var cx = NA.Arena.cx, cy = NA.Arena.cy, i;
    var picks = G.picks || [], bosses = G.bossesBeaten || [];
    var rot = NA.Time.real * 0.16;
    var fade = UI.endPhase >= 6 ? 0.25 : 1;
    var ctr = w2s(NA.Player.x, NA.Player.y);
    var md = Math.min(NA.R.w, NA.R.h);
    var n1 = Math.min(picks.length, 20);
    for (i = 0; i < n1; i++) {
      var a = rot + i / Math.max(1, n1) * M.TAU;
      var kk = M.clamp01((UI.endT - 2.6 - i * 0.05) / 0.8);
      if (kk < 0.02) continue;
      var rr = md * endRad(1) * M.easeOut(kk);
      I.draw(ctx, picks[i], ctr.x + Math.cos(a) * rr, ctr.y + Math.sin(a) * rr, 34 * u, {
        tier: NA.Upgrades.tier(picks[i]) || 1, color: hxOf(famColor(picks[i])),
        alpha: 0.92 * fade * kk, glow: 0.4
      });
    }
    var n2 = Math.min(bosses.length, 20);
    for (i = 0; i < n2; i++) {
      var a2 = -rot * 0.7 + i / Math.max(1, n2) * M.TAU;
      var k2 = M.clamp01((UI.endT - 4.0 - i * 0.06) / 0.8);
      if (k2 < 0.02) continue;
      var rr2 = md * endRad(2) * M.easeOut(k2);
      I.boss(ctx, bosses[i], ctr.x + Math.cos(a2) * rr2, ctr.y + Math.sin(a2) * rr2, 34 * u,
        { color: hx('gold'), alpha: 0.8 * fade * k2 });
    }
    /* the run's death tally, under the upgrade ring */
    drawDeathTally(ctx, u, NA.R.h - 120 * u, 0.85 * fade);
    if (UI.endPhase >= 6) {
      /* the Encore hex peeking through the crack */
      var pe = w2s(cx, cy - 250);
      I.boss(ctx, 'encore', pe.x, pe.y, 64 * u, { color: '#FF3CAC', alpha: pulse(0.6, 0.4, 0.8), glow: 0.6 });
      var pg = w2s(UI.gate.x, UI.gate.y);
      I.draw(ctx, 'infinity', pg.x, pg.y, 44 * u, { color: hx('gold'), glow: 0.9 });
      var ph = w2s(UI.gate3.x, UI.gate3.y);
      I.draw(ctx, 'home', ph.x, ph.y, 34 * u, { color: hx('player'), glow: 0.5 });
    }
  }

  function drawBuildStrip(ctx, I, u) {
    var ids = NA.Upgrades.ownedIds();
    if (!ids.length) return;
    var paused = NA.Game && NA.Game.state === 'pause';
    var a = paused ? 1 : M.clamp01(UI.buildStripT / 0.4);
    var n = Math.min(ids.length, 12);
    var sz = 30 * u, gap = sz * 1.25;
    var y = paused ? 34 * u : NA.R.h - 34 * u;
    var x0 = NA.R.w * 0.5 - (n - 1) * gap * 0.5;
    for (var i = 0; i < n; i++) {
      var id = ids[i], tier = NA.Upgrades.tier(id) || 1;
      I.draw(ctx, id, x0 + i * gap, y, sz, {
        tier: tier, color: hxOf(famColor(id)), alpha: a * 0.92
      });
      for (var t = 0; t < 3; t++) {
        ctx.globalAlpha = a * (t < tier ? 0.9 : 0.16);
        ctx.fillStyle = hxOf(famColor(id));
        ctx.beginPath();
        ctx.arc(x0 + i * gap + (t - 1) * 5 * u, y + sz * 0.60, 1.7 * u, 0, M.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ==================================================================
   * 7. FOURTH WALL — AGENT_RULES §9
   * ================================================================== */
  var FW = {
    _dom: null, _style: false,
    torn: false, pageDim: 0, crack: 0, digitN: 0, _dimQ: 0, _dimEl: null,
    _fake: null, _flash: null, _crackEls: null, _obst: [], _obstEls: null,
    _viewport: false, _scroll: null, _obstT: 0, _tall: null,
    _digits: [],
    _tearT: -1, _healT: -1,

    _el: function () {
      if (FW._dom) return FW._dom;
      try { FW._dom = document.getElementById('dom'); } catch (e) { FW._dom = null; }
      return FW._dom;
    },
    _css: function () {
      if (FW._style) return;
      FW._style = true;
      try {
        var s = document.createElement('style');
        s.textContent =
          '.na-fd{position:absolute;inset:0;pointer-events:none;overflow:hidden}' +
          '.na-fd-h{position:absolute;top:0;height:100%;width:50%;overflow:hidden;' +
          'transition:transform .55s cubic-bezier(.3,.1,.2,1),opacity .55s linear;will-change:transform}' +
          '.na-fd-l{left:0}.na-fd-r{left:50%}' +
          '.na-fd.torn .na-fd-l{transform:translate(-16%,4%) rotate(-5deg)}' +
          '.na-fd.torn .na-fd-r{transform:translate(16%,-4%) rotate(5deg)}' +
          '.na-fd-card{position:absolute;top:30%;width:150px;height:190px;' +
          'background:rgba(6,10,18,.86);border:2px solid #4DF3FF;' +
          'clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);' +
          'box-shadow:0 0 24px rgba(77,243,255,.35)}' +
          '.na-fd-ic{position:absolute;left:50%;top:26%;width:52px;height:52px;margin-left:-26px;' +
          'border:2px solid #4DF3FF;border-radius:6px;transform:rotate(45deg);opacity:.85}' +
          '.na-fd-pip{position:absolute;left:50%;top:66%;width:8px;height:8px;margin-left:-4px;' +
          'border-radius:50%;background:#4DF3FF;opacity:.8}' +
          '.na-flash{position:absolute;inset:0;background:#fff;opacity:.85;pointer-events:none;' +
          'transition:opacity .25s linear}' +
          '.na-crack{position:absolute;height:2px;background:#EAFBFF;pointer-events:none;' +
          'transform-origin:0 50%;box-shadow:0 0 10px rgba(234,251,255,.9),0 0 26px rgba(255,60,172,.5)}' +
          '.na-obst{position:absolute;background:rgba(10,16,26,.9);border:1px solid #2A3B4D;' +
          'border-radius:4px;pointer-events:none}' +
          '.na-tall{position:absolute;left:0;top:0;width:1px;height:3000px;pointer-events:none}';
        (document.head || document.body).appendChild(s);
      } catch (e) { }
    },
    _mk: function (cls, parent) {
      try {
        var d = document.createElement('div');
        d.className = cls;
        (parent || FW._el()).appendChild(d);
        return d;
      } catch (e) { return null; }
    },
    _rm: function (el) {
      try { if (el && el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); } catch (e) { }
    },

    /* ---- the fake draft panel that tears in two ---- */
    tearDraft: function () {
      FW._css();
      FW.torn = false;
      Draft.fake = true;
      if (!FW._fake) {
        var root = FW._mk('na-fd');
        if (root) {
          for (var half = 0; half < 2; half++) {
            var h = FW._mk('na-fd-h ' + (half ? 'na-fd-r' : 'na-fd-l'), root);
            for (var i = 0; i < 3; i++) {
              var c = FW._mk('na-fd-card', h);
              if (!c) continue;
              try {
                c.style.left = (14 + i * 30 - (half ? 50 : 0)) + '%';
                FW._mk('na-fd-ic', c);
                FW._mk('na-fd-pip', c);
              } catch (e) { }
            }
          }
        }
        FW._fake = root;
      }
      FW._tearT = 0.9;
      // a second call must not orphan the first continuation
      FW._settle('_tearRes', false);
      return new Promise(function (res) { FW._tearRes = res; });
    },
    healDraft: function () {
      Draft.fake = false;
      try { if (FW._fake && FW._fake.classList) FW._fake.classList.remove('torn'); } catch (e) { }
      FW._healT = 0.6;
      Draft.bonusCards = Math.max(Draft.bonusCards, 1);
      FW._settle('_healRes', false);
      return new Promise(function (res) { FW._healRes = res; });
    },
    /* Resolve an outstanding tear/heal promise. false == "torn down", so a
     * caller can tell a completed gag from a reset (AGENT_RULES 9). */
    _settle: function (key, ok) {
      var r = FW[key];
      if (r) { FW[key] = null; try { r(ok); } catch (e) { } }
    },
    tearDraftPanel: function (a) { if (a === undefined || a > 0) FW.tearDraft(); else FW.healDraft(); },
    heal: function () { return FW.healDraft(); },

    /* ---- page-wide filters ---- */
    dimPage: function (amount) {
      var a = typeof amount === 'boolean' ? (amount ? 0.65 : 0) : M.clamp01(amount || 0);
      FW.pageDim = a;
      // No-op when the quantised amount has not moved: bosses ramp this with a
      // continuous 0..1 value, and every write re-promotes a whole compositing
      // layer plus two toFixed() strings.
      var q = a <= 0 ? 0 : (a * 64 + 0.5) | 0;
      if (q === FW._dimQ) return;
      FW._dimQ = q;
      try {
        // The filter goes on #wrap, never <body>: a filtered body becomes the
        // containing block for position:fixed, so the arena canvases would
        // scroll away while viewportArena(true) has the page scrollable.
        var el = FW._dimEl;
        if (!el) el = FW._dimEl = (document.getElementById('wrap') || document.body);
        document.body.classList.remove('na-dim');
        if (document.body.style.filter) document.body.style.filter = '';
        if (q === 0) el.style.filter = '';
        else {
          el.style.filter = 'brightness(' + (1 - a * 0.8).toFixed(3) +
            ') saturate(' + (1 - a * 0.6).toFixed(3) + ')';
        }
      } catch (e) { }
    },

    pageFlash: function (ms) {
      FW._css();
      try {
        if (!FW._flash) FW._flash = FW._mk('na-flash');
        if (FW._flash) {
          FW._flash.style.opacity = String(0.85 * M.clamp01(St.settings.flash));
          FW._flashT = (ms || 120) / 1000;
        }
      } catch (e) { }
    },

    pageCrack: function (p) {
      FW._css();
      FW.crack = M.clamp01(p || 0);
      try {
        // pageCrack(0) means "the page is whole again": take the 14 shard
        // divs back out instead of leaving them invisible in the DOM
        if (FW.crack <= 0) {
          if (FW._crackEls) { for (var z = 0; z < FW._crackEls.length; z++) FW._rm(FW._crackEls[z]); }
          FW._crackEls = null;
          return;
        }
        if (!FW._crackEls) {
          FW._crackEls = [];
          var w = (window.innerWidth || 1600), h = (window.innerHeight || 900);
          var x = -20, y = h * 0.32, n = 14;
          for (var i = 0; i < n; i++) {
            var len = (w + 60) / n;
            var ang = (i % 2 ? 1 : -1) * (0.10 + (i % 3) * 0.07);
            var el = FW._mk('na-crack');
            if (el) {
              el.style.left = x + 'px';
              el.style.top = y + 'px';
              el.style.width = len + 'px';
              el.style.transform = 'rotate(' + ang + 'rad)';
              el.style.opacity = '0';
              FW._crackEls.push(el);
            }
            x += Math.cos(ang) * len;
            y += Math.sin(ang) * len;
          }
        }
        var lit = Math.round(FW.crack * FW._crackEls.length);
        for (var q = 0; q < FW._crackEls.length; q++) {
          FW._crackEls[q].style.opacity = q < lit ? '1' : '0';
        }
      } catch (e) { }
    },

    /* ---- the arena eats the browser viewport ---- */
    viewportArena: function (on) {
      FW._css();
      FW._viewport = !!on;
      try {
        if (on) {
          document.body.style.overflowY = 'auto';
          document.documentElement.style.overflowY = 'auto';
          if (!FW._obstEls) {
            FW._obstEls = [];
            // the tall spacer that makes the page scrollable — tracked, or it
            // outlives the fight and leaks a node into #dom
            FW._tall = FW._mk('na-tall');
            var w = (window.innerWidth || 1600), h = (window.innerHeight || 900);
            var spots = [[0.10, 0.18, 0.16, 0.07], [0.68, 0.24, 0.22, 0.06],
            [0.30, 0.62, 0.24, 0.05], [0.74, 0.70, 0.14, 0.09],
            [0.44, 0.40, 0.12, 0.05]];
            for (var i = 0; i < spots.length; i++) {
              var e = FW._mk('na-obst');
              if (!e) continue;
              e.style.left = ((spots[i][0] * w) | 0) + 'px';
              e.style.top = ((spots[i][1] * h) | 0) + 'px';
              e.style.width = ((spots[i][2] * w) | 0) + 'px';
              e.style.height = ((spots[i][3] * h) | 0) + 'px';
              e._r = { sx: spots[i][0] * w, sy: spots[i][1] * h, sw: spots[i][2] * w, sh: spots[i][3] * h };
              FW._obstEls.push(e);
              FW._obst.push({ x: 0, y: 0, w: 0, h: 0 });
            }
          }
        } else {
          document.body.style.overflowY = 'hidden';
          document.documentElement.style.overflowY = '';
          if (FW._obstEls) { for (var q = 0; q < FW._obstEls.length; q++) FW._rm(FW._obstEls[q]); }
          FW._rm(FW._tall); FW._tall = null;
          FW._obstEls = null; FW._obst.length = 0;
        }
      } catch (e) { }
    },

    /* world-space rects of the page furniture (reused objects, no alloc) */
    obstacles: function () {
      if (!FW._obstEls) return FW._obst;
      for (var i = 0; i < FW._obstEls.length; i++) {
        var e = FW._obstEls[i], o = FW._obst[i], r = e._r;
        if (!r) continue;
        var a = s2w(r.sx, r.sy);
        var ax = a.x, ay = a.y;
        var b = s2w(r.sx + r.sw, r.sy + r.sh);
        o.x = (ax + b.x) * 0.5; o.y = (ay + b.y) * 0.5;
        o.w = Math.abs(b.x - ax); o.h = Math.abs(b.y - ay);
      }
      return FW._obst;
    },

    scrollPage: function (dy, ms) {
      if (!ms) { try { window.scrollBy(0, dy); } catch (e) { } return; }
      FW._scroll = { left: dy, t: (ms || 500) / 1000, total: (ms || 500) / 1000 };
    },

    /* ---- HUD element rects, detach/attach ---- */
    hudRects: function () { return hudEls; },
    hudDetach: function (id) {
      var e = hudEl(id); if (!e || e.detached) return null;
      e.detached = 1; e.t = 0;
      e.vx = NA.RNG.range(-40, 40); e.vy = NA.RNG.range(-30, 30);
      sfx('bossPhase');
      return e;
    },
    /* reattach every HUD element (player death, run reset) */
    hudAttachAll: function () {
      for (var i = 0; i < hudEls.length; i++) { hudEls[i].detached = 0; hudEls[i].vx = hudEls[i].vy = 0; }
    },
    hudAttach: function (id) {
      var e = hudEl(id); if (!e) return null;
      e.detached = 0; e.vx = e.vy = 0;
      HUD.bump();
      return e;
    },

    /* ---- a falling wave-digit bomb ---- */
    dropDigit: function (x, y) {
      if (FW._digits.length >= 12) return null;
      var d = {
        x: x, y: y, vy: 0, n: (NA.Game ? NA.Game.wave : 0) % 10,
        t: 0, life: 4, landed: 0, ty: y + 520
      };
      FW._digits.push(d);
      FW.digitN = FW._digits.length;
      UI.ovDirty = true;
      return d;
    },
    fallHUDDigit: function (n) { return FW.dropDigit(NA.Player.x + NA.RNG.range(-300, 300), NA.Arena.cy - NA.Arena.radius * 0.8); },

    /* ---- per-frame housekeeping (real time, cheap) ---- */
    tick: function (dt) {
      var i, d;
      if (FW._tearT >= 0) {
        FW._tearT -= dt;
        if (FW._tearT <= 0) {
          FW._tearT = -1; FW.torn = true;
          try { if (FW._fake && FW._fake.classList) FW._fake.classList.add('torn'); } catch (e) { }
          sfx('bossPhase');
          if (FW._tearRes) { FW._tearRes(true); FW._tearRes = null; }
        }
      }
      if (FW._healT >= 0) {
        FW._healT -= dt;
        if (FW._healT <= 0) {
          FW._healT = -1; FW.torn = false;
          FW._rm(FW._fake); FW._fake = null;
          if (FW._healRes) { FW._healRes(true); FW._healRes = null; }
        }
      }
      if (FW._flashT > 0) {
        FW._flashT -= dt;
        if (FW._flashT <= 0) {
          try { if (FW._flash) FW._flash.style.opacity = '0'; } catch (e) { }
          FW._rm(FW._flash); FW._flash = null;
        }
      }
      if (FW._scroll) {
        var s = FW._scroll;
        var step = s.left * (dt / Math.max(0.001, s.t));
        if (dt >= s.t) { step = s.left; FW._scroll = null; }
        else { s.left -= step; s.t -= dt; }
        try { window.scrollBy(0, step); } catch (e) { }
      }
      /* Falling digits are GAMEPLAY: they damage, shake and pop. Freeze them
       * while paused or dead - the DOM timers above stay live so a tear/heal
       * still settles. */
      var gs = NA.Game ? NA.Game.state : '';
      if ((NA.Game && NA.Game.paused) || gs === 'pause' || gs === 'death') {
        if (FW.digitN !== FW._digits.length) { FW.digitN = FW._digits.length; UI.ovDirty = true; }
        return;
      }
      /* falling digits */
      for (i = 0; i < FW._digits.length; i++) {
        d = FW._digits[i];
        d.t += dt;
        d.vy += 900 * dt;
        d.y += d.vy * dt;
        if (!d.landed && d.y >= d.ty) {
          d.landed = 1;
          NA.Particles.ring(d.x, d.y, 8, 150, 0.4, 4, 1, 0.35, 0.25, 0.9);
          NA.FX.trauma(0.18);
          sfx('explode', { x: d.x, y: d.y });
          if (NA.Player.alive && M.dist2(NA.Player.x, NA.Player.y, d.x, d.y) < 90 * 90) {
            NA.Player.damage(1, d.x, d.y);
          }
        }
        if (d.landed || d.t > d.life) { FW._digits.splice(i, 1); i--; }
      }
      if (FW.digitN !== FW._digits.length) { FW.digitN = FW._digits.length; UI.ovDirty = true; }
    },

    /* the telegraph for a falling digit lives in the GL world */
    render: function () {
      var R = NA.R, L = R.L;
      for (var i = 0; i < FW._digits.length; i++) {
        var d = FW._digits[i];
        if (d.landed) continue;
        NA.Enemies.telegraphCircle(d.x, d.ty, 90, d.t, Math.max(0.6, (d.ty - d.y) / 700 + d.t), 0.75);
        R.line(L.VEIL, d.x, d.y + 14, d.x, d.ty, 1.2, 1, 0.5, 0.2, 0.25);
      }
    },

    drawDigits: function (ctx, I, u) {
      for (var i = 0; i < FW._digits.length; i++) {
        var d = FW._digits[i];
        var p = w2s(d.x, d.y);
        I.digit(ctx, d.n, p.x, p.y, 44 * u, { color: '#FF6E86', glow: 0.8 });
      }
    },

    reset: function () {
      Draft.fake = false;
      FW.torn = false; FW.crack = 0; FW._tearT = FW._healT = -1;
      // settle, do not drop: an `await tearDraft()` cleanup must still run
      FW._settle('_tearRes', false);
      FW._settle('_healRes', false);
      FW._digits.length = 0; FW.digitN = 0;
      FW._scroll = null;
      FW.dimPage(0);
      FW.viewportArena(false);
      FW._rm(FW._fake); FW._fake = null;
      FW._rm(FW._flash); FW._flash = null;
      FW._rm(FW._tall); FW._tall = null;
      if (FW._crackEls) { for (var i = 0; i < FW._crackEls.length; i++) FW._rm(FW._crackEls[i]); }
      FW._crackEls = null;
      for (var q = 0; q < hudEls.length; q++) { hudEls[q].detached = 0; hudEls[q].vx = hudEls[q].vy = 0; }
      try { var el = FW._el(); if (el && 'innerHTML' in el) el.innerHTML = ''; } catch (e) { }
      FW._dom = null;
      try { window.scrollTo(0, 0); } catch (e) { }
    }
  };
  UI.fourthWall = FW;

  /* ==================================================================
   * 8. wiring
   * ================================================================== */
  UI.paletteIndex = M.clamp(St.settings.palette | 0, 0, 3);

  UI.wire = function () {
    var G = NA.Game; if (!G || UI._wired) return; UI._wired = true;
    G.on('kill', function (ti) {
      var d = NA.Enemies.types[ti];
      if (d) UI.markSeen('e', d.shape || 'circle');
      HUD.combo++; HUD.comboT = 0.2;
    });
    G.on('bossDeath', function (id) { UI.markSeen('b', id); });
    G.on('waveClear', function (n) {
      sfx('uiTick', { pitch: 1 + Math.min(n, 30) * 0.02 });
      HUD.bump();
    });
    G.on('draftPick', function () { HUD.bump(); UI.buildStripT = 2.0; });
    G.on('playerHit', function () { HUD.bump(); NA.FX.chroma(2.2, 140); });
    G.on('stateChange', function (st) {
      if (st === 'ending') UI.startEnding(!!G._victoryFromBoss);
      if (st === 'title' || st === 'wave') UI.ovDirty = true;
    });
  };
})();
