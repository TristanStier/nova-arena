/* =============================================================================
 * NOVA ARENA — 03_audio.js — NA.Audio
 * Procedural WebAudio: pooled SFX voices + a generative music engine.
 * No files, no fetch, no external assets. Loads standalone (guards every NA.*).
 *
 * PUBLIC API
 * ----------
 *   NA.Audio.init()                    create/resume the AudioContext (call on
 *                                      any user gesture; safe to call repeatedly)
 *   NA.Audio.enabled                   bool; false silences everything
 *   NA.Audio.ready                     bool; true once the context exists
 *   NA.Audio.ctx                       the AudioContext (null before init)
 *   NA.Audio.setVolumes({master, music, sfx})   each 0..1 (caller persists them)
 *   NA.Audio.getVolumes()              -> {master, music, sfx}
 *   NA.Audio.setListener(x, y)         world-space listener for pan/attenuation
 *   NA.Audio.setTimeScale(s)           global slow-mo: pitches SFX + music down
 *   NA.Audio.duck(db, ms)              duck the music bus by db for ms
 *   NA.Audio.suspend() / NA.Audio.resume()
 *   NA.Audio.voiceCount()              live voices (cap 24, oldest-steal)
 *
 *   NA.Audio.sfx(name, opts)           opts = {x, y, pitch, vol, n, tier, dur}
 *   NA.Audio.killCombo(n, opts)        convenience for sfx('killCombo',{n:n})
 *   NA.Audio.names                     array of every valid sfx name:
 *     shot shotHeavy rail kill killCombo hitEnemy hitPlayer dash graze wall
 *     manaFull manaDry spendActive explode lightning supernovaCharge supernova
 *     telegraph lock laser charge spawn bossIntro bossPhase bossDeath
 *     draftHover draftPick draftSkip waveClear death uiTick uiConfirm gate
 *
 *   NA.Audio.music.start() / .stop()
 *   NA.Audio.music.setMode(name)       dorian lydian phrygian aeolian
 *                                      mixolydian finale
 *   NA.Audio.music.mode                current mode name
 *   NA.Audio.music.setIntensity(0..1)  opens the highpass, fades in the arp
 *   NA.Audio.music.intensity
 *   NA.Audio.music.setBpm(n) / .bpm    default 120
 *   NA.Audio.music.beat                current quarter-note index (integer)
 *   NA.Audio.music.bar                 current bar index
 *   NA.Audio.music.onBeat(cb)          cb(beatIndex, timeSeconds); returns an
 *                                      unsubscribe function
 *   NA.Audio.music.setLowpass(0..1)    0 = open, 1 = muffled (low-HP effect)
 *   NA.Audio.music.stinger(name)       'waveClear' | 'bossDeath' | 'victory'
 *   NA.Audio.music.scaleFreq(deg, oct) current-mode scale degree -> Hz
 *
 * SIGNAL PATH
 *   sfx  -> [pan] -> sfxGain  ------\
 *   music -> hp -> lp -> duck -> musicGain -> preMaster -> compressor
 *                                          -> soft-clip -> masterGain -> out
 *   sends -> convolver (1.5s generated noise-decay IR) -> preMaster
 * ============================================================================= */
(function (global) {
  'use strict';

  var NA = global.NA = global.NA || {};

  // ---------------------------------------------------------------------------
  // Small utilities (self-contained; NA.M / NA.C may not exist yet)
  // ---------------------------------------------------------------------------
  var AC = global.AudioContext || global.webkitAudioContext || null;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------------------
  // Musical data. Each mode: a root note, a 7-note scale and a 4-block
  // chord-root progression (degrees into the scale). The kill-pop and every
  // melodic SFX read the *current* mode's scale, so combos always land in key.
  // ---------------------------------------------------------------------------
  var MODES = {
    dorian:     { root: 50, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 5, 4] },
    lydian:     { root: 53, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 4, 1, 4] },
    phrygian:   { root: 49, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 1, 0, 6] },
    aeolian:    { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 4] },
    mixolydian: { root: 48, scale: [0, 2, 4, 5, 7, 9, 10], prog: [0, 6, 3, 4] },
    // 'finale' is the same engine with an authentic cadence; on its last block
    // the bass drops out and the pad holds a resolving chord (see scheduleStep).
    finale:     { root: 48, scale: [0, 2, 4, 5, 7, 9, 11], prog: [3, 5, 4, 0], hold: true }
  };

  // 16th-note bass ostinato: 1 = accent, 0.6 = ghost, 0 = rest. Module-level
  // constants — the beat scheduler must never allocate.
  var BASS_PAT = [1, 0, 0.6, 0, 0, 0.6, 1, 0, 0, 0.6, 0, 0, 1, 0, 0.6, 0];
  var BASS_DEG = [0, 0, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 0, 4, 0];
  var ARP_DEG  = [0, 2, 4, 6, 4, 2, 0, 2, 4, 6, 7, 6, 4, 2, 4, 2];
  var PAD_DEGS = [0, 2, 4, 6];
  var RISE3    = [0, 2, 4];
  var RISE4    = [0, 2, 4, 7];
  var RESOLVE  = [0, 2, 4, 8];
  var DESCEND  = [7, 4, 2, 0];
  var VICTORY  = [0, 2, 4, 7, 9];
  var CHIME    = [0, 4, 7];

  var STEPS_PER_BAR = 16;
  var BARS_PER_BLOCK = 4;          // chord changes every 4 bars
  var LOOKAHEAD_MS = 25;           // Chris Wilson lookahead scheduler
  var SCHEDULE_AHEAD = 0.14;       // seconds of scheduling horizon
  var VOICE_CAP = 24;

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------
  var ctx = null;
  var master = null, preMaster = null, comp = null, shaper = null;
  var sfxGain = null, musicGain = null, duckGain = null;
  var revSend = null, revReturn = null, convolver = null;
  var musIn = null, musHP = null, musLP = null;

  var vol = { master: 0.8, music: 0.55, sfx: 0.9 };
  var listenerX = 0, listenerY = 0;
  var timeScale = 1, pitchScale = 1;

  var voices = [];                 // live voices
  var gainPool = [], filtPool = [], panPool = [];
  var voicePool = [];              // recycled voice records (no per-sfx allocation)
  var noiseBufs = {};              // duration bucket -> AudioBuffer
  var lastShotAt = -1;             // voice limiter for 'shot'
  var listenersBound = false;

  var Audio = {
    enabled: true,
    ready: false,
    ctx: null,
    names: null,
    version: 1
  };

  // ===========================================================================
  // INIT / MASTER CHAIN
  // ===========================================================================

  /** Soft-clip curve (tanh-ish): tames stacked additive voices without fizz. */
  function softClipCurve(n) {
    var c = new Float32Array(n), i, x;
    for (i = 0; i < n; i++) {
      x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.6) * 0.92;
    }
    return c;
  }

  /** Harder curve for deliberately distorted sounds (player hit, supernova). */
  var hardCurve = (function () {
    var n = 512, c = new Float32Array(n), i, x;
    for (i = 0; i < n; i++) {
      x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 6) * 0.8;
    }
    return c;
  })();

  /** 1.5s exponential noise-decay impulse response — a gentle generic room. */
  function makeImpulse(seconds, decay) {
    var len = Math.max(1, (ctx.sampleRate * seconds) | 0);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate), ch, d, i, t;
    for (ch = 0; ch < 2; ch++) {
      d = buf.getChannelData(ch);
      for (i = 0; i < len; i++) {
        t = i / len;
        // short fade-in so the tail blooms instead of clicking in
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.005 ? t / 0.005 : 1);
      }
    }
    return buf;
  }

  /**
   * Create the context and the whole master chain. Safe to call any number of
   * times; also resumes a suspended context (browsers require a user gesture).
   */
  Audio.init = function () {
    if (!AC) return false;
    if (ctx) {
      // Re-entry (the gesture kick below fires init() again): resume a
      // suspended context and start the music engine if it is not running yet
      // - it may have been skipped because the context was suspended, or
      // because Audio.enabled was false at first init.
      tryResume();
      if (Audio.enabled && music && !music.playing) { try { music.start(); } catch (e) { } }
      return true;
    }
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }

    master = ctx.createGain();
    master.gain.value = vol.master;

    shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(1024);
    shaper.oversample = '2x';

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    preMaster = ctx.createGain();
    preMaster.gain.value = 0.9;

    preMaster.connect(comp);
    comp.connect(shaper);
    shaper.connect(master);
    master.connect(ctx.destination);

    // reverb bus
    convolver = ctx.createConvolver();
    try { convolver.buffer = makeImpulse(1.5, 2.6); } catch (e) { /* ignore */ }
    revSend = ctx.createGain(); revSend.gain.value = 1;
    revReturn = ctx.createGain(); revReturn.gain.value = 0.5;
    revSend.connect(convolver);
    convolver.connect(revReturn);
    revReturn.connect(preMaster);

    // sfx bus
    sfxGain = ctx.createGain();
    sfxGain.gain.value = vol.sfx;
    sfxGain.connect(preMaster);

    // music bus: layers -> musIn -> highpass -> lowpass -> duck -> musicGain
    musIn = ctx.createGain(); musIn.gain.value = 1;
    musHP = ctx.createBiquadFilter(); musHP.type = 'highpass'; musHP.frequency.value = 30; musHP.Q.value = 0.7;
    musLP = ctx.createBiquadFilter(); musLP.type = 'lowpass'; musLP.frequency.value = 18000; musLP.Q.value = 0.6;
    duckGain = ctx.createGain(); duckGain.gain.value = 1;
    musicGain = ctx.createGain(); musicGain.gain.value = vol.music;
    musIn.connect(musHP); musHP.connect(musLP); musLP.connect(duckGain);
    duckGain.connect(musicGain); musicGain.connect(preMaster);
    // a little of the music into the room as well
    var musRev = ctx.createGain(); musRev.gain.value = 0.16;
    duckGain.connect(musRev); musRev.connect(revSend);

    Audio.ctx = ctx;
    Audio.ready = true;
    bindLifecycle();
    tryResume();
    // The adaptive music engine has no other start hook; init() is the first
    // point at which the context is legally resumable (it runs on a gesture).
    if (Audio.enabled) { try { music.start(); } catch (e) { } }
    return true;
  };

  function tryResume() {
    if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
  }

  function bindLifecycle() {
    if (listenersBound || typeof document === 'undefined') return;
    listenersBound = true;
    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) { try { ctx.suspend(); } catch (e) {} }
      else tryResume();
    });
  }

  // Auto-init on the first user gesture so callers that forget still get audio.
  if (typeof document !== 'undefined' && document.addEventListener) {
    (function () {
      var kick = function () { Audio.init(); };
      var evs = ['pointerdown', 'mousedown', 'touchstart', 'keydown'], i;
      for (i = 0; i < evs.length; i++) document.addEventListener(evs[i], kick, { passive: true });
    })();
  }

  Audio.suspend = function () { if (ctx) { try { ctx.suspend(); } catch (e) {} } };
  Audio.resume = function () { tryResume(); };

  Audio.setVolumes = function (v) {
    if (!v) return;
    if (typeof v.master === 'number') vol.master = clamp(v.master, 0, 1);
    if (typeof v.music === 'number') vol.music = clamp(v.music, 0, 1);
    if (typeof v.sfx === 'number') vol.sfx = clamp(v.sfx, 0, 1);
    if (!ctx) return;
    var t = ctx.currentTime;
    master.gain.setTargetAtTime(vol.master, t, 0.02);
    musicGain.gain.setTargetAtTime(vol.music, t, 0.02);
    sfxGain.gain.setTargetAtTime(vol.sfx, t, 0.02);
  };
  Audio.getVolumes = function () { return { master: vol.master, music: vol.music, sfx: vol.sfx }; };

  Audio.setListener = function (x, y) { listenerX = x || 0; listenerY = y || 0; };

  /** Global slow-mo. Pitch follows a soft curve so 0.1x is dark, not inaudible. */
  Audio.setTimeScale = function (s) {
    timeScale = clamp(s || 1, 0.02, 8);
    pitchScale = clamp(Math.pow(timeScale, 0.6), 0.3, 2);
  };
  Audio.getTimeScale = function () { return timeScale; };

  /** Duck the music bus by `db` for `ms`, then recover. */
  Audio.duck = function (db, ms) {
    if (!ctx || !duckGain) return;
    var amt = Math.pow(10, -Math.abs(db === undefined ? 6 : db) / 20);
    var t = ctx.currentTime;
    var hold = (ms || 300) / 1000;
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setValueAtTime(duckGain.gain.value, t);
    duckGain.gain.linearRampToValueAtTime(amt, t + 0.02);
    duckGain.gain.setValueAtTime(amt, t + hold * 0.5);
    duckGain.gain.linearRampToValueAtTime(1, t + hold);
  };

  Audio.voiceCount = function () { return voices.length; };

  // ===========================================================================
  // NODE POOLS + VOICE MANAGEMENT
  // Oscillators/BufferSources are one-shot by spec and cannot be reused, but
  // gains, filters and panners are recycled through free lists, so a busy frame
  // allocates almost nothing and nothing ever leaks: every voice is retired.
  // ===========================================================================

  function takeGain(v) {
    var g = gainPool.length ? gainPool.pop() : ctx.createGain();
    g.gain.cancelScheduledValues(0);
    g.gain.value = 0;
    v.g.push(g);
    return g;
  }
  function takeFilter(v, type, freq, q) {
    var f = filtPool.length ? filtPool.pop() : ctx.createBiquadFilter();
    f.type = type;
    f.frequency.cancelScheduledValues(0);
    f.frequency.value = freq;
    f.Q.cancelScheduledValues(0);
    f.Q.value = (q === undefined) ? 1 : q;
    f.gain.value = 0;
    v.f.push(f);
    return f;
  }
  function takePan(v) {
    if (!ctx.createStereoPanner) return null;
    var p = panPool.length ? panPool.pop() : ctx.createStereoPanner();
    p.pan.cancelScheduledValues(0);
    p.pan.value = 0;
    v.p.push(p);
    return p;
  }
  function takeOsc(v, type, freq, detune) {
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    v.s.push(o);
    return o;
  }
  /** Non-pooled helper node (delay, waveshaper): disconnected on voice death. */
  function keep(v, node) { v.x.push(node); return node; }

  /** Cached mono noise buffers, bucketed to 50ms so we build very few. */
  function noise(seconds) {
    var key = Math.max(1, Math.round(seconds * 20));
    var buf = noiseBufs[key];
    if (!buf) {
      var len = Math.max(64, ((key / 20) * ctx.sampleRate) | 0);
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBufs[key] = buf;
    }
    return buf;
  }
  function takeNoise(v, seconds, loop) {
    var s = ctx.createBufferSource();
    s.buffer = noise(seconds);
    if (loop) s.loop = true;
    v.s.push(s);
    return s;
  }

  function newVoice(endTime) {
    if (voices.length >= VOICE_CAP) {
      // steal the voice that ends soonest (the oldest / least important)
      var oldest = 0, i;
      for (i = 1; i < voices.length; i++) if (voices[i].end < voices[oldest].end) oldest = i;
      killVoice(voices[oldest], true);
    }
    var v = voicePool.length ? voicePool.pop() : { end: 0, s: [], g: [], f: [], p: [], x: [], dead: false, timer: 0 };
    v.end = endTime; v.dead = false; v.timer = 0; v.releaseAt = 0;
    voices.push(v);
    return v;
  }

  function killVoice(v, immediate) {
    if (v.dead) return;
    v.dead = true;
    if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
    var i, n, now = ctx ? ctx.currentTime : 0;
    for (i = 0; i < v.s.length; i++) {
      n = v.s[i];
      try { n.stop(immediate ? now + 0.01 : 0); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
      n.onended = null;
    }
    for (i = 0; i < v.g.length; i++) {
      n = v.g[i];
      try { n.disconnect(); } catch (e) {}
      try { n.gain.cancelScheduledValues(now); } catch (e) {}
      if (gainPool.length < 64) gainPool.push(n);
    }
    for (i = 0; i < v.f.length; i++) {
      n = v.f[i];
      try { n.disconnect(); } catch (e) {}
      try { n.frequency.cancelScheduledValues(now); n.Q.cancelScheduledValues(now); } catch (e) {}
      if (filtPool.length < 64) filtPool.push(n);
    }
    for (i = 0; i < v.p.length; i++) {
      n = v.p[i];
      try { n.disconnect(); } catch (e) {}
      try { n.pan.cancelScheduledValues(now); } catch (e) {}
      if (panPool.length < 32) panPool.push(n);
    }
    for (i = 0; i < v.x.length; i++) { try { v.x[i].disconnect(); } catch (e) {} }
    v.s.length = 0; v.g.length = 0; v.f.length = 0; v.p.length = 0; v.x.length = 0;
    // swap-remove: order in `voices` carries no meaning
    var idx = voices.indexOf(v);
    if (idx >= 0) { voices[idx] = voices[voices.length - 1]; voices.pop(); }
    if (voicePool.length < VOICE_CAP + 8) voicePool.push(v);
  }

  /**
   * Mark the voice for release shortly after its tail ends. Retirement is swept
   * from Audio.update() — no host timer, no closure, per sound.
   */
  function retire(v) {
    v.releaseAt = v.end + 0.09;
    if (!Audio._sweeping) sweepVoices();   // Node/no-frame fallback: sweep inline
  }

  /** Release every voice whose tail has passed. Called once per frame. */
  function sweepVoices() {
    if (!ctx) return;
    var now = ctx.currentTime;
    for (var i = voices.length - 1; i >= 0; i--) {
      var v = voices[i];
      if (v.releaseAt && v.releaseAt <= now) killVoice(v, false);
    }
  }

  /**
   * Per-frame hook (called from NA.Game.step). Retires finished voices without
   * a setTimeout per sound, and decays the per-name sfx cooldown table.
   */
  Audio.update = function (dt) {
    Audio._sweeping = true;
    sweepVoices();
  };

  /**
   * Build the per-sound input channel: gain -> [panner] -> out -> sfxGain,
   * plus a reverb send. Returns the gain node the generator writes into.
   */
  function channel(v, o, revAmt) {
    var g = takeGain(v);
    g.gain.value = 1;
    var amp = 1, pan = 0;
    if (o && typeof o.x === 'number' && typeof o.y === 'number') {
      var dx = o.x - listenerX, dy = o.y - listenerY;
      var d = Math.sqrt(dx * dx + dy * dy);
      amp = 1 / (1 + d / 700);                 // gentle distance attenuation
      pan = clamp(dx / 900, -1, 1) * 0.85;     // light stereo placement
    }
    amp *= (o && typeof o.vol === 'number') ? clamp(o.vol, 0, 4) : 1;
    var out = takeGain(v);
    out.gain.value = amp;
    var p = takePan(v);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(out); }
    else { g.connect(out); }
    out.connect(sfxGain);
    if (revAmt > 0) {
      var rs = takeGain(v);
      rs.gain.value = revAmt;
      out.connect(rs); rs.connect(revSend);
    }
    return g;
  }

  /** Envelope helper: attack to peak, then an exponential fall to silence. */
  function env(g, t, attack, decay, peak) {
    var p = Math.max(0.0001, peak);
    var a = Math.max(0.0005, attack);
    var d = Math.max(0.01, decay);
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(p, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return t + a + d;
  }

  // ===========================================================================
  // SFX DEFINITIONS
  // Each generator: fn(t, ch, o, v, P) where
  //   t = start time, ch = channel input gain, o = options, v = voice,
  //   P = pitch multiplier (opts.pitch * global time-scale pitch)
  // and returns the absolute end time of its tail.
  // ===========================================================================
  var SFX = {};

  // --- weapons ---------------------------------------------------------------
  SFX.shot = function (t, ch, o, v, P) {
    var f0 = 620 * P * rnd(0.97, 1.03);        // +/-3% random detune per shot
    var osc = takeOsc(v, 'sawtooth', f0);
    var lp = takeFilter(v, 'lowpass', 3200 * P, 4);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.02); // 20ms drop
    lp.frequency.setValueAtTime(3200 * P, t);
    lp.frequency.exponentialRampToValueAtTime(900 * P, t + 0.06);
    osc.connect(lp); lp.connect(g); g.connect(ch);
    var end = env(g, t, 0.001, 0.07, 0.5);
    osc.start(t); osc.stop(end + 0.02);
    return end;
  };

  SFX.shotHeavy = function (t, ch, o, v, P) {
    var f0 = 260 * P * rnd(0.97, 1.03);
    var osc = takeOsc(v, 'sawtooth', f0);
    var sub = takeOsc(v, 'square', f0 * 0.5);
    var lp = takeFilter(v, 'lowpass', 2200 * P, 6);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.05);
    sub.frequency.setValueAtTime(f0 * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(f0 * 0.25, t + 0.08);
    lp.frequency.setValueAtTime(2200 * P, t);
    lp.frequency.exponentialRampToValueAtTime(400 * P, t + 0.14);
    osc.connect(lp); sub.connect(lp); lp.connect(g); g.connect(ch);
    var end = env(g, t, 0.002, 0.18, 0.62);
    osc.start(t); osc.stop(end + 0.02);
    sub.start(t); sub.stop(end + 0.02);
    return end;
  };

  SFX.rail = function (t, ch, o, v, P) {
    // charged whoosh (bandpass noise sweeping up) then a bright crack
    var n = takeNoise(v, 0.5, true);
    var bp = takeFilter(v, 'bandpass', 300 * P, 6);
    var ng = takeGain(v);
    bp.frequency.setValueAtTime(300 * P, t);
    bp.frequency.exponentialRampToValueAtTime(4200 * P, t + 0.22);
    n.connect(bp); bp.connect(ng); ng.connect(ch);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.35, t + 0.2);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    n.start(t); n.stop(t + 0.36);

    var ct = t + 0.2;
    var crack = takeNoise(v, 0.15);
    var hp = takeFilter(v, 'highpass', 1200 * P, 1);
    var cg = takeGain(v);
    crack.connect(hp); hp.connect(cg); cg.connect(ch);
    env(cg, ct, 0.001, 0.12, 0.7);
    crack.start(ct); crack.stop(ct + 0.16);

    var body = takeOsc(v, 'triangle', 900 * P);
    var bg = takeGain(v);
    body.frequency.setValueAtTime(900 * P, ct);
    body.frequency.exponentialRampToValueAtTime(120 * P, ct + 0.18);
    body.connect(bg); bg.connect(ch);
    env(bg, ct, 0.001, 0.2, 0.4);
    body.start(ct); body.stop(ct + 0.24);
    return ct + 0.26;
  };

  SFX.laser = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 0.5;
    var a = takeOsc(v, 'sawtooth', 180 * P);
    var b = takeOsc(v, 'square', 181.5 * P);
    var bp = takeFilter(v, 'bandpass', 900 * P, 3);
    var g = takeGain(v);
    a.connect(bp); b.connect(bp); bp.connect(g); g.connect(ch);
    bp.frequency.setValueAtTime(900 * P, t);
    bp.frequency.linearRampToValueAtTime(2200 * P, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.03);
    g.gain.setValueAtTime(0.3, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    a.start(t); a.stop(t + dur + 0.02);
    b.start(t); b.stop(t + dur + 0.02);
    return t + dur;
  };

  // --- impacts ---------------------------------------------------------------
  SFX.hitEnemy = function (t, ch, o, v, P) {
    // 2ms click: a single short noise grain through a bright bandpass
    var n = takeNoise(v, 0.05);
    var bp = takeFilter(v, 'bandpass', 2600 * P, 1.2);
    var g = takeGain(v);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.start(t); n.stop(t + 0.03);
    return t + 0.03;
  };

  SFX.hitPlayer = function (t, ch, o, v, P) {
    Audio.duck(6, 300);                            // music ducks 6dB for 300ms
    var sq = takeOsc(v, 'square', 320 * P);
    var dist = keep(v, ctx.createWaveShaper());
    dist.curve = hardCurve;
    var lp = takeFilter(v, 'lowpass', 1800 * P, 2);
    var g = takeGain(v);
    sq.frequency.setValueAtTime(320 * P, t);
    sq.frequency.exponentialRampToValueAtTime(60 * P, t + 0.2);   // 200ms ramp
    sq.connect(dist); dist.connect(lp); lp.connect(g); g.connect(ch);
    var end = env(g, t, 0.002, 0.22, 0.55);
    sq.start(t); sq.stop(end + 0.02);

    var sub = takeOsc(v, 'sine', 110 * P);         // sub thump
    var sg = takeGain(v);
    sub.frequency.setValueAtTime(110 * P, t);
    sub.frequency.exponentialRampToValueAtTime(38 * P, t + 0.3);
    sub.connect(sg); sg.connect(ch);
    env(sg, t, 0.004, 0.4, 0.85);
    sub.start(t); sub.stop(t + 0.46);
    return t + 0.46;
  };

  SFX.graze = function (t, ch, o, v, P) {
    var osc = takeOsc(v, 'sine', 3200 * P * rnd(0.96, 1.05));
    var g = takeGain(v);
    osc.connect(g); g.connect(ch);
    var end = env(g, t, 0.001, 0.05, 0.18);
    osc.start(t); osc.stop(end + 0.01);
    return end;
  };

  SFX.wall = function (t, ch, o, v, P) {
    // Karplus-Strong-ish pluck: a noise burst into a feedback delay whose loop
    // time sets the pitch, with a lowpass in the loop shaping the decay.
    var f = 220 * P * rnd(0.95, 1.06);
    var delay = keep(v, ctx.createDelay(0.05));
    delay.delayTime.value = 1 / f;
    var fb = takeGain(v); fb.gain.value = 0.86;
    var damp = takeFilter(v, 'lowpass', 2400, 0.7);
    var g = takeGain(v);
    var n = takeNoise(v, 0.05);
    var ng = takeGain(v);
    n.connect(ng); ng.connect(delay);
    delay.connect(damp); damp.connect(fb); fb.connect(delay);
    damp.connect(g); g.connect(ch);
    ng.gain.setValueAtTime(0.7, t);
    ng.gain.setValueAtTime(0, t + 1 / f);
    g.gain.setValueAtTime(0.6, t);
    g.gain.setTargetAtTime(0.0001, t + 0.05, 0.16);
    n.start(t); n.stop(t + 0.05);
    return t + 0.7;
  };

  // --- kills -----------------------------------------------------------------
  /** Shared kill body; `step` climbs the current scale for combos (0..8). */
  function killBody(t, ch, o, v, P, step) {
    // white-noise burst swept 4k -> 200Hz over 80ms
    var n = takeNoise(v, 0.2);
    var lp = takeFilter(v, 'lowpass', 4000 * P, 3);
    var ng = takeGain(v);
    lp.frequency.setValueAtTime(4000 * P, t);
    lp.frequency.exponentialRampToValueAtTime(200 * P, t + 0.08);
    n.connect(lp); lp.connect(ng); ng.connect(ch);
    env(ng, t, 0.001, 0.13, 0.42);
    n.start(t); n.stop(t + 0.16);

    // sine pop on a note of the current scale; combos climb it
    var f = music.scaleFreq(4 + (step | 0), 1) * P;
    var pop = takeOsc(v, 'sine', f);
    var pg = takeGain(v);
    pop.frequency.setValueAtTime(f * 1.02, t);
    pop.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    pop.connect(pg); pg.connect(ch);
    env(pg, t, 0.002, 0.16 + step * 0.01, 0.3 + step * 0.02);
    pop.start(t); pop.stop(t + 0.3 + step * 0.01);
    return t + 0.32;
  }
  SFX.kill = function (t, ch, o, v, P) { return killBody(t, ch, o, v, P, 0); };
  SFX.killCombo = function (t, ch, o, v, P) {
    var n = (o && typeof o.n === 'number') ? o.n : 1;
    return killBody(t, ch, o, v, P, clamp(n | 0, 0, 8));
  };

  SFX.explode = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.6);
    var lp = takeFilter(v, 'lowpass', 1800 * P, 1.2);
    var ng = takeGain(v);
    lp.frequency.setValueAtTime(1800 * P, t);
    lp.frequency.exponentialRampToValueAtTime(160 * P, t + 0.45);
    n.connect(lp); lp.connect(ng); ng.connect(ch);
    env(ng, t, 0.003, 0.5, 0.5);
    n.start(t); n.stop(t + 0.56);

    var boom = takeOsc(v, 'sine', 150 * P);
    var bg = takeGain(v);
    boom.frequency.setValueAtTime(150 * P, t);
    boom.frequency.exponentialRampToValueAtTime(38 * P, t + 0.4);
    boom.connect(bg); bg.connect(ch);
    env(bg, t, 0.004, 0.5, 0.8);
    boom.start(t); boom.stop(t + 0.56);
    return t + 0.56;
  };

  SFX.lightning = function (t, ch, o, v, P) {
    // a 5ms impulse thrown into the reverb: the tail *is* the sound
    var n = takeNoise(v, 0.05);
    var hp = takeFilter(v, 'highpass', 1800 * P, 0.9);
    var g = takeGain(v);
    n.connect(hp); hp.connect(g); g.connect(ch);
    var send = takeGain(v); send.gain.value = 1.2;
    g.connect(send); send.connect(revSend);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.005);
    n.start(t); n.stop(t + 0.02);
    return t + 0.05;
  };

  // --- movement / mana -------------------------------------------------------
  SFX.dash = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.4, true);
    var bp = takeFilter(v, 'bandpass', 400 * P, 3.5);
    var g = takeGain(v);
    bp.frequency.setValueAtTime(400 * P, t);
    bp.frequency.exponentialRampToValueAtTime(3000 * P, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(500 * P, t + 0.3);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.start(t); n.stop(t + 0.32);
    return t + 0.32;
  };

  SFX.manaFull = function (t, ch, o, v, P) {
    // soft bloom chime: root / fifth / octave with slow attacks
    var i, f, osc, g;
    for (i = 0; i < CHIME.length; i++) {
      f = music.scaleFreq(CHIME[i], 2) * P;
      osc = takeOsc(v, 'sine', f);
      g = takeGain(v);
      osc.connect(g); g.connect(ch);
      env(g, t + i * 0.03, 0.06, 0.7, 0.16);
      osc.start(t); osc.stop(t + 0.95);
    }
    return t + 0.95;
  };

  SFX.manaDry = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.05);
    var bp = takeFilter(v, 'bandpass', 900 * P, 6);
    var g = takeGain(v);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    n.start(t); n.stop(t + 0.05);
    return t + 0.06;
  };

  SFX.spendActive = function (t, ch, o, v, P) {
    var f = music.scaleFreq(2, 1) * P;
    var osc = takeOsc(v, 'triangle', f * 1.5);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    osc.connect(g); g.connect(ch);
    env(g, t, 0.004, 0.22, 0.3);
    osc.start(t); osc.stop(t + 0.32);

    var n = takeNoise(v, 0.15);
    var hp = takeFilter(v, 'highpass', 2200 * P, 1);
    var ng = takeGain(v);
    n.connect(hp); hp.connect(ng); ng.connect(ch);
    env(ng, t, 0.002, 0.1, 0.18);
    n.start(t); n.stop(t + 0.16);
    return t + 0.32;
  };

  // --- supernova (two names, charge then blast) ------------------------------
  SFX.supernovaCharge = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 3.0;
    var a = takeOsc(v, 'sine', 80 * P);
    var b = takeOsc(v, 'sine', 80.6 * P);
    var g = takeGain(v);
    a.frequency.setValueAtTime(80 * P, t);
    a.frequency.exponentialRampToValueAtTime(900 * P, t + dur);
    b.frequency.setValueAtTime(80.6 * P, t);
    b.frequency.exponentialRampToValueAtTime(906 * P, t + dur);
    a.connect(g); b.connect(g); g.connect(ch);
    var send = takeGain(v); send.gain.value = 0.5;
    g.connect(send); send.connect(revSend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + dur * 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    a.start(t); a.stop(t + dur + 0.05);
    b.start(t); b.stop(t + dur + 0.05);
    return t + dur;
  };

  SFX.supernova = function (t, ch, o, v, P) {
    // crushed noise crash + a body boom
    var n = takeNoise(v, 1.2);
    var dist = keep(v, ctx.createWaveShaper());
    dist.curve = hardCurve;
    var lp = takeFilter(v, 'lowpass', 6000 * P, 0.8);
    var g = takeGain(v);
    lp.frequency.setValueAtTime(6000 * P, t);
    lp.frequency.exponentialRampToValueAtTime(200 * P, t + 1.1);
    n.connect(dist); dist.connect(lp); lp.connect(g); g.connect(ch);
    var send = takeGain(v); send.gain.value = 0.7;
    g.connect(send); send.connect(revSend);
    env(g, t, 0.003, 1.2, 0.7);
    n.start(t); n.stop(t + 1.3);

    var boom = takeOsc(v, 'sine', 90 * P);
    var bg = takeGain(v);
    boom.frequency.setValueAtTime(90 * P, t);
    boom.frequency.exponentialRampToValueAtTime(28 * P, t + 0.9);
    boom.connect(bg); bg.connect(ch);
    env(bg, t, 0.005, 1.1, 0.9);
    boom.start(t); boom.stop(t + 1.3);
    Audio.duck(5, 700);
    return t + 1.35;
  };

  // --- telegraphs / states ---------------------------------------------------
  SFX.telegraph = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 0.4;
    var f = music.scaleFreq(0, 1) * P;
    var osc = takeOsc(v, 'triangle', f);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 2, t + dur);
    osc.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
    return t + dur;
  };

  SFX.lock = function (t, ch, o, v, P) {
    var osc = takeOsc(v, 'square', 1400 * P);
    var bp = takeFilter(v, 'bandpass', 1600 * P, 8);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(1400 * P, t);
    osc.frequency.exponentialRampToValueAtTime(500 * P, t + 0.05);
    osc.connect(bp); bp.connect(g); g.connect(ch);
    env(g, t, 0.001, 0.07, 0.4);
    osc.start(t); osc.stop(t + 0.12);
    return t + 0.12;
  };

  SFX.charge = function (t, ch, o, v, P) {
    var dur = (o && o.dur) || 0.8;
    var n = takeNoise(v, 0.5, true);
    var lp = takeFilter(v, 'lowpass', 90 * P, 4);
    var g = takeGain(v);
    n.connect(lp); lp.connect(g); g.connect(ch);
    lp.frequency.setValueAtTime(90 * P, t);
    lp.frequency.linearRampToValueAtTime(260 * P, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.start(t); n.stop(t + dur + 0.02);
    return t + dur;
  };

  SFX.spawn = function (t, ch, o, v, P) {
    // "print" sound: soft filtered noise rising, with a quiet pitched shimmer
    var n = takeNoise(v, 0.3);
    var bp = takeFilter(v, 'bandpass', 400 * P, 2);
    var g = takeGain(v);
    bp.frequency.setValueAtTime(400 * P, t);
    bp.frequency.exponentialRampToValueAtTime(1800 * P, t + 0.22);
    n.connect(bp); bp.connect(g); g.connect(ch);
    env(g, t, 0.03, 0.2, 0.2);
    n.start(t); n.stop(t + 0.3);

    var f = music.scaleFreq(4, 2) * P;
    var osc = takeOsc(v, 'sine', f);
    var og = takeGain(v);
    osc.connect(og); og.connect(ch);
    env(og, t + 0.05, 0.02, 0.18, 0.1);
    osc.start(t); osc.stop(t + 0.32);
    return t + 0.32;
  };

  SFX.gate = function (t, ch, o, v, P) {
    // whoosh through a ring: a noise sweep plus a resonant ring tone
    var n = takeNoise(v, 0.6, true);
    var bp = takeFilter(v, 'bandpass', 250 * P, 2);
    var g = takeGain(v);
    bp.frequency.setValueAtTime(250 * P, t);
    bp.frequency.exponentialRampToValueAtTime(2600 * P, t + 0.35);
    n.connect(bp); bp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.start(t); n.stop(t + 0.52);

    var f = music.scaleFreq(4, 1) * P;
    var ring = takeOsc(v, 'sine', f);
    var rg = takeGain(v);
    ring.connect(rg); rg.connect(ch);
    var send = takeGain(v); send.gain.value = 0.6;
    rg.connect(send); send.connect(revSend);
    env(rg, t + 0.1, 0.02, 0.8, 0.22);
    ring.start(t + 0.1); ring.stop(t + 1.05);
    return t + 1.05;
  };

  // --- bosses ----------------------------------------------------------------
  SFX.bossIntro = function (t, ch, o, v, P) {
    var f = music.scaleFreq(0, -2) * P;
    var a = takeOsc(v, 'sawtooth', f);
    var b = takeOsc(v, 'sine', f * 0.5);
    var lp = takeFilter(v, 'lowpass', 220 * P, 3);
    var g = takeGain(v);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(ch);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.8);
    g.gain.setValueAtTime(0.55, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    a.start(t); a.stop(t + 2.3);
    b.start(t); b.stop(t + 2.3);

    var ht = t + 1.4;                        // the hit that lands the drone
    var n = takeNoise(v, 0.6);
    var nlp = takeFilter(v, 'lowpass', 1600 * P, 1);
    var ng = takeGain(v);
    nlp.frequency.setValueAtTime(1600 * P, ht);
    nlp.frequency.exponentialRampToValueAtTime(120 * P, ht + 0.5);
    n.connect(nlp); nlp.connect(ng); ng.connect(ch);
    env(ng, ht, 0.002, 0.6, 0.6);
    n.start(ht); n.stop(ht + 0.7);
    Audio.duck(4, 900);
    return t + 2.3;
  };

  SFX.bossPhase = function (t, ch, o, v, P) {
    var n = takeNoise(v, 0.4);
    var lp = takeFilter(v, 'lowpass', 1400 * P, 1);
    var g = takeGain(v);
    n.connect(lp); lp.connect(g); g.connect(ch);
    lp.frequency.setValueAtTime(1400 * P, t);
    lp.frequency.exponentialRampToValueAtTime(120 * P, t + 0.35);
    env(g, t, 0.002, 0.4, 0.6);
    n.start(t); n.stop(t + 0.46);

    var riser = takeNoise(v, 0.5, true);     // riser after the impact
    var bp = takeFilter(v, 'bandpass', 300 * P, 4);
    var rg = takeGain(v);
    riser.connect(bp); bp.connect(rg); rg.connect(ch);
    bp.frequency.setValueAtTime(300 * P, t + 0.05);
    bp.frequency.exponentialRampToValueAtTime(4000 * P, t + 1.0);
    rg.gain.setValueAtTime(0.0001, t + 0.05);
    rg.gain.linearRampToValueAtTime(0.3, t + 0.9);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    riser.start(t + 0.05); riser.stop(t + 1.08);
    Audio.duck(4, 500);
    return t + 1.1;
  };

  SFX.bossDeath = function (t, ch, o, v, P) {
    var boom = takeOsc(v, 'sine', 110 * P);
    var g = takeGain(v);
    boom.frequency.setValueAtTime(110 * P, t);
    boom.frequency.exponentialRampToValueAtTime(22 * P, t + 1.6);
    boom.connect(g); g.connect(ch);
    env(g, t, 0.006, 2.2, 1.0);
    boom.start(t); boom.stop(t + 2.4);

    var n = takeNoise(v, 1.5);
    var lp = takeFilter(v, 'lowpass', 5000 * P, 0.8);
    var ng = takeGain(v);
    lp.frequency.setValueAtTime(5000 * P, t);
    lp.frequency.exponentialRampToValueAtTime(120 * P, t + 1.8);
    n.connect(lp); lp.connect(ng); ng.connect(ch);
    var send = takeGain(v); send.gain.value = 0.8;
    ng.connect(send); send.connect(revSend);
    env(ng, t, 0.004, 2.0, 0.6);
    n.start(t); n.stop(t + 2.2);
    Audio.duck(6, 1200);
    return t + 2.45;
  };

  // --- UI / draft ------------------------------------------------------------
  SFX.draftHover = function (t, ch, o, v, P) {
    // "assemble" tick
    var osc = takeOsc(v, 'square', 1800 * P);
    var bp = takeFilter(v, 'bandpass', 2000 * P, 10);
    var g = takeGain(v);
    osc.connect(bp); bp.connect(g); g.connect(ch);
    env(g, t, 0.001, 0.04, 0.2);
    osc.start(t); osc.stop(t + 0.07);
    return t + 0.07;
  };

  SFX.draftPick = function (t, ch, o, v, P) {
    // rising chord; a higher tier gets a higher, richer voicing
    var tier = clamp((((o && o.tier) || 1) | 0), 1, 3);
    var oct = tier - 1;
    var degs = (tier >= 3) ? RISE4 : RISE3;
    for (var i = 0; i < degs.length; i++) {
      var f = music.scaleFreq(degs[i], oct) * P;
      var osc = takeOsc(v, i === 0 ? 'triangle' : 'sine', f);
      var g = takeGain(v);
      osc.connect(g); g.connect(ch);
      env(g, t + i * 0.055, 0.01, 0.5 + i * 0.05, 0.22);
      osc.start(t + i * 0.055); osc.stop(t + i * 0.055 + 0.75);
    }
    return t + degs.length * 0.055 + 0.75;
  };

  SFX.draftSkip = function (t, ch, o, v, P) {
    var f0 = music.scaleFreq(2, 0) * P;
    var osc = takeOsc(v, 'triangle', f0);
    var g = takeGain(v);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(music.scaleFreq(0, -1) * P, t + 0.18);
    osc.connect(g); g.connect(ch);
    env(g, t, 0.003, 0.2, 0.22);
    osc.start(t); osc.stop(t + 0.28);
    return t + 0.28;
  };

  SFX.waveClear = function (t, ch, o, v, P) {
    // bright resolve chord (I add9)
    for (var i = 0; i < RESOLVE.length; i++) {
      var f = music.scaleFreq(RESOLVE[i], 1) * P;
      var osc = takeOsc(v, 'sine', f);
      var g = takeGain(v);
      osc.connect(g); g.connect(ch);
      var send = takeGain(v); send.gain.value = 0.4;
      g.connect(send); send.connect(revSend);
      env(g, t + i * 0.02, 0.02, 1.1, 0.2);
      osc.start(t); osc.stop(t + 1.35);
    }
    return t + 1.35;
  };

  SFX.death = function (t, ch, o, v, P) {
    // the draft chord in reverse: descending and darkening
    for (var i = 0; i < DESCEND.length; i++) {
      var st = t + i * 0.12;
      var f = music.scaleFreq(DESCEND[i], 0) * P;
      var osc = takeOsc(v, i === 0 ? 'sine' : 'triangle', f);
      var lp = takeFilter(v, 'lowpass', 2200 * P, 0.8);
      var g = takeGain(v);
      osc.connect(lp); lp.connect(g); g.connect(ch);
      lp.frequency.setValueAtTime(2200 * P, st);
      lp.frequency.exponentialRampToValueAtTime(400 * P, st + 1.0);
      env(g, st, 0.02, 1.2, 0.24);
      osc.start(st); osc.stop(st + 1.45);
    }
    Audio.duck(8, 1600);
    return t + 1.9;
  };

  SFX.uiTick = function (t, ch, o, v, P) {
    var osc = takeOsc(v, 'sine', 2200 * P);
    var g = takeGain(v);
    osc.connect(g); g.connect(ch);
    env(g, t, 0.001, 0.03, 0.14);
    osc.start(t); osc.stop(t + 0.06);
    return t + 0.06;
  };

  SFX.uiConfirm = function (t, ch, o, v, P) {
    var f = music.scaleFreq(0, 1) * P;
    var a = takeOsc(v, 'sine', f);
    var b = takeOsc(v, 'sine', f * 1.5);
    var g = takeGain(v);
    a.connect(g); b.connect(g); g.connect(ch);
    env(g, t, 0.003, 0.22, 0.2);
    a.start(t); a.stop(t + 0.32);
    b.start(t + 0.05); b.stop(t + 0.32);
    return t + 0.32;
  };

  Audio.names = Object.keys(SFX);

  // ===========================================================================
  // SFX ENTRY POINT
  // ===========================================================================
  var EMPTY = {};

  // Per-name minimum spacing in seconds. Only the burst-prone names are listed;
  // anything absent is unlimited (telegraphs, stingers, one-per-beat cues).
  var SFX_COOLDOWN = {
    kill: 0.03, killCombo: 0.03, hitEnemy: 0.028, hitPlayer: 0.03,
    explode: 0.035, wall: 0.04, graze: 0.03, lightning: 0.06,
    shotHeavy: 0.03, spawn: 0.03, uiTick: 0.02
  };
  var sfxLastAt = Object.create(null);

  /**
   * Play a sound. Unknown names are ignored. Options:
   *   x, y   world position -> stereo pan + distance attenuation
   *   pitch  multiplier (default 1)
   *   vol    multiplier (default 1)
   *   n      combo step 0..8 for killCombo
   *   tier   1..3 for draftPick
   *   dur    length hint for sustained sounds (laser, charge, telegraph, ...)
   */
  Audio.sfx = function (name, opts) {
    if (!Audio.enabled || !ctx || ctx.state === 'closed') return;
    var gen = SFX[name];
    if (!gen) return;
    if (typeof opts === 'number') opts = { n: opts };   // sfx('killCombo', 3)

    var now = ctx.currentTime;

    // Voice limiter: at most one player shot per 30ms; extras are dropped.
    if (name === 'shot') {
      if (now - lastShotAt < 0.03) return;
      lastShotAt = now;
    }
    // Per-name rate limit for the sounds that arrive in bursts (a blast chain
    // killing 40 enemies, a ricochet build hammering the membrane). Dropped
    // before newVoice() so nothing is built just to be stolen.
    var cd = SFX_COOLDOWN[name];
    if (cd !== undefined) {
      var la = sfxLastAt[name];
      if (la !== undefined && now - la < cd) return;
      sfxLastAt[name] = now;
    }

    var P = pitchScale * ((opts && typeof opts.pitch === 'number') ? opts.pitch : 1);
    var v = newVoice(now + 0.5);
    var rev = (name === 'kill' || name === 'killCombo') ? 0.12 : 0.06;
    var ch = channel(v, opts, rev);
    var end;
    try {
      end = gen(now + 0.002, ch, opts || EMPTY, v, P);
    } catch (e) {
      killVoice(v, true);
      return;
    }
    v.end = end || (now + 0.4);
    retire(v);
  };

  /** Convenience: NA.Audio.killCombo(3) — combo pop n steps up the scale. */
  Audio.killCombo = function (n, opts) {
    opts = opts || {};
    opts.n = clamp(n | 0, 0, 8);
    Audio.sfx('killCombo', opts);
  };

  // ===========================================================================
  // MUSIC — generative, lookahead-scheduled (Chris Wilson pattern)
  // ===========================================================================
  var music = {
    bpm: 120,
    beat: 0,
    bar: 0,
    mode: 'dorian',
    intensity: 0,
    playing: false
  };

  var mStep = 0;                 // absolute 16th-note index
  var mNextTime = 0;             // ctx time of the next 16th
  var mTimer = null;
  var beatCbs = [];
  var lowpassAmt = 0;
  var padGain = null, bassGain = null, arpGain = null;
  var lastChordBlock = -1;
  var curChordRoot = 0;

  function modeDef() { return MODES[music.mode] || MODES.dorian; }

  /**
   * Scale degree -> frequency in the current mode. `deg` may run past the end of
   * the scale (it wraps with an octave carry) and may be negative; `oct` adds
   * whole octaves. Every melodic SFX uses this, so nothing is ever out of key.
   */
  music.scaleFreq = function (deg, oct) {
    var m = modeDef(), sc = m.scale, n = sc.length;
    deg = deg | 0;
    var o = Math.floor(deg / n);
    var i = deg - o * n;
    return mtof(m.root + (o + (oct || 0)) * 12 + sc[i]);
  };

  function ensureMusicNodes() {
    if (padGain || !ctx) return;
    padGain = ctx.createGain(); padGain.gain.value = 0.5; padGain.connect(musIn);
    bassGain = ctx.createGain(); bassGain.gain.value = 0.75; bassGain.connect(musIn);
    arpGain = ctx.createGain(); arpGain.gain.value = 0; arpGain.connect(musIn);
  }

  music.setBpm = function (n) { music.bpm = clamp(n || 120, 30, 300); };

  music.setMode = function (name) {
    if (!MODES[name] || name === music.mode) return;
    music.mode = name;
    lastChordBlock = -1;          // force a fresh pad chord at the next block
  };

  music.setIntensity = function (v) {
    music.intensity = clamp(v || 0, 0, 1);
    if (!ctx) return;
    ensureMusicNodes();
    var t = ctx.currentTime;
    // "Opens" the mix: the highpass climbs so the low mud clears and the track
    // reads as more urgent, while the arp layer fades in and the bass bites.
    musHP.frequency.setTargetAtTime(30 + music.intensity * 170, t, 0.4);
    arpGain.gain.setTargetAtTime(music.intensity * 0.5, t, 0.5);
    bassGain.gain.setTargetAtTime(0.55 + music.intensity * 0.35, t, 0.5);
  };

  /** 0 = fully open, 1 = heavily muffled (the low-HP effect). */
  music.setLowpass = function (v) {
    lowpassAmt = clamp(v || 0, 0, 1);
    if (!ctx) return;
    var f = 18000 * Math.pow(400 / 18000, lowpassAmt);
    musLP.frequency.setTargetAtTime(f, ctx.currentTime, 0.15);
  };

  /** Register a quarter-note callback. Returns an unsubscribe function. */
  music.onBeat = function (cb) {
    if (typeof cb !== 'function') return function () {};
    beatCbs.push(cb);
    return function () {
      var i = beatCbs.indexOf(cb);
      if (i >= 0) beatCbs.splice(i, 1);
    };
  };

  music.start = function () {
    if (!ctx) Audio.init();
    if (!ctx || music.playing) return;
    ensureMusicNodes();
    // clear any fade-out left over from a previous stop()
    padGain.gain.cancelScheduledValues(ctx.currentTime);
    padGain.gain.value = 0.5;
    music.setIntensity(music.intensity);
    music.setLowpass(lowpassAmt);
    music.playing = true;
    mStep = 0; music.beat = 0; music.bar = 0; lastChordBlock = -1;
    mNextTime = ctx.currentTime + 0.08;
    mTimer = setInterval(scheduler, LOOKAHEAD_MS);
  };

  music.stop = function () {
    if (!music.playing) return;
    music.playing = false;
    if (mTimer) { clearInterval(mTimer); mTimer = null; }
    if (padGain && ctx) {
      // let the tails ring out rather than cutting hard
      padGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    }
  };

  /** Seconds per 16th note, tempo-scaled by the global time scale. */
  function sec16() { return (60 / (music.bpm * clamp(timeScale, 0.15, 4))) / 4; }

  /** The lookahead loop: schedules every 16th note inside the horizon. */
  function scheduler() {
    if (!ctx || !music.playing) return;
    var horizon = ctx.currentTime + SCHEDULE_AHEAD;
    var guard = 0;
    while (mNextTime < horizon && guard++ < 64) {
      scheduleStep(mStep, mNextTime);
      mNextTime += sec16();
      mStep++;
    }
    // if we fell far behind (tab throttling), resync instead of catching up
    if (mNextTime < ctx.currentTime - 0.5) mNextTime = ctx.currentTime + 0.02;
  }

  /** Schedules one 16th note. Allocates nothing but the audio nodes it plays. */
  function scheduleStep(step, time) {
    var s = step % STEPS_PER_BAR;
    var bar = (step / STEPS_PER_BAR) | 0;
    var block = (bar / BARS_PER_BLOCK) | 0;
    var m = modeDef();
    var P = pitchScale;

    // --- quarter-note beat callbacks (these also drive the Resonance Pulse) --
    if (s % 4 === 0) {
      var beatIndex = (step / 4) | 0;
      music.beat = beatIndex;
      music.bar = bar;
      fireBeat(beatIndex, time);
    }

    // --- chord change every 4 bars ------------------------------------------
    var holdingNow = !!m.hold && (block % m.prog.length) === m.prog.length - 1;
    if (block !== lastChordBlock && s === 0) {
      lastChordBlock = block;
      curChordRoot = m.prog[block % m.prog.length];
      playPad(time, curChordRoot, holdingNow, P);
    }

    // --- bass ostinato -------------------------------------------------------
    // In 'finale' the last block holds: the bass drops out so the pad's
    // resolving chord is the whole piece for four bars.
    if (!holdingNow) {
      var amp = BASS_PAT[s];
      if (amp > 0) playBass(time, curChordRoot + BASS_DEG[s], amp, P);
    }

    // --- arp layer; density follows intensity --------------------------------
    var it = music.intensity;
    if (it > 0.02) {
      var play;
      if (it > 0.7) play = true;                       // every 16th
      else if (it > 0.4) play = (s % 2) === 0;         // 8ths
      else if (it > 0.15) play = (s % 4) === 0;        // quarters
      else play = (s === 0 || s === 8);                // sparse
      if (play) playArp(time, curChordRoot + ARP_DEG[s], P, it);
    }
  }

  function fireBeat(i, time) {
    if (!beatCbs.length) return;
    var delay = Math.max(0, (time - ctx.currentTime) * 1000);
    setTimeout(function () {
      for (var k = 0; k < beatCbs.length; k++) {
        try { beatCbs[k](i, time); } catch (e) {}
      }
    }, delay);
  }

  // --- music voices: short-lived, self-disconnecting via onended -------------
  function playBass(time, deg, amp, P) {
    var f = music.scaleFreq(deg, -1) * P;
    var o = ctx.createOscillator();
    var o2 = ctx.createOscillator();
    var lp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 0.5;
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(300 + 1200 * music.intensity, time);
    lp.frequency.exponentialRampToValueAtTime(180, time + 0.18);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bassGain);
    var dur = 0.22;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.3 * amp, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.start(time); o.stop(time + dur + 0.02);
    o2.start(time); o2.stop(time + dur + 0.02);
    o.onended = function () {
      o.disconnect(); o2.disconnect(); lp.disconnect(); g.disconnect();
      o.onended = null;
    };
  }

  function playPad(time, rootDeg, holding, P) {
    var barSec = (60 / music.bpm) * 4;
    var dur = barSec * BARS_PER_BLOCK * (holding ? 1.15 : 1);
    for (var i = 0; i < PAD_DEGS.length; i++) {
      var f = music.scaleFreq(rootDeg + PAD_DEGS[i], 0) * P;
      var a = ctx.createOscillator();
      var b = ctx.createOscillator();
      var g = ctx.createGain();
      a.type = 'triangle'; a.frequency.value = f; a.detune.value = -5;
      b.type = 'sine'; b.frequency.value = f; b.detune.value = 6;
      a.connect(g); b.connect(g); g.connect(padGain);
      var peak = (holding ? 0.16 : 0.1) * (i === 0 ? 1.1 : 0.85);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(peak, time + (holding ? 1.2 : 0.9));
      g.gain.setValueAtTime(peak, time + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, time + dur);
      a.start(time); a.stop(time + dur + 0.05);
      b.start(time); b.stop(time + dur + 0.05);
      (function (a2, b2, g2) {
        a2.onended = function () { a2.disconnect(); b2.disconnect(); g2.disconnect(); a2.onended = null; };
      })(a, b, g);
    }
  }

  function playArp(time, deg, P, it) {
    var f = music.scaleFreq(deg, 1) * P;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    o.connect(g); g.connect(arpGain);
    var dur = 0.12 + 0.1 * (1 - it);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.22, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.start(time); o.stop(time + dur + 0.02);
    o.onended = function () { o.disconnect(); g.disconnect(); o.onended = null; };
  }

  /** One-shot musical punctuation, played on the music bus (not the SFX bus). */
  function padNote(freq, t, attack, hold, release, peak, type) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    o.connect(g); g.connect(padGain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.start(t); o.stop(t + attack + hold + release + 0.05);
    o.onended = function () { o.disconnect(); g.disconnect(); o.onended = null; };
  }

  music.stinger = function (name) {
    if (!ctx || !Audio.enabled) return;
    ensureMusicNodes();
    var t = ctx.currentTime + 0.02, i;
    if (name === 'waveClear') {
      for (i = 0; i < RESOLVE.length; i++) {
        padNote(music.scaleFreq(RESOLVE[i], 1) * pitchScale, t + i * 0.05, 0.03, 0.1, 1.3, 0.16, 'sine');
      }
    } else if (name === 'bossDeath') {
      Audio.sfx('bossDeath');
      for (i = 0; i < DESCEND.length; i++) {
        padNote(music.scaleFreq(DESCEND[i], 0) * pitchScale, t + i * 0.18, 0.05, 0.2, 1.9, 0.14, 'triangle');
      }
    } else if (name === 'victory') {
      for (i = 0; i < VICTORY.length; i++) {
        padNote(music.scaleFreq(VICTORY[i], VICTORY[i] >= 7 ? 1 : 0) * pitchScale,
                t + i * 0.12, 0.08, 1.4, 1.4, 0.18, i % 2 ? 'sine' : 'triangle');
      }
    }
  };

  Audio.music = music;
  NA.Audio = Audio;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
