# NOVA ARENA — adversarial review: CORRECTNESS AND CRASHES

Read-only review. Nothing under `src/` or `tools/` was modified. Reproductions were run
against a freshly built `nova-arena.html` (`node tools/build.js`) using `tools/test.js`
(Edge) and a private stubbed-DOM driver in the scratchpad derived from `tools/smoke.js`.
The concurrently-edited Siren boss and `98_bot.js` were skipped.

**What I actually ran**
- `node tools/smoke.js` — clean.
- All 29 bosses (siren skipped), 1400 frames each in the Node stub with `--bot --god` — no exceptions.
- Transition fuzz: `NA.Game.restart()` at 4 different frames × every boss — no exceptions.
- `node tools/test.js --bot --god --fast=6 --untilWave=31 --frames=400000` — **failed** at wave 13
  with `watchdog: stalled 90s real at boss|13|angler:fight:0:30`. That is finding **P0-1**.

Findings are ranked. Items marked **[read-only]** are from reading the code path and are argued
but not reproduced end-to-end; everything else has a repro line.

---

## P0-1 — Angler eats every player bullet in the arena; the fight can stall forever

`src/13c_bosses_2.js:972-981`

```js
hitTest: function (b, x, y, r) {
  var d = b.data;
  if (d.surf > 0) {
    var dx = b.x - x, dy = b.y - y, rr = d.radius + r;
    if (dx * dx + dy * dy < rr * rr) return 1;
    return 0;
  }
  absorbFx(x, y, ANG_COL[0], ANG_COL[1], ANG_COL[2]);
  return 2;                        // the mass is down there somewhere, and armoured
},
```

**What happens.** `NA.Bullets.update` (`src/08_bullets.js:183-189`) calls
`NA.Bosses.hit(x, y, size, dmg)` for **every** live player bullet on **every** frame, with no
broad-phase test — the def's `hitTest` *is* the broad phase. The submerged branch has no
distance test at all, so it returns `2` ("absorbed") for a bullet anywhere in the 1700-unit
arena. `hitOne` (`src/13_bosses.js:272`) returns true, and the bullet is destroyed
(`B.killP(i, true)` unless it has pierce, and pierce is merely decremented each frame until it
too dies). The player's entire projectile output is deleted the frame it spawns for the whole
submerged portion of the fight.

The Angler is only damageable during the 2 s `d.surf` window, and the only thing that opens
that window is an *enemy* walking into a bait (`anglerTick`, `13c_bosses_2.js:1101-1107`). Since
the player cannot shoot anything, the mote trickle (`d.spawnT = 2.1`, capped at `En.n < 26`)
is the sole driver, and it is not guaranteed to converge.

**Reproduction (deterministic).**
```
node tools/test.js --bot --god --fast=6 --untilWave=31 --frames=400000
  -> ERRORS (1): watchdog: stalled 90s real at boss|13|angler:fight:0:30|40|2192|1
     HP pinned at 510/660 for ~500 sim-seconds, 26 enemies alive, player bullets 0.
```
Node stub, `?wave=13&bot=1&god=1&seed=5`, 60 000 frames: boss HP **660/660 unchanged after
900 sim-seconds**, `phaseT=900`, player bullets constantly `0`.
Browser URL to see it by hand: `nova-arena.html?boss=angler&debug=1` — fire anywhere and watch
every shot vanish at the muzzle.

**Fix** — make the absorb a body hit, not a global one:
```js
hitTest: function (b, x, y, r) {
  var d = b.data;
  var dx = b.x - x, dy = b.y - y, rr = (d.radius || 76) + r;
  if (dx * dx + dy * dy > rr * rr) return 0;   // a miss is a miss
  if (d.surf > 0) return 1;
  absorbFx(x, y, ANG_COL[0], ANG_COL[1], ANG_COL[2]);
  return 2;
},
```
Additionally the phase timer should not be able to run forever with no damage possible: consider
forcing a surface after N seconds without one (`if (b.phaseT - d.lastSurfT > 12) anglerSurface(...)`).

---

## P0-2 — Same unbounded-absorb bug in the Depth boss

`src/13c_bosses_2.js:666-678`

Identical shape: after the `d.surf` and `d.expose` checks, the fallthrough is
`absorbFx(x, y, …); return 2;` with **no distance test**, so every player bullet in the arena is
deleted every frame while the boss is below the floor.

Depth is less likely to hard-stall than the Angler because `d.expose` is on a timer the boss
drives itself, but the behaviour is still wrong: pierce is burned, explode never fires
(`P.explode` triggers only on a bounded hit), and the whole build reads as broken.
Observed in the full run: `depth:fight:p0:602` unchanged across ~9 stat lines (≈100 sim-seconds).

**Fix** — same shape as P0-1: return `0` when the shot is not within `d.radius + r` of the body
(or within the exposed weak point), and only `absorbFx/return 2` for shots that actually landed.

---

## P1-3 — `Draft.reroll()` can charge 40 mana and produce an empty draft

`src/15_ui.js:517-528` + `src/11_upgrades.js:299-303`

`NA.Upgrades.offer()` returns an **empty array** when the eligible pool is empty
(`if (!pool.length) return out.slice(0);` — every upgrade at `maxTier`, or blocked by
`excludedFor`). `Draft.open()` handles that case (`if (!Draft.offers.length) { Draft.active =
false; return false; }`, and `NA.Game.step`'s `sweep` branch routes to `toOverview()`).
`Draft.reroll()` does **not**:

```js
if (!NA.Player.spend(40, 'reroll')) { sfx('manaDry'); return; }
Draft.rerolled = true;
Draft.offers = NA.Upgrades.offer(Draft.count, NA.RNG);
buildCards();
```

The 40 mana is gone, `Draft.offers` is `[]`, `Draft.active` stays `true`, and the draft renders
with zero cards. `pick()` bails on `i >= Draft.offers.length`; the only escapes are the Skip hex
(mouse) or gamepad Y. Reachable in a long endless run once the pool is exhausted.

**Fix**
```js
var next = NA.Upgrades.offer(Draft.count, NA.RNG);
if (!next.length) { Draft.close(); if (NA.Game) NA.Game.toOverview(); return; }
Draft.rerolled = true; Draft.offers = next; buildCards();
```
(and refund, or check before spending).

---

## P1-4 — Mouse-up clears keyboard fire (`_keyFire` is never assigned)

`src/01_core.js:308`

```js
if (e.button === 0) { self.mouse.left = false; self.down.fire = self.down.fire && !!self._keyFire; }
```

`_keyFire` is written **nowhere** in the codebase (`grep -rn "_keyFire" src/` returns this one
line). It is always `undefined`, so releasing the left mouse button always clears `down.fire`,
even when Space is still held. Hold Space, click and release the mouse → the ship stops firing
until Space is released and pressed again. Auto-fire masks this in combat states, but it is live
whenever `Store.settings.autofire` is off, and `down.fire` also drives `Draft.update`'s pick
(`NA.Input.pressed('fire')`).

**Fix** — track the keyboard state in the key handlers:
```js
// keydown:  if (e.code === 'Space') self._keyFire = true;
// keyup:    if (e.code === 'Space') self._keyFire = false;
```
or simply `self.down.fire = !!self._anyKeyFire()` derived from the key map.

---

## P1-5 — Encore holds `state === 'dying'` for ~90 seconds

Observed in the full autopilot log:
```
[25860] boss w11 encore:dying:p2:0
[26160] boss w11 encore:dying:p2:0
[26460] boss w11 encore:dying:p2:0
[26760] wave  w12                 <- finally advanced
```
That is ~90 sim-seconds (≈15 s at `--fast=6`) in `dying` while the player has nothing to do.
`src/13_bosses.js:306-309` releases `dying` at `b.t > 1.4`; Encore therefore has to be holding
it deliberately (a fourth-wall beat) or via a re-entered `die()`. **[read-only — I did not
finish tracing which of the two it is.]** Worth confirming: if it is a re-entrant `B.die()`
resetting `b.t = 0` every call, that is a genuine hang risk, since `die()` unconditionally does
`b.state = 'dying'; b.t = 0;` with no `if (b.state === 'dying') return;` guard.

**Suggested guard regardless** (`src/13_bosses.js:165`):
```js
die: function () {
  var b = B.active; if (!b || b.state === 'dying' || b.state === 'dead') return;
  …
```

---

## P1-6 — `NA.Events.update()` mutates `Ev.active` while iterating it

`src/12_events.js:322-338`

```js
for (i = Ev.active.length - 1; i >= 0; i--) {
  e = Ev.active[i]; d = e.def;
  …
  if (d.update) d.update(e, dt);          // may call Ev.trigger() / Ev.stop()
  if (e.t >= dur) { … Ev.stopIndex(i); continue; }
}
```
`Ev.trigger()` **splices** every same-layer event out of `Ev.active` and pushes the new one, and
`Ev.stop(id)` splices too. If any event's `update()` triggers or stops another event, the
subsequent `Ev.stopIndex(i)` in this iteration removes the **wrong element** (the array has
shifted), calling that event's `onEnd` while its owner still believes it is live, and skipping
`onEnd` for the one that actually expired. The one-per-layer invariant means the window is
narrow, but it is a real index-after-mutation hazard. **[read-only — I did not find a
same-frame `trigger()` from inside an `update()` in the 18 shipped events; the hazard is in the
framework, and `riftSpawn`/`meteorShower`-style events are the shape that would trip it.]**

**Fix** — capture the identity, not the index:
```js
if (e.t >= dur) {
  …
  else { var k = Ev.active.indexOf(e); if (k >= 0) Ev.stopIndex(k); continue; }
}
```

---

## P1-7 — `Enemies.kill()` can free the wrong slot if `onDeath` kills its own index

`src/10_enemies.js:189-231`

```js
kill: function (i, byPlayer) {
  if (i < 0 || i >= P.n) return;
  var d = En.types[P.type[i]];
  …
  if (d.onDeath && En._busy < 8) { En._busy++; try { d.onDeath(i); } finally { En._busy--; } }
  …
  P.free(i);          // <-- assumes slot i is still the same entity
}
```
There is no re-entrancy guard on `i`. If an `onDeath` (or anything it calls — `damageArea` is
queued, but a direct `En.kill(j)` / `En.damage(j)` is not) frees a slot `< i` or frees `i`
itself, the swap-remove moves a *different* live entity into `i`, and the trailing `P.free(i)`
then deletes that innocent entity while the intended one survives. Same class of hazard in
`En._area` (`10_enemies.js:157-166`), where `d` is captured before `d.update`/`onDeath` can
reshuffle the pool.

The shipped `onDeath`s mostly iterate **descending** (`13d:736`, `13d:1126`, `13b:1723`) or sort
descending before freeing (`10c_enemies_cde.js:1223-1230`, the Singularity swallow), which is
exactly the right discipline — but nothing enforces it, and a future enemy that calls
`En.kill(someLowerIndex)` from `onDeath` silently corrupts the pool. **[read-only — I found no
shipped type that does it today.]**

**Fix** — take a generation stamp before the callback:
```js
var g0 = P.gen[i], ty0 = P.type[i];
if (d.onDeath && En._busy < 8) { … }
if (i < P.n && P.gen[i] === g0 && P.type[i] === ty0) P.free(i);
```

---

## P1-8 — `Enemies.update()` double-integrates when `d.update` kills its own row

`src/10_enemies.js:361-390`

The main loop is a forward `for (i = 0; i < P.n; i++)` that captures `var d =
En.types[P.type[i]]` and, after `d.update(i, dt)`, unconditionally does
`P.x[i] += P.vx[i] * dt; … clampToArena(i);` plus the contact-damage test. If `d.update` killed
entity `i` (a self-destruct, a Bloat detonating, a Popper), the swap-remove has moved the *last*
entity into slot `i` — which is then integrated a second time this frame, clamped with the wrong
`d`, and given a second chance at contact damage against the player. There is no `i--`/`continue`
after a self-kill. **[read-only]**

**Fix** — stamp and bail:
```js
var g0 = P.gen[i];
if (d.update) d.update(i, dt);
if (i >= P.n || P.gen[i] !== g0) { i--; continue; }   // this row died; the swap-in gets its own turn
```

---

## P1-9 — A player bullet's `onHit` hook can make `killP` free the wrong bullet

`src/08_bullets.js:204-218`

```js
HCTX.bi = i;  …
var killed = NA.Enemies.damage(ei, dmg, 'player');
if (NA.Upgrades) NA.Upgrades.emit('onHit', HCTX);
if (P.explode[i] > 0) B.explode(…);
if (P.pierce[i] > 0) { P.pierce[i]--; }
else { B.killP(i, true); dead = true; }
```
`HCTX.bi` is handed to every owned upgrade tier's `onHit`. Any hook that spawns or frees player
bullets (`B.killP`, or a `firePlayer` that triggers a pool overflow path) invalidates `i` before
`P.pierce[i]--` / `B.killP(i, true)` runs, and the pierce decrement / free lands on a different
bullet. The same is true one line earlier: `NA.Enemies.damage` → `kill` → `onDeath` →
`NA.Bullets.reset()` in a boss/upgrade death chain would set `P.n = 0` under the loop (`P.free`
does guard `i >= p.n`, so that particular case degrades to a no-op rather than a crash).
**[read-only — I did not audit all 42 upgrades' `onHit` for a `killP` call.]**

**Fix** — re-validate before the free, or snapshot `P.gen[i]` across the emit.

---

## P2-10 — `killManaSpent` / `killManaWindow` survive `NA.Player.reset()`

`src/09_player.js:182-195` resets `mana`, `hp`, `dashCd`, … but not `killManaSpent` or
`killManaWindow` (declared at `:158`). A run that ends with `killManaSpent === MANA_KILL_CAP`
starts the next run with kill-mana suppressed until the 1-second window rolls over
(`update`, `:401-402`). Trivially reproducible by dying at a moment of heavy killing and
restarting; the symptom is one second of "kills give no mana" at the top of the new run.

**Fix** — add `Pl.killManaSpent = 0; Pl.killManaWindow = 0;` to `Pl.reset`.

---

## P2-11 — `Arena.setRadius(r)` with no duration never marks a crush band

`src/06_arena.js:63-68`

```js
setRadius: function (r, sec) {
  r = M.clamp(r, C.ARENA_MIN_R, C.ARENA_R * 1.4);
  A._rFrom = A.radius; A._rTo = r; A._rDur = sec || 0; A._rT = 0;
  if (!sec) A.radius = r;                 // <-- A.radius is now r
  if (r < A.radius) A._markCrush(0, SEG, 2);   // <-- always false in that branch
}
```
On the instant path `A.radius` has already been assigned `r`, so `r < A.radius` is never true and
the red crush warning is skipped. Only affects the instant-shrink call sites, but those are the
ones where a warning matters most (the player has zero frames to react).

**Fix** — test before the assignment:
```js
var shrink = r < A.radius;
A._rFrom = A.radius; A._rTo = r; A._rDur = sec || 0; A._rT = 0;
if (!sec) A.radius = r;
if (shrink) A._markCrush(0, SEG, 2);
```

---

## P2-12 — `Bullets.render()` samples the reveal field at the arena centre

`src/08_bullets.js:302`

```js
var reveal = NA.Events ? NA.Events.revealAlpha(0, 0) : 0;
```
Every `FLAG.INVISIBLE` enemy bullet is faded by the reveal value **at world (0,0)**, not at its
own position. With a positional reveal event (a sweeping Pulsar, a local flare) invisible bullets
either all appear or all stay hidden depending on whether the *centre* happens to be lit, which
is the wrong answer everywhere except the centre. Cheap fix: sample per bullet, or at least skip
the whole loop branch when `revealAlpha` is uniform.

---

## P2-13 — `Bosses.damage()` reads `b.def.phases[b.phase]` with `b.phase === -1` on unusual paths

`src/13_bosses.js:140-162`. `damage()` guards on `state !== 'fight'`, and `state` only becomes
`'fight'` after `nextPhase()` has set `phase = 0`, so the normal path is safe. But
`hitOne`/`B.damage` are public and a fight (or a dev/`?boss=` jump) that sets `b.state = 'fight'`
directly leaves `phase = -1`; `b.def.phases[-1]` is `undefined` (tolerated by the `ph &&` guards)
but `base = (len - 1 - (-1)) * phaseHp` is one whole phase **above** `maxHp`, so
`if (b.hp < floor) b.hp = floor` would *raise* HP above max and the boss becomes unkillable.
**[read-only — not reachable through any shipped code path I found; worth a one-line guard.]**

**Fix** — `if (b.phase < 0) return;` at the top of `damage()`.

---

## P2-14 — `killAll(false)` can leave spawned children alive

`src/10_enemies.js:113-115`
```js
killAll: function (silent) {
  for (var i = P.n - 1; i >= 0; i--) { if (silent) P.free(i); else En.kill(i, false); }
}
```
The descending loop is correct for removal, but `En.kill` runs `onDeath`, and a splitter/hive
`onDeath` **appends** children at indices `>= i` that the descending loop has already passed —
so they survive the "kill all". Every foundation call site currently passes `silent = true`
(`Game.toBoss`, `Game.victory`), so this is latent; a boss or event calling `killAll(false)` to
clear the room would leave a residue that can block the wave-end condition
(`W.spawned >= W.budget && alive === 0`, `src/14_waves.js:1200`).

**Fix** — loop until empty: `while (P.n) { if (silent) P.free(P.n - 1); else En.kill(P.n - 1, false); }`
with an iteration budget.

---

## P2-15 — `Draft` opens with `active = true` before the empty check, and emits `draftOpen` regardless

`src/15_ui.js:432-434`
```js
Draft.active = true;
if (NA.Game) NA.Game.emit('draftOpen', Draft.offers);
if (!Draft.offers.length) { Draft.active = false; return false; }
```
`draftOpen` fires with an empty offer list before the caller learns the draft did not open. Any
listener that assumes "draftOpen means a draft is on screen" (HUD, audio ducking, tutorial hints)
sees a phantom draft. Cheap fix: move the emptiness check above the emit.

---

# Things I checked and found **sound**

Worth recording so the next pass does not re-tread them:

- **`NA.Pool` swap-remove** (`05_pools.js`) — `free()` bounds-checks `i >= p.n`, so a stale index
  from a torn-down pool degrades to a no-op rather than corrupting memory. `gen[]` exists and is
  bumped on `alloc`, which is exactly what the fixes above need.
- **Deferred blast queue** (`10_enemies.js:150-186`) — the `_busy` / `_qn` design is correct and
  bounded (8 passes × 64 entries), and `drainBlasts` is re-run at the top of `Enemies.update`
  so nothing survives a frame.
- **Wave-end convergence** — the two documented soft-lock fixes are in and correct: the
  `_streamPick` cap fallthrough (`14_waves.js:1066-1082`) and the 6-second `_noSpawnT` budget
  bleed (`14_waves.js:1179-1190`). Reaper allies self-terminate when `foes === 0`
  (`11b_upgrades_b.js:455-462`), so they cannot block `alive === 0`.
- **Phase-floor deadlock** — the `base + 1` comparison in `Bosses.damage` plus the timer-driven
  advance in `stepBoss` (`13_bosses.js:317-320`) together close the Congregation 401/600 hole.
- **Fourth-wall teardown** — `fourthWallSweep()` runs from both `clear()` and `resetRun()`, and
  `--domcheck` reported `nodes 0 / filter "" / overflowY "hidden" / scrollY 0` after a
  36 000-frame run. Restarting mid-fight on all 29 bosses raised no exception.
- **Zero-length vectors** — every `Math.sqrt(...)` in the hot paths I read is followed by `|| 1`,
  and `Arena.depth` / `softWall` / `clampHard` / `clampToArena` all early-out under `1e-4`. I
  found no NaN source.
- **`timeScale = 0`** — `Time.begin` produces `steps = 0` and the menus run off `NA.UI.tick(realDt)`
  on the wall clock, so a 0.05× draft and a 0× pause both stay responsive. Pause/resume spam
  (every 37 frames, all bosses) raised no exception.
