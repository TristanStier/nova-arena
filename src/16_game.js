/* 16_game.js — the state machine, the event bus, and the main loop.
 *
 * Public API
 *   NA.Game.on(event, cb) / off(event, cb) / emit(event, data)
 *     events: waveStart waveClear draftOpen draftPick bossIntro bossPhase
 *             bossDeath playerHit playerDeath kill stateChange victory
 *   NA.Game.state      'title'|'wave'|'lastkill'|'sweep'|'draft'|'overview'|'boss'
 *                      |'death'|'pause'|'ending'|'stress'
 *   NA.Game.setState(s)
 *   NA.Game.wave       current wave number
 *   NA.Game.endless    true once wave 31+ is running
 *   NA.Game.newRun(seed) / NA.Game.startWave(n) / NA.Game.restart()
 *   NA.Game.title() / NA.Game.toTitle()
 *   NA.Game.pause() / NA.Game.resume() / NA.Game.paused
 *   NA.Game.victory() / NA.Game.toEndless()
 *   NA.Game.notePick(id)          record a drafted upgrade in the run timeline
 *   NA.Game.picks / bossesBeaten  this run's history (used by death + ending)
 *   NA.Game.replay / replayN / replayHead / REPLAY_MAX / killerX / killerY
 *   NA.Game.nextDraftCards        set to 4/5 to widen the next draft
 *   NA.Game.continueRun()         infinite lives: replay the wave you died on
 *   NA.Game.deaths                deaths so far this run (shown at the end)
 *   NA.Game.step(dt)   one fixed simulation step
 *   NA.Game.render()
 *   NA.Game.frame(ts)  the rAF callback (installed by 99_boot.js)
 *   NA.Game.stress()   spawn the stress scene (500 motes, 5000 bullets, 3000 particles)
 *
 * Transition timings are GAME_PLAN 12.4:
 *   last kill 0.6s slow-mo -> sweep 0.4s -> draft -> transform 0.3s ->
 *   zoom out 0.8s (full control) -> materialize 1.0s -> boss intro 1.5s ->
 *   zoom in 0.5s -> a white "go" ring.  Skips are hold-not-tap (0.3s).
 *
 * Menus run on REAL time from NA.UI.tick(), never on the simulation clock: a
 * 5% time scale must not make a click take three frames to register.
 */
(function () {
  var M = NA.M, C = NA.C;

  var listeners = Object.create(null);
  var REPLAY_MAX = 64;                 // ~2s of death-replay samples at 30Hz

  var G = NA.Game = {
    state: 'title', prevState: '', stateT: 0,
    wave: 0, seed: 1, running: false,
    lastFrame: 0, skipHeld: 0,
    goRing: 0,
    paused: false, endless: false, newRecord: false,
    nextDraftCards: 0,

    picks: [], bossesBeaten: [],

    REPLAY_MAX: REPLAY_MAX,
    replay: new Float32Array(REPLAY_MAX * 5),
    replayN: 0, replayHead: 0, _replayT: 0,
    killerX: 0, killerY: 0,

    on: function (e, cb) { (listeners[e] || (listeners[e] = [])).push(cb); return cb; },
    off: function (e, cb) { var a = listeners[e]; if (!a) return; var i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); },
    emit: function (e, data) {
      var a = listeners[e]; if (!a) return;
      for (var i = 0; i < a.length; i++) a[i](data);
    },

    setState: function (s) {
      G.prevState = G.state; G.state = s; G.stateT = 0;
      // A hold that predates the transition must not count as "held to skip":
      // the overview beat and the ending are both gated on holdTime > 0.3.
      if (NA.Input) NA.Input.holdTime = 0;
      G.emit('stateChange', s);
    },

    /* ------------------------------------------------------------ lifecycle */
    newRun: function (seed) {
      G.seed = seed || ((Date.now() ^ 0x5bf03635) >>> 0);
      NA.RNG.seed(G.seed);
      NA.Arena.reset();
      NA.Enemies.reset();
      NA.Bullets.reset();
      NA.Particles.clear();
      NA.Bosses.clear();
      // drops 13c's persistent effects and 13d's tickers as well (they chain)
      if (NA.Bosses.resetRun) NA.Bosses.resetRun();
      NA.Events.reset();
      NA.Upgrades.reset();
      NA.Ship.reset();
      NA.Player.reset();
      NA.FX.reset();
      NA.UI.reset();
      NA.Time.setTimeScale(1);
      G.wave = 0;
      G.deaths = 0;
      G.paused = false; G.endless = false; G.newRecord = false;
      G.picks.length = 0; G.bossesBeaten.length = 0;
      G.replayN = 0; G.replayHead = 0; G._replayT = 0;
      G.killerX = G.killerY = 0;
      G.nextDraftCards = 0;
      G._victoryEmitted = false; G._victoryFromBoss = false; G.victoryPending = false;
      G._draftReturn = '';
      NA.R.setPost({ darkness: 0, desat: 0 });
      NA.Cam.x = NA.Cam.tx = 0; NA.Cam.y = NA.Cam.ty = 0;
      NA.Cam.setZoom(1, 0);
    },

    title: function () {
      G.newRun();
      NA.Cam.fitArena(0);
      NA.UI.resetGate(0, -420);
      if (NA.Store.records.beat30) NA.UI.setGate2(420, -180, 'endless');
      G.setState('title');
    },
    toTitle: function () {
      NA.Time.setTimeScale(1);
      G.title();
    },

    startWave: function (n) {
      G.wave = n;
      if (n > 30) G.endless = true;
      NA.Waves.start(n);
      NA.Enemies.beacon = false;
      NA.Time.setTimeScale(1);
      NA.Cam.setZoom(1, 500);
      G.goRing = 0.4;
      NA.Particles.ring(NA.Player.x, NA.Player.y, 20, 220, 0.45, 3, 1, 1, 1, 0.9);
      G.setState('wave');
      G.emit('waveStart', n);
    },

    restart: function () {
      G.newRun();
      NA.Cam.setZoom(1, 0);
      G.startWave(1);
    },

    /* ------------------------------------------------- infinite lives
     * Owner request: dying never ends the run.  The death screen's primary
     * gate calls this: the wave you died on restarts with your build, your
     * picks and your boss log intact, the death counter ticks up by one, and
     * the counter is what the ending screen reports instead of a life total.
     * Nothing is taken away from you here (AGENT_RULES 7) -- the only cost of
     * a death is the number on the wall at the end. */
    continueRun: function () {
      var w = G.wave || 1;
      NA.Enemies.reset();
      NA.Bullets.reset();
      NA.Particles.clear();
      NA.Bosses.clear();
      NA.Events.reset();
      NA.FX.reset();
      NA.UI.reset();
      NA.Player.reset();
      NA.Upgrades.reapply();          // the build survives; stats come back
      NA.R.setPost({ darkness: 0, desat: 0 });
      if (NA.Audio && NA.Audio.music && NA.Audio.music.setLowpass) NA.Audio.music.setLowpass(0);
      G.paused = false;
      G._draftReturn = '';
      NA.Time.setTimeScale(1);
      NA.Cam.x = NA.Cam.tx = NA.Player.x; NA.Cam.y = NA.Cam.ty = NA.Player.y;
      NA.Cam.setZoom(1, 0);
      // a boss wave re-enters through toBoss so the fight is rebuilt properly
      var wd = NA.Waves.get(w);
      if (wd && wd.boss) { G.wave = w; NA.Waves.start(w); G.toBoss(); }
      else G.startWave(w);
    },

    /* Dev entry: ?wave=N starts there with a plausible build. */
    startAt: function (n) {
      G.newRun();
      // the waves agent owns ?wave=N setup: biome, retirements and a random build
      if (NA.Waves.devStart) { NA.Waves.devStart(n); return; }
      var ids = NA.Upgrades.list;
      for (var i = 0; i < Math.min(ids.length, Math.floor(n / 2)); i++) G.notePick(ids[i % ids.length], true);
      G.startWave(n);
    },

    /* the run's upgrade timeline (death screen + ending rings read this) */
    notePick: function (id, take) {
      if (take) NA.Upgrades.take(id);
      if (id) G.picks.push(id);
    },

    /* ------------------------------------------------------- pause / menu */
    pause: function () {
      if (G.state === 'pause' || G.state === 'death' || G.state === 'stress') return;
      G._pauseFrom = G.state;
      // the whole ramp, not just the scalar: restoring with setTimeScale(s)
      // destroys an in-flight slowmo and pins the sim at the mid-ramp value.
      var T = NA.Time;
      G._pauseScale = T.timeScale;
      G._pauseTs = { from: T._tsFrom, target: T._tsTarget, dur: T._tsDur, timer: T._tsTimer };
      G.paused = true;
      G.setState('pause');
      if (NA.UI.openMenu) NA.UI.openMenu();
    },
    resume: function () {
      if (G.state !== 'pause') return;
      G.paused = false;
      if (NA.UI.closeMenu) NA.UI.closeMenu();
      NA.Store.save();
      G.setState(G._pauseFrom || 'wave');
      var T = NA.Time, ps = G._pauseTs;
      T.setTimeScale(G._pauseScale === undefined ? 1 : G._pauseScale);
      if (ps && ps.dur > 0 && ps.timer < ps.dur) {
        T._tsFrom = ps.from; T._tsTarget = ps.target; T._tsDur = ps.dur; T._tsTimer = ps.timer;
      }
    },

    /* ---------------------------------------------------- victory / endless */
    victory: function () {
      if (G.state === 'ending') return;
      G.victoryPending = false;
      NA.Enemies.killAll(true);
      NA.Bullets.reset();
      NA.Bosses.clear();
      NA.Arena.setRadius(C.ARENA_R, 1.2);
      NA.Store.records.beat30 = 1;
      NA.Store.records.best = Math.max(NA.Store.records.best || 0, G.wave);
      G.saveRunRecord();
      NA.Cam.fitArena(1400);
      if (!G._victoryEmitted) { G._victoryEmitted = true; G.emit('victory', G.wave); }
      G.setState('ending');
    },
    /* the Encore gate: endless picks up at wave 31 through NA.Waves.endless */
    toEndless: function () {
      G.endless = true;
      NA.Store.records.beat30 = 1;
      NA.Store.save();
      NA.FX.reset();
      NA.R.setPost({ darkness: 0, desat: 0 });
      NA.UI.reset();
      NA.Time.setTimeScale(1);
      NA.Events.stopAll();
      if (NA.Waves.endless) NA.Waves.endless(31);   // let the generator warm up
      G.startWave(31);
    },

    saveRunRecord: function () {
      var r = NA.Store.records, k;
      if (G.wave > (r.best || 0)) { r.best = G.wave; G.newRecord = true; }
      if (G.newRecord || !r.bestSlots) {
        r.bestSlots = {};
        for (k in NA.Ship.slots) r.bestSlots[k] = NA.Ship.slots[k];
        r.bestBuild = G.picks.slice(0, 20);
        r.bestBosses = G.bossesBeaten.slice(0, 20);
      }
      r.runs = (r.runs || 0) + 1;
      NA.Store.save();
    },

    /* -------------------------------------------------- dev screen routing */
    /* ?screen=title|draft|death|pause|ending — used for look iteration only. */
    _devApplied: false,
    devScreen: function (name) {
      if (G._devApplied) return;
      G._devApplied = true;
      if (name === 'title') { G.title(); return; }
      var demo = ['twinBarrels', 'blast', 'afterburner', 'shardOrbit', 'glassHull', 'voltaic'];
      function seedBuild() {
        // only when no upgrades agent has landed yet, so the draft has cards
        if (!NA.Upgrades.list.length) {
          for (var i = 0; i < demo.length; i++) {
            NA.Upgrades.define(demo[i], {
              family: i > 3 ? 'wild' : 'projectile',
              wildcard: i === 4,
              tags: [['explode', 'kill'], ['pierce'], ['dash', 'mana'],
              ['orbital'], ['zone', 'spend'], ['bounce', 'kill']][i],
              visual: { slot: ['barrels', 'core', 'trail', 'orbitals', 'hull', 'halo'][i] },
              tiers: [{ apply: function () { } }, { apply: function () { } }, { apply: function () { } }]
            });
          }
        }
      }
      if (name === 'draft') {
        seedBuild();
        G.newRun(12345); G.startWave(1);
        NA.Upgrades.take(NA.Upgrades.list[0]);
        NA.Draft.open(4);
        G.setState('draft');
      } else if (name === 'death') {
        seedBuild();
        G.newRun(12345); G.startWave(7);
        for (var i = 0; i < Math.min(5, NA.Upgrades.list.length); i++) G.notePick(NA.Upgrades.list[i], true);
        NA.Store.records.best = 5;
        for (var q = 0; q < 40; q++) { G._replayT = 1; G.recordReplay(1 / 30); NA.Player.x += 6; }
        NA.Player.kill(NA.Player.x + 90, NA.Player.y - 40);
      } else if (name === 'pause') {
        seedBuild();
        G.newRun(12345); G.startWave(3);
        for (var j = 0; j < Math.min(4, NA.Upgrades.list.length); j++) G.notePick(NA.Upgrades.list[j], true);
        G.pause();
      } else if (name === 'ending') {
        seedBuild();
        G.newRun(12345); G.startWave(30);
        for (var k = 0; k < Math.min(6, NA.Upgrades.list.length); k++) G.notePick(NA.Upgrades.list[k], true);
        G.bossesBeaten.push('compactor', 'constellation', 'metronome', 'strobe', 'horizon');
        G.victory();
      }
    },

    /* ---------------------------------------------------------- stress scene */
    stress: function () {
      G.newRun();
      G.setState('stress');
      NA.Cam.fitArena(0);
      var R = NA.Arena.radius;
      for (var i = 0; i < 500; i++) {
        var a = NA.RNG.f() * M.TAU, r = Math.sqrt(NA.RNG.f()) * R * 0.92;
        var e = NA.Enemies.spawn(i % 7 === 0 ? 'spitter' : 'mote',
          Math.cos(a) * r, Math.sin(a) * r);
        if (e >= 0) { NA.Enemies.spawnT[e] = 0; NA.Enemies.intangible[e] = 0; }
      }
      for (var b = 0; b < 2500; b++) {
        var ba = NA.RNG.f() * M.TAU, br = NA.RNG.f() * R * 0.9;
        var bs = 500 + NA.RNG.f() * 500, bd = NA.RNG.f() * M.TAU;
        NA.Bullets.firePlayer(Math.cos(ba) * br, Math.sin(ba) * br,
          Math.cos(bd) * bs, Math.sin(bd) * bs, { life: 999 });
        NA.Bullets.fireEnemy(Math.cos(ba) * br, Math.sin(ba) * br,
          Math.cos(bd + 1) * bs, Math.sin(bd + 1) * bs, { life: 999, color: C.COL.magenta });
      }
      NA.R.particleCap = 3200;
      for (var p = 0; p < 3000; p++) {
        var pa = NA.RNG.f() * M.TAU, pr = NA.RNG.f() * R;
        NA.Particles.spawn(Math.cos(pa) * pr, Math.sin(pa) * pr,
          NA.RNG.range(-60, 60), NA.RNG.range(-60, 60), 999, 3,
          NA.RNG.f(), NA.RNG.f(), 1, 1, 2, 0.05);
      }
      NA.Events.trigger('supernova');
    },

    /* The stress scene is a steady state, not a one-shot: bullets pop on the
     * membrane and motes die to the player, so the population is topped up
     * every frame. That is the 60fps target, not an average. */
    stressTick: function (dt) {
      var R = NA.Arena.radius;
      NA.Player.invuln = 1;                       // the target is throughput, not survival
      NA.R.particleCap = 3200;
      var E = NA.Enemies;
      for (var g = 0; E.n < 500 && g < 40; g++) {
        var a = NA.RNG.f() * M.TAU, r = Math.sqrt(NA.RNG.f()) * R * 0.92;
        var e = E.spawn(g % 7 === 0 ? 'spitter' : 'mote', Math.cos(a) * r, Math.sin(a) * r);
        if (e < 0) break;
        E.spawnT[e] = 0; E.intangible[e] = 0; E.hp[e] = 1e6;   // keep the crowd alive
      }
      var B = NA.Bullets, made = 0;
      while (B.P.n < 2500 && made++ < 200) {
        var ba = NA.RNG.f() * M.TAU, br = NA.RNG.f() * R * 0.85;
        var bd = NA.RNG.f() * M.TAU, bs = 400 + NA.RNG.f() * 400;
        B.firePlayer(Math.cos(ba) * br, Math.sin(ba) * br, Math.cos(bd) * bs, Math.sin(bd) * bs,
          { life: 8, dmg: 0, bounce: 40 });
      }
      made = 0;
      while (B.E.n < 2500 && made++ < 200) {
        var ea = NA.RNG.f() * M.TAU, er = NA.RNG.f() * R * 0.85;
        var ed = NA.RNG.f() * M.TAU, es = 300 + NA.RNG.f() * 300;
        B.fireEnemy(Math.cos(ea) * er, Math.sin(ea) * er, Math.cos(ed) * es, Math.sin(ed) * es,
          { life: 8, bounce: 40, color: C.COL.magenta, dmg: 0 });
      }
      made = 0;
      while (NA.Particles.pool.n < 3000 && made++ < 300) {
        var pa = NA.RNG.f() * M.TAU, pr = NA.RNG.f() * R;
        NA.Particles.spawn(Math.cos(pa) * pr, Math.sin(pa) * pr,
          NA.RNG.range(-90, 90), NA.RNG.range(-90, 90), 2.5, 3,
          NA.RNG.f(), NA.RNG.f(), 1, 1, 2, 0.05);
      }
    },

    /* ------------------------------------------------- the death replay ring */
    recordReplay: function (dt) {
      G._replayT += dt;
      if (G._replayT < 1 / 30) return;
      G._replayT = 0;
      var P = NA.Player, i = G.replayHead * 5, rp = G.replay;
      rp[i] = P.x; rp[i + 1] = P.y;
      var ei = NA.Enemies.nearestTo(P.x, P.y, 700);
      if (ei >= 0) { rp[i + 2] = NA.Enemies.x[ei]; rp[i + 3] = NA.Enemies.y[ei]; rp[i + 4] = 1; }
      else { rp[i + 2] = 0; rp[i + 3] = 0; rp[i + 4] = 0; }
      G.replayHead = (G.replayHead + 1) % REPLAY_MAX;
      if (G.replayN < REPLAY_MAX) G.replayN++;
    },

    /* the thing that killed you, for the highlighted ghost replay */
    findKiller: function () {
      var P = NA.Player, B = NA.Bullets.E, i, best = -1, bd = 1e9;
      for (i = 0; i < B.n; i++) {
        var dx = B.x[i] - P.x, dy = B.y[i] - P.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      if (best >= 0 && bd < 260 * 260) { G.killerX = B.x[best]; G.killerY = B.y[best]; return; }
      var ei = NA.Enemies.nearestTo(P.x, P.y, 420);
      if (ei >= 0) { G.killerX = NA.Enemies.x[ei]; G.killerY = NA.Enemies.y[ei]; return; }
      var b = NA.Bosses.active;
      if (b) { G.killerX = b.x; G.killerY = b.y; return; }
      G.killerX = P.x; G.killerY = P.y - 60;
    },

    /* ------------------------------------------------------------- sim step */
    step: function (dt) {
      var s = G.state;
      G.stateT += dt;
      if (NA.Audio && NA.Audio.update) NA.Audio.update(dt);   // optional in the real audio module
      NA.Events.update(dt);
      NA.Arena.update(dt);
      NA.HUD.update(dt);

      // the draft's own input runs at real time in NA.UI.tick(); the sim only
      // has to notice when it closed.
      if (s === 'draft' && !NA.Draft.active) {
        if (G._draftReturn) { var back = G._draftReturn; G._draftReturn = ''; G.setState(back); }
        else G.toOverview();
        s = G.state;
      }

      if (s !== 'draft') {
        NA.Player.update(dt);
        NA.Enemies.update(dt);
        NA.Bullets.update(dt);
        NA.Bosses.update(dt);
        NA.Upgrades.update(dt);
      }
      NA.Particles.update(dt);
      NA.FX.update(dt);
      if (G.goRing > 0) G.goRing -= dt;
      if (s === 'wave' || s === 'boss') G.recordReplay(dt);

      switch (s) {
        case 'stress':
          G.stressTick(dt);
          break;

        case 'title':
          if (NA.UI.gateEntered()) { NA.RNG.seed(G.seed); G.startWave(1); }
          else if (NA.UI.gate2Entered()) { NA.RNG.seed(G.seed); G.toEndless(); }
          break;

        case 'wave':
          NA.Waves.update(dt);
          if (NA.Waves.done) {
            // last kill: 0.25x time for 700ms, 15% zoom toward the kill
            NA.Time.slowmo(0.25, 700);
            NA.Cam.setZoom(NA.Cam.zoom * 1.15, 300);
            NA.FX.chroma(2.5, 250);
            if (NA.Audio) NA.Audio.sfx('waveClear');
            G.emit('waveClear', G.wave);
            G.setState('lastkill');
          }
          break;

        case 'lastkill':
          // any input ends the slow-mo early
          if (G.stateT > 0.6 || NA.Input.anyPressedThisFrame) G.setState('sweep');
          break;

        case 'sweep':
          if (G.stateT > 0.4) {
            NA.Time.setTimeScale(1);
            var cards = (NA.Waves.draftCards ? NA.Waves.draftCards(G.wave) : (G.wave % 6 === 0 ? 4 : 3));
            if (!NA.Draft.open(cards)) G.toOverview();
            else G.setState('draft');
          }
          break;

        case 'overview':
          // zoom-out with full control; enemies of the next wave materialize
          if (G.stateT > 1.6 || NA.Input.holdTime > 0.3) G.toBoss();
          break;

        case 'boss':
          if (NA.Waves.bossTick) NA.Waves.bossTick(dt);   // endless boss mutators
          var b = NA.Bosses.active;
          if (!b || b.state === 'dead') {
            if (b && b.id && G.bossesBeaten.indexOf(b.id) < 0) G.bossesBeaten.push(b.id);
            NA.Bosses.clear();
            NA.Arena.setRadius(C.ARENA_R, 1.0);
            NA.Cam.setZoom(1, 500);
            NA.Time.setTimeScale(1);
            // wave 30's finale ends the run; everything after it is endless
            if (G.victoryPending || (G.wave >= 30 && !G.endless)) G.victory();
            else G.startWave(G.wave + 1);
          }
          break;

        case 'death':
          // the gate and the restart live in NA.UI.tick (real time, <1s)
          break;
      }
    },

    toOverview: function () {
      // camera eases out over 0.8s until the whole ring fits; time slows to 0.3x
      NA.Cam.fitArena(800);
      NA.Time.setTimeScale(0.3);
      G.setState('overview');
    },

    toBoss: function () {
      NA.Time.setTimeScale(1);
      var w = NA.Waves.get(G.wave);
      var id = (w && w.boss) || NA.Bosses.list[0];
      NA.Enemies.killAll(true);
      NA.Bullets.reset();
      if (id && NA.Bosses.spawn(id)) G.setState('boss');
      else if (G.wave >= 30 && !G.endless) G.victory();
      else G.startWave(G.wave + 1);
    },

    /* -------------------------------------------------------------- render */
    render: function () {
      var R = NA.R;
      R.begin();
      NA.Events.renderBackdrop();
      NA.Arena.render();
      if (G.state === 'wave') NA.Waves.render();
      NA.Particles.render();
      NA.Bullets.render();
      NA.Enemies.render();
      NA.Bosses.render();
      // F23: the finale's own 8.1 spectacle draws the ship at the arena centre
      // while it holds in 'dying'. Drawing the live ship as well put two ships
      // on screen for that ~1 s. The boss owns the frame until it releases.
      G._endBossOwns = (G.state === 'ending' && NA.Bosses.active &&
        NA.Bosses.active.state === 'dying') ? 1 : 0;
      if (!G._endBossOwns) NA.Player.render();
      NA.Events.renderVeil();
      NA.Upgrades.render();

      NA.UI.renderState();
      if (G.goRing > 0) {
        var k = 1 - G.goRing / 0.4;
        R.ring(R.L.VEIL, NA.Player.x, NA.Player.y, 20 + k * 260, 3, 1, 1, 1, (1 - k) * 0.9);
      }
      NA.HUD.render();
      NA.FX.apply();
      NA.UI.post();
      R.end();
      NA.UI.renderOverlay();
    },

    /* The OS cursor is hidden only while flying, where the ship's reticle
     * already marks the aim point. In the title, the draft, the pause menu,
     * the death screen and the ending you need to see what you are clicking,
     * so the arrow comes back. Only touches the DOM when the answer changes. */
    _cursorHidden: null,
    syncCursor: function (st) {
      var hide = st === 'wave' || st === 'boss' || st === 'lastkill' ||
        st === 'sweep' || st === 'overview' || st === 'stress';
      if (hide === G._cursorHidden) return;
      G._cursorHidden = hide;
      if (typeof document === 'undefined' || !document.body) return;
      document.body.classList.toggle('na-cursor-none', hide);
      document.body.classList.toggle('na-cursor-show', !hide);
    },

    /* ---------------------------------------------------------- frame loop */
    frame: function (ts) {
      var realDt = G.lastFrame ? (ts - G.lastFrame) / 1000 : 1 / 60;
      G.lastFrame = ts;
      if (realDt > 0.1) realDt = 0.1;
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

      NA.Input.poll(realDt);
      if (!G._devApplied && NA.params && NA.params.screen) G.devScreen(NA.params.screen);
      // menus, the draft, the title and the death screen run on real time so a
      // 5% simulation never eats a click.
      NA.UI.tick(realDt);

      if (!G.paused) {
        var steps = NA.Time.begin(realDt);
        for (var i = 0; i < steps; i++) { G.step(NA.Time.fixed); NA.Time.frames++; }
      }
      if (NA.Audio && NA.Audio.setListener) NA.Audio.setListener(NA.Player.x, NA.Player.y);
      NA.Cam.update(realDt > 0.05 ? 0.05 : realDt);
      // the camera targets the ship plus 25% of the aim vector
      var s = G.state;
      if (s !== 'overview' && s !== 'title' && s !== 'stress' && s !== 'pause' && s !== 'ending') {
        NA.Cam.follow(NA.Player.x, NA.Player.y, NA.Player.aimX - NA.Player.x, NA.Player.aimY - NA.Player.y);
        /* ONE combat zoom, everywhere. The owner asked for the framing to be
         * identical in a regular wave and in a boss fight, so the per-boss
         * camZoom pull-out and the crowd "breath" are both gone: the whole
         * fight is read at C.VIEW_W world units wide. Per-boss `camZoom` is
         * now dead framing data (NA.Cam.bossZoom is left in place but nothing
         * calls it). Transient punch-ins (setZoom with a duration) still play
         * — they set _zdur — and then settle back to 1. */
        if (NA.Cam._zdur <= 0) NA.Cam.tzoom = 1;
      }
      G.syncCursor(s);
      if (!NA.params.norender) G.render();
      NA.Input.endFrame();

      var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      NA.R.reportFrame(t1 - t0, realDt);
    }
  };

  // player death routes into the death state
  G.on('playerDeath', function () {
    G.deaths = (G.deaths | 0) + 1;   // counted here so the death screen's own
                                     // tally already includes the death you
                                     // are looking at
    G.findKiller();
    G.saveRunRecord();
    if (NA.Audio && NA.Audio.music && NA.Audio.music.setLowpass) NA.Audio.music.setLowpass(0.8);
    NA.UI.gate.active = false;
    NA.UI.gate3.active = false;
    NA.UI.gate.passed = false;
    G.paused = false;
    // Nothing else runs onEnd() in state 'death', so a fourth-wall boss would
    // otherwise leave the page dimmed, scrollable and littered with DOM for
    // the whole death screen - and the HUD detached (UI review 2 and 11).
    if (NA.Bosses && NA.Bosses._fourthWallSweep) NA.Bosses._fourthWallSweep();
    else if (NA.UI.fourthWall && NA.UI.fourthWall.reset) NA.UI.fourthWall.reset();
    if (NA.UI.fourthWall && NA.UI.fourthWall.hudAttachAll) NA.UI.fourthWall.hudAttachAll();
    G._draftReturn = '';
    if (NA.Draft && NA.Draft.active && NA.Draft.close) NA.Draft.close();
    G.setState('death');
  });
  /* The Singularity emits 'victory' itself while its own §8.1 spectacle plays
   * and the boss framework holds in 'dying'. The calm, the rings and the gate
   * take over once it releases. */
  G.on('victory', function () {
    G._victoryEmitted = true;
    if (G.state === 'ending') return;
    G._victoryFromBoss = !!(NA.Bosses.active && NA.Bosses.active.state !== 'dead');
    G.victoryPending = true;
    NA.Store.records.beat30 = 1;
    G.saveRunRecord();
  });
  /* A draft opened from inside a fight (the Encore's bonus cards) must run as
   * a real 'draft' state: the sim suspends, the pause menu and the draft stop
   * sharing a click, and a stray bullet cannot kill you mid-pick. The state is
   * restored when the draft closes (Game.step). */
  G.on('draftOpen', function () {
    var st = G.state;
    if (st === 'boss' || st === 'lastkill') { G._draftReturn = st; G.setState('draft'); }
  });
  G.on('playerHit', function () { NA.HUD.bump(); });
  G.on('draftPick', function () { NA.HUD.bump(); });

  if (NA.UI && NA.UI.wire) NA.UI.wire();
})();
