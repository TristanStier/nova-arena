# Rules for every content agent (read before coding)

1. Read, in order: `GAME_PLAN.md` (design), `ENGINEERING_BRIEF.md` (contract), `ARCHITECTURE.md` (the real API reference written by the foundation engineer; it wins over the brief where they differ). Then skim the foundation source you will call (`src/01`–`10`, `16`).
2. **Only write the files you own** (listed in your task). Never use the Write tool on a file you do not own. If you truly need a change in a foundation file, make it a minimal, additive Edit (string replace) and list it in your final report. Other agents are editing other files at the same time.
3. Build with `node tools/build.js`. Check syntax with `node --check src/<file>`. Smoke test with `node tools/smoke.js` (Node only, no browser). The browser harness is `node tools/test.js ...` (it uses Microsoft Edge; **never launch chrome.exe** on this machine). Do not brute-force the browser harness: if it is flaky, rely on smoke.js and `node --check` and move on.
4. Performance is a feature: no allocations inside per-frame loops, typed arrays, squared distances, caps on everything that can multiply. Use the pools and the grid in `NA.Pool`/`NA.Grid`/`NA.Bullets`/`NA.Particles`.
5. Zero text anywhere in the game (tab title and the `?debug=1` overlay excepted). Communicate with shape, color, motion, icons (`NA.Icons`), and sound (`NA.Audio.sfx`).
6. Readability rules from GAME_PLAN §7 and §10: shape = kind, color = urgency, telegraphs orange → red at lock drawn above everything, only ship core / player bullets / imminent killer are pure white, enemies never additive.
7. Nothing regressive: no mechanic may remove, disable, or downgrade a player upgrade. Hard is fine; unfair or depressing is not. Every damage source has a telegraph ≥0.4s.
8. **Canonical ids** (all registries use these exact strings):
   - Enemies: `mote drifter skitter spitter popper moteling lancer charger shade constrictor sentinel mortar bloat sower tetherPair puller hive larva glazier warden wisp splitter eclipse prism siphon rotator necromancer husk doppel chronoform flak wraith crush cathedral herald singularity ouroboros chargerElite echo sunder swarmLord`
   - Bosses: `compactor constellation tide turntable metronome congregation strobe cartographer cadence understudy encore depth angler reflector inverter echo horizon supernova dimmer lurker schism siren probability page understudyPerfect duoLightsCamera duoBaitSwitch congregationRequiem duoHeatDeath singularity`
   - Upgrades: `twinBarrels railgun buckshot mortar gatling blast ricochet drill seeker voltaic overdrive chrono pulse siphon overcharge arcane afterburner phase drift blink hullPlating vent ghost reaper impact wake spendthrift overkill shardOrbit drone turret mirror mines stormCloud gravityWell burnTrail ghostRounds claustrophobia glassHull berserk feedbackLoop gambler`
   - Background events: `supernova pulsarSweep cometPass eclipse nebulaLightning phaseFog auroraLanes starShadow gravityRipple blackHoleBloom timeFracture resonancePulse darkPhase ionStorm riftSpawn meteorShower solarWind flareCascade`
   - Biomes: `ember pulsar storm horizon core` (acts I–V)
   - Ship visual slots: `trail aura halo wings fins hull barrels core orbitals crown`
   - Enemy mutators: `volatile linked phased anchored split haunted shrouded magnetic mirror vampiric bloomed siren`
9. Fourth-wall helper API (implemented by the UI agent in `src/15_ui.js`; bosses call it guarded with `NA.UI.fourthWall && ...`):
   - `NA.UI.fourthWall.tearDraft()` → shows a fake draft panel whose cards ignore clicks, then tears it in two halves (DOM, CSS transforms) and returns a promise/flag when torn; `healDraft()` reverses it and re-enables the real draft with an extra card.
   - `dimPage(amount01)` sets a CSS brightness/saturation filter on the whole page; `dimPage(0)` clears.
   - `viewportArena(on)` makes the canvas fill the browser viewport and exposes DOM element rects via `NA.UI.fourthWall.obstacles()` → array of `{x,y,w,h}` in world coords; `scrollPage(dy, ms)` scrolls a tall page; `pageFlash(ms)` white full-page flash; `pageCrack(progress01)` draws a crack across the page overlay.
   - `hudRects()` → `[{id:'mana'|'hp'|'wave'|'build', x,y,w,h}]` world-space rects of HUD elements for the Lurker; `hudDetach(id)` / `hudAttach(id)` move an element into the arena and back; `dropDigit(x,y)` spawns a falling wave-digit bomb sprite.
10. Report at the end: files and line counts, what is implemented, what is stubbed, every deviation from the plan, and any foundation edits you made.
