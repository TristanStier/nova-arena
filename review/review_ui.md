# NOVA ARENA — adversarial review: UI / HUD / draft / input / fourth wall

Reviewer axis: `src/15_ui.js`, `src/16_game.js`, `src/00_shell.html`, `src/01_core.js` (Input/Store),
`src/13c_bosses_2.js` (encore, lurker), `src/13d_bosses_3.js` (page/dimmer, fourth-wall calls only).
Read-only. Confirmed with `node tools/build.js` + `node tools/test.js --boss=… --domcheck`.

Harness evidence used below:

```
--boss=dimmer --frames=2500 --domcheck   -> state death; nodes 6, filter "brightness(0.736) saturate(0.802)", overflowY "auto"  (3 errors)
--boss=page   --frames=3000 --domcheck   -> state death; nodes 6, overflowY "auto"                                              (2 errors)
--boss=encore --frames=6000 --domcheck   -> fight completed normally; nodes 0, filter "", overflowY "hidden"                    (OK)
--boss=lurker --frames=2500 --domcheck   -> nodes 0 (no DOM), but HUD stays detached (see #11)
```

---

## 1. CRITICAL — the music engine is never started; the game ships silent apart from SFX

`src/03_audio.js:1171` defines `music.start()`, and `src/12_events.js:242,834`, `src/13b_bosses_1.js:1971`,
`src/15_ui.js:1200` call `music.setMode / setBpm / setIntensity / setLowpass / stinger` — but **nothing in
`src/` ever calls `NA.Audio.music.start()`**:

```
$ grep -rn "music.start" src/   ->   only 03_audio.js:29 (doc comment) and 1171 (the definition)
```

`music.playing` therefore stays `false`, the `setInterval(scheduler, LOOKAHEAD_MS)` note pump never runs, and
every `setMode`/`setIntensity`/`setBpm` is a no-op write. Only one-shot `stinger()`s (which call
`ensureMusicNodes()` themselves) are audible. There is no `NA.Audio.update` either — `src/16_game.js:352`
calls it conditionally and it does not exist — so there is no per-frame hook that could start it lazily.

Repro: open the build, click through the title gate, play a wave — no adaptive layer, no biome mode, no boss
BPM. The death lowpass at `src/16_game.js:525` also does nothing.

Fix: start it on the first user gesture, where the context is legally resumable — inside `Audio.init()` right
after `tryResume()` (`src/03_audio.js:224`), guarded: `if (Audio.enabled) music.start();`. The gesture plumbing
itself is already correct (`03_audio.js:243-249` kicks `init()` on the first
pointerdown/mousedown/touchstart/keydown; `bindLifecycle` suspends/resumes on visibilitychange), so autoplay
policy is handled — the only missing piece is the start call. Add `music.stop()` in `Game.toTitle()` if the
title is meant to be quiet.

## 2. HIGH — nothing sweeps the fourth wall when the player DIES: the death screen inherits a dimmed, scrollable, DOM-littered page

`src/16_game.js:521` (`G.on('playerDeath')`) sets state `death` and nothing else. `NA.Bosses.clear()` — the
only caller of `def.onEnd()` and of `fourthWallSweep()` (`src/13_bosses.js:78-91`) — is reached only from the
`case 'boss':` arm of the step switch (`src/16_game.js:415`), from `newRun()` and from `victory()`. In state
`death` that arm never runs, so `onEnd` never fires and `NA.UI.fourthWall.reset()` is never called.

Confirmed by the harness above: dying to the Dimmer leaves `document.body.style.filter =
"brightness(0.736) saturate(0.802)"` (from `fwDim(d.dim * 0.6)`, `13c_bosses_2.js:2492`), `overflowY:auto`, a
3000 px `.na-tall` spacer and five `.na-obst` divs — for the **entire death screen and the restart gate**.
Same for the Page boss. Worse, `NA.Bosses.update` keeps running in `death` (`16_game.js:358`; the guard is
only `s !== 'draft'`), so the boss keeps firing, keeps calling `scrollPage()` (`13d_bosses_3.js:1818`), and can
finish its whole death sequence with `onEnd` never invoked.

Fix: in the `playerDeath` handler call `NA.Bosses._fourthWallSweep()` (already exported at
`13_bosses.js:77`), or plainly `NA.UI.fourthWall.reset()`. Do **not** call `Bosses.clear()` there — the death
replay still wants the boss on screen — but the wall must be swept.

## 3. HIGH — a click on empty space in the pause menu fires the *keyboard-selected* item (usually "quit run")

`src/15_ui.js:906-915`:

```js
if (NA.Input.pressed('fire') && Menu.hover >= 0) { … }
else if (confirmPressed() && Menu.hover < 0) { …act on MENU[Menu.sel]… }
```

`confirmPressed()` (`15_ui.js:189`) includes `NA.Input.pressed('fire')`, i.e. a left mouse click. And
`Menu.sel` tracks the mouse: `if (h >= 0 && h !== Menu.hover) { … Menu.sel = h; }` (`15_ui.js:899`).

Repro: pause mid-run → hover the last hex (`quit`, index 11) → move the mouse off the ring (hover becomes -1,
sel stays 11) → click anywhere on the frosted background → `NA.Game.toTitle()`; the run is gone, with no
confirmation. With the default `sel = 0` the same stray click resumes the game unexpectedly.

Fix: gate the fallback on a keyboard/gamepad confirm only —
`else if ((NA.Input.pressed('confirm') || padPressed(0)) && Menu.hover < 0)`. Leave mouse activation to the
`hover >= 0` branch.

## 4. HIGH — `FW.tick()` runs while paused and after death: falling wave digits keep damaging the player through the pause menu

`src/15_ui.js:1104` calls `FW.tick(dt)` unconditionally, before the pause dispatch at `1107-1118`, and
`NA.UI.tick()` itself is called outside the `if (!G.paused)` guard in `NA.Game.frame` (`16_game.js:487-491`).
`FW.tick` integrates the falling digits and, at `src/15_ui.js:2086`, calls `NA.Player.damage(1, d.x, d.y)`.

Repro: reach Lurker phase 3 (`13c_bosses_2.js:2893`, `fwCall('dropDigit', …)`) and press Escape while a digit
is in the air → the digit keeps accelerating on real time, lands, shakes the screen, plays `explode` and takes
a heart while the pause ring is up. It can kill you inside the pause menu. The same loop keeps running on the
death screen (damage is gated by `Player.alive`, but trauma, particles and SFX are not).

Fix: skip the digit integration and the damage test when
`NA.Game.paused || NA.Game.state === 'pause' || NA.Game.state === 'death'`, keeping only the DOM timers
(tear/heal/flash/scroll) live. Better still, move the digits into `NA.Game.step` — they are gameplay, and on
real time they also ignore hit-stop and slow-mo, which desyncs them from their own telegraph
(`FW.render` → `telegraphCircle`, `15_ui.js:2100`).

## 5. HIGH — the Encore's bonus draft is driven from `render()`, so it stays live during pause and after death

`src/13c_bosses_2.js:495-505` drives the post-death bonus draft from the boss's **render** callback:

```js
if (d.bonusDraft) { if (NA.Draft.active) { … NA.Draft.update(rdt); NA.Draft.render(); … } }
```

`NA.Game.render()` is called every frame regardless of `G.paused` (`16_game.js:493`).

Repro A (pause): kill the Encore, and while the bonus draft is up press Escape. State → `pause`,
`Menu.update` runs *and* `Draft.update` runs. Both consume the same `pressed('fire')`: one click can nudge a
settings slider and pick a card, and `Upgrades.take()` mutates the build while the game is "paused".

Repro B (death): the draft opens in state `boss` (`13c_bosses_2.js:481`) and the sim keeps running
(`16_game.js:358` only suspends on `s === 'draft'`), so a leftover bullet can kill the player with the draft
open. State becomes `death`, `Draft.active` stays true, and the boss render keeps the cards clickable on top
of the death screen — picking one awards an upgrade to a corpse.

Fix: drive the bonus draft through a real update path — set the game state to `draft` for its duration (the
sim already suspends everything correctly there) — or at minimum wrap the block in
`if (!NA.Game.paused && NA.Game.state !== 'pause' && NA.Game.state !== 'death')` and close the draft from
`NA.Game.on('playerDeath')`.

## 6. HIGH — `Input.holdTime` is never reset on a state change: the overview beat and the 7-second ending are skipped instantly by anyone holding a movement key

`NA.Input.holdTime` accumulates whenever `anyHeld()` is true (`01_core.js:335`), and `anyHeld` returns true
for **any** key in `down`, including W/A/S/D (`01_core.js:349`). Two consumers read it as "the player has just
started holding to skip":

* `src/16_game.js:412` — `case 'overview': if (G.stateT > 1.6 || NA.Input.holdTime > 0.3) G.toBoss();`
* `src/15_ui.js:1211` — `tickEnding: if (NA.Input.holdTime > 0.3 && t < 8.6) UI.endT = 8.6;`

Repro: hold W while the draft closes → the 0.8 s zoom-out + materialise beat (GAME_PLAN §12.4) is skipped on
the very first frame of `overview`, every single time. Hold any key as the wave-30 boss dies → the entire
ending (arena redraw, drift home, chord, gate) jumps straight to `t = 8.6` and is never seen. AGENT_RULES'
"skips are hold-not-tap" is defeated by the fact that the hold predates the state.

Fix: stamp the hold at state entry — in `G.setState` record `G._holdAt = NA.Input.holdTime` and test
`NA.Input.holdTime - G._holdAt > 0.3`; or simply `NA.Input.holdTime = 0` inside `setState` (nothing reads it
across a transition).

## 7. MEDIUM-HIGH — `Input._keyFire` does not exist: releasing the left mouse button cancels fire even while Space is held

`src/01_core.js:308`:

```js
if (e.button === 0) { self.mouse.left = false; self.down.fire = self.down.fire && !!self._keyFire; }
```

`_keyFire` is never assigned anywhere (`grep -rn "_keyFire" src/` returns this line only), so it is
permanently `undefined` and the expression always evaluates to `false`.

Repro: hold Space to fire, tap and release LMB → the ship stops firing until Space is released and pressed
again. Every mixed keyboard+mouse player hits this.

Fix: track the two sources separately — set `self._keyFire = true/false` in the `keydown`/`keyup` handlers
when `KEYMAP[e.code] === 'fire'` (`01_core.js:294,299`) and keep the mouseup line as written; or drop the
`down.fire` bookkeeping entirely and make `isDown('fire')` an OR of `mouse.left`, the Space flag and pad
button 7.

## 8. MEDIUM-HIGH — a mouse button released outside the window stays stuck down (endless fire / endless dash)

Listeners are bound to `window` (`99_boot.js` calls `NA.Input.init(window)`; handlers at `01_core.js:299-312`)
with no pointer capture and no `pointerup` / `mouseleave` / `pointercancel` fallback. A `mouseup` delivered to
browser chrome (tab strip, scrollbar, a window that does not steal focus) never reaches the page.

Repro: press and hold LMB on the canvas, drag the cursor onto the browser tab bar, release → `mouse.left`
stays `true`, `down.fire` stays `true`, the ship fires forever. A right-drag-out does the same for `dash`
(right-click feeds `down.dash`, `01_core.js:302`) and drains mana continuously. The `blur` handler
(`01_core.js:298`) only helps when focus is genuinely lost.

Fix: switch to Pointer Events with `setPointerCapture(e.pointerId)` on pointerdown, or add
`window.addEventListener('pointerup', clear)` plus `document.addEventListener('mouseleave', clearButtons)` and
`pointercancel`. The `mouseleave` handler alone is the one-line version.

## 9. MEDIUM — pausing during any slow-mo ramp pins the time scale at the mid-ramp value forever

`src/16_game.js:146` captures only the scalar `G._pauseScale = NA.Time.timeScale`, and `resume()`
(`16_game.js:157`) restores it via `NA.Time.setTimeScale(scale)` — the no-`ms` branch, which sets
`_tsTarget = s; _tsDur = 0` (`01_core.js:196`) and thereby **destroys the in-flight ramp** created by
`Time.slowmo(scale, ms)` (`01_core.js:200`).

Repro: trigger a boss beat that calls `NA.Time.slowmo(0.35, 700)` (e.g. `13c_bosses_2.js:345`), press Escape
~0.2 s in, resume. `timeScale` is now frozen at ~0.6 and never ramps back; the rest of the fight runs at 60 %
speed until something else calls `setTimeScale` (boss death, `16_game.js:422`). Audio pitch is dragged along
with it via `Audio.setTimeScale`.

Fix: snapshot and restore the whole ramp — `_tsFrom / _tsTarget / _tsDur / _tsTimer` — in `pause()`/`resume()`,
or have `resume()` re-issue `NA.Time.slowmo(savedScale, remainingMs)` when a ramp was in flight.

## 10. MEDIUM — `_victoryEmitted` / `_victoryFromBoss` survive `newRun()`, so a second victory in the same session is broken

`G.newRun()` (`src/16_game.js:67-98`) clears `paused`, `endless`, `newRecord`, `picks`, `bossesBeaten`,
`replay*` and `nextDraftCards` — but not `G._victoryEmitted`, `G._victoryFromBoss` or `G.victoryPending`.

On the *second* wave-30 clear of a page session (win → title → play again → win, or win → endless → die →
restart → win):

* `src/16_game.js:172` — `if (!G._victoryEmitted) { … G.emit('victory', …) }`: the `victory` event is never
  emitted again, so every listener registered on it is silently skipped.
* `src/15_ui.js:2154` — `UI.startEnding(!!G._victoryFromBoss)`: with the stale `true` the ending starts at
  `endT = 1.8, endPhase = 1`, skipping `FW.pageFlash(260)`, `FX.flash` and `FX.darkness`
  (`15_ui.js:1194-1198`). The second ending is visibly truncated even when the run did not end on the
  Singularity's own spectacle.

Fix: add `G._victoryEmitted = false; G._victoryFromBoss = false; G.victoryPending = false;` to `newRun()`.

## 11. MEDIUM — the HUD stays detached after death: the 30-pip wave cluster renders at a drifting off-arena position on the death screen

`FW.hudDetach` (`15_ui.js:2012`) is undone only by `hudAttach` from a boss `onDeath`/`onEnd`
(`13c_bosses_2.js:472,488,2764,2785`) or by `UI.reset()` / `FW.reset()` — none of which run on player death
(see #2). `HUD.showPips()` explicitly includes `'death'` (`15_ui.js:237`) and the cluster is anchored to the
detached element: `src/15_ui.js:318`, `HUD.renderPips(wEl.x, wEl.y, 1)`. The endless wave counter on the 2D
overlay uses the same rect (`15_ui.js:1539-1543`).

Repro: reach Lurker phase 3 (all four rects detached and drifting with the `vx/vy` set at `15_ui.js:2016`),
then die. The wave-pip readout — the one thing the wordless death screen uses to tell you how far you got —
sits wherever the boss left it, drifting off the arena, for the whole screen.

Fix: reattach every HUD element in `G.on('playerDeath')` (`16_game.js:521`) — a loop over
`NA.UI.fourthWall.hudRects()` clearing `detached`, or just the sweep from #2, which already does it
(`15_ui.js:2126`). Also add `hudEls[i].detached` to the `dirty` probe in `fourthWallSweep`
(`13_bosses.js:400`), which currently ignores detachment entirely, so `Bosses.clear()` after a mid-fight
teardown does not reattach.

## 12. MEDIUM — the 2D overlay freezes in non-"live" states, so the endless wave number sticks at a stale screen position

`src/15_ui.js:1514-1520`:

```js
var live = (s === 'draft' || s === 'pause' || s === 'title' || s === 'death' || s === 'ending');
…
if (!UI.ovDirty) { if (!live && FW.digitN === 0) return; if (UI.ovT < 1 / 30) return; }
```

The early `return` skips the `clearRect`, so the previous frame's pixels persist. The overlay signature
(`15_ui.js:1509-1513`) contains state, canvas size, draft offers, hovers, palette and digit count — but **not**
the camera, the arena centre or the wave number. Everything the overlay draws through `w2s()` therefore
freezes in place whenever the state is `wave` / `boss` / `lastkill` / `sweep` / `overview`.

Repro (endless, wave > 30): the gold wave number at `15_ui.js:1539` is drawn once at a state change and then
stays pinned to those pixels through the whole `lastkill → sweep → overview` camera pull-out, sliding off its
rim anchor.

Fix: either add a quantised camera signature
(`(NA.Cam.x|0) + ',' + (NA.Cam.y|0) + ',' + NA.Cam.zoom.toFixed(2)`) to `sig`, or extend `live` with
`(HUD.showPips() && NA.Game.wave > 30) || UI.buildStripT > 0`.

## 13. MEDIUM — on the title screen, any click in the bottom 20 % of the window opens the settings menu

`src/15_ui.js:1126-1133`:

```js
var near = NA.Input.mouse.y > NA.R.h * 0.80 ? 1 : 0;
…
if (UI.settingsPeek > 0.6 && NA.Input.pressed('fire')) {
  var u = us(), y = NA.R.h - 46 * u;
  if (Math.abs(NA.Input.mouse.y - y) < 34 * u) { NA.Game.pause(); return; }
}
```

There is **no x-coordinate test at all** — the hit region is a full-width band while the settings icons occupy
a small cluster. On the title a left click is also the "dash toward the gate" input
(`UI._enter(…, autoDash = true)`, `15_ui.js:1050`), so a player clicking low on the screen to lunge at the
start gate gets the pause ring instead.

Fix: hit-test the real icon rects. `drawTitleOverlay` already lays them out; cache their centres the way
`Menu._pos` does and require `Math.abs(mouse.x - icon.x) < 26 * u` as well.

## 14. MEDIUM — the gamepad d-pad navigates menus but cannot move the ship

`NA.Input.axis()` (`src/01_core.js:360-374`) reads only `gp.axes[0]` / `gp.axes[1]`. `isDown()`
(`01_core.js:337-346`) maps pad buttons for `fire` / `dash` / `active` / `pause` and returns `false` for
everything else, so `isDown('up'|'down'|'left'|'right')` is keyboard-only. Menus work because `navAxis()`
reads `padNow[12..15]` directly (`15_ui.js:171-179`), which makes the inconsistency worse: the d-pad drives the
draft and the pause ring, then does nothing in the arena.

Repro: a d-pad/hat-only pad (many arcade sticks and retro controllers report the d-pad as buttons 12–15, not
axes) can start the game, pick cards and change settings, but cannot move.

Fix: add the four d-pad buttons to `axis()` (guarding `gp.buttons.length > 15`):

```js
var b = gp.buttons;
if (b[14] && b[14].pressed) x -= 1;  if (b[15] && b[15].pressed) x += 1;
if (b[12] && b[12].pressed) y -= 1;  if (b[13] && b[13].pressed) y += 1;
```

## 15. MEDIUM-LOW — `tearDraft()` / `healDraft()` promises are dropped, not resolved, on reset — and a second `tearDraft()` orphans the first

`src/15_ui.js:1852-1885` stores a single `FW._tearRes` / `FW._healRes`; `FW.reset()` (`15_ui.js:2116`) does
`FW._tearRes = FW._healRes = null;` **without calling them**. AGENT_RULES §9 advertises these as promises and
`13c_bosses_2.js:398` consumes one: `res.then(function () { b.data.torn = 1; })`.

Repro: start the Encore gag and die (or restart, or `?boss=` jump) inside the 0.9 s tear window. The promise
never settles and the `then` continuation is retained forever. Any future boss written as
`await FW.tearDraft(); …cleanup…` would strand its cleanup permanently — exactly the failure §9 exists to
prevent. Calling `tearDraft()` twice does the same to the first promise.

Fix: settle before clearing —

```js
if (FW._tearRes) { FW._tearRes(false); FW._tearRes = null; }
if (FW._healRes) { FW._healRes(false); FW._healRes = null; }
```

in `reset()`, and settle any outstanding promise at the top of `tearDraft` / `healDraft`. Resolving with
`false` lets callers distinguish "completed" from "torn down".

---

## Verified good (checked, no action needed)

* **Store under blocked storage** — every `localStorage` touch is inside `try/catch` (`01_core.js:244-256`)
  and there is no other storage use anywhere in `src/`. Private mode / blocked cookies cannot throw.
* **Draft double-pick / reroll / skip spam** — `pick`, `skip` and `reroll` all bail on `!Draft.active`, and
  every input branch in `Draft.update` (`15_ui.js:552-570`) `return`s after acting, so a frame can never take
  two actions. `reroll` is single-use via `Draft.rerolled` and pays through `Player.spend`.
* **Zero-valid-card draft** — `Draft.open` returns `false` before setting the time scale (`15_ui.js:433-436`)
  and `case 'sweep'` falls through to `G.toOverview()` (`16_game.js:404`). No soft-lock. (It does emit
  `draftOpen` with an empty array one line early — cosmetic.)
* **Draft while dead** — unreachable through the normal flow: `Player` and `Bullets` do not update in state
  `draft` (`16_game.js:361`), and a death during `lastkill`/`sweep` diverts the switch. Only the Encore path
  (#5) breaks it.
* **Clicking during a transition** — the draft opens inside the sim step, which runs *after* `UI.tick`, and
  `pressedSet` is cleared in `Input.endFrame`; a click that clears the wave cannot fall through into a pick.
* **DPR / resize** — `R.resize` is bound at init (`02_render.js:481`), clamps DPR to 2, resizes both canvases
  and the GL targets; the overlay re-applies `setTransform(dpr, …)` per redraw and `NA.R.w+'x'+NA.R.h` is in
  the overlay signature, so a resize forces a repaint. Fourth-wall `.na-obst` / `.na-crack` divs are px-pinned
  at creation and do not reflow, but their cached `_r` screen rects are equally stale, so world/DOM stay
  consistent — cosmetic only.
* **Fourth-wall z-order / input blocking** — `#dom` and every injected class carry `pointer-events:none`
  (`00_shell.html:22`, `15_ui.js:1818-1833`); nothing can eat a canvas click after a fight.
* **contextmenu / focus loss** — the right-click menu is suppressed (`01_core.js:313`), `blur` clears the key
  map (`01_core.js:298`), and `visibilitychange` pauses the sim clock (`01_core.js:318-321`) and suspends the
  audio context (`03_audio.js:236-241`). Alt-tab does not strand keys.

## Nits worth one line each

* `NA.Time.real` only advances inside `Time.begin`, which `frame()` skips while `G.paused`
  (`16_game.js:487`). Everything driven by `pulse()` (`15_ui.js:93`) — gate breathing, hover pulses — freezes
  on the pause screen, contradicting the "menus run on real time" contract in the module header.
* No `Digit5` in `KEYMAP` (`01_core.js:269`) while `Draft.count` clamps to 5 (`15_ui.js:428`): a five-card
  draft has no keyboard shortcut for the last card.
* No touch input at all — `touch-action:none` in the shell and zero touch listeners in `Input.init`. On a
  tablet the title gate can never be entered.
* `Store.load` copies unknown record keys verbatim (`01_core.js:249`), so a corrupt `na.records` can replace
  `records.seen` with a non-object; `UI.markSeen` (`15_ui.js:984`) then indexes it unguarded, while
  `hintMark` (`15_ui.js:95`) does guard. Make `markSeen` defensive.
* `keydown` does `e.code.indexOf('Arrow')` (`01_core.js:296`) — throws if a synthetic event omits `code`.
* `body.na-dim` (`00_shell.html:38`) is dead CSS; `dimPage` only ever *removes* the class.
* `Page.onEnd` calls `scrollPage(0, 1)` (`13d_bosses_3.js:1737`), which scrolls by zero rather than back to
  the top; it works only because `viewportArena(false)` removes the tall spacer and the browser clamps.
