/* AURA DJ — motore audio
   Grafo: [canale A|B] -> somma -> compressore -> soft clip -> master -> analyser -> uscita
   Ogni canale ha EQ a 3 bande, filtro HP/LP, fader e mandate riverbero/delay proprie,
   così le automazioni di transizione agiscono anche sulla coda degli effetti. */
window.DJ = window.DJ || {};
(function (DJ) {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const NOW_EPS = 0.001;

  const Engine = {
    ctx: null,
    started: false,
    userPaused: false,
    master: null, sum: null, analyser: null, comp: null,
    noise: null, ir: null,
    channels: [],
    recDest: null,
    freqData: null, timeData: null,

    init() {
      if (this.ctx) return this.ctx;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new Ctor({ latencyHint: 'playback' });

      this.sum = ctx.createGain();
      this.sum.gain.value = 0.9;

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 24;
      this.comp.ratio.value = 3.2;
      this.comp.attack.value = 0.006;
      this.comp.release.value = 0.22;

      const clipper = ctx.createWaveShaper();
      clipper.curve = softClipCurve(2.2);
      clipper.oversample = '2x';

      // EQ di master (tilt bassi/alti dai comandi del mixer)
      this.mLow = ctx.createBiquadFilter();  this.mLow.type = 'lowshelf';  this.mLow.frequency.value = 130;
      this.mHigh = ctx.createBiquadFilter(); this.mHigh.type = 'highshelf'; this.mHigh.frequency.value = 6200;

      this.master = ctx.createGain();
      this.master.gain.value = 0.8;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);

      this.sum.connect(this.comp);
      this.comp.connect(clipper);
      clipper.connect(this.mLow);
      this.mLow.connect(this.mHigh);
      this.mHigh.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.recDest = ctx.createMediaStreamDestination();
      this.master.connect(this.recDest);

      this.noise = makeNoiseBuffer(ctx, 3);
      this.ir = makeImpulse(ctx, 2.8, 2.4);
      return ctx;
    },

    /* --- canale di missaggio --- */
    createChannel(label) {
      const ctx = this.ctx;
      const ch = { label };

      ch.input = ctx.createGain();          // segnale asciutto delle voci
      ch.revIn = ctx.createGain();          // mandata riverbero
      ch.delIn = ctx.createGain();          // mandata delay
      ch.revIn.gain.value = 1;
      ch.delIn.gain.value = 1;

      ch.verb = ctx.createConvolver();
      ch.verb.buffer = this.ir;
      ch.revRet = ctx.createGain();
      ch.revRet.gain.value = 0.9;

      ch.delay = ctx.createDelay(2.5);
      ch.delay.delayTime.value = 0.36;
      ch.delFb = ctx.createGain();
      ch.delFb.gain.value = 0.32;
      ch.delTone = ctx.createBiquadFilter();
      ch.delTone.type = 'lowpass';
      ch.delTone.frequency.value = 3200;
      ch.delRet = ctx.createGain();
      ch.delRet.gain.value = 0.8;

      ch.bus = ctx.createGain();

      ch.low = ctx.createBiquadFilter();  ch.low.type = 'lowshelf';  ch.low.frequency.value = 180;
      ch.mid = ctx.createBiquadFilter();  ch.mid.type = 'peaking';   ch.mid.frequency.value = 1100; ch.mid.Q.value = 0.9;
      ch.high = ctx.createBiquadFilter(); ch.high.type = 'highshelf'; ch.high.frequency.value = 5200;

      ch.hp = ctx.createBiquadFilter(); ch.hp.type = 'highpass'; ch.hp.frequency.value = 20;  ch.hp.Q.value = 0.9;
      ch.lp = ctx.createBiquadFilter(); ch.lp.type = 'lowpass';  ch.lp.frequency.value = 20000; ch.lp.Q.value = 0.9;

      ch.fader = ctx.createGain();
      ch.fader.gain.value = 0;

      ch.meter = ctx.createAnalyser();
      ch.meter.fftSize = 512;
      ch.meterData = new Uint8Array(ch.meter.fftSize);

      ch.input.connect(ch.bus);
      ch.revIn.connect(ch.verb); ch.verb.connect(ch.revRet); ch.revRet.connect(ch.bus);
      ch.delIn.connect(ch.delay);
      ch.delay.connect(ch.delTone); ch.delTone.connect(ch.delFb); ch.delFb.connect(ch.delay);
      ch.delay.connect(ch.delRet); ch.delRet.connect(ch.bus);

      ch.bus.connect(ch.low); ch.low.connect(ch.mid); ch.mid.connect(ch.high);
      ch.high.connect(ch.hp); ch.hp.connect(ch.lp); ch.lp.connect(ch.fader);
      ch.fader.connect(this.sum);
      ch.fader.connect(ch.meter);

      ch.level = () => {
        ch.meter.getByteTimeDomainData(ch.meterData);
        let peak = 0;
        for (let i = 0; i < ch.meterData.length; i += 4) {
          const v = Math.abs(ch.meterData[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        return peak;
      };

      ch.reset = (t) => {
        const now = t || this.ctx.currentTime;
        [ch.low, ch.mid, ch.high].forEach(f => { f.gain.cancelScheduledValues(now); f.gain.setValueAtTime(0, now); });
        ch.hp.frequency.cancelScheduledValues(now); ch.hp.frequency.setValueAtTime(20, now);
        ch.lp.frequency.cancelScheduledValues(now); ch.lp.frequency.setValueAtTime(20000, now);
        ch.delFb.gain.cancelScheduledValues(now); ch.delFb.gain.setValueAtTime(0.32, now);
        ch.delRet.gain.cancelScheduledValues(now); ch.delRet.gain.setValueAtTime(0.8, now);
      };

      this.channels.push(ch);
      return ch;
    },

    setDelayTime(seconds) {
      const t = this.ctx.currentTime;
      this.channels.forEach(ch => {
        ch.delay.delayTime.cancelScheduledValues(t);
        ch.delay.delayTime.linearRampToValueAtTime(clamp(seconds, 0.02, 2.4), t + 0.6);
      });
    },

    /** quantità globale di riverbero (0..1) */
    setReverb(amount) {
      this.revAmount = amount;
      this.channels.forEach(ch => { ch.revRet.gain.value = 0.25 + amount * 1.5; });
    },

    resume() {
      // non riattivare il contesto se la pausa l'ha chiesta l'utente
      if (this.userPaused) return Promise.resolve();
      if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume().catch(() => {});
      return Promise.resolve();
    }
  };

  /* ------------------------------------------------------------------ */
  /* helper di sintesi                                                   */
  /* ------------------------------------------------------------------ */

  function softClipCurve(amount) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }

  function makeNoiseBuffer(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  function makeImpulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // piccolo pre-delay + coda esponenziale, leggermente diversa per canale
        const shape = Math.pow(1 - t, decay) * (t < 0.006 ? t / 0.006 : 1);
        d[i] = (Math.random() * 2 - 1) * shape * (c ? 0.96 : 1);
      }
    }
    return buf;
  }

  function noiseSrc(t, dur) {
    const s = Engine.ctx.createBufferSource();
    s.buffer = Engine.noise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    // offset casuale per non ripetere sempre lo stesso frammento
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.02);
    return s;
  }

  /** nodo d'uscita di una voce: asciutto + mandate effetti del canale */
  function out(ch, sends) {
    const ctx = Engine.ctx;
    const g = ctx.createGain();
    g.connect(ch.input);
    if (sends) {
      if (sends.rev > 0) { const r = ctx.createGain(); r.gain.value = sends.rev; g.connect(r); r.connect(ch.revIn); }
      if (sends.del > 0) { const d = ctx.createGain(); d.gain.value = sends.del; g.connect(d); d.connect(ch.delIn); }
    }
    return g;
  }

  function ampEnv(param, t, peak, a, d, s, len, r) {
    const p = Math.max(peak, 0.0002);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(p, t + a);
    param.exponentialRampToValueAtTime(Math.max(p * s, 0.0002), t + a + d);
    param.setValueAtTime(Math.max(p * s, 0.0002), t + Math.max(len, a + d));
    param.exponentialRampToValueAtTime(0.0001, t + Math.max(len, a + d) + r);
  }

  /* ------------------------------------------------------------------ */
  /* voci                                                                */
  /* ------------------------------------------------------------------ */
  const V = {};

  V.kick = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const vel = (o.vel != null ? o.vel : 1) * 1.05;
    const decay = o.decay || 0.4;
    const tune = o.tune || 1;
    const g = out(ch, { rev: (o.rev || 0) * 0.15, del: 0 });

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180 * tune, t);
    osc.frequency.exponentialRampToValueAtTime(46 * tune, t + 0.055);
    osc.frequency.exponentialRampToValueAtTime(38 * tune, t + decay);

    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.exponentialRampToValueAtTime(vel, t + 0.004);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(eg); eg.connect(g);
    osc.start(t); osc.stop(t + decay + 0.05);

    if (o.click !== 0) {
      const n = noiseSrc(t, 0.02);
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2600; hp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.35 * vel * (o.click || 0.7), t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.016);
      n.connect(hp); hp.connect(ng); ng.connect(g);
    }
  };

  V.snare = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const vel = o.vel != null ? o.vel : 0.8;
    const dur = o.decay || 0.17;
    const g = out(ch, { rev: o.rev != null ? o.rev : 0.22, del: o.del || 0 });

    const n = noiseSrc(t, dur + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.tone || 1750; bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(ng); ng.connect(g);

    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(og); og.connect(g);
    osc.start(t); osc.stop(t + 0.12);
  };

  V.clap = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const vel = o.vel != null ? o.vel : 0.75;
    const g = out(ch, { rev: o.rev != null ? o.rev : 0.3, del: o.del || 0 });
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1250; bp.Q.value = 1.3;
    bp.connect(g);
    [0, 0.012, 0.024].forEach((off, i) => {
      const n = noiseSrc(t + off, 0.03);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(vel * (0.7 - i * 0.12), t + off);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.022);
      n.connect(ng); ng.connect(bp);
    });
    const tail = noiseSrc(t + 0.034, 0.2);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(vel * 0.65, t + 0.034);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.034 + 0.16);
    tail.connect(tg); tg.connect(bp);
  };

  V.hat = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const open = !!o.open;
    const vel = (o.vel != null ? o.vel : 0.45) * (open ? 0.85 : 1);
    const dur = open ? (o.decay || 0.26) : (o.decay || 0.038);
    const g = out(ch, { rev: o.rev || 0.05, del: o.del || 0 });
    const n = noiseSrc(t, dur + 0.03);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 7200 : 8600;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 11000; bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(g);
  };

  V.perc = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const vel = o.vel != null ? o.vel : 0.5;
    const f = o.freq || 520;
    const dur = o.decay || 0.12;
    const g = out(ch, { rev: o.rev != null ? o.rev : 0.25, del: o.del || 0.08 });
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'triangle';
    osc.frequency.setValueAtTime(f * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.exponentialRampToValueAtTime(vel * 0.6, t + 0.004);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(eg); eg.connect(g);
    osc.start(t); osc.stop(t + dur + 0.05);

    const n = noiseSrc(t, 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 4; bp.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(bp); bp.connect(ng); ng.connect(g);
  };

  V.rim = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const vel = o.vel != null ? o.vel : 0.4;
    const g = out(ch, { rev: 0.2, del: o.del || 0.12 });
    const osc = ctx.createOscillator(); osc.type = 'square';
    osc.frequency.setValueAtTime(1700, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.02);
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(vel * 0.4, t);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(eg); eg.connect(g);
    osc.start(t); osc.stop(t + 0.06);
  };

  V.bass = function (ch, t, o) {
    const ctx = Engine.ctx;
    const vel = o.vel != null ? o.vel : 0.8;
    const len = o.len || 0.2;
    const f = mtof(o.note);
    const g = out(ch, { rev: o.rev || 0, del: o.del || 0 });

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = o.reso != null ? o.reso : 5;
    const base = clamp(o.cutoff || 520, 90, 9000);
    filt.frequency.setValueAtTime(clamp(base * 3.4, 120, 12000), t);
    filt.frequency.exponentialRampToValueAtTime(base, t + Math.min(0.18, len));

    const eg = ctx.createGain();
    ampEnv(eg.gain, t, vel * 0.55, 0.006, 0.05, 0.85, len, 0.05);

    const osc = ctx.createOscillator();
    osc.type = o.wave || 'sawtooth';
    if (o.glideFrom) {
      osc.frequency.setValueAtTime(mtof(o.glideFrom), t);
      osc.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.12, len * 0.6));
    } else {
      osc.frequency.setValueAtTime(f, t);
    }
    osc.connect(filt);

    if (o.detune) { // reese
      const osc2 = ctx.createOscillator();
      osc2.type = o.wave || 'sawtooth';
      osc2.frequency.setValueAtTime(f, t);
      osc2.detune.setValueAtTime(o.detune, t);
      osc2.connect(filt);
      osc2.start(t); osc2.stop(t + len + 0.2);
    }

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f / 2, t);
    const subg = ctx.createGain();
    subg.gain.value = o.sub != null ? o.sub : 0.7;
    sub.connect(subg); subg.connect(eg);

    filt.connect(eg); eg.connect(g);
    osc.start(t); osc.stop(t + len + 0.2);
    sub.start(t); sub.stop(t + len + 0.2);
  };

  V.chord = function (ch, t, o) {
    const ctx = Engine.ctx;
    const notes = o.notes || [];
    const len = o.len || 0.4;
    const pad = !!o.pad;
    const vel = (o.vel != null ? o.vel : 0.5) / Math.max(2, notes.length);
    const g = out(ch, {
      rev: o.rev != null ? o.rev : (pad ? 0.55 : 0.25),
      del: o.del != null ? o.del : (pad ? 0.1 : 0.18)
    });

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = pad ? 0.7 : 3;
    const cut = clamp(o.cutoff || 2200, 200, 14000);
    if (pad) {
      filt.frequency.setValueAtTime(cut * 0.5, t);
      filt.frequency.linearRampToValueAtTime(cut, t + len * 0.5);
      filt.frequency.linearRampToValueAtTime(cut * 0.6, t + len);
    } else {
      filt.frequency.setValueAtTime(cut * 2.2, t);
      filt.frequency.exponentialRampToValueAtTime(cut, t + 0.18);
    }

    const eg = ctx.createGain();
    const a = pad ? Math.min(len * 0.35, 1.4) : 0.008;
    const r = pad ? 1.3 : 0.25;
    ampEnv(eg.gain, t, vel, a, pad ? 0.3 : 0.12, pad ? 0.9 : 0.35, len, r);

    notes.forEach(n => {
      [-7, 7].forEach(cents => {
        const osc = ctx.createOscillator();
        osc.type = o.wave || (pad ? 'sawtooth' : 'sawtooth');
        osc.frequency.setValueAtTime(mtof(n), t);
        osc.detune.setValueAtTime(cents + (Math.random() * 4 - 2), t);
        osc.connect(filt);
        osc.start(t); osc.stop(t + len + r + 0.1);
      });
    });

    filt.connect(eg); eg.connect(g);
  };

  V.pluck = function (ch, t, o) {
    const ctx = Engine.ctx;
    const len = o.len || 0.22;
    const vel = o.vel != null ? o.vel : 0.4;
    const g = out(ch, { rev: o.rev != null ? o.rev : 0.35, del: o.del != null ? o.del : 0.35 });
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 6;
    const cut = clamp(o.cutoff || 3000, 300, 14000);
    filt.frequency.setValueAtTime(cut, t);
    filt.frequency.exponentialRampToValueAtTime(clamp(cut * 0.25, 200, 12000), t + len);
    const eg = ctx.createGain();
    ampEnv(eg.gain, t, vel * 0.5, 0.004, 0.06, 0.25, len, 0.18);
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'triangle';
    osc.frequency.setValueAtTime(mtof(o.note), t);
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(mtof(o.note), t);
    osc2.detune.value = 6;
    const mix = ctx.createGain(); mix.gain.value = 0.45;
    osc2.connect(mix); mix.connect(filt); osc.connect(filt);
    filt.connect(eg); eg.connect(g);
    osc.start(t); osc.stop(t + len + 0.3);
    osc2.start(t); osc2.stop(t + len + 0.3);
  };

  V.lead = function (ch, t, o) {
    const ctx = Engine.ctx;
    const len = o.len || 0.5;
    const vel = o.vel != null ? o.vel : 0.34;
    const g = out(ch, { rev: 0.4, del: o.del != null ? o.del : 0.3 });
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 2.5;
    const cut = clamp(o.cutoff || 3400, 400, 15000);
    filt.frequency.setValueAtTime(cut * 0.8, t);
    filt.frequency.linearRampToValueAtTime(cut, t + len * 0.5);
    const eg = ctx.createGain();
    ampEnv(eg.gain, t, vel * 0.42, 0.02, 0.1, 0.8, len, 0.25);

    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.2;
    const vibg = ctx.createGain(); vibg.gain.value = 5;
    vib.connect(vibg);
    vib.start(t); vib.stop(t + len + 0.4);

    [-12, 0, 12].forEach(d => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(mtof(o.note), t);
      osc.detune.setValueAtTime(d, t);
      vibg.connect(osc.detune);
      osc.connect(filt);
      osc.start(t); osc.stop(t + len + 0.4);
    });
    filt.connect(eg); eg.connect(g);
  };

  V.riser = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const dur = o.dur || 4;
    const vel = o.vel != null ? o.vel : 0.35;
    const g = out(ch, { rev: 0.4, del: 0.1 });
    const n = noiseSrc(t, dur + 0.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(9500, t + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(vel * 0.5, t + dur * 0.92);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    n.connect(bp); bp.connect(ng); ng.connect(g);

    if (o.tonal !== false) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(mtof((o.note || 45)), t);
      osc.frequency.exponentialRampToValueAtTime(mtof((o.note || 45) + 24), t + dur);
      const of_ = ctx.createBiquadFilter(); of_.type = 'lowpass'; of_.frequency.value = 4000;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(vel * 0.22, t + dur * 0.9);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      osc.connect(of_); of_.connect(og); og.connect(g);
      osc.start(t); osc.stop(t + dur + 0.1);
    }
  };

  V.impact = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const vel = o.vel != null ? o.vel : 0.6;
    const g = out(ch, { rev: 0.6, del: 0.1 });
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 1.1);
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.exponentialRampToValueAtTime(vel, t + 0.01);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(eg); eg.connect(g);
    osc.start(t); osc.stop(t + 1.3);

    const n = noiseSrc(t, 1.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(9000, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 1.0);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    n.connect(lp); lp.connect(ng); ng.connect(g);
  };

  V.downsweep = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const dur = o.dur || 2;
    const g = out(ch, { rev: 0.5, del: 0.2 });
    const n = noiseSrc(t, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(8000, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime((o.vel || 0.3) * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(ng); ng.connect(g);
  };

  /* --- voce sintetica a formanti ---
     Una sorgente ricca di armoniche passa in tre passa-banda accordati sulle
     risonanze di una vocale: è così che si costruiscono i cori sintetici.
     Il vibrato e il passaggio graduale da una vocale all'altra sono ciò che
     distingue una voce da un filtro. */
  const VOWELS = {
    a: [[850, 1.00, 10], [1220, 0.50, 12], [2810, 0.22, 14]],
    e: [[610, 1.00, 10], [1900, 0.45, 13], [2700, 0.20, 14]],
    i: [[310, 1.00, 9],  [2790, 0.40, 14], [3310, 0.18, 15]],
    o: [[480, 1.00, 9],  [760,  0.50, 10], [2620, 0.15, 14]],
    u: [[370, 1.00, 9],  [950,  0.40, 11], [2670, 0.12, 14]]
  };
  V.VOWELS = VOWELS;

  V.voice = function (ch, t, o) {
    const ctx = Engine.ctx;
    const pad = o.pad !== false;
    const len = o.len || 1;
    const vel = (o.vel != null ? o.vel : 0.3);
    const f0 = mtof(o.note);
    const v1 = VOWELS[o.vowel] || VOWELS.a;
    const v2 = o.vowel2 ? (VOWELS[o.vowel2] || v1) : null;

    const g = out(ch, {
      rev: o.rev != null ? o.rev : (pad ? 0.6 : 0.35),
      del: o.del != null ? o.del : (pad ? 0.08 : 0.3)
    });

    const eg = ctx.createGain();
    const a = pad ? Math.min(len * 0.3, 0.55) : 0.02;
    const r = pad ? 0.7 : 0.14;
    ampEnv(eg.gain, t, vel * 0.5, a, pad ? 0.25 : 0.06, pad ? 0.9 : 0.4, len, r);
    eg.connect(g);

    // sorgente: due dente di sega leggermente disaccordati, come due gole vicine
    const src = ctx.createGain();
    src.gain.value = 0.5;
    const oscs = [];
    [-6, 7].forEach(cents => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t);
      osc.detune.setValueAtTime(cents, t);
      osc.connect(src);
      oscs.push(osc);
    });

    // vibrato che entra dopo l'attacco, come in un canto tenuto
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(4.8 + Math.random() * 1.2, t);
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.setValueAtTime(0, t);
    lfoAmt.gain.linearRampToValueAtTime(pad ? 11 : 5, t + Math.min(len * 0.6, 0.9));
    lfo.connect(lfoAmt);
    oscs.forEach(osc => lfoAmt.connect(osc.detune));

    // un filo d'aria: è quello che toglie il sapore di sintetizzatore
    if (o.breath !== 0) {
      const n = noiseSrc(t, len + r);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.value = (o.breath || 0.05);
      n.connect(bp); bp.connect(ng); ng.connect(src);
    }

    // tre formanti in parallelo, con passaggio graduale alla seconda vocale
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(v1[i][0], t);
      bp.Q.value = v1[i][2];
      if (v2) {
        bp.frequency.setValueAtTime(v1[i][0], t + len * 0.2);
        bp.frequency.linearRampToValueAtTime(v2[i][0], t + len * 0.8);
      }
      const fg = ctx.createGain();
      fg.gain.value = v1[i][1] * 0.9;
      src.connect(bp); bp.connect(fg); fg.connect(eg);
    }

    // un filo di sorgente diretta tiene il corpo della nota
    const dry = ctx.createGain();
    dry.gain.value = 0.06;
    const dryLp = ctx.createBiquadFilter();
    dryLp.type = 'lowpass'; dryLp.frequency.value = 900;
    src.connect(dryLp); dryLp.connect(dry); dry.connect(eg);

    const stopAt = t + len + r + 0.15;
    oscs.forEach(osc => { osc.start(t); osc.stop(stopAt); });
    lfo.start(t); lfo.stop(stopAt);
  };

  /** rumore continuo (vinile / aria) — ritorna un handle con stop() */
  V.texture = function (ch, t, o) {
    o = o || {};
    const ctx = Engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = Engine.noise; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type || 'bandpass';
    filt.frequency.value = o.freq || 3000;
    filt.Q.value = o.q || 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vel != null ? o.vel : 0.04, t + 0.5);
    src.connect(filt); filt.connect(g); g.connect(ch.input);
    src.start(t);
    return {
      gain: g,
      stop(when) {
        const w = Math.max(when || ctx.currentTime, ctx.currentTime);
        g.gain.cancelScheduledValues(w);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), w);
        g.gain.linearRampToValueAtTime(0.0001, w + 0.4);
        try { src.stop(w + 0.6); } catch (e) {}
      }
    };
  };

  /* ------------------------------------------------------------------ */
  /* transport: clock a 16esimi, lookahead scheduling                    */
  /* ------------------------------------------------------------------ */
  const Transport = {
    bpm: 124,
    targetBpm: 124,
    swing: 0,
    step: 0,          // 16esimo globale dall'avvio
    nextTime: 0,
    running: false,
    lookahead: 0.45,
    glideRate: 0.02,   // bpm per 16esimo: il regista lo alza durante le transizioni
    listeners: [],
    worker: null,

    stepDur() { return 60 / this.bpm / 4; },
    barStep() { return 16; },

    /** tempo previsto per un 16esimo futuro (usato per programmare le automazioni) */
    timeAt(step) { return this.nextTime + (step - this.step) * this.stepDur(); },

    onStep(fn) { this.listeners.push(fn); },

    start() {
      if (this.running) return;
      const ctx = Engine.ctx;
      this.running = true;
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.25;
      this._spawnTicker();
    },

    stop() {
      this.running = false;
      if (this.worker) this.worker.postMessage({ cmd: 'stop' });
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    setBpm(v, immediate) {
      this.targetBpm = clamp(v, 60, 190);
      if (immediate) this.bpm = this.targetBpm;
      Engine.setDelayTime((60 / this.targetBpm) * 0.75);
    },

    _spawnTicker() {
      const tick = () => { this._gotTick = true; this._tick(); };
      const useLocalTimer = () => {
        if (this._timer) return;
        if (this.worker) { try { this.worker.terminate(); } catch (e) {} this.worker = null; }
        this._timer = setInterval(tick, 25);
      };

      this._gotTick = false;
      try {
        const src = "let id=null;onmessage=function(e){if(e.data.cmd==='start'){clearInterval(id);id=setInterval(function(){postMessage(0)},e.data.ms)}else if(e.data.cmd==='stop'){clearInterval(id);id=null}}";
        const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        this.worker = new Worker(url);
        this.worker.onmessage = tick;
        this.worker.onerror = useLocalTimer;
        this.worker.postMessage({ cmd: 'start', ms: 25 });
      } catch (e) {
        useLocalTimer();     // worker vietato (per esempio aprendo il file da disco)
        return;
      }
      // il worker può anche fallire in silenzio: se entro 400 ms non batte, si passa al timer locale
      setTimeout(() => { if (!this._gotTick) useLocalTimer(); }, 400);
    },

    _tick() {
      if (!this.running) return;
      const ctx = Engine.ctx;
      if (ctx.state === 'suspended') { Engine.resume(); return; }

      // se il contesto è rimasto indietro (sospensione del sistema) ri-aggancia il clock
      if (this.nextTime < ctx.currentTime - 1.5) this.nextTime = ctx.currentTime + 0.1;

      let guard = 0;
      while (this.nextTime < ctx.currentTime + this.lookahead && guard++ < 512) {
        const swung = (this.step % 2 === 1) ? this.nextTime + this.stepDur() * this.swing : this.nextTime;
        for (let i = 0; i < this.listeners.length; i++) {
          try { this.listeners[i](this.step, swung); } catch (err) { console.error(err); }
        }
        // glide del bpm: max ~0.35 bpm al secondo, impercettibile
        const d = this.targetBpm - this.bpm;
        if (Math.abs(d) > 0.005) this.bpm += clamp(d, -this.glideRate, this.glideRate);
        this.nextTime += this.stepDur();
        this.step++;
      }
    }
  };

  DJ.Engine = Engine;
  DJ.V = V;
  DJ.Transport = Transport;
  DJ.util = { clamp, mtof, NOW_EPS };
})(window.DJ);
