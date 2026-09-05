# NOVA ARENA — CHECKPOINT (written 2026-09-04 late evening, session paused for the night)

Read this first when resuming. Then read GAME_PLAN.md, AGENT_RULES.md, ARCHITECTURE.md §25.

## State of the build

- Playable: `d:\!games\nova-arena.html` (open standalone in a browser). Rebuild with `node tools/build.js`.
- Smoke: `node tools/smoke.js`. Browser harness: `node tools/test.js` (Edge only, never chrome.exe).
  Flags: --bot --god --fast=N --wave=N --boss=id --endless=N --untilWave=N --frames=N --stress --prof --nogl --domcheck --upg=a:3,b:2 --screen=name
- All content is in: 42 upgrades x3 tiers, 41 enemies, 30 waves, 30 bosses, 18 events, 5 biomes, endless from 31.
- Camera: centered damped follow, 1100x620 combat window, arena radius 1700, overview/title/draft fit whole arena.
- Integration pass done (2026-09-04): 4 soft-locks fixed (congregation phase floor, congregation key-bird cull, endless budget stall, encore crack leak), fourth-wall DOM sweep on clear/reset, warnings count as harness errors.
- Bot runs before the review fixes: 1->21 clean with god; endless 35->44 clean; no-god run dies at wave 2 and restarts cleanly (bot can't survive without god, expected).
- Perf before review fixes: stress avg 4.4 ms p95 5.7; wave 28 avg 1.4 ms. Canvas2D fallback (`?nogl=1`) was ~1500 ms/frame (being fixed).

## Rules the owner set (do not violate)
- Sub agents: always model "opus". Orchestrate, don't debug by hand.
- No regressive mechanics (nothing removes/disables/downgrades upgrades). Hard but satisfying.
- Camera: REVERSED on 2026-09-05. One wide combat zoom everywhere (C.VIEW_W = 2400, Cam.tzoom pinned to 1 in NA.Game.frame); boss fights are framed exactly like regular waves and per-boss camZoom is dead data. Screen-space rim indicators still apply.
- Zero text in UI EXCEPT the upgrade draft cards, which now carry a name and a one-line description (owner request, 2026-09-05). Curated 30 waves, endless after.
- Regular waves spawn their whole population at once at wave start (owner request, 2026-09-05) — no ingress trickle / drip / spike.
- The OS cursor is visible in every menu state; hidden only while flying. Space dashes as well as fires.

## Adversarial review (5 agents) — status
Reports live in the session scratchpad; copies are in `d:\!games\review\` (see below).
- review_perf.md — DONE. 15 findings. Fix agent was running at pause; see "Fixer status".
- review_design.md — DONE. 23 findings (F1–F23). Boss/wave subset (F6, F8, F11, F18, F23) fixer was running at pause.
- review_correctness.md — reviewer was asked to deliver early; check `d:\!games\review\` for the file.
- review_ui.md — same.
- review_compat.md — same.

## Fixer status at pause (update from their final reports below, section "Agent reports")
1. Siren fixer (13d_bosses_3.js, 98_bot.js): widen SIREN_WINDOW to ~0.45 s, telegraph ramp, anti-deadlock fallback, bot dash hint. Goal: `--bot --god --fast=4 --untilWave=31` completes clean.
2. Perf fixer (02,03,05,06,07,08,10,11,11b,12,15): flush2D drawImage rewrite, governor, arena ring cache, depth() early-out, grid for _area/damageArea, flat hook arrays for Upgrades.emit, sfx cooldown + voice pool, poly id table, camera cull, hoisted POST object, grid out-buffer re-entrancy.
3. Boss/wave design fixer (13b, 13c, 14_waves): F6 encore at 31, F8 supernova 3rd phase, F11 understudy drafts one, F18 single event scheduler + eclipse once + auroraLanes act V, F23 constellation 5/7/9 + no repeat endless boss.

## TODO tomorrow (in order)
1. `node tools/build.js && node tools/smoke.js` — confirm the tree builds. If not, `node --check src/*.js` to find the broken file (a fixer may have been cut mid-edit). Fix or revert that edit.
2. Read the "Agent reports" section below and the three late review files. Anything marked half-done: verify or finish.
3. Run `node tools/test.js --bot --god --fast=4 --untilWave=31` and `--nogl --stress --prof --frames=300`. Both must finish with zero errors/warnings.
4. Launch remaining design fixers (Opus), one per file group, no two agents on the same file:
   - Group A (02_render one-liner + 11_upgrades + 09_player): F1 LAYER_ADD[7]=0 + ornament brightness cap; F17 railgun hold gates primary fire; F21 four missing tier visuals; F22 is a GAME_PLAN.md doc note only.
   - Group B (11b_upgrades_b): F2 feedbackLoop (mods.grazeMul + enemy fire-rate hook read in 10_enemies), F7 mines cap 12, F12 hDamage wrapper for 14 call sites, F13 scale file-B damage by Pl.stats.damage, F14 registerTapActive/tapClaim, F15 per-bullet overkill carry + impact identity, F16 shard lifetime, F23 gambler via take(), burnTrail uses H.setBurn.
   - Group C (12_events + 08_bullets + 10_enemies): F3 wire damageMulAt/hiddenAt/onBeatWindow/domesDown/inverted; F4 phaseFog non-additive below enemies; F19 telegraph floor 0.4 (SPIT_TELL, hasty clamp, rift exit flash); F20 whites; F23 revealAlpha per bullet, timeFracture 0.4x, gravityRipple outward.
   - Group D (15_ui + 16_game): F5 screen-space rim HUD (enemy bearing dots + budget ring projected to screen edge) — camera stays zoomed in; F23 ending double-draw, ending rings show icons/boss silhouettes.
   - Group E (13d_bosses_3): F9 duoBaitSwitch bank-shot gate on OWN.REFLECT; F10 duo intros run component intros; F23 understudyPerfect three drafts, minDuration.
   - Plus fixers for the correctness / UI / compat reports once read (P0/P1 only).
5. Re-run: full bot 1->31 god, endless 31->40, --nogl wave 15 + encore, --domcheck on page/encore/lurker/dimmer, --stress --prof. Screenshot waves 5/15/25 + draft to check the ship is readable (F1).
6. Update ARCHITECTURE.md §25 with a short note per fix group. Delete this file's "Fixer status" section once absorbed.
7. Final report to owner: path to nova-arena.html, what was fixed, known limitations (no-god bot can't clear the game; that's expected).

## Agent reports (appended at pause)

### UI / fourth-wall review — delivered (review/review_ui.md, 15 findings)
CRITICAL: NA.Audio.music.start() is never called anywhere -> game ships with SFX only, no music. Fix: call it in Audio.init() after tryResume() (03_audio.js ~224), guarded on Audio.enabled.
HIGH: (2) player death never sweeps the fourth wall (body filter/scroll/DOM persist on death screen; call NA.Bosses._fourthWallSweep() in the playerDeath handler, 16_game.js ~521); (3) pause menu: click on empty space fires keyboard-selected item, can quit run (15_ui.js 906-915, gate fallback on keyboard confirm only); (4) FW.tick digits damage player while paused/dead (15_ui.js 1104/2086); (5) Encore bonus draft driven from render(), live during pause/death (13c 495-505; run it as state 'draft'); (6) Input.holdTime not reset on state change -> overview and ending skipped if holding a key (reset in setState); (7) Input._keyFire never assigned -> mouse release cancels Space fire (01_core 308); (8) mouse button released outside window sticks (add pointerup/mouseleave clear).
MEDIUM: (9) pause mid-slowmo pins timeScale (snapshot ramp fields); (10) _victoryEmitted/_victoryFromBoss/victoryPending not reset in newRun(); (11) HUD stays detached after death; (12) 2D overlay freezes in live states (add camera to sig); (13) title: any click in bottom 20% opens settings (add x test); (14) gamepad d-pad can't move ship (axis() buttons 12-15); (15) tearDraft/healDraft promises dropped on reset (settle with false).
Nits: Time.real frozen while paused; no Digit5 key; no touch input; Store.load unguarded seen; body.na-dim dead CSS.
-> Add "Group F (01_core + 03_audio one-liner + 15_ui + 16_game + 13c encore block)" to the TODO: fix 1-15 above. Group D and F share 15_ui/16_game, so run them as ONE agent.

### Compatibility review — delivered (review/review_compat.md, 15 findings)
Single-file / ES-level / global-scope contract is clean (1 global, no externals, no ES2021+). All risk is in the no-WebGL2 path:
CRITICAL (1,2,5): flush2D re-runs atlas bake functions per instance -> everything white at alpha 1, dotRim (enemy bullets) punches holes with destination-out, ~2000 ms/frame in stress. Fix = drawImage from Atlas.canvas + tint cache (the perf fixer's #1 covers this; VERIFY it also fixes colour/alpha/composite leaks, not just speed).
HIGH: (3) no webglcontextlost/restored handlers -> permanent black screen on GPU reset (add both, preventDefault on lost); (4) initGL/shader compile failure is outside the try -> whole boot dies instead of falling back to 2d (wrap initGL, demote to 2d); (6) tools/build.js never fails (errors never incremented, no syntax check) -> add vm.Script check per file, exit 1 on failure; use numeric-prefix sort.
MEDIUM: (7) 2D path drops darkness/vignette/desat/hue -> add cheap radial-gradient darkness+vignette overlay in flush2D; (8) 2D ignores shakeRot/parallax; (9) --nogl harness runs die at wave 1 without --bot --god, and 99_boot.js only computes avgMs on completed runs -> compute unconditionally, add avgMs budget assertion; (10) dimPage filter on body breaks position:fixed when viewportArena scrolls -> apply dim to #wrap or overlay div; (11) add --strict harness mode (drop --allow-file-access etc.), do one manual Firefox pass.
LOW: (12) Atlas.add no vertical overflow guard; (13) 13d dbg() console.warn before debug gate (move below); (14) NA.params should be Object.create(null); (15) debounce resize, matchMedia DPR listener.
-> Add "Group G (02_render GL-loss + initGL try, tools/build.js, 99_boot avgMs, tools/test.js --strict)" to the TODO. Coordinate with perf fixer's 02_render changes (read its report first).

### Perf fixer — stopped at deadline, tree clean (build + smoke pass)
DONE: perf #1 flush2D drawImage-from-atlas with tint cache (02_render 836-950), 2D layer caps R.cap; #2 governor (rAF-delta driven, 15/10 ms thresholds, real-time holdT, no-alloc p95, bloom/trails rungs R.bloom/R.trails honoured in 09_player:415 and 07_fx:238); #8 poly id tables; #9 numeric sprite handles R.S/R.spriteK (string R.sprite still works); #11 camera AABB cull in R.sprite (star-count scaling NOT done).
Numbers: --nogl stress 1494 ms -> 68 ms (finishes); --nogl wave 20 timed out -> 1.46 ms avg; GL stress 4.4 ms avg; wave 28 1.41 ms.
NOT STARTED (no partial edits): #3 arena ring cache, #4 depth() early-out, #5/#6/#10 grid + flat hook arrays, #7 audio sfx cooldown + voice pool + Audio.update sweep, #12 Grid.out re-entrancy, #14 hoisted POST/SCTX/overlay sig, #15 dimPage no-op.
Not run: `--bot --god --fast=4 --untilWave=12` after these edits. Do this first tomorrow (TODO step 3).
NOTE for compat findings 1/2/5: the drawImage rewrite should fix white/alpha/composite leaks too, but nobody has looked at a --nogl screenshot since. Take one (`--nogl --bot --god --wave=15 --frames=900`) and compare to GL.
-> TODO: "Group H (perf remainder: 06_arena, 08_bullets, 10_enemies, 11_upgrades, 11b, 03_audio, 05_pools, 07_fx, 12_events, 15_ui)". Merge with Groups B/C where files overlap so no two agents share a file.

### Correctness review — delivered (review/review_correctness.md, 15 findings)
P0 (BLOCKS the 1->31 god run at wave 13): Angler hitTest (13c_bosses_2.js 972-981) returns 2 (absorb) for EVERY player bullet arena-wide while submerged -> all shots deleted, fight stalls forever. Same bug in Depth (13c 666-678). Fix: distance test against d.radius + r first, return 0 on miss; force a surface after ~12 s without one.
P1: (3) Draft.reroll() can charge 40 mana and produce an empty draft (15_ui 517-528; check offer() result before spending); (4) _keyFire never assigned (same as UI #7); (5) Encore sits in 'dying' ~90 sim-s (guard B.die() re-entry, 13_bosses 165; trace why); (6) Events.update mutates Ev.active while iterating (stop by identity via indexOf); (7) Enemies.kill frees wrong slot if onDeath frees a lower index (gen stamp before P.free); (8) Enemies.update double-integrates when d.update kills its own row (gen stamp + i--); (9) bullet onHit hooks can invalidate bullet index before killP (revalidate gen).
P2: (10) killManaSpent/Window not reset in Player.reset; (11) Arena.setRadius instant path never marks crush band; (12) revealAlpha(0,0) in Bullets.render (dup of design F23); (13) Bosses.damage with phase -1; (14) killAll(false) leaves spawned children; (15) draftOpen emitted with empty offers.
-> Add "Group I (13c angler+depth hitTest, 13_bosses die guard/phase guard, 10_enemies gen stamps + killAll, 08_bullets gen revalidate, 06_arena setRadius, 09_player reset, 12_events stop-by-identity)" — P0 first thing tomorrow, before the 1->31 run in TODO step 3. Merge with Groups C/H where files overlap.

### Siren fixer — DONE (13d_bosses_3.js siren block ~L953-1269, 98_bot.js L432-459)
Root cause was deterministic aliasing (bot dash rhythm ~1/5 s never coincided with a 10 s song / 0.22 s window). Fix: SIREN_WINDOW 0.45, every 4th song a 0.8 s chorus, mercy widening after 25 s without a landed dash (up to 2.5x, snaps back on hit), boss publishes b.dashHintT / b.dashWindowOpen, 0.9 s orange->red lead-in ring + ticks on L.VEIL, gold (not white) burst. Bot: new timed-dash rule (dash when window open or <=0.10 s away) and banks mana on hint-publishing bosses.
Verified: node --check, build, smoke OK; `--boss=siren --bot --god --fast=4 --frames=6000` OK 0 errors (siren dies ~42 sim-s, 9/9 dashes landed).
NOT verified: full `--untilWave=31` run was at wave 12 with 0 errors when cut off; it will stall at wave 13 (Angler P0) anyway. Re-run after the Group I P0 fix.
Observation: waves 3 (tide, ~300 s) and 12 (depth, ~200 s) are slow for the bot, close to the 360 s waveSec watchdog. Consider raising the watchdog for the bot run or adding surface-forcing (already in Group I).

### Boss/wave design fixer (13b/13c/14_waves) — NO REPORT at pause
Still running when the session paused. Tomorrow: `git`-less tree, so check mtimes of src/13b_bosses.js, src/13c_bosses_2.js, src/14_waves.js and read its output file
`C:\Users\stier\AppData\Local\Temp\claude\d---games\0104e6e0-e1c5-43b4-aca0-41edd360cd00\tasks\a29608d2d36cbccfd.output`. Assume partial edits: run node --check on those three files first. Its task was design findings F6/F8/F11/F18 (13b congregation, 13c encore crack, 14_waves endless bleed) — if half done, fold the remainder into Group I (13c) / Group E.

## Resume tomorrow (2026-09-05): start at TODO step 1 above. Order of fixers: Group I P0 (Angler/Depth) alone first, then A-H in parallel with no shared files.

## 2026-09-05 morning — fixers launched (boss/wave fixer from last night was cancelled; its F6/F8/F11/F18 leftovers folded into Fixer 1)
- Fixer 1 (13_bosses, 13b, 13c, 13d, 14_waves): Group I P0 Angler/Depth, die/phase guards, F6/F8/F11/F18 leftovers, Group E, compat #13, tide/depth pacing.
- Fixer 2 (05_pools, 06_arena, 08_bullets, 10*, 12_events): correctness gen stamps/killAll/stop-by-identity/setRadius, Group C, enemyFireMul hook, perf #3/#4/#5/#6/#10/#12.
- Fixer 3 (09_player, 11_upgrades, 11b): Groups A+B, Player.reset, flat hook arrays.
- Fixer 4 (01,02,03,04,07,15,16,98,99, tools/*): UI 1-15, F5 rim HUD, LAYER_ADD[7]=0, Draft.reroll guard, Group G compat, perf #7/#14/#15/star scaling.
Next: when all four report, run full verification (TODO step 5), then ARCHITECTURE.md §25 notes, then final report.
- Fixer 2 DONE: correctness P1-6/7/8/9, P2-11/14; Group C F3/F4/F19/F20/F23 subset; enemyFireMul hook read (10_enemies ~405); perf #3 (arena ring cache, 0.7→0.2 ms), #4, #5, #12 (Grid.query(x,y,r,dst), out2/out3). Stress 3.5-4.4 ms, wave 28 1.21 ms. Left for Fixer 3: perf #6/#10 + damageArea grid. Known: --nogl --stress 63 ms/frame (02_render 2D path).
- Docs DONE: ARCHITECTURE §25.14-25.22 (+ §25.3 superseded pointer), GAME_PLAN §5.2 F22 amendment. §25.18 camera section still says 1700 / zoomed in → re-run docs agent after Fixer 4 lands the ~30% zoom-out + ARENA_R ~1900.
- Fixer 5 DONE: music.start in Audio.init + gesture re-entry (03_audio 172-180, 229); perf #7 already present (verified); build.js vm.Script check + numeric sort; 99_boot --prof avgMs budget (MS_BUDGET, ?msBudget=N); test.js --strict + --msBudget passthrough. Harness untilWave=3 OK 0.75 ms avg. Note: harness runs with Audio.enabled=false so music/sfx only validated in a stub harness. Open: compat #10 dimPage on body (Fixer 4).
- Fixer 3 DONE: Group A (F1 ornament cap ORN_MAX 0.55 + core second pass on VEIL, F17 railgun gate w/ auto-release at full charge, F21 four tier visuals), Group B all (hDamage/hPD wrappers 11b:94-137, feedbackLoop via grazeMul + enemyFireMul 1/1.3, mines 12, overkill per-bullet carry, shard lifetime, gambler take(), burnTrail setBurn), Player.reset, flat hook arrays, damageArea grid, gravityWell ebGrid. Stress 4.0 ms avg. Note: damageArea truncates >~1024 hits (grid.truncated). Skipped wake-T3 radius nerf.
- Fixer 4 DONE: UI 1-15, F5 screen-space rim HUD (15_ui HUD.renderScreenRim ~376), LAYER_ADD[7]=0, ending double-draw, Draft.reroll guard, compat GL-loss/initGL try/Atlas guard/params/resize/2D vignette/dimPage #wrap, perf #14/#15, R.bgQuota helper. CAMERA: VIEW 1430x806 (+30%), ARENA_R 1900 / MIN 514, bossZoom ref 2080. GL vs nogl wave-15 screenshots match (no white blowout). --nogl --stress 63.6 ms (fails 33 ms budget; artificial scene). Screenshot tools/out/screen-cam5.png.
- Fixer 6 launched (12_events bgQuota star scaling, 11_upgrades onSpend alloc). Encore 13c cleanup routed to Fixer 1.
- Fixer 6 DONE: bgQuota in drawLobes/Stars/Dust (12_events 580-611), crossfade skipped below tier 2 (628-635), SPCTX for onSpend (11_upgrades 2076). Stress 3.82 ms avg. Build 31008 lines / 1306 KiB.
- Fixer 7 DONE (owner feel requests): reticle → cyan dot r2 + hairline ring (09_player 480-486); BULLET_SPEED 1250→1475, BULLET_LIFE 1.6→1.42 (01_core 72-73, range +4.7%); player streak 2.6→1.6 (08_bullets 332). ghostRounds overlay 2.4→1.5 (11b:1853, orchestrator). Screenshots tools/out/screen-feel-before/after.png.
- WATCH: Fixers 6 and 7 both saw `--bot --god --fast=4 --untilWave=4` fail with "frame budget spent at wave 1 (boss)" while Fixers 4/5 passed it earlier. Fixer 1 is mid-edit in 13_bosses/13b (compactor) — re-check after Fixer 1 reports; if still failing it's a regression in 13* or the harness default --frames.
- Fixer 1 DONE: P0 Angler/Depth hitTest distance-first + 12 s forced windows (13c 975-985, 678-690, 934-935); die() re-entry + phase<0 guards (13_bosses 166, 141); Encore dying traced to wall-clock draft timeout → bot fast-path (13c 495-508); F6/F8/F11/F18/F23 verified + usInit extraIds; Group E F9/F10/understudyPerfect; dbg gate; tide tracks nearest eye + middle-eye phase 3 (13b ~596-616): tide 380→50-78 s, depth 27 s, angler 138 s. `--fast=6 --untilWave=15` reached wave 15, 0 errors. Residue: one non-reproducible Constellation 200 s stall at wave 2; bot lacks aim lead (cartographer ~250 s).
## All fixers complete 2026-09-05. Next: bot aim lead (98_bot), verification pass, docs §25.18 camera refresh, final report.
- Docs refresh DONE: §25.1/§25.18 camera numbers, §25.23 boss reachability.
- Bot aim lead + sticky probe DONE (98_bot 262-585, 700-748). Cartographer wave 8 ~250→36 s; untilWave=10 in 770 s sim, 0 errors.
- Verification A DONE: 28/30 bosses die; nogl/domcheck/strict/stress(3.7 ms) OK; draft screen clean. BLOCKING: singularity takes 0 damage; duoBaitSwitch hp 0 never dies (same signature seen on a wave-33 endless boss); endless wave 31 stalls with 1 off-screen enemy never engaged; DIAG=true console.error shipped in 98_bot for 3 builds (now removed, needs guard). COSMETIC: wave-15 ship is a white starburst (white ≠ core only); wave-25 magenta beam density buries ship; 2D core orange-red; rim HUD dot too small to be useful; metronome 286 s / cartographer 366 s isolated.
- Round 2 fixers launched: A (13*, 14_waves) singularity/duoBaitSwitch/metronome; B (98_bot, 10_enemies) endless stall + DIAG guard; C (09_player, 11*, 15_ui, 02_render) ship whites, rim HUD, 2D core; D (12_events, 10b, 10c) wave-25 beam density.
- R2-D DONE: wave-25 "beams" were Glazier mirror walls stretched by a Rotator missing-dt runaway (10c). Fixes in 10c only: GLAZ_SEG_MAX 340, global pane budget 22, per-glazier 8; prism PR_LEN 950, body non-additive on EBULLETS; rotator dt fix (landed concurrently by another agent, equivalent). Screenshots tools/out/screen-r2-w25-before/after.png. NOTE: 10c was edited by two agents concurrently (R2-B?) — node --check it before final build.
- R2-C DONE: white starburst was the muzzle flash (09_player 473: now hull-coloured 13 px 0.45); ornament highlights cyan-tinted; core glow cyan, dot white; glassHull/mirror retints (11b); burnTrail skips ship footprint. Rim HUD: inward chevrons 12-15 px, pulse ≤3 left (15_ui 415-441). 2D core was fine (burnTrail overlay). Screenshots tools/out/screen-r2-w15/w25/nogl15/w15full.png.
## STOPPED by owner mid round 2 (2026-09-05). Killed: R2-A (13*/14_waves: singularity/duoBaitSwitch/metronome — edits made, harness verification NOT run), R2-B (98_bot/10_enemies: endless stall + DIAG guard — wave-8 run passed, endless run unverified), Verification B (full 1→31 run — no report). On resume: node --check all, build, smoke, then re-run `--boss=singularity`, `--boss=duoBaitSwitch`, `--boss=metronome`, endless `--endless=31 --untilWave=40`, and the full `--untilWave=31` run before anything else.
