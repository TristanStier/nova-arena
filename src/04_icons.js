// ============================================================================
// NOVA ARENA — 04_icons.js  ::  NA.Icons
// ----------------------------------------------------------------------------
// Text-free vector icon library. Every glyph is pure Canvas2D path work: no
// fonts, no emoji, no images. Loads standalone (depends on nothing else).
//
// PUBLIC API
//   NA.Icons.draw(ctx, id, x, y, size, opts)   upgrade / UI icon, centered
//   NA.Icons.enemy(ctx, shape, x, y, size, opts)
//   NA.Icons.boss(ctx, bossId, x, y, size, opts)
//   NA.Icons.ship(ctx, x, y, size, slots, opts)
//   NA.Icons.digit(ctx, n, x, y, size, opts)
//   NA.Icons.number(ctx, value, x, y, size, opts)
//   NA.Icons.slider(ctx, x, y, size, value01, color)
//   NA.Icons.ids / uiIds / bossIds / enemyShapes / family(id) / has(id)
//
//   opts = { tier:1..3, color:'#rrggbb', glow:0..1, alpha:0..1,
//            frame:bool, wild:bool, rot:radians }
//
// Every glyph is authored inside a 64x64 box centered on the origin (-32..32)
// with lineWidth 2; draw() scales that box to `size`, so strokes stay
// proportional at any size. Glyph art stays inside radius 22 so the tier
// frames (r 25..31) never collide with it.
// ============================================================================
window.NA = window.NA || {};
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // ---- palette -------------------------------------------------------------
  var FAMILY = {
    offense:  '#FF8A00',
    defense:  '#4D8CFF',
    mana:     '#4DF3FF',
    movement: '#39FF6A',
    chaos:    '#FF3CAC',
    wild:     '#FFD84D',
    ui:       '#4DF3FF',
    enemy:    '#FF3CAC',
    boss:     '#FFD84D'
  };

  function hexRGB(h) {
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgba(h, a) {
    var c = hexRGB(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  // Blend toward white; used for the tier-3 "brighter" treatment.
  function lighten(h, t) {
    var c = hexRGB(h);
    return 'rgb(' + Math.round(c[0] + (255 - c[0]) * t) + ',' +
                    Math.round(c[1] + (255 - c[1]) * t) + ',' +
                    Math.round(c[2] + (255 - c[2]) * t) + ')';
  }

  // ---- primitive helpers ---------------------------------------------------
  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function tracePath(ctx, p, close) {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    if (close) ctx.closePath();
  }
  function poly(ctx, p, close) { tracePath(ctx, p, close); ctx.stroke(); }
  function polyFill(ctx, p) { tracePath(ctx, p, true); ctx.fill(); ctx.stroke(); }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  function circF(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function circFS(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke(); }
  function arcp(ctx, x, y, r, a0, a1) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke(); }
  function dot(ctx, st, x, y, r) {
    var f = ctx.fillStyle; ctx.fillStyle = st.ink; circF(ctx, x, y, r); ctx.fillStyle = f;
  }
  function ngonPts(x, y, r, n, rot) {
    var p = [], i, a;
    for (i = 0; i < n; i++) { a = rot + i / n * TAU; p.push(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    return p;
  }
  function ngon(ctx, x, y, r, n, rot) { poly(ctx, ngonPts(x, y, r, n, rot), true); }
  function ngonF(ctx, x, y, r, n, rot) { polyFill(ctx, ngonPts(x, y, r, n, rot)); }
  function dash(ctx, a, b) { ctx.setLineDash([a, b]); }
  function undash(ctx) { ctx.setLineDash([]); }
  function lw(ctx, w) { ctx.lineWidth = w; }

  // Base shape: an upward projectile triangle (the "bullet" glyph).
  function triUp(ctx, x, y, r, fill) {
    var p = [x, y - r, x + r * 0.78, y + r * 0.72, x - r * 0.78, y + r * 0.72];
    if (fill) polyFill(ctx, p); else poly(ctx, p, true);
  }
  function diamond(ctx, x, y, r, fill) {
    var p = [x, y - r, x + r * 0.78, y, x, y + r, x - r * 0.78, y];
    if (fill) polyFill(ctx, p); else poly(ctx, p, true);
  }
  // Base shape: lightning chain.
  function bolt(ctx, x, y, s, fill) {
    var p = [x - s * 0.36, y - s, x + s * 0.30, y - s * 0.18, x - s * 0.04, y - s * 0.18,
             x + s * 0.40, y + s, x - s * 0.30, y + s * 0.14, x + s * 0.02, y + s * 0.14];
    if (fill) polyFill(ctx, p); else poly(ctx, p, true);
  }
  // Base shape: crit / burst four-point star.
  function star4(ctx, x, y, r) {
    var k = r * 0.26;
    poly(ctx, [x, y - r, x + k, y - k, x + r, y, x + k, y + k,
               x, y + r, x - k, y + k, x - r, y, x - k, y - k], true);
  }
  // Base shape: explosion sun.
  function sun(ctx, x, y, r, rays) {
    circ(ctx, x, y, r * 0.45);
    for (var i = 0; i < rays; i++) {
      var a = i / rays * TAU;
      line(ctx, x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68,
                x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }
  // Base shape: targeting reticle.
  function reticle(ctx, x, y, r) {
    circ(ctx, x, y, r * 0.62);
    line(ctx, x - r, y, x - r * 0.34, y); line(ctx, x + r * 0.34, y, x + r, y);
    line(ctx, x, y - r, x, y - r * 0.34); line(ctx, x, y + r * 0.34, x, y + r);
  }
  // Base shape: the mana half-disc (left half filled).
  function manaHalf(ctx, x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    circ(ctx, x, y, r);
    line(ctx, x, y - r, x, y + r);
  }
  // Base shape: dash arrow.
  function arrowAt(ctx, x, y, a, head) {
    var c = Math.cos(a), s = Math.sin(a);
    poly(ctx, [x - c * head + s * head * 0.8, y - s * head - c * head * 0.8,
               x, y,
               x - c * head - s * head * 0.8, y - s * head + c * head * 0.8], false);
  }
  function arrowR(ctx, x1, x2, y, head) {
    head = head || 6;
    line(ctx, x1, y, x2, y);
    arrowAt(ctx, x2, y, 0, head);
  }

  // ---- corner modifiers (fixed positions, GAME_PLAN 12.7) ------------------
  // tl = magnitude, tr = count, br = speed, bl = bounce / pierce / regen
  var CORNER = { tl: [-18, -18], tr: [18, -18], br: [18, 18], bl: [-18, 18] };
  function mod(ctx, st, kind, corner) {
    var c = CORNER[corner] || CORNER.tr, x = c[0], y = c[1], s = 5.2, o = ctx.lineWidth;
    lw(ctx, 1.7);
    if (kind === 'plus') { line(ctx, x - s, y, x + s, y); line(ctx, x, y - s, x, y + s); }
    else if (kind === 'up') { line(ctx, x, y + s, x, y - s); arrowAt(ctx, x, y - s, -Math.PI / 2, 3.8); }
    else if (kind === 'speed') {
      poly(ctx, [x - s, y - s, x - s * 0.1, y, x - s, y + s], false);
      poly(ctx, [x + s * 0.2, y - s, x + s * 1.1, y, x + s * 0.2, y + s], false);
    } else if (kind === 'pierce') {
      line(ctx, x - s * 1.1, y, x + s * 1.1, y);
      line(ctx, x, y - s, x, y + s);
      arrowAt(ctx, x + s * 1.1, y, 0, 3.6);
    } else if (kind === 'bounce') {
      ctx.beginPath(); ctx.arc(x, y + s * 0.3, s * 0.9, Math.PI, TAU); ctx.stroke();
      line(ctx, x - s * 0.9, y + s * 0.3, x - s * 0.9, y + s * 0.95);
      arrowAt(ctx, x - s * 0.9, y + s * 0.95, Math.PI / 2, 3.4);
    } else if (kind === 'regen') {
      ctx.beginPath(); ctx.arc(x, y, s * 0.9, -0.35, TAU - 1.5); ctx.stroke();
      arrowAt(ctx, x + Math.cos(-0.35) * s * 0.9, y + Math.sin(-0.35) * s * 0.9, -2.0, 3.6);
    }
    lw(ctx, o);
  }

  // ---- frames --------------------------------------------------------------
  function roundPolyPath(ctx, r, n, rot, corner) {
    var p = ngonPts(0, 0, r, n, rot), i, n2 = p.length / 2;
    ctx.beginPath();
    for (i = 0; i < n2; i++) {
      var ax = p[i * 2], ay = p[i * 2 + 1];
      var bx = p[((i + 1) % n2) * 2], by = p[((i + 1) % n2) * 2 + 1];
      var dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy), t = corner / L;
      if (i === 0) ctx.moveTo(ax + dx * t, ay + dy * t);
      else ctx.lineTo(ax + dx * t, ay + dy * t);
      ctx.lineTo(bx - dx * t, by - dy * t);
      var cx = p[((i + 2) % n2) * 2], cy = p[((i + 2) % n2) * 2 + 1];
      var ex = cx - bx, ey = cy - by, L2 = Math.sqrt(ex * ex + ey * ey), t2 = corner / L2;
      ctx.quadraticCurveTo(bx, by, bx + ex * t2, by + ey * t2);
    }
    ctx.closePath();
  }

  function tierPips(ctx, st, y) {
    var i, x, f = ctx.fillStyle;
    for (i = 0; i < 3; i++) {
      x = (i - 1) * 5.5;
      ctx.fillStyle = i < st.tier ? st.ink : rgba(st.col, 0.22);
      circF(ctx, x, y, 1.5);
    }
    ctx.fillStyle = f;
  }
  function frameHex(ctx, st) {
    var i, r;
    for (i = 0; i < st.tier; i++) {
      r = 31 - i * 3;
      ctx.strokeStyle = rgba(st.col, i === 0 ? 0.85 : 0.42 - i * 0.09);
      lw(ctx, i === 0 ? 2 : 1.2);
      roundPolyPath(ctx, r, 6, -Math.PI / 2, 6); ctx.stroke();
    }
    tierPips(ctx, st, 25.5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }
  function frameCircle(ctx, st) {
    for (var i = 0; i < st.tier; i++) {
      ctx.strokeStyle = rgba(st.col, i === 0 ? 0.85 : 0.42 - i * 0.09);
      lw(ctx, i === 0 ? 2 : 1.2);
      circ(ctx, 0, 0, 31 - i * 3);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }
  function frameSpiked(ctx, st) {
    var i, a, n = 16, p = [];
    for (i = 0; i < n * 2; i++) {
      a = i / (n * 2) * TAU - Math.PI / 2;
      var r = (i & 1) ? 32 : 27;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.strokeStyle = rgba(st.col, 0.9); lw(ctx, 1.6); poly(ctx, p, true);
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.2); circ(ctx, 0, 0, 24.5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }
  function frameWild(ctx, st) {
    var i, a, n = 6, p = [];
    for (i = 0; i < n * 2; i++) {
      a = i / (n * 2) * TAU - Math.PI / 2;
      var r = (i & 1) ? 23 : 32;
      p.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.strokeStyle = rgba(st.col, 0.9); lw(ctx, 1.8); poly(ctx, p, true);
    if (st.tier > 1) {
      var q = [];
      for (i = 0; i < n * 2; i++) {
        a = i / (n * 2) * TAU - Math.PI / 2;
        var rr = (i & 1) ? 19 : 27;
        q.push(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.strokeStyle = rgba(st.col, 0.3); lw(ctx, 1.1); poly(ctx, q, true);
    }
    tierPips(ctx, st, 25.5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  }

  // ---- registry ------------------------------------------------------------
  var G = {};        // id -> draw(ctx, st)
  var FAM_OF = {};   // id -> family key
  function reg(id, fam, fn) { G[id] = fn; FAM_OF[id] = fam; }

  function makeState(ctx, col, tier) {
    var st = {
      col: col,
      tier: tier,
      stroke: tier >= 3 ? lighten(col, 0.35) : col,
      ink: tier >= 3 ? lighten(col, 0.55) : lighten(col, 0.18),
      dim: rgba(col, 0.35)
    };
    if (tier === 1) st.fill = rgba(col, 0.20);
    else {
      var g = ctx.createLinearGradient(0, -24, 0, 24);
      g.addColorStop(0, rgba(col, tier === 3 ? 0.80 : 0.52));
      g.addColorStop(1, rgba(col, tier === 3 ? 0.16 : 0.06));
      st.fill = g;
    }
    return st;
  }

  function begin(ctx, x, y, size, col, opts) {
    var k = size / 64;
    ctx.save();
    ctx.translate(x, y);
    if (opts.rot) ctx.rotate(opts.rot);
    ctx.scale(k, k);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.glow) { ctx.shadowColor = rgba(col, 0.95); ctx.shadowBlur = opts.glow * size * 0.30; }
  }

  // ---- main entry ----------------------------------------------------------
  function draw(ctx, id, x, y, size, opts) {
    opts = opts || {};
    var fn = G[id];
    var tier = Math.max(1, Math.min(3, opts.tier || 1));
    var col = opts.color || FAMILY[FAM_OF[id]] || FAMILY.ui;
    begin(ctx, x, y, size, col, opts);
    var st = makeState(ctx, col, tier);
    ctx.strokeStyle = st.stroke;
    ctx.fillStyle = st.fill;
    if (opts.wild) frameWild(ctx, st);
    else if (opts.frame) frameHex(ctx, st);
    if (fn) fn(ctx, st);
    undash(ctx);
    ctx.restore();
  }

  // ==========================================================================
  // UPGRADE GLYPHS (42)
  // Grammar: base shape says what it affects, corner modifier says how,
  // family colour says which branch.
  // ==========================================================================

  // --- A. Weapons -----------------------------------------------------------
  // two parallel projectiles
  reg('twinBarrels', 'offense', function (ctx, st) {
    triUp(ctx, -9, 2, 11, true);
    triUp(ctx, 9, 2, 11, true);
    line(ctx, -9, 16, -9, 20); line(ctx, 9, 16, 9, 20);
    mod(ctx, st, 'plus', 'tr');
  });
  // charged rail: long barrel + charge coils, pierces
  reg('railgun', 'offense', function (ctx, st) {
    lw(ctx, 3); line(ctx, 0, 20, 0, -8); lw(ctx, 2);
    triUp(ctx, 0, -12, 8, true);
    line(ctx, -9, 4, 9, 4); line(ctx, -9, 11, 9, 11);
    dot(ctx, st, 0, -20, 2.4);
    mod(ctx, st, 'pierce', 'bl');
  });
  // cone of pellets
  reg('buckshot', 'offense', function (ctx, st) {
    triUp(ctx, 0, 14, 8, true);
    var i, a;
    for (i = 0; i < 5; i++) {
      a = -Math.PI / 2 + (i - 2) * 0.36;
      dot(ctx, st, Math.cos(a) * 21, 12 + Math.sin(a) * 21, 2.6);
      lw(ctx, 1.1);
      line(ctx, Math.cos(a) * 12, 12 + Math.sin(a) * 12, Math.cos(a) * 17, 12 + Math.sin(a) * 17);
      lw(ctx, 2);
    }
  });
  // lobbed shell: ballistic arc into a burst
  reg('mortar', 'offense', function (ctx, st) {
    lw(ctx, 1.6); dash(ctx, 4, 3);
    ctx.beginPath(); ctx.moveTo(-17, 15); ctx.quadraticCurveTo(-2, -24, 15, 8); ctx.stroke();
    undash(ctx); lw(ctx, 2);
    ctx.save(); ctx.translate(-17, 15); ctx.rotate(-0.9); triUp(ctx, 0, -2, 7, true); ctx.restore();
    star4(ctx, 15, 12, 8);
    dot(ctx, st, 15, 12, 2.2);
  });
  // spinning barrel cluster
  reg('gatling', 'offense', function (ctx, st) {
    var i, a;
    for (i = 0; i < 6; i++) {
      a = i / 6 * TAU - Math.PI / 2;
      circ(ctx, Math.cos(a) * 10, Math.sin(a) * 10, 4);
    }
    dot(ctx, st, 0, 0, 2.6);
    lw(ctx, 1.5);
    arcp(ctx, 0, 0, 19, -0.4, 2.3);
    arrowAt(ctx, Math.cos(2.3) * 19, Math.sin(2.3) * 19, 2.3 + Math.PI / 2, 4.2);
    lw(ctx, 2);
    mod(ctx, st, 'speed', 'br');
  });

  // --- B. Projectile modifiers ---------------------------------------------
  // explosion
  reg('blast', 'offense', function (ctx, st) {
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    sun(ctx, 0, 0, 19, 8);
    dot(ctx, st, 0, 0, 3);
    mod(ctx, st, 'up', 'tl');
  });
  // bouncing between walls
  reg('ricochet', 'offense', function (ctx, st) {
    lw(ctx, 2.4);
    ctx.strokeStyle = st.dim;
    line(ctx, -19, -18, -19, 18); line(ctx, 19, -18, 19, 18);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    poly(ctx, [-15, 16, 15, 3, -15, -11], false);
    arrowAt(ctx, -15, -11, Math.PI + 0.42, 6);
    mod(ctx, st, 'bounce', 'bl');
  });
  // pierce through
  reg('drill', 'offense', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 2.4); line(ctx, 8, -17, 8, 17);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    ctx.save(); ctx.translate(-10, 0); ctx.rotate(Math.PI / 2); triUp(ctx, 0, 0, 10, true); ctx.restore();
    lw(ctx, 1.2);
    line(ctx, -16, -4, -12, -4); line(ctx, -16, 0, -11, 0); line(ctx, -16, 4, -12, 4);
    lw(ctx, 2);
    line(ctx, 0, 0, 18, 0); arrowAt(ctx, 20, 0, 0, 6);
  });
  // homing onto a target
  reg('seeker', 'offense', function (ctx, st) {
    circ(ctx, 13, -12, 6); dot(ctx, st, 13, -12, 2.4);
    lw(ctx, 1.5); dash(ctx, 4, 3);
    ctx.beginPath(); ctx.moveTo(-14, 16); ctx.quadraticCurveTo(-18, -8, 7, -10); ctx.stroke();
    undash(ctx); lw(ctx, 2);
    ctx.save(); ctx.translate(-14, 16); ctx.rotate(0.5); triUp(ctx, 0, 0, 8, true); ctx.restore();
  });
  // chain lightning between nodes
  reg('voltaic', 'offense', function (ctx, st) {
    circ(ctx, -16, 13, 5); circ(ctx, 16, -13, 5);
    bolt(ctx, 0, 0, 15, true);
    lw(ctx, 1.2); dash(ctx, 3, 3);
    line(ctx, -12, 9, -5, 3); line(ctx, 6, -3, 12, -9);
    undash(ctx); lw(ctx, 2);
  });

  // --- C. Mana actives ------------------------------------------------------
  // mana burned for fire rate
  reg('overdrive', 'mana', function (ctx, st) {
    manaHalf(ctx, -3, 0, 15);
    mod(ctx, st, 'speed', 'br');
    lw(ctx, 1.6);
    line(ctx, 14, -14, 20, -8);
    lw(ctx, 2);
  });
  // mana clock
  reg('chrono', 'mana', function (ctx, st) {
    manaHalf(ctx, 0, 0, 16);
    lw(ctx, 2.2);
    line(ctx, 0, 0, 0, -10); line(ctx, 0, 0, 8, 5);
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 2.6);
    var i, a;
    lw(ctx, 1.3);
    for (i = 0; i < 4; i++) { a = i / 4 * TAU; line(ctx, Math.cos(a) * 19, Math.sin(a) * 19, Math.cos(a) * 22, Math.sin(a) * 22); }
    lw(ctx, 2);
  });
  // expanding shockwave
  reg('pulse', 'mana', function (ctx, st) {
    dot(ctx, st, 0, 0, 3.4);
    ctx.strokeStyle = rgba(st.col, 0.95); circ(ctx, 0, 0, 8);
    ctx.strokeStyle = rgba(st.col, 0.6); circ(ctx, 0, 0, 14);
    ctx.strokeStyle = rgba(st.col, 0.32); circ(ctx, 0, 0, 20);
    ctx.strokeStyle = st.stroke;
  });
  // mana drawn inward
  reg('siphon', 'mana', function (ctx, st) {
    manaHalf(ctx, 0, 5, 14);
    lw(ctx, 1.8);
    line(ctx, 0, -21, 0, -12); arrowAt(ctx, 0, -10, Math.PI / 2, 5.5);
    ctx.beginPath(); ctx.moveTo(-16, -17); ctx.quadraticCurveTo(-8, -12, -6, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, -17); ctx.quadraticCurveTo(8, -12, 6, -6); ctx.stroke();
    lw(ctx, 2);
  });
  // mana bar overfilled, crowned
  reg('overcharge', 'mana', function (ctx, st) {
    ctx.beginPath(); ctx.arc(0, 4, 14, 0, TAU); ctx.fill(); ctx.stroke();
    circ(ctx, 0, 4, 18.5);
    poly(ctx, [-11, -13, -7, -21, -2, -14, 3, -22, 8, -14, 12, -20], false);
    mod(ctx, st, 'up', 'tl');
  });
  // bullets cost mana: runed round
  reg('arcane', 'mana', function (ctx, st) {
    triUp(ctx, 0, 3, 15, true);
    diamond(ctx, 0, 4, 5, false);
    lw(ctx, 1.3);
    var i, a;
    for (i = 0; i < 6; i++) {
      a = i / 6 * TAU + 0.5;
      line(ctx, Math.cos(a) * 18, Math.sin(a) * 18, Math.cos(a) * 21.5, Math.sin(a) * 21.5);
    }
    lw(ctx, 2);
  });

  // --- D. Movement ----------------------------------------------------------
  // dash with flame trail
  reg('afterburner', 'movement', function (ctx, st) {
    arrowR(ctx, -6, 16, 0, 7);
    var i;
    lw(ctx, 2);
    for (i = 0; i < 3; i++) {
      var x = -10 - i * 6;
      ctx.strokeStyle = rgba(st.col, 0.9 - i * 0.25);
      poly(ctx, [x - 5, -8 + i, x + 1, 0, x - 5, 8 - i], false);
    }
    ctx.strokeStyle = st.stroke;
    mod(ctx, st, 'speed', 'br');
  });
  // dash through a wall of bullets
  reg('phase', 'movement', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 2.4); dash(ctx, 4, 4);
    line(ctx, 3, -19, 3, 19);
    undash(ctx); ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, -20, 0, -6, 0);
    dash(ctx, 3, 3); line(ctx, -6, 0, 10, 0); undash(ctx);
    line(ctx, 10, 0, 15, 0); arrowAt(ctx, 18, 0, 0, 6);
    dot(ctx, st, 3, -11, 2.2); dot(ctx, st, 3, 11, 2.2);
  });
  // sliding momentum with skid marks
  reg('drift', 'movement', function (ctx, st) {
    ctx.beginPath(); ctx.moveTo(-19, 14); ctx.quadraticCurveTo(0, 14, 14, -8); ctx.stroke();
    arrowAt(ctx, 17, -13, -1.0, 6.5);
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.55);
    line(ctx, -16, 20, -5, 19); line(ctx, -6, 21, 5, 16); line(ctx, 4, 19, 12, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // teleport: broken arrow with a landing dot
  reg('blink', 'movement', function (ctx, st) {
    line(ctx, -21, 0, -8, 0);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.4);
    line(ctx, -4, -5, -4, 5); line(ctx, 2, -5, 2, 5);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, 7, 0, 14, 0); arrowAt(ctx, 17, 0, 0, 6);
    dot(ctx, st, 20, 0, 3.4);
    circ(ctx, 20, 0, 6.5);
  });

  // --- E. Defense -----------------------------------------------------------
  // extra plated hull
  reg('hullPlating', 'defense', function (ctx, st) {
    diamond(ctx, 0, 0, 20, true);
    lw(ctx, 1.5); diamond(ctx, 0, 0, 12, false); lw(ctx, 2);
    mod(ctx, st, 'plus', 'tr');
  });
  // pressure release
  reg('vent', 'defense', function (ctx, st) {
    diamond(ctx, 0, 0, 19, true);
    lw(ctx, 1.7);
    line(ctx, -6, -4, 6, -4); line(ctx, -7, 1, 7, 1); line(ctx, -6, 6, 6, 6);
    ctx.strokeStyle = rgba(st.col, 0.75);
    line(ctx, -22, -7, -16, -7); arrowAt(ctx, -23, -7, Math.PI, 4.2);
    line(ctx, 16, 7, 22, 7); arrowAt(ctx, 23, 7, 0, 4.2);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // a hit is ignored: spectral hull
  reg('ghost', 'defense', function (ctx, st) {
    dash(ctx, 4, 3.5); diamond(ctx, 0, -2, 19, false); undash(ctx);
    ctx.beginPath();
    ctx.moveTo(-8, 6); ctx.quadraticCurveTo(-8, -10, 0, -10);
    ctx.quadraticCurveTo(8, -10, 8, 6);
    ctx.lineTo(4, 2); ctx.lineTo(0, 6); ctx.lineTo(-4, 2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    dot(ctx, st, -3, -4, 1.7); dot(ctx, st, 3, -4, 1.7);
  });

  // --- F. Chain reaction triggers ------------------------------------------
  // on kill: scythe
  reg('reaper', 'chaos', function (ctx, st) {
    lw(ctx, 2.4); line(ctx, -10, 20, 8, -6); lw(ctx, 2);
    ctx.beginPath(); ctx.moveTo(8, -6); ctx.quadraticCurveTo(2, -22, -18, -16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -6); ctx.quadraticCurveTo(0, -14, -18, -16); ctx.stroke();
    dot(ctx, st, -12, 21, 2.6);
    lw(ctx, 1.4); line(ctx, -16, 14, -6, 14); lw(ctx, 2);
  });
  // on hit: crit mark
  reg('impact', 'offense', function (ctx, st) {
    reticle(ctx, 0, 0, 20);
    ctx.beginPath();
    var k = 3.4, r = 11;
    ctx.moveTo(0, -r); ctx.lineTo(k, -k); ctx.lineTo(r, 0); ctx.lineTo(k, k);
    ctx.lineTo(0, r); ctx.lineTo(-k, k); ctx.lineTo(-r, 0); ctx.lineTo(-k, -k);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    dot(ctx, st, 0, 0, 2.2);
  });
  // on dash: rear fan
  reg('wake', 'movement', function (ctx, st) {
    arrowR(ctx, -2, 18, -6, 6.5);
    var i, a;
    lw(ctx, 1.8);
    for (i = 0; i < 5; i++) {
      a = Math.PI - 0.85 + i * 0.425;
      line(ctx, -6 + Math.cos(a) * 7, -6 + Math.sin(a) * 7,
                -6 + Math.cos(a) * 17, -6 + Math.sin(a) * 17);
      dot(ctx, st, -6 + Math.cos(a) * 19, -6 + Math.sin(a) * 19, 1.7);
    }
    lw(ctx, 2);
  });
  // on spend: mana becomes shots
  reg('spendthrift', 'mana', function (ctx, st) {
    manaHalf(ctx, -11, 0, 11);
    lw(ctx, 1.5); dash(ctx, 3, 3); line(ctx, 2, 0, 14, 0); undash(ctx); lw(ctx, 2);
    dot(ctx, st, 6, -9, 2.2); dot(ctx, st, 12, 8, 2.2);
    ctx.save(); ctx.translate(19, 0); ctx.rotate(Math.PI / 2); triUp(ctx, 0, 0, 8, true); ctx.restore();
  });
  // excess damage carries on
  reg('overkill', 'offense', function (ctx, st) {
    ctx.save(); ctx.translate(-18, 0); ctx.rotate(Math.PI / 2); triUp(ctx, 0, 0, 8, true); ctx.restore();
    ctx.strokeStyle = st.dim; lw(ctx, 1.8);
    arcp(ctx, -1, 0, 10, 0.6, 2.6); arcp(ctx, -1, 0, 10, 3.7, 5.7);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, -8, 0, 8, 0); arrowAt(ctx, 10, 0, 0, 5);
    star4(ctx, 17, 0, 9);
  });

  // --- G. Summons and orbitals ---------------------------------------------
  // orbiting shards
  reg('shardOrbit', 'chaos', function (ctx, st) {
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.4); circ(ctx, 0, 0, 17);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    diamond(ctx, 0, -17, 6, true);
    diamond(ctx, 15, 9, 6, true);
    diamond(ctx, -15, 9, 6, true);
    dot(ctx, st, 0, 0, 3.4);
  });
  // a wingman copy
  reg('drone', 'chaos', function (ctx, st) {
    triUp(ctx, -7, 4, 13, true);
    triUp(ctx, 13, -9, 7, false);
    lw(ctx, 1.2); dash(ctx, 3, 3); line(ctx, 1, -3, 9, -8); undash(ctx); lw(ctx, 2);
    dot(ctx, st, 13, -8, 1.7);
  });
  // deployed turret pod
  reg('turret', 'chaos', function (ctx, st) {
    polyFill(ctx, [-14, 18, 14, 18, 9, 8, -9, 8]);
    ctx.beginPath(); ctx.arc(0, 8, 8, Math.PI, TAU); ctx.closePath(); ctx.fill(); ctx.stroke();
    lw(ctx, 3.2); line(ctx, 0, 2, 0, -14); lw(ctx, 2);
    line(ctx, -5, -14, 5, -14);
    dot(ctx, st, 0, -19, 2.4);
  });
  // ghost twin copying you
  reg('mirror', 'chaos', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 1.4); dash(ctx, 3, 3);
    line(ctx, 0, -21, 0, 21);
    undash(ctx); ctx.strokeStyle = st.stroke; lw(ctx, 2);
    triUp(ctx, -11, 3, 12, true);
    dash(ctx, 3.5, 3);
    triUp(ctx, 11, 3, 12, false);
    undash(ctx);
  });

  // --- H. Area and fields ---------------------------------------------------
  function mineGlyph(ctx, st, x, y, r) {
    circF(ctx, x, y, r);
    circ(ctx, x, y, r);
    var i, a;
    lw(ctx, 1.4);
    for (i = 0; i < 6; i++) {
      a = i / 6 * TAU + 0.3;
      line(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 3.6), y + Math.sin(a) * (r + 3.6));
    }
    lw(ctx, 2);
  }
  reg('mines', 'chaos', function (ctx, st) {
    lw(ctx, 1.2); dash(ctx, 3, 3); line(ctx, -14, 12, 14, -12); undash(ctx); lw(ctx, 2);
    mineGlyph(ctx, st, -14, 12, 5);
    mineGlyph(ctx, st, 0, 0, 5);
    mineGlyph(ctx, st, 14, -12, 5);
  });
  // drifting storm cloud
  reg('stormCloud', 'chaos', function (ctx, st) {
    ctx.beginPath();
    ctx.arc(-9, -8, 7, Math.PI * 0.85, Math.PI * 1.9);
    ctx.arc(1, -13, 9, Math.PI * 1.15, Math.PI * 1.95);
    ctx.arc(11, -7, 7, Math.PI * 1.5, Math.PI * 0.25);
    ctx.lineTo(-9, -1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    bolt(ctx, 0, 11, 9, true);
    lw(ctx, 1.3);
    line(ctx, -14, 4, -11, 9); line(ctx, 13, 4, 10, 9);
    lw(ctx, 2);
  });
  // spiral pulled into a point
  reg('gravityWell', 'chaos', function (ctx, st) {
    var t, a, r;
    ctx.beginPath();
    for (t = 0; t <= 1.0001; t += 0.02) {
      a = t * TAU * 2.1; r = 21 * (1 - t * 0.92);
      if (t === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
    dot(ctx, st, 0, 0, 4);
    ctx.strokeStyle = rgba(st.col, 0.45); lw(ctx, 1.2);
    circ(ctx, 0, 0, 9);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // burning engine trail
  reg('burnTrail', 'chaos', function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(4, -20);
    ctx.quadraticCurveTo(16, -4, 11, 8);
    ctx.quadraticCurveTo(6, 20, -3, 17);
    ctx.quadraticCurveTo(-12, 13, -8, 2);
    ctx.quadraticCurveTo(-5, -5, -1, -6);
    ctx.quadraticCurveTo(-3, -14, 4, -20);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    lw(ctx, 1.6); ctx.strokeStyle = rgba(st.col, 0.8);
    ctx.beginPath(); ctx.moveTo(3, 15); ctx.quadraticCurveTo(-3, 6, 2, -2);
    ctx.quadraticCurveTo(7, 5, 3, 15); ctx.stroke();
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.5);
    line(ctx, -18, 20, -12, 20); line(ctx, -21, 12, -14, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });

  // --- I. Wildcards ---------------------------------------------------------
  // invisible bullets
  reg('ghostRounds', 'wild', function (ctx, st) {
    dash(ctx, 3.5, 3);
    triUp(ctx, 2, 2, 15, false);
    undash(ctx);
    dot(ctx, st, 2, -14, 2.6);
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.55);
    line(ctx, -16, 8, -9, 8); line(ctx, -18, 15, -8, 15); line(ctx, 12, 12, 19, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // the arena squeezes in
  reg('claustrophobia', 'wild', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 1.8);
    poly(ctx, [-16, -16, 16, -16, 16, 16, -16, 16], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    poly(ctx, [-6, -13, 0, -7, 6, -13], false);
    poly(ctx, [-6, 13, 0, 7, 6, 13], false);
    poly(ctx, [-13, -6, -7, 0, -13, 6], false);
    poly(ctx, [13, -6, 7, 0, 13, 6], false);
    dot(ctx, st, 0, 0, 3);
  });
  // one hit point, cracked
  reg('glassHull', 'wild', function (ctx, st) {
    diamond(ctx, 0, 0, 20, true);
    // the crack: a dark cut with a bright edge so it reads at every tier
    var crack = [-2, -19, 3, -6, -4, -1, 4, 6, -1, 19];
    var spurs = [[3, -6, 11, -8], [-4, -1, -12, -1], [4, 6, 11, 9]];
    var i;
    ctx.strokeStyle = 'rgba(5,6,10,0.92)'; lw(ctx, 4);
    poly(ctx, crack, false);
    for (i = 0; i < 3; i++) line(ctx, spurs[i][0], spurs[i][1], spurs[i][2], spurs[i][3]);
    ctx.strokeStyle = st.ink; lw(ctx, 1.5);
    poly(ctx, crack, false);
    lw(ctx, 1.2);
    for (i = 0; i < 3; i++) line(ctx, spurs[i][0], spurs[i][1], spurs[i][2], spurs[i][3]);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  // power from an empty bar
  reg('berserk', 'wild', function (ctx, st) {
    ctx.strokeStyle = st.dim; lw(ctx, 2.2);
    arcp(ctx, 0, 4, 19, Math.PI * 0.15, Math.PI * 0.85);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    polyFill(ctx, [0, -21, 6, -6, 15, -10, 9, 4, 15, 10, 0, 6, -15, 10, -9, 4, -15, -10, -6, -6]);
    dot(ctx, st, 0, -3, 2.2);
  });
  // enemy fire feeds you
  reg('feedbackLoop', 'wild', function (ctx, st) {
    lw(ctx, 2.2);
    arcp(ctx, 0, 0, 15, 0.5, 2.5);
    arrowAt(ctx, Math.cos(2.5) * 15, Math.sin(2.5) * 15, 2.5 + Math.PI / 2, 6);
    arcp(ctx, 0, 0, 15, 3.64, 5.64);
    arrowAt(ctx, Math.cos(5.64) * 15, Math.sin(5.64) * 15, 5.64 + Math.PI / 2, 6);
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 3.2);
    dot(ctx, st, -18, -12, 2.2); dot(ctx, st, 18, 12, 2.2);
  });
  // random everything: a die
  reg('gambler', 'wild', function (ctx, st) {
    ctx.save(); ctx.rotate(0.22);
    polyFill(ctx, [-14.5, -14.5, 14.5, -14.5, 14.5, 14.5, -14.5, 14.5]);
    var f = ctx.fillStyle; ctx.fillStyle = st.ink;
    circF(ctx, -7.5, -7.5, 2.4); circF(ctx, 7.5, -7.5, 2.4); circF(ctx, 0, 0, 2.4);
    circF(ctx, -7.5, 7.5, 2.4); circF(ctx, 7.5, 7.5, 2.4);
    ctx.fillStyle = f;
    ctx.restore();
  });

  // ==========================================================================
  // SETTINGS / UI GLYPHS
  // ==========================================================================
  function speaker(ctx, st) {
    polyFill(ctx, [-19, -6, -11, -6, -3, -15, -3, 15, -11, 6, -19, 6]);
  }
  function eye(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - h, x + w, y);
    ctx.quadraticCurveTo(x, y + h, x - w, y);
    ctx.closePath(); ctx.stroke();
  }

  reg('resume', 'ui', function (ctx, st) {
    polyFill(ctx, [-9, -17, 19, 0, -9, 17]);
  });
  reg('pause', 'ui', function (ctx, st) {
    ctx.lineWidth = 6;
    line(ctx, -8, -16, -8, 16); line(ctx, 8, -16, 8, 16);
    ctx.lineWidth = 2;
  });
  reg('volMaster', 'ui', function (ctx, st) {
    speaker(ctx, st);
    var i;
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(st.col, 0.95 - i * 0.22); lw(ctx, 1.9);
      arcp(ctx, 1, 0, 8 + i * 6, -0.75, 0.75);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('volMusic', 'ui', function (ctx, st) {
    speaker(ctx, st);
    lw(ctx, 2.2);
    line(ctx, 9, 10, 9, -13); line(ctx, 19, 7, 19, -16);
    line(ctx, 9, -13, 19, -16);
    lw(ctx, 2);
    var f = ctx.fillStyle; ctx.fillStyle = st.ink;
    circF(ctx, 6, 11, 3.4); circF(ctx, 16, 8, 3.4);
    ctx.fillStyle = f;
  });
  reg('volSfx', 'ui', function (ctx, st) {
    speaker(ctx, st);
    lw(ctx, 2);
    poly(ctx, [3, 0, 6, -10, 9, 8, 12, -14, 15, 6, 18, -4, 20, 0], false);
  });
  reg('shake', 'ui', function (ctx, st) {
    polyFill(ctx, [-13, -13, -5, -13, -2, -17, 6, -17, 9, -13, 13, -13, 13, 12, -13, 12]);
    var f = ctx.fillStyle; ctx.fillStyle = 'rgba(0,0,0,0)';
    circ(ctx, 0, -1, 6.5); ctx.fillStyle = f;
    lw(ctx, 1.8); ctx.strokeStyle = rgba(st.col, 0.8);
    line(ctx, -19, -6, -17, -6); line(ctx, -22, 0, -18, 0); line(ctx, -19, 6, -17, 6);
    line(ctx, 19, -6, 17, -6); line(ctx, 22, 0, 18, 0); line(ctx, 19, 6, 17, 6);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('flash', 'ui', function (ctx, st) {
    circF(ctx, 0, 0, 8); circ(ctx, 0, 0, 8);
    var i, a;
    lw(ctx, 2.2);
    for (i = 0; i < 8; i++) {
      a = i / 8 * TAU + Math.PI / 8;
      line(ctx, Math.cos(a) * 13, Math.sin(a) * 13, Math.cos(a) * 21, Math.sin(a) * 21);
    }
    lw(ctx, 2);
  });
  reg('quality', 'ui', function (ctx, st) {
    // three stacked squares, each with more internal detail
    ctx.strokeStyle = rgba(st.col, 0.55); lw(ctx, 1.6);
    poly(ctx, [-21, 2, -7, 2, -7, 16, -21, 16], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    poly(ctx, [-8, -6, 8, -6, 8, 10, -8, 10], true);
    line(ctx, 0, -6, 0, 10);
    poly(ctx, [7, -17, 22, -17, 22, -2, 7, -2], true);
    lw(ctx, 1.2);
    line(ctx, 12, -17, 12, -2); line(ctx, 17, -17, 17, -2);
    line(ctx, 7, -12, 22, -12); line(ctx, 7, -7, 22, -7);
    lw(ctx, 2);
  });
  reg('colorblind', 'ui', function (ctx, st) {
    eye(ctx, 0, 0, 21, 20);
    var i, a, f = ctx.fillStyle;
    var wheel = ['#FF8A00', '#4DF3FF', '#39FF6A', '#FF3CAC'];
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU - Math.PI / 2;
      ctx.fillStyle = wheel[i];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 8.5, a, a + TAU / 4); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = f;
    circ(ctx, 0, 0, 8.5);
  });
  reg('reticle', 'ui', function (ctx, st) {
    reticle(ctx, 0, 0, 20);
    dot(ctx, st, 0, 0, 2.4);
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.55);
    circ(ctx, 0, 0, 6);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('autofire', 'ui', function (ctx, st) {
    triUp(ctx, 0, 6, 11, true);
    lw(ctx, 1.6); ctx.strokeStyle = rgba(st.col, 0.6);
    triUp(ctx, 0, 16, 7, false);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    lw(ctx, 1.9);
    arcp(ctx, 0, -2, 18, Math.PI * 1.08, Math.PI * 1.92);
    arrowAt(ctx, Math.cos(Math.PI * 1.92) * 18, -2 + Math.sin(Math.PI * 1.92) * 18, Math.PI * 1.92 + Math.PI / 2, 5);
    lw(ctx, 2);
  });
  reg('hints', 'ui', function (ctx, st) {
    roundPolyPath(ctx, 13, 4, Math.PI / 4, 3.5); ctx.fill(); ctx.stroke();
    dot(ctx, st, 0, 0, 2.6);
    lw(ctx, 1.6); ctx.strokeStyle = rgba(st.col, 0.75);
    arcp(ctx, 0, 0, 18, -0.7, 0.7); arcp(ctx, 0, 0, 22, -0.55, 0.55);
    arcp(ctx, 0, 0, 18, Math.PI - 0.7, Math.PI + 0.7);
    arcp(ctx, 0, 0, 22, Math.PI - 0.55, Math.PI + 0.55);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('quit', 'ui', function (ctx, st) {
    poly(ctx, [-19, -18, 1, -18, 1, 18, -19, 18], true);
    dot(ctx, st, -4, 1, 2.4);
    line(ctx, 6, 0, 17, 0); arrowAt(ctx, 20, 0, 0, 6.5);
  });
  reg('reroll', 'ui', function (ctx, st) {
    lw(ctx, 2.6);
    arcp(ctx, 0, 0, 16, -Math.PI * 0.35, Math.PI * 1.45);
    arrowAt(ctx, Math.cos(Math.PI * 1.45) * 16, Math.sin(Math.PI * 1.45) * 16, Math.PI * 1.95, 7);
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 2.6);
  });
  reg('skip', 'ui', function (ctx, st) {
    // heart-shard: a hollow HP segment carrying a plus (skip a draft, gain 1 HP)
    lw(ctx, 5.5);
    ctx.strokeStyle = rgba(st.col, 0.55);
    arcp(ctx, 0, 2, 22, Math.PI * 1.06, Math.PI * 1.60);
    ctx.strokeStyle = rgba(st.col, 0.9);
    arcp(ctx, 0, 2, 22, Math.PI * 1.66, Math.PI * 1.94);
    ctx.strokeStyle = st.stroke; lw(ctx, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, 19);
    ctx.quadraticCurveTo(-17, 5, -9, -4);
    ctx.quadraticCurveTo(-2, -10, 0, -2);
    ctx.quadraticCurveTo(2, -10, 9, -4);
    ctx.quadraticCurveTo(17, 5, 0, 19);
    ctx.closePath(); ctx.stroke();
    lw(ctx, 3);
    ctx.strokeStyle = st.ink;
    line(ctx, -5, 6, 5, 6); line(ctx, 0, 1, 0, 11);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  });
  reg('gate', 'ui', function (ctx, st) {
    lw(ctx, 2.4); circ(ctx, 0, 0, 19); lw(ctx, 2);
    var i, a;
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + Math.PI / 4;
      var cx = Math.cos(a), cy = Math.sin(a);
      poly(ctx, [cx * 16 - cy * 6, cy * 16 + cx * 6,
                 cx * 9, cy * 9,
                 cx * 16 + cy * 6, cy * 16 - cx * 6], false);
    }
    dot(ctx, st, 0, 0, 2.4);
  });
  reg('home', 'ui', function (ctx, st) {
    polyFill(ctx, [-18, -1, 0, -18, 18, -1, 18, 18, -18, 18]);
    poly(ctx, [-6, 18, -6, 5, 6, 5, 6, 18], false);
  });
  reg('infinity', 'ui', function (ctx, st) {
    lw(ctx, 2.6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-8, -16, -24, -16, -24, 0);
    ctx.bezierCurveTo(-24, 16, -8, 16, 0, 0);
    ctx.bezierCurveTo(8, -16, 24, -16, 24, 0);
    ctx.bezierCurveTo(24, 16, 8, 16, 0, 0);
    ctx.closePath(); ctx.stroke();
    lw(ctx, 2);
  });
  reg('photosensitivity', 'ui', function (ctx, st) {
    eye(ctx, 0, 0, 20, 18);
    circ(ctx, 0, 0, 7); dot(ctx, st, 0, 0, 3);
    var i, a;
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.7);
    for (i = 0; i < 6; i++) {
      a = -Math.PI * 0.9 + i * Math.PI * 0.16;
      line(ctx, Math.cos(a) * 15, Math.sin(a) * 15, Math.cos(a) * 22, Math.sin(a) * 22);
    }
    ctx.strokeStyle = st.stroke;
    lw(ctx, 3);
    line(ctx, -17, 17, 17, -17);
    lw(ctx, 2);
  });

  // ---- radial arc slider ---------------------------------------------------
  // Draws a 280-degree arc gauge around (x,y): dim track, bright value, knob.
  function slider(ctx, x, y, size, v, color) {
    var col = color || FAMILY.ui, r = size * 0.42;
    v = Math.max(0, Math.min(1, v == null ? 0 : v));
    var a0 = Math.PI * 0.72, a1 = Math.PI * 2.28;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, size * 0.055);
    ctx.strokeStyle = rgba(col, 0.22);
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    if (v > 0) {
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + (a1 - a0) * v); ctx.stroke();
    }
    var ka = a0 + (a1 - a0) * v;
    ctx.fillStyle = lighten(col, 0.5);
    ctx.beginPath(); ctx.arc(x + Math.cos(ka) * r, y + Math.sin(ka) * r, size * 0.075, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---- stroke digits (7-segment-like) --------------------------------------
  var SEG = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
    5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd'
  };
  function digit(ctx, n, x, y, size, opts) {
    opts = opts || {};
    n = ((n | 0) % 10 + 10) % 10;
    var col = opts.color || FAMILY.ui;
    var w = size * 0.26, h = size * 0.42, s = SEG[n], i;
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.glow) { ctx.shadowColor = rgba(col, 0.95); ctx.shadowBlur = opts.glow * size * 0.30; }
    ctx.strokeStyle = (opts.tier >= 3) ? lighten(col, 0.35) : col;
    ctx.lineWidth = Math.max(1, size * 0.085);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var TL = [x - w, y - h], TR = [x + w, y - h], ML = [x - w, y], MR = [x + w, y],
        BL = [x - w, y + h], BR = [x + w, y + h];
    var segs = { a: [TL, TR], b: [TR, MR], c: [MR, BR], d: [BL, BR], e: [ML, BL], f: [TL, ML], g: [ML, MR] };
    for (i = 0; i < s.length; i++) {
      var g = segs[s.charAt(i)];
      line(ctx, g[0][0], g[0][1], g[1][0], g[1][1]);
    }
    ctx.restore();
  }
  function number(ctx, value, x, y, size, opts) {
    var v = Math.abs(Math.round(value)) + '', i, n = v.length;
    var adv = size * 0.64;
    var x0 = x - (n - 1) * adv * 0.5;
    for (i = n - 1; i >= 0; i--) digit(ctx, +v.charAt(i), x0 + i * adv, y, size, opts);
  }

  // ==========================================================================
  // ENEMY SHAPES  (shape = kind, per GAME_PLAN 7)
  // ==========================================================================
  var ESHAPES = {
    circle: function (ctx, st) { circF(ctx, 0, 0, 17); circ(ctx, 0, 0, 17); },
    tri: function (ctx, st) { triUp(ctx, 0, 1, 19, true); },
    square: function (ctx, st) { polyFill(ctx, [-15, -15, 15, -15, 15, 15, -15, 15]); },
    hex: function (ctx, st) { ngonF(ctx, 0, 0, 18, 6, -Math.PI / 2); },
    diamond: function (ctx, st) { diamond(ctx, 0, 0, 20, true); },
    ring: function (ctx, st) {
      lw(ctx, 3.4); circ(ctx, 0, 0, 16); lw(ctx, 2);
      ctx.strokeStyle = rgba(st.col, 0.45); circ(ctx, 0, 0, 21);
      ctx.strokeStyle = st.stroke;
    },
    needle: function (ctx, st) {
      polyFill(ctx, [0, -22, 4.5, 6, 0, 22, -4.5, 6]);
      lw(ctx, 1.3); line(ctx, 0, -16, 0, 14); lw(ctx, 2);
    },
    chevron: function (ctx, st) {
      polyFill(ctx, [0, -18, 16, 12, 0, 3, -16, 12]);
      lw(ctx, 1.4);
      line(ctx, -10, 13, -14, 20); line(ctx, 10, 13, 14, 20);
      lw(ctx, 2);
    },
    // tether pair: two diamonds joined by a beam
    pair: function (ctx, st) {
      lw(ctx, 2.6); ctx.strokeStyle = rgba(st.col, 0.8);
      line(ctx, -13, 9, 13, -9);
      ctx.strokeStyle = st.stroke; lw(ctx, 2);
      diamond(ctx, -14, 10, 9, true);
      diamond(ctx, 14, -10, 9, true);
    },
    // eclipse disc with a black core
    disc: function (ctx, st) {
      circF(ctx, 0, 0, 19); circ(ctx, 0, 0, 19);
      var f = ctx.fillStyle; ctx.fillStyle = '#05060A';
      circF(ctx, 0, 0, 9); ctx.fillStyle = f;
      circ(ctx, 0, 0, 9);
    },
    // cathedral: hex core with six orbiting nodes
    cathedral: function (ctx, st) {
      ngonF(ctx, 0, 0, 13, 6, -Math.PI / 2);
      var i, a;
      ctx.strokeStyle = rgba(st.col, 0.4); lw(ctx, 1.1); circ(ctx, 0, 0, 23);
      ctx.strokeStyle = st.stroke; lw(ctx, 2);
      for (i = 0; i < 6; i++) {
        a = i / 6 * TAU;
        ngonF(ctx, Math.cos(a) * 23, Math.sin(a) * 23, 5, 6, -Math.PI / 2);
      }
    },
    // ouroboros: a ring made of diamonds
    ouroboros: function (ctx, st) {
      var i, a, n = 10;
      for (i = 0; i < n; i++) {
        if (i === 3) continue; // the rotating gap
        a = i / n * TAU - Math.PI / 2;
        ctx.save(); ctx.translate(Math.cos(a) * 19, Math.sin(a) * 19); ctx.rotate(a);
        diamond(ctx, 0, 0, 5.4, true); ctx.restore();
      }
    },
    // invisible: dashed outline only
    ghost: function (ctx, st) {
      dash(ctx, 4, 4); lw(ctx, 2.2); circ(ctx, 0, 0, 17); undash(ctx); lw(ctx, 2);
      dot(ctx, st, 0, 0, 2.6);
    }
  };

  function enemy(ctx, shape, x, y, size, opts) {
    opts = opts || {};
    var tier = Math.max(1, Math.min(3, opts.tier || 1));
    var col = opts.color || FAMILY.enemy;
    begin(ctx, x, y, size, col, opts);
    var st = makeState(ctx, col, tier);
    ctx.strokeStyle = st.stroke; ctx.fillStyle = st.fill;
    if (opts.frame) frameCircle(ctx, st);
    var fn = ESHAPES[shape];
    if (fn) fn(ctx, st);
    undash(ctx);
    ctx.restore();
  }

  // ==========================================================================
  // BOSS GLYPHS (25) — each drawn inside a spiked circle frame
  // ==========================================================================
  var B = {};
  // walls slamming inward
  B.compactor = function (ctx, st) {
    var i, a;
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + Math.PI / 4;
      var c = Math.cos(a), s = Math.sin(a);
      ctx.save(); ctx.translate(c * 16, s * 16); ctx.rotate(a);
      polyFill(ctx, [-2, -9, 3, -9, 3, 9, -2, 9]);
      ctx.restore();
      line(ctx, c * 11, s * 11, c * 5, s * 5);
      arrowAt(ctx, c * 4, s * 4, a + Math.PI, 4.4);
    }
    dot(ctx, st, 0, 0, 2.6);
  };
  // stars joined by lethal lines
  B.constellation = function (ctx, st) {
    var p = [[-16, -10], [-2, -18], [14, -8], [7, 10], [-11, 12]];
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.75);
    poly(ctx, [p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1], p[4][0], p[4][1]], true);
    line(ctx, p[1][0], p[1][1], p[3][0], p[3][1]);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    for (var i = 0; i < 5; i++) { star4(ctx, p[i][0], p[i][1], 5); dot(ctx, st, p[i][0], p[i][1], 1.8); }
  };
  // a wall of foam with three eyes
  B.tide = function (ctx, st) {
    var r, y;
    for (r = 0; r < 3; r++) {
      y = -12 + r * 12;
      ctx.beginPath();
      ctx.moveTo(-21, y);
      ctx.quadraticCurveTo(-10, y - 6, 0, y);
      ctx.quadraticCurveTo(10, y + 6, 21, y);
      ctx.stroke();
    }
    var f = ctx.fillStyle; ctx.fillStyle = '#05060A';
    circF(ctx, -12, 0, 4.5); circF(ctx, 0, 0, 4.5); circF(ctx, 12, 0, 4.5);
    ctx.fillStyle = f;
    circ(ctx, -12, 0, 4.5); circ(ctx, 0, 0, 4.5); circ(ctx, 12, 0, 4.5);
  };
  // rotating floor with a hub
  B.turntable = function (ctx, st) {
    circ(ctx, 0, 0, 19);
    dot(ctx, st, 0, 0, 4);
    lw(ctx, 1.4); line(ctx, 0, 0, 0, -19); lw(ctx, 2);
    lw(ctx, 2.2);
    arcp(ctx, 0, 0, 12, 0.3, 2.4);
    arrowAt(ctx, Math.cos(2.4) * 12, Math.sin(2.4) * 12, 2.4 + Math.PI / 2, 5.5);
    lw(ctx, 2);
  };
  // pendulum
  B.metronome = function (ctx, st) {
    polyFill(ctx, [-13, 19, 13, 19, 6, -16, -6, -16]);
    lw(ctx, 2.2); ctx.strokeStyle = st.ink;
    line(ctx, 0, 17, 9, -13);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    dot(ctx, st, 7, -6, 4);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.5);
    arcp(ctx, 0, 17, 26, -1.9, -1.15);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a swarm forming a shape
  B.congregation = function (ctx, st) {
    var rows = [1, 2, 3, 4], i, r, y, x0;
    for (r = 0; r < rows.length; r++) {
      y = -16 + r * 10;
      x0 = -(rows[r] - 1) * 5.5;
      for (i = 0; i < rows[r]; i++) triUp(ctx, x0 + i * 11, y, 4.6, true);
    }
    ctx.strokeStyle = rgba(st.col, 0.45); lw(ctx, 1.2);
    poly(ctx, [0, -22, 20, 20, -20, 20], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // darkness punctuated by a flash
  B.strobe = function (ctx, st) {
    var f = ctx.fillStyle; ctx.fillStyle = rgba(st.col, 0.14);
    ctx.beginPath(); ctx.arc(0, 0, 19, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = f;
    circ(ctx, 0, 0, 19);
    line(ctx, 0, -19, 0, 19);
    var i, a;
    lw(ctx, 1.8);
    for (i = 0; i < 5; i++) {
      a = -Math.PI * 0.42 + i * Math.PI * 0.21;
      line(ctx, Math.cos(a) * 7, Math.sin(a) * 7, Math.cos(a) * 17, Math.sin(a) * 17);
    }
    lw(ctx, 2);
    dot(ctx, st, -9, 0, 2.6);
  };
  // a stylus redrawing the walls
  B.cartographer = function (ctx, st) {
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.6); dash(ctx, 4, 3);
    poly(ctx, [-20, 12, -10, -4, 2, 6, 12, -12], false);
    undash(ctx); ctx.strokeStyle = st.stroke; lw(ctx, 2);
    ctx.save(); ctx.translate(13, -12); ctx.rotate(0.7);
    polyFill(ctx, [-4, -18, 4, -18, 4, 4, 0, 12, -4, 4]);
    line(ctx, 0, 4, 0, 10);
    ctx.restore();
  };
  // tuning fork with beat rings
  B.cadence = function (ctx, st) {
    lw(ctx, 2.6);
    line(ctx, -7, -18, -7, 4); line(ctx, 7, -18, 7, 4);
    ctx.beginPath(); ctx.arc(0, 4, 7, 0, Math.PI); ctx.stroke();
    line(ctx, 0, 11, 0, 20);
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.6);
    arcp(ctx, 0, -6, 16, -2.5, -0.6); arcp(ctx, 0, -6, 21, -2.4, -0.7);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // your ship in negative, mirrored
  B.understudy = function (ctx, st) {
    triUp(ctx, 0, -8, 12, true);
    ctx.save(); ctx.scale(1, -1);
    dash(ctx, 3.5, 3); triUp(ctx, 0, -8, 12, false); undash(ctx);
    ctx.restore();
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.2);
    line(ctx, -20, 0, 20, 0);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a torn UI panel with something crawling out
  B.encore = function (ctx, st) {
    ctx.strokeStyle = rgba(st.col, 0.7);
    poly(ctx, [-20, -15, -3, -15, -3, 15, -20, 15], true);
    poly(ctx, [20, -15, 3, -15, 3, 15, 20, 15], true);
    ctx.strokeStyle = st.stroke;
    lw(ctx, 1.6);
    poly(ctx, [-3, -15, 1, -8, -3, -2, 1, 5, -3, 15], false);
    lw(ctx, 2);
    ngonF(ctx, 0, 0, 8, 6, -Math.PI / 2);
    dot(ctx, st, 0, 0, 2.2);
  };
  // a leviathan under the surface
  B.depth = function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(-22, 6); ctx.quadraticCurveTo(-11, 0, 0, 6);
    ctx.quadraticCurveTo(11, 12, 22, 6); ctx.stroke();
    polyFill(ctx, [-12, 6, -4, -16, 0, 6]);
    polyFill(ctx, [6, 6, 12, -8, 16, 6]);
    ctx.strokeStyle = rgba(st.col, 0.45); lw(ctx, 1.3);
    ctx.beginPath();
    ctx.moveTo(-20, 16); ctx.quadraticCurveTo(-6, 22, 6, 15);
    ctx.quadraticCurveTo(14, 10, 20, 16); ctx.stroke();
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a hook and a bait light
  B.angler = function (ctx, st) {
    lw(ctx, 2.2);
    ctx.beginPath();
    ctx.moveTo(4, -21); ctx.lineTo(4, 2);
    ctx.arc(-3, 2, 7, 0, Math.PI * 0.85);
    ctx.stroke();
    lw(ctx, 2);
    circF(ctx, -14, 12, 5);
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.2);
    circ(ctx, -14, 12, 10); circ(ctx, -14, 12, 15);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    circ(ctx, -14, 12, 5);
  };
  // a prism bouncing your shot back
  B.reflector = function (ctx, st) {
    triUp(ctx, 0, 2, 15, true);
    lw(ctx, 1.8);
    line(ctx, -22, -14, -6, -2); arrowAt(ctx, -6, -2, 0.64, 5);
    line(ctx, 6, -2, 22, -14); arrowAt(ctx, 22, -14, -0.64, 5);
    lw(ctx, 2);
    ctx.strokeStyle = rgba(st.col, 0.5);
    line(ctx, -7, 12, 7, 12);
    ctx.strokeStyle = st.stroke;
  };
  // a lens that mirrors your controls
  B.inverter = function (ctx, st) {
    circF(ctx, 0, 0, 17); circ(ctx, 0, 0, 17);
    line(ctx, 0, -17, 0, 17);
    lw(ctx, 1.9);
    line(ctx, -14, -6, -4, -6); arrowAt(ctx, -14, -6, Math.PI, 4.4);
    line(ctx, 4, 6, 14, 6); arrowAt(ctx, 14, 6, 0, 4.4);
    lw(ctx, 2);
    ctx.strokeStyle = rgba(st.col, 0.4); circ(ctx, 0, 0, 22); ctx.strokeStyle = st.stroke;
  };
  // things return later
  B.echo = function (ctx, st) {
    var i;
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(st.col, 0.95 - i * 0.3);
      lw(ctx, 2.4 - i * 0.5);
      arcp(ctx, -4 + i * 7, 0, 12 + i * 3, Math.PI * 0.55, Math.PI * 1.45);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    triUp(ctx, -13, 0, 7, true);
  };
  // a gravity bar you stand on
  B.horizon = function (ctx, st) {
    lw(ctx, 4); ctx.strokeStyle = st.ink; line(ctx, -22, 6, 22, 6);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    triUp(ctx, -6, -3, 9, true);
    var i;
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.6);
    for (i = 0; i < 5; i++) { line(ctx, -18 + i * 9, 12, -18 + i * 9, 19); arrowAt(ctx, -18 + i * 9, 20, Math.PI / 2, 3.4); }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a growing sun
  B.supernova = function (ctx, st) {
    circF(ctx, 0, 0, 11); circ(ctx, 0, 0, 11);
    var i, a;
    lw(ctx, 2.2);
    for (i = 0; i < 12; i++) {
      a = i / 12 * TAU;
      var r2 = (i % 2) ? 17 : 23;
      line(ctx, Math.cos(a) * 13, Math.sin(a) * 13, Math.cos(a) * r2, Math.sin(a) * r2);
    }
    lw(ctx, 2);
    dot(ctx, st, 0, 0, 4);
  };
  // an eye that only opens in the dark
  B.dimmer = function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(-20, 2); ctx.quadraticCurveTo(0, -18, 20, 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-20, 2); ctx.quadraticCurveTo(0, 10, 20, 2); ctx.stroke();
    circF(ctx, 0, -1, 5);
    var i;
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.5);
    for (i = 0; i < 3; i++) line(ctx, -12 + i * 12, 10, -14 + i * 12, 18);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // something hiding behind the HUD
  B.lurker = function (ctx, st) {
    lw(ctx, 4); ctx.strokeStyle = rgba(st.col, 0.55);
    arcp(ctx, 0, 6, 20, Math.PI * 1.1, Math.PI * 1.9);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    ctx.beginPath();
    ctx.moveTo(-11, 18); ctx.lineTo(-11, 0);
    ctx.quadraticCurveTo(0, -12, 11, 0); ctx.lineTo(11, 18);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    dot(ctx, st, -5, 4, 2.4); dot(ctx, st, 5, 4, 2.4);
    lw(ctx, 1.3); line(ctx, -11, 18, 11, 18); lw(ctx, 2);
  };
  // the arena splits in two
  B.schism = function (ctx, st) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-24, -24, 22, 48); ctx.clip();
    circF(ctx, -3, 0, 19); circ(ctx, -3, 0, 19);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(2, -24, 22, 48); ctx.clip();
    circF(ctx, 3, 0, 19); circ(ctx, 3, 0, 19);
    ctx.restore();
    lw(ctx, 1.6); ctx.strokeStyle = st.ink;
    poly(ctx, [0, -22, -3, -10, 2, 0, -3, 10, 0, 22], false);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // a song that drags everything in
  B.siren = function (ctx, st) {
    dot(ctx, st, 0, 0, 4);
    var i;
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(st.col, 0.85 - i * 0.22); lw(ctx, 1.7);
      arcp(ctx, 0, 0, 9 + i * 6, -1.1, 1.1);
      arcp(ctx, 0, 0, 9 + i * 6, Math.PI - 1.1, Math.PI + 1.1);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    line(ctx, 0, -22, 0, -13); arrowAt(ctx, 0, -11, Math.PI / 2, 5);
    line(ctx, 0, 22, 0, 13); arrowAt(ctx, 0, 11, -Math.PI / 2, 5);
  };
  // a tumbling die of rules
  B.probability = function (ctx, st) {
    ngonF(ctx, 0, 0, 20, 6, -Math.PI / 2);
    var p = ngonPts(0, 0, 20, 6, -Math.PI / 2);
    lw(ctx, 1.3); ctx.strokeStyle = rgba(st.col, 0.7);
    poly(ctx, [p[0], p[1], p[4], p[5], p[8], p[9]], true);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    dot(ctx, st, 0, -2, 2.6);
    dot(ctx, st, -6, 8, 2.2); dot(ctx, st, 6, 8, 2.2);
  };
  // the page itself
  B.page = function (ctx, st) {
    ctx.beginPath();
    ctx.moveTo(-16, -20); ctx.lineTo(8, -20); ctx.lineTo(18, -10);
    ctx.lineTo(18, 20); ctx.lineTo(-16, 20); ctx.closePath();
    ctx.fill(); ctx.stroke();
    poly(ctx, [8, -20, 8, -10, 18, -10], false);
    lw(ctx, 1.5); ctx.strokeStyle = rgba(st.col, 0.65);
    line(ctx, -10, -2, 10, -2); line(ctx, -10, 5, 10, 5); line(ctx, -10, 12, 2, 12);
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };
  // everything falls in
  B.singularity = function (ctx, st) {
    var f = ctx.fillStyle; ctx.fillStyle = '#05060A';
    circF(ctx, 0, 0, 7); ctx.fillStyle = f;
    circ(ctx, 0, 0, 7);
    ctx.save(); ctx.scale(1, 0.42);
    ctx.strokeStyle = st.ink; lw(ctx, 2.6); circ(ctx, 0, 0, 21);
    ctx.strokeStyle = rgba(st.col, 0.5); lw(ctx, 1.4); circ(ctx, 0, 0, 15);
    ctx.restore();
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
    var i, a;
    lw(ctx, 1.4); ctx.strokeStyle = rgba(st.col, 0.7);
    for (i = 0; i < 4; i++) {
      a = i / 4 * TAU + 0.5;
      line(ctx, Math.cos(a) * 22, Math.sin(a) * 22, Math.cos(a) * 12, Math.sin(a) * 12);
      arrowAt(ctx, Math.cos(a) * 11, Math.sin(a) * 11, a + Math.PI, 4);
    }
    ctx.strokeStyle = st.stroke; lw(ctx, 2);
  };

  function boss(ctx, id, x, y, size, opts) {
    opts = opts || {};
    var tier = Math.max(1, Math.min(3, opts.tier || 1));
    var col = opts.color || FAMILY.boss;
    begin(ctx, x, y, size, col, opts);
    var st = makeState(ctx, col, tier);
    ctx.strokeStyle = st.stroke; ctx.fillStyle = st.fill;
    if (opts.frame !== false) frameSpiked(ctx, st);
    var fn = B[id];
    if (fn) fn(ctx, st);
    undash(ctx);
    ctx.restore();
  }

  // ==========================================================================
  // THE SHIP (draft preview) — GAME_PLAN 6.2 slots
  // slots = {trail, aura, halo, wings, fins, hull, barrels, core, orbitals, crown}
  // ==========================================================================
  var CYAN = '#4DF3FF', WHITE = '#EAFFFF', GOLD = '#FFD84D';

  function ship(ctx, x, y, size, slots, opts) {
    slots = slots || {};
    opts = opts || {};
    var col = opts.color || CYAN;
    var k = size / 76, i, a, t;
    ctx.save();
    ctx.translate(x, y);
    if (opts.rot) ctx.rotate(opts.rot);
    ctx.scale(k, k);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.glow) { ctx.shadowColor = rgba(col, 0.9); ctx.shadowBlur = opts.glow * size * 0.28; }
    ctx.strokeStyle = col; ctx.fillStyle = rgba(col, 0.14);

    // aura (below everything)
    t = slots.aura | 0;
    if (t > 0) {
      ctx.fillStyle = rgba(col, 0.07); circF(ctx, 0, 0, 31); ctx.fillStyle = rgba(col, 0.14);
      if (t >= 2) { ctx.strokeStyle = rgba(col, 0.4); lw(ctx, 1.4); circ(ctx, 0, 0, 31); }
      if (t >= 3) {
        ctx.strokeStyle = rgba(col, 0.28); circ(ctx, 0, 0, 26);
        for (i = 0; i < 4; i++) { a = i / 4 * TAU + 0.5; dot(ctx, { ink: rgba(col, 0.6) }, Math.cos(a) * 31, Math.sin(a) * 31, 1.8); }
      }
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // trail (behind, below the ship)
    t = slots.trail | 0;
    if (t > 0) {
      ctx.strokeStyle = rgba(col, 0.7); lw(ctx, t >= 2 ? 3 : 2);
      if (t === 1) line(ctx, 0, 20, 0, 30);
      else if (t === 2) { line(ctx, 0, 20, 0, 34); lw(ctx, 1.4); line(ctx, 0, 34, 0, 38); }
      else {
        line(ctx, -5, 20, -6, 34); line(ctx, 5, 20, 6, 34);
        for (i = 0; i < 3; i++) dot(ctx, { ink: rgba(col, 0.55) }, (i % 2 ? 5 : -5), 30 + i * 5, 1.6);
      }
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // orbitals
    t = slots.orbitals | 0;
    if (t > 0) {
      if (t >= 3) { ctx.strokeStyle = rgba(col, 0.3); lw(ctx, 1.2); circ(ctx, 0, 0, 34); ctx.strokeStyle = col; lw(ctx, 2); }
      var n = t >= 3 ? 4 : t + 1;
      ctx.fillStyle = rgba(col, 0.35);
      for (i = 0; i < n; i++) {
        a = i / n * TAU - Math.PI / 2 + 0.4;
        ngonF(ctx, Math.cos(a) * 34, Math.sin(a) * 34, 4.6, 3 + (i % 3), a);
      }
      ctx.fillStyle = rgba(col, 0.14);
    }

    // wings
    t = slots.wings | 0;
    if (t > 0) {
      var wl = 8 + t * 5;
      ctx.fillStyle = rgba(col, 0.16);
      polyFill(ctx, [-12, 6, -12 - wl, 16 + t * 2, -14, 18]);
      polyFill(ctx, [12, 6, 12 + wl, 16 + t * 2, 14, 18]);
      if (t >= 3) {
        ctx.strokeStyle = rgba(col, 0.55); lw(ctx, 1.2);
        poly(ctx, [-13, 9, -12 - wl + 3, 16, -15, 15], false);
        poly(ctx, [13, 9, 12 + wl - 3, 16, 15, 15], false);
        ctx.strokeStyle = col; lw(ctx, 2);
      }
      ctx.fillStyle = rgba(col, 0.14);
    }

    // fins (rear)
    t = slots.fins | 0;
    if (t > 0) {
      lw(ctx, 2);
      if (t === 1) line(ctx, 0, 10, 0, 24);
      else { line(ctx, -6, 13, -8, 25); line(ctx, 6, 13, 8, 25); }
      if (t >= 3) { dot(ctx, { ink: WHITE }, -8, 26, 2); dot(ctx, { ink: WHITE }, 8, 26, 2); }
    }

    // hull
    ctx.fillStyle = rgba(col, slots.hull >= 3 ? 0.24 : 0.13);
    polyFill(ctx, [0, -30, 18, 20, 0, 10, -18, 20]);
    t = slots.hull | 0;
    if (t >= 1) { ctx.strokeStyle = rgba(col, 0.55); lw(ctx, 1.2); poly(ctx, [0, -21, 11, 13, 0, 6, -11, 13], true); }
    if (t >= 2) { ctx.strokeStyle = WHITE; lw(ctx, 1.1); poly(ctx, [0, -30, 18, 20, 0, 10, -18, 20], true); }
    if (t >= 3) {
      ctx.strokeStyle = rgba(col, 0.4); lw(ctx, 1);
      line(ctx, -9, -2, 9, -2); line(ctx, -13, 8, 13, 8); line(ctx, 0, -21, 0, 6);
    }
    ctx.strokeStyle = col; lw(ctx, 2);

    // barrels
    t = slots.barrels | 0;
    if (t > 0) {
      lw(ctx, 2.4);
      if (t === 1) line(ctx, 0, -30, 0, -37);
      else if (t === 2) { line(ctx, -6, -16, -7, -26); line(ctx, 6, -16, 7, -26); }
      else {
        line(ctx, 0, -30, 0, -38);
        line(ctx, -7, -15, -10, -26); line(ctx, 7, -15, 10, -26);
        line(ctx, -12, 2, -16, -8); line(ctx, 12, 2, 16, -8);
      }
      lw(ctx, 2);
    }

    // halo (mana)
    t = slots.halo | 0;
    if (t > 0) {
      ctx.strokeStyle = t >= 3 ? GOLD : rgba(col, 0.8);
      lw(ctx, 2.2);
      if (t >= 3) circ(ctx, 0, 0, 27);
      else arcp(ctx, 0, 0, 27, Math.PI * 1.12, Math.PI * 1.88);
      if (t >= 2) {
        lw(ctx, 1.4);
        for (i = 0; i < 5; i++) {
          a = Math.PI * 1.15 + i * Math.PI * 0.175;
          line(ctx, Math.cos(a) * 27, Math.sin(a) * 27, Math.cos(a) * 31, Math.sin(a) * 31);
        }
      }
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // crown (wildcards)
    t = slots.crown | 0;
    if (t > 0) {
      ctx.strokeStyle = GOLD; lw(ctx, 1.8);
      poly(ctx, [-9, -34, -6, -42, -2, -35, 2, -43, 6, -35, 9, -41], false);
      if (t >= 2) line(ctx, -9, -34, 9, -34);
      if (t >= 3) dot(ctx, { ink: GOLD }, 0, -47, 2.2);
      ctx.strokeStyle = col; lw(ctx, 2);
    }

    // core (always; brightest thing near the ship)
    t = slots.core | 0;
    var cr = 3 + t * 0.9;
    if (t >= 2) { ctx.strokeStyle = rgba(WHITE, 0.5); lw(ctx, 1.2); circ(ctx, 0, 1, cr + 4.5); }
    if (t >= 3) {
      ctx.strokeStyle = rgba(WHITE, 0.45); lw(ctx, 1.2);
      line(ctx, -14, 1, -cr - 3, 1); line(ctx, cr + 3, 1, 14, 1);
    }
    ctx.fillStyle = WHITE; circF(ctx, 0, 1, cr);
    ctx.restore();
  }

  // ==========================================================================
  // exports
  // ==========================================================================
  var UPGRADE_IDS = [
    'twinBarrels', 'railgun', 'buckshot', 'mortar', 'gatling',
    'blast', 'ricochet', 'drill', 'seeker', 'voltaic',
    'overdrive', 'chrono', 'pulse', 'siphon', 'overcharge', 'arcane',
    'afterburner', 'phase', 'drift', 'blink',
    'hullPlating', 'vent', 'ghost',
    'reaper', 'impact', 'wake', 'spendthrift', 'overkill',
    'shardOrbit', 'drone', 'turret', 'mirror',
    'mines', 'stormCloud', 'gravityWell', 'burnTrail',
    'ghostRounds', 'claustrophobia', 'glassHull', 'berserk', 'feedbackLoop', 'gambler'
  ];
  var UI_IDS = [
    'resume', 'pause', 'volMaster', 'volMusic', 'volSfx', 'shake', 'flash',
    'quality', 'colorblind', 'reticle', 'autofire', 'hints', 'quit',
    'reroll', 'skip', 'gate', 'home', 'infinity', 'photosensitivity'
  ];
  var BOSS_IDS = [
    'compactor', 'constellation', 'tide', 'turntable', 'metronome', 'congregation',
    'strobe', 'cartographer', 'cadence', 'understudy', 'encore', 'depth',
    'angler', 'reflector', 'inverter', 'echo', 'horizon', 'supernova',
    'dimmer', 'lurker', 'schism', 'siren', 'probability', 'page', 'singularity'
  ];
  var ENEMY_SHAPES = [
    'circle', 'tri', 'square', 'hex', 'diamond', 'ring', 'needle', 'chevron',
    'pair', 'disc', 'cathedral', 'ouroboros', 'ghost'
  ];

  NA.Icons = {
    draw: draw,
    enemy: enemy,
    boss: boss,
    ship: ship,
    digit: digit,
    number: number,
    slider: slider,
    ids: UPGRADE_IDS,
    uiIds: UI_IDS,
    bossIds: BOSS_IDS,
    enemyShapes: ENEMY_SHAPES,
    colors: FAMILY,
    has: function (id) { return !!G[id]; },
    familyOf: function (id) { return FAM_OF[id] || 'ui'; },
    family: function (id) { return FAMILY[FAM_OF[id]] || FAMILY.ui; }
  };
})();
