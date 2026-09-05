# NOVA ARENA — Engineering Brief (shared by every implementation agent)

Read GAME_PLAN.md first. This file is the technical contract that lets several agents build in parallel.

## Non-negotiables
- **Ship as ONE html file:** `d:\!games\nova-arena.html`, produced by `node tools/build.js` which concatenates `src/*` in filename order. No external assets, no CDN, no fetch. Fonts, sounds, sprites are all generated in code.
- **Source layout:** `src/NN_name.js` (two-digit prefix decides order). `src/00_shell.html` holds the HTML/CSS head and body (a full-window `<canvas id="gl">`, a `<canvas id="ui">` overlay for 2D UI, and a `<div id="dom">` overlay for fourth-wall DOM effects). The build wraps all JS in one `<script>` at the end of the body. Plain ES2020, no modules, no build tools beyond the concat script. Everything hangs off one global `NA`.
- **60 fps with 500 enemies + 5000 bullets + 3000 particles.** Structure-of-arrays typed-array pools, swap-remove, no per-frame allocations in hot loops, a uniform spatial hash rebuilt each frame, squared distances, no `atan2` per bullet per frame.
- **Renderer:** WebGL2 instanced sprite quads from a runtime-generated atlas (glyphs pre-rendered with baked 3-layer glow at 3 sizes) with ~8 draw calls per frame (one per layer), additive blending for bullets/particles/aura layers, normal blending for enemies/ship. Lines, rings, polygons, and telegraphs are drawn as stretched/rotated atlas primitives (a 1px line sprite, a ring sprite, a soft disc). A Canvas 2D fallback path (glow off, particle cap 500) when WebGL2 is unavailable. One post-process pass for chromatic split, vignette, hue rotate, darkness/lighting mask (destination-out style light stamps) — skipped entirely when all effects are zero. Dynamic quality tiers driven by a rolling frame-time average with hysteresis.
- **Fixed timestep** simulation (120 Hz accumulator) with interpolated rendering. Global `timeScale` for slow-mo and hit-stop scales the accumulator only. `visibilitychange` pauses the accumulator.
- **Determinism where it matters:** waves are scripted; use a seeded RNG (`NA.RNG`) for draft offers and spawn jitter.
- **Zero text in the UI.** Tab title only. Numbers (wave pips, optional crits) are drawn as glyph strokes, not fonts.
- **Layer order, bottom to top:** backdrop → floor events → membrane → particles (additive) → enemy bullets → enemies → player bullets → player → veil events → after-images → HUD.
- **Readability rules:** only ship core, player bullets, and the imminent killer are pure white; enemies never blend additively; particles ≤60% brightness; telegraphs draw above everything at full brightness and pulse at a shared 2 Hz, orange while pending, red at lock.

## Module map (`NA.*`)
| File | Namespace | Owner | Responsibility |
|---|---|---|---|
| 00_shell.html | — | foundation | HTML + CSS shell |
| 01_core.js | NA.C, NA.M, NA.RNG, NA.Time, NA.Input, NA.Store | foundation | constants, math (vec helpers, simplex noise, easing), seeded RNG, fixed-step clock + timeScale, keyboard/mouse/gamepad input, localStorage settings |
| 02_render.js | NA.R, NA.Atlas | foundation | WebGL2 instanced renderer, atlas generation, layers, post-process, quality governor, Canvas2D fallback, camera (NA.Cam) |
| 03_audio.js | NA.Audio | audio agent | procedural WebAudio SFX + generative music |
| 04_icons.js | NA.Icons | icons agent | canvas-2D icon drawing functions for upgrades, enemies, bosses, settings, glyph digits |
| 05_pools.js | NA.Pool, NA.Grid | foundation | SoA pool factory, spatial hash |
| 06_arena.js | NA.Arena | foundation | boundary polygon (circle/hex), membrane rendering, ripples, shrink/rotate/chasm/mirror-wall support, soft-wall physics, point-in-arena |
| 07_fx.js | NA.FX, NA.Particles | foundation | trauma shake, hit-stop, chroma, flashes, particle pool with priority, lightning polylines, rings, after-images |
| 08_bullets.js | NA.Bullets | foundation | player + enemy bullet pools (SoA), flags (pierce, bounce, homing, owner, etc.), collision vs grid, graze detection |
| 09_player.js | NA.Player | foundation | ship movement, aim, fire, dash, HP, mana (sources/sinks/graze), invuln, death shatter, ship visual slot renderer (NA.Ship) |
| 10_enemies.js | NA.Enemies | foundation defines framework; enemy agent fills types | enemy SoA pool, type registry (`NA.Enemies.define(id, {…})`), shared flock update, telegraph helpers, mutators, death effects |
| 11_upgrades.js | NA.Upgrades | upgrades agent | 42 upgrades × 3 tiers as hooks (onFire, onHit, onKill, onDash, onSpend, update), synergy tags, visual slot contributions |
| 12_events.js | NA.Events | events/waves agent | background events (telegraph/active/decay), biomes/backdrops, reveal logic |
| 13_bosses.js | NA.Bosses | boss agents | boss registry (`NA.Bosses.define(id, {intro, update, render, phases…})`) |
| 14_waves.js | NA.Waves | waves agent | 30-wave script, spawn choreography, endless generator |
| 15_ui.js | NA.UI, NA.Draft, NA.HUD | UI agent | title, HUD arcs, draft screen, transitions, death, pause/settings, ending |
| 16_game.js | NA.Game | foundation | state machine (title → wave → draft → overview → boss → … → ending → endless), glue, main loop |
| 99_boot.js | — | foundation | boot, error overlay for dev (`?debug=1`), `?wave=N` / `?stress=1` / `?boss=id` dev params |

Foundation also delivers `tools/build.js` (concat + minify-free), `tools/test.js` (launches system Chrome headless via puppeteer-core or Playwright, loads the built file with `?test=1&frames=600&wave=N`, collects console errors, average/95th frame time, entity counts, and exits nonzero on errors), and `ARCHITECTURE.md` documenting every public function with signatures and examples so content agents can work without reading the code.

## Cross-module contracts (must hold)
- `NA.Audio.init()` (call on first user gesture), `NA.Audio.sfx(name, {x, y, pitch, vol})`, `NA.Audio.setTimeScale(s)`, `NA.Audio.duck(db, ms)`, `NA.Audio.music.setMode(name)`, `NA.Audio.music.setIntensity(0..1)`, `NA.Audio.music.onBeat(cb)` / `NA.Audio.music.beat` (current beat index) / `NA.Audio.music.bpm`. SFX names: `shot, shotHeavy, rail, kill, killCombo(n), hitEnemy, hitPlayer, dash, graze, wall, manaFull, manaDry, spendActive, explode, lightning, supernova, telegraph, lock, laser, charge, spawn, bossIntro, bossPhase, bossDeath, draftHover, draftPick, draftSkip, waveClear, death, uiTick, uiConfirm, gate`.
- `NA.Icons.draw(ctx, id, x, y, size, opts)` draws an icon centered at x,y onto a CanvasRenderingContext2D; `opts` may include `{tier, color, glow, alpha}`. `NA.Icons.ids` lists ids. Upgrade ids match `NA.Upgrades` ids (`twinBarrels, railgun, buckshot, mortar, gatling, blast, ricochet, drill, seeker, voltaic, overdrive, chrono, pulse, siphon, overcharge, arcane, afterburner, phase, drift, blink, hullPlating, vent, ghost, reaper, impact, wake, spendthrift, overkill, shardOrbit, drone, turret, mirror, mines, stormCloud, gravityWell, burnTrail, ghostRounds, claustrophobia, glassHull, berserk, feedbackLoop, gambler`). Also settings icons (`resume, volMaster, volMusic, volSfx, shake, flash, quality, colorblind, reticle, autofire, hints, quit, reroll, skip, gate, home, infinity`), and `NA.Icons.digit(ctx, n, x, y, size)` for 0–9 stroke digits, `NA.Icons.enemy(ctx, shapeId, …)` for enemy glyph shapes (`circle, tri, square, hex, diamond, ring, needle, chevron`), `NA.Icons.boss(ctx, bossId, …)`.
- Renderer public API (foundation defines exact names; keep to this shape): `NA.R.sprite(layer, spriteId, x, y, rot, sx, sy, r, g, b, a)`, `NA.R.line(layer, x1, y1, x2, y2, width, r, g, b, a)`, `NA.R.ring(layer, x, y, radius, width, r, g, b, a)`, `NA.R.disc(layer, x, y, radius, r, g, b, a)` (soft), `NA.R.poly(layer, x, y, radius, sides, rot, width, r,g,b,a)`, `NA.R.light(x, y, radius, intensity)` for the darkness mask, `NA.R.setPost({chroma, vignette, hue, darkness, flash, desat})`, `NA.Atlas.add(id, size, drawFn)` to register a glyph pre-rendered with glow. World-space by default; `NA.R.screen*` variants or a `screen` flag for HUD.
- Enemy definition shape: `NA.Enemies.define('mote', { shape:'circle', color:[r,g,b], size, hp, speed, cost, band, flock:true, init(i), update(i, dt), onDamage(i, amt, src), onDeath(i), render(i) })` with SoA access via `NA.Enemies.x[i]` etc. Telegraph helpers: `NA.Enemies.telegraphLine(...)`, `telegraphCircle(...)`, `telegraphArrow(...)` that handle the orange→red lock convention and audio cues.
- Upgrade hook shape: `NA.Upgrades.define('blast', { family, tags:[…], visual:{slot, …}, tiers:[ {apply(p), onHit(ctx), onKill(ctx), onFire(ctx), onDash(ctx), onSpend(ctx), update(dt), render() }, … ] })`, with `NA.Upgrades.tier(id)` and a hook dispatcher `NA.Upgrades.emit('onKill', ctx)` called by player/bullets/enemies.
- Boss definition shape: `NA.Bosses.define('compactor', { name, color, intro(t) → done?, phases:[{minDuration, enter(), update(dt), render(), exit()}], hp, onDamage, onDeath(), render() })`. Bosses may spawn enemies via `NA.Enemies.spawn(id, x, y)`, alter the arena via `NA.Arena` API, draw via `NA.R`, and use `NA.UI.fourthWall.*` helpers (tear draft panel, dim page, viewport arena, scroll page, fall HUD digit) which the UI agent provides.
- Waves: `NA.Waves.script[n]` = `{ act, biome, newTypes, retire, budget, beats:[{t, type, count, gate|pos}], spikes, mutators, boss }`, plus `NA.Waves.endless(n)` generator.
- Game state events: `NA.Game.on('waveStart'|'waveClear'|'draftOpen'|'draftPick'|'bossIntro'|'bossDeath'|'playerHit'|'playerDeath'|'kill', cb)`.

## Dev conveniences
- `?debug=1` shows an fps/entity overlay (dev only; not part of the text-free rule) and an on-screen error box.
- `?wave=N` starts at wave N with a random reasonable build; `?boss=id` jumps to that boss; `?stress=1` spawns the stress scene; `?test=1` disables audio and runs deterministic frames for `tools/test.js`.
- Settings persist in localStorage under `na.settings`; run records under `na.records`.

## Style
Small functions, hot loops flat and index-based, comments explain *why*. Every module starts with a header comment listing its public API. Never `new` inside update loops. Colors as `[r,g,b]` 0–1 floats. Angles in radians. World units: arena radius 1400, ship core radius 10, camera shows ~1600×900 at zoom 1.
