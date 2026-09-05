# NOVA ARENA — ARCHITECTURE

**The authoritative API reference.** Content agents should need only this file plus
`GAME_PLAN.md`. Everything hangs off one global `NA`. Plain ES2020, no modules,
no bundler. Colors are `[r,g,b]` floats 0–1. Angles are radians. World units:
arena radius **1700**, ship core radius 10, the camera shows **1100×620** at zoom 1
(see §25.1 — the arena grew and the camera moved in).

---

## 0. Build, run, test

```bash
node tools/build.js          # src/00_shell.html + src/*.js (filename order) -> nova-arena.html
                             #   also writes tools/out/size-report.txt
node tools/smoke.js          # Node-only: loads the built script in a stubbed DOM,
                             #   drives 300 frames through the Canvas2D path.  No browser.
node tools/test.js           # headless browser: 400 frames, console errors, frame times,
                             #   entity counts, screenshot -> tools/out/*.png
```

`tools/build.js` injects all JS into one `<script>` at the `<!--NA_SCRIPT-->`
marker in the shell. Any literal `</script` inside a source string is escaped.
Just open `nova-arena.html` in a browser — no server needed.

### tools/test.js flags

| Flag | Meaning |
|---|---|
| `--frames=N` | frames to run (default 400) |
| `--stress` | the stress scene: 500 enemies + 5000 bullets + 3000 particles, continuously topped up |
| `--wave=N` | start at wave N |
| `--boss=id` | jump straight to a boss |
| `--nogl` | force the Canvas2D fallback |
| `--seed=N` / `--quality=0..3` | pin the run seed / quality tier |
| `--gl=swiftshader\|angle\|desktop` | force a GL backend (default: let the browser choose) |
| `--headful` | show the window |
| `--attempts=N` | retries when the browser aborts a run (default 8) |
| `--bot` `--god` `--fast=N` `--prof` | the autopilot, no player damage, the sim clock multiplier, the per-module profiler (§25.2) |
| `--untilWave=N` `--endless=N` | finish when wave N starts / start endless at N |
| `--timeout=ms` `--stallSec=N` `--waveSec=N` | harness wall-clock budget and the two watchdogs (§25.2) |
| `--domcheck` | fail if the fourth wall left DOM nodes, a `<body>` filter, a non-hidden `overflowY`, or a scrolled page |
| `--warnok` | downgrade `console.warn` back to a printed note (they are errors by default, §25.13) |

**Browser:** Microsoft Edge (Chromium), `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`.
Override with `CHROME_PATH`. Chrome is deliberately **not** used on this machine — a
blocker app kills it mid-run. `puppeteer.launch()` cannot start this Edge build (it
exits before printing a DevTools endpoint), so the harness spawns `msedge.exe` on a
random remote-debugging port and `puppeteer.connect()`s to it.

### Dev URL params

`?debug=1` fps/entity overlay + on-screen error box · `?wave=N` · `?boss=id` ·
`?stress=1` · `?test=1` (deterministic seed, audio off, exposes `window.__NA_TEST`) ·
`?frames=N` · `?seed=N` · `?quality=0..3` · `?nogl=1` (force Canvas2D) ·
`?norender=1` (simulate without drawing, for profiling).

### Ownership

| File | Namespace | Owner |
|---|---|---|
| `00_shell.html` | — | foundation |
| `01_core.js` | `NA.C NA.M NA.RNG NA.Time NA.Input NA.Store NA.params` | foundation |
| `02_render.js` | `NA.R NA.Atlas NA.Cam` | foundation |
| `03_audio.js` | `NA.Audio` | **audio agent** |
| `04_icons.js` | `NA.Icons` | **icons agent** |
| `05_pools.js` | `NA.Pool NA.Grid` | foundation |
| `06_arena.js` | `NA.Arena` | foundation |
| `07_fx.js` | `NA.FX NA.Particles` | foundation |
| `08_bullets.js` | `NA.Bullets` | foundation |
| `09_player.js` | `NA.Player NA.Ship` | foundation |
| `10_enemies.js` | `NA.Enemies` | foundation (framework) / **enemy agent** (types) |
| `11_upgrades.js` | `NA.Upgrades` | **upgrades agent** (registry is foundation) |
| `12_events.js` | `NA.Events` | **events agent** (registry + Supernova are foundation) |
| `13_bosses.js` | `NA.Bosses` | **boss agents** (registry + Compactor are foundation) |
| `14_waves.js` | `NA.Waves` | **waves agent** (runner is foundation) |
| `15_ui.js` | `NA.UI NA.Draft NA.HUD` | **UI agent** |
| `16_game.js` | `NA.Game` | foundation |
| `99_boot.js` | — | foundation |

Everything in `NA.Audio` and `NA.Icons` is **guarded at every call site**
(`if (NA.Audio) …`, `if (I && I.draw) …`), so the game runs with or without them.

---

## 1. `NA.C` — constants and palette

```js
NA.C.ARENA_R        // 1700          NA.C.SHIP_R        // 10
NA.C.ARENA_MIN_R    // 460           NA.C.VIEW_W/H      // 1100 / 620
NA.C.MAX_ENEMIES    // 1024          NA.C.MAX_PARTICLES // 4096
NA.C.MAX_PBULLETS   // 6144          NA.C.MAX_EBULLETS  // 6144
NA.C.MAX_CORPSES    // 100
NA.C.PLAYER_HP 3    MANA_MAX 100     MANA_TRICKLE 6     MANA_GRAZE 3
NA.C.MANA_KILL 2    MANA_KILL_CAP 20 MANA_IDLE_AFTER 4
NA.C.DASH_COST 15   DASH_DIST 140    DASH_TIME 0.15     DASH_IFRAME 0.15
NA.C.INVULN 0.8     GRAZE_R 34       MERCY_R 190        SOFT_WALL 60
NA.C.PLAYER_SPEED 430   FIRE_RATE 8.5   BULLET_SPEED 1250   BULLET_DMG 10
NA.C.TELEGRAPH_HZ 2     // the shared telegraph breathing rate — never change it
```

Palette (`NA.C.COL.*`, Void Neon): `void player core white magenta orange acid
violet yellow green red gold navy plum grey`.

---

## 2. `NA.M` — math

```js
M.TAU M.PI M.HALFPI
M.clamp(v,a,b)  M.clamp01(v)  M.lerp(a,b,t)  M.sign(v)
M.len2(x,y)  M.dist2(ax,ay,bx,by)  M.dist(...)          // prefer dist2 in hot loops
M.norm(a)  M.angDiff(a,b)  M.lerpAngle(a,b,t)
M.smooth(a,b,rate,dt)      // frame-rate independent exponential approach
M.approach(a,b,step)
M.easeOut(t) easeIn easeInOut easeOutCubic easeOutBack
M.noise1(x)  M.noise2(x,y) // smooth value noise, deterministic
M.hsv(h,s,v) -> [r,g,b]    // returns a SHARED scratch triple, copy it if you keep it
```

## 3. `NA.RNG` — seeded xorshift128

```js
NA.RNG.seed(n) .f() .range(a,b) .int(n) .pick(arr) .chance(p) .sign() .angle()
NA.RNG.fork(salt) -> { f() }   // an independent stream: draft offers must not be
                               // perturbed by spawn jitter
```

Waves are scripted and identical every run; only draft offers and spawn jitter
use the RNG. `NA.Game.newRun(seed)` reseeds.

## 4. `NA.Time` — fixed timestep

```js
NA.Time.fixed        // 1/120, the simulation step
NA.Time.t            // simulated seconds (scaled by timeScale)
NA.Time.real         // wall clock seconds
NA.Time.frames       // simulation steps executed
NA.Time.timeScale    // slow-mo / hit-stop multiplier
NA.Time.setTimeScale(s, ms?)   // instant, or ramp over ms
NA.Time.slowmo(scale, ms)      // drop to `scale` and ease back to 1 over ms
NA.Time.addHitStop(ms)         // freeze the sim, keep rendering
NA.Time.begin(realDt) -> steps // called by NA.Game.frame; do not call
```

`document.visibilitychange` pauses the accumulator. A stalled tab never
fast-forwards: `realDt` is clamped to 100 ms and at most 8 steps run per frame.

## 5. `NA.Input`

```js
NA.Input.isDown(action) / pressed(action)   // 'up down left right fire dash active
                                            //  pause pick1..pick4 confirm'
NA.Input.axis() -> {x,y}     // SHARED, normalised move vector (never allocates)
NA.Input.stickAim(out) -> bool
NA.Input.mouse               // {x, y, left, right, mid} in CSS pixels
NA.Input.holdTime            // seconds any input has been held — skips are hold-not-tap
NA.Input.anyPressedThisFrame
```

Gamepads are only polled once a `gamepadconnected` event has fired
(`navigator.getGamepads()` allocates and touches the HID stack every call).

## 6. `NA.Store`

```js
NA.Store.settings   // volMaster volMusic volSfx shake flash quality colorblind
                    // reticle autofire hints damageNumbers
NA.Store.records    // { best, beat30, seen:{} }
NA.Store.get(k, d) / set(k, v) / save() / load()
```
Persists to `localStorage` under `na.settings` / `na.records`.

---

## 7. `NA.Atlas` — runtime glyph atlas with baked glow

```js
NA.Atlas.add(id, size, drawFn)   // drawFn(ctx, size) draws WHITE, centred at (0,0),
                                 // inside a half-extent of size*NA.Atlas.INSET (0.32)
NA.Atlas.get(id) -> {u0,v0,du,dv,k,size,kind,draw}
NA.Atlas.list                    // ordered entries; index = "kind" used by the 2D path
```

Every glyph is pre-rendered once with a three-layer glow, so at runtime a shape
is one textured quad. Registered ids:

```
disc dot dotRim ring ringT ringSoft line capsule spark flash shipCore
p3 p4 p5 p6 p7 p8      (hollow polygons)
f3 f4 f5 f6 f7 f8      (filled polygons)
needle chevron diamond star4 hexRound tri square circle hex shipHull
```

Add your own with `NA.Atlas.add('myGlyph', 128, fn)` before the first frame; the
texture is re-uploaded automatically when it changes.

## 8. `NA.R` — the renderer

Layers, bottom to top (`NA.R.L`):

| id | name | blend |
|---|---|---|
| 0 `BACKDROP` | backdrop (shakes at 30% for parallax) | normal |
| 1 `FLOOR` | floor events, crush bands, chasms | additive |
| 2 `MEMBRANE` | arena boundary, ripples, mirror walls, gates | additive |
| 3 `PARTICLES` | particles, rings, fragments, bolts | additive |
| 4 `EBULLETS` | enemy bullets | normal |
| 5 `ENEMIES` | enemies and boss bodies | normal |
| 6 `PBULLETS` | player bullets, muzzle flashes | additive |
| 7 `PLAYER` | the ship and its slots | additive |
| 8 `VEIL` | veil events, telegraphs, gates | additive |
| 9 `AFTER` | after-images, ship trail | additive |
| 10 `HUD` | HUD arcs, rim dots, boss ring (world space) | normal |
| 11 `SCREEN` | screen-space chrome (draft, title) | normal |

Enemies never blend additively, so they never wash into white mush.

```js
NA.R.sprite(layer, id, x, y, rot, sx, sy, r, g, b, a)   // sx/sy = HALF extents, world units
NA.R.line(layer, x1, y1, x2, y2, width, r, g, b, a)     // width is real ink width
NA.R.ring(layer, x, y, radius, width, r, g, b, a)
NA.R.softRing(layer, x, y, radius, r, g, b, a)
NA.R.arc(layer, x, y, radius, a0, a1, width, r, g, b, a)
NA.R.disc(layer, x, y, radius, r, g, b, a)              // soft radial
NA.R.dot(layer, x, y, radius, r, g, b, a)               // hard glowing dot
NA.R.poly(layer, x, y, radius, sides, rot, width, r,g,b,a)      // hollow, 3..8 = 1 quad
NA.R.polyFill(layer, x, y, radius, sides, rot, r,g,b,a)
NA.R.light(x, y, radius, intensity)                     // stamp into the darkness mask
```

Screen-space variants draw into layer `SCREEN` in CSS pixels:
`NA.R.ssprite sline sring sarc sdisc spoly` (same argument order, no layer).

```js
NA.R.setPost({ chroma, vignette, hue, darkness, flash, desat })
NA.R.quality         // 0..3, driven by a rolling frame-time average with hysteresis
NA.R.particleCap     // 400 / 900 / 1500 / 2000  (500 on the Canvas2D path)
NA.R.mode            // 'gl' | '2d'
NA.R.stats           // { instances, draws, frameMs, avgMs, p95 }
NA.R.w / NA.R.h      // CSS pixel size
NA.R.setQualityHard(q)
```

The post pass is skipped entirely when every effect is zero. Quality steps down
at >21 ms average and back up under 12.5 ms, never more than once per 1.2 s.
Tier 0 also drops the resolution scale to 0.7.

**Canvas2D fallback** (`NA.R.mode === '2d'`, automatic when WebGL2 is missing,
forced with `?nogl=1`): the same command buffers are replayed through the atlas
draw functions with glow off and the particle cap at 500.

### Example

```js
// a magenta hexagon with a white core, and a light for the darkness mask
NA.R.poly(NA.R.L.ENEMIES, x, y, 22, 6, rot, 2, 1, 0.235, 0.675, 1);
NA.R.dot(NA.R.L.ENEMIES, x, y, 4, 1, 1, 1, 0.9);
NA.R.light(x, y, 160, 0.4);
```

## 9. `NA.Cam`

```js
NA.Cam.x / y / zoom
NA.Cam.follow(px, py, aimDx, aimDy)   // targets the ship + 25% of the aim vector
NA.Cam.setZoom(z, ms)
NA.Cam.fitArena(ms)                   // the between-wave zoom-out: the whole ring fits
NA.Cam.addTrauma(t)                   // shake = trauma²; decays 1.5/s; respects the setting
NA.Cam.worldToScreen(x, y, out) / screenToWorld(sx, sy, out)
NA.Cam.viewW() / viewH()              // visible world units
```
The camera never crosses the membrane. Trauma budget: kills 0.05, dash 0.1,
player hit 0.35, boss stomp 0.5+.

---

## 10. `NA.Pool` and `NA.Grid`

```js
var p = NA.Pool.create(1024, { x:'f32', y:'f32', hp:'f32', kind:'i32' });
var i = p.alloc();          // -1 when full; fields are zeroed
p.free(i);                  // SWAP-REMOVE: the last entry moves into slot i
p.n                         // live entries are 0..n-1
```
Indices are **not stable across frames**. When iterating and freeing, step back:
`for (i=0;i<p.n;i++){ if (dead) { p.free(i); i--; } }`.

```js
var g = NA.Grid.create(96, 1024);   // cellSize, capacity
g.begin();  g.insert(i, x, y);
var n = g.query(x, y, r);           // fills g.out (Int32Array), returns the count
g.queryCb(x, y, r, cb);             // callback form
```
The enemy grid (`NA.Enemies.grid`) is rebuilt at the top of every enemy update.

---

## 11. `NA.Arena`

```js
NA.Arena.cx / cy / radius / rot / shape      // 'circle' | 'hex'
NA.Arena.reset({radius, shape})
NA.Arena.setShape('hex')
NA.Arena.setRadius(r, seconds)               // global shrink/grow with a crush band
NA.Arena.shrinkSide(angle, amount)           // per-side inward step (Constrictor)
NA.Arena.restoreSides()
NA.Arena.rotate(radPerSec)                   // Rotator / Turntable
NA.Arena.radiusAt(angle) -> number
NA.Arena.contains(x, y) -> bool
NA.Arena.depth(x, y) -> units inside (negative outside)
NA.Arena.ripple(x, y, strength, r, g, b)     // three expanding tangent arcs
NA.Arena.softWall(ent, dt, radius) -> penetration    // ent needs {x,y,vx,vy}
NA.Arena.clampHard(ent, radius) -> touched?
NA.Arena.addMirrorWall(x1,y1,x2,y2, life, owner) -> id
NA.Arena.removeMirrorWall(id) / clearMirrorWalls() / NA.Arena.mirrorWalls
NA.Arena.segmentBlocked(x0,y0,x1,y1) -> wall|null    // fills NA.Arena._out {x,y,nx,ny,t}
NA.Arena.addChasm(x1,y1,x2,y2, width, life) -> id / NA.Arena.chasms / inChasm(x,y)
NA.Arena.tint                                // 0..1, hotter as the arena shrinks
```

Mirror walls block movement and **reflect player projectiles** (enemy bullets
pass through). The membrane is a soft wall for the player — the last 60 units
are a spring — and a hard clamp for everything else.

```js
// Constrictor: step the nearest wall inward every second
NA.Arena.shrinkSide(Math.atan2(y, x), 6);
// Glazier: a mirror wall that lives 12 s
var id = NA.Arena.addMirrorWall(ax, ay, bx, by, 12);
```

---

## 12. `NA.FX` and `NA.Particles`

```js
NA.FX.trauma(t)  NA.FX.hitStop(ms)  NA.FX.flash(alpha, ms)  NA.FX.chroma(px, ms)
NA.FX.desat(v, ms)  NA.FX.hue(rad, ms)  NA.FX.darkness(v, ms)
NA.FX.vignette   // 0..1, raised automatically at 1 HP for the heartbeat
```
Flashes are capped at 50% alpha and scaled by the reduce-flash setting.
Chromatic aberration is capped at 3 px.

```js
NA.Particles.spawn(x,y,vx,vy, life, size, r,g,b,a, prio, drag) -> i
NA.Particles.burst(x,y, n, speed, life, r,g,b, prio)
NA.Particles.ring(x,y, r0, r1, life, width, r,g,b,a)
NA.Particles.frag(x,y,vx,vy, rot, len, life, r,g,b)
NA.Particles.shatter(x,y, radius, sides, r,g,b, speed)  // the kill pop
NA.Particles.afterImage(x,y, rot, scale, life, r,g,b,a, spriteIndex)
NA.Particles.bolt(x1,y1,x2,y2, life, jag, r,g,b, width)  // branching lightning
NA.Particles.count
```
Priority `0` ambient, `1` kills, `2` player. Above the cap only a higher
priority may evict. Particle colour is multiplied by 0.85 and alpha by 0.6 so
they stay under the readability ladder. `burst` halves its count under load.

---

## 13. `NA.Bullets`

Two SoA pools, `NA.Bullets.P` (player) and `NA.Bullets.E` (enemy). Fields on both:

```
x y vx vy rot life maxLife dmg size pierce bounce homing explode
owner flags r g b a hitCd px py
```
`owner` 0 = player, 1 = enemy. `homing` 0..1 turn strength. `explode` = radius,
0 = none. `flags` bits are `NA.Bullets.FLAG`:
`INVISIBLE WALLPHASE GRAZED NOWALL ENEMYHURT STOLEN`.

```js
NA.Bullets.firePlayer(x, y, vx, vy, {dmg, size, pierce, bounce, homing, explode, life, flags}) -> i
NA.Bullets.fireEnemy (x, y, vx, vy, {dmg, size, life, color:[r,g,b], owner, homing, bounce}) -> i
NA.Bullets.killP(i, silent) / killE(i, silent)
NA.Bullets.explode(x, y, radius, dmg, owner)
NA.Bullets.clearArea(x, y, radius, convert) -> n     // mercy ring / Pulse; convert steals them
NA.Bullets.reset()
```

Per step: homing, integration, mirror-wall reflection, membrane bounce/pop,
boss hit test, enemy hit test via the grid, then player hit + graze.
Grazing (within `GRAZE_R` of the hull without hitting) awards
`MANA_GRAZE` once per bullet and fires `NA.Audio.sfx('graze')`.

```js
// a Spitter bolt
NA.Bullets.fireEnemy(x, y, dx*430, dy*430, { size: 8, life: 4.5, color: NA.C.COL.yellow });
```

---

## 14. `NA.Player` and `NA.Ship`

```js
NA.Player.x y vx vy angle aimX aimY
NA.Player.hp maxHp mana manaMax alive invuln dashIFrame dashT kills
NA.Player.stats = { fireRate, damage, speed, bulletSpeed, bulletSize, count,
                    spread, pierce, bounce, homing, explode, life,
                    manaTrickle, dashCost, dashDist, grazeMul, dashIFrame }
NA.Player.reset({hp}) / resetStats()
NA.Player.fire(force)               // one volley (respects stats.count/spread)
NA.Player.dash() -> bool            // spends stats.dashCost, 5 after-images, i-frames
NA.Player.damage(n, srcX, srcY) -> bool     // always exactly 1 HP
NA.Player.addMana(n, 'graze'|'kill'|…)      // the kill source is capped at 20/s
NA.Player.spend(n, tag) -> bool             // fires the onSpend hook, dry click on failure
NA.Player.heal(n) / NA.Player.kill(sx, sy)
NA.Player.onKill(ei)                        // called by NA.Enemies
```

Mana: 6/s trickle (halved after 4 s with no damage dealt or taken), +3 per graze,
+2 per kill (20/s cap), dash costs 15. Taking a hit gives 60 ms hit-stop, a 300 ms
half-speed ramp, a white flash, a hull chip, a mercy ring that clears bullets
within 190 units, and 0.8 s of 12 Hz blinking invulnerability.

**Auto-fire** (on by default): the ship fires on its own during combat states.
With it off, hold fire.

### Ship visual slots (GAME_PLAN §6.2)

```js
NA.Ship.setSlot(slot, tier)     // tier 0..3 ('crown' is 0..1)
NA.Ship.getSlot(slot) -> tier
NA.Ship.slots                   // the live table
NA.Ship.SLOTS                   // z-order: aura halo trail wings fins hull
                                //          barrels orbitals core crown
NA.Ship.tint = [r,g,b]          // hull tint override (Arcane, Glass, Berserk…)
NA.Ship.render(x, y, rot, alpha, scale, colOverride)
NA.Ship.reset()
```

Upgrades map onto slots through `def.visual = { slot: 'barrels' }` — taking the
upgrade raises that slot to the new tier automatically. All rotating parts share
exactly two angular speeds (`NA.Ship.SPIN_A/SPIN_B`); the core dot never changes
size and is always the brightest pixel near the ship.

```js
NA.Ship.setSlot('barrels', 2);   // two barrels appear on the real ship immediately
```

---

## 15. `NA.Enemies`

### SoA fields (`NA.Enemies.x[i]` …)

```
x y vx vy hp maxHp type size rot vrot state t t2 flash flags mut
tx ty intangible spawnT invisible seed hitT p0 p1 p2 p3
```
`p0..p3` are per-type scratch (note: `p2/p3` cache the flock steering vector for
flocking types — use `p0/p1`, `state`, `t2`, `tx/ty` for your own state).
Live entries are `0..NA.Enemies.n-1`, swap-removed.

### Defining a type

```js
NA.Enemies.define('mote', {
  shape: 'circle',            // circle tri square hex diamond needle chevron ring
  color: [0.92, 0.97, 1.0],   // shape = kind, colour = urgency, size = HP bucket
  size: 11, hp: 10, speed: 92,
  cost: 1, band: 'A',
  flock: true,                // use the shared seek + separation + cohesion update
  contact: 1,                 // contact damage (0 = harmless on touch)
  separation: 1, cohesion: 0.18,
  spawnTime: 0.5,             // print-in animation; intangible for its duration
  invisible: false,           // revealed only through NA.Events.revealAlpha
  elite: false,               // elite kills add 40 ms of hit-stop
  eye: false,                 // draws a pulsing eye (ranged enemies brighten before firing)
  sides: 8,                   // fragments produced by the death pop
  init(i) {},
  update(i, dt) {},           // write NA.Enemies.vx[i]/vy[i]; integration is done for you
  onDamage(i, amt, src) {},   // return false to ignore the hit
  onDeath(i) {},
  render(i, alpha, r, g, b) {}   // optional; omit for the default polygon
});
```

### Runtime

```js
NA.Enemies.spawn(id, x, y) -> i          // -1 when the pool is full
NA.Enemies.spawnAtRim(id, angle, inset)
NA.Enemies.damage(i, amt, 'player'|'enemy') -> killed?
NA.Enemies.damageArea(x, y, r, amt, src) -> hits
NA.Enemies.kill(i, byPlayer)
NA.Enemies.killAll(silent) / reset()
NA.Enemies.nearestTo(x, y, maxR) -> i | -1
NA.Enemies.nearestAngle(x, y)
NA.Enemies.forEachInRadius(x, y, r, cb)
NA.Enemies.grid                          // the spatial hash, rebuilt every step
NA.Enemies.types / byId / typeIndex(id) / typeOf(i)
NA.Enemies.beacon                        // set by the wave runner when a wave stalls
```

### Telegraphs — the universal read convention

Orange while pending, snapping to **red at lock**; everything breathes at
`NA.C.TELEGRAPH_HZ` and draws on the VEIL layer above everything else. The
helpers also fire `NA.Audio.sfx('telegraph')` on the first frame and
`sfx('lock')` on the lock frame.

```js
NA.Enemies.telegraphLine(x1, y1, x2, y2, t, dur, lockAt, width, colOverride)
NA.Enemies.telegraphCircle(x, y, radius, t, dur, lockAt, colOverride)
NA.Enemies.telegraphArrow(x, y, angle, len, t, dur, lockAt, colOverride)
NA.Enemies.telegraphColor(t, lockAt) -> [r,g,b]   // shared scratch
NA.Enemies.telegraphPulse(t, lockAt) -> alpha
```

```js
// a Lancer: 1.0 s aim line, locks at 0.7 s, fires at 1.0 s
update(i, dt) {
  P.t2[i] += dt;
  NA.Enemies.telegraphLine(P.x[i], P.y[i], tx, ty, P.t2[i], 1.0, 0.7, 3);
  if (P.t2[i] >= 1.0) { fireLaser(i); P.t2[i] = 0; }
}
```

### Invisibility, mutators, corpses

```js
NA.Enemies.revealOf(i) -> 0..1     // NA.Events.revealAlpha, damage flash (0.3 s),
                                   // proximity shimmer within 60 px
NA.Enemies.MUT                     // VOLATILE LINKED PHASED ANCHORED SPLIT HAUNTED
                                   // SHROUDED MAGNETIC MIRROR VAMPIRIC BLOOMED SIREN
NA.Enemies.setMutator(i, bits) / hasMutator(i, bit)
NA.Enemies.corpses                 // {x, y, type, t, head, n} ring buffer, last 100 deaths
NA.Enemies.domes                   // push {x, y, r, owner} each frame; Sentinel domes
NA.Enemies.shielded(i, fromX, fromY) -> bool
```
Only `VOLATILE` has behaviour wired so far (explodes on death); the flags and
the rim marker render for all of them.

Kills produce a scale flash, one line fragment per polygon side, a ring, a light
stamp and 0.05 trauma. Same-type kills within 200 ms chain up to 8, each pop 10%
bigger and pitched up (`sfx('killCombo', {pitch})`).

---

## 16. `NA.Upgrades`

```js
NA.Upgrades.define('blast', {
  family: 'projectile',
  tags: ['explode', 'kill'],          // explode bounce dash spend kill orbital zone pierce mana
  visual: { slot: 'core' },           // raises that NA.Ship slot to the taken tier
  wildcard: false,                    // wildcards also light the 'crown' slot
  tiers: [
    { apply(p) { p.stats.explode = 60; },
      onHit(ctx) {}, onKill(ctx) {}, onFire(ctx) {}, onDash(ctx) {},
      onSpend(ctx) {}, update(dt) {}, render() {} },
    { /* tier 2 adds a NEW MECHANIC, never a stat bump */ },
    { /* tier 3 */ }
  ]
});
```

**Hooks fire for every tier up to the owned tier, low to high.** A tier-3
upgrade runs its tier 1, 2 and 3 handlers, which is why higher tiers are written
as additions.

```js
NA.Upgrades.take(id) -> newTier    // raises the tier, calls apply(), updates the ship slot
NA.Upgrades.tier(id) -> 0..3
NA.Upgrades.owned                  // { id: tier }
NA.Upgrades.ownedIds() / list / get(id) / tagsOf(id)
NA.Upgrades.offer(count, rng) -> [id]      // GAME_PLAN §5.1 offer composition
NA.Upgrades.emit(hook, ctx)        // called for you by player/bullets/enemies
NA.Upgrades.update(dt) / render()  // called for you by NA.Game
NA.Upgrades.reapply()              // resets stats and re-runs every apply()
NA.Upgrades.reset()
```

Shared, never-allocated hook contexts:

| Hook | Fired from | `ctx` |
|---|---|---|
| `onFire` | `NA.Player.fire` | `{x, y, angle}` (the muzzle) |
| `onHit` | player bullet hitting an enemy | `{x, y, bi, ei, dmg, kill, owner, nx, ny}` |
| `onKill` | `NA.Enemies.kill` (player kills only) | `{x, y, ei, type}` |
| `onDash` | `NA.Player.dash` | `{x, y, vx, vy}` |
| `onSpend` | `NA.Player.spend` | `{amount, tag}` — tags include `'dash'`, `'reroll'` |

`ei` is valid only during the call (`onKill` fires before the swap-remove).

---

## 17. `NA.Events` — background events

```js
NA.Events.define('supernova', {
  layer: 'veil',                 // 'veil' (above enemies) | 'backdrop'
  telegraph: 3, active: 0.35, decay: 4,     // seconds; the three phases
  onStart(e), onActive(e), onDecay(e), onEnd(e),
  update(e, dt),
  render(e),                     // e.phase 'telegraph'|'active'|'decay', e.k 0..1, e.t seconds
  reveal(e, x, y) -> 0..1        // how visible invisible enemies are here
});

NA.Events.trigger('supernova', { angle })   // at most one per layer at a time
NA.Events.stop(id) / stopAll() / isActive(id) / NA.Events.active
NA.Events.revealAlpha(x, y) -> 0..1         // max over live events; enemies read this
NA.Events.setBiome('ember'|'pulsar'|'storm'|'horizon'|'core')
NA.Events.windX / windY                     // Solar Wind / Tide push, read by movement
```

Supernova is implemented end to end: a swelling star with a rim countdown arc
(3 s), a white flood with long shadows that reveals invisibles as hard
silhouettes and stuns enemies facing the star (0.35 s), then a 4 s afterglow
that leaves faint outlines.

The biome backdrop (two nebula lobes + 260 twinkling stars) is drawn by
`NA.Events.renderBackdrop()` — placeholder art the events agent replaces.

---

## 18. `NA.Bosses`

```js
NA.Bosses.define('compactor', {
  name: 'Compactor', color: [1, 0.541, 0], hp: 420,
  introTime: 1.6,
  camZoom: 0.62,                    // camera zoom during the fight (default 0.95)
  intro(b, t) -> done?,             // draws the intro; return true to end it early
  hitTest(b, x, y, r) -> 0|1|2,     // 0 miss, 1 hit, 2 absorbed (armour/seam)
  phases: [
    { minDuration: 12, enter(b), update(b, dt), render(b), exit(b) },
    { minDuration: 14, … }
  ],
  onDamage(b, amt) -> false to ignore,
  onPhase(b, index), onDeath(b), onEnd(b), render(b)
});

NA.Bosses.spawn(id) -> b            // b = {def,id,hp,maxHp,x,y,phase,phaseT,t,state,angle,data}
NA.Bosses.active                    // state: 'intro' | 'fight' | 'dying' | 'dead'
NA.Bosses.hit(x, y, r, dmg) -> bool // called by NA.Bullets for every player bullet
NA.Bosses.damage(amt) / NA.Bosses.die() / NA.Bosses.nextPhase() / NA.Bosses.clear()
NA.Bosses.list
```

**Phase gating:** HP is divided evenly across the phases, and while
`b.phaseT < phase.minDuration` the boss floors at 1 HP above the phase
threshold. A god build still has to dance. Phase breaks give 120 ms hit-stop, a
0.35× slow-mo ramp, chroma and trauma.

The rim health ring (thick, boss-coloured, depleting counterclockwise from the
spawn bearing, with phase notches) is drawn by the framework. Intros are
skippable by holding any input for 0.3 s. Bosses may spawn enemies, alter
`NA.Arena`, draw through `NA.R`, and call `NA.UI.fourthWall.*`.

The reference fight, **Compactor**, slams four wall slabs inward on a metronome,
lets you delay a slam by shooting its orange seam, switches to asymmetric slams
that carve corridors in phase 2, and on death blows the slabs outward and grows
the arena to 130% for the transition.

---

## 19. `NA.Waves`

```js
NA.Waves.script[n] = {
  act, biome, newTypes: ['spitter'], retire: [], budget: 35,
  beats: [ { t: 0, type: 'mote', count: 10, gate: 0 },      // gate index, or pos:[x,y]
           { t: 5, type: 'spitter', count: 3, gate: 1 } ],
  spikes: [ { t: 26, frac: 0.2, type: 'spitter' } ],
  mutators: [], events: ['supernova'],
  boss: 'compactor'
};

NA.Waves.get(n)          // script[n], falling back to endless(n)
NA.Waves.endless(n)      // naive procedural remix (waves agent replaces this)
NA.Waves.start(n) / update(dt) / render() / stop()
NA.Waves.done            // budget spent AND the arena is clear
NA.Waves.progress        // 0..1 of the spawn budget consumed
NA.Waves.phase           // 'ingress' | 'body' | 'closer'
NA.Waves.gates           // this wave's rim bearings, rotated every wave
```

The runner handles the whole choreography: ingress for the first 10 s from 2–4
rim gates, the steady body, the pressure spike (rim flash + 20% of the remaining
budget from a brand-new gate), the closer (the last 10%), the "nothing spawns
within four ship-widths of the player" rule, the rim budget ring, and the
20-second stall beacon. **Waves end on kill count, never on a timer.**

Waves 1–3 are authored (Motes, then Motes + Skitter-style pressure, then
Spitters with a Supernova).

---

## 20. `NA.HUD`, `NA.Draft`, `NA.UI`

```js
NA.HUD.render() / NA.HUD.bump()      // arcs re-brighten for 1.5 s on any change
NA.Draft.open(count) -> bool         // false when there is nothing to offer
NA.Draft.pick(i) / skip() / reroll() / close()
NA.Draft.active / offers / hover
NA.UI.resetGate(x, y) / NA.UI.gate / NA.UI.gateEntered()
NA.UI.renderTitle() / renderDeath() / renderOverlay()
NA.UI.fourthWall.tearDraftPanel(amount)   // stubs for bosses 11 / 20 / 24
NA.UI.fourthWall.dimPage(on) / viewportArena(on) / scrollPage(px)
NA.UI.fourthWall.fallHUDDigit(n) / heal() / reset()
```

HP is a segmented arc **under** the ship, mana a cyan arc **over** it with the
dash-threshold notch; full mana closes into a pulsing gold halo. Every living
enemy is a faint dot at its bearing on the rim, and the spawn budget depletes a
thin ring. Icons are drawn onto the `#ui` Canvas2D overlay through `NA.Icons`.

---

## 21. `NA.Game`

```js
NA.Game.state    // 'title' 'wave' 'lastkill' 'sweep' 'draft' 'overview' 'boss' 'death' 'stress'
NA.Game.wave / seed
NA.Game.on(event, cb) / off(event, cb) / emit(event, data)
//   waveStart waveClear draftOpen draftPick bossIntro bossPhase bossDeath
//   playerHit playerDeath kill stateChange
NA.Game.newRun(seed) / title() / startWave(n) / startAt(n) / restart()
NA.Game.stress() / stressTick(dt)
NA.Game.step(dt) / render() / frame(ts)
```

Flow and timings (GAME_PLAN §12.4):

```
title --fly through the gate--> wave
wave  --budget spent, arena clear--> lastkill (0.6 s at 0.25×, any input skips)
      --> sweep (0.4 s) --> draft (world at 5%) --> overview (zoom out to fit,
      time 0.3×, full control, 1.6 s or hold to skip) --> boss --> wave N+1
playerDeath --> death (gate reappears after 1.4 s; fly through or click to restart)
```

```js
NA.Game.on('kill', function (typeIndex) { /* … */ });
```

---

## 22. Conventions that must not be broken

- **Readability.** Only three things are pure white: the ship core, player
  bullets, and the thing about to kill you. Enemies never blend additively.
  Particles are capped at 60% brightness and 150–400 ms lifetimes.
- **Telegraphs** draw on `VEIL` at full brightness, breathe at 2 Hz, and snap
  orange → red at lock. That snap is the universal "move now".
- **Zero text** anywhere except the `?debug=1` overlay and the tab title.
  Numbers are stroke glyphs via `NA.Icons.digit` / `NA.Icons.number`.
- **No per-frame allocation in hot loops.** No `new`, no array/object literals,
  no closures inside update loops. Reuse the shared scratch objects. Use squared
  distances; never `atan2` per bullet per frame (cache `rot`, refresh it only
  when the velocity changes).
- **Fairness.** Every hit has a ≥0.4 s telegraph, nothing spawns within four
  ship-widths of the player, nothing damages during transitions or intros,
  damage is always exactly 1 HP, and skips are hold-not-tap.

---

## 23. Recipes

**Add an enemy** → `src/10_enemies.js` (or a later file):
`NA.Enemies.define('lancer', {...})` with the fields in §15, then reference the
id from a wave beat. Shape reads kind, colour reads urgency, size reads HP.

**Add an upgrade** → `src/11_upgrades.js`: `NA.Upgrades.define(id, {...})` with
three tiers and a `visual.slot`. The hooks are already wired; the draft picks it
up automatically. Use one of the 42 ids from GAME_PLAN §6 so the icons match.

**Add a boss** → `src/13_bosses.js`: `NA.Bosses.define(id, {...})` with `phases`,
each with a `minDuration`. Point a wave's `boss` field at it. Test with
`?boss=id` and `node tools/test.js --boss=id`.

**Add a background event** → `src/12_events.js`: `NA.Events.define(id, {...})`
with the three phase durations and, if it reveals anything, a `reveal(e,x,y)`.
Trigger it from a wave's `events` list or from `NA.Events.trigger(id)`.

**Add a wave** → `src/14_waves.js`: fill `NA.Waves.script[n]`. The runner does
the choreography; you supply `budget`, `beats`, `spikes` and `boss`.

---

## 24. Changes to the Engineering Brief

Everything in the brief holds. These are additions and one clarification:

1. **Renderer additions** beyond the brief's list: `NA.R.arc`, `NA.R.dot`,
   `NA.R.softRing`, `NA.R.polyFill`, and screen-space variants
   `ssprite / sline / sring / sarc / sdisc / spoly`. Layers are exposed as the
   table `NA.R.L`, with a 12th `SCREEN` layer for CSS-pixel chrome.
   `NA.R.sprite`'s `sx/sy` are **half extents**.
2. **Enemy def additions:** `contact`, `eye`, `elite`, `sides`, `spawnTime`,
   `invisible`, `separation`, `cohesion`. `render(i)` is called as
   `render(i, alpha, r, g, b)`.
3. **Boss def additions:** `introTime`, `camZoom`, `onPhase`, `onEnd`, and
   `hitTest(b,x,y,r)` returning `0` miss / `1` hit / `2` absorbed. `intro` is
   called as `intro(b, t)`. `NA.Bosses.hit(x,y,r,dmg)` is the projectile entry
   point.
4. **`NA.Audio.update(dt)` is optional.** The shipped audio module has no
   `update`; the game calls it only if present, and every audio call site is
   guarded with `if (NA.Audio)`. Likewise every `NA.Icons` call is guarded.
5. **Extra dev params:** `?nogl=1` (force the Canvas2D fallback) and
   `?norender=1` (simulate without drawing, for profiling).
6. **Test harness:** Microsoft Edge, not Chrome (a blocker app on this machine
   kills Chrome mid-run), and the browser is spawned directly with a
   remote-debugging port because `puppeteer.launch()` cannot start this build.
   `tools/smoke.js` was added as a browser-free equivalent.
7. **Auto-fire** means the ship fires by itself during combat states; with the
   setting off, hold to fire.

---

## 25. Integration notes

Written by the integration pass. Everything here is either a new dev tool or a
cross-module contract that more than one file depends on.

### 25.1 Camera and arena scale

The arena is bigger and the camera is closer.

| | before | now |
|---|---|---|
| `NA.C.ARENA_R` | 1400 | **1900** |
| `NA.C.ARENA_MIN_R` | 420 | **514** |
| `NA.C.VIEW_W / VIEW_H` (world units visible at zoom 1) | 1600 x 900 | **1430 x 806** |
| combat window | 1600 x 900 | **1430 x 804** on a 16:9 screen (1.12x closer than the legacy window) |
| enemy-crowd zoom-out | 0.92 | **0.95** |

The window was widened from 1100 x 620 to 1430 x 806 at the owner's request
(~30% more world visible); the arena grew 1700 -> 1900 with it, and
`ARENA_MIN_R` scaled to 514.

`NA.C.VIEW_W` is only read by `NA.Cam`, so it *is* the zoom-1 window. Follow is
now critically damped (`NA.Cam.followRate` 10/s exponential approach, plus a
1/3-pixel dead zone so a parked ship never jitters) with a deliberately subtle
lead: `NA.Cam.lookahead` 0.10 of the aim vector plus `NA.Cam.velLook` 0.085 s of
the ship's own velocity, the sum clamped to 13% of the view width. The rim clamp
is soft: past `radius - 0.35 * min(halfView)` the camera keeps moving at a third
of the rate and stops at `radius + 0.10 * min(halfView)`, so the ship can touch
the membrane without the view stopping dead.

**Boss `camZoom` is now arena-relative.** The authored values (0.55-0.9) all
meant "pull back to this much of the arena" against the legacy window and a
1400-unit arena. `NA.Cam.bossZoom(camZoom)` translates them into the live window
and the live `NA.Arena.radius`. The reference width is **2080**, not the legacy
1600: the boss frame is fixed in world units (`VIEW_W` cancels out), so the
reference was widened to match the wider combat view and keep the authored
framing.

```js
bossZoom(z) = z * (NA.C.VIEW_W / 2080) * (1400 / NA.Arena.radius)
```

so every fight keeps the framing its author picked, and it now tracks arena
shrink/grow during a fight for free. `NA.Game.frame` calls it; boss files need
no change. A boss with no `camZoom` still gets a flat 0.95 (combat framing).

`NA.Cam.bossZoom` is the only place the reference numbers (2080 / 1400) appear;
nothing else hard-codes a window or arena size — `?debug=1` reports the live
numbers, and every module routes through `NA.C.ARENA_R` / `NA.Arena.radius`.

**`NA.Cam.fitArena(ms)` fits the whole arena, not just its width.** `viewH` is
`viewW * (R.h / R.w)`, so on any landscape screen the height is the binding
constraint; fitting the width alone framed a 3672-unit-wide window that was only
2066 units tall, and the 3400-unit ring was cropped top and bottom. It now
multiplies by `min(1, R.h / R.w)`:

```js
zoom = NA.C.VIEW_W / (NA.Arena.radius * 2.16) * Math.min(1, R.h / R.w)
```

On 1600x900 that is **zoom 0.196, a 7296 x 4104 window** around a 3800-unit
ring — the whole arena with margin. Every wide framing comes through this one
call (`overview`, `title`, `draft`, `death`, `ending`, `stress`), so they were
all cropped and are all fixed together.

### 25.2 Dev params: `?bot=1`, `?god=1`, `?fast=N`, `?prof=1`

`src/98_bot.js` is dev-only and completely inert unless a URL param asks for it.

* **`?bot=1`** — the autopilot. It wraps `NA.Input.poll`, so it drives the game
  through the same input surface a human uses (`down`, `pressedSet`, the mouse
  reticle, `NA.Input.axis`). During `wave`/`boss` it scores 16 candidate
  directions against a 0.30 s lookahead of every nearby enemy bullet, enemy and
  boss body, plus an arena-centre pull and a membrane penalty, and walks the
  cheapest one; it holds fire, dashes when a closing bullet is within 60 units,
  and taps the active key every 3 s. In `draft` it picks card 0 after 0.5 s. In
  `title` / `death` / `ending` it holds "any input" (so hold-to-skip screens
  fast-forward) and flies through `NA.UI.gate`.
  Boss aiming uses the health bar as feedback: hold an offset that is landing
  damage, otherwise alternate live minions (which is what `shy` wants) with an
  outward spiral — and, because a blind bot cannot learn "shoot the eyes inside
  the wave front", it probes `def.hitTest` on a coarse lattice at 5 Hz. That
  probe is the one thing in the bot that is not something a player could do; it
  never runs without `?bot=1`.
  `NA.Bot.note` shows the current state in the `?debug=1` overlay.
* **`?god=1`** — wraps `NA.Player.damage` to a no-op and re-floors `hp` every
  frame, so upgrades that pay hull directly (Berserk T3) cannot end the run.
* **`?fast=N`** — `NA.Time.simScale`. `NA.Time.begin` multiplies the scaled step
  by it and `maxSteps` rises to match. **Simulation only**: `NA.Time.real`,
  `NA.UI.tick`, the draft and every menu still run on the wall clock.
* **`?prof=1`** — `NA.Prof`. Wraps the per-frame entry point of every module and
  reports a rolling 60-frame average; `NA.Prof.report()` returns the top six as
  `name ms | name ms`, printed in the `?debug=1` overlay and streamed by the
  harness.

`?untilWave=N`, `?stallSec=N` and `?waveSec=N` drive the harness watchdogs in
`99_boot.js`: the run completes when wave N starts, and fails when the run
signature (state, wave, boss id/phase/hp bucket, spawn progress, kill count,
alive) has not moved for N real seconds (default 90) or one wave has run longer
than N simulated seconds (default 360).

### 25.3 `tools/test.js`

*(Superseded by §25.22, which lists the full current flag set and the canonical
runs. Kept for the rationale below.)*

New flags: `--bot --god --fast=N --prof --untilWave=N --endless=N --timeout=ms
--stallSec=N --waveSec=N --domcheck`. Progress is streamed line by line (frame,
sim seconds, state, wave, hp, deaths, entity counts, avg ms, boss
`id:state:phase:hp`), so a stall is diagnosable from the log alone. Console
**warnings are now printed and treated as bugs**, and `--domcheck` fails the run
if the fourth wall left DOM nodes under `#dom`, a CSS filter on `<body>`, a
non-hidden `overflowY`, or a scrolled page.

```bash
node tools/test.js --bot --god --fast=4 --untilWave=31 --frames=200000
node tools/test.js --bot --god --endless=35 --untilWave=40
node tools/test.js --boss=lurker --bot --god --fast=6 --domcheck
```

### 25.4 `ENEMYHURT` lives in `08_bullets.js`

`NA.Bullets.FLAG.ENEMYHURT` is now acted on in the one enemy-bullet loop:
grid query, `NA.Enemies.damage(ei, max(1,dmg) * 14, 'enemy')`, pierce or die,
skipping intangible enemies and the player's own allies (`NA.Enemies.ally > 0`),
and armed only 0.1 s after the shot so a shooter never kills itself.
`10b_enemies_ab.js` and `10c_enemies_cde.js` each used to run their own copy of
this — which meant flagged bullets dealt the damage **twice** and were consumed
twice; both are now early-return stubs marked SUPERSEDED.

### 25.5 The deferred death / blast queue

`damage -> kill -> onDeath -> damageArea -> damage -> ...` is a real recursion
(Volatile chains, Bloat clusters, Popper rings). `NA.Enemies` now carries a
re-entrancy depth (`_busy`) and a **deferred blast queue**:

* `damageArea()` called while a death chain is running **queues** the blast
  (cap 64) and returns 0 instead of recursing.
* The outermost `damageArea()` drains the queue iteratively, up to 8 passes;
  `NA.Enemies.update()` drains it again at the top of every step, so a blast
  queued from a boss or an upgrade never survives a frame.
* `onDeath` runs inside the guard and is skipped entirely past depth 8.
* The `VOLATILE` mutator's death blast routes through the queue when a chain is
  already running.
* `NA.Enemies.drainBlasts()` is public if you ever need to force it.

Chains still chain — iteratively, with a hard budget. 10b's and 10c's local
guards keep working: they now only ever see a non-re-entrant call.

### 25.6 Endless boss mutators

`14_waves.js` publishes the flag table on `NA.Bosses.mods`; `13_bosses.js` is the
only thing that reads it, so no individual fight knows about them. `hit`,
`update` and `render` were split into `hitOne` / `stepBoss` / `renderBody` so a
second instance can run through exactly the same code with `NA.Bosses.active`
swapped.

| mod | where | behaviour |
|---|---|---|
| `hasty` | runner | `NA.Enemies.telegraphScale = 0.7` — a shared multiplier the three telegraph helpers apply to `dur` and `lockAt`, so every telegraph in the game locks 30% earlier |
| `cloaked` | runner | the body draws at `alpha 0.15` unless it is telegraphing (`NA.Enemies._tgMark`), was hit within 0.3 s (`b.hitT`), or is in its intro/death. The rim health ring is never faded |
| `shy` | runner | `hitOne` reports "absorbed" while any non-ally, non-intangible enemy is alive |
| `twin` | runner | a second instance at 60% HP, only for `compactor constellation reflector angler` (the four fights with no module-level state two copies would share). It is offered every shot first, and dies with the headline boss |
| `looped` | runner | an input-echo ghost: the ship's own path from a 20 Hz ring buffer, replayed 3 s late, firing one weak violet shot every 1.4 s behind a 0.5 s telegraph |
| `crowded` `cramped` `unstable` | `14_waves.js` | unchanged (spawn top-up, 70% arena, slow turntable) |

New foundation surface this needed:

* `NA.R.alphaMul` — a scoped alpha multiplier every primitive honours (they all
  funnel through `NA.R.sprite`). Default 1; set and restored around one boss's
  own draw calls.
* `NA.Enemies.telegraphScale` (default 1) and `NA.Enemies._tgMark`.
* `b.hitT` on the boss object (0.3 s after any damage).

### 25.7 `NA.Bosses.resetRun()`

`13c_bosses_2.js` keeps a persistent-effect list and `13d_bosses_3.js` keeps a
ticker list, both wrapped around `NA.Bosses.update/render`. Each now **chains**
onto `NA.Bosses.resetRun()` (13c first, then 13d, then the framework's own
teardown of the mods, the twin and the echo ghost), and `NA.Game.newRun()` calls
it. Restarting from death — which never passes through the title — therefore
drops every run-long effect, as does returning to the title. Their existing
`playerDeath` / `stateChange('title')` hooks still fire; this is belt and braces.

### 25.8 One mana-cost path

`NA.Upgrades.mods.manaCost` is now the single tax/discount path for every
active. Berserk T1 does `U.mods.manaCost *= 1.3` in its `apply()` (so it is
re-aggregated by `reapply()` like every other modifier) and
`11b_upgrades_b.js`'s local `pay()` routes through
`NA.Upgrades.helpers.spend()`. Before, only UPGRADES-B actives were taxed.

### 25.9 Other cross-module facts confirmed

* **One event driver per wave.** `12_events.js` stands down whenever the wave
  script carries an `events` list and `NA.Waves.n >= 3` — the exact same gate
  `14_waves.js` `_eventTick()` uses, so they can never both fire. The rim
  countdown arc is mirrored off the runner's own `_eventT`, and is now cleared
  during boss fights (the runner's timer does not tick there, so a frozen number
  was the only thing it could have shown).
* **Aurora Lanes stays at 1.4x** (`speedMul: 1 + 0.4 * cover`).
* **Sentinel retires at wave 25**, where the Cathedral takes over the shielding
  role (`retireWave: 25` in `10b_enemies_ab.js`).

### 25.10 Two fights that could not be finished

* **The Page** was unwinnable. Its four corner nodes are the only damageable
  parts, and they sat at `1.5 x 1.02` arena radii — outside the membrane, where
  player bullets pop, so the boss could never leave phase 1. Its border also
  absorbs everything within 60 units of itself, and the nodes sit *on* that
  border, so even a reachable node ate the shot a few units short. Fixed in
  `13d_bosses_3.js`: the page is `0.62 x 0.42` of the radius (which leaves room
  for the phase-2 scroll to carry the corners without pushing them back through
  the membrane), and a live node now punches a 130-unit **window** in the
  border, which is what "shoot the corner" always meant.
* **`viewportArena(true)`** created an untracked tall spacer div, so every Page
  or Dimmer fight leaked one DOM node. `15_ui.js` now keeps `FW._tall` and
  removes it in `viewportArena(false)` and in `FW.reset()`.

### 25.11 Soft-lock fixes (second integration pass)

Four deadlocks that a full `?bot=1` playthrough found. Each is a class of bug,
not a one-off, so the fix is in the shared code where possible.

**1. The phase floor could never be crossed** (`13_bosses.js` `damage()` and
`stepBoss()`). While `phaseT < phase.minDuration` a boss is floored one point
*above* its phase threshold so a burst build cannot skip a beat. The advance
test then compared `hp <= floor + 0.001` — but by the time the timer had
expired, `floor` had dropped back to the threshold, so a boss sitting at
`threshold + 1` needed one **more** landed hit to advance. Any fight that had
meanwhile consumed its own weak points could never land it. The Congregation
deadlocked at exactly 401/600 this way, forever.

* `damage()` now compares against `base + 1.001`, where `base` is the phase
  threshold itself, so the pinned value advances the instant the timer expires.
* `stepBoss()` also advances a boss already pinned at its threshold from the
  timer alone — no further hit is required.

**2. The Congregation ate its own weak points** (`13b_bosses_1.js`). Only the
ten KEY birds are damageable (`hitTest` reports a hit on a live key and nothing
else), and `cgKeyIndex(k)` is `k * CG_N / CG_KEYS` — every 46th index *starting
at 0*. `cgBreak()` culled a fifth of the flock **from index 0 upward**, which is
exactly where the keys live, so five breaks wiped the flock, keys included, and
the boss became permanently untargetable. Three changes:

* `cgIsKey(i)` — keys are never culled, and the cull walks a coprime stride
  (`+7`, rotating start) so the formation thins evenly instead of from one end.
* `onPhase` revives the keys (`cgInit` builds the flock once and early-returns,
  so a phase change was the only place they could ever come back).
* `cgTick` re-forms all ten keys 1.6 s after the last one breaks, so a phase
  that outlives its keys is never untargetable.

**3. An endless wave could not spend its budget** (`14_waves.js`). A wave ends
only on `spawned >= budget && alive === 0`. Past 90% the runner switches to
`closerTypes`, which for an endless wave is the *problem* role — and every
problem type is hard-capped (`rotator: 2, necromancer: 3, herald: 2,
sunder: 2`). With all of them at cap, `_streamPick` returned `list[0]` anyway,
`_spawnGroup` placed nothing, `spawned` never moved, and endless wave 35 ran
past the 360 s watchdog with the same 8 enemies alive.

* the closer branch now falls through to the general stream when every closer
  type is capped, and the general branch falls back to an uncapped roster
  filler (and finally `mote`);
* a **last-resort budget bleed**: a drip that places nothing for 6 sim seconds
  (everything capped, or every rolled position inside the player's safe radius)
  credits `W.spawned` instead, so the wave always converges. Pressure is
  unchanged — the arena is already holding every enemy its caps allow.
  `W._noSpawnT` is reset in `Waves.start()`.

Endless wave 35 now completes in ~234 sim s instead of never.

**4. The Encore re-created the page crack while dying** (`13c_bosses_2.js`).
`onDeath` sets `d.hidden = 1` and calls `pageCrack(0)`, which removes the 14
`na-crack` divs — and then phase 2's `update` ran once more during `dying`, saw
`d.torn && d.hidden`, replayed its entry beat and called `pageCrack(0.6)` again.
`d.dead` now guards that beat. `--domcheck` on `encore` went from 14 leaked
nodes to 0.

**The fourth-wall DOM safety net** (`13_bosses.js`). Every fourth-wall fight
cleans up in its own `onEnd`, but a fight torn down mid-beat (a death, a
restart, a `?boss=` jump) never reaches that code. `NA.Bosses.clear()` and
`NA.Bosses.resetRun()` now both call `fourthWallSweep()` (exposed as
`NA.Bosses._fourthWallSweep`), which calls `NA.UI.fourthWall.reset()` — but only
when the wall actually has something outstanding (`_fake`, `_tall`, `_flash`,
`_crackEls`, `_viewport`, `_scroll`, `torn`, `crack`, `pageDim`, `_digits`, or a
filter left on `<body>`). A clean fight pays one property read.

### 25.12 Bot: per-frame soft-spot tracking

`98_bot.js` used to hold a working aim as an offset from `b.x/b.y` for 0.7 s
after damage stopped landing, then re-run the full arena `hitTest` sweep at
8 Hz. Neither works for a weak point that moves independently of the body — the
Tide's eyes ride a sheet clean across the arena — and that fight was eating
1200 sim seconds of a bot run.

* the fine pass is now `fineAround(b, cx, cy)`: one 7x7 bullet-sized lattice
  (49 `hitTest` calls) around a point, keeping the nearest cell whose flight
  path is not absorbed on the way in;
* `probeBoss` **tracks first** — it refines around last frame's soft spot every
  frame, and only pays for the 8 Hz coarse arena sweep when the track is lost
  (`Bot._trackX/_trackY/_trackOk`);
* the probe is now preferred over the "hold what was landing" heuristic
  whenever a fight exposes a `hitTest`; the hold is the fallback.

The charge-dash also lost its 520-unit range gate: some fights only care that a
dash HAPPENED inside a window (the Siren's song is interrupted by any dash at
all, wherever the ship is), so a dash that is out of charging range is still the
right move.

The Tide went from ~1200 sim s to ~450 sim s. It is still the slowest fight in
the game for the bot (its phase 2 runs two crossing sheets and the bot has no
model of them), but it always finishes.

**Known bot limitation — the Siren (wave 22).** `SIREN_WINDOW` is **0.22 s**,
once per ~3 s song, and a dash inside that window is the *only* thing that makes
the boss damageable (`hitTest` returns 2 — absorbed — at every other moment).
The bot has no model of the song telegraph, dashes on its own dodge cadence, and
in a 330 sim-second isolated fight never once landed inside a window: the Siren
stayed at 760/760. This blocks a god-mode 1->31 run at wave 22. Fixing it needs
either a bot rule that reads the song telegraph, or a wider window.

*(Fixed — see §25.17 for the published dash-window contract.)*

### 25.13 Console warnings fail the harness

`tools/test.js` printed `console.warn` and passed anyway. Warnings are now
pushed into `errors` — `13d_bosses_3.js`'s `dbg()` warns when a fourth-wall API
is missing, which is exactly the kind of silent degradation a run must fail on.
`--warnok` downgrades them again for a one-off investigation.

### 25.14 The quality governor (perf review #2)

`NA.R.reportFrame(cpuMs, realDt)` is called once per presented frame from
`NA.Game.frame`. CPU time alone cannot see GPU back-pressure (every GL call is
async), so the governor drives on the **worse of CPU cost and the presented
frame interval**:

* `realDt` is the rAF-to-rAF delta. `rafMs` outside `(0.4, 100)` ms is ignored
  (a tab stall, not us).
* `refreshMs` tracks the observed display cadence (min, with a slow +0.002
  ms/frame drift back up), because vsync pins the interval even on an idle
  frame. Only the **excess** over that cadence counts as back-pressure.
* `drive = max(cpuMs, rafMs - refreshMs)` feeds a 120-entry `Float32Array` ring
  to give `R.stats.avgMs`. `R.stats.p95` is computed every 32nd frame by copying
  the ring into a preallocated scratch and insertion-sorting it — no allocation,
  no closure.
* Thresholds: **`DOWN_MS = 15`, `UP_MS = 10`** (was 21 / 12.5, which never fired
  on a frame that was already dropping at 60 Hz). Hysteresis `holdT` accumulates
  **real wall time** (`rafMs`), not CPU milliseconds, so the window is a real
  1.2 s at any frame rate. It also needs `fhN >= 40` samples before it acts.
* `R.setQualityHard(q)` (the settings menu) pins `holdT = -1e9` so the governor
  never overrides an explicit choice.

`R.setQuality(q)` now has real rungs, weakest first, matching GAME_PLAN §13:

| q | `R.bloom` | `R.trails` | `R.particleCap` | `R.resScale` |
|---|---|---|---|---|
| 0 | false | false | 400 | 0.7 |
| 1 | true | true | 900 | 0.85 |
| 2 | true | true | 1500 | 1 |
| 3 | true | true | 2000 | 1 |

In `2d` mode `q` is clamped to 1, `R.bloom` is forced false and `particleCap` to
500. **`R.bloom` and `R.trails` are read outside the renderer** — `09_player.js`
and `07_fx.js` honour `R.trails` for engine trails and afterimages, and
`postActive()` returns false when `!R.bloom`, which skips the whole post pass.

### 25.15 Numeric sprite handles and the camera cull (perf review #9, #11)

`Atlas.bindKinds()` runs once after the atlas is built and fills
**`NA.R.S[id] = index`** for every glyph in `Atlas.list` (indices are stable —
`Atlas.list` only ever grows; `12_events.js` adds two glyphs lazily). The hot
path is **`R.spriteK(layer, kind, x, y, rot, sx, sy, r, g, b, a)`**, which indexes
`Atlas.list[kind]` directly instead of hashing a string key into the
dictionary-mode `Atlas.map`. `R.line` / `R.ring` / `R.dot` / `R.disc` / `R.poly` /
`R.polyFill` all route through it via a module-local `K` table plus `POLY_K` /
`FILL_K` arrays (no more `'p' + sides` concatenation per call).
`R.sprite(layer, 'id', ...)` still works and remains correct for cold call sites.

`R.begin()` computes a **camera AABB** into `R._cx0/_cx1/_cy0/_cy1` — the camera
centre padded by half the view diagonal, which covers any shake or rotation. Both
`R.sprite` and `R.spriteK` reject offscreen instances before touching the
instance buffer; `L.SCREEN` is exempt because it is already in screen space.

`R.cap` is the live per-layer cap (`LAYER_CAP` by default); see §25.16 for the 2D
override.

### 25.16 The Canvas2D fallback: drawImage + tint cache (perf/compat CRITICAL)

The old `flush2D` re-ran each glyph's *atlas authoring* callback per instance
(three stacked `shadowBlur` fills), which measured **1494 ms/frame** in
`--nogl --stress` and painted everything white at alpha 1 because those callbacks
reset the fill state. It now composites from the already-rasterised atlas:

* **Tint cache.** `tintCanvas` is a 16 x 8 grid of 128 px slots. `tintSlot(e, cq)`
  keys on `glyph kind * 4096 + quantised colour` (r/g/b quantised to 4 bits each),
  blits the atlas cell into a free slot, then paints the colour over it with
  `globalCompositeOperation = 'source-atop'`, so only the glyph's own alpha is
  tinted and neighbouring slots on the shared canvas are untouched. A `Map` holds
  key to slot; when all 128 slots are used the cache is cleared wholesale and
  refilled.
* **One transform per instance** — `ctx.setTransform(cos, sin, -sin, cos, tx, ty)`,
  or the translate-only form when `rot === 0` — then a single `drawImage` from
  `tintCanvas`. Instances under 0.35 device px on both axes are skipped.
* The `try/catch` is **per layer**, not per instance. `globalCompositeOperation`
  is `'lighter'` for additive layers (`LAYER_ADD`), `'source-over'` otherwise.
* **Layer caps.** In 2D mode `R.cap` is a copy of `LAYER_CAP` with every layer up
  to and including `L.AFTER` cut to 25% (floor 96), so the fallback degrades
  instead of dying.
* **Cheap post stand-in.** The GL post chain does not exist in 2D, so darkness and
  vignette are approximated with one cached radial gradient (rebuilt only when the
  quantised amounts or the canvas size change) plus a white `flash` fill. Without
  it the eclipse / darkPhase / Dimmer beats were complete no-ops in the fallback.
  `chroma`, `hue` and `desat` are still unimplemented in 2D.

Measured after: `--nogl --stress` 1494 ms to **68 ms**; `--nogl --wave=20` timed
out, now **1.46 ms** average.

### 25.17 The Siren dash-window contract

The Siren is only damageable while a dash has interrupted its song. The bot's
dash rhythm and the song are both deterministic, so they aliased and the bot could
miss every window for minutes (the stall recorded in §25.12). The fix is a
published contract, not a bot special case:

* `SIREN_WINDOW = 0.45` s, and **every 4th song is a "chorus"** with the longer
  `SIREN_CHORUS` window, telegraphed identically.
* **Mercy widening**: `d.sinceHit` is a drought clock; after ~25 s with no landed
  dash the window widens up to 2.5x, and snaps back on the first hit.
* The boss publishes two read-only fields on its instance: **`b.dashHintT`**
  (seconds until the window opens; `0` while it is open) and
  **`b.dashWindowOpen`** (bool). Any boss whose only opening is a timed dash may
  publish the same pair — that is the whole contract.
* Player-facing telegraph: a 0.9 s orange-to-red lead-in ring with ticks on
  `L.VEIL`, and a gold (not white) burst on a landed dash.

`98_bot.js` has one generic rule keyed on the contract: when `b.state === 'fight'`
and `typeof b.dashHintT === 'number'`, dash if `dashWindowOpen` or
`dashHintT <= 0.10`, steering at the boss so the dash carries the ship in.
Between windows it **banks mana**: the ordinary "charge the tracked soft spot"
dash is gated on `hintT < 0`, so it never spends the window's mana. Survival
dashes (a closing bullet within 60 units) still outrank both.

### 25.18 The camera contract

The invariants other systems must not break (numbers in §25.1):

* The camera **follows the player and stays zoomed in** during combat. This is an
  owner rule, not a tuning choice: no fix may zoom out to make something visible.
  Off-screen information goes into screen space instead (§25.19).
* The arena is **fixed at `NA.C.ARENA_R` 1900** (minimum `ARENA_MIN_R` 514); the
  combat window is `NA.C.VIEW_W` x `NA.C.VIEW_H` = **1430 x 806** world units at
  zoom 1, still much smaller than the arena — the rim is off screen for most of
  a fight.
* Boss framing goes through `NA.Cam.bossZoom(camZoom)`, which is arena-relative
  (reference width 2080, `src/02_render.js`).
* The reticle is **deliberately minimal**: a cyan dot plus a hairline ring, drawn
  in `L.HUD` from `NA.Store.settings.reticle` (`src/09_player.js`). Nothing may
  grow it into crosshairs — aim reads off the ship and the shot streak.
* Player shots stay legible at this window through speed and streak, not size:
  `BULLET_SPEED` 1475 / `BULLET_LIFE` 1.42 (`src/01_core.js`), drawn as a capsule
  stretched **1.6x** along velocity (`src/08_bullets.js`).
* **Every wide framing goes through `NA.Cam.fitArena(ms)`** — overview, title,
  draft, death, ending, stress. Nothing else may compute a fit-the-arena zoom.
* `NA.Cam.viewW()` / `NA.Cam.viewH()` are the live world extent and are the
  correct source for any on-screen / off-screen test.

### 25.19 The screen-space rim HUD (design F5)

Because the world rim is off screen in combat (§25.18), `NA.UI.HUD` draws the rim
two different ways and picks by state:

* **Combat** (`wave`, `boss`, `lastkill`, `sweep`) calls
  `HUD.renderScreenRim(cap, beat)`, which draws in `L.SCREEN` space via `R.sdisc`
  / `R.sline`. One ellipse inset 22 px from the viewport edge. Every living enemy
  (capped at 260) is a dot on it at its **bearing from the camera**, in its own
  type colour; enemies currently off screen (tested against half `Cam.viewW()` /
  `viewH()`) read brighter and larger and get a short inward tick — so the ring is
  both the wave-wide census and the off-screen threat readout the plan asks for.
  The **spawn-budget ring** depletes clockwise from the top on the same ellipse
  (48 chords worst case) from `NA.Waves.progress`; with no wave running it draws
  full and dim so the rim never goes blank.
* **Zoomed-out states** (overview / draft / title / ending) get the original
  world-space rim at `NA.Arena.radiusAt(ang) + 9`, plus the idle full ring.

Zero text, zero allocation. `HUD.renderOffscreen()` (flickering chevrons on the
ship's hull for winding-up enemies, capped at 6) is unchanged and complementary:
the rim says *where*, the chevrons say *now*.

### 25.20 `NA.Player.mods` — published modifiers other systems read

`NA.Player.stats` is the player's own derived stat block. **`NA.Player.mods` is
the separate table of modifiers other modules read**, so a wildcard's downside
lands where the affected system actually lives:

* **`mods.enemyFireMul`** multiplies every enemy fire **cooldown**.
  `10_enemies.js:401` copies it into `En.fireMul` each frame and
  `10c_enemies_cde.js` uses that in its own shooters. Feedback Loop T1 sets it to
  `1 / 1.3`, i.e. the whole field shoots 30% more often. Reset to 1 in
  `Player.reset()`.
* **`U.mods.grazeMul`** is the shared upgrade modifier table, not a raw player
  write: `Upgrades.reapply()` rebuilds `NA.Player.grazeMul` from it on every
  draft, so anything writing `NA.Player.grazeMul` directly is erased by the next
  card taken. Feedback Loop T1 does `U.mods.grazeMul *= 2`; `08_bullets.js:305`
  pays `C.MANA_GRAZE * pl.grazeMul` on a graze.

Rule: an upgrade never reaches into another module's loop. It publishes a
multiplier here and the owning module reads it.

### 25.21 Event field hooks read by enemies and bullets (design F3)

`12_events.js` publishes five query points that the rest of the sim now honours;
before this pass several events were mechanically inert.

| hook | shape | read by |
|---|---|---|
| `NA.Events.damageMulAt(x, y)` | multiplier | `08_bullets.js:188, 212` — player bullet damage, guarded by `NA.Events.hasDamageField` so the common case costs one boolean |
| `NA.Events.hiddenAt(x, y)` | 0..1, 1 = enemies cannot see the player | `10_enemies.js:411`, guarded by `hasHiddenField` |
| `NA.Events.domesDown` | bool | `10_enemies.js:312` — Sentinel / Cathedral domes down, so the shielded check returns false |
| `NA.Events.onBeatWindow()`, cached per frame as `Ev.beatWindow` | 0..1 | `08_bullets.js:61` — +25% damage inside the Resonance Pulse window |
| `NA.Events.inverted` | 0..1 | Ion Storm hue swap; also gates that event's own threat rating |

All five are cleared in `Events.reset()` and on wave clear. Callers must keep the
`NA.Events &&` guard: events are optional and the harness runs boss-only modes
with the module idle.

### 25.22 Verification

Edge only — never `chrome.exe`. Build, smoke, then the harness.

```bash
node tools/build.js && node tools/smoke.js
```

`tools/test.js` flags:

| flag | effect |
|---|---|
| `--bot` | `?bot=1` autopilot (§25.2) |
| `--god` | `?god=1`, `NA.Player.damage` becomes a no-op |
| `--fast=N` | `NA.Time.simScale` — simulation only, menus stay on the wall clock |
| `--wave=N` | start at wave N |
| `--boss=id` | isolated boss fight |
| `--endless=N` | start in endless at wave N |
| `--untilWave=N` | the run completes when wave N starts |
| `--frames=N` | frame budget (default 400) |
| `--stress` | the synthetic 500-enemy / 5000-bullet scene |
| `--prof` | `NA.Prof` per-module timings, streamed per progress line |
| `--nogl` | force the Canvas2D fallback (§25.16) |
| `--domcheck` | fail if the fourth wall left DOM nodes under `#dom`, a CSS filter on `<body>`, a non-hidden `overflowY`, or a scrolled page |
| `--upg=a:3,b:2` | pre-take upgrades at the given tiers |
| `--screen=name` | capture a named screenshot |
| `--warnok` | downgrade `console.warn` back to non-fatal (§25.13) |
| `--strict` | drop the relaxed Chromium switches (`--allow-file-access-from-files`, `--no-sandbox`, throttling disables) and run as a stock browser |

Canonical runs — each must finish with zero errors and zero warnings:

```bash
node tools/test.js --bot --god --fast=4 --untilWave=31 --frames=200000
node tools/test.js --bot --god --endless=35 --untilWave=44
node tools/test.js --stress --prof --frames=900
node tools/test.js --nogl --stress --prof --frames=300
node tools/test.js --nogl --bot --god --wave=15 --frames=900 --screen=nogl15
node tools/test.js --boss=siren --bot --god --fast=4 --frames=6000
node tools/test.js --bot --god --wave=20 --domcheck --strict
```

### 25.23 Boss reachability

A fight may gate damage behind a window, but never behind nothing. Four rules
hold across the boss files:

* **Distance first, then verdict.** The Angler and the Depth both hide an
  invulnerable mass under the floor, and their `hitTest` returns 0 for any shot
  that does not actually reach that mass — only a shot inside the body radius
  can be reported as absorbed (`2`). Returning "absorbed" arena-wide deleted the
  build's entire output every frame. `src/13c_bosses_2.js` ~1004-1012 (Angler),
  ~672-687 (Depth, which also reports `1` on the surfaced body and on the jaw
  left exposed by a bite — `d.expose` 1.4 s, radius 62).
* **Forced windows.** `ANG_DRY` and `DEP_DRY` are both **12 s**
  (`src/13c_bosses_2.js` ~954-955). If no enemy has taken the bait for that long
  the Angler surfaces on its own real bait (~1100-1109); if no weak point has
  been open for that long the Depth pulls its next breach forward to 0.3 s
  (~831-843). Neither fight can be gated on a spawn trickle the player does not
  control. Both also park `b.x/b.y` on whatever is currently shootable, so the
  off-screen marker and the bot's aim point at the real target.
* **The Tide always has an open eye to shoot.** The body the arena tracks is the
  nearest open eye to the player, chosen per frame with a 0.55 hysteresis factor
  on the previously tracked sheet so the marker does not jitter when two sheets
  close symmetrically (`src/13b_bosses_1.js` ~605-623). Phase 3 opens the
  **middle** eye (index 1, one sheet soft at a time) — it rides the arena's
  centre axis, so the lane through the pair is the lane the surge detonates in;
  the old off-centre eyes rode out of reach along the crests (~561-571).
* **Encore's bonus draft is a real `'draft'` game state**, driven by `UI.tick`;
  the boss only holds itself in `dying` until the card is taken
  (`src/13c_bosses_2.js` ~493-511). Because the autopilot drives the draft only
  from `Game.state === 'draft'` and never sees this one, there is a bot
  fast-path: with `NA.Bot.on` the card is picked after 0.35 s of wall clock,
  and any draft is force-closed after 25 s. Without it the boss sat in `dying`
  for over a minute of sim time.
* **The shared guards.** `NA.Bosses.damage()` returns early at `phase < 0`
  (a `?boss=` jump can set state directly, and `phases[-1]` would floor the boss
  one whole phase *above* `maxHp`), and the phase-advance test compares against
  the same `base + 1` the minimum-duration floor uses — comparing against
  `floor + 0.001` needed one extra landed hit after the timer, which deadlocked
  the Congregation at 401/600 once its weak points were consumed. `die()` is
  guarded against re-entry, which used to reset `b.t` so the 1.4 s `dying`
  release never landed. `src/13_bosses.js` ~140-180.
