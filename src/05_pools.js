/* 05_pools.js — structure-of-arrays pool factory and uniform spatial hash.
 *
 * Public API
 *   NA.Pool.create(cap, fields)   fields = {name:'f32'|'i32'|'u8'|'u16'|'i16'}
 *     -> pool { cap, n, <field arrays>, alloc() -> i|-1, free(i), clear(), each(cb) }
 *     Pools are dense: live entries are 0..n-1 and free(i) swap-removes, so
 *     indices are NOT stable across frames. Anything that needs a stable handle
 *     stores (index, gen) and checks pool.gen[i].
 *
 *   NA.Grid.create(cellSize, cap) -> grid { begin(), insert(i,x,y), query(x,y,r,dst) -> count,
 *                                           queryCb(x,y,r,cb) }
 *
 *   RE-ENTRANCY: query() fills grid.out by default. grid.out is ONE shared
 *   buffer, so a callee that queries the same grid from inside an
 *   `out = g.out; for (q...)` loop silently rewrites the outer loop's results.
 *   Any call site that damages / kills / runs a callback *while still walking*
 *   its own results must pass its own destination array:
 *       var n = g.query(x, y, r, g.out2);  for (q...) { ... g.out2[q] ... }
 *   Two spare buffers (g.out2, g.out3) are preallocated for that; a caller may
 *   also pass any Int32Array of its own. g.truncated is set when a query hit
 *   the destination's capacity (visible under ?debug=1).
 */
(function () {
  var TYPES = {
    f32: Float32Array, i32: Int32Array, u8: Uint8Array,
    u16: Uint16Array, i16: Int16Array, u32: Uint32Array
  };

  NA.Pool = {
    create: function (cap, fields) {
      var p = { cap: cap, n: 0, _fields: [] };
      for (var k in fields) {
        var T = TYPES[fields[k]] || Float32Array;
        p[k] = new T(cap);
        p._fields.push(k);
      }
      if (!p.gen) { p.gen = new Uint32Array(cap); p._fields.push('gen'); }

      p.alloc = function () {
        if (p.n >= p.cap) return -1;
        var i = p.n++;
        for (var f = 0; f < p._fields.length; f++) {
          var key = p._fields[f];
          if (key !== 'gen') p[key][i] = 0;
        }
        p.gen[i] = (p.gen[i] + 1) >>> 0;
        return i;
      };
      // swap-remove; returns the index that moved into slot i (or -1)
      p.free = function (i) {
        if (i < 0 || i >= p.n) return -1;
        var last = --p.n;
        if (i !== last) {
          for (var f = 0; f < p._fields.length; f++) {
            var key = p._fields[f];
            p[key][i] = p[key][last];
          }
          return last;
        }
        return -1;
      };
      p.clear = function () { p.n = 0; };
      p.each = function (cb) { for (var i = 0; i < p.n; i++) cb(i); };
      return p;
    }
  };

  /* Uniform spatial hash over a fixed bucket table. Rebuilt every frame with
   * begin(); no allocation after construction. Buckets are singly-linked lists
   * stored in two Int32Arrays (head + next). */
  NA.Grid = {
    create: function (cellSize, cap, cols) {
      cols = cols || 128;
      var g = {
        cell: cellSize, inv: 1 / cellSize, cols: cols, rows: cols,
        head: new Int32Array(cols * cols),
        next: new Int32Array(cap),
        px: new Float32Array(cap),
        py: new Float32Array(cap),
        out: new Int32Array(1024),
        out2: new Int32Array(1024),      // nested query buffer (see header)
        out3: new Int32Array(1024),      // twice-nested query buffer
        truncated: false,
        count: 0
      };
      g.head.fill(-1);
      g._key = function (cx, cy) {
        // wrap so the hash covers any world position without bounds checks
        var x = cx & (g.cols - 1), y = cy & (g.rows - 1);
        return y * g.cols + x;
      };
      g.begin = function () { g.head.fill(-1); g.count = 0; };
      g.insert = function (i, x, y) {
        if (i >= g.next.length) return;
        var cx = Math.floor(x * g.inv), cy = Math.floor(y * g.inv);
        var k = g._key(cx, cy);
        g.next[i] = g.head[k]; g.head[k] = i;
        g.px[i] = x; g.py[i] = y;
        g.count++;
      };
      /* Calls cb(i) for every candidate within the cell footprint of (x,y,r).
       * Callers still do the exact squared-distance test. */
      g.queryCb = function (x, y, r, cb) {
        var x0 = Math.floor((x - r) * g.inv), x1 = Math.floor((x + r) * g.inv);
        var y0 = Math.floor((y - r) * g.inv), y1 = Math.floor((y + r) * g.inv);
        if (x1 - x0 > g.cols - 1) { x0 = 0; x1 = g.cols - 1; }
        if (y1 - y0 > g.rows - 1) { y0 = 0; y1 = g.rows - 1; }
        for (var cy = y0; cy <= y1; cy++) {
          for (var cx = x0; cx <= x1; cx++) {
            var i = g.head[g._key(cx, cy)];
            while (i !== -1) { cb(i); i = g.next[i]; }
          }
        }
      };
      // fills dst (default g.out), returns count (bounded by dst.length)
      g.query = function (x, y, r, dst) {
        var n = 0, out = dst || g.out, cap2 = out.length;
        var x0 = Math.floor((x - r) * g.inv), x1 = Math.floor((x + r) * g.inv);
        var y0 = Math.floor((y - r) * g.inv), y1 = Math.floor((y + r) * g.inv);
        if (x1 - x0 > g.cols - 1) { x0 = 0; x1 = g.cols - 1; }
        if (y1 - y0 > g.rows - 1) { y0 = 0; y1 = g.rows - 1; }
        var r2 = r * r;
        for (var cy = y0; cy <= y1; cy++) {
          for (var cx = x0; cx <= x1; cx++) {
            var i = g.head[g._key(cx, cy)];
            while (i !== -1) {
              var dx = g.px[i] - x, dy = g.py[i] - y;
              if (dx * dx + dy * dy <= r2) { if (n < cap2) out[n++] = i; else g.truncated = true; }
              i = g.next[i];
            }
          }
        }
        return n;
      };
      return g;
    }
  };
})();
