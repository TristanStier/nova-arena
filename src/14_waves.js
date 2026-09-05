/* 14_waves.js — the 30-wave script, the wave runner, and endless mode.
 * Owned by the waves agent.  GAME_PLAN §2, §4, §7, §8 (+§8.2).
 *
 * Public API (the foundation stub's API, extended)
 *   NA.Waves.KNOBS          every difficulty dial in one place
 *   NA.Waves.script[n]      { act, biome, newTypes, retire, budget, roster, mix,
 *                             beats:[{t,type,count,gate,pos,swirl,overview}],
 *                             spikes:[{t,frac,type,count}], stream, closerTypes,
 *                             mutators, events, theme, draftCards, boss, pair }
 *   NA.Waves.get(n)         script[n], falling back to endless(n)
 *   NA.Waves.endless(n)     the §8.2 procedural remix (frozen roster, rolls,
 *                           reunion, guaranteed Cathedral/Singularity, boss mutators)
 *   NA.Waves.start(n) / update(dt) / render() / stop()
 *   NA.Waves.done / progress / phase ('ingress'|'body'|'spike'|'closer') / gates
 *   NA.Waves.simCap(n)      simultaneous-enemy ceiling for wave n
 *   NA.Waves.rosterAt(n) / retiredBefore(n) / newAt(n) / draftCards(n)
 *   NA.Waves.overviewPlan(n)  arena-alterer placements, so the overview can show
 *                             them before the wave starts and the player can plan
 *   NA.Waves.startEndless(n)  dev entry (?endless=N)
 *   NA.Waves.devStart(n)      dev entry (?wave=N): biome + retirements + a build
 *   NA.Waves.notes / debugNote()   ?debug=1 lines (e.g. enemy ids not yet defined)
 *   NA.Waves.bossTick(dt)     per-frame work for endless boss mutators
 *   NA.Waves.ambient          live ambient arena mutator flags
 *
 * Choreography — OWNER RULE (overrides GAME_PLAN §8 timing):
 *   A regular wave spawns its ENTIRE budget at once, at t=0, distributed
 *   around the rim gates so it arrives as a ring.  No ingress trickle, no
 *   drip, no mid-wave spike, no closer stream.  w.burst is that flat list of
 *   spawn groups; the runner dispenses it inside K.burstRamp (0.35s, cosmetic,
 *   so one frame never allocates a whole wave).  Composition is unchanged:
 *   the composer still resolves the same roster / counts / cost mix, and
 *   w.beats / w.spikes / w.stream are still authored for the overview and
 *   tools/waves_report.js — the runner just no longer spawns from them.
 *   Phases: 'body' from the arrival, 'closer' for the last 10% of the kills.
 *   The simultaneous cap is bypassed for the burst; the hard ceiling is the
 *   enemy pool (C.MAX_ENEMIES - K.burstReserve).  A budget over that is
 *   clamped, the remainder spawning as slots free, and noted on the overlay.
 * Waves end on kill count, never on a timer; a wave that stalls for 20s lights a
 * rim beacon and drifts the remainder toward the player.
 *
 * Enemy ids that are not registered at runtime (the enemy agents work in
 * parallel) are substituted by a role-appropriate registered type and noted on
 * the debug overlay.  Nothing here may ever throw because a type is missing.
 */
(function () {
  var M = NA.M, C = NA.C;

  /* ====================================================================
   * DIFFICULTY KNOBS — everything tunable lives here.
   * ================================================================== */
  var K = {
    /* budget curve: GAME_PLAN §4 is 12 x 1.28^wave.  The authored per-wave
     * budgets below track that curve; budgetScale rescales the whole game and
     * curveBase/curveGrow drive endless and any wave without an authored count. */
    curveBase: 12, curveGrow: 1.28, budgetScale: 1.0,

    /* simultaneous cap curve: rises, then plateaus at the performance ceiling */
    simCapBase: 26, simCapGrow: 1.22, simCapMax: 400,

    /* cost mix, GAME_PLAN §4: 55% filler, 30% texture, 15% problems */
    mix: { filler: 0.55, texture: 0.30, problem: 0.15 },
    /* a problem type may be spawned this many times its simultaneous cap per wave */
    problemChurn: 2.5,

    /* spikes */
    spikeFrac: 0.20, spikeWarn: 1.5, twoSpikesFrom: 13,
    spikeFirstAt: 0.45, spikeSpread: [0.33, 0.78],

    /* gates */
    gatesMin: 2, gatesMax: 4,

    /* phase shape */
    ingressTime: 10, ingressFrac: 0.24, bodyFrac: 0.38, closerFrac: 0.10,
    beatEvery: 2.6, dripEvery: 0.35,

    /* BURST (owner rule): a regular wave arrives all at once at t=0.  The ramp
     * is cosmetic only — it exists so one frame does not allocate the whole
     * wave; it must stay short enough to read as "they were already there". */
    burstRamp: 0.35,
    burstReserve: 48,        // pool slots kept free for bosses / spawned children
    burstStuck: 2.5,         // s of placing nothing before a group is written off

    /* pacing: seconds a wave is authored to take at full spawn rate */
    waveSeconds: function (b) { return M.clamp(28 + b * 0.13, 40, 175); },

    /* fairness */
    safeRadius: 160,          // nothing spawns within four ship-widths of the player
    interiorSwirl: 2.0,       // interior spawners announce themselves for 2s
    stallAfter: 20, stallDrift: 30,

    /* ambient arena mutators */
    fogDark: 0.16, tideForce: 90, strobeEventMul: 3, lowCeiling: 0.70,
    eventEvery: 17,

    /* endless (§8.2) */
    endless: {
      budgetGrow: 1.055, capHold: 400,
      duoFrom: 34, trioFrom: 40, bigEvery: 3,
      modsAt: [31, 33, 36, 40, 45, 52, 60, 70],   // wave -> one more boss mutator
      reunionFrac: 0.10
    },

    /* used only by tools/waves_report.js to model the simultaneous peak */
    reportKillRate: function (n) { return 2.2 + n * 0.55; }
  };

  /* ====================================================================
   * ROLES, COSTS, CAPS.  Costs come from the enemy registry at runtime; these
   * are the authoring fallbacks used before a type is registered.
   * ================================================================== */
  var ROLE = {
    /* filler */
    mote: 'filler', drifter: 'filler', skitter: 'filler', moteling: 'filler',
    popper: 'filler', larva: 'filler', splitter: 'filler', husk: 'filler', echo: 'filler',
    /* texture: ranged and telegraphing */
    spitter: 'texture', lancer: 'texture', charger: 'texture', shade: 'texture',
    mortar: 'texture', bloat: 'texture', tetherPair: 'texture', warden: 'texture',
    wisp: 'texture', prism: 'texture', doppel: 'texture', flak: 'texture',
    wraith: 'texture', chargerElite: 'texture',
    /* problems: support and arena alterers, hard-capped */
    constrictor: 'problem', sentinel: 'problem', sower: 'problem', puller: 'problem',
    hive: 'problem', glazier: 'problem', eclipse: 'problem', siphon: 'problem',
    rotator: 'problem', necromancer: 'problem', chronoform: 'problem', crush: 'problem',
    cathedral: 'problem', herald: 'problem', singularity: 'problem',
    ouroboros: 'problem', sunder: 'problem', swarmLord: 'problem'
  };

  var COST = {
    mote: 1, drifter: 1, skitter: 1, moteling: 1, larva: 1, husk: 1, echo: 1,
    popper: 2, splitter: 2,
    spitter: 3, shade: 4, lancer: 4, wisp: 4, charger: 5, mortar: 5, bloat: 6,
    warden: 6, flak: 6, wraith: 6, prism: 7, tetherPair: 8, doppel: 8, chargerElite: 9,
    sentinel: 8, sower: 6, puller: 9, siphon: 9, constrictor: 10, glazier: 10,
    chronoform: 10, hive: 12, rotator: 12, herald: 12, sunder: 12, necromancer: 14,
    eclipse: 14, crush: 16, swarmLord: 18, ouroboros: 20, singularity: 30, cathedral: 40
  };

  /* simultaneous per-type caps (GAME_PLAN §7: problems are hard-capped) */
  var CAP = {
    spitter: 22, lancer: 12, charger: 10, shade: 30, mortar: 8, bloat: 10,
    tetherPair: 4, warden: 6, wisp: 6, prism: 6, doppel: 1, flak: 8, wraith: 20,
    chargerElite: 4,
    constrictor: 2, sentinel: 4, sower: 5, puller: 3, hive: 3, glazier: 3,
    eclipse: 2, siphon: 4, rotator: 2, necromancer: 3, chronoform: 3, crush: 2,
    cathedral: 1, herald: 2, singularity: 1, ouroboros: 1, sunder: 2, swarmLord: 2
  };

  /* spawn inside the arena after an announcing swirl (GAME_PLAN §7) */
  var INTERIOR = { puller: 1, singularity: 1, cathedral: 1, chronoform: 1 };
  /* arena alterers: placed during the overview so the player can plan */
  var ALTERER = {
    constrictor: 1, glazier: 1, rotator: 1, crush: 1, sunder: 1, eclipse: 1, ouroboros: 1
  };

  /* substitutes used when an id is not registered yet */
  var FALLBACK = {
    filler: ['mote', 'moteling', 'larva', 'husk', 'popper', 'splitter'],
    texture: ['spitter', 'lancer', 'charger', 'mortar', 'bloat'],
    problem: ['sentinel', 'sower', 'hive', 'constrictor']
  };

  var EVENTS = {
    1: ['supernova', 'solarWind', 'flareCascade'],
    2: ['supernova', 'pulsarSweep', 'cometPass', 'eclipse'],
    3: ['nebulaLightning', 'phaseFog', 'auroraLanes', 'starShadow'],
    4: ['gravityRipple', 'blackHoleBloom', 'timeFracture', 'resonancePulse', 'darkPhase'],
    5: ['ionStorm', 'riftSpawn', 'meteorShower', 'flareCascade', 'supernova', 'auroraLanes']
  };
  var BIOME = { 1: 'ember', 2: 'pulsar', 3: 'storm', 4: 'horizon', 5: 'core' };

  var AMBIENT = ['fog', 'tide', 'strobe', 'glassFloor', 'lowCeiling'];
  var MUTS = ['volatile', 'linked', 'phased', 'anchored', 'split', 'haunted',
    'shrouded', 'magnetic', 'mirror', 'vampiric', 'bloomed', 'siren'];
  var MUT_BIT = {
    volatile: 1, linked: 2, phased: 4, anchored: 8, split: 16, haunted: 32,
    shrouded: 64, magnetic: 128, mirror: 256, vampiric: 512, bloomed: 1024, siren: 2048
  };

  /* ====================================================================
   * THE 30-WAVE SCRIPT (GAME_PLAN §8).  One new thing per wave, the new thing
   * always paired with a type it interacts with, retirements applied at the
   * start of the listed wave, budgets from the §8 table.
   * ================================================================== */
  var SPECS = [];
  function S(n, spec) {
    spec.wave = n;
    spec.act = spec.act || Math.min(5, Math.ceil(n / 6));
    SPECS[n] = spec;
  }

  /* --- Act I — Ember Nebula: learn to move ------------------------------ */
  S(1, {
    budget: 15, boss: 'compactor', newTypes: ['mote'], retire: [],
    filler: [['mote', 1]], texture: [], problem: [], pair: {},
    spikes: 0, gates: 2, note: '15 Motes in two gentle streams'
  });
  S(2, {
    budget: 24, boss: 'constellation', newTypes: ['skitter', 'drifter'], retire: [],
    filler: [['mote', 0.55], ['skitter', 0.28], ['drifter', 0.17]], texture: [], problem: [],
    pair: { skitter: 'mote', drifter: 'mote' },
    spikes: ['skitter'], note: 'Skitters leak around the Mote wall first'
  });
  S(3, {
    budget: 35, boss: 'tide', newTypes: ['spitter'], retire: [],
    filler: [['mote', 0.7], ['skitter', 0.2], ['drifter', 0.1]],
    texture: [['spitter', 1]], problem: [],
    pair: { spitter: 'mote' }, spikes: ['spitter'],
    eventBeats: [{ t: 12, id: 'supernova' }],
    note: 'first Supernova flash; Spitter bolts kill Motes: cover exists'
  });
  S(4, {
    budget: 45, boss: 'turntable', newTypes: ['popper'], retire: [],
    filler: [['mote', 0.6], ['popper', 0.25], ['skitter', 0.1], ['drifter', 0.05]],
    texture: [['spitter', 1]], problem: [],
    pair: { popper: 'mote' }, spikes: [{ type: 'popper', count: 12 }],
    note: 'spike: 12 Poppers at once'
  });
  S(5, {
    budget: 55, boss: 'metronome', newTypes: ['lancer'], retire: [],
    filler: [['mote', 0.62], ['popper', 0.28], ['skitter', 0.1]],
    texture: [['spitter', 0.45], ['lancer', 0.55]], problem: [],
    pair: { lancer: 'mote' }, spikes: ['lancer'],
    note: 'Lancers snipe through the Mote wall'
  });
  S(6, {
    budget: 70, boss: 'congregation', newTypes: ['charger'], retire: [],
    filler: [['mote', 0.6], ['popper', 0.3], ['skitter', 0.1]],
    texture: [['spitter', 0.25], ['lancer', 0.35], ['charger', 0.4]], problem: [],
    pair: { charger: 'lancer' }, spikes: ['charger'], draftCards: 4,
    note: 'Chargers bait and charge, Lancers cover them'
  });

  /* --- Act II — Pulsar Field: learn to read ----------------------------- */
  S(7, {
    budget: 85, boss: 'strobe', newTypes: ['shade'], retire: ['drifter', 'skitter'],
    filler: [['mote', 0.7], ['popper', 0.3]],
    texture: [['spitter', 0.2], ['lancer', 0.28], ['charger', 0.27], ['shade', 0.25]],
    problem: [], pair: { shade: 'mote' }, spikes: ['shade'],
    note: 'Shades hide in Mote packs; the flash countdown is the screen'
  });
  S(8, {
    budget: 100, boss: 'cartographer', newTypes: ['constrictor'], retire: [],
    filler: [['mote', 0.65], ['popper', 0.35]],
    texture: [['spitter', 0.2], ['lancer', 0.3], ['charger', 0.35], ['shade', 0.15]],
    problem: [['constrictor', 1]],
    pair: { constrictor: 'charger' }, spikes: ['charger'],
    note: 'two Constrictors on opposite rims; Chargers get shorter runways'
  });
  S(9, {
    budget: 120, boss: 'cadence', newTypes: ['sentinel'], retire: [],
    filler: [['mote', 0.68], ['popper', 0.32]],
    texture: [['spitter', 0.17], ['lancer', 0.28], ['charger', 0.3], ['shade', 0.25]],
    problem: [['sentinel', 0.6], ['constrictor', 0.4]],
    pair: { sentinel: 'lancer' }, spikes: ['shade'],
    note: 'Sentinels shield Charger telegraphs and Lancer snipes'
  });
  S(10, {
    budget: 140, boss: 'understudy', newTypes: ['mortar'], retire: ['mote', 'spitter'],
    filler: [['popper', 0.7], ['moteling', 0.3]],
    texture: [['lancer', 0.28], ['charger', 0.3], ['mortar', 0.27], ['shade', 0.15]],
    problem: [['sentinel', 0.6], ['constrictor', 0.4]],
    pair: { mortar: 'sentinel' }, spikes: ['mortar'],
    note: 'Poppers become the filler; Mortars force movement inside domes'
  });
  S(11, {
    budget: 160, boss: 'encore', newTypes: ['bloat'], retire: [],
    filler: [['popper', 0.72], ['moteling', 0.28]],
    texture: [['bloat', 0.3], ['mortar', 0.24], ['lancer', 0.2], ['charger', 0.26]],
    problem: [['sentinel', 0.55], ['constrictor', 0.45]],
    pair: { bloat: 'popper' }, spikes: ['bloat'],
    note: 'Bloats hide in Popper packs; Sentinel-shielded Bloats walk at you'
  });
  S(12, {
    budget: 180, boss: 'depth', newTypes: ['sower'], retire: ['lancer'],
    filler: [['popper', 0.7], ['moteling', 0.3]],
    texture: [['bloat', 0.3], ['mortar', 0.3], ['charger', 0.25], ['shade', 0.15]],
    problem: [['sower', 0.5], ['sentinel', 0.25], ['constrictor', 0.25]],
    pair: { sower: 'constrictor' }, spikes: ['charger'], draftCards: 4,
    note: 'mines plus Constrictor: the safe floor shrinks and fills with green'
  });

  /* --- Act III — Storm Cloud: learn to prioritize ----------------------- */
  S(13, {
    budget: 210, boss: 'angler', newTypes: ['tetherPair'], retire: [],
    filler: [['popper', 0.58], ['moteling', 0.42]],
    texture: [['tetherPair', 0.3], ['bloat', 0.24], ['mortar', 0.24], ['charger', 0.22]],
    problem: [['sower', 0.4], ['sentinel', 0.3], ['constrictor', 0.3]],
    pair: { tetherPair: 'popper' }, spikes: ['tetherPair', 'charger'],
    note: 'rotating orange nets woven through the crowd; two spikes from here on'
  });
  S(14, {
    budget: 240, boss: 'reflector', newTypes: ['puller'], retire: [],
    filler: [['popper', 0.6], ['moteling', 0.4]],
    texture: [['bloat', 0.34], ['mortar', 0.24], ['tetherPair', 0.22], ['charger', 0.2]],
    problem: [['puller', 0.4], ['sower', 0.25], ['sentinel', 0.2], ['constrictor', 0.15]],
    pair: { puller: 'bloat' }, spikes: ['bloat', 'puller'], mutators: ['fog'],
    note: 'Pullers drag Bloats into chain explosions and clump Shades'
  });
  S(15, {
    budget: 270, boss: 'inverter', newTypes: ['hive'], retire: [],
    filler: [['larva', 0.4], ['popper', 0.35], ['moteling', 0.25]],
    texture: [['bloat', 0.3], ['mortar', 0.24], ['tetherPair', 0.24], ['charger', 0.22]],
    problem: [['hive', 0.4], ['puller', 0.25], ['sower', 0.2], ['sentinel', 0.15]],
    pair: { hive: 'larva' }, spikes: ['bloat', 'mortar'],
    note: 'kill it or 200 becomes 400; Larvae are the new filler'
  });
  S(16, {
    budget: 300, boss: 'echo', newTypes: ['glazier'], retire: [],
    filler: [['larva', 0.45], ['popper', 0.3], ['moteling', 0.25]],
    texture: [['mortar', 0.3], ['bloat', 0.25], ['tetherPair', 0.25], ['charger', 0.2]],
    problem: [['glazier', 0.35], ['hive', 0.25], ['puller', 0.2], ['sentinel', 0.2]],
    pair: { glazier: 'mortar' }, spikes: ['mortar', 'glazier'],
    note: 'mirror walls partition the arena; lobbers fire over them'
  });
  S(17, {
    budget: 340, boss: 'horizon', newTypes: ['warden', 'wisp'],
    retire: ['popper', 'mortar', 'charger', 'sower'],
    filler: [['larva', 0.6], ['moteling', 0.4]],
    texture: [['warden', 0.34], ['wisp', 0.3], ['tetherPair', 0.22], ['bloat', 0.14]],
    problem: [['glazier', 0.3], ['hive', 0.3], ['sentinel', 0.22], ['constrictor', 0.18]],
    pair: { warden: 'glazier', wisp: 'larva' },
    spikes: [{ type: 'wisp', all: true }, 'warden'], mutators: ['tide'],
    note: 'one spike is all Wisps; Wardens create fire lanes'
  });
  S(18, {
    budget: 380, boss: 'supernova', newTypes: ['splitter'], retire: [],
    filler: [['splitter', 0.45], ['larva', 0.33], ['moteling', 0.22]],
    texture: [['tetherPair', 0.4], ['warden', 0.3], ['wisp', 0.16], ['bloat', 0.14]],
    problem: [['glazier', 0.4], ['constrictor', 0.3], ['hive', 0.18], ['sentinel', 0.12]],
    pair: { splitter: 'larva' }, spikes: ['tetherPair', 'glazier'],
    theme: 'structure', draftCards: 4,
    note: 'theme wave "Structure": Glazier, Constrictor, Tether Pair dominant'
  });

  /* --- Act IV — Event Horizon: fight the arena -------------------------- */
  S(19, {
    budget: 430, boss: 'dimmer', newTypes: ['eclipse'], retire: [],
    filler: [['splitter', 0.4], ['larva', 0.35], ['moteling', 0.25]],
    texture: [['shade', 0.4], ['warden', 0.2], ['wisp', 0.2], ['tetherPair', 0.2]],
    problem: [['eclipse', 0.3], ['glazier', 0.25], ['hive', 0.25], ['sentinel', 0.2]],
    pair: { eclipse: 'shade' }, spikes: ['shade', 'warden'], mutators: ['strobe'],
    note: 'everything outside your lantern is dim; Shades everywhere'
  });
  S(20, {
    budget: 480, boss: 'lurker', newTypes: ['prism'], retire: [],
    filler: [['splitter', 0.4], ['larva', 0.35], ['moteling', 0.25]],
    texture: [['prism', 0.32], ['shade', 0.24], ['warden', 0.24], ['tetherPair', 0.2]],
    problem: [['glazier', 0.35], ['hive', 0.25], ['sentinel', 0.2], ['eclipse', 0.2]],
    pair: { prism: 'glazier' }, spikes: ['prism', 'splitter'],
    note: 'three-beam lasers reflect off the mirror walls'
  });
  S(21, {
    budget: 530, boss: 'schism', newTypes: ['siphon'], retire: [],
    filler: [['splitter', 0.4], ['larva', 0.36], ['moteling', 0.24]],
    texture: [['prism', 0.3], ['warden', 0.26], ['shade', 0.24], ['wisp', 0.2]],
    problem: [['siphon', 0.3], ['sentinel', 0.2], ['hive', 0.2], ['glazier', 0.18], ['eclipse', 0.12]],
    pair: { siphon: 'sentinel' }, spikes: ['siphon', 'prism'],
    note: 'green cords drain mana and heal the crowd'
  });
  S(22, {
    budget: 580, boss: 'siren', newTypes: ['rotator'], retire: [],
    filler: [['splitter', 0.4], ['larva', 0.36], ['moteling', 0.24]],
    texture: [['prism', 0.3], ['warden', 0.25], ['wisp', 0.25], ['shade', 0.2]],
    problem: [['rotator', 0.28], ['glazier', 0.26], ['siphon', 0.2], ['hive', 0.16], ['eclipse', 0.1]],
    pair: { rotator: 'glazier' }, spikes: ['prism', 'rotator'],
    note: 'Glazier walls become sweeping blades'
  });
  S(23, {
    budget: 640, boss: 'probability', newTypes: ['necromancer'],
    retire: ['shade', 'constrictor', 'bloat', 'tetherPair'],
    filler: [['husk', 0.35], ['larva', 0.35], ['splitter', 0.3]],
    texture: [['prism', 0.35], ['wisp', 0.35], ['warden', 0.3]],
    problem: [['necromancer', 0.3], ['hive', 0.25], ['siphon', 0.2], ['glazier', 0.15], ['rotator', 0.1]],
    pair: { necromancer: 'hive' }, spikes: ['husk', 'prism'],
    note: 'Necro plus Hive is the infinite loop you must break'
  });
  S(24, {
    budget: 700, boss: 'page', newTypes: ['doppel', 'chronoform'], retire: ['warden', 'hive'],
    filler: [['husk', 0.4], ['larva', 0.3], ['splitter', 0.3]],
    texture: [['prism', 0.4], ['wisp', 0.4], ['doppel', 0.2]],
    problem: [['chronoform', 0.3], ['necromancer', 0.25], ['siphon', 0.2], ['glazier', 0.15], ['rotator', 0.1]],
    pair: { doppel: 'prism', chronoform: 'husk' },
    spikes: ['chronoform', 'prism'], draftCards: 4,
    note: 'walk your mirror-twin into Prism beams'
  });

  /* --- Act V — The Core: mayhem ----------------------------------------- */
  S(25, {
    budget: 800, boss: 'understudyPerfect', newTypes: ['wraith', 'crush'], retire: [],
    filler: [['husk', 0.4], ['larva', 0.35], ['moteling', 0.25]],
    texture: [['wraith', 0.4], ['prism', 0.3], ['wisp', 0.3]],
    problem: [['crush', 0.25], ['glazier', 0.2], ['necromancer', 0.2], ['siphon', 0.2], ['rotator', 0.15]],
    pair: { wraith: 'glazier', crush: 'larva' }, spikes: ['wraith', 'crush'],
    mutators: ['strobe'],
    note: 'Wraiths phase through walls and domes; Crush makes a corridor'
  });
  S(26, {
    budget: 900, boss: 'duoLightsCamera', newTypes: ['cathedral'], retire: [],
    filler: [['larva', 0.4], ['husk', 0.35], ['moteling', 0.25]],
    texture: [['wraith', 0.35], ['wisp', 0.35], ['prism', 0.3]],
    problem: [['cathedral', 0.2], ['necromancer', 0.2], ['siphon', 0.2], ['rotator', 0.2], ['crush', 0.2]],
    pair: { cathedral: 'larva' }, spikes: ['wraith', 'prism'],
    note: 'a mid-wave boss inside the wave; find the exposed node'
  });
  S(27, {
    budget: 1000, boss: 'duoBaitSwitch', newTypes: ['herald', 'chargerElite'], retire: [],
    filler: [['husk', 0.4], ['larva', 0.35], ['moteling', 0.25]],
    texture: [['wraith', 0.35], ['chargerElite', 0.3], ['prism', 0.2], ['wisp', 0.15]],
    problem: [['herald', 0.25], ['necromancer', 0.2], ['siphon', 0.2], ['rotator', 0.2], ['cathedral', 0.15]],
    pair: { herald: 'husk', chargerElite: 'wraith' }, spikes: ['chargerElite', 'herald'],
    note: 'every 6s the roster upgrades; kill the halo first'
  });
  S(28, {
    budget: 1100, boss: 'congregationRequiem', newTypes: ['sunder', 'flak'], retire: [],
    filler: [['husk', 0.35], ['splitter', 0.35], ['larva', 0.3]],
    texture: [['flak', 0.3], ['chargerElite', 0.25], ['wraith', 0.25], ['prism', 0.2]],
    problem: [['sunder', 0.25], ['herald', 0.2], ['necromancer', 0.2], ['rotator', 0.2], ['crush', 0.15]],
    pair: { sunder: 'larva', flak: 'splitter' }, spikes: ['flak', 'sunder'],
    note: 'chasms split the crowd; Flak rings are information pressure'
  });
  S(29, {
    budget: 1300, boss: 'duoHeatDeath', newTypes: ['ouroboros', 'swarmLord', 'echo'], retire: [],
    filler: [['echo', 0.3], ['husk', 0.3], ['larva', 0.2], ['moteling', 0.2]],
    texture: [['wraith', 0.3], ['chargerElite', 0.25], ['flak', 0.25], ['prism', 0.2]],
    problem: [['ouroboros', 0.2], ['swarmLord', 0.2], ['herald', 0.15], ['necromancer', 0.15],
      ['cathedral', 0.1], ['sunder', 0.1], ['crush', 0.1]],
    pair: { ouroboros: 'wraith', swarmLord: 'moteling', echo: 'husk' },
    spikes: ['swarmLord', 'flak', 'wraith'],
    note: 'retire nothing: everything is here'
  });
  S(30, {
    budget: 1500, boss: 'singularity', newTypes: ['singularity'], retire: [],
    filler: [['husk', 0.3], ['larva', 0.25], ['moteling', 0.25], ['echo', 0.2]],
    texture: [['chargerElite', 0.3], ['wraith', 0.28], ['flak', 0.22], ['prism', 0.2]],
    problem: [['singularity', 0.18], ['herald', 0.16], ['rotator', 0.16], ['necromancer', 0.14],
      ['cathedral', 0.12], ['sunder', 0.12], ['crush', 0.12]],
    pair: { singularity: 'wraith' }, draftCards: 4,
    spikes: ['flak', 'wraith', 'chargerElite', 'echo'],
    note: 'the full roster in remixed spikes while a Singularity eats the arena'
  });

  /* ====================================================================
   * DERIVED ROSTER TABLES
   * ================================================================== */
  function retiredBefore(n) {
    var out = {};
    for (var k = 1; k <= Math.min(n, 30); k++) {
      var r = SPECS[k] && SPECS[k].retire;
      if (r) for (var i = 0; i < r.length; i++) out[r[i]] = k;
    }
    return out;
  }
  function newAt(n) { return (SPECS[n] && SPECS[n].newTypes) ? SPECS[n].newTypes.slice() : []; }
  function rosterAt(n) {
    var w = script[M.clamp(n, 1, 30)];
    return w ? w.roster.slice() : [];
  }

  /* ====================================================================
   * COST / CAP LOOKUPS (registry first, table as the fallback)
   * ================================================================== */
  function costOf(id) {
    var E = NA.Enemies;
    if (E && E.typeIndex) {
      var ti = E.typeIndex(id);
      if (ti >= 0 && E.types[ti] && E.types[ti].cost) return E.types[ti].cost;
    }
    return COST[id] || 3;
  }
  function capOf(id) { return CAP[id] || 9999; }
  function roleOf(id) { return ROLE[id] || 'filler'; }

  /* deterministic jitter without touching NA.RNG: waves are identical every
   * run, only spawn jitter and draft offers use the RNG. */
  function hash01(a, b) {
    var h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ====================================================================
   * THE COMPOSER — turns an authored spec into the runner's data
   * ================================================================== */
  function build(n, spec) {
    var fallbackBudget = Math.round(K.curveBase * Math.pow(K.curveGrow, n));
    var B = Math.max(1, Math.round((spec.budget || fallbackBudget) * K.budgetScale));
    var retired = retiredBefore(n);
    var i, j, e, q;

    /* ---- roster entries, retired types filtered out --------------------- */
    var entries = [], byRole = { filler: [], texture: [], problem: [] };
    var roles = ['filler', 'texture', 'problem'];
    for (var ri = 0; ri < roles.length; ri++) {
      var role = roles[ri], list = spec[role] || [];
      for (q = 0; q < list.length; q++) {
        var rid = list[q][0];
        if (retired[rid]) continue;                       // the retirement schedule wins
        var en = { id: rid, role: role, w: list[q][1], cost: costOf(rid), count: 0 };
        entries.push(en); byRole[role].push(en);
      }
    }

    /* ---- cost mix: 55 / 30 / 15, renormalised over the roles present ---- */
    var share = {}, tot = 0;
    for (i = 0; i < roles.length; i++) if (byRole[roles[i]].length) { share[roles[i]] = K.mix[roles[i]]; tot += K.mix[roles[i]]; }
    for (i = 0; i < roles.length; i++) share[roles[i]] = tot ? (share[roles[i]] || 0) / tot : 0;

    /* counts so the *cost* split matches the mix while the *head count* is B:
     *   S = B / sum_role( share_role * sum_entry(w_norm / cost) ) */
    var denom = 0;
    for (i = 0; i < roles.length; i++) {
      var g = byRole[roles[i]], sw = 0, h = 0;
      for (j = 0; j < g.length; j++) sw += g[j].w;
      for (j = 0; j < g.length; j++) { g[j].wn = sw ? g[j].w / sw : 0; h += g[j].wn / g[j].cost; }
      denom += share[roles[i]] * h;
    }
    var Scost = denom > 0 ? B / denom : B;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      e.count = Math.max(1, Math.round(Scost * share[e.role] * e.wn / e.cost));
    }

    /* ---- per-type caps: a problem may churn cap x problemChurn per wave --
     * whatever a capped type cannot hold is spent on the other types in the
     * SAME role first, so a hard cap never distorts the 55/30/15 cost mix. */
    var spill = { filler: 0, texture: 0, problem: 0 };
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (!CAP[e.id]) continue;
      var maxTotal = Math.max(CAP[e.id], Math.round(CAP[e.id] * K.problemChurn));
      if (e.count > maxTotal) {
        spill[e.role] += (e.count - maxTotal) * e.cost;
        e.count = maxTotal; e.capped = true;
      }
    }
    for (i = 0; i < roles.length; i++) {
      var rl = roles[i];
      if (spill[rl] <= 0) continue;
      var open = [], ow = 0;
      for (j = 0; j < byRole[rl].length; j++) if (!byRole[rl][j].capped) { open.push(byRole[rl][j]); ow += byRole[rl][j].wn; }
      if (!open.length || ow <= 0) continue;
      for (j = 0; j < open.length; j++) {
        var add = Math.floor(spill[rl] * (open[j].wn / ow) / open[j].cost);
        if (add > 0) {
          var lim = CAP[open[j].id] ? Math.max(CAP[open[j].id], Math.round(CAP[open[j].id] * K.problemChurn)) : 1e9;
          open[j].count = Math.min(lim, open[j].count + add);
          if (open[j].count >= lim) open[j].capped = true;
        }
      }
    }

    /* ---- balance the head count back to the budget (filler absorbs) ----- */
    var absorbers = byRole.filler.length ? byRole.filler : entries;
    var sum = 0; for (i = 0; i < entries.length; i++) sum += entries[i].count;
    if (absorbers.length && sum !== B) {
      var per = (B - sum) / absorbers.length;
      for (i = 0; i < absorbers.length; i++) absorbers[i].count = Math.max(1, absorbers[i].count + Math.round(per));
      sum = 0; for (i = 0; i < entries.length; i++) sum += entries[i].count;
      var big = absorbers[0];
      for (i = 1; i < absorbers.length; i++) if (absorbers[i].count > big.count) big = absorbers[i];
      big.count = Math.max(1, big.count + (B - sum));
    }

    /* ---- cost report (for tools/waves_report.js) ------------------------ */
    var costTotal = 0, costByRole = { filler: 0, texture: 0, problem: 0 };
    for (i = 0; i < entries.length; i++) {
      var cc = entries[i].count * entries[i].cost;
      costTotal += cc; costByRole[entries[i].role] += cc;
    }

    /* ---- gates: 2-4, rotated every wave --------------------------------- */
    var gates = spec.gates || M.clamp(K.gatesMin + (n % (K.gatesMax - K.gatesMin + 1)), K.gatesMin, K.gatesMax);

    /* ---- beats ---------------------------------------------------------- */
    var T = K.waveSeconds(B);
    var beats = [], remaining = {};
    for (i = 0; i < entries.length; i++) remaining[entries[i].id] = entries[i].count;

    function take(id, want) {
      var have = remaining[id] || 0, got = Math.min(have, Math.max(0, Math.round(want)));
      remaining[id] = have - got;
      return got;
    }

    /* 1. arena alterers and interior spawners first: the alterers are placed
     *    during the overview (so the player can plan), the interior spawners
     *    arrive with an announcing swirl. */
    var plan = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (!ALTERER[e.id] && !INTERIOR[e.id]) continue;
      var cnt = take(e.id, Math.max(1, Math.min(capOf(e.id), Math.ceil(e.count * 0.5))));
      if (!cnt) continue;
      for (j = 0; j < cnt; j++) {
        if (INTERIOR[e.id]) {
          var ia = hash01(n, 700 + i * 7 + j) * M.TAU;
          var ir = (0.15 + 0.4 * hash01(n, 800 + i * 5 + j)) * (C.ARENA_R * 0.8);
          var px = (e.id === 'singularity') ? 0 : Math.cos(ia) * ir;
          var py = (e.id === 'singularity') ? 0 : Math.sin(ia) * ir;
          beats.push({
            t: +(3 + j * 6 + i * 1.5).toFixed(2), type: e.id, count: 1, gate: 0,
            pos: [px, py], swirl: K.interiorSwirl
          });
        } else {
          var ga = hash01(n, 900 + i * 11 + j) * M.TAU;
          beats.push({ t: 0, type: e.id, count: 1, gate: j % gates, overview: true, angle: ga });
          plan.push({ type: e.id, angle: ga });
        }
      }
    }

    /* 2. ingress: the first 10s from the rotating rim gates, filler and
     *    texture only — the problems arrive once you are already busy. */
    var ingressN = Math.round(B * K.ingressFrac), placed = 0, gi = 0, bt = 0;
    var ingressPool = byRole.filler.concat(byRole.texture);
    for (var pass = 0; pass < 5 && placed < ingressN; pass++) {
      bt = pass * (K.ingressTime / 5);
      for (i = 0; i < ingressPool.length && placed < ingressN; i++) {
        e = ingressPool[i];
        var wantI = Math.ceil(e.count * K.ingressFrac / 5);
        var c = take(e.id, Math.min(capOf(e.id), wantI, ingressN - placed));
        if (c > 0) { beats.push({ t: bt, type: e.id, count: c, gate: (gi++) % gates }); placed += c; }
      }
    }

    /* 3. the pairing rule: the new thing always arrives beside a type it
     *    interacts with — same beat time, same gate. */
    var pairs = spec.pair || {}, pairBeats = [];
    var nts = spec.newTypes || [], pt = 0;
    for (i = 0; i < nts.length; i++) {
      var nid = nts[i];
      if (retired[nid] || remaining[nid] === undefined) continue;
      var partner = pairs[nid];
      var tp = 4 + i * 3;
      var pc = take(nid, Math.min(capOf(nid), Math.max(1, Math.ceil((remaining[nid] || 0) * 0.4))));
      if (pc > 0) pairBeats.push({ t: tp, type: nid, count: pc, gate: pt % gates, pairFor: partner });
      if (partner && remaining[partner] !== undefined) {
        var qc = take(partner, Math.min(capOf(partner), Math.max(2, Math.ceil(costOf(nid) * 1.5))));
        if (qc > 0) pairBeats.push({ t: tp, type: partner, count: qc, gate: pt % gates, pairWith: nid });
      }
      pt++;
    }
    for (i = 0; i < pairBeats.length; i++) beats.push(pairBeats[i]);

    /* 4. body: authored beats out to ~70% of the wave; whatever is left of the
     *    budget is dripped by the runner at a rate governed by the simultaneous
     *    cap — that is where the late-game pressure comes from. */
    var bodyN = Math.round(B * K.bodyFrac), bplaced = 0, k = 0;
    var bodyPool = entries.slice().sort(function (a, b2) { return b2.count - a.count; });
    bt = K.ingressTime + 1;
    while (bplaced < bodyN && bt < T * 0.72 && k < 500) {
      e = bodyPool[k % bodyPool.length];
      var want = Math.max(1, Math.round(e.count * 0.16));
      var got = take(e.id, Math.min(capOf(e.id), want, bodyN - bplaced));
      if (got > 0) {
        beats.push({ t: +bt.toFixed(2), type: e.id, count: got, gate: (gi++) % gates });
        bplaced += got;
        bt += K.beatEvery * (0.7 + 0.6 * hash01(n, k));
      }
      k++;
    }

    beats.sort(function (a, b2) { return a.t - b2.t; });

    /* ---- the body stream the runner drips from -------------------------- */
    var stream = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (INTERIOR[e.id] || ALTERER[e.id]) continue;
      var left = Math.max(0, remaining[e.id] || 0);
      if (left > 0) stream.push([e.id, left]);
    }
    if (!stream.length) {
      var fb = byRole.filler[0] || entries[0];
      if (fb) stream.push([fb.id, 1]);
    }

    /* ---- spikes: once mid-wave, twice from wave 13; a single archetype
     *      different from the dominant filler, from a brand-new gate, with a
     *      1.5s rim flash warning ------------------------------------------ */
    var dominant = byRole.filler.length ? byRole.filler[0].id : (entries[0] && entries[0].id);
    var spikeSpec = spec.spikes, spikes = [];
    if (spikeSpec !== 0) {
      var wantK = n >= K.twoSpikesFrom ? 2 : 1;
      var arr = (Object.prototype.toString.call(spikeSpec) === '[object Array]') ? spikeSpec.slice() : [];
      while (arr.length < wantK) arr.push(defaultSpikeType(byRole, dominant, arr.length));
      for (i = 0; i < arr.length; i++) {
        var sd = typeof arr[i] === 'string' ? { type: arr[i] } : arr[i];
        if (retired[sd.type] || remaining[sd.type] === undefined) sd = { type: defaultSpikeType(byRole, dominant, i) };
        var frac = arr.length === 1 ? K.spikeFirstAt
          : K.spikeSpread[0] + (K.spikeSpread[1] - K.spikeSpread[0]) * (i / Math.max(1, arr.length - 1));
        spikes.push({
          t: +(T * frac).toFixed(2), frac: K.spikeFrac, type: sd.type,
          count: sd.count || 0, all: !!sd.all, warn: K.spikeWarn
        });
      }
    }

    /* ---- closer: the last 10% is problem enemies only ------------------- */
    var closerTypes = [];
    for (i = 0; i < byRole.problem.length; i++) if (!INTERIOR[byRole.problem[i].id]) closerTypes.push(byRole.problem[i].id);
    if (!closerTypes.length) {
      var hardest = null;
      for (i = 0; i < byRole.texture.length; i++) if (!hardest || byRole.texture[i].cost > hardest.cost) hardest = byRole.texture[i];
      var fallbackCloser = hardest || byRole.filler[0] || entries[0];
      closerTypes = fallbackCloser ? [fallbackCloser.id] : [];
    }

    /* ---- THE BURST (owner rule) --------------------------------------------
     * The whole composition above, flattened into spawn groups that the runner
     * dispenses at t=0.  Composition is untouched — every type keeps exactly
     * the count the mix gave it; only the timing changes.  Rim groups are
     * dealt round-robin across the wave's gates so the wave arrives as a ring;
     * interior spawners keep their announcing swirl; arena alterers keep their
     * overview placement.  beats/spikes/stream above are left intact because
     * tools/waves_report.js and the overview read them, but the runner no
     * longer uses them for regular spawning. */
    var burst = [], bgi = 0, burstTotal = 0, bj;
    plan = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      var N = e.count;
      if (N <= 0) continue;
      burstTotal += N;
      if (INTERIOR[e.id]) {
        for (bj = 0; bj < N; bj++) {
          var bia = hash01(n, 700 + i * 7 + bj) * M.TAU;
          var bir = (0.15 + 0.4 * hash01(n, 800 + i * 5 + bj)) * (C.ARENA_R * 0.8);
          var cx0 = (e.id === 'singularity' && bj === 0) ? 0 : Math.cos(bia) * bir;
          var cy0 = (e.id === 'singularity' && bj === 0) ? 0 : Math.sin(bia) * bir;
          burst.push({ type: e.id, count: 1, gate: (bgi++) % gates, pos: [cx0, cy0], swirl: K.interiorSwirl });
        }
      } else if (ALTERER[e.id]) {
        for (bj = 0; bj < N; bj++) {
          var bga = hash01(n, 900 + i * 11 + bj) * M.TAU;
          burst.push({ type: e.id, count: 1, gate: (bgi++) % gates, angle: bga, overview: true });
          plan.push({ type: e.id, angle: bga });
        }
      } else {
        var groups = M.clamp(Math.ceil(N / 6), 1, 128);
        if (groups < gates) groups = Math.min(N, gates);
        var per = Math.floor(N / groups), extra = N - per * groups;
        for (bj = 0; bj < groups; bj++) {
          var cN = per + (bj < extra ? 1 : 0);
          if (cN <= 0) continue;
          burst.push({ type: e.id, count: cN, gate: (bgi++) % gates });
        }
      }
    }
    /* interleave deterministically: the ring is the whole roster arriving at
     * once, not one type after another */
    for (i = 0; i < burst.length; i++) burst[i].ord = hash01(n, 1300 + i * 3);
    burst.sort(function (a, b2) { return a.ord - b2.ord; });

    var roster = [], mix = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      roster.push(e.id);
      mix.push({ type: e.id, role: e.role, count: e.count, cost: e.cost, cap: CAP[e.id] || 0, capped: !!e.capped });
    }

    return {
      wave: n, act: spec.act, biome: spec.biome || BIOME[spec.act] || 'ember',
      newTypes: (spec.newTypes || []).slice(), retire: (spec.retire || []).slice(),
      retiredSoFar: Object.keys(retired),
      budget: B, roster: roster, mix: mix,
      costTotal: costTotal, costByRole: costByRole,
      duration: T, gateCount: gates,
      beats: beats, spikes: spikes, stream: stream, closerTypes: closerTypes,
      burst: burst, burstTotal: burstTotal,
      overviewPlan: plan,
      pair: spec.pair || {},
      mutators: (spec.mutators || []).slice(),
      /* F18: single event owner. 12_events.js owns the ambient cadence
       * (biome cadence, the wave-9 eclipse guard, constant Pulsar Sweep and
       * the strobe multiplier); this list is reference data only, so it is
       * deliberately NOT called `events` -- that key is what makes the events
       * module stand down. */
      eventPool: (spec.events || EVENTS[spec.act] || []).slice(),
      eventBeats: (spec.eventBeats || []).slice(),
      theme: spec.theme || '', note: spec.note || '',
      draftCards: spec.draftCards || 3,
      simCap: simCap(n),
      boss: spec.boss
    };
  }

  function defaultSpikeType(byRole, dominant, i) {
    var pool = byRole.texture.concat(byRole.problem).concat(byRole.filler);
    var best = null;
    for (var q = 0; q < pool.length; q++) {
      var e = pool[q];
      if (e.id === dominant) continue;
      if (INTERIOR[e.id] || (CAP[e.id] && CAP[e.id] <= 2)) continue;
      if (!best || e.cost > best.cost) best = e;
    }
    if (!best) best = pool[i % Math.max(1, pool.length)];
    return best ? best.id : dominant;
  }

  function simCap(n) {
    return Math.round(Math.min(K.simCapMax, K.simCapBase * Math.pow(K.simCapGrow, Math.max(0, n - 1))));
  }

  /* ====================================================================
   * script[n] — built lazily so registry costs are read after the enemy
   * agents have registered their types, then cached.
   * ================================================================== */
  var script = [];
  script.length = 31;
  (function () {
    function defineWave(n) {
      var cache = null;
      Object.defineProperty(script, n, {
        enumerable: true, configurable: true,
        get: function () { return cache || (cache = build(n, SPECS[n])); },
        set: function (v) { cache = v; }
      });
    }
    for (var n = 1; n <= 30; n++) defineWave(n);
  })();

  /* ====================================================================
   * ENDLESS (GAME_PLAN §8.2)
   * ================================================================== */
  var BOSS_ARENA = {
    compactor: 1, turntable: 1, cartographer: 1, inverter: 1, horizon: 1, schism: 1,
    page: 1, singularity: 1, duoLightsCamera: 1, duoHeatDeath: 1, tide: 1
  };
  var BOSS_LIGHT = { strobe: 1, dimmer: 1, duoLightsCamera: 1, supernova: 1 };
  var BOSS_CHEAP = {
    compactor: 1, constellation: 1, tide: 1, turntable: 1, metronome: 1,
    cadence: 1, angler: 1, reflector: 1
  };
  var BOSS_MODS = ['hasty', 'cloaked', 'crowded', 'cramped', 'unstable', 'shy', 'twin', 'looped'];

  function endRng(n) {
    var a = (((NA.Game && NA.Game.seed ? NA.Game.seed : 1) ^ (n * 2654435761)) >>> 0) || 1;
    return function () { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function hasAny(arr, table) {
    for (var i = 0; i < arr.length; i++) if (table[arr[i]]) return true;
    return false;
  }

  /* the frozen endless roster: everything still alive at wave 30 */
  function frozenRoster() {
    var w = script[30];
    return w ? w.roster.slice() : ['mote'];
  }
  function retiredPool() {
    var r = retiredBefore(30), out = [];
    for (var k in r) out.push(k);
    return out.length ? out : ['mote'];
  }

  /* boss choice walks forward from 31 so "never two arena manipulators back to
   * back / never two lighting bosses within four waves" is stable and seeded. */
  var bossMemo = {};
  function bossPool() {
    return (NA.Bosses && NA.Bosses.list && NA.Bosses.list.length) ? NA.Bosses.list.slice() : ['compactor'];
  }
  function endlessBossFor(n) {
    if (bossMemo[n]) return bossMemo[n];
    var hist = [], w, c, tries, h;
    for (w = 31; w <= n; w++) {
      if (bossMemo[w]) { hist.push(bossMemo[w]); continue; }
      /* GAME_PLAN 8.1: endless opens with the Encore that tore the ending open.
       * No mutators on it -- wave 31 is the ending's own encore, not a remix. */
      if (w === 31) {
        var enc = {
          ids: ['encore'], id: 'encore', mods: {},
          arena: !!BOSS_ARENA.encore, light: !!BOSS_LIGHT.encore
        };
        bossMemo[w] = enc; hist.push(enc); continue;
      }
      var rng = endRng(w * 31 + 5), pool = bossPool();
      var count = w >= K.endless.trioFrom ? 3 : (w >= K.endless.duoFrom ? 2 : 1);
      var chosen = [];
      for (c = 0; c < count; c++) {
        var id = null;
        var prev = hist[hist.length - 1];
        for (tries = 0; tries < 32 && !id; tries++) {
          var cand = pick(rng, pool);
          if (chosen.indexOf(cand) >= 0) continue;
          /* never the same fight two waves running */
          if (prev && prev.ids && prev.ids.indexOf(cand) >= 0) continue;
          if (BOSS_ARENA[cand]) {
            if (prev && prev.arena) continue;                      // no two arena manipulators back to back
            if (hasAny(chosen, BOSS_ARENA)) continue;
          }
          if (BOSS_LIGHT[cand]) {                                  // no two lighting bosses within four waves
            var clash = false;
            for (h = Math.max(0, hist.length - 4); h < hist.length; h++) if (hist[h].light) clash = true;
            if (clash || hasAny(chosen, BOSS_LIGHT)) continue;
          }
          id = cand;
        }
        if (!id) {
          for (tries = 0; tries < pool.length; tries++) {
            var alt = pool[tries];
            if (chosen.indexOf(alt) >= 0) continue;
            if (prev && prev.ids && prev.ids.indexOf(alt) >= 0) continue;
            id = alt; break;
          }
        }
        if (!id) {                                    // relax the repeat rule last
          for (tries = 0; tries < pool.length; tries++) {
            var alt2 = pool[tries];
            if (chosen.indexOf(alt2) < 0) { id = alt2; break; }
          }
        }
        if (!id) id = pick(rng, pool);
        chosen.push(id);
      }
      /* escalating mutators: one more at each modsAt milestone, rotating order */
      var mods = {}, nm = 0;
      for (var mi = 0; mi < K.endless.modsAt.length; mi++) if (w >= K.endless.modsAt[mi]) nm++;
      nm = Math.min(nm, BOSS_MODS.length);
      var off = Math.floor(rng() * BOSS_MODS.length);
      for (var qq = 0; qq < nm; qq++) {
        var mod = BOSS_MODS[(off + qq) % BOSS_MODS.length];
        if (mod === 'twin' && !hasAny(chosen, BOSS_CHEAP)) continue;   // twins only for cheap fights
        mods[mod] = true;
      }
      var rec = {
        ids: chosen, id: chosen[0], mods: mods,
        arena: hasAny(chosen, BOSS_ARENA), light: hasAny(chosen, BOSS_LIGHT)
      };
      bossMemo[w] = rec; hist.push(rec);
    }
    return bossMemo[n];
  }

  function endless(n) {
    n = Math.max(31, n | 0);
    var rng = endRng(n), i;
    var roster = frozenRoster();
    var byRole = { filler: [], texture: [], problem: [] };
    for (i = 0; i < roster.length; i++) byRole[roleOf(roster[i])].push(roster[i]);
    if (!byRole.filler.length) byRole.filler = ['mote'];

    var base = script[30] ? script[30].budget : 1500;
    var budget = Math.round(base * Math.pow(K.endless.budgetGrow, n - 30) * K.budgetScale);

    /* per-wave rolls: one ambient arena mutator, one enemy mutator on the
     * filler type, one reunion of a retired enemy with an elite mutator */
    var ambient = pick(rng, AMBIENT);
    var fillerId = pick(rng, byRole.filler);
    var enemyMut = { type: fillerId, mutator: pick(rng, MUTS) };
    var reunion = { type: pick(rng, retiredPool()), mutator: pick(rng, MUTS), elite: true };

    /* every third wave guarantees a Cathedral or a Singularity */
    var big = (n % K.endless.bigEvery === 0) ? (rng() < 0.5 ? 'cathedral' : 'singularity') : null;

    function wl(list) {
      var out = [];
      for (var q = 0; q < list.length; q++) out.push([list[q], 0.6 + 0.8 * rng()]);
      return out;
    }
    var spec = {
      act: 5, biome: 'core', budget: budget, newTypes: [], retire: [],
      filler: wl(byRole.filler), texture: wl(byRole.texture), problem: wl(byRole.problem),
      pair: {}, gates: K.gatesMin + Math.floor(rng() * (K.gatesMax - K.gatesMin + 1)),
      spikes: [
        pick(rng, byRole.texture.length ? byRole.texture : byRole.filler),
        pick(rng, byRole.problem.length ? byRole.problem : byRole.filler),
        pick(rng, byRole.filler)
      ],
      mutators: [ambient], events: EVENTS[5]
    };
    if (big) spec.problem.push([big, 1.6]);

    var w = build(n, spec);
    w.endless = true;
    w.simCap = K.endless.capHold;                 // the cap holds at the ceiling: pressure is rate
    w.enemyMut = enemyMut;
    w.reunion = reunion;
    w.guaranteed = big;
    w.mutators = [ambient];
    var bs = endlessBossFor(n);
    w.boss = bs.id; w.bosses = bs.ids.slice(); w.bossMods = bs.mods;
    w.draftCards = (n % 6 === 0) ? 4 : 3;

    /* the reunion arrives as its own wave-long stream with an elite mutator */
    var rc = Math.max(6, Math.round(budget * K.endless.reunionFrac));
    w.beats.push({
      t: K.ingressTime + 2, type: reunion.type, count: rc, gate: 0,
      mutator: reunion.mutator, elite: true
    });
    w.beats.sort(function (a, b) { return a.t - b.t; });
    w.budget += rc;
    w.roster.push(reunion.type);
    /* the rolled enemy mutator rides on the filler type all wave */
    for (i = 0; i < w.beats.length; i++) if (w.beats[i].type === enemyMut.type && !w.beats[i].mutator) w.beats[i].mutator = enemyMut.mutator;
    /* the burst carries the same two rolls: endless goes through the
     * all-at-once path exactly like a scripted wave */
    var rGroups = Math.max(1, Math.min(Math.ceil(rc / 6), 24)), rPer = Math.floor(rc / rGroups), rEx = rc - rPer * rGroups;
    for (i = 0; i < rGroups; i++) {
      var rN = rPer + (i < rEx ? 1 : 0);
      if (rN > 0) w.burst.push({ type: reunion.type, count: rN, gate: i % Math.max(1, w.gateCount), mutator: reunion.mutator, elite: true });
    }
    w.burstTotal += rc;
    for (i = 0; i < w.burst.length; i++) if (w.burst[i].type === enemyMut.type && !w.burst[i].mutator) w.burst[i].mutator = enemyMut.mutator;
    return w;
  }

  /* ====================================================================
   * THE RUNNER
   * ================================================================== */
  var notes = [], noted = Object.create(null), subCache = Object.create(null);
  function note(msg) {
    if (noted[msg]) return;
    noted[msg] = 1;
    notes.push(msg);
    if (notes.length > 12) notes.shift();
    if (typeof console !== 'undefined' && console.warn && NA.params && NA.params.debug) console.warn('[waves] ' + msg);
  }

  function registered(id) {
    return !!(NA.Enemies && NA.Enemies.typeIndex && NA.Enemies.typeIndex(id) >= 0);
  }
  /* an id the enemy agents have not landed yet must never crash a wave: it is
   * substituted by a registered type of the same role and noted on the overlay */
  function resolveType(id) {
    if (registered(id)) return id;
    if (subCache[id] !== undefined) return subCache[id];
    var list = FALLBACK[roleOf(id)] || FALLBACK.filler, q, r;
    for (q = 0; q < list.length; q++) if (registered(list[q])) {
      subCache[id] = list[q]; note('enemy "' + id + '" not registered -> ' + list[q]); return list[q];
    }
    for (r in FALLBACK) for (q = 0; q < FALLBACK[r].length; q++) if (registered(FALLBACK[r][q])) {
      subCache[id] = FALLBACK[r][q]; note('enemy "' + id + '" not registered -> ' + FALLBACK[r][q]); return FALLBACK[r][q];
    }
    var T = NA.Enemies && NA.Enemies.types;
    if (T && T.length) { subCache[id] = T[0].id; note('enemy "' + id + '" not registered -> ' + T[0].id); return T[0].id; }
    subCache[id] = null;
    note('enemy "' + id + '" not registered and no substitute exists');
    return null;
  }

  /* set while the burst is dispensing: the wave's whole composition has to be
   * on the floor at once, so the per-type simultaneous cap is bypassed there
   * (the composer's cap x churn totals still bound how many exist). */
  var noCapSpawn = false;
  var typeCount = new Int32Array(128), countT = 0;
  function recount() {
    for (var t = 0; t < 128; t++) typeCount[t] = 0;
    var P = NA.Enemies && NA.Enemies.pool; if (!P) return;
    for (var i = 0; i < P.n; i++) { var ti = P.type[i]; if (ti >= 0 && ti < 128) typeCount[ti]++; }
  }
  function liveOf(id) {
    var ti = (NA.Enemies && NA.Enemies.typeIndex) ? NA.Enemies.typeIndex(id) : -1;
    return (ti >= 0 && ti < 128) ? typeCount[ti] : 0;
  }

  var W = NA.Waves = {
    KNOBS: K, ROLE: ROLE, COST: COST, CAP: CAP, INTERIOR: INTERIOR, ALTERER: ALTERER,
    BOSS_MODS: BOSS_MODS, AMBIENT: AMBIENT, MUTS: MUTS,
    script: script, specs: SPECS, notes: notes,

    n: 0, current: null,
    spawned: 0, budget: 0, t: 0,
    phase: 'ingress', done: false, running: false,
    gates: [0, Math.PI],
    ambient: { fog: 0, tide: 0, strobe: 0, glassFloor: 0, lowCeiling: 0 },
    bossMods: null,

    _beatIdx: 0, _spikeIdx: 0, _closerOn: false, _stall: 0,
    _dripT: 0, _warnT: 0, _warnGate: 0, _swirls: [], _eventT: 0, _eventIdx: 0,
    _bossCrowdT: 0,
    _burst: [], _burstIdx: 0, _burstT: 0, _prog: 0, _stuckT: 0,

    /* the whole wave spawns at t=0, so "progress" is what has been *killed*:
     * 0 at the arrival, 1 when the arena is clear.  Monotonic, so enemies that
     * spawn other enemies (Hive, Necromancer) can never wind the ring back. */
    get progress() { return W._prog; },

    get: function (n) { return ((n >= 1 && n <= 30) ? script[n] : null) || W.endless(n); },
    endless: endless,
    simCap: simCap,
    rosterAt: rosterAt,
    retiredBefore: retiredBefore,
    newAt: newAt,
    draftCards: function (n) { var w = W.get(n); return (w && w.draftCards) || 3; },
    overviewPlan: function (n) { var w = W.get(n); return (w && w.overviewPlan) || []; },
    debugNote: function () { return notes.length ? notes.slice(-3).join(' | ') : ''; },

    /* ---------------------------------------------------------------- start */
    start: function (n) {
      var w = W.get(n), i;
      W.n = n; W.current = w;
      W.spawned = 0; W.t = 0;
      W.phase = 'body'; W.done = false; W.running = true;
      W._beatIdx = 0; W._spikeIdx = 0; W._closerOn = false; W._stall = 0;
      W._dripT = 0; W._warnT = 0; W._eventT = 0; W._eventIdx = 0; W._noSpawnT = 0;
      W._swirls.length = 0;
      countT = 0; recount();

      /* ---- the burst queue: the whole wave, dispensed at t=0 ------------- */
      W._burst.length = 0;
      W._burstIdx = 0; W._burstT = 0; W._prog = 0; W._stuckT = 0;
      var src = w.burst || [];
      for (i = 0; i < src.length; i++) {
        var g = src[i];
        W._burst.push({
          type: g.type, count: g.count, gate: g.gate || 0,
          pos: g.pos, angle: g.angle, overview: !!g.overview,
          swirl: g.swirl || 0, mutator: g.mutator || 0
        });
      }
      W.budget = w.burstTotal || w.budget || 20;
      var poolRoom = C.MAX_ENEMIES - K.burstReserve;
      if (W.budget > poolRoom)
        note('wave ' + n + ': burst of ' + W.budget + ' exceeds the pool (' + poolRoom +
             ') - clamped, remainder spawns as slots free');

      /* gates rotate every wave so the arena never reads the same twice */
      var g = w.gateCount || 3;
      W.gates.length = 0;
      for (i = 0; i < g; i++) W.gates.push(n * 0.7 + i / g * M.TAU);

      /* act boundaries set the biome */
      if (w.biome && NA.Events && NA.Events.setBiome) NA.Events.setBiome(w.biome);

      /* ambient arena mutators (§7.2) */
      W.ambient.fog = W.ambient.tide = W.ambient.strobe = 0;
      W.ambient.glassFloor = W.ambient.lowCeiling = 0;
      for (i = 0; i < (w.mutators || []).length; i++) {
        var mu = w.mutators[i];
        if (W.ambient[mu] !== undefined) W.ambient[mu] = 1;
      }
      if (NA.Arena && NA.Arena.setRadius) {
        if (W.ambient.lowCeiling) NA.Arena.setRadius(C.ARENA_R * K.lowCeiling, 1.5);
      }

      /* F18 -- one event owner.  The Strobe ambient mutator is published as the
       * events module's own multiplier (3x as often) and the act's set + cadence
       * is armed here, so eclipse stays a single wave-9 moment. */
      if (NA.Events) {
        NA.Events.strobeMultiplier = W.ambient.strobe ? K.strobeEventMul : 1;
        if (NA.Events.schedule) NA.Events.schedule(w.biome, n);
      }

      if (w.boss && NA.Bosses && NA.Bosses.defs && !NA.Bosses.defs[w.boss]) note('boss "' + w.boss + '" not registered yet');
      if (NA.Audio && NA.Audio.music && NA.Audio.music.setIntensity) NA.Audio.music.setIntensity(0.3);
      return w;
    },

    stop: function () {
      W.running = false;
      if (NA.Events) { NA.Events.windX = 0; NA.Events.windY = 0; }
    },

    /* --------------------------------------------------------------- spawn */
    _spawnGroup: function (type, count, gateIdx, posX, posY, mutBits) {
      var made = 0, id = resolveType(type);
      if (!id) { W.spawned += count; return 0; }                 // never stall on a missing type
      var E = NA.Enemies, cap = capOf(id), live = liveOf(id), i;
      for (i = 0; i < count; i++) {
        if (!noCapSpawn && W.spawned >= W.budget) break;
        if (!noCapSpawn && live + made >= cap) break;              // per-type simultaneous cap
        if (noCapSpawn && NA.Enemies.n >= C.MAX_ENEMIES - K.burstReserve) break;
        var x = 0, y = 0, ok = false, tries;
        for (tries = 0; tries < 4 && !ok; tries++) {
          if (posX !== undefined) {
            var sp = 40 + tries * 55;                        // widen if the player is on the spot
            x = posX + NA.RNG.range(-sp, sp); y = posY + NA.RNG.range(-sp, sp);
          } else {
            var a = W.gates[gateIdx % W.gates.length] + NA.RNG.range(-0.22, 0.22);
            var r = NA.Arena.radiusAt(a) - NA.RNG.range(20, 90);
            x = NA.Arena.cx + Math.cos(a) * r; y = NA.Arena.cy + Math.sin(a) * r;
          }
          /* nothing spawns within four ship-widths of the player */
          if (M.dist2(x, y, NA.Player.x, NA.Player.y) >= K.safeRadius * K.safeRadius) ok = true;
        }
        if (!ok) continue;
        var e = E.spawn(id, x, y);
        if (e >= 0) {
          W.spawned++; made++;
          if (mutBits && E.setMutator) E.setMutator(e, mutBits);
        }
      }
      if (made) {
        var ti = E.typeIndex(id);
        if (ti >= 0 && ti < 128) typeCount[ti] += made;
      }
      return made;
    },

    /* Burst rim spawner: no per-type simultaneous cap (the wave's whole
     * composition must be on the floor at once), fans the group across its
     * gate's whole sector so the arrival reads as a ring, and retries the
     * player's safe radius instead of dropping the enemy.
     * Returns how many it actually placed (short = the pool is full). */
    _spawnBurstRim: function (type, count, gateIdx, bits) {
      var id = resolveType(type);
      if (!id) { W.spawned += count; return count; }        // never stall on a missing type
      var E = NA.Enemies, made = 0, i, tries;
      var gN = Math.max(1, W.gates.length);
      var half = Math.PI / gN * 0.92;                       // the gates tile the rim
      var a0 = W.gates[gateIdx % gN];
      for (i = 0; i < count; i++) {
        var x = 0, y = 0, ok = false, a, r;
        for (tries = 0; tries < 6 && !ok; tries++) {
          a = a0 + NA.RNG.range(-half, half);
          r = NA.Arena.radiusAt(a) - NA.RNG.range(20, 20 + 130 * (tries + 1) / 6);
          x = NA.Arena.cx + Math.cos(a) * r; y = NA.Arena.cy + Math.sin(a) * r;
          if (M.dist2(x, y, NA.Player.x, NA.Player.y) >= K.safeRadius * K.safeRadius) ok = true;
        }
        if (!ok) continue;
        var e = E.spawn(id, x, y);
        if (e < 0) break;                                   // pool full: the rest waits
        W.spawned++; made++;
        if (bits && E.setMutator) E.setMutator(e, bits);
      }
      if (made) { var ti = E.typeIndex(id); if (ti >= 0 && ti < 128) typeCount[ti] += made; }
      return made;
    },

    /* dispense the burst queue: the whole wave inside K.burstRamp seconds,
     * held back only by the enemy pool. */
    _dispense: function (dt) {
      var q = W._burst, tot = q.length, En = NA.Enemies;
      if (W._burstIdx >= tot) return;
      W._burstT += dt;
      var want = Math.ceil(tot * M.clamp01(W._burstT / K.burstRamp));
      if (want <= W._burstIdx) want = W._burstIdx + 1;      // always make progress
      var progressed = false;
      while (W._burstIdx < tot && W._burstIdx < want) {
        var g = q[W._burstIdx];
        var room = (C.MAX_ENEMIES - K.burstReserve) - (En ? En.n : 0);
        if (room <= 0) break;                               // pool full: wait for slots
        var take = Math.min(g.count, room);
        var bits = (g.mutator && MUT_BIT[g.mutator]) ? MUT_BIT[g.mutator] : 0;
        var mk;
        if (g.swirl) {                                      // interior: announce it first
          W._swirls.push({
            x: g.pos[0], y: g.pos[1], t: 0, dur: g.swirl,
            type: g.type, count: take, gate: g.gate, bits: bits
          });
          if (NA.Audio && NA.Audio.sfx) NA.Audio.sfx('telegraph', { x: g.pos[0], y: g.pos[1] });
          mk = take;
        } else if (g.overview) {
          var oa = (g.angle === undefined) ? W.gates[g.gate % W.gates.length] : g.angle;
          var orr = NA.Arena.radiusAt(oa) - 60;
          noCapSpawn = true;
          mk = W._spawnGroup(g.type, take, g.gate, NA.Arena.cx + Math.cos(oa) * orr,
            NA.Arena.cy + Math.sin(oa) * orr, bits);
          noCapSpawn = false;
        } else if (g.pos) {
          noCapSpawn = true;
          mk = W._spawnGroup(g.type, take, g.gate, g.pos[0], g.pos[1], bits);
          noCapSpawn = false;
        } else {
          mk = W._spawnBurstRim(g.type, take, g.gate, bits);
        }
        if (mk > 0) { g.count -= mk; progressed = true; }
        if (g.count <= 0) { W._burstIdx++; W._stuckT = 0; }
        else break;                                         // out of room this frame
      }
      /* the whole wave is on the floor: the budget is spent by definition, so
       * a spawn the safe radius or the pool refused can never hold the wave
       * open (it ends on the queue + the kill count, not on bookkeeping). */
      if (W._burstIdx >= tot && W.spawned < W.budget) W.spawned = W.budget;
      if (!progressed && W._burstIdx < tot) {
        /* anti-softlock: a group that cannot place anything for a while (the
         * pool is not full, every rolled spot is unusable) is written off so
         * `spawned` always reaches `budget` and the wave can always end. */
        W._stuckT += dt;
        if (W._stuckT > K.burstStuck) {
          var gg = q[W._burstIdx];
          if ((C.MAX_ENEMIES - K.burstReserve) - (En ? En.n : 0) > 0) {
            W.spawned += gg.count; gg.count = 0; W._burstIdx++;
            note('wave ' + W.n + ': burst group "' + gg.type + '" could not be placed - credited');
          }
          W._stuckT = 0;
        }
      } else W._stuckT = 0;
    },

    /* the next stream type that is still under its simultaneous cap */
    _streamPick: function (closer) {
      var w = W.current, list, i;
      if (closer && w.closerTypes && w.closerTypes.length) {
        list = w.closerTypes;
        for (i = 0; i < list.length; i++) if (liveOf(list[i]) < capOf(list[i])) return list[i];
        /* every closer type is at its simultaneous cap. Returning list[0]
         * anyway spawns nothing, so `spawned` never reaches `budget` and the
         * wave cannot end (endless waves are all "problem" closers, every one
         * of them hard-capped). Fall through to the general stream instead. */
      }
      list = w.stream;
      if (!list || !list.length) return (w.roster && w.roster[0]) || 'mote';
      var tot = 0;
      for (i = 0; i < list.length; i++) if (liveOf(list[i][0]) < capOf(list[i][0])) tot += list[i][1];
      if (tot <= 0) {
        // every stream type is capped too: fall back to an uncapped filler so
        // the budget can always be spent and the wave can always end
        for (i = 0; i < (w.roster || []).length; i++) if (liveOf(w.roster[i]) < capOf(w.roster[i])) return w.roster[i];
        return 'mote';
      }
      var r = NA.RNG.f() * tot;
      for (i = 0; i < list.length; i++) {
        if (liveOf(list[i][0]) >= capOf(list[i][0])) continue;
        r -= list[i][1];
        if (r <= 0) return list[i][0];
      }
      return list[list.length - 1][0];
    },

    /* --------------------------------------------------------------- update */
    update: function (dt) {
      if (!W.running || !W.current) return;
      var w = W.current, i;
      W.t += dt;

      countT -= dt;
      if (countT <= 0) { countT = 0.2; recount(); }

      var cap = w.simCap || simCap(W.n);
      var alive = NA.Enemies ? NA.Enemies.n : 0;

      /* ---- the burst: the whole wave arrives at t=0 -------------------- */
      W._dispense(dt);
      alive = NA.Enemies ? NA.Enemies.n : 0;                // the burst just landed

      /* phase: no ingress, no spike — the wave is simply here, and the last
       * 10% of the kills is the closer. */
      var killed = W.spawned - alive;
      if (killed >= W.budget * (1 - K.closerFrac)) W._closerOn = true;
      W.phase = W._closerOn ? 'closer' : 'body';
      var pr = W.budget ? M.clamp01(killed / W.budget) : 1;
      if (pr > W._prog) W._prog = pr;

      /* ---- interior swirls resolve into their spawner ----------------- */
      for (i = W._swirls.length - 1; i >= 0; i--) {
        var s = W._swirls[i];
        s.t += dt;
        if (s.t >= s.dur) {
          noCapSpawn = true;
          W._spawnGroup(s.type, s.count, s.gate, s.x, s.y, s.bits);
          noCapSpawn = false;
          if (NA.FX) NA.FX.trauma(0.08);
          if (NA.Arena && NA.Arena.ripple) NA.Arena.ripple(s.x, s.y, 1.2, 1, 0.3, 0.9);
          W._swirls.splice(i, 1);
        }
      }

      /* Pressure spikes and the rate-governed body drip are gone: the owner
       * rule is that a regular wave arrives all at once, so there is nothing
       * left to drip and no mid-wave spike to warn about.  w.beats / w.spikes /
       * w.stream are still authored (tools and the overview read them).
       */
      /* ---- ambient arena mutators and background events ---------------- */
      W._ambientTick(dt);
      W._eventTick(dt);

      /* ---- end on kill count, never on a timer ------------------------- */
      var queued = W._burstIdx < W._burst.length;
      if (!queued && alive === 0 && W._swirls.length === 0) {
        W.done = true; W.running = false;
        if (NA.Enemies) NA.Enemies.beacon = false;
        if (NA.Events) { NA.Events.windX = 0; NA.Events.windY = 0; }
      }

      /* ---- the 20s stall rule: rim beacon + drift toward the player ---- */
      if (!queued && alive > 0) {
        W._stall += dt;
        var on = W._stall > K.stallAfter;
        if (NA.Enemies) NA.Enemies.beacon = on;
        if (on) {
          var P = NA.Enemies.pool, px = NA.Player.x, py = NA.Player.y, step = K.stallDrift * dt;
          for (i = 0; i < P.n; i++) {
            var dx = px - P.x[i], dy = py - P.y[i];
            var d = Math.sqrt(dx * dx + dy * dy) || 1;
            P.x[i] += dx / d * step; P.y[i] += dy / d * step;
          }
        }
      } else {
        W._stall = 0;
        if (NA.Enemies) NA.Enemies.beacon = false;
      }

      if (NA.Audio && NA.Audio.music && NA.Audio.music.setIntensity)
        NA.Audio.music.setIntensity(M.clamp01(alive / Math.max(20, cap * 0.35)));
    },

    _ambientTick: function () {
      var A = W.ambient;
      if (A.fog && NA.FX && NA.FX.darkness) NA.FX.darkness(K.fogDark, 1200);
      if (A.tide && NA.Events) {
        var a = NA.Time.t * 0.25;
        NA.Events.windX = Math.cos(a) * K.tideForce;
        NA.Events.windY = Math.sin(a) * K.tideForce;
      }
    },

    _eventTick: function (dt) {
      var w = W.current, i;
      if (!NA.Events || !NA.Events.trigger) return;
      /* scripted one-shots (the wave-3 Supernova, ...) */
      while (W._eventIdx < (w.eventBeats || []).length && W.t >= w.eventBeats[W._eventIdx].t) {
        var eb = w.eventBeats[W._eventIdx++];
        if (NA.Events.defs && NA.Events.defs[eb.id]) NA.Events.trigger(eb.id);
        else note('event "' + eb.id + '" not registered yet');
      }
      /* The ambient schedule lives in 12_events.js (F18): one owner, so the
       * biome cadence, the once-only wave-9 eclipse, "Pulsar Sweep is constant"
       * and the Strobe multiplier are all reachable.  W.start() arms it. */
    },

    /* ----------------------------------------------- endless boss mutators
     * The flags the boss runner reads (NA.Bosses.mods):
     *   hasty     shorter telegraphs
     *   cloaked   invisible outside its telegraphs
     *   crowded   spawn rate x2 with heal-on-touch  (fed here by bossTick)
     *   cramped   70% arena                          (applied here)
     *   unstable  slow turntable floor               (applied here)
     *   shy       vulnerable only with no enemies alive
     *   twin      two instances of a cheap boss
     *   looped    an input-echo ghost                                        */
    applyBossMods: function (mods) {
      W.bossMods = mods || null;
      if (NA.Bosses) NA.Bosses.mods = W.bossMods;
      if (!mods) {
        if (NA.Arena) {
          if (NA.Arena.setRadius) NA.Arena.setRadius(C.ARENA_R, 0.8);
          if (NA.Arena.rotate) NA.Arena.rotate(0);
        }
        return;
      }
      if (mods.cramped && NA.Arena && NA.Arena.setRadius) NA.Arena.setRadius(C.ARENA_R * 0.7, 1.2);
      if (mods.unstable && NA.Arena && NA.Arena.rotate) NA.Arena.rotate(0.05);
      W._bossCrowdT = 0;
    },

    /* per-frame work for the mods the waves module owns (crowded) */
    bossTick: function (dt) {
      var mods = W.bossMods;
      if (!mods || !mods.crowded) return;
      W._bossCrowdT -= dt;
      if (W._bossCrowdT > 0) return;
      W._bossCrowdT = 1.2;
      if ((NA.Enemies ? NA.Enemies.n : 0) > K.endless.capHold * 0.4) return;
      var w = W.current;
      var id = (w && w.stream && w.stream.length) ? w.stream[0][0] : 'mote';
      var a = NA.RNG.f() * M.TAU;
      var r = NA.Arena.radiusAt(a) - 40;
      W.budget += 4;
      W._spawnGroup(id, 4, 0, NA.Arena.cx + Math.cos(a) * r, NA.Arena.cy + Math.sin(a) * r);
    },

    /* --------------------------------------------------------- dev entries */
    devStart: function (n) {
      n = Math.max(1, n | 0);
      var w = W.get(n);
      if (NA.Events && NA.Events.setBiome && w.biome) NA.Events.setBiome(w.biome);
      /* a plausible random build for wave n */
      if (NA.Upgrades && NA.Upgrades.list && NA.Upgrades.take) {
        var picks = Math.min(NA.Upgrades.list.length, Math.max(0, Math.floor(n * 0.9)));
        var used = Object.create(null);
        for (var i = 0; i < picks; i++) {
          var id = NA.Upgrades.list[NA.RNG.int(NA.Upgrades.list.length)];
          if (used[id]) continue;
          used[id] = 1;
          try { NA.Upgrades.take(id); } catch (e) { note('upgrade "' + id + '" failed'); }
        }
      }
      if (NA.Game && NA.Game.startWave) NA.Game.startWave(n);
      else W.start(n);
    },

    startEndless: function (n) {
      n = Math.max(31, n | 0);
      if (NA.Game && NA.Game.newRun) NA.Game.newRun();
      W.devStart(n);
    },

    /* --------------------------------------------------------------- render */
    render: function () {
      if (!W.running) return;
      var R = NA.R, L = R.L, i;

      /* the gates glow while the wave is pouring through them (and dim once
       * the whole burst is on the floor) */
      var k = (W._burstIdx < W._burst.length || W.t < 1.2) ? 1 : 0.35;
      for (i = 0; i < W.gates.length; i++) {
        var a = W.gates[i];
        var rr = NA.Arena.radiusAt(a);
        var pulse = 0.4 + 0.35 * Math.sin(NA.Time.t * 3 + i);
        R.arc(L.MEMBRANE, NA.Arena.cx, NA.Arena.cy, rr - 8, a - 0.18, a + 0.18, 12,
          1, 0.55, 0.25, k * pulse);
      }

      /* the pressure-spike warning: the new gate flashes orange -> red */
      if (W._warnT > 0) {
        var wa = W.gates[W._warnGate % W.gates.length];
        var wr = NA.Arena.radiusAt(wa);
        var kk = 1 - W._warnT / K.spikeWarn;
        var br = 0.55 + 0.45 * Math.sin(NA.Time.t * C.TELEGRAPH_HZ * M.TAU);
        R.arc(L.VEIL, NA.Arena.cx, NA.Arena.cy, wr - 10, wa - 0.5, wa + 0.5, 22,
          1, 0.54 * (1 - kk), 0.1, (0.35 + 0.55 * kk) * br);
      }

      /* interior spawners announce themselves with a swirl */
      for (i = 0; i < W._swirls.length; i++) {
        var s = W._swirls[i], sk = s.t / s.dur;
        R.ring(L.VEIL, s.x, s.y, 20 + (1 - sk) * 220, 3, 1, 0.24, 0.68, 0.35 + 0.5 * sk);
        R.ring(L.VEIL, s.x, s.y, 14 + sk * 26, 2, 1, 0.6, 0.9, 0.5 * sk);
      }

      /* the stall beacon: a gold arc at the bearing of a straggler */
      if (NA.Enemies && NA.Enemies.beacon && NA.Enemies.n > 0) {
        var P = NA.Enemies.pool;
        var ba = Math.atan2(P.y[0] - NA.Arena.cy, P.x[0] - NA.Arena.cx);
        var bp = 0.5 + 0.5 * Math.sin(NA.Time.t * 4);
        R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius + 26, ba - 0.12, ba + 0.12, 6,
          1, 0.85, 0.3, 0.5 + 0.4 * bp);
      }

      /* the rim spawn-budget ring depletes as the wave is consumed */
      R.arc(L.HUD, NA.Arena.cx, NA.Arena.cy, NA.Arena.radius + 18, -M.HALFPI,
        -M.HALFPI + M.TAU * (1 - W.progress), 3, 0.30, 0.95, 1.0, 0.35);
    }
  };

  /* endless boss mutators are applied when a boss fight begins, cleared after */
  if (NA.Game && NA.Game.on) {
    NA.Game.on('stateChange', function (s) {
      if (s === 'boss') {
        var w = W.get(NA.Game.wave);
        W.applyBossMods(w && w.bossMods ? w.bossMods : null);
      } else if (W.bossMods) {
        W.applyBossMods(null);
      }
    });
  }
})();
