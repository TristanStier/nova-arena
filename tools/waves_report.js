#!/usr/bin/env node
/* tools/waves_report.js — play-balance sanity for src/14_waves.js.
 *
 * Loads the waves module alone against a stubbed NA (no browser, no build) and
 * prints, per wave 1..30 (and a sample of endless): budget, roster, the cost
 * mix, the expected simultaneous peak, new and retired types, the boss, and any
 * violation of GAME_PLAN §4/§7/§8.
 *
 * Usage: node tools/waves_report.js [--endless=12] [--quiet] [--json]
 * Exit code 1 if any ERROR-level violation is found.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', '14_waves.js');

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? '1' : m[2];
}
const ENDLESS_N = +(argv.endless || 8);
const QUIET = !!argv.quiet;

/* ------------------------------------------------------------------ stub NA */
const TAU = Math.PI * 2;
const M = {
  TAU, HALFPI: Math.PI / 2,
  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  clamp01: (v) => v < 0 ? 0 : (v > 1 ? 1 : v),
  dist2: (x1, y1, x2, y2) => (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2),
  lerp: (a, b, t) => a + (b - a) * t
};
let rngState = 123456789;
function frand() {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  rngState >>>= 0; return rngState / 4294967296;
}
const NA = {
  version: 'report',
  params: {},
  M,
  C: { ARENA_R: 1400, MAX_ENEMIES: 1024, TELEGRAPH_HZ: 2, COL: { white: [1, 1, 1], magenta: [1, 0.2, 0.6] } },
  RNG: {
    seed(n) { rngState = (n >>> 0) || 1; },
    f: frand,
    range: (a, b) => a + frand() * (b - a),
    int: (n) => Math.floor(frand() * n) % Math.max(1, n),
    pick: (a) => a[Math.floor(frand() * a.length) % a.length],
    chance: (p) => frand() < p,
    fork: () => ({ f: frand })
  },
  Time: { t: 0, fixed: 1 / 120 },
  /* the enemy registry as it will exist once every agent has landed: ids and
   * costs only — enough for the composer to read real costs. */
  Enemies: { types: [], byId: Object.create(null), typeIndex(id) { const v = this.byId[id]; return v === undefined ? -1 : v; }, n: 0, pool: { n: 0, type: [] } },
  Bosses: { list: [], defs: Object.create(null) },
  Events: { defs: Object.create(null), setBiome() { }, trigger() { }, windX: 0, windY: 0 },
  Arena: { cx: 0, cy: 0, radius: 1400, radiusAt: () => 1400, setRadius() { }, rotate() { }, ripple() { } },
  Player: { x: 0, y: 0 },
  FX: { flash() { }, trauma() { }, darkness() { } },
  R: { L: {}, arc() { }, ring() { } },
  Game: { seed: 12345, wave: 1, on() { } }
};

/* The canonical enemy ids (AGENT_RULES §8) with the authoring costs from the
 * waves module, so the report exercises the same registry path the game does. */
const ENEMY_IDS = ('mote drifter skitter spitter popper moteling lancer charger shade constrictor ' +
  'sentinel mortar bloat sower tetherPair puller hive larva glazier warden wisp splitter eclipse ' +
  'prism siphon rotator necromancer husk doppel chronoform flak wraith crush cathedral herald ' +
  'singularity ouroboros chargerElite echo sunder swarmLord').split(/\s+/);
const BOSS_IDS = ('compactor constellation tide turntable metronome congregation strobe cartographer ' +
  'cadence understudy encore depth angler reflector inverter echo horizon supernova dimmer lurker ' +
  'schism siren probability page understudyPerfect duoLightsCamera duoBaitSwitch congregationRequiem ' +
  'duoHeatDeath singularity').split(/\s+/);

const ctx = vm.createContext({ NA, console, Math, Object, Array, Int32Array, Float32Array, JSON });
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: SRC });

/* register the ids after load: script[n] is built lazily, so it sees them */
const W = NA.Waves;
ENEMY_IDS.forEach((id, i) => {
  NA.Enemies.byId[id] = i;
  NA.Enemies.types[i] = { id, cost: W.COST[id] || 3 };
});
BOSS_IDS.forEach((id) => { NA.Bosses.list.push(id); NA.Bosses.defs[id] = { id }; });

/* ------------------------------------------------------- peak simulation */
/* Model: walk the authored schedule at 0.25s, add every arrival, remove kills
 * at K.reportKillRate(wave) per second (never below zero).  The peak of that
 * curve is what the player is asked to hold on screen at once. */
function simulatePeak(w) {
  const K = W.KNOBS;
  const dt = 0.25;
  const T = (w.duration || 60) * 1.6;
  const killRate = K.reportKillRate(w.wave);
  let alive = 0, peak = 0, spawned = 0, bi = 0, si = 0, closer = false, dripT = 0;
  const budget = w.budget;
  for (let t = 0; t <= T && spawned < budget; t += dt) {
    while (bi < w.beats.length && t >= w.beats[bi].t) {
      const b = w.beats[bi++];
      const c = Math.min(b.count, budget - spawned);
      spawned += c; alive += c;
    }
    if (si < (w.spikes || []).length && t >= w.spikes[si].t) {
      const sp = w.spikes[si++];
      const remain = budget - spawned;
      const c = sp.all ? remain : (sp.count || Math.max(1, Math.round(remain * (sp.frac || K.spikeFrac))));
      const cc = Math.min(c, remain);
      spawned += cc; alive += cc;
    }
    if (spawned >= budget * (1 - K.closerFrac)) closer = true;
    dripT -= dt;
    if (dripT <= 0) {
      dripT = K.dripEvery;
      const wantBy = budget * (closer ? 1 : (1 - K.closerFrac)) * M.clamp01(t / ((w.duration || 60) * 0.85));
      if (spawned < wantBy && alive < w.simCap) {
        let g = Math.max(1, Math.round(budget / 60));
        g = Math.min(g, Math.round(w.simCap - alive), Math.ceil(wantBy - spawned));
        if (g > 0) { spawned += g; alive += g; }
      }
    }
    alive = Math.max(0, alive - killRate * dt);
    if (alive > peak) peak = alive;
  }
  return Math.round(peak);
}

/* ------------------------------------------------------------- validation */
const problems = [];
function err(w, msg) { problems.push({ level: 'ERROR', wave: w, msg }); }
function warn(w, msg) { problems.push({ level: 'WARN', wave: w, msg }); }

function checkWave(n, w) {
  const K = W.KNOBS;
  const retired = W.retiredBefore(n);
  const roster = w.roster;
  const rosterSet = new Set(roster);

  /* 1. the wave's one new thing must actually be in the roster */
  for (const nt of w.newTypes) {
    if (!rosterSet.has(nt)) err(n, `new type "${nt}" is not in the roster`);
    if (ENEMY_IDS.indexOf(nt) < 0) err(n, `new type "${nt}" is not a canonical enemy id`);
  }
  /* 2. retired types must never be used again */
  for (const id of roster) {
    if (retired[id]) err(n, `retired type "${id}" (retired at wave ${retired[id]}) is still in the roster`);
    if (ENEMY_IDS.indexOf(id) < 0) err(n, `roster type "${id}" is not a canonical enemy id`);
  }
  for (const b of w.beats) if (retired[b.type]) err(n, `beat at t=${b.t} spawns retired type "${b.type}"`);
  for (const s of (w.spikes || [])) if (retired[s.type]) err(n, `spike at t=${s.t} spawns retired type "${s.type}"`);

  /* 3. per-type caps: authored totals must respect cap x churn */
  for (const m of w.mix) {
    if (!m.cap) continue;
    const maxTotal = Math.max(m.cap, Math.round(m.cap * K.problemChurn));
    if (m.count > maxTotal) err(n, `"${m.type}" total ${m.count} exceeds cap ${m.cap} x churn (${maxTotal})`);
  }
  /* a single beat must never breach the simultaneous cap of its type */
  for (const b of w.beats) {
    const cap = W.CAP[b.type];
    if (cap && b.count > cap) warn(n, `beat at t=${b.t} asks for ${b.count} "${b.type}" over its cap ${cap} (the runner clamps)`);
  }

  /* 4. the cost mix: 55 / 30 / 15 renormalised over the roles present */
  const tot = w.costTotal || 1;
  let mixTot = 0;
  for (const role of ['filler', 'texture', 'problem']) if (roster.some((id) => W.ROLE[id] === role)) mixTot += K.mix[role];
  for (const role of ['filler', 'texture', 'problem']) {
    if (!roster.some((id) => W.ROLE[id] === role)) continue;
    const got = w.costByRole[role] / tot;
    const want = K.mix[role] / mixTot;
    if (Math.abs(got - want) > 0.12) warn(n, `cost mix ${role} ${(got * 100).toFixed(0)}% (plan ${(want * 100).toFixed(0)}%)`);
  }

  /* 5. choreography */
  if (w.gateCount < K.gatesMin || w.gateCount > K.gatesMax) err(n, `gate count ${w.gateCount} outside 2..4`);
  const wantSpikes = n >= K.twoSpikesFrom ? 2 : (n === 1 ? 0 : 1);
  if ((w.spikes || []).length < wantSpikes) err(n, `${(w.spikes || []).length} spikes, plan wants ${wantSpikes}`);
  for (const s of (w.spikes || [])) {
    if ((s.warn || 0) < 1.5) err(n, `spike at t=${s.t} has no 1.5s rim warning`);
    const dominant = w.mix.filter((m) => m.role === 'filler').sort((a, b) => b.count - a.count)[0];
    if (dominant && s.type === dominant.type && !s.all) warn(n, `spike type "${s.type}" is the dominant filler`);
  }
  if (!w.closerTypes.length) err(n, 'no closer types');
  else for (const c of w.closerTypes) {
    if (W.ROLE[c] !== 'problem' && w.mix.some((m) => m.role === 'problem')) err(n, `closer type "${c}" is not a problem enemy`);
  }
  const ingress = w.beats.filter((b) => b.t < K.ingressTime && !b.overview);
  if (!ingress.length) err(n, 'no ingress beats in the first 10s');

  /* 6. the pairing rule (wave 1 has nothing to pair with) */
  for (const nt of w.newTypes) {
    if (roster.length < 2) continue;
    const partner = w.pair[nt];
    if (!partner) { warn(n, `new type "${nt}" has no pairing partner`); continue; }
    const pb = w.beats.filter((b) => b.pairWith === nt);
    const nb = w.beats.filter((b) => b.pairFor !== undefined && b.type === nt);
    const interiorOrAlterer = W.INTERIOR[nt] || W.ALTERER[nt];
    if (!pb.length && !interiorOrAlterer) err(n, `new type "${nt}" does not arrive alongside "${partner}"`);
    else if (pb.length && nb.length && pb[0].t !== nb[0].t) err(n, `pairing beat times differ for "${nt}"`);
  }

  /* 7. simultaneous peak vs the cap */
  const peak = simulatePeak(w);
  if (peak > w.simCap * 1.05) err(n, `expected simultaneous peak ${peak} exceeds the cap ${w.simCap}`);
  if (w.simCap > K.simCapMax) err(n, `sim cap ${w.simCap} above the performance ceiling ${K.simCapMax}`);

  /* 8. budget vs the 12 x 1.28^w curve (informational: the §8 table wins) */
  const curve = K.curveBase * Math.pow(K.curveGrow, n);
  if (n <= 12 && (w.budget > curve * 2.2 || w.budget < curve * 0.45)) warn(n, `budget ${w.budget} far from the curve ${Math.round(curve)}`);

  /* 9. bosses, biomes, drafts */
  if (!w.boss) err(n, 'no boss');
  else if (BOSS_IDS.indexOf(w.boss) < 0) err(n, `boss "${w.boss}" is not a canonical boss id`);
  const act = Math.min(5, Math.ceil(n / 6));
  const wantBiome = { 1: 'ember', 2: 'pulsar', 3: 'storm', 4: 'horizon', 5: 'core' }[act];
  if (w.biome !== wantBiome) err(n, `biome "${w.biome}" should be "${wantBiome}" for act ${act}`);
  const wantCards = (n % 6 === 0) ? 4 : 3;   // GAME_PLAN §8: 6/12/18/24 (+30, which NA.Game also treats as %6)
  if (w.draftCards !== wantCards) err(n, `draft cards ${w.draftCards}, plan wants ${wantCards}`);

  return peak;
}

/* ------------------------------------------------------------------ output */
const rows = [];
let prevRoster = new Set();
for (let n = 1; n <= 30; n++) {
  const w = W.script[n];
  const peak = checkWave(n, w);
  const roster = new Set(w.roster);
  const added = w.roster.filter((id) => !prevRoster.has(id));
  const gone = [...prevRoster].filter((id) => !roster.has(id));
  prevRoster = roster;
  rows.push({
    wave: n, act: w.act, biome: w.biome, budget: w.budget, cap: w.simCap, peak,
    boss: w.boss, cards: w.draftCards, gates: w.gateCount, spikes: w.spikes.length,
    dur: Math.round(w.duration),
    newTypes: w.newTypes, retire: w.retire, added, gone,
    mutators: w.mutators, theme: w.theme,
    mix: w.mix, costByRole: w.costByRole, costTotal: w.costTotal,
    closer: w.closerTypes, note: w.note
  });
}

/* endless sample */
const endlessRows = [];
for (let i = 0; i < ENDLESS_N; i++) {
  const n = 31 + i;
  const w = W.endless(n);
  endlessRows.push({
    wave: n, budget: w.budget, cap: w.simCap, peak: simulatePeak(w),
    boss: (w.bosses || [w.boss]).join(' + '),
    mods: Object.keys(w.bossMods || {}), ambient: w.mutators,
    enemyMut: `${w.enemyMut.mutator} ${w.enemyMut.type}`,
    reunion: `${w.reunion.mutator} ${w.reunion.type}`,
    guaranteed: w.guaranteed || '-'
  });
}
/* endless rules */
let prevArena = false, lightAt = [];
endlessRows.forEach((r, i) => {
  const n = r.wave;
  const ids = r.boss.split(' + ');
  const arenaSet = ['compactor', 'turntable', 'cartographer', 'inverter', 'horizon', 'schism', 'page', 'singularity', 'duoLightsCamera', 'duoHeatDeath', 'tide'];
  const lightSet = ['strobe', 'dimmer', 'duoLightsCamera', 'supernova'];
  const isArena = ids.some((x) => arenaSet.includes(x));
  const isLight = ids.some((x) => lightSet.includes(x));
  if (isArena && prevArena) err(n, 'two arena-manipulator bosses back to back');
  if (isLight && lightAt.some((k) => n - k < 4)) err(n, 'two lighting bosses within four waves');
  if (isLight) lightAt.push(n);
  prevArena = isArena;
  if (n >= W.KNOBS.endless.trioFrom && ids.length !== 3) err(n, `expected a trio, got ${ids.length}`);
  else if (n >= W.KNOBS.endless.duoFrom && n < W.KNOBS.endless.trioFrom && ids.length !== 2) err(n, `expected a duo, got ${ids.length}`);
  if (n % W.KNOBS.endless.bigEvery === 0 && r.guaranteed === '-') err(n, 'no Cathedral/Singularity on a third wave');
  if (r.cap !== W.KNOBS.endless.capHold) err(n, `endless sim cap ${r.cap} is not the ceiling ${W.KNOBS.endless.capHold}`);
});

if (argv.json) {
  console.log(JSON.stringify({ waves: rows, endless: endlessRows, problems }, null, 2));
} else if (!QUIET) {
  const pad = (s, n2) => String(s).padEnd(n2).slice(0, n2);
  const padl = (s, n2) => String(s).padStart(n2);
  console.log('NOVA ARENA — wave report (GAME_PLAN §4 / §7 / §8)\n');
  console.log(pad('W', 3) + pad('biome', 8) + padl('budget', 7) + padl('cap', 5) + padl('peak', 6) +
    padl('sec', 5) + padl('g', 3) + padl('sp', 3) + padl('cards', 6) + '  ' +
    pad('mix f/t/p', 14) + pad('boss', 22) + 'new / retired');
  console.log('-'.repeat(140));
  for (const r of rows) {
    const t = r.costTotal || 1;
    const mix = `${Math.round(r.costByRole.filler / t * 100)}/${Math.round(r.costByRole.texture / t * 100)}/${Math.round(r.costByRole.problem / t * 100)}`;
    console.log(
      pad(r.wave, 3) + pad(r.biome, 8) + padl(r.budget, 7) + padl(r.cap, 5) + padl(r.peak, 6) +
      padl(r.dur, 5) + padl(r.gates, 3) + padl(r.spikes, 3) + padl(r.cards, 6) + '  ' +
      pad(mix, 14) + pad(r.boss, 22) +
      (r.newTypes.length ? '+' + r.newTypes.join(',') : '') +
      (r.retire.length ? '  -' + r.retire.join(',') : '') +
      (r.mutators.length ? '  [' + r.mutators.join(',') + ']' : '') +
      (r.theme ? '  {' + r.theme + '}' : ''));
    console.log('    roster: ' + r.mix.map((m) => `${m.type}x${m.count}${m.capped ? '*' : ''}`).join(' ') +
      '\n    closer: ' + r.closer.join(',') + '   — ' + r.note);
  }
  console.log('\nENDLESS (§8.2)');
  console.log('-'.repeat(140));
  for (const r of endlessRows) {
    console.log(pad(r.wave, 4) + padl(r.budget, 7) + padl(r.cap, 5) + padl(r.peak, 6) + '  ' +
      pad(r.boss, 40) + pad('[' + r.mods.join(',') + ']', 34) +
      'ambient:' + pad(r.ambient.join(','), 12) + 'mut:' + pad(r.enemyMut, 20) +
      'reunion:' + pad(r.reunion, 20) + 'big:' + r.guaranteed);
  }
}

const errors = problems.filter((p) => p.level === 'ERROR');
const warns = problems.filter((p) => p.level === 'WARN');
console.log('\n' + (problems.length ? 'VIOLATIONS' : 'no violations'));
for (const p of problems) console.log(`  ${p.level} wave ${p.wave}: ${p.msg}`);
console.log(`\n${rows.length} waves, ${endlessRows.length} endless waves checked — ${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
