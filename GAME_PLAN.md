# NOVA ARENA — Game Design Plan

*A single-HTML-file 2D arena shooter. Thirty hand-built waves, thirty hand-built bosses, one resource, absurd compounding upgrades, gorgeous light that matters. Then endless.*

Working title: **NOVA ARENA** (the game shows no text, so the name only lives in the browser tab).

---

## 0. The Pitch in One Breath

You are a tiny bright dagger in a bounded ring of space. Waves of geometric enemies pour in from the rim. You kill them with movement, aim, and one mana bar. Between waves you draft one upgrade from three, and your ship visibly grows the part you took. Upgrades stack into chain reactions that fill the screen. Enemies never get more HP; they get *weirder*, and the old ones stop coming. After every wave a boss arrives that is a rule, not a stat block. The background is not decoration: a supernova flash is how you see invisible enemies. Wave 30 is a finale that ends the story. After that, the ending is torn open and endless mode begins.

---

## 1. Design Pillars

1. **Curated, not generated.** Waves 1–30 are authored levels with a fixed enemy script, a fixed boss, and a fixed "aha" per wave. Randomness only touches draft offers and spawn jitter. Endless (31+) is the only procedural content.
2. **One resource.** The mana bar is the *only* ability system. No pickups, no inventory, no cooldown grid. Dash costs mana. Every drafted active costs mana. Mana is earned by flying bravely (grazing) and killing.
3. **Enemies scale by novelty and count, never by HP or speed.** A Mote has the same stats on wave 9 as on wave 1, and Motes stop spawning after wave 10. New mechanics arrive, old ones retire, counts explode.
4. **Two skill axes.** (A) Drafting: choosing upgrades that compound. (B) Movement: dash timing, telegraph reading, grazing. Bad players die by wave 4–6. Great players reach 30 and are still sweating.
5. **Hard, but never regressive.** The game never takes an upgrade away, never shrinks your build, never makes you weaker than you were. Difficulty comes from what the enemies *do*. Every death is legible and fair.
6. **Exponentially lethal.** Player HP is 3 hits. Healing is nearly nonexistent. Enemy count grows roughly ×1.28 per wave. Bosses gate DPS with phases that must play out, so even a god build has to *dance*.
7. **Over the top, not cluttered.** Only three things are ever pure white: your ship's core, your bullets, and the thing about to kill you. Everything else lives below 80% brightness. Decorative particles die in under half a second. Enemies always draw above effects.
8. **Light is gameplay.** Every background event has three phases (telegraph, active, decay) and a rule attached. The sky is an information source.
9. **The ship is the UI.** Health, mana, and your build are all visible *on the ship*. Menus contain zero words.
10. **Polish and performance are features.** Thousands of glowing things at a locked 60fps in one HTML file.

---

## 2. Run Structure

```
Title (the arena, empty, your ship idling)
  └─ fly through the gate ─▶ Wave 1
       Wave N:  ingress ▶ body ▶ pressure spike ▶ closer ▶ last kill (slow-mo)
       Draft:   3 cards; hover morphs your ship; click to take
       Overview: camera zooms out; next wave materializes at the rim; BOSS INTRO
       Boss N
       ... ×30
  Wave 30: THE SINGULARITY (finale)
  Ending sequence (text-free)
  └─ the ending is torn open ─▶ ENDLESS (wave 31+, procedural remix)
Death: ship shatters into its upgrade parts ▶ visual summary ▶ gate ▶ instant restart
```

**Acts.** The 30 waves are five acts of six waves. Each act is a **biome**: a new backdrop, palette accent, background-event set, and music mode. Act boundaries are where the roster rotates hardest.

| Act | Waves | Biome | Lesson | Act boss |
|---|---|---|---|---|
| I | 1–6 | Ember Nebula | Learn to move | The Congregation (6) |
| II | 7–12 | Pulsar Field | Learn to read light and telegraphs | The Depth (12) |
| III | 13–18 | Storm Cloud | Learn to prioritize | The Supernova (18) |
| IV | 19–24 | Event Horizon | Fight the arena itself | The Page (24) |
| V | 25–30 | The Core | Mayhem, remix, finale | The Singularity (30) |

**Run length target.** Early waves 40–60s, late waves 2–3 minutes plus bosses. A full clear is about 45–60 minutes. Death restarts in under a second.

**Death is permanent.** No checkpoints, no continues. The run is the unit of play.

---

## 3. The Player

### 3.1 The ship
A sharp hollow triangle with a rear notch and a single white-hot core dot. Fast, agile, momentum-light by default. The silhouette core never changes size; upgrades attach *outward* in fixed slots (§6.2).

### 3.2 Controls
| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move | WASD / arrows | Left stick |
| Aim | Mouse (cursor is the reticle) | Right stick with aim-assist cone |
| Fire | Hold left mouse / Space (auto-fire toggle in settings) | RT |
| Dash | Right mouse / Shift | LT / B |
| Active (if drafted) | Middle mouse / E | Y / RB |
| Draft pick | Click / 1-2-3 | A / D-pad |
| Pause | Esc | Start |
| Skip cinematic | Hold any input 0.3s | Hold any input 0.3s |

Taught with zero text: blank keycap shapes pulse under the ship on the title arena until you move; a mouse glyph blinks by the reticle until you fire; the mana arc lights a notch and a dash glyph pulses the first time a projectile is 0.5s from hitting you.

### 3.3 Health
**3 hits.** Health is a thin segmented arc under the ship. On a hit: 60ms hit-stop, white flash, a hull chip flies off, a mercy ring clears enemy bullets nearby, 0.8s invulnerability. At 1 HP: red-tinted hull leaking sparks, slow heartbeat vignette, music low-passed. Bosses never remove more than 1 HP per hit.

Healing exists in exactly two places: skipping a draft (+1 HP, §5.3), and a few boss deaths that gift it.

### 3.4 Mana: the only ability system
One bar, 100 mana, drawn as a cyan arc over the ship. Full mana closes into a halo and pulses gold.

**Sources (all stack):**
- Trickle: 6/s passively.
- **Graze: +3 per enemy bullet that passes within a hair of the hull without hitting.** This is the skill economy. A timid pilot circling the rim dashes four times a wave; a brave pilot threading bullets sits at full mana and never stops casting.
- Kill pulse: +2 per kill, capped at 20/s.
- Idle penalty: trickle halves if you neither deal nor take damage for 4s.

**Sinks:** Dash costs 15 (140px burst, 0.15s invulnerable, five after-images). Every drafted active costs mana instantly or per second. If you can't afford it, it fails with an audible dry click.

**Rule:** every mana upgrade adds a new sink, a new source, or makes spending itself trigger something.

---

## 4. Difficulty Philosophy

- **Count grows exponentially.** Per-wave spawn budget is roughly `12 × 1.28^wave`: ~15 bodies in wave 1, ~200 in wave 12, ~700 in wave 17, thousands by 25 (over the wave). The simultaneous cap rises to ~400 then plateaus for performance; past that, pressure comes from spawn *rate* and enemy *kind*.
- **Every enemy type has a cost.** Wave budgets are spent ~55% filler, ~30% texture (ranged, telegraphing), ~15% problems (support and arena-altering, hard-capped). The filler *role* rotates: Mote → Popper → Larva/Splitter → Husk/Echo/Moteling.
- **Fixed-length fairness.** Charges, lasers, and shell timers never scale with wave.
- **Bosses gate, they don't sponge.** Each boss phase has a minimum duration where the boss floors at 1 HP. A god build still plays the fight; a weak build has time to die.
- **Wave intensity is fixed per wave number.** No rubber-banding.
- **Expected death points:** wave 4–6 (Chargers and Lancers punish standing still), 10–12 (Bloats and domes punish sloppy AoE), 19–21 (darkness and mana drain punish neglect), 25+ (everything).

---

## 5. Drafting: The Core Hook

### 5.1 The offer
After every wave: **3 cards** (4 on waves 6, 12, 18, 24). Each card = icon, tier pips, a live mini-simulation of the effect, and a silhouette of your ship *after* taking it. Hovering morphs your real ship in the arena. Clicking shatters the card into your ship with a transformation animation and a rising chord. No text.

**Offer composition:**
- **Slot 1 is always a tier-up of something you own** (if anything isn't maxed).
- **Slot 2 is weighted by synergy tags.** Every upgrade carries tags (`explode`, `bounce`, `dash`, `spend`, `kill`, `orbital`, `zone`, `pierce`, `mana`). Sixty percent of the time slot 2 comes from the upgrades sharing the most tags with your build.
- **Slot 3 is uniform random**, Wildcards at half weight with a jagged border.
- Never two tiers of one upgrade in an offer, never a maxed upgrade, never three from one family, always at least one offensive option. Mutually exclusive picks (Blink replaces Afterburner) show a swap glyph.

### 5.2 Tiers
Every upgrade goes **Tier 1 → 2 → 3**. Higher tiers are never stat bumps; each adds a new mechanic. There is no rarity; tiers are the rarity.

**Amendment (2026-09-05, design review F22).** Six tiers as written above are plain
stat bumps, so the rule is broken by *this document*, not by the code — the build
implements §6 faithfully in all six cases. Recorded here so the debt is visible and
so nobody "fixes" the source to match a rule the plan itself violates:

| tier | as written (a stat bump) | mechanic it should get |
|---|---|---|
| Voltaic T2 | arc hops 1 → 5 | an arc that closes a loop back to the first target detonates the loop |
| Ricochet T3 | +25% damage, +1 bounce | at six bounces the comet stops bouncing and homes |
| Gatling T3 | mana trickle ×2 at full spin | full spin vents heat: a burst that staggers everything at contact range |
| Hull Plating T3 | fire rate ×1.2, trickle ×2 | while shed, the plate keeps flying — it orbits and body-blocks enemy fire |
| Berserk T2 | +50% fire rate and speed at ≤20 mana | at ≤20 mana each kill refunds the mana it would have cost to keep firing |
| Glass Hull T3 | +10% damage per untouched wave | each untouched wave also adds a shard that absorbs one hit, then shatters |

Until §6 is rewritten, the code stays as it is: changing behaviour to chase this note
would break the compliance the review measured. Rewrite the six §6 entries first, then
implement.

### 5.3 Reroll and skip
- **Reroll:** 40 mana, once per draft. You start the next wave with less dash fuel.
- **Skip:** decline all cards to start the next wave with full mana and **+1 HP**. Skipping twice in a row makes the next wave harder.

### 5.4 Why drafting separates good from bad
Nine Tier-1s at wave 9 is nine mediocre guns. Three Tier-3s is a chain reaction. Wildcards are the ceiling and each has a failure mode a weak pilot can't afford.

---

## 6. The Upgrade Bible (42 upgrades)

Format: **Name** — T1 / T2 / T3. *Ship visual.* Synergies.

### A. Weapons
1. **Twin Barrels** — Two parallel bullets at 75% / barrels alternate and converge at cursor distance / rear-facing pair fires behind you at 50%. *Second barrel; inward-angled barrels with a laser sight; stubby rear guns.* Blast, Ricochet, Wake.
2. **Railgun** — Hold to charge a piercing line / charged shot leaves a lingering rail that damages crossers / full charge fires two rails in a V that pulls enemies between them inward. *Long barrel with charge coil; pulsing rings; tuning-fork barrel.* Overdrive, Voltaic, Gravity Well.
3. **Buckshot** — 5-pellet cone / pellets at max range hang as sparks then fall back toward you / point-blank kills reload an instant free second shot. *Flared muzzle; ember specks; pump-action slide that racks on kill.* Blast, Claustrophobia, Afterburner.
4. **Mortar** — Every 4th shot lobs a shell that explodes at cursor / shell splits into 3 at apex / shells leave a 2s crater that slows enemies and makes them take +40%. *Top tube; triple magazine; ash trail.* Blast, Mines, Seeker.
5. **Gatling** — Fire rate ramps to 3× while holding / at full spin bullets Burn / at full spin mana trickle doubles. *Rotating barrel cluster; red-hot barrels; blue arcs.* Overdrive, Burn Trail, Ghost Rounds.

### B. Projectile Modifiers
6. **Blast** — Bullets explode on hit / explosion kills chain into more explosions (radius −20% per hop, max 4) / explosions push enemies outward and wall or body slams deal impact damage. *Orange nose cap; ring tattoos; pulsing shockwave halo.* Shard Orbit, Voltaic, Buckshot.
7. **Ricochet** — Bounce off walls once / bounce off enemies toward the nearest other enemy / each bounce +25% damage and +1 bounce (max 6, becomes a red comet). *Chrome fin edges; faceted fins; prismatic fins.* Claustrophobia, Blast, Twin Barrels.
8. **Drill** — Pierce 2 / each pierce speeds and elongates the bullet; at 4 pierces it's a mini-rail / pierce-kills carry the corpse as a shield that blocks enemy bullets 0.5s. *Spinning drill nose; spiral grooves; skull and bones.* Railgun, Seeker, Reaper.
9. **Seeker** — Gentle homing / bullets that miss turn around for a second pass / bullets that hit split into 2 seekers at 50%. *Antenna dish; sensor whiskers; radar sweep.* Ghost Rounds, Mortar, Ricochet.
10. **Voltaic** — Every 3rd hit arcs to one neighbor / arcs chain up to 5 with no falloff / struck enemies are Charged (+30% damage taken; dying releases a stun burst). *Tesla coil; twin coils; crawling electricity.* Blast, Storm Cloud, Railgun.

### C. Mana Actives
11. **Overdrive** — Hold: drain 12/s to fire 2× faster / Overdrive bullets are cyan, +30%, refund 1 mana on near-miss / releasing after 2s+ dumps a 360° Nova. *Cyan veins; cyan smoke; charge ring.* Gatling, Spendthrift, Blast.
12. **Chrono** — Hold: world 30%, you 70%, drain 20/s / bullets fired during Chrono freeze and release at full speed when it ends / enemies hit during Chrono are rewound 1s and take the damage again. *Clock decal; glassy hull; ghost after-image.* Overdrive, Seeker, Mines.
13. **Pulse** — 30 mana: shockwave deletes enemy bullets and knocks back / deleted bullets become yours / hold to charge for 2.5× radius that stuns. *Belly ring emitter; purple rim; outer halo.* Feedback Loop, Blast, Spendthrift.
14. **Siphon** — Kills within 100px refund +5 mana / damage taken refunds 2× as mana / at 0 mana you can overspend, your hull pays. *Red vents; pulsing vents; red debt band.* Berserk, Buckshot, Hull Plating.
15. **Overcharge** — Bar overfills to 150 / above 100 bullets are gold, +50% / hitting 150 auto-Discharges a screen-wide lightning storm. *Gold trim; gold spray; crown halo.* Gatling T3, Voltaic, Spendthrift.
16. **Arcane Rounds** — Bullets cost 0.5 mana, +60% / arcane kills refund cost ×3 / arcane bullets fly through walls. *Runed blue hull; glowing runes; holographic wings.* Overdrive, Siphon.

### D. Movement
17. **Afterburner** — Dashing through enemies damages them and keeps momentum / chain: 2nd dash within 0.3s costs 5 and goes 1.5×, 3rd is free / dash also scatters a mercy ring that deletes bullets at the landing point. *Bigger flares; speed-line trail; triple exhaust.* Wake, Buckshot, Drill.
18. **Phase** — Dashing deletes enemy bullets in your path / deleted bullets are stored (20) and re-fired on next shot / dash through walls. *Ghost edges; storage cylinder; see-through purple hull.* Pulse, Claustrophobia, Feedback Loop.
19. **Drift** — Icy momentum, +40% top speed, brake costs 3 mana / sliding sideways leaves a damaging skid trail / wall hits at speed bounce you with i-frames and a shockwave. *Stubby wings, racing stripe; smoke trail; rubber bumpers.* Burn Trail, Ricochet, Afterburner.
20. **Blink** (replaces dash) — Teleport to cursor, 25 mana / leave a decoy that enemies target then explodes / blinking onto an enemy swaps places with it, stunning it for a 3× hit. *Portal wingtips; ghost shadow; third-eye decal.* Wake, Mirror, Blast.

### E. Defense (deliberately few)
21. **Hull Plating** — +1 max HP, −8% speed / when hit, the plate flies off as a heavy projectile and speed returns until it regrows / while shed you have Adrenaline (+20% fire rate, 2× trickle). *Armor plates; bare metal; red-hot hull.* Siphon, Berserk, Blast.
22. **Vent** — At 1 HP, auto-spend all mana on a proportional Pulse (once per wave) / also fires on any hit if mana ≥60 / leaves a 2s vacuum bubble where enemy bullets crawl. *Pressure valves; armed glow; faint sphere.* Pulse, Overcharge, Spendthrift.
23. **Ghost** — Every 8s the next hit is ignored / triggering makes you intangible 1s, damaging what you fly through / a 10-kill streak in 3s recharges it. *Soul wisp; wisp with tail; ring of skulls.* Reaper, Drill, Afterburner.

### F. Chain Reaction Triggers
24. **Reaper** (on kill) — Corpse fires a bullet at the nearest enemy / kills drop souls, each +2% damage this wave (cap 60%), mana spends vacuum them / every 10th kill resurrects the corpse as your ally for 5s. *Scythe fins; green halo; cage of skulls.* Blast, Ghost, Shard Orbit.
25. **Impact** (on hit) — Every 5th hit on the same enemy crits 3× / crits Mark: marked enemies take 5% of all damage you deal anywhere / killing a marked enemy passes the mark to the 2 nearest. *Hammer nose; reticle decals; spinning reticles.* Gatling, Railgun, Voltaic.
26. **Wake** (on dash) — Dash fires a 180° fan of 6 bullets behind you / dash drops a mine at the start point / dash end fires a free Pulse at 60% radius. *Jet nozzles; mine dispenser; nose ring.* Afterburner, Mines, Blink.
27. **Spendthrift** (on mana spend) — Every 25 mana spent fires a heavy homing bolt / every 100 spent grants 1s of 10× trickle / spending while ≤20 mana counts double. *Blue gem; gold setting; cracked gem.* Overdrive, Overcharge, Siphon.
28. **Overkill** — Excess damage carries to the next enemy the bullet touches / 2× overkill bursts the enemy into 3 shrapnel / overkill is banked; at 500 your next shot is a rail worth the bank. *Serrated wings; shrapnel spikes; bank readout.* Railgun, Impact, Blast.

### G. Summons and Orbitals
29. **Shard Orbit** — 2 orbiting crystals / kills add temporary shards up to 8 / throw all shards as piercing boomerangs for 10 mana. *Pink crystals; glittering ring; crystal spears.* Blast, Voltaic, Reaper.
30. **Drone** — A wingman fires a weak copy of your primary / inherits your projectile modifiers / a second drone; drones dash when you dash. *Wingman orb; painted drone; two finned drones.* Wake, Seeker.
31. **Turret** — Drop a 10s turret for 20 mana / turrets link with damaging lasers within 300px / turrets explode on expiry; 3 at once. *Turret pod; red glow; three pods.* Chrono, Mines, Blast.
32. **Mirror** — A ghost ship offset 80px copies your inputs and fires at 50% / the mirror is offset in *time* 0.5s / two mirrors at ±120°. *Translucent twin; trailing twin; triangle emblem.* Twin Barrels, Buckshot, Blink.

### H. Area and Fields
33. **Mines** — Drop a mine every 2s behind you (max 12) / mines crawl toward enemies / mines chain-detonate along a visible fuse. *Dispenser; magnets; fuse cord.* Wake, Chrono, Blast.
34. **Storm Cloud** — A drifting cloud slows and ticks enemies / follows your cursor; bullets fired through it become 3 / discharges lightning every 0.5s. *Small cloud; tether line; dark cloud with lightning.* Voltaic, Overdrive, Gravity Well.
35. **Gravity Well** — 35 mana: a 3s well at cursor pulls enemies and their bullets / also slingshots your bullets out at 2× / collapse deals damage scaled by how many things were inside. *Singularity orb; accretion disk; violet shimmer.* Blast, Railgun, Buckshot.
36. **Burn Trail** — Engine flame trail burns enemies / dashing ignites the trail into a 3s wall of fire / burning enemies leave fire pools on death. *Flame trail; blue-white dash flame; lava-crack hull.* Drift, Gatling, Afterburner.

### I. Wildcards (risk, jagged card border)
37. **Ghost Rounds** — Bullets are invisible, +100% / enemies don't react to them, +150% / bullets flicker visible near enemy bullets, +200%. *Guns vanish; matte black hull; tracer outline.* Seeker, Gatling, Voltaic.
38. **Claustrophobia** — Arena −20%, +25% damage near enemies / another −20%, walls damage enemies / arena ~50%, walls pulse inward every 5s and crush enemies against them. *Dented hull; wall-color trim; caged decal, arena lit red.* Ricochet, Buckshot, Blast.
39. **Glass Hull** — Max HP 1, +80% damage, +50% trickle / a hit with ≥50 mana drains mana instead of killing you / each untouched wave adds +10% damage this run (never lost). *Transparent hull; mana cage; accumulating shards.* Siphon, Vent, Ghost.
40. **Berserk** — Damage scales with *missing* mana (+100% at 0); actives cost +30% / at ≤20 mana, +50% fire rate and speed / at 0 mana your dash is free but costs 1 HP. *Blood-red gradient; wing spikes; bleeding particles.* Siphon, Overdrive, Hull Plating.
41. **Feedback Loop** — Enemies fire 30% more; graze gives +6 / your bullets absorb enemy bullets they touch (+10% each) / enemy bullets that hit you have a 50% chance to reflect as yours. *Sensor halo; bullet nodules; chrome finish.* Pulse, Phase, Ghost Rounds.
42. **Gambler** — Every 10th shot is a random other weapon's T1 shot / kills have a 5% chance to grant a random T1 you don't own for this wave / each wave one owned upgrade is randomly promoted a tier for the wave (ship glitches into the new form). *Dice decal; slot reel; flickering parts.* Everything.

### 6.1 Signature combos
- **The Fireworks Factory** (Blast 3, Shard Orbit 3, Voltaic 3, Reaper 2): one bullet lands and the wave dissolves in a rolling cascade of orange rings and cyan arcs. You haven't fired a second shot.
- **Spend to Win** (Overdrive 3, Spendthrift 3, Gatling 3, Overcharge 3): a perpetual-motion turbine that only stops when you release the trigger, and releasing dumps a Nova.
- **The Blender** (Gravity Well 3, Buckshot 2, Blast 3, Claustrophobia 3): drop a well in a half-size arena and fire buckshot into it.
- **The Dash Tax** (Afterburner 3, Wake 3, Mines 3, Burn Trail 2, Drone 3): you never fire your primary; three dashes draw a lightning bolt across the screen.
- **The Haunting** (Ghost Rounds 3, Seeker 3, Mirror 3, Chrono 2): 60 invisible seekers become 120; the screen shows only hit-sparks blooming like popcorn.
- **Pain Engine** (Glass Hull 3, Siphon 2, Vent 2, Berserk 3, Hull Plating 2): a good pilot is a god; a bad one dies on wave 4.
- **Wallbanger** (Ricochet 3, Drift 3, Claustrophobia 2, Twin Barrels 3, Overkill 3): the arena is a pinball table and you're the ball.
- **Turret Grid** (Turret 3, Chrono 3, Mines 3, Storm Cloud 3, Voltaic 2): build a kill box in slow motion and fly circles outside it.

### 6.2 Ship visual stacking
Nine attachment slots with fixed z-order and brightness caps so any combination reads as one machine:

| Slot | Fed by | T1 → T2 → T3 → max |
|---|---|---|
| Trail | Burn Trail, Drift, Afterburner | short ribbon → tapered → dual → dual + sparks |
| Aura | Ghost, Vent, Feedback Loop | faint disc → slow ring → ring + motes → counter-rotating double ring |
| Halo (mana) | Overcharge, Spendthrift | rear arc → tick marks → full ring → pulsing gold |
| Wings | Afterburner, Phase, Blink, Drift | small fins → longer angled → inner stroke → double layer with edge glow |
| Fins | Ricochet, Reaper, Overkill, Seeker | one rear fin → two → lit tips → sparking tips |
| Hull tint | Arcane, Glass, Berserk, Claustrophobia, Ghost Rounds | cyan → white edge → HP-reactive → hex mesh |
| Barrels | Twin Barrels, Railgun, Buckshot, Gatling, Mortar | one notch → two → three swept → five with recoil |
| Core glow | Blast, Impact, Voltaic, Overdrive | dot → pulse on fire → swells with mana → white-hot with lens streaks |
| Orbitals | Shard Orbit, Drone, Turret, Mirror, Storm Cloud, Mines | 1 polygon → 2 → 3 with arcs → 4 with tether ring |

Rules: parts use only the player palette (cyan, white, gold, plus one deliberate red line for Siphon and Berserk). All rotating parts share exactly two angular speeds. The core dot is always the brightest pixel near the ship. Wildcards add a tenth **Crown** slot: one unique ornament above the ship.

---

## 7. The Enemy Roster (39 types)

**Read conventions, never broken:**
- **Shape = kind.** Circles chase. Triangles shoot. Squares and hexagons are structural. Diamonds are elites or mutated.
- **Color = urgency.** White/cyan fodder. Yellow ranged. Orange: a telegraph is coming. Red: damage now. Magenta: the arena is being altered. Green: support, kill first.
- **Size = HP bucket.** Bigger is tankier, never faster.
- **Telegraphs** draw above everything at full brightness, breathe at a shared 2Hz, and snap from orange to red at lock. That snap is the universal "move now."
- Draw order is danger order: fodder at the bottom, the thing you must kill on top with a dark outline.

### Band A: foundations (enter waves 1–6)
- **Mote** (small white circle) — slow seeker, contact damage. The medium everything else swims in. Pure flock, hundreds are fine.
- **Drifter** (pale-blue circle) — Brownian wander, ignores you. Space denial. Cheapest enemy.
- **Skitter** (tiny white circle, jagged trail) — fast erratic 0.25s bursts; leaks around the Mote wall first.
- **Spitter** (small yellow triangle) — keeps 250–350px, fires a slow bolt at your *current* position every 2.2s. Bolts kill Motes in front of them.
- **Popper** (cyan circle, 3 dots inside) — slow chaser; on death bursts into 3 Motelings. Teaches "don't kill everything."
- **Lancer** (long orange needle) — approaches to 400px, aim line 1.0s, locks at 0.7s, instant red laser 0.25s that passes through allies. Step off the line after lock.
- **Charger** (orange chevron with legs) — jitters at 350–500px to bait shots, stops, floor arrow 1.5s, locks at 1.2s, charges 600px at 3× speed, shoving allies aside. Dash sideways after lock.

### Band B: reading (enter waves 7–12)
- **Shade** (invisible; violet when revealed) — slow silent chaser, 2× contact damage. **Revealed only by background events** for 0.8s, by damage for 0.3s, and as a shimmer within 60px. Death reveals a violet ring hinting at neighbors.
- **Constrictor** (large magenta hexagon at the rim) — every second the nearest wall steps inward ~6px, pushing everything in. Not restored until wave end. Go kill it now.
- **Sentinel** (green hexagon, 120px dome) — enemies inside are immune to shots from outside; the Sentinel itself is not. Dome collapse slows those inside.
- **Mortar** (fat yellow triangle, stationary) — lobs a shell at your predicted position; a 90px orange circle fills for 1.2s, then a red flash. Hurts enemies too.
- **Bloat** (big dim red circle) — slowest thing on screen; death flare 0.4s then a 140px explosion hurting everyone.
- **Sower** (small green square) — straight lines, lays a mine every 1.5s; mines arm after 1s, persist 20s, kill enemies too.

### Band C: prioritizing (enter waves 13–18)
- **Tether Pair** (two orange diamonds joined by a beam) — stay ≤220px apart and rotate; the beam hurts you, not enemies. Dash through it or kill one end.
- **Puller** (magenta ring) — spawns inside the arena after a 2s swirl; pulls everything within 350px including projectiles. Death is an outward shove.
- **Hive** (large green hexagon) — slow and tanky; emits 4 Larvae every 2.5s; final burst of 8 on death.
- **Glazier** (magenta square) — draws **mirror walls** that block movement and *reflect your projectiles*. Death shatters its walls.
- **Warden** (yellow square with turret head) — plants at 500px, fires 3-round bursts leading you by 0.6s. Changing speed beats it.
- **Wisp** (small cyan circle, elegant trail) — orbits you at 200px; every 4s speed-bursts 20 nearby enemies (they gain trails).
- **Splitter** (white circle with a seam) — non-lethal damage splits it into halves, then quarters. Kill in one hit.

### Band D: fighting the arena (enter waves 19–24)
- **Eclipse** (large magenta disc, black core) — everything outside a 220px lantern around you fades to 15%; telegraphs stay bright. Death reveals Shades 2s.
- **Prism** (orange triangle with a gem) — three aim lines (you, ±25°); beams reflect off mirror walls, with reflected paths drawn during the telegraph. Kill during lock and the gem bursts into light that reveals Shades.
- **Siphon** (green diamond with a cord) — attaches within 350px; drains your mana and heals nearby enemies with it. Dash through the cord. Death refunds a dash worth.
- **Rotator** (magenta hexagon with arrows) — the boundary, walls, and mines rotate ~6°/s; enemies ride the floor, you don't. Two spin opposite and cancel.
- **Necromancer** (dark green hexagon with an eye) — every 4s raises up to 12 recent corpses as gray Husks (30% HP, no death effect). Death crumbles all Husks.
- **Doppel** (cyan outline of your ship) — mirrors your movement through the arena center; takes damage from enemy hazards. A puzzle enemy.
- **Chronoform** (magenta rotating square, 300px field) — inside it you move and shoot at 60%; dash exits. Death grants 0.5s haste.
- **Flak** (chunky yellow triangle) — a shell bursts into an 8-bolt ring at your fire-time position; ring bolts kill enemies too.

### Band E: mayhem (enter waves 25–30)
- **Wraith** (invisible; violet smear) — fast chaser that phases through mirror walls and domes; flares red 0.4s before contact. Death reveals nearby Wraiths.
- **Crush** (magenta hexagon pair at opposite rims) — the boundary contracts toward the line between them; the arena becomes a corridor. Kill either half.
- **Cathedral** (huge green hexagon with 6 orbiting nodes) — nodes are two Sentinels, two Hives, two Wardens; core invulnerable until 4 nodes die; one node is always exposed. Death kills all Larvae and Husks on screen.
- **Herald** (green diamond with a halo) — every 6s applies a random mutator to the 15 nearest enemies.
- **Singularity** (magenta point with a lensing ring, at center) — pull grows every second; eats enemies it swallows; your damage scales with proximity. Death kills everything within 400px.
- **Ouroboros** (ring of 24 orange diamonds) — contracts around you; one rotating gap; 3 adjacent kills open another; 12 kills dissolve it.
- **Charger Elite** — charges three times with 0.6s re-telegraphs; the last always has the longest lock.
- **Echo** (translucent gray ghosts) — replays 40 recorded enemy paths from the previous wave. Contact only.
- **Sunder** (cracked magenta square) — every 8s opens a 40px chasm across the arena for 6s that enemies can't cross and you can dash across.
- **Swarm Lord** (cyan hexagon in a sphere of 60 Motelings) — Motelings are its HP; throws 15 at you every 5s; under 10 it flees.

### 7.1 Mutators (Heralds from wave 27; wave-wide rolls in endless)
Diamond outline plus a rim color, max 2 per enemy. Volatile (red, explodes on death), Linked (orange, tether beams), Phased (violet, intangible 1s every 3s), Anchored (yellow, immune to push/pull), Split (white), Haunted (gray, rises once as a Husk), Shrouded (dark green, personal dome), Magnetic (magenta, pulls your projectiles), Mirror (cyan, reflects first hit), Vampiric (green, contact heals allies), Bloomed (pink, damaging petal on death), Siren (blue, speed-bursts allies).

### 7.2 Ambient arena mutators (scripted from Act III; rolled in endless)
Fog, Tide (rotating current), Strobe (background events 3× as often), Glass Floor (your dash trail repels enemies), Low Ceiling (arena starts at 70%).

---

## 8. The 30-Wave Script

Every wave introduces exactly **one** new thing (enemy, arena mechanic, or background rule), spawns it alongside something it interacts with (the interaction is the lesson), and ends with a boss. Retirements happen at the *start* of the wave listed. Counts are the wave's total budget spawned over the wave, not simultaneous.

Spawn choreography every wave: **Ingress** (first 10s, 2–4 glowing gate segments on the rim, rotated each wave) → **Body** (steady stream) → **Pressure spike** (once mid-wave, twice from wave 13: the rim flashes and 20% of the remaining budget spawns at once from a new gate, always a different archetype than the current dominant one) → **Closer** (the last 10% is problem enemies only). Waves end on kill count, never on a timer.

### Act I — Ember Nebula (waves 1–6): *Learn to move*
Backdrop: orange and plum nebula lobes. Events: Supernova (cosmetic warm-up in this act), Solar Wind, Flare Cascade. Music: Dorian.

| W | New thing | Roster and beats | Boss |
|---|---|---|---|
| 1 | **Mote** | 15 Motes in two gentle streams. A tutorial that never says so. | **The Compactor** (2 phases): the four arena walls slam inward on a metronome; hit the orange seams to delay slams. Teaches "the arena is not safe." |
| 2 | **Skitter** + Drifter (space denial) | 24 bodies. Skitters leak around the Mote wall first; Drifters make the open floor un-open. | **The Constellation** (5 stars): lethal lines between stars; kill a star and the figure reconnects. Your first geometry puzzle. |
| 3 | **Spitter** | 35. First Supernova flash (nothing to reveal yet; the sky is showing you what it can do). Spitter bolts kill Motes in front of them: cover exists. | **The Tide**: a wall of blue foam crosses the arena; dash through one of three eyes to pass. Teaches dash precision and mana budgeting. |
| 4 | **Popper** | 45. Spike: 12 Poppers at once. Kill a pack with spray and watch it triple. | **The Turntable**: the floor rotates under you; bullets fly straight; the hub is vulnerable only in its beam. |
| 5 | **Lancer** | 55. Lancers behind the Mote wall snipe through their allies. Standing still to farm the wall now kills you. | **The Metronome**: time only moves while the pendulum swings; the world freezes 400ms at each tick and your queued inputs burst on the next. A turn-based fight inside an action game. |
| 6 | **Charger** | 70. Chargers bait shots, lock, and charge; Lancers cover them. First 4-card draft after this wave. | **THE CONGREGATION** (act boss): 400 grey triangles that form shapes; the shape is the attack. Break keystones. Its last form is your ship at 10× scale. |

Retire at wave 7: Drifter, Skitter.

### Act II — Pulsar Field (waves 7–12): *Learn to read*
Backdrop: cyan and navy; a pulsar at the rim sweeps a lighthouse beam every 6s. Events: Supernova (now a reveal), Pulsar Sweep (constant), Comet Pass, Eclipse (once). Music: Lydian.

| W | New thing | Roster and beats | Boss |
|---|---|---|---|
| 7 | **Shade** (invisible) | 85. Shades hide in Mote packs. The pulsar beam and the supernova flash reveal them; the flash countdown arc on the rim becomes the most important thing on screen. | **The Strobe**: total darkness with random global flashes; the boss moves only in the dark and freezes in light. Your shots glow. |
| 8 | **Constrictor** | 100. Two Constrictors on opposite rims. The arena shrinks from two sides while Chargers get shorter runways (they stun on the wall: a reward). | **The Cartographer**: a stylus redraws the arena walls into new shapes every 12s; wet ink is passable, dry ink kills what it encloses, including the swarm. |
| 9 | **Sentinel** | 120. Sentinels shield Charger telegraphs and Lancer snipes. Kill the green thing first, or step inside the dome. | **The Cadence**: a tuning fork sets a 120 BPM beat; rings are safe on-beat; your shots do 3× on-beat and reflect off-beat. Accessibility toggle widens windows. |
| 10 | **Mortar** | 140. Retire Mote and Spitter; Poppers become the filler. Mortars force movement inside domes. | **The Understudy**: your ship in negative colors, running your own inputs mirrored with a 3s delay that shrinks each phase. Your build is the enemy. |
| 11 | **Bloat** | 160. Bloats hide in Popper packs; Sentinel-shielded Bloats walk at you. Kill at range, never point-blank. | **THE ENCORE** (the fake-out): a deliberately generic amber hex dies. The draft screen appears. The cards don't respond. The panel tears in half and the hex crawls out wearing the three upgrades you couldn't take. Kill it again and the draft returns with a fourth bonus card. |
| 12 | **Sower** | 180. Retire Lancer. Mines plus Constrictor: the safe floor shrinks and fills with green. Chargers through minefields die gloriously. | **THE DEPTH** (act boss): a leviathan in the parallax background layer that breaches through the floor as fins, a jaw bite ring, and finally surfaces so the whole arena tilts on its back. |

### Act III — Storm Cloud (waves 13–18): *Learn to prioritize*
Backdrop: violet and green cloud lobes with lightning between anchors. Events: Nebula Lightning (a line hazard that hurts everyone), Phase Fog, Aurora Lanes, Star Shadow. Ambient mutators begin (Fog on 14, Tide on 17). Music: Phrygian.

| W | New thing | Roster and beats | Boss |
|---|---|---|---|
| 13 | **Tether Pair** | 210. Rotating orange nets woven through the crowd. Two spikes per wave from here on. | **The Angler**: a hidden mass with a bait light that looks like a pickup; it only surfaces (and is vulnerable) when *enemies* touch the bait. Herd the swarm. |
| 14 | **Puller** | 240. Pullers drag Bloats into chain explosions and clump Shades under the next flash. | **The Reflector**: a chrome prism that reflects your shots with your upgrades intact; only its matte facet absorbs. The more absurd your build, the more careful your aim. |
| 15 | **Hive** | 270. Kill it or 200 becomes 400. Larvae are the new filler. | **The Inverter**: a drifting lens that mirrors your controls and reflects projectiles; the boss is only damageable from inside. |
| 16 | **Glazier** | 300. Mirror walls partition the arena and reflect your bullets. Ricochet builds learn humility. Wardens fire over walls. | **The Echo**: everything you kill returns 5s later as a green echo, including your own shots; the ring is only damaged by echo projectiles, so shoot where it *will* be. |
| 17 | **Warden** + **Wisp** (one spike is all Wisps) | 340. Retire Popper, Mortar, Charger, Sower. Wardens create fire lanes; Wisps make the crowd lunge. | **The Horizon**: a violet gravity bar across the arena; you become a platformer for one fight, dash is your jump, anchors are hit from on the bar. |
| 18 | **Splitter** | 380. Theme wave: "Structure" (Glazier, Constrictor, Tether Pair dominant). Splitters punish DoT. 4-card draft. | **THE SUPERNOVA** (act boss, phases 1–2): a white-gold disc at center that only grows and pulls everything in; sunspots shrink it; solar flares lash along filaments. |

### Act IV — Event Horizon (waves 19–24): *Fight the arena*
Backdrop: near-black with a slow vortex and an Einstein ring. Events: Gravity Ripple, Black Hole Bloom, Time Fracture, Resonance Pulse, Dark Phase. Music: Aeolian.

| W | New thing | Roster and beats | Boss |
|---|---|---|---|
| 19 | **Eclipse** (darkness) | 430. Everything outside your lantern is dim; Shades are everywhere; the flash countdown is life. | **The Dimmer**: the page itself darkens; the eye is only hittable during your muzzle flashes; it moves only when unobserved. |
| 20 | **Prism** | 480. Three-beam lasers reflect off mirror walls; reflected paths are drawn during the telegraph. | **The Lurker in the HUD**: it hides behind your HUD elements and weaponizes them (the mana arc fires, the wave pips fall as bombs); shoot the element it's behind. |
| 21 | **Siphon** | 530. Green cords drain your mana and heal the crowd. Dash through the cord. Three attached is death. | **The Schism**: the arena splits into two halves; enemies accumulate on the side you're not on; crossing costs full mana. |
| 22 | **Rotator** | 580. The boundary, mirror walls, and mines rotate; Glazier walls become sweeping blades. | **The Siren**: every 10s a song drags you and the swarm toward it; enemies that arrive fuse into its armor; dash on the first frame of the song to stun it. |
| 23 | **Necromancer** | 640. Retire Shade (Wraith replaces it), Constrictor (Crush replaces it), Bloat, Tether Pair. Necro plus Hive is the infinite loop you must break. | **The Probability**: a tumbling die whose face is the arena rule (1 elite at a time; doubled shots but half speed; three walls; slow-mo; five clones of you firing randomly; sixfold upgrades for 6s then normal). Shoot it to reroll. |
| 24 | **Doppel** + Chronoform (the spike) | 700. Your cyan mirror-twin takes damage from enemy hazards: walk it into Prism beams. Chronoform fields slow you inside. 4-card draft. Retire Warden, Hive. | **THE PAGE** (act boss): the camera zooms past the canvas; the arena becomes the browser viewport; page elements are cover; the border breathes inward; phase 2 scrolls the page under you. |

### Act V — The Core (waves 25–30): *Mayhem*
Backdrop: hexagonal arena, white-hot core behind an ion sea; hue rotations. Events: Ion Storm (colors invert; shoot what looks like you), Rift Spawn (bullets wrap through rifts), Meteor Shower, Flare Cascade, Supernova (frequent). Music: Mixolydian, building to the finale theme.

| W | New thing | Roster and beats | Boss |
|---|---|---|---|
| 25 | **Wraith** + **Crush** | 800. Wraiths phase through walls and domes and flare red before contact. Crush turns the arena into a corridor. | **The Understudy: Perfect**: zero-delay mirror from the first second, with three extra drafts of its own. Only mirror geometry beats it. |
| 26 | **Cathedral** | 900. A mid-wave boss inside the wave; find the exposed node. Its death clears all Larvae and Husks as a breather. | **Duo: "Lights, Camera"** (Strobe + Turntable): darkness on a rotating floor; flashes reveal a world that turned since you last saw it. |
| 27 | **Herald** (mutators) + Charger Elite returns | 1000. Every 6s the roster upgrades. Kill the halo first. | **Duo: "Bait and Switch"** (Angler + Reflector): bank your shots off the prism into the Angler's surface window. |
| 28 | **Sunder** + Flak | 1100. Chasms split the crowd; a good player uses the moat. Flak rings are pure information pressure. | **The Congregation: Requiem**: the swarm boss returns with two overlapping formations from the start and Wraiths riding inside. |
| 29 | **Ouroboros** + **Swarm Lord** + Echo ghosts | 1300. Rings trap you with whatever is inside; Swarm Lords throw their shields at you; Echoes replay wave 28. Retire nothing: everything is here. | **Duo: "Heat Death"** (Supernova + Compactor): the sun grows from the center, the walls slam inward, and the habitable band narrows from both sides. |
| 30 | **Singularity** (enemy) at center + everything | The full roster in remixed spikes for 3 minutes while a Singularity eats the arena. Killing it opens the finale. | **THE SINGULARITY** (finale): the Supernova's collapsed form. Extreme pull, the arena wall inverts, sunspots on the event horizon. Three phases, each recalling an earlier boss: it swings a Metronome pendulum, casts a Constellation, and finally mirrors you. |

### 8.1 The Ending
The Singularity detonates. A white ring expands past the arena and the whole page flashes white. For one second there is nothing: no arena, no HUD, no page. Then the arena redraws itself from the center outward, empty and calm, in the Ember Nebula colors of wave 1. Your ship, in its final form, drifts to the center. Every upgrade icon you took orbits out from the ship in the order you took them and forms a ring, then a second ring of every boss silhouette you beat. The music resolves to the held chord it began on. A gate appears.

Then a hairline crack runs across the whole page. The rings shatter. The crack splits open and the Encore's inside-out hex peeks through, wearing pieces of the ending like armor. The gate turns from white to a slow-rotating infinity ring. Fly through it: **endless mode**, wave 31, starting with that Encore as its first boss. Or fly to the small side gate to return to the title with your victory ring saved.

### 8.2 Endless mode (wave 31+)
The roster is frozen. Each wave rolls: one ambient arena mutator, one enemy mutator applied to the filler type, and a **reunion** (one retired enemy returns for a wave with an elite mutator: "300 Volatile Motes"). Spawn budget keeps growing; the simultaneous cap holds at the performance ceiling so pressure comes from rate. Every third wave guarantees a Cathedral or a Singularity. Bosses are drawn from the 27 curated fights with escalating mutators (Hasty, Cloaked, Crowded, Cramped, Unstable, Shy, Twin, Looped), as duos from wave 34 and trios from wave 40. Never two arena-manipulators back to back, never two lighting bosses within four waves.

---

## 9. The Bosses

Every boss follows four rules: a boss is a rule, not a stat block; the intro shows the rule before the boss touches you; movement and drafting must matter differently per fight; death is a spectacle that deforms the arena, the screen, or the page. No boss removes or weakens the player's upgrades.

Intros play on the zoomed-out arena: the membrane dims, a point on the rim cracks white, the boss slides in silhouette-first, its accent eye ignites with a 4% camera punch, and a boss health ring draws itself around the arena rim (thick, boss-colored, depleting counterclockwise from the boss's spawn bearing, with phase notches). Skippable by holding any input after your first encounter with that boss.

Scaling without HP inflation: early placements use two phases; waves 13+ unlock the third; endless adds a "phase 0" where the boss starts attacking mid-intro. Vulnerability windows shrink; HP pools never grow. Each phase floors the boss at 1 HP for a minimum duration.

| # | Boss | Family | The rule | Death spectacle |
|---|---|---|---|---|
| 1 | Compactor | Arena | Four wall slabs slam inward on a metronome; seams delay slams; asymmetric slams make corridors. | Slabs explode outward; the arena is 130% for the transition. |
| 2 | Constellation | Many-parts | 5–9 stars joined by lethal lines; killing a star reconnects the figure; final triangle hunts you. | A new constellation is drawn in the sky for the rest of the run. |
| 3 | Tide | Moving wall | A foam wall crosses the arena; pass through one of three eyes; later only one eye opens; finally two tides meet. | Collapses into a knee-deep flood; enemies slog, you skate. |
| 4 | Turntable | Arena | The floor rotates; bullets fly straight; reverses with a fling; then two rings counter-rotate with a shear seam. | Floor locks; every enemy is flung into the walls. |
| 5 | Metronome | Time | Time only moves while the bob swings; freeze 400ms at each tick; queued inputs burst; bob later detaches and rolls. | Time stays frozen 3s with the draft already visible behind it. |
| 6 | **Congregation** | Swarm | 400 boids form shapes; the shape is the attack; kill keystones; final form is your ship at 10×. | The last hand opens and lets you go; boids drift up like ash. |
| 7 | Strobe | Lighting | Darkness with random flashes; it moves only in dark and freezes in light; later only your shots are light. | Lights come up: the arena was full the whole time; everything pops outward. |
| 8 | Cartographer | Arena | A stylus redraws the walls every 12s; wet ink is passable; dry ink kills what it encloses; finally your own path is the wall. | Ink floods the floor; the color scheme inverts for one wave. |
| 9 | Cadence | Rhythm | 120 BPM rings; safe on-beat; shots do 3× on-beat and reflect off-beat; tempo changes; polyrhythm. | The fork cracks; every ring collapses inward. |
| 10 | Understudy | Mirror | Your ship in negatives running your inputs mirrored with a shrinking delay; it drafts one extra upgrade. | Shatters into copies of your ship; you keep an after-image trail. |
| 11 | **Encore** | Fourth wall | Dies, breaks the draft screen, tears out of the panel wearing the three cards you couldn't take; drags your HUD arcs in as shields. | The UI heals; the draft works again with a fourth bonus card. |
| 12 | **Depth** | Background | Lives in the parallax layer; breaches as fins and a jaw ring; surfaces so the arena tilts on its back. | Sinks forever; the floor stays translucent. |
| 13 | Angler | Lure | Hidden; a bait light that looks like a pickup; surfaces when enemies touch it; later three baits; finally hooks you. | Its light detaches and becomes a small light companion for the run. |
| 14 | Reflector | Reflect | Chrome prism reflects your shots with your upgrades intact; only the matte facet absorbs; shatters into six orbiting facets. | Releases every projectile it absorbed as friendly fire. |
| 15 | Inverter | Arena | A lens field mirrors your controls and reflects projectiles; damageable only from inside; grows to cover the arena. | Shatters into mirror shards showing frozen snapshots. |
| 16 | Echo | Time | Kills and shots return 5s later as green echoes; the ring is hit only by echoes; delay drifts; echoes get echoes. | Everything rewinds at 10× to its origin and vanishes. |
| 17 | Horizon | Arena | A gravity bar; dash is your jump; anchors hit from on the bar; the bar tilts; it splits with zero-g between. | The bar snaps and launches every stacked enemy skyward. |
| 18 | **Supernova** | Scale | A disc that only grows and pulls; sunspots shrink it; solar flares. | Goes nova: the page flashes white and redraws from the center. |
| 19 | Dimmer | Lighting | The page darkens; your muzzle flashes are the only light; the eye moves only unobserved; anti-light projectiles. | Every shot you fired replays as light at once. |
| 20 | Lurker in the HUD | Fourth wall | Hides behind HUD elements and weaponizes them; shoot the element; finally drags the HUD into the arena. | The HUD reassembles with a permanent cosmetic crack. |
| 21 | Schism | Arena | Two half-arenas, enemies on both; crossing costs full mana; then four quadrants; then a slam-merge. | The gap fills with white and the halves slam together. |
| 22 | Siren | Lure | A song drags you and the swarm inward; arriving enemies fuse into armor; dash on the song's first frame to stun. | A shockwave pins every enemy to the walls for 5s. |
| 23 | Probability | Rule | The die's face is the arena rule; shoot to reroll; two dice combine; a cracked 7 runs all rules for 7s. | Shatters into d20s; your next draft has 5 cards. |
| 24 | **Page** | Fourth wall | The arena becomes the browser viewport; page elements are cover; the border breathes; it scrolls the page. | Snaps back to canvas size with a white flash. |
| 25 | Understudy: Perfect | Mirror | Zero-delay mirror from second one with three extra drafts. | As Understudy, louder. |
| 26 | Duo: Strobe + Turntable | Remix | Darkness on a rotating floor. | Lights up, floor locks, everything flung. |
| 27 | Duo: Angler + Reflector | Remix | Bank shots off the prism into the Angler's surface window. | Both spectacles, staggered. |
| 28 | Congregation: Requiem | Swarm | Two formations from the start; Wraiths inside. | Ash, again, but silver. |
| 29 | Duo: Supernova + Compactor | Remix | The sun grows, the walls slam; a thin habitable ring. | Walls slam into the sun; it detonates through them; the arena ends bigger than it started. |
| 30 | **Singularity** | Finale | Extreme pull; the wall inverts; sunspots on the event horizon; three phases recalling the Metronome, the Constellation, and the Understudy. | See §8.1. |

Endless-only pool additions: The Choir is cut (it fragments your build). Any boss above can appear with mutators.

---

## 10. Environment, Light, and Arena

### 10.1 Art direction: **Void Neon**
Vector glow on near-black. The void is `#05060A`, never pure black, so bloom has contrast. The player is cyan `#4DF3FF` with a white-hot core `#EAFFFF`; player bullets are white with a cyan halo. Enemy families: magenta `#FF3CAC`, orange `#FF8A00`, acid `#B6FF00`, violet `#9B5CFF`, yellow `#FFD84D` for ranged, green `#39FF6A` for support. Red `#FF2E4D` is damage and hurts everyone. Gold `#FFD84D` is reserved for "attention now": full mana, the last enemy, boss weak points. Nebula tones are desaturated navies and plums at 10–25% alpha.

Shape language: the ship is thin lines and one bright core. Enemies are hollow polygons whose side count reads threat kind, rotating slowly so silhouettes read when overlapping. Player shots are short capsules stretched along velocity. Enemy shots are small filled circles with a dark rim so they pop against everything.

Glow is baked: every glyph is pre-rendered once at three sizes with a three-layer halo, so at runtime it's one sprite. Additive blending is used for bullets and particles only; enemies and the ship draw normally on top so they never wash into white mush. A half-resolution bloom pass is a quality-tier feature.

Rule of readability: only three things are ever bright white: your core, your bullets, and the thing about to kill you.

### 10.2 The arena
A circle by default (a rounded hexagon in Act V). Boundary is an **energy membrane**: a crisp 2px accent stroke plus a 40px soft inner glow band. Beyond it the backdrop continues, dimmed and desaturated. Any touch spawns three expanding tangent arcs at the contact point (white for you, enemy-colored for them). Enemy bullets pop against it. For the player it's a soft wall: the last 60 units are a spring that exhales you back. Dashing into it makes a bigger ripple and a chromatic split.

Shrinking: the ring creeps inward with a visible crush band (the doomed region flashes red-orange with inward dashes for 2s before becoming wall). Backdrop stars inside the band stretch toward center. Enemies caught in it are squeezed thin and popped. The membrane tints hotter as the arena gets smaller: radius is tension without a HUD.

### 10.3 Background events
Every event has telegraph, active, and decay phases. At most one Veil event (above enemies) and one Backdrop event at a time. All are drawn as a handful of screen-space gradients and large primitives, never per-pixel.

| Event | Looks like | Rule |
|---|---|---|
| **Supernova** (all acts) | A distant star swells 3s with a rising hum, then a white flash floods the arena from one edge with long shadows streaking away; 4s afterglow. | Reveals invisible enemies as hard silhouettes during the flash; faint outlines through the afterglow. Enemies facing the star are stunned 0.5s. |
| Pulsar Sweep (Act II) | Two opposed lighthouse wedges rotating every 6s. | Inside the beam: invisibles visible, domes down, your bullets 1.5×. |
| Comet Pass (II) | A huge comet crosses behind the arena; its tail lights everything blue-white for 5s. | Full reveal. |
| Eclipse event (II, once) | A black disc slides across a bright backdrop sun. | During totality, domes drop and invisibles glow; mana regen doubles. |
| Nebula Lightning (III) | Two cloud lobes brighten; a dotted line charges 1.5s; a branching bolt slams across. | A line hazard that damages everything it touches, enemies included; lightning kills give double mana. |
| Phase Fog (III) | Desaturated fog rolls over half the arena. | Enemies inside show only their accent eye; your bullets cut clear tunnels for 0.5s. |
| Aurora Lanes (III, V) | Drifting green-teal ribbons. | Everything inside a lane moves 40% faster: highways for dashing, death traps for standing. |
| Star Shadow (III) | A dead ship drifts across the backdrop casting a hard shadow band. | Inside the shadow enemies can't see you; neither can you see invisibles. |
| Gravity Ripple (IV) | A dimple appears, then concentric rings expand; stars bend. | Projectiles of both sides curve toward the ring front; enemies are shoved outward. |
| Black Hole Bloom (IV) | A slow vortex with an Einstein ring. | Vacuums enemy bullets. |
| Time Fracture (IV) | A crack spiders across the sky with glass tinks; through it the backdrop runs slow. | Everything in the band is 60% slower, including enemy bullets. |
| Resonance Pulse (IV) | The floor breathes concentric rings on the music beat. | Shots fired on-beat deal +25%. |
| Dark Phase (IV) | Stars wink out region by region; a ring locks at your light radius. | Only your ship's light and your bullets illuminate; shooting into darkness reveals. |
| Ion Storm (V) | The hue slowly rotates until enemy colors swap; a rainbow ring flares at the swap. | Enemies that now look like you take double damage. |
| Rift Spawn (V) | A hexagonal tear opens with sub-bass. | Bullets entering one rift exit the opposite one. |
| Meteor Shower (V) | Warning glints, then target-line dashes, then fiery streaks with lingering craters. | Meteors hurt anyone; craters are slow zones; meteors that hit enemies shatter them. |
| Solar Wind (I) | The whole starfield streams one way for 6s. | A constant push force on everything. |
| Flare Cascade (I, V) | Bursts crawl along the rim ring after ring. | Each burst detonates enemy projectiles near the wall: a temporary safe zone. |

### 10.4 The overview between waves
The camera eases out over 0.8s until the whole ring fits. Time slows to 0.3×. Spawn points on the membrane pulse, a ring of light contracts to a point, and each enemy "prints" in as a scanline outline over 0.5s before filling. New enemy types show their icon above them for 0.5s. Arena alterers are placed now so you can plan. You can move and dash during this; enemies are intangible until the zoom-in completes and a thin white "go" ring pops from the ship. Any input ends the overview early.

---

## 11. Game Feel

**Screen shake** uses a trauma model (shake = trauma², decays 1.5/s, simplex-driven, capped at 8px and 0.6°). Kills add 0.05, dash 0.1, player hit 0.35, boss stomp 0.5. The backdrop shakes at 30% for parallax.

**Hit-stop:** none on ordinary hits (thousands of bullets). 40ms on elite kills. 120ms plus a slow-mo ramp on boss phase breaks. 60ms plus 300ms at half speed when you take damage. Simulation freezes, rendering continues.

**Firing:** a two-frame additive starburst muzzle flash, a 1.5px recoil, bullets spawn ahead of the barrel and stretch with speed.

**Kills:** the enemy scales to 1.4× white for one frame, then shatters into line fragments (one per polygon side) that fade in 350ms, plus one ring. Kills of the same type within 200ms chain: each pop is 10% bigger and pitched up the scale, up to eight. The last kill of a wave: 0.25× time for 700ms, 8% zoom toward the kill, chromatic split.

**Chromatic aberration** only on player hit, boss phase, supernova, wave clear. Max 3px, 150ms. Full-screen white flashes are capped at 50% alpha and 80ms; the reduce-flash setting caps them further.

**The ship:** a 24-point speed-tied ribbon trail (none when idle). Dash spawns five after-images and a shockwave ring. Mana is the arc over the ship; HP is the arc under it and the hull's brightness; low HP adds a red vignette with a 1.2s heartbeat. Damage clears bullets in a mercy ring and blinks the ship at 12Hz for 0.8s.

**Camera:** targets the ship plus 25% of the aim vector, lerps at 8/s, zooms to 0.92 when more than 60 enemies are alive, 1.08 when a boss eye opens, 1.15 on the last kill. Never crosses the membrane.

**Enemies** hit-flash white for exactly two frames with a 2px knockback. Every ranged enemy's eye brightens 300ms before it fires. Spawning enemies are intangible while printing.

**Uncluttered rules.** Layer order bottom to top: backdrop → floor events → membrane → particles (additive) → enemy bullets → enemies → player bullets → player → veil events → after-images → HUD arcs. Brightness ladder: particles ≤60%, enemy bullets 80% with dark rim, player bullets 100%. Decorative particle lifetimes 150–400ms. Global particle cap 2000 with priority eviction (player > kills > ambient). Density governor: above 400 enemy bullets, halos drop; above 800, particle spawn halves. The screen gets *cleaner* under load.

**Sound: procedural WebAudio, no files.** Player fire is a short saw blip through a lowpass with a 20ms pitch drop and ±3% detune per shot, voice-limited to one per 30ms. Kills are a noise burst swept 4k→200Hz plus a sine pop on a note of the current scale; combos climb the scale. Player hit is a distorted square ramping down plus a sub thump; music ducks 6dB. Dash is a bandpass-swept whoosh. Wall touch is a plucked string. Each biome has a mode (Dorian, Lydian, Phrygian, Aeolian, Mixolydian); music is a generative bass ostinato on a 4/4 clock (which also drives the Resonance Pulse), a pad chord, and an arp layer that fades in with enemy count. Everything is pitched by the global time scale so slow-mo drops the world's pitch.

---

## 12. Menus and Flow (zero words)

**Principle: the ship is the UI.** Chrome overlays exist only for settings and the draft, and even those are icons and live previews. Numbers appear sparingly (wave glyphs, optional score); words never.

### 12.1 Title screen
The title screen *is* the arena: full zoom-out, dim, your ship idling at center with engine flicker, reticle following the mouse. A glowing **gate** ring pulses at 1Hz a short flight away with an animated dotted trail leading to it. Fly through the gate to start; a click or Enter dashes you through automatically. The gate leans toward the ship and brightens as you approach. Around the gate: a ring of pips showing your best wave (spiked pips every 5th, a gold crown pip at 30), and inside it a slow-rotating **ghost ship** of your best run's final form. A second small gate with an infinity ring appears once you've beaten wave 30 (endless from wave 31). Settings icons slide up from the bottom rim when the mouse drifts near it. Defeated enemies and bosses orbit the outer rim as tiny silhouettes: a wordless bestiary that fills in over runs.

### 12.2 HUD
Nothing in the corners during combat. HP is a segmented arc under the ship; mana is an arc over it with a dash-threshold notch. Wave progress is the arena rim: each living enemy is a faint dot at its bearing (doubling as an off-screen indicator), a thin ring depletes as the spawn budget is consumed, and wave count is a cluster of 30 pips at the top of the rim that only shows during transitions (past 30, the pips become an infinity ring with a counter). Boss health is a thick ring around the arena edge with phase notches. Your build is your ship's shape, plus a tiny icon strip with tier pips that fades in for 2s after a draft and while paused. HUD arcs fade to 25% when all is well and re-brighten for 1.5s on any change. Damage numbers are off by default; crits optional.

### 12.3 Draft screen
Three rounded-hexagon cards in an arc above the ship (which stays in the arena; the world dims 50% and slows to 5%). Each card: icon (top), three tier pips with the next one blinking, a 120×80 live simulation of the effect on a dummy, and a silhouette of your ship after the pick with the new part highlighted. Hover: your real ship morphs in 150ms with an "assemble" tick; the card scales 8%. Click or 1/2/3: the card shatters into particles that fly onto the ship, a bright outline sweeps the new part, a shockwave ring, a rising chord pitched by tier. Reroll and skip are two small hexagons below (a spin glyph showing its mana cost as a draining arc; a heart-shard glyph for skip). No timer. A fast player drafts in 400ms.

### 12.4 Wave transition
Last kill (0.6s slow-mo, any input ends it) → sweep (0.4s: rim ring refills, wave pip lights with a chime) → draft → transform (0.3s) → zoom out (0.8s, full control) → materialize (1.0s, enemies print at the rim) → boss intro (1.5s, no damage possible) → zoom in (0.5s) → a white "go" ring. Skips are hold-not-tap. Total overhead for a fast player is about 3.5s.

### 12.5 Death
Time drops to 10% for 0.8s. The ship **shatters into its upgrade parts**, each flying off trailing its color and landing as a glowing shard; the core fades to an ember; the screen desaturates; a descending chord mirrors the draft stinger in reverse. Then, in the arena: the ship rebuilt from its shards rotates on a pedestal of light; a ring of pips for the waves reached with boss pips as spikes (the 30-wave journey, and past it an infinity segment for endless depth); your best run's ring as a ghost outside it that flares gold and expands if you beat it; a timeline strip of the upgrade icons you took. The last 2s before death loop faintly behind it at half speed with the killing projectile highlighted. The gate reappears in front of the ship; fly through for an instant new run. A small house-glyph gate returns to the title.

### 12.6 Pause and settings
Esc freezes the world under a frosted blur with the ship crisp. A ring of icons around the ship: resume (▶), master/music/SFX volume (speakers with radial arc sliders), screen shake (a camera icon that shakes at the chosen intensity while hovered), flash intensity / reduce-flash (a sun icon that flashes once when changed; defaults to medium; a one-time photosensitivity glyph appears before the first supernova), quality (three stacked squares of increasing detail), colorblind mode (an eye with a color wheel; cycles four palettes; a preview strip of enemy colors updates live), reticle size, auto-fire toggle, replay hints, and quit (a door). All sliders are radial arcs matching the HUD. Everything persists locally and applies instantly.

### 12.7 Icon grammar
Upgrade icons live in rounded hexagons, enemies in circles, bosses in spiked circles. Base shapes: ▲ projectile, ○ orbital/aura, ⚡ chain, ◆ hull, ◐ mana, ⟶ dash/speed, ✦ crit/burst, ☀ explosion, ⌖ targeting. Modifiers in fixed corners: `+` count, `↑` magnitude, `»` speed, arrow-through-bar pierce, `↩` bounce, `⟳` regen. Tier is stacked outlines on the frame plus pips. Color is family: offense orange, defense blue, mana cyan, movement green, chaos magenta. Enemy telegraphs pre-draw their own shape in their own color.

### 12.8 Anti-frustration rules
Every hit has a telegraph of at least 0.4s. Nothing spawns within four ship-widths of the player. Nothing deals damage during transitions or intros. Materializing enemies don't collide. Dash always has i-frames and is always affordable at least once per 6s. Post-hit invulnerability 0.8s. Damage is one HP at a time, always. Restart under a second. Skips are hold-to-skip. The draft never offers dead picks. Deaths are legible (slow-mo, ghost replay, the killer highlighted). Enemy bullet speed never exceeds 70% of dash speed. The power fantasy is visible: screen-filling effects are yours, not theirs. If a wave stalls, remaining enemies get a rim beacon and drift toward you after 20s. No mechanic ever removes an upgrade or reduces your build.

### 12.9 Meta
No power progression. Purely visible unlocks: the bestiary ring, hull palette swatches at waves 10/20/30 selected by flying over them, and the endless gate. Runs feel different through drafts, because the waves are the same every time and mastering them is the point.

---

## 13. Performance Principles (design-level)

Everything is one HTML file with no build step required to run it. The renderer is WebGL2 instanced quads from a generated sprite atlas with baked glow (a Canvas 2D fallback with glow off), so the whole frame is about eight draw calls. Entities live in structure-of-arrays typed arrays in fixed pools (bullets 8192, particles 4096, enemies 1024) with swap-remove and zero per-frame allocation. A uniform spatial hash rebuilt every frame handles all collisions. Fixed-timestep simulation with interpolated rendering; hit-stop and slow-mo scale the accumulator. A quality governor watches a rolling frame-time average and steps down (bloom off → particle caps → resolution scale → trails off) with hysteresis. The stress scene (500 enemies, 5000 bullets, 3000 particles, every event firing) is the target, not the exception. Audio is one context with pooled voices.

---

## 14. Build Order

1. Core engine, renderer, ship, mana, dash, HUD arcs, arena membrane, Motes, one biome, procedural sound. A playable wave 1.
2. Draft screen with live previews and ship morphing; the 42 upgrades and the nine visual slots.
3. Bands A and B enemies, waves 1–12, Supernova and Pulsar events, first seven bosses.
4. Bands C and D, waves 13–24, remaining events, bosses 8–24.
5. Band E, waves 25–30, the finale, the ending, endless mode.
6. Title, death, pause, settings, accessibility, bestiary.
7. Polish pass: feel checklist, quality governor, stress test at 60fps.

---

## 15. Decisions Made Without Asking

The original plan was to end with ten questions. Since the instruction became "implement end to end," these are the calls made instead, each easy to change:

1. **Art direction: Void Neon** (neon vector on near-black), with gold reserved for attention.
2. **Renderer: WebGL2 instanced sprites** with a Canvas 2D fallback, so late-wave mayhem stays at 60fps.
3. **Controls: mouse aim, hold to fire, auto-fire on by default**, right-click or Shift to dash. Gamepad supported.
4. **Lethality: 3 HP, one hit per damage event**, healing only via skip (+1) and rare boss gifts.
5. **Run length: 30 curated waves in roughly 45–60 minutes**, then endless.
6. **Fourth-wall effects go all the way**: DOM tearing, page dimming, viewport-sized arena, page scroll. The file is meant to be opened standalone in a browser tab.
7. **Zero text; numbers only as wave glyphs and optional crits.**
8. **No meta-progression**, only visible unlocks (bestiary, palettes, the endless gate).
9. **Sound is fully procedural WebAudio** with per-act musical modes; no external assets.
10. **Draft offers are seeded random per run**; enemy waves are identical every run. No daily seed at launch.
11. **Nothing regressive exists.** Cut: the Parasite, the Curator, the Choir, the Vengeful boss mutator, and the Gambler's demotion tier. The Encore stays because it only takes what you didn't pick.
