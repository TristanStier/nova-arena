# NOVA ARENA — Adversarial Review: DESIGN FIDELITY vs GAME_PLAN.md

Reviewer axis: does the built game match the design spec and the owner's hard rules?
Method: registry introspection of the built file (all 42 upgrades / 41 enemy ids / 30 bosses / 18 events / 30 waves / endless generator dumped from a live boot), full reads of the upgrade, boss and event modules, targeted greps of the hard rules, and screenshots of waves 5 / 15 / 25 and the draft.
Read-only: nothing under `src/` or `tools/` was modified. The siren boss (`13d_bosses_3.js`) and `98_bot.js` were excluded per instruction.

**Headline: this is a remarkably faithful build.** Every count the plan names is exactly right — 42 upgrades × 3 tiers, 41 enemy ids, 30 waves with the plan's *exact* per-wave budgets and retirement schedule, 30 bosses, 18 events, 5 biomes. The hard rules on regression, text, and enemy scaling are clean. The deviations are concentrated in three places: **the ship has become an unreadable white blob in combat**, **six event rules are wired to nothing**, and **a handful of upgrade tiers are dead, mis-scoped or secret stat bumps**.

---

## 1. Compliance table

| # | Section | Verdict | Notes |
|---|---|---|---|
| 1 | 42 upgrades × 3 tiers, new mechanic per tier, ship visual | **PASS with defects** | All 42 defined, all 3-tier, all assigned a slot, all stack via `NA.Ship.setSlot`. 101/126 tiers faithful. 2 tiers execute nothing (feedbackLoop T1). 6 tiers are stat bumps (faithful to the plan's own §6 wording — the plan contradicts §5.2). 1 undocumented code-side stat bump (mines cap). 4 tiers have no visual beyond the automatic slot bump. |
| 2 | 39 enemies, retire schedule, no HP/speed scaling | **PASS — exemplary** | All 41 canonical ids registered. Retirements land exactly on waves 7/10/12/17/23/24 as scripted. **Zero `hp *=` / `speed *=` by wave anywhere in `src/`.** `KNOBS` (`14_waves.js:45`) is a clean single dial board; difficulty is budget + roster + caps only. Shape/color/size conventions match §7 type-for-type. |
| 3 | 30 waves + 30 bosses, finale, endless | **PASS with gaps** | All 30 waves scripted with the plan's exact budgets (15/24/35/…/1300) and bosses in the right slots. All 30 bosses defined, 27 of 29 checked are rule-faithful. Finale has the three correct recalls and §8.1's ending. Endless implements duos@34, trios@40, big-every-3, arena/lighting spacing. **Gap: wave 31's boss is random, not the Encore (§8.1).** `supernova` (wave 18) has only 2 phases where §9 requires 3 from wave 13. |
| 4 | **No regressive mechanics (HARD RULE)** | **PASS — clean** | Exhaustive grep of all 25 source files: nothing removes, disables, downgrades or locks an upgrade, tier, slot, `manaMax` or `maxHp`. Boss files clean. Enemy/event files clean. Every stat touch is restored (`metronome` freeze, `probability` die faces). Gambler's temporary grants revert with a correct guard (`11b:2004,2008`) so a mid-wave draft can never be clawed back. Schism's `mana = 0` and Siphon's drain are current-mana only. Encore and Probability *add* cards. Lurker's HUD crack is cosmetic. |
| 5 | Mana is the only ability system; no pickups | **PASS** | One bar, 100 max. All four sources present and correctly tuned (`MANA_TRICKLE 6`, `MANA_GRAZE 3`, `MANA_KILL 2` capped at `MANA_KILL_CAP 20`/s, idle halving after 4 s). Zero pickup/powerup/loot entities. The only "pickup" in the codebase is the Angler's *fake* bait, which is the plan's own joke. |
| 6 | Readability (§7/§10) | **FAIL on white; PASS on shape/color/telegraph** | Telegraph convention is centralised and correct (`10_enemies.js:290-345`: shared 2 Hz breathe, orange `1,0.541,0` → red `1,0.18,0.302` at lock, drawn to `L.VEIL` above everything, with `telegraph`/`lock` SFX cues). Layer order matches §11 exactly and `L.ENEMIES` is non-additive. **But `L.PLAYER` is additive** and the ship blows out to pure white (see F1). Several non-lethal whites. |
| 7 | Zero text in UI | **PASS — clean** | Zero `fillText`/`strokeText` anywhere in `src/`, including `04_icons.js`. The five `textContent` hits are: the `?debug=1` error box (`99_boot.js:31`, `13d:57`), the debug overlay (`99_boot.js:209`), a `<style>` injection for fourth-wall CSS (`15_ui.js:1814`), and a DOM clear (`15_ui.js:2127`). All permitted. |
| 8 | 18 events gameplay-relevant; biomes match acts | **FAIL** | All 18 defined, all with telegraph/active/decay. **Six rules are decoration** — nothing outside `12_events.js` reads `damageMulAt`, `hiddenAt`, `onBeatWindow`, `domesDown`, `inverted`. Biome→act mapping is correct (`14_waves.js:156,174`: 1-6/7-12/13-18/19-24/25-30 → ember/pulsar/storm/horizon/core, endless=core). Two act-list gaps. |
| 9 | Camera | **PASS with a design concern** | Follows the ship with a 25 % aim lookahead + velocity lead, clamped (`02_render.js:262`); critically damped, never crosses the membrane. `fitArena()` for the between-wave overview ✓. Combat 1.0 → 0.95 above 60 enemies (plan says 0.92 — trivial), boss intro ×1.08 ✓, last kill ×1.15 ✓. Concern: at zoom 1 the view is ~1600 px of a 2800-diameter arena, so the rim — and therefore §12.2's per-enemy rim dots — is off-screen most of the fight (see F5). |

**Clutter verdict from the screenshots:** the arena reads well — enemy silhouettes, colors and the membrane are all legible at wave 15 and 25, and the draft screen is genuinely beautiful and completely wordless. The *only* thing that is cluttered is the ship itself, which is the one thing that must never be.

---

## 2. Ranked findings

Severity key: **[HARD]** violates an owner's hard rule · **[SPEC]** materially weaker than / different from the plan · **[MINOR]** small gap.

### F1 — [HARD] The ship is a pure-white blob: `L.PLAYER` is additively blended
`src/02_render.js:345` — `LAYER_ADD = [0,1,1,1,0,0,1,1,1,1,0,0]`, index 7 = `PLAYER` = additive.
GAME_PLAN §10.1: *"Additive blending is used for bullets and particles only; enemies and the ship draw normally on top so they never wash into white mush."* §10.1 also: *"only three things are ever bright white: your core, your bullets, and the thing about to kill you."*
Every upgrade's `render()` draws its ornament into `L.PLAYER` — Blast's nose cap and ring tattoos and soft ring (`11_upgrades.js:1334,1345,1355`), Vent's ring (`11b:770`), Ghost's aura, Overcharge's halo, Hull Plating's plates, Gambler's jitter sprite, and ~30 more. Additively summed, a mid-game build saturates to white within ~20 px of the ship. In `tools/out/wave5.png` (three upgrades) the ship is already an unreadable white disc; in `wave25.png` it is a white starburst. The plan's central identity — *"a sharp hollow triangle with a rear notch and a single white-hot core dot"*, with the core as "the brightest pixel near the ship" — is destroyed, and the reader loses the HP arc, the mana arc and the whole §6.2 build-on-the-ship UI at exactly the moment it matters.
**Fix:** set `LAYER_ADD[7] = 0` so the ship draws normally per §10.1, and introduce a brightness cap for slot ornaments (§6.2 says the slots have "fixed z-order and brightness caps"). If a glow bloom around the ship is wanted, give it its own additive layer *below* `PLAYER` with a hard alpha budget, and keep only the core dot at `1,1,1`.

### F2 — [HARD] `feedbackLoop` T1 does nothing at all — both halves are dead code
`src/11b_upgrades_b.js:1917` — `apply: function (p) { p.grazeMul = 2; }` writes `NA.Player.grazeMul`, but `NA.Upgrades.reapply()` finishes with `src/11_upgrades.js:230` — `NA.Player.grazeMul = s.grazeMul;` — and `s.grazeMul` derives from `mods.grazeMul`, which stays 1. Every reapply (i.e. every draft pick, including taking Feedback Loop) resets it. `08_bullets.js:291` reads `pl.grazeMul`, so the graze stays at +3.
`src/11b_upgrades_b.js:617,686` — the "+30 % enemy fire rate" downside is published as `modsB.enemyFireRateB` / `U.enemyFireRateMul()` and **nothing outside `11b` ever reads either** (verified by grep across all 25 files); the only enemy fire-period site, `10c_enemies_cde.js:882`, uses `NA.Player.stats.fireRate`.
A Wildcard whose upside *and* whose failure mode are both absent is a dead draft pick — §12.8 forbids dead picks explicitly.
**Fix:** `apply: function () { U.mods.grazeMul *= 2; }` (folded in at `11_upgrades.js:223`, survives line 230). For the downside, divide every enemy shoot cooldown by `NA.Upgrades.enemyFireRateMul()` in `10_enemies.js`'s shared fire helper.

### F3 — [HARD] Six of the eighteen background events are pure decoration
GAME_PLAN §10.3 and pillar 8: *"The background is not decoration… The sky is an information source."* `NA.Events.damageMulAt` (`12_events.js:362`), `hiddenAt` (`:398`), `onBeatWindow` (`:408`), `domesDown` (`:987`, `:1093`) and `inverted` (`:1802`) have **zero call sites outside `12_events.js`**. Dead rules:
- **starShadow** — entirely decorative; "inside the shadow enemies can't see you" never happens.
- **resonancePulse** — on-beat +25 % never applies.
- **ionStorm** — "enemies that now look like you take double damage" never applies; only the hue rotates.
- **pulsarSweep** — "your bullets 1.5×" and "domes down" both dead; only the reveal works.
- **eclipse** — "domes drop" dead (mana ×2 and the reveal do work).
- **phaseFog** — `reveal: () => 0` (`:1317`) is a no-op because `revealAlpha` takes a **max**, so the fog never conceals anything.
**Fix:** (a) multiply `NA.Events.damageMulAt(x,y)` into the damage at `08_bullets.js:204` and `:184`; (b) add a symmetric `Ev.concealAt()` and fold it into `NA.Enemies.revealOf` (`10_enemies.js:341`), plus gate enemy target acquisition on `hiddenAt`; (c) early-out on `NA.Events.domesDown` inside `NA.Enemies.shielded` (`10_enemies.js:277`); (d) stamp the on-beat multiplier at bullet *spawn* time in `09_player.js`, not at hit time.

### F4 — [HARD] phaseFog draws over enemies on an additive layer
`src/12_events.js:1337,1349` — the fog lobes and the per-enemy accent pips go to `L.VEIL`, which is additive (`02_render.js:345`) and sits above `L.ENEMIES`. "Desaturated fog rolls over half the arena" therefore *brightens* enemies toward white instead of hiding them — it inverts the event's own rule and breaks §10.1's "enemies never additive, never wash into white mush".
**Fix:** move the fog to a non-additive layer beneath the enemies (`L.EBULLETS`), or draw it as a dark subtractive tint. Keep only the accent-eye pip on `VEIL`.

### F5 — [SPEC] The combat camera is too tight for the plan's HUD to work
`src/16_game.js:504` — `want = NA.Enemies.n > 60 ? 0.95 : 1`, against `VIEW_W ≈ 1600` and `ARENA_R 1400`. The view covers roughly 30 % of the arena's width, so the membrane is off-screen whenever the ship is near the middle. §12.2 makes the rim the primary wave HUD — *"each living enemy is a faint dot at its bearing (doubling as an off-screen indicator), a thin ring depletes as the spawn budget is consumed"* — and `15_ui.js:296-313` faithfully draws those dots at `NA.Arena.radius + 18`, i.e. off-screen most of the fight. `tools/out/wave25.png` shows 134 living enemies with about six on screen and no rim, no budget ring, no bearing dots. The player loses all wave-wide awareness, and the "over the top" spectacle the plan promises is cropped out of frame.
**Fix:** either draw the rim HUD in screen space (project each enemy's bearing onto a screen-space ring, the way §12.2's "off-screen indicator" framing implies), or take the plan's 0.92 literally and push combat zoom further out as enemy count climbs (e.g. 1.0 → 0.85 across 60→250 enemies).

### F6 — [SPEC] Endless does not open with the Encore
GAME_PLAN §8.1: *"Fly through it: **endless mode**, wave 31, starting with that Encore as its first boss."* `src/14_waves.js:898` takes `endlessBossFor(n)` unconditionally, and `endlessBossFor` (`:799`) has no wave-31 special case — wave 31 draws at random from the whole pool. The ending's narrative payoff (the Encore tears the ending open, then you fight it) is lost.
**Fix:** in `endlessBossFor`, `if (w === 31) { bossMemo[31] = {ids:['encore'], id:'encore', mods:{}, arena:false, light:false}; hist.push(...); continue; }`.

### F7 — [SPEC] `mines` T2 and T3 secretly raise the cap — an undocumented stat bump
`src/11b_upgrades_b.js:157` — `var cap = T('mines') >= 1 ? 12 + T('mines') * 4 : 12;` → 16 / 20 / 24. §6 #33 fixes the cap at 12 for all three tiers; T2 adds crawling and T3 adds chain fuses. §5.2 is explicit that tiers are never stat bumps, and this one is invisible to the player, so it is the worst kind — power without a read.
**Fix:** `var cap = 12;`.

### F8 — [SPEC] `supernova` (wave 18, an act boss) has only two phases
`src/13c_bosses_2.js:2385` — `phases` has 2 entries (minDuration 14, 16). §9: *"early placements use two phases; waves 13+ unlock the third."* Every other wave-13+ fight has three; the file header concedes the gap. An act-closing boss with one fewer phase reads as the shortest fight of Act III.
**Fix:** add a third phase (`minDuration: 16`, reusing `sunTick(b, dt, 2)`): sunspots that must be shot in sequence while the disc has nearly swallowed the arena, with the flares lashing along filaments.

### F9 — [SPEC] `duoBaitSwitch` (boss 27) has no bank-shot mechanic
`src/13d_bosses_3.js:2013` — §9/§8: *"Bank shots off the prism into the Angler's surface window."* The implementation runs Angler and Reflector unmodified side by side plus a decorative guide line (`:2026-2032`). The Angler still surfaces on enemy-bait contact (`13c:1100`) and takes any direct hit, so nothing requires or rewards banking. The one thing that makes this a *remix* rather than two fights at once is missing.
**Fix:** add a `tweak(b, sb, i)` for the angler component gating its damage window on bullets stamped `OWN.REFLECT` — the Reflector already stamps that in `refBounce` (`13c:1190-1198`).

### F10 — [SPEC] Every duo/reprise intro telegraphs nothing
`src/13d_bosses_3.js:415` — `defineDuo`'s shared intro draws N generic hexagons in the wrapper colour and never invokes the components' own `intro` functions. §9's hard requirement is *"the intro shows the rule before the boss touches you"*, and the five affected fights are the ones that most need it: the Strobe's darkness, the Turntable's spin, the prism, the growing sun, the zero-delay mirror. All five arrive unannounced.
**Fix:** run each resolved component's `def.intro` through the existing `withActive(sb, …)` helper for the first ~60 % of the shared intro, then hand off to the shared eye-ignition punch.

### F11 — [SPEC] `understudy` (boss 10) does not draft, and its death gift is a one-shot
`src/13b_bosses_1.js:2222` — §9: *"it drafts one extra upgrade."* `usTick` (`:2196-2210`) mirrors `NA.Player.stats` exactly and nothing more, so the mirror is strictly weaker than you and the fight's premise ("your build is the enemy, plus one") is flat. `:2247` — the death spectacle's *"you keep an after-image trail"* is a single particle burst, not the run-long cosmetic the plan describes.
**Fix:** pick one id from `NA.Upgrades.list` in `usInit` and apply it to the mirror's shot options — `understudyPerfect` (`13d:1995`) already has `tagsOf` machinery for exactly this. For the trail, register a run-long renderer the way constellation and tide do (`13b:124,140,162`).

### F12 — [SPEC] File-B upgrade damage bypasses the Charged path, killing Voltaic's synergies
`src/11b_upgrades_b.js` lines 72, 139, 473, 820, 918, 948, 1097, 1171, 1337, 1475, 1652, 1672, 1795, 1815 — every damage source in the second upgrade file calls `En.damage()` directly instead of `H.damageEnemy()`, which is the only path that honours Voltaic T3's Charged status (+30 %, `11_upgrades.js:475-480`). So Charged never applies to mines, turrets, turret link lasers, drones, shards, Storm Cloud, allies, Burn Trail, Ghost T2, Impact crits, Overkill carry or Claustrophobia walls. §6's Voltaic synergy list and the §6.1 "Turret Grid" combo (Turret 3 + Voltaic 2) depend on exactly this path.
**Fix:** add an `hDamage()` wrapper beside the existing `hExplode`/`hFire`/`hChain` fallbacks (`11b:77-115`) and swap the 14 call sites.

### F13 — [SPEC] File-B damage numbers do not scale with the build
`src/11b_upgrades_b.js` — `mineBoom` 34 (`:174`), turret expiry 40 (`:398`), ally contact 16 (`:473`), Ghost T2 (`:820`), turret link 90/s (`:1337`), cloud tick 12 (`:1475`), Burn Trail 9/26/16 (`:1644,1672`), Claustrophobia 34/60 (`:1795,1815`), Wake's pulse 16 (`:1019`) are flat constants that never multiply by `Pl.stats.damage`. File A routes everything through `H.playerDamage`. §6.1's "The Dash Tax" (Afterburner 3 / Wake 3 / Mines 3 / Burn Trail 2 / Drone 3 — *"you never fire your primary"*) and "Turret Grid" are whole signature builds that become noise by wave 20.
**Fix:** express each as a multiple of `Pl.stats.damage`; the same file already does this correctly at `:868, 1001, 1044, 1171, 1240, 1304, 1518`.

### F14 — [SPEC] File-B's tap actives all fire on one key press
`src/11b_upgrades_b.js:93-97`, used at `:1193` (shardOrbit T3), `:1288` (turret), `:1539` (gravityWell) — File A builds `H.registerTapActive` / `H.tapClaim` specifically so multiple tap actives round-robin one key (`11_upgrades.js:1628-1682`, whose header promises "the tap actives, round-robin (Pulse, **and B's**)"). File B never registers; `hActive()` returns the raw edge. Owning Turret + Gravity Well + Shard Orbit 3 means one press pays 20 + 35 + 10 mana and casts all three at once, and starves Pulse (which does use `tapClaim`). §3.4's "one bar, deliberate sinks" becomes an accidental 65-mana button.
**Fix:** `H.registerTapActive('turret'|'gravityWell'|'shardOrbit')` at file scope and route `hActive()` through `H.tapClaim(id)`.

### F15 — [SPEC] `overkill` carry and `impact` counters are corrupted by the swap-remove pool
`src/11b_upgrades_b.js:1079,1085-1100` — §6 #28: *"Excess damage carries to **the next enemy the bullet touches**."* The excess is stored in one module-level `okCarry`, so with Buckshot, Gatling, drones or Mirror the carry lands on an unrelated projectile every time.
`src/11b_upgrades_b.js:663-665` — `prevHp[i]` is snapshotted per frame but `NA.Enemies` swap-removes on death, so `prevHp[ctx.ei]` routinely belongs to a different body and the excess is mis-computed.
`src/11b_upgrades_b.js:914-921` — `impact` T1's `impLastEi` is a single last-index against the same pool, so "every 5th hit on the same enemy" fires on the wrong target after any nearby death. T2 already solves this positionally at `:935-940`.
**Fix:** key the carry on the bullet (a `Float32Array(C.MAX_PBULLETS)` cleared on free, as Ricochet documents at `11_upgrades.js:779-784`); compute the excess inside `H.damageEnemy`, which already knows pre-hit HP; reuse T2's positional identity for T1's counter.

### F16 — [SPEC] `shardOrbit` T2's shards are permanent, not temporary
`src/11b_upgrades_b.js:1184-1189`, `:677-682` — §6 #29: *"kills add **temporary** shards up to 8."* `shardAdd()` has no lifetime and `onWaveStart` resets `slN, mkN, mnN, tuN, fpN` but never `shN`. After one busy wave you sit at 8 shards for the rest of the run, which also makes T3's "throw all shards" unconditionally maximal and removes the tempo the mechanic is built on.
**Fix:** give each shard a lifetime decayed in the T1 update (keeping the base 2 immortal), or at minimum `shN = Math.min(shN, 2)` in `onWaveStart`.

### F17 — [SPEC] `railgun` T1 does not replace the primary fire
`src/11_upgrades.js:983-994` — §6 #2: *"**Hold to charge** a piercing line."* The tier reads `NA.Input.isDown('fire')` to build `railCharge` but `NA.Player.fire()` keeps auto-firing on the same button, so holding produces a full stream of ordinary bullets *and* a free rail on release, at no cost. The intended trade — stop shooting to charge — never exists, making Railgun a pure addition rather than a weapon choice.
**Fix:** gate normal fire while `railCharge > 0` (an `H.preFire` hook mirroring `H.preDash`, or set `p.fireCd` in the tier update).

### F18 — [SPEC] Two event schedulers fight; the wave runner wins and silences the other
`src/14_waves.js:1240-1255` vs `src/12_events.js:636-692` — the events module's scheduler stands down whenever a wave carries an `events` list, which is every wave from 3. That makes `BIOMES[].cadence`, the wave-9 eclipse "once" guard (`12_events.js:648`), `strobeMultiplier` (`:675,735`) and "Pulsar Sweep is constant" (`:657`) all unreachable. Consequences: **eclipse is in the Act-II random pool (`14_waves.js:151`) so it can fire repeatedly** where §10.3 says once, and **Act V omits `auroraLanes` (`14_waves.js:154`)** where §10.3 says "(III, V)" and `12_events.js:130` agrees.
**Fix:** one owner of cadence. Have `14_waves.js` call `NA.Events.schedule(w.biome, n)` at wave start and delete the pool-roll in `_eventTick`; move `eclipse` to an explicit wave-9 event beat; add `'auroraLanes'` to `EVENTS[5]`.

### F19 — [MINOR] Telegraphs below the 0.4 s floor
§12.8: *"Every hit has a telegraph of at least 0.4s."*
- `src/10_enemies.js:542` — `SPIT_TELL = 0.3`. (The plan self-conflicts: §11 says ranged eyes brighten 300 ms before firing. Worth reconciling in the doc either way.)
- `src/10_enemies.js:71` — the endless `hasty` boss mutator sets `telegraphScale = 0.7` globally, which pushes every 0.5 s telegraph to 0.35 s. §12.8 has no exception.
- `src/12_events.js:1855-1873` — `riftSpawn` teleports *enemy* bullets, so a lethal round can materialise beside the player with no per-bullet warning; only the rift mouth is telegraphed.
**Fix:** clamp the effective telegraph to `Math.max(0.4, dur * telegraphScale)` inside the three `telegraph*` helpers; raise `SPIT_TELL` to 0.4; flash the rift exit with a 0.4 s `telegraphCircle` before releasing, or restrict the wrap to bullets exiting *away* from the player.

### F20 — [MINOR] Pure white where the plan reserves it
§10.1: only the ship's core, player bullets and the imminent killer are pure white.
- `src/10b_enemies_ab.js:297` — `skitter` is `[1, 1, 1]`. (Every other near-white enemy is correctly off-white: mote `0.92,0.97,1`, splitter `0.96,0.98,1`.)
- `src/12_events.js:1890` — riftSpawn's inner hex, additive on `VEIL` at α0.35; a rift is not lethal.
- `src/12_events.js:1067` — cometPass head dot at α0.8.
- `src/12_events.js:794` — overview spawn dots on the additive `MEMBRANE` layer.
- `src/12_events.js:905` — supernova's arena ripple in white, where §10.2 reserves white ripples for *player* contact.
(Defensible: the supernova star and flash at `:920,944` are the light source; the lightning core at `:1238` is genuinely the thing about to kill you.)
**Fix:** drop skitter to `0.94,0.97,1`; recolour the rift and spawn dots to the biome accent; give the comet head its blue-white `0.85,0.95,1`; make the supernova ripple enemy-orange.

### F21 — [MINOR] Four tiers have no visual of their own
§6.2 names an ornament for every tier; these four flip a flag and rely solely on the automatic `NA.Ship.setSlot` bump: `voltaic` T2 (`11_upgrades.js:1592`, plan: "twin coils"), `pulse` T2 (`:1916`, "purple rim"), `mortar` T2 (`:1205`, "triple magazine"), `arcane` T2 (`:2098`, "glowing runes" — T1 already draws them with no escalation). Borderline: `overcharge` T2, `siphon` T2, `drill` T2 have *a* visual but not the named one.
**Fix:** four short `render` functions — a counter-phased second coil ring; a violet ring at `SHIP_R * 2.2`; three tube lines on the back; a brightened/duplicated rune ring pulsing on each refund.

### F22 — [MINOR] Six tiers are stat bumps — but the plan wrote them that way
`voltaic` T2 (hops 1→5), `ricochet` T3 (+25 % dmg, +1 bounce), `gatling` T3 (trickle ×2), `hullPlating` T3 (fire rate ×1.2, trickle ×2), `berserk` T2 (+50 % fire rate and speed), `glassHull` T3 (+10 % per untouched wave). All six implement §6 exactly, so **the code is faithful and §5.2 is violated by the plan text**. Flagging because the owner's rule is "never a plain stat bump".
**Fix (in `GAME_PLAN.md`, not the source):** give each a mechanic — e.g. Voltaic T2's arc closing a loop back to the first target detonates it; Ricochet T3's comet stops bouncing and homes at six.

### F23 — [MINOR] Smaller fidelity gaps worth one line each
- `src/13b_bosses_1.js:195` — `constellation` always spawns exactly 5 stars; §9 says "5–9". Scale `CN` by phase (5/7/9).
- `src/13d_bosses_3.js:2007` — `understudyPerfect`'s "three extra drafts" are three extra bullets, not three upgrades applied to the mirror.
- `src/13d_bosses_3.js:459` — the duo wrappers for `understudyPerfect` and `congregationRequiem` have `minDuration: 0`. Harmless (components gate themselves at `13d:263`) but not literal.
- `src/13d_bosses_3.js:2496` + `src/15_ui.js:1252` — the §8.1 ending is driven from two places for ~1 s and can draw the ship twice.
- `src/15_ui.js:1436-1443` — §8.1's ring of *every upgrade icon you took* and second ring of *every boss silhouette* are drawn as two plain circles; the per-icon content is deferred.
- `src/11_upgrades.js:1089` — `buckshot` T2's pellets flip to return instantly; the "hang as sparks" beat never appears.
- `src/11b_upgrades_b.js:1016` — `wake` T3's free Pulse is radius 210 (81 %, plan says 60 % = 156) and deals 16 damage, which the base Pulse does not.
- `src/11b_upgrades_b.js:2011-2025` — `gambler` T3 promotes by writing `U.owned` directly, bypassing `take()`, so §6 #42's *"ship glitches into the new form"* never happens on the slot system.
- `src/11b_upgrades_b.js:318,1651` — `burnTrail` keeps a private `burnT` array instead of File A's `H.setBurn`/`H.isBurning`, so Gatling's burn does not feed Burn Trail T3's fire pools and the two burn states render differently.
- `src/08_bullets.js:302` — `revealAlpha(0, 0)` samples the reveal field at the arena centre for all invisible enemy bullets, so positional revealers give a globally wrong answer. Move the call inside the loop.
- `src/14_waves.js:799` — endless boss selection has no "not the same as last wave" rule; waves 31 and 32 can both be the same fight.
- `src/12_events.js:1631` — `timeFracture` slows to 0.6× (40 % slower) where §10.3 says 60 % slower, and `applyFields` (`:451-455`) exempts the player entirely.
- `src/12_events.js:1507-1517` — `gravityRipple` pulls enemies toward the ring front; §10.3 says enemies are *shoved outward*.

---

## 3. What to fix first

1. **F1** — un-additive the player layer. One line, and it restores the game's central visual identity and its entire on-ship HUD.
2. **F2, F3, F4** — wire up the dead rules. Six events and one whole Wildcard currently do nothing; these are the largest gaps between the built game and the plan's *feel*.
3. **F5** — reconcile the camera with §12.2, or the rim HUD the UI already draws is invisible.
4. **F6, F8, F9, F10** — four contained boss/endless fixes that restore named beats.
5. **F12–F17** — the upgrade-integration cluster; individually small, collectively the difference between "42 upgrades" and "§6.1's eight signature combos actually working".

Nothing here touches the owner's regression rule, which the build honours completely and carefully — including in the two places (Gambler's temporary grants, the Probability die) where it would have been easy to get wrong.
