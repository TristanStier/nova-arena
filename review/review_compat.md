# NOVA ARENA — adversarial review: browser / single-file compatibility & robustness

Reviewed the **built** `d:\!games\nova-arena.html` (1,226 KiB, 29,715 lines, one `<script>`) plus `src/`.
Read-only; nothing under `src/` or `tools/` was modified. Build was re-run once (`node tools/build.js`) to
get a current artifact.

Harness runs performed (Edge, `file://`):

| run | mode | avg ms | p95 | max | result |
|---|---|---|---|---|---|
| `--wave=15 --frames=900` | gl (q3) | **1.18** | 2.00 | 3.8 | OK |
| `--nogl --wave=15 --frames=900` | 2d (q1) | 6.88 | 12.6 | 19.1 | OK |
| `--nogl --frames=600` | 2d (q1) | 7.20 | 9.5 | 14.1 | OK |
| `--nogl --boss=encore --frames=1200` | 2d (q1) | 6.38 | 9.2 | 13.2 | OK |
| `--stress --frames=400` | gl (q3) | **4.96** | 6.8 | 10.7 | OK |
| `--nogl --stress --frames=400/600` | 2d (q0) | **~1930–2015** | – | **3719 / 5422** | **FAIL (timeout, 82–84 frames)** |

---

## What is genuinely solid (so the findings below are read in proportion)

* **Self-containment is airtight.** Zero external URLs, `@font-face`, `@import`, `url(...)`, `src=`/`href=`
  in the built HTML. No `fetch`, `XMLHttpRequest`, `Worker`, `importScripts`, `import()`, `WebAssembly`,
  `WebSocket`, `EventSource`, `createObjectURL`, `eval`, `new Function`. Fonts are the system stack only.
* **ES level is far below the ES2020 ceiling.** No `??=`/`||=`/`&&=`, no `.at(`, `structuredClone`,
  `findLast`, `Object.hasOwn`, `replaceAll`, `toSorted`, class fields / `#private` / `static {}`, no regex
  lookbehind, no numeric separators, no BigInt, no `async`/`await`/generators, no top-level await, no
  optional chaining or `??`. Highest features in use: arrow functions, `Promise`, object getters, `const`/`let`.
  Safe to ES2016 in practice.
* **Global-scope hygiene is exemplary for a 24-file concatenation.** Exactly **one** top-level declaration in
  the whole build (`src/01_core.js:11 var NA = …`); every other file is a self-closing IIFE. Zero duplicate
  top-level `var`/`function` names, zero duplicate `NA.<name>` assignments across files (32 distinct
  namespace props, each owned by exactly one file), zero duplicate `Atlas.add` / `Enemies.define` /
  `Bosses.define` / `Upgrades.define` / `Events.define` ids. A heuristic implicit-global scan over all
  24 files returned 26 hits, **all false positives** (multi-line `var a = …,\n b = …` declarators) — no real
  strict-mode leaks found.
* **`localStorage` is fully guarded** (`src/01_core.js:245–257`, try/catch on both load and save) — correct
  for `file://` in Firefox/Safari where it throws.
* **dt is clamped twice** — `src/16_game.js:484` (`realDt > 0.1`) and again in `src/01_core.js:214`, plus a
  `maxSteps: 8` backlog drop and `acc = 0` on tab return (`src/01_core.js:318–321`). A hidden-tab timer
  clamp cannot fast-forward the sim. This is the correct shape.
* **AudioContext handling is right**: `webkitAudioContext` fallback (`src/03_audio.js:58`), auto-init bound to
  `pointerdown/mousedown/touchstart/keydown` (`:243–250`), idempotent `init()` that calls `tryResume()` on
  every subsequent gesture (`:170–172`), and `suspend()`/`resume()` on `visibilitychange` (`:236–241`).
* No `SharedArrayBuffer`, no `performance.memory`, no `process.*`, no `require` in `src/`.
* `tools/build.js:31–34` does escape `</script` → `<\/script` case-insensitively (currently a no-op: there are
  zero occurrences, and no `<!--`/`-->` sequences either).

---

## Findings, ranked

### 1. CRITICAL — the Canvas2D fallback renders almost everything pure white at full opacity
**`src/02_render.js:816–850` (flush2D) × `:72–83` (glow) × `:105, :131, :151`**

`flush2D` re-executes each glyph's **atlas bake function** directly on the visible canvas:

```js
// 02_render.js:845–848
ctx.globalAlpha = Math.min(1, a);
var col = 'rgb(' + … + ')';
ctx.fillStyle = col; ctx.strokeStyle = col;
try { e.draw(ctx, e.size); } catch (err) { }
```

Those bake functions were written to run **once, on a blank white-ink atlas**, and they clobber context state:

* `glow()` (`:72–83`) sets `ctx.globalAlpha = layers[i][1]` three times and then **`ctx.globalAlpha = 1`
  before the final crisp `body()` pass**. The per-sprite alpha set on line 845 is therefore discarded for
  every glyph that uses `glow()` — which is 22 of the 25 glyphs. Everything draws at opacity 1.
* `glow()` also sets `ctx.shadowColor = 'rgba(255,255,255,1)'` (`:75`) and never restores it, so all three
  blur passes emit a **white** halo regardless of the requested colour, and the white shadowColor leaks into
  every later sprite.
* `disc` (`:105`), `ringSoft` (`:131`) and `spark` (`:151`) set `c.fillStyle = <white radial gradient>` and
  then hard-reset `c.fillStyle = '#fff'`, so `R.disc()`, `R.softRing()`, every particle and every light draws
  **pure white**, ignoring the colour on line 847 entirely.
* There is no `ctx.save()/restore()` around `e.draw()`, so all of that state leaks forward.

**Repro:** `node tools/test.js --nogl --wave=15 --frames=900`, then compare `tools/out/wave15.png` against the
same run without `--nogl`. GL: amber arena boundary, crimson HUD ring, teal telegraphs, vignette. Canvas2D:
two enormous blown-out white discs/rings covering the screen, no vignette, no colour — the arena boundary and
the HUD are unreadable. This is the *only* renderer on any browser without WebGL2 (Safari < 15, older Android,
GPU blocklist, `--disable-gpu`, VMs/RDP), and in that mode the game is visually broken, not degraded.

**Fix:** stop re-running bake functions per instance. The atlas canvas is already built in `R.init` even in 2D
mode (`buildAtlas()` at `:462`) and holds the correct glow-baked white mask. In `flush2D`, `drawImage` the cell
(`e.u0*ATLAS_SIZE, e.v0*ATLAS_SIZE, e.size, e.size`) into the destination rect, and tint it: keep one small
scratch canvas, `drawImage` the cell into it, `globalCompositeOperation='source-in'` + `fillRect` with the
instance colour, then blit at the instance `globalAlpha`. (A per-(glyph,quantised-colour) LRU cache of tinted
cells makes it essentially free.) This fixes colour, alpha, glow tint and finding #2 in one change. If a
re-execution path must be kept as a stopgap, at minimum wrap it in `ctx.save()/ctx.restore()` — but that still
leaves the white gradients and white `shadowColor`.

---

### 2. CRITICAL — the Canvas2D fallback is ~400× slower than GL and hard-locks the tab under load
**`src/02_render.js:848` (per-instance `e.draw`) × `:72–83` (`shadowBlur`)**

Same root cause. Every sprite runs `glow()`, which issues **four** full path draws, three of them with
`ctx.shadowBlur` set — the single most expensive operation in Canvas2D. `R.arc()` (`:414–424`) expands one arc
into up to **48** line sprites, each paying that cost. Measured:

```
node tools/test.js --stress --frames=400            → gl,  4.96 ms avg,  max 10.7 ms,  OK
node tools/test.js --nogl --stress --frames=400     → 2d,  ~2015 ms avg, max 3719 ms,  82/400 frames, FAIL
node tools/test.js --nogl --stress --frames=600     → 2d,  ~1931 ms avg, max 5422 ms,  84/600 frames, FAIL
```

0.5 fps with 15,091 instances. The quality governor has already bottomed out at tier 0 and cannot recover,
because the cost is per-sprite CPU work, not resolution. A 5-second frame will trip Chrome's "page unresponsive"
dialog. Note the harness summary printed `frame avg 0.00 ms (1000000 fps)` for these runs — `T.avgMs` is only
computed inside the `T.done && !T._final` branch (`src/99_boot.js:196–200`), so an aborted run reports zero and
the 2-second frames are visible *only* in the streamed `NA_STATS` lines. That masking is why this was not caught.

**Fix:** the `drawImage`-from-atlas rewrite in #1. Secondary: in 2D mode cap `R.arc` segment count much lower
(e.g. 12) and clamp `LAYER_CAP`/particle budgets harder when `R.mode === '2d'`. Separately, make
`src/99_boot.js:196` compute `avgMs`/`p95Ms` unconditionally so an incomplete run still reports its real timings.

---

### 3. HIGH — no WebGL context-loss handling anywhere
**`src/02_render.js:456–483` (`R.init`)**

`grep -rn 'webglcontextlost\|webglcontextrestored\|isContextLost' src/` → **zero hits**. On context loss (GPU
driver reset/update, Windows TDR, laptop GPU switch, tab backgrounded on mobile Safari, or simply too many live
WebGL contexts) every GL call silently no-ops: the canvas goes permanently black while `NA.Game.frame` keeps
running, input keeps working, audio keeps playing. The player sees a dead black screen with no way back except
a reload — and there is no text in the game to tell them to reload.

**Fix:** in `R.init`, after obtaining the context:
```js
glCanvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); R.mode = '2d';
  R.ctx2d = R.ctx2d || glCanvas.getContext('2d'); NA.Time.paused = true; }, false);
glCanvas.addEventListener('webglcontextrestored', function () { R.gl = glCanvas.getContext('webgl2', …);
  if (R.gl) { initGL(R.gl); Atlas._dirty = true; fbW = fbH = 0; R.resize(); R.mode = 'gl'; }
  NA.Time.paused = false; }, false);
```
(`preventDefault()` on the lost event is mandatory or `webglcontextrestored` never fires.) Note that switching
to `'2d'` on loss is only a real rescue once #1/#2 are fixed. Also add a periodic `gl.isContextLost()` check in
`flushGL` so a loss that arrives without the event still degrades instead of black-screening.

---

### 4. HIGH — a WebGL2 init failure kills the whole game instead of falling back to Canvas2D
**`src/02_render.js:470–477`, `:583–598` (`compile`/`link`), `src/99_boot.js:50–93`**

```js
// 02_render.js:470–477
try { … gl = glCanvas.getContext('webgl2', {…}); } catch (e) { gl = null; }
if (gl) { R.gl = gl; R.mode = 'gl'; initGL(gl); }      // <-- NOT inside the try
else    { R.mode = '2d'; … }
```

The try/catch covers only `getContext`. `initGL` → `link` → `compile` **throw** on any shader compile or link
failure (`:586`, `:596`). That is a real scenario: ANGLE/D3D fallback drivers, SwiftShader with
`mediump` precision quirks, some Intel/Mali drivers, and browsers that hand out a WebGL2 context that then fails
to compile `#version 300 es`. The exception propagates out of `R.init`, is caught by `boot()`'s catch
(`src/99_boot.js:91`), and `requestAnimationFrame(loop)` on line 89 is **never reached** — permanent black
screen, no game loop, and (outside `?debug`/`?test`) the `#err` box stays hidden, so the user sees nothing.
`R.mode` is also left as `'gl'` with a broken `R.gl`.

**Fix:** wrap the GL bring-up and demote on failure:
```js
if (gl) { R.gl = gl; R.mode = 'gl';
  try { initGL(gl); } catch (e) { R.gl = null; R.mode = '2d'; R.ctx2d = glCanvas.getContext('2d');
        R.particleCap = 500; R.quality = 1; } }
if (!R.gl) { R.mode = '2d'; R.ctx2d = R.ctx2d || glCanvas.getContext('2d'); … }
```
Also guard `R.ctx2d === null` (canvas allocation can fail on memory-starved mobile) with a last-ditch visible
message, since the game has no other way to report it.

---

### 5. HIGH — `dotRim`'s bake function punches holes in the live canvas in 2D mode
**`src/02_render.js:113–119` × `:832, :848`**

```js
// 02_render.js:115–118  (inside the dotRim glyph's drawFn)
c.globalCompositeOperation = 'destination-out';
c.lineWidth = s * 0.045; c.strokeStyle = 'rgba(0,0,0,1)';
c.beginPath(); c.arc(0, 0, s * I * 0.92, 0, M.TAU); c.stroke();
c.globalCompositeOperation = 'source-over'; c.strokeStyle = '#fff';
```

`dotRim` is the **enemy bullet** glyph — the single most numerous sprite on screen. In `flush2D` this runs on
the visible canvas, so every enemy bullet (a) erases a ring of already-drawn scene pixels via `destination-out`,
and (b) resets `globalCompositeOperation` to `'source-over'`, silently cancelling the `'lighter'` mode that
`flush2D:832` set for the whole additive layer — so every sprite after the first enemy bullet in that layer
loses additive blending. Enemy bullets are exactly the thing that must never be hard to see.

**Fix:** covered by the `drawImage`-from-atlas rewrite in #1. Until then, `ctx.save()/restore()` around
`e.draw()` at `:848` at least contains the composite-mode leak (it will not undo the erased pixels).

---

### 6. HIGH — `tools/build.js` can never fail, and one syntax error ships a completely dead file
**`tools/build.js:37` (`let errors = 0;`) and `:88` (`process.exit(errors ? 1 : 0);`)**

`errors` is declared and never incremented anywhere in the file, so `build.js` always exits 0. The build also
never syntax-checks the sources, and it emits **all 24 files into a single `<script>` block**
(`tools/build.js:63`, verified: exactly one `<script>` at line 48 and one `</script>` at line 29603 of the
artifact). Consequences of one bad character in any `src/*.js`, in a workflow where several agents edit
different files concurrently:

* the entire 29.6k-line script fails to parse — **every** `NA.*` module is undefined;
* `src/99_boot.js`'s `window.addEventListener('error', …)` never installs, so not even the `#err` overlay appears;
* the page is a silent black rectangle, and `node tools/build.js` reported success.

**Fix:** in the per-file loop, `new vm.Script(code, { filename: f })` (or `child_process.execFileSync(process.execPath, ['--check', p])`)
inside a try/catch; on failure `errors++` and print `f:line`. Keep `process.exit(errors ? 1 : 0)`. Cheap
belt-and-braces: emit one `<script>` per source file so a single bad file cannot take the boot handler with it.
(Related latent issue: file order comes from a plain lexicographic sort of `readdirSync`, so a future
`9_foo.js` would sort *after* `13d_…` and before `98_bot.js`. Prefer an explicit numeric-prefix comparator.)

---

### 7. MEDIUM — the Canvas2D path silently drops every post-process effect and all lights
**`src/02_render.js:816–856` vs `:546–581` (post shader) and `:707–…` (`flushGL`)**

`flush2D` implements exactly one post effect — `p.flash` (`:850–854`). `chroma`, `vignette` (default **0.35**,
`:356`), `hue`, `desat` and `darkness` are ignored, and `R.light()` accumulation is never drawn. So in the
fallback:

* `NA.FX.darkness(...)` — the eclipse/`darkPhase` events and the Dimmer/Eclipse boss beats — is a **complete
  no-op**. Mechanics that read as "the arena goes dark, only lit things are visible" simply do not happen; the
  fight's readability contract silently changes.
* `NA.FX.desat/hue/chroma` telegraph cues vanish; the permanent vignette that frames the arena vanishes.

Visible in the screenshot comparison for #1. Not a crash, but it is a per-browser gameplay/readability
divergence in the only fallback path.

**Fix:** after the sprite pass in `flush2D`, apply the cheap subset with plain 2D ops on the whole canvas —
`darkness` and `vignette` as a `createRadialGradient` overlay, `desat`/`hue` skipped or approximated with a
flat multiply, `chroma` skipped. At minimum have `NA.FX.darkness` fall back to a flat dark overlay so the
mechanic still reads.

---

### 8. MEDIUM — the Canvas2D path ignores camera shake rotation and backdrop parallax
**`src/02_render.js:836–839` vs `:472–487` (`camUniforms`)**

`camUniforms` applies `Cam.shakeRot` and gives `L.BACKDROP` a 30 %-scaled shake for parallax. `flush2D` uses
only `Cam.x + Cam.shakeX` / `Cam.y + Cam.shakeY` for every layer — no rotation, no parallax. Impact hits are
noticeably flatter in the fallback and the backdrop locks to the foreground.

**Fix:** in the per-layer setup, mirror `camUniforms`: compute `rot` (0 for `SCREEN`, `Cam.shakeRot * 0.3` for
`BACKDROP`, `Cam.shakeRot` otherwise) and apply it as a canvas-wide `translate(pw/2,ph/2); rotate(rot);
translate(-pw/2,-ph/2)` before the layer's sprites, and scale `shakeX/shakeY` by 0.3 on the backdrop.

---

### 9. MEDIUM — the `--nogl` harness runs do not actually exercise the fallback
**`tools/test.js:69–88`, `src/99_boot.js:79–86`**

`--nogl --wave=15`, `--nogl --boss=encore` and plain `--nogl` all start with autofire and **no autopilot**, so
the player dies in ~20 s of sim and the remaining 60–90 % of frames render the static death screen. Evidence:

```
--nogl --wave=15  : death at frame 300, then 600 frames of "death w15", 908 instances
--nogl --boss=encore : death at wave 1, boss frozen at "encore:fight:p0:450" for 1200 frames, 848 instances
```

Both reported "OK" while measuring almost nothing. The only run that put real load through `flush2D`
(`--nogl --stress`) failed catastrophically. Any future "the 2D fallback is fine" claim based on these runs is
unsound.

**Fix:** always pair `--nogl` with `--bot --god` (e.g.
`node tools/test.js --nogl --bot --god --wave=15 --frames=3000`), and add a hard assertion in `tools/test.js`
that fails the run when `avgMs` exceeds a budget (say 33 ms) — today a 2000 ms/frame result only surfaces as a
timeout, and the summary prints `0.00 ms`.

---

### 10. MEDIUM — `dimPage()` puts a CSS `filter` on `<body>`, which breaks `position:fixed` for the arena
**`src/15_ui.js:1886–1899`, `src/00_shell.html` (`#wrap { position: fixed; inset: 0; }`), `viewportArena` at `src/15_ui.js:1953+`**

```js
// 15_ui.js:1895–1897
document.body.style.filter = 'brightness(' + … + ') saturate(' + … + ')';
```

A non-`none` `filter` on an element makes it the containing block for **all** `position: fixed` descendants
(spec behaviour, uniform across Chrome/Firefox/Safari). `#wrap` — which holds both canvases — is
`position: fixed; inset: 0`. While the page is not scrollable this is invisible, but `viewportArena(true)`
deliberately sets `document.body.style.overflowY = 'auto'` and appends a 3000 px `.na-tall` spacer. If any boss
beat has `dimPage(x > 0)` active while `viewportArena(true)` is scrolling the page (the fourth-wall bosses are
exactly the ones that use both), the arena canvases scroll out of view instead of staying pinned. It also forces
a full-page compositing pass every frame while dimmed — a measurable cost in Firefox/Safari.

**Fix:** apply the dim to `#wrap` (or to a dedicated overlay `div` with a `background: rgba(0,0,0,a)` and
`mix-blend-mode`) instead of `document.body`, or set `#wrap { position: absolute }` when a body filter is
active. Add a guard so `dimPage()` and `viewportArena(true)` cannot both be live, and assert it in the harness's
existing `dom after run` check (which already reports `filter` and `overflowY`).

---

### 11. MEDIUM — the harness relaxes exactly the restrictions the deliverable must survive
**`tools/test.js:118–128`**

Edge is launched with `--allow-file-access-from-files`, `--mute-audio`,
`--disable-background-timer-throttling`, `--disable-renderer-backgrounding`,
`--disable-backgrounding-occluded-windows` and `--no-sandbox`. So the shipped `file://` behaviour that the brief
cares about is never validated: real `file://` origin restrictions, the autoplay/`AudioContext`-suspended path,
rAF throttling on a hidden/occluded tab, and the `visibilitychange` dt path. Nothing currently *needs* those
relaxations (no `fetch`, no cross-file access), which is why this is medium rather than high — but the safety
net is imaginary.

**Fix:** add a `--strict` mode to `tools/test.js` that drops those flags, and one manual pass in Firefox and
Safari (or at least Firefox) opening `nova-arena.html` by double-click, checking: audio starts on the first
click, `localStorage` writes do not throw, and the game survives an alt-tab of >60 s.

---

### 12. LOW/MEDIUM — `Atlas.add` has no vertical overflow guard, and the 16 MB atlas is dead weight in 2D mode
**`src/02_render.js:35–56`, `:60–66`**

```js
if (Atlas._x + size + pad > ATLAS_SIZE) { Atlas._x = 0; Atlas._y += Atlas._rowH + pad; Atlas._rowH = 0; }
```

Rows wrap horizontally but `Atlas._y` is never checked against `ATLAS_SIZE`. Once the shelf allocator runs past
2048 px vertically, entries get `v0 > 1` and sample garbage (GL) or read outside the canvas (2D) — silently, with
no error. Currently harmless (the built game registers **35** glyphs, ~0.5 % of a 2048² sheet), but it is the
kind of thing that breaks when a later agent adds glyphs. Separately, `buildAtlas()` runs unconditionally at
`R.init:462`, so the 2048×2048 canvas (**16 MB** of backing store) is allocated even in `'2d'` mode where
nothing ever reads it — wasteful precisely on the low-end devices that land in the fallback.

**Fix:** `if (Atlas._y + size + pad > ATLAS_SIZE) { console.warn('atlas full: ' + id); return Atlas.map.dot; }`.
The 16 MB stops being waste as soon as #1 is fixed (the fallback will blit from it).

---

### 13. LOW — unguarded `console.warn` ships to end users from the boss-3 module
**`src/13d_bosses_3.js:49–54`**

```js
function dbg(msg) {
  try {
    if (typeof console !== 'undefined' && console.warn) console.warn('[NA.Bosses3] ' + msg);   // :51
    if (typeof document === 'undefined') return;
    if (!NA.params.debug && !NA.params.test) return;                                            // :53
```

The `console.warn` fires **before** the `debug`/`test` gate, so a shipped, non-debug run prints boss diagnostics
to the user's console. Every other module gets this right — compare `src/14_waves.js:925`, which guards on
`NA.params.debug` first. (This file is being edited concurrently for the siren; flagging the pattern, not the
siren.) Otherwise console noise is minimal and correct: `NA_STATS` only under `?test=1`
(`src/99_boot.js:184`), and `console.error` only from the real error handlers.

**Fix:** move line 51 below line 53.

---

### 14. LOW — `NA.params` is a plain object, so query keys can shadow `Object.prototype`
**`src/01_core.js:15–25`**

```js
var p = {};
… p[decodeURIComponent(k)] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1));
```

`?constructor=1`, `?toString=1`, `?valueOf=1` etc. overwrite inherited members with strings; `?__proto__=1` is
ignored by the engine but `?__proto__[x]=…` shapes are a footgun. Nothing currently reads those names off
`NA.params`, so this is hygiene rather than an exploit — but it costs one word to fix.

**Fix:** `var p = Object.create(null);`.

---

### 15. LOW — `resize` is unthrottled and DPR changes are not observed
**`src/02_render.js:481` (`window.addEventListener('resize', R.resize)`), `:485–496` (`R.resize`)**

Every `resize` event synchronously resizes two canvases and, via `resizeTargets` (`:670–679`), deletes and
recreates both framebuffer textures. A window drag-resize fires this dozens of times per second — a stall storm,
and on mobile Safari the address-bar show/hide fires it constantly. Separately, `dpr` is read once per resize
(`:486`, correctly clamped to 2), but there is no
`matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')` listener, so moving the window to a monitor with a
different DPR leaves the canvas at the old backing scale in browsers that do not emit a `resize` for it (Firefox).

**Fix:** debounce with a `requestAnimationFrame` coalescer (`if (!pending) { pending = 1;
requestAnimationFrame(function () { pending = 0; doResize(); }); }`) and re-arm a `matchMedia` DPR listener
after each resize.

---

## Explicitly checked and clean

| Check | Result |
|---|---|
| External URLs / fonts / `@import` / `url()` in built HTML | none |
| `fetch` / XHR / Worker / `import()` / WASM / WebSocket / `createObjectURL` | none |
| `eval` / `new Function` / `document.write` / `innerHTML` | one benign `innerHTML = ''` clear (`src/15_ui.js:2127`) |
| ES2021+ syntax (`??=`, `\|\|=`, `.at(`, `structuredClone`, `findLast`, `Object.hasOwn`, `replaceAll`, `#private`, `static {}`, lookbehind, top-level await) | none |
| Duplicate top-level `var`/`function` across concatenated files | none (1 global total: `NA`) |
| Duplicate `NA.<name>` assignments across files | none (32 props, 1 owner each) |
| Duplicate `Atlas.add` / registry ids across files | none |
| Implicit globals under `"use strict"` | none found (26 heuristic hits, all false positives) |
| `localStorage` guarded for `file://` | yes, try/catch both ways |
| `SharedArrayBuffer` / `performance.memory` | not used |
| dt clamp on tab-hidden return | yes, clamped twice + `maxSteps` + `acc = 0` |
| `webkitAudioContext` + gesture resume | yes |
| DPR handling on the UI canvas | yes (`src/15_ui.js:1523–1524`) |
| WebGL2 feature use vs core spec | core only — RGBA8 FBOs, no `EXT_color_buffer_float` needed; 2048² atlas is within every GL ES 3.0 minimum |
| `</script>` / `<!--` / `-->` escaping in build | handled (and currently zero occurrences) |
