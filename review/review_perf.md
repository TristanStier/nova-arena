# NOVA ARENA — adversarial performance review (60 fps @ thousands of entities)

Read-only review. Nothing under `src/` or `tools/` was modified. Build: `node tools/build.js`
(29,529 src lines → 1220 KiB). `src/13d_bosses_3.js` and `src/98_bot.js` were excluded per the brief.

## Measurements taken (Edge/Chromium, `--prof`, this machine)

| scenario | frame avg | p95 | max | entities | top prof module |
|---|---|---|---|---|---|
| `--stress --prof --frames=900` | **4.69 ms** | 6.00 | 7.90 | 500 e / 5012 b / 3073 p, 14996 inst | `bullets.u 2.06–3.45` |
| `--wave=28 --bot --god --prof --frames=2400` | **1.51 ms** | 2.50 | 18.80 | peak 131 e | `arena.r 0.63–0.76` |
| `--endless=40 --bot --god --prof --frames=3000` | **1.40 ms** | 2.40 | 4.70 | peak 198 e | `arena.r 0.51–0.68` |
| `--wave=29 --upg=gatling:3,buckshot:3,ricochet:3,shardOrbit:3,mines:3,stormCloud:3,drone:3,turret:3,burnTrail:3,voltaic:3 --bot --god` | **2.43 ms** | 3.80 | 7.70 | 628 pbullets | `bullets.u 0.5–1.22`, `arena.r 0.42–0.64` |
| `--nogl --wave=20 --bot --god --prof` | **11.5–13.9 ms** | — | 28.6 | 12–93 enemies, 1418–~3000 inst | **`gl.end 8.75–11.79`** — timed out |
| `--nogl --stress --prof` | **1493.8 ms** | — | **2646.9** | 500 e / 5002 b / 3196 p | **`gl.end 1383.51`** — run never finished |

**Headline: the WebGL path is in excellent shape and comfortably beats the §13 target.
The Canvas2D fallback is 300× over budget and is the single largest defect in the codebase.**
Allocation discipline is genuinely good — almost no `map/filter/forEach`, no `new` in tick paths,
`HCTX`/`KCTX`/`SCTX`/`BOPT` context objects reused, `NA.Grid` used at ~45 call sites. The findings
below are therefore mostly *structural* (a blind governor, a broken fallback, a handful of grid
bypasses) rather than the usual allocation soup.

---

## 1. `flush2D` re-executes every atlas glyph's draw function per instance — 1494 ms/frame (CRITICAL)

**`src/02_render.js:836–849`** (`flush2D` inner loop), specifically `:846` and `:848`.

For every one of up to 15,102 instances per frame the fallback does:

```js
ctx.setTransform(1,0,0,1,0,0); ctx.translate(...); ctx.rotate(...); ctx.scale(...);   // 4 matrix ops
var col = 'rgb(' + (f[o+5]*255|0) + ',' + (f[o+6]*255|0) + ',' + (f[o+7]*255|0) + ')'; // :846 — 3 string allocs
ctx.fillStyle = col; ctx.strokeStyle = col;                                            // 2 CSS-color parses
try { e.draw(ctx, e.size); } catch (err) { }                                           // :848 — re-runs the GLYPH
```

`e.draw` is the *atlas authoring* callback from `Atlas.add` — for most sprites that is `glow()`
(`:72`), which does three stacked fill passes with `shadowBlur`. The renderer already has a fully
rendered atlas canvas sitting in `Atlas.canvas`, and never uses it in the 2D path.

**Cost (measured, not estimated):** `gl.end` = 1383.5 ms of a 1493.8 ms frame in `--nogl --stress`
(0.67 fps; the harness timed out at 97 frames with a 2646.9 ms max frame). Even a *light* scene —
wave 20 — costs **8.75–11.8 ms** in `flush2D` alone, i.e. 55–70% of a 60 fps budget before any
simulation, and that run also timed out (400 frames, 28.6 ms max). Normalising the wave-20 tail
sample: **8.75 ms for 1,418 instances = ~6.2 µs per instance**, versus roughly 0.02 µs for the same
instance in the GL path. Plus ~30k transient strings/frame in stress, straight into the nursery.

Note what the governor did about it: **nothing**. It sat at quality tier 1 for the whole run,
because its down-step threshold is `avgMs > 21` (`:878`) and the 2D path's 11.5–13.9 ms never
crosses it — see #2.

**Why it matters beyond the number:** this path exists for machines with no WebGL2 — the weakest
hardware — and it is roughly 300× slower than it needs to be there.

**Fix:**
1. Replace `e.draw(ctx, e.size)` with `ctx.drawImage(Atlas.canvas, e.sx, e.sy, e.size, e.size, -h, -h, w, w)`
   — the atlas cell is already rasterised, including the baked glow.
2. Tint via a small per-color-bucket offscreen cache (quantise r/g/b to 5 bits → ≤32k keys, in
   practice a few dozen) rather than a per-instance `rgb()` string; or draw white and use
   `globalCompositeOperation='multiply'` on a tint layer per layer.
3. Cache the color string keyed on the quantised triple in a plain array, not rebuilt per instance.
4. Use `ctx.setTransform(cos*s, sin*s, -sin*s, cos*s, tx, ty)` — one call instead of four.
5. Drop the per-instance `try/catch`; hoist it to per-layer.
6. Hard-cap 2D-mode instances per layer (e.g. `LAYER_CAP` × 0.25 when `R.mode==='2d'`) so the
   fallback degrades instead of dying.

---

## 2. The quality governor is blind to GPU time and cannot rescue the 2D path (CRITICAL)

**`src/02_render.js:861–888`**, fed by **`src/16_game.js:515–516`**.

```js
var t0 = performance.now();      // 16_game.js:487
... whole frame ...
NA.R.reportFrame(t1 - t0);       // 16_game.js:516
```

`t1 - t0` is **CPU work only**. Every GL call is asynchronous: `bufferSubData` +
`drawArraysInstanced` return immediately, so the measurement excludes rasterisation, the bloom /
post chain, the light-accumulation FBO, and overdraw from additive layers. On an integrated GPU at
1080p with 15k additive instances plus post, the GPU is the bottleneck and `avgMs` will read 4–5 ms
while the display sits at 20–30 fps. The governor's ladder (`particleCap`, `resScale`) is precisely
the set of levers that fix a GPU-bound frame — and it will never pull them.

Secondary defects in the same function:
- **`:886`** — `setQuality` only touches `particleCap` and `resScale`. GAME_PLAN §13 promises
  "bloom off → particle caps → resolution scale → trails off". Bloom/post is gated on
  `R.quality >= 2` only for the darkness/light pass (`:748`); `postActive()` bloom is not stepped
  down at all, and trails are never disabled.
- **`:878` threshold vs. the real failure mode** — 21 ms is 63 fps' worth of *headroom past* 60 fps.
  A frame that costs 12–20 ms is already dropping frames on a 60 Hz display and the governor does
  not react at all. Measured: the `--nogl --wave=20` run held 11.5–13.9 ms for 400 frames and the
  governor never stepped down once. The down-threshold should be ~15 ms (with the up-threshold's
  12.5 ms tightened correspondingly, or the hysteresis widened).
- **`:883`** — in 2D mode quality is clamped to 1, so exactly one step down is available, and it
  changes nothing that matters for finding #1 (particleCap is already 500 at `:477`).
- **`:876`** — `holdT += ms / 1000` accumulates *frame CPU milliseconds*, not wall time. At 4.7 ms
  CPU/frame the 1.2 "second" hysteresis is really ~4.3 s of wall time; at 30 ms it is ~1.3 s. The
  window is inversely proportional to how fast you are running — backwards from intent.
- **`:871–875`** — `Array.prototype.slice.call(frameHist.subarray(0, fhN))` allocates a 120-element
  JS array plus a comparator closure and sorts it, twice a second, purely for a debug p95.
  Also gated on `(NA.Time.frames & 31) === 0`, and `NA.Time.frames` advances per *sim step*, so with
  `--fast=N` the gate fires erratically.

**Fix:** add a `EXT_disjoint_timer_query_webgl2` GPU timer (query one frame in 30, fall back to
present-to-present rAF delta when unavailable) and drive the governor on `max(cpuMs, gpuMs)` — or,
minimally, feed it the rAF-to-rAF delta clamped to exclude tab stalls, which does capture GPU
back-pressure. Accumulate `holdT` from `realDt`. Add bloom-off and trails-off rungs to `setQuality`.
Compute p95 with a bounded insertion into a preallocated `Float32Array` scratch.

---

## 3. `Arena.render` rebuilds the membrane from scratch every frame — top CPU cost in normal play

**`src/06_arena.js:252–266`**

```js
var steps = A.shape === 'hex' ? 96 : 84;
for (var i = 0; i <= steps; i++) {
  var a = i / steps * M.TAU;
  var rr = A.radiusAt(a);                       // :90 — modulo, cos, 2 array lerps (hex: +1 cos)
  var x = A.cx + Math.cos(a)*rr, y = A.cy + Math.sin(a)*rr;
  R.line(L.MEMBRANE, px, py, x, y, ...);        // :  each R.line = sqrt + atan2 (02_render.js:398)
  R.line(L.MEMBRANE, cos(a - TAU/steps)*ir, ..., cos(a)*ir, ..., 34, ...);   // 4 more cos/sin
}
```

Per frame: ~190 `R.line` calls → 190 `sqrt` + 190 `atan2`, plus ~570 `cos`/`sin` in the loop body,
plus 84–96 `radiusAt` calls. All to draw a ring whose geometry changes only when `A.radius`,
`A.shape`, `A.rot` or `A.sides[]` change — i.e. rarely, and smoothly.

**Measured:** `arena.r` is the **#1 or #2 profiled module in every GL scenario**: 0.63–0.76 ms at
wave 28, 0.51–0.68 ms at endless 40, 0.42–0.64 ms on the heavy upgrade stack, 0.40–0.48 ms even in
`--stress` where 500 enemies and 5000 bullets are competing for the frame. That is **25–45% of the
entire measured frame** in ordinary play, spent on static scenery.

**Fix:** cache the ring into two `Float32Array(steps+1)` vertex buffers plus the inner band, rebuilt
only when a `A._ringDirty` flag is set (`setRadius`, shape change, `sides` interpolation step, `rot`
change). Emit the cached vertices through `R.line`. Additionally scale `steps` with
`NA.R.quality` and with on-screen arc length (`A.radius / Cam.viewW()`) — at typical zoom, 84
segments is far more than the ~2 px/segment the screen can resolve. Expected saving: 0.3–0.6 ms/frame,
i.e. the largest single CPU win available on the GL path.

---

## 4. `arena.depth()` per bullet per frame: 5,000 `atan2` + `radiusAt` calls

**`src/08_bullets.js:162`** (player bullets) and **`src/08_bullets.js:238`** (enemy bullets), calling
**`src/06_arena.js:103–108`**:

```js
depth: function (x, y) {
  var d = Math.sqrt(dx*dx + dy*dy);
  return A.radiusAt(Math.atan2(dy, dx)) - d;    // atan2 + radiusAt for EVERY bullet
}
```

With the stress scene's 2500 player + 2512 enemy bullets that is 5,012 `sqrt` + 5,012 `atan2` +
5,012 `radiusAt` (each of which does a modulo, a floor, two array reads and a lerp — plus another
`cos` when the arena is hexagonal) — every single frame. Well over 99% of those bullets are nowhere
near the membrane.

**Measured:** `bullets.u` is the dominant stress cost at 2.06–3.45 ms. Reasoning about the
arithmetic, `depth()` plausibly accounts for 0.6–1.2 ms of it.

**Fix:** cache `A.minRadius = A.radius - max(A.sides[])` (recomputed when `sides` changes, which is
already a slow interpolation) and early-out in `depth()`/the bullet loops on
`dx*dx + dy*dy < minRadius*minRadius` → return a positive sentinel without touching `atan2`. Same
guard belongs in `clampToArena` (`src/10_enemies.js`) and `softWall`/`clampHard`
(`src/06_arena.js:120,146`). Roughly a 20× reduction in `radiusAt` traffic.

---

## 5. `Enemies._area` scans every enemy per explosion — grid bypassed

**`src/10_enemies.js:173–186`**

```js
_area: function (x, y, r, amt, src) {
  for (var i = 0; i < P.n; i++) {               // ALL enemies, every explosion
    var dx = P.x[i] - x, dy = P.y[i] - y;
    if (dx*dx + dy*dy > r2) continue;
    ...
```

Callers: `NA.Bullets.explode` (**`src/08_bullets.js:97`** — fires on every explosive-bullet impact
*and* every explosive-bullet membrane pop), `src/10_enemies.js:244`, and
`src/11_upgrades.js:519`. The mirror helper `H.damageArea` (**`src/11_upgrades.js:484–496`**) has the
identical full scan and is used by mines (`:2192`) and the turret/blast paths (`:2401`) — while
`nearestEnemy` thirty lines above it (`:457`) correctly uses `E.grid.query`.

**Cost:** O(explosions × enemies). A blast/mortar build at wave 29+ with ~20 explosions in a frame
against 500 enemies is 10,000 distance tests per frame plus the pool-scan overhead; a chained
`explodeKillCb` cascade multiplies it. The `--upg` run above shows `bullets.u` spiking to 1.22 ms
during explosion bursts with only 628 bullets and single-digit enemies — the shape is there, the
enemy count in a bot/god run just never gets high enough to expose it.

**Fix:** replace both scans with `En.grid.query(x, y, r)` + the exact squared test, exactly as
`hExplode` (`src/11_upgrades.js:559`) and `chainLightning` (`:560`) already do. Guard the
swap-remove interaction by iterating the returned indices in descending order or re-checking
`i < E.n`, which the surrounding code already does everywhere else.

---

## 6. `Upgrades.emit` runs a `for…in` over a dictionary object on every bullet hit

**`src/11_upgrades.js:254–263`**

```js
emit: function (hook, ctx) {
  for (var id in U.owned) {                     // for-in over a dictionary-mode object
    var lvl = U.owned[id]; if (!lvl) continue;
    var d = defs[id]; if (!d) continue;
    for (var t = 0; t < lvl; t++) {
      var td = d.tiers[t];
      if (td && td[hook]) td[hook](ctx);         // + a string-keyed miss per tier per hook
    }
  }
}
```

Called from **`src/08_bullets.js:211`** — inside the player-bullet × enemy collision inner loop, i.e.
**once per hit**. `U.owned` is mutated via `take()`, so V8 keeps it in dictionary mode; `for…in`
over such an object builds an enumeration cache and cannot be inlined. A late-game build has ~12–15
owned upgrades at up to 3 tiers each → ~45 iterations, each with a `defs[id]` dictionary lookup and
a `td[hook]` string-keyed miss (most tiers don't implement `onHit`), per hit.

With gatling + buckshot at tier 3 the hit rate reaches 50–200/frame late-wave: **2,000–9,000
dictionary operations plus 50–200 enumeration-cache allocations per frame**, all to dispatch a
handful of real callbacks. `U.update` (`:265`) and `U.render` (`:279`) have the same `for…in`,
once per frame each (cheap by comparison, same fix).

**Fix:** maintain `U._hooks = { onHit: [], onKill: [], onFire: [], onDash: [], onSpend: [] }` as flat
arrays of bound tier functions, rebuilt only inside `take()`/`reset()`/`restoreStatics()`. `emit`
becomes `var a = U._hooks[hook]; for (var i=0;i<a.length;i++) a[i](ctx);` — typically 0–3 iterations
with a monomorphic call site. Also build `U._updates` / `U._renders` arrays the same way.

---

## 7. Audio allocates a 6-object voice and a `setTimeout` per sfx, with no per-name rate limit

**`src/03_audio.js:356–367`** (`newVoice`), **`:404–407`** (`retire`), **`:1054–1080`** (`Audio.sfx`).

```js
var v = { end: endTime, s: [], g: [], f: [], p: [], x: [], dead: false, timer: 0 };  // 6 allocations
...
function retire(v) { v.timer = setTimeout(function () { ... killVoice(v, false); }, ms); }  // + a closure + a host timer
```

And the only rate limit in the whole module is:

```js
if (name === 'shot') { if (now - lastShotAt < 0.03) return; lastShotAt = now; }   // :1064
```

`kill`, `killCombo`, `hit`, `explode`, `wall`, `graze`, `lightning` are unlimited. `NA.Audio.sfx('wall', …)`
fires from **`src/08_bullets.js:177`** on every bouncing bullet's membrane contact — a ricochet:3
build in the stress scene generates dozens per frame. A blast chain killing 40 enemies calls
`sfx('kill')` 40 times in one frame.

Each of those 40 calls: allocates the voice object + 5 arrays + a closure; hits `VOICE_CAP = 24`
(**`:97`**) so `newVoice` scans 24 voices to steal one; `killVoice` disconnects ~8 nodes,
`cancelScheduledValues` on each, `voices.indexOf(v)` + `splice`, `clearTimeout`; then registers a
fresh `setTimeout`. **16 of those 40 sounds are stolen before they are ever audible** — full setup
and teardown for nothing. There is no `Audio.update` at all (`src/16_game.js:349` guards for one that
doesn't exist), so retirement is entirely timer-driven: at 60 sfx/s that is 60 host timers created
and cleared per second, forever.

**Fix:**
1. A per-name cooldown table (`kill`/`hit`/`explode`/`wall`/`graze` at 25–40 ms, `lightning` at 60 ms)
   checked *before* `newVoice` — the fix that removes ~80% of the work.
2. Pool voice objects on a free list; `killVoice` returns `v` to the list with `v.s.length = 0` etc.
   (already done for the node arrays) instead of dropping it.
3. Replace `retire`'s `setTimeout` with a single sweep in a real `Audio.update(dt)` over `voices`
   comparing `v.end <= ctx.currentTime` — one loop of ≤24 per frame, zero timers, zero closures.
4. Swap `voices.splice(indexOf(v))` for a swap-remove.

---

## 8. `R.poly` / `R.polyFill` concatenate a string on every call

**`src/02_render.js:414`** and **`:424`**

```js
if (sides >= 3 && sides <= 8) { R.sprite(layer, 'p' + sides, x, y, ...); return; }
if (sides >= 3 && sides <= 8) R.sprite(layer, 'f' + sides, x, y, ...);
```

`'p' + sides` allocates a rope/short string per call, which is then used as a hash key in
`Atlas.map` (see #9). `R.poly` is called from the enemy print-in path (`src/10_enemies.js` render,
`R.poly` at the spawn scanline branch), every mutator rim (one per mutated enemy per frame), and
liberally from `11*/12/13*` render functions. Hundreds of transient strings per frame in a busy scene.

**Fix:** `var POLY_ID = [,,,'p3','p4','p5','p6','p7','p8'], FILL_ID = [,,,'f3',…];` and index it —
zero allocation, and it pairs naturally with #9.

---

## 9. `Atlas.map[id]` — a string-keyed hash lookup on the hottest function in the engine

**`src/02_render.js:380`**, inside `R.sprite`:

```js
var e = Atlas.map[id]; if (!e) e = Atlas.map.dot;
```

`R.sprite` runs 14,996 times per frame in stress and 5,111 times on the heavy upgrade stack (measured
`instances`). `Atlas.map` is `Object.create(null)` grown by `Atlas.add` at runtime
(`src/12_events.js:191,205` add glyphs lazily), so it is a dictionary-mode object and every lookup is
a full hash probe with a string-hash computation on the key.

**Cost:** ~15k dictionary probes/frame; on the order of 0.15–0.4 ms in the stress scene, entirely
avoidable. Callers pass *literal* ids that are known at authoring time.

**Fix:** expose numeric handles — `NA.R.S = { spark: 3, circle: 7, … }` resolved once after atlas
build (`Atlas.list` index, which `flush2D` already uses via `R.kinds`) — and add
`R.spriteK(layer, kind, …)` that indexes `Atlas.list[kind]` directly. Migrate the hot emitters first
(`Particles.render`, `Bullets.render`, `Enemies.render`, `R.line`/`R.ring`/`R.dot`, which use a fixed
handful of ids). Keep the string form as a thin wrapper for cold call sites.

Related: `Atlas._dirty` (`:55`, `:739–742`) triggers a **full `texImage2D` re-upload of the entire
atlas canvas**. That is correctly one-shot today, but nothing prevents a future `Atlas.add` from a
per-frame path; consider asserting/warning when `_dirty` is set after boot.

---

## 10. `gravityWell` scans every enemy bullet linearly while an `ebGrid` sits unused

**`src/11b_upgrades_b.js:1556–1565`**

```js
var cnt = En.grid.query(well.x, well.y, well.r), out = En.grid.out;   // enemies: grid ✓
...
var E = B.E, r2 = well.r * well.r;
for (var b = 0; b < E.n; b++) {                                       // enemy bullets: full scan ✗
```

The enemies half correctly uses the grid; the bullet half walks all `E.n` enemy bullets every frame
for the full 3-second duration of the well. Meanwhile **`src/11b_upgrades_b.js:423–426`** already
builds and maintains `ebGrid` over exactly this pool, and `:1754` / `:1931` already query it.

**Cost:** in a bullet-hell late wave with 2,000–3,000 enemy bullets, 3,000 iterations/frame × 3 s per
cast. Bounded but pure waste. The same shape appears at `src/13c_bosses_2.js:858`
(`for (k2=0; k2<E.n; k2++) E.vx[k2] += …` — a global field, so unavoidable) and
`src/13d_bosses_3.js:1826`.

**Fix:** `ebGrid.query(well.x, well.y, well.r)` — a two-line change; `ebGrid` is already rebuilt each
frame at `:425–426`.

---

## 11. No frustum culling anywhere, and the backdrop is unconditional at every quality tier

**`src/02_render.js:377` (`R.sprite`)** has no visibility test; the only cap is the silent
`if (c >= LAYER_CAP[layer]) return;` at `:379`. `grep -n "cull\|onScreen\|inView" src/02_render.js
src/07_fx.js src/10_enemies.js` returns nothing.

Every particle, bullet, enemy, arena segment and star is packed into the instance buffer and uploaded
regardless of whether it is on screen. In a `--wave` fight the camera is zoomed in on a `ARENA_R`
arena, so a substantial fraction of the 15k instances are offscreen. The GPU clips them cheaply, but
the CPU pays 13 float writes + a hash lookup each, and `bufferSubData` uploads the bytes.

Separately, **`src/12_events.js:141`**: `NSTAR = 300, NLOBE = 12, NDUST = 96` are drawn every frame,
and **doubled during a biome crossfade** (`renderBackdrop` draws `bf` *and* `bt`) — ~816 sprites plus
~400 `Math.sin` calls per frame of pure background, at quality 0 exactly as at quality 3. Measured
`events.bg` = 0.13–0.22 ms.

**Fix:** add a camera-AABB reject at the top of `R.sprite` — `if (layer !== L.SCREEN && (x < R._cullX0 || x > R._cullX1 || y < R._cullY0 || y > R._cullY1)) return;` with the bounds computed once per
`R.begin()` and padded by the largest sprite half-extent. Scale `NSTAR`/`NDUST` with `R.quality`
(`[80, 150, 220, 300]`) and skip the crossfade double-draw below tier 2.

---

## 12. `Grid.out` is a single shared buffer — every nested query silently corrupts the outer loop

**`src/05_pools.js:70`** (`out: new Int32Array(1024)`) and the ~45 call sites of the form
`var cnt = En.grid.query(...), out = En.grid.out; for (q…) { … }`.

Any callee invoked inside such a loop that itself queries the grid overwrites `out` **and** `cnt`'s
meaning mid-iteration. The exposure is real: `damageEnemy` → `E.damage` → `onDeath` handlers
(splitter, popper, necromancer, volatile mutator) → `hExplode`/`chainLightning`, both of which call
`E.grid.query`. Examples of loops that damage inside a grid iteration:
`src/11_upgrades.js:1216`, `:1607`, `:1895`, `:2368`; `src/11b_upgrades_b.js:1470`, `:1647`, `:1667`;
`src/12_events.js:1194`, `:1967`.

Performance-wise this is a latent hazard rather than a measured cost, but the *defensive* pattern it
forces (re-query after every damage call) is exactly the kind of thing that turns into an O(n²) later.
It is also a correctness bug: enemies are silently skipped or double-damaged.

Additionally `out` is capped at 1024 with `if (n < cap2) out[n++] = i;` (`:115`) — a large-radius
query in the stress scene (500 enemies) is fine, but a `query(x, y, 900)` from
`src/10_enemies.js:257` in a 1000-enemy endless wave silently truncates with no diagnostic.

**Fix:** give `query` an optional caller-supplied output array (`query(x, y, r, outArr)`), and
allocate two or three module-scope scratch buffers at each nesting level that needs one — or
switch the damage-inside-loop sites to `queryCb` with a hoisted, non-capturing callback plus an
explicit re-entrancy depth counter. Expose `grid.truncated` so silent overflow is at least visible
under `?debug=1`.

---

## 13. `railgun` T2 rails: 6 × `E.n` line-segment tests, unstaggered

**`src/11_upgrades.js:1010–1027`**

```js
for (var i = 0; i < RAILS; i++) {            // RAILS = 6 (:939)
  if (rlife[i] <= 0) continue;
  rtick[i] -= dt; if (rtick[i] > 0 …) continue;
  rtick[i] = 0.22;
  for (var e = 0; e < E.n; e++) { … point-to-segment test … }   // ALL enemies
}
```

Six concurrent rails × all enemies, every 0.22 s per rail. `rtick` is reset to the same constant for
every rail, so rails fired in the same frame (the T3 "V" fires two at once) stay phase-locked and
land their scans on the *same* frame rather than spreading. Worst case 6 × 500 = 3,000 segment tests
in one frame, spiking `upgrades.u`.

**Fix:** stagger with `rtick[i] = 0.22 + i * 0.02`, and query the grid along the rail — walk the
segment in `cellSize`-length steps calling `E.grid.query(px, py, halfWidth + maxEnemySize)`, which
is what `src/11b_upgrades_b.js:1328` already does for a similar swept-line effect
(`En.grid.query(mx, my, len * 0.5 + 40)`).

---

## 14. Per-frame object literals in the render path

- **`src/07_fx.js:58–62`** — `FX.apply()` allocates a fresh 6-field object literal for
  `NA.R.setPost({ chroma, vignette, hue, darkness, flash, desat })` **every single frame**, called
  from `NA.Game.render()` (`src/16_game.js:466`). 60 objects/second forever. Direct violation of
  AGENT_RULES §4 ("no allocations inside per-frame loops"). Fix: hoist a module-scope `POST` object,
  mutate its fields, pass it — `setPost` already only reads fields.
- **`src/11_upgrades.js:2010`** — `NA.Upgrades.emit('onSpend', { amount: n, tag: tag || '' })`
  allocates a context object per spend, while `src/09_player.js:219` does the identical emit with a
  reused `SCTX`. Fix: reuse a module-scope object here too.
- **`src/15_ui.js:1512–1515`** — `renderOverlay` builds a ~10-part concatenated signature string
  every frame for its dirty check (plus `Draft.offers.join(',')` while the draft is open). The dirty
  check itself is a good design; the string is not. Fix: compare the components against cached
  scalars, or hash them into an integer.
- **`src/02_render.js:871–872`** — the p95 `slice` + `sort` closure, twice a second (see #2).

Individually small; together they are the difference between "zero steady-state allocation" (the
stated contract) and a nursery collection every few seconds.

---

## 15. Fourth-wall page filters and `flush2D`'s sibling: full-page CSS filter cost

**`src/15_ui.js:1888–1901`** (`dimPage`)

```js
document.body.style.filter = 'brightness(' + (1 - a*0.8).toFixed(3) + ') saturate(' + … + ')';
```

Setting a `filter` on `<body>` promotes the entire document — canvas included — into a filtered
compositing layer. The browser then post-processes the full viewport every frame for as long as the
filter is set, on top of the game's own post chain. Two `toFixed(3)` string allocations per call
compound it if a boss ramps the dim over time (`fwDim(amount)` at `src/13c_bosses_2.js:87` takes a
continuous 0..1 amount, and `:2426` documents "dimPage(amount01) each phase").

**Positive finding, for the record:** the fourth-wall DOM is otherwise well disciplined —
`obstacles()` reuses its result objects (`src/15_ui.js:1989–2000`), the Page boss refreshes rects
only twice a second (`src/13d_bosses_3.js:1755`), and `viewportArena(false)` removes every node it
created (`:1981–1985`). All six harness runs reported **`dom after run : nodes 0`** with an empty
`filter` and `overflowY "hidden"` — no leak.

**Fix:** guard `dimPage` so it is a no-op when the quantised amount is unchanged (it is currently
called with a continuously ramping value), and prefer painting the dim as a full-screen quad on the
`VEIL` layer inside the existing post pass — the renderer already has `R.post.darkness` — reserving
the real CSS filter for the moments where the *page chrome outside the canvas* must dim too.

---

## What is already right (so it doesn't get "fixed")

- SoA pools with swap-remove and generation counters (`src/05_pools.js:20–54`); no per-entity objects.
- The uniform spatial hash is used at ~45 sites including the bullet×enemy broadphase
  (`src/08_bullets.js:196`) and the flock separation (`src/10_enemies.js:490`), which additionally
  runs on alternate frames per entity with a cached off-frame result.
- Particle priority eviction is bounded to a 24-slot scan (`src/07_fx.js:101–110`) and has a bullet-density
  governor (`:124`). Rings/frags/afterimages/bolts are single sprites or short line runs, not arcs.
- `chainLightning` (`src/11_upgrades.js:550`) uses a stamped `visited` array and a grid query per hop —
  correct and bounded.
- One `bufferSubData` + one `drawArraysInstanced` per layer, 10–11 draw calls measured across every
  scenario, and the atlas upload is guarded by `_dirty`.
- Audio soft-clip curves are built once and cached (`:178`); noise buffers are bucketed and cached (`:337`).
- Test harness itself is allocation-conscious (`src/99_boot.js:157–166`, bounded sample ring).
- `grep` for `.map/.filter/.forEach`, spread, `Array.from`, `JSON.*`, and `arguments` finds essentially
  nothing in any tick path — the discipline is real and worth preserving.

---

## Suggested order of work

1. **#1** — rewrite `flush2D` to `drawImage` the atlas. 1494 ms → target <8 ms. Nothing else comes close.
2. **#2** — make the governor GPU-aware and give it real rungs; without this, #1 can still fail silently on weak GPUs.
3. **#3, #4** — arena ring caching and the `depth()` early-out. Together roughly 1 ms/frame on the GL path, ~40% of measured frame time in normal play.
4. **#5, #6, #10** — the three grid/dispatch bypasses. Cheap, local, and they are the ones that scale badly with the entity counts §13 targets.
5. **#7** — audio rate limiting and voice pooling, before a mass-kill build ships.
6. **#8, #9, #11, #14** — the allocation and lookup cleanups; individually small, collectively another ~0.5 ms plus a quiet nursery.
7. **#12** — the shared `Grid.out` re-entrancy. File as a correctness bug as well; it will bite harder than its perf cost.
