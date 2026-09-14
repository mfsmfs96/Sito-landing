/* AURA DJ — deck
   Un deck suona una traccia generata (programmando le voci passo per passo)
   oppure un file dell'utente (BufferSource allineato alla griglia del transport). */
(function (DJ) {
  'use strict';
  const { Engine, V, Transport, util } = DJ;
  const { clamp } = util;
  const C = DJ.Composer;

  const BASS_OCT = 3, CHORD_OCT = 5, ARP_OCT = 6, LEAD_OCT = 6;

  function Deck(id) {
    this.id = id;
    this.channel = Engine.createChannel(id);
    this.track = null;
    this.startStep = -1;
    this.localStep = 0;
    this.totalBars = 0;
    this.playing = false;
    this.finished = false;
    this.section = null;
    this.sectionIndex = -1;
    this.source = null;      // per i file
    this.texture = null;
  }

  Deck.prototype.isFree = function () { return !this.playing; };

  Deck.prototype.load = function (track, startStep) {
    this.clear();
    this.track = track;
    this.startStep = startStep;
    this.totalBars = track.bars;
    this.playing = true;
    this.finished = false;
    this.sectionIndex = -1;
    this.channel.reset();
    return this;
  };

  Deck.prototype.clear = function () {
    if (this.source) { try { this.source.stop(); } catch (e) {} this.source = null; }
    if (this.texture) { this.texture.stop(); this.texture = null; }
    this.track = null;
    this.playing = false;
    this.startStep = -1;
    this.localStep = 0;
  };

  Deck.prototype.stopAt = function (time) {
    const d = this;
    if (this.source) {
      try {
        const g = this._fileGain;
        if (g) {
          g.gain.cancelScheduledValues(time);
          g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), time);
          g.gain.linearRampToValueAtTime(0.0001, time + 0.25);
        }
        this.source.stop(time + 0.3);
      } catch (e) {}
    }
    if (this.texture) this.texture.stop(time);
    const id = this.track ? this.track.id : null;
    this.playing = false;                       // smette subito di programmare note
    setTimeout(() => { if (d.track && d.track.id === id) d.clear(); },
      Math.max(0, (time - Engine.ctx.currentTime) * 1000) + 500);
  };

  Deck.prototype.bar = function () { return Math.floor(this.localStep / 16); };
  Deck.prototype.remainingBars = function () { return Math.max(0, this.totalBars - this.bar()); };
  Deck.prototype.progress = function () {
    return this.totalBars ? clamp(this.localStep / (this.totalBars * 16), 0, 1) : 0;
  };

  /* sezione corrente a partire dalla battuta */
  Deck.prototype.sectionAt = function (bar) {
    const st = this.track.structure;
    let acc = 0;
    for (let i = 0; i < st.length; i++) {
      if (bar < acc + st[i].bars) return { i, type: st[i].type, startBar: acc, bars: st[i].bars, localBar: bar - acc };
      acc += st[i].bars;
    }
    return null;
  };

  /* --------------------------------------------------------------- */
  Deck.prototype.onStep = function (gstep, time) {
    if (!this.playing || !this.track) return;
    const local = gstep - this.startStep;
    if (local < 0) return;
    this.localStep = local;

    if (this.track.kind === 'file') return this._fileStep(local, time);

    const bar = Math.floor(local / 16);
    if (bar >= this.totalBars) { this.finished = true; return; }
    const step = local % 16;
    const sec = this.sectionAt(bar);
    if (!sec) { this.finished = true; return; }

    if (sec.i !== this.sectionIndex) {
      this.sectionIndex = sec.i;
      this.section = sec;
      this._onSectionStart(sec, time);
    }
    this._genStep(sec, bar, step, local, time);
  };

  Deck.prototype._onSectionStart = function (sec, time) {
    const t = this.track, ch = this.channel;
    const beat = 60 / Transport.bpm;

    if (sec.i === 0 && t.sound.texture) {
      this.texture = V.texture(ch, time, {
        freq: t.sound.texture.freq, vel: t.sound.texture.vel, q: t.sound.texture.q || 0.6
      });
    }
    if (sec.type === 'build') {
      V.riser(ch, time, { dur: sec.bars * 4 * beat, vel: 0.28 + t.energy * 0.25, note: t.root + 33 });
    }
    if (sec.type === 'drop') {
      V.impact(ch, time, { vel: 0.45 + t.energy * 0.3 });
    }
    if (sec.type === 'break') {
      V.downsweep(ch, time, { dur: 2 * beat, vel: 0.3 });
    }
  };

  Deck.prototype._genStep = function (sec, bar, step, local, time) {
    const t = this.track, ch = this.channel, P = t.patterns, S = t.sound;
    const L = C.LAYERS[sec.type] || C.LAYERS.main;
    const beat = 60 / Transport.bpm;
    const stepDur = beat / 4;
    const hum = () => (Math.random() - 0.5) * 0.004;

    // intensità crescente dentro build / calante in outro
    const secPos = sec.bars > 1 ? sec.localBar / (sec.bars - 1 || 1) : 1;
    let intens = 1;
    if (sec.type === 'build') intens = 0.65 + secPos * 0.5;
    if (sec.type === 'intro') intens = 0.6 + secPos * 0.35;
    if (sec.type === 'outro') intens = 1 - secPos * 0.55;

    const on = (p) => Math.random() < p;
    const bars8 = bar % 8;
    const lastBarOfPhrase = bars8 === 7;

    /* --- cassa --- */
    const kv = P.kick[step];
    if (kv && on(L.kick)) {
      // negli ultimi 2 quarti dell'ultima battuta della frase si apre lo spazio
      if (!(lastBarOfPhrase && step >= 12 && sec.type === 'build' && t.energy > 0.6)) {
        V.kick(ch, time + hum(), {
          vel: kv * (0.9 + 0.1 * Math.random()) * intens,
          tune: S.kickTune, decay: S.kickDecay
        });
      }
    }

    /* --- rullante / clap --- */
    if (P.snare.indexOf(step) >= 0 && on(L.snare)) {
      const useClap = t.genre !== 'dnb' && t.genre !== 'lofi';
      (useClap ? V.clap : V.snare)(ch, time + hum(), { vel: (0.55 + t.energy * 0.3) * intens, rev: 0.25 + (sec.type === 'break' ? 0.3 : 0) });
    }

    /* --- charleston --- */
    const hv = P.hat[step];
    if (hv && on(L.hat)) {
      V.hat(ch, time + hum(), { vel: hv * (0.75 + t.brightness * 0.5) * intens, open: false });
    }
    if (P.ohat.indexOf(step) >= 0 && on(L.hat * 0.85) && sec.type !== 'break') {
      V.hat(ch, time + hum(), { vel: 0.3 * intens, open: true, decay: 0.2 + t.density * 0.15 });
    }

    /* --- percussioni --- */
    const pv = P.perc[step];
    if (pv && on(L.perc * 0.9)) {
      if (Math.random() < 0.3) V.rim(ch, time + hum(), { vel: pv * intens });
      else V.perc(ch, time + hum(), { vel: pv * intens, freq: 300 + Math.random() * 700, decay: 0.08 + Math.random() * 0.12 });
    }

    /* --- fill di fine frase --- */
    if (lastBarOfPhrase && step >= 12 && sec.type !== 'intro' && Math.random() < 0.5 * t.density + 0.2) {
      V.perc(ch, time + hum(), { vel: 0.35, freq: 220 + (step - 12) * 120, decay: 0.1 });
    }
    if (sec.type === 'build' && secPos > 0.6) {
      const rollRate = secPos > 0.85 ? 1 : 2;   // rullata che accelera
      if (step % rollRate === 0) V.snare(ch, time + hum(), { vel: 0.18 + secPos * 0.4, decay: 0.08, tone: 2100 });
    }

    /* --- armonia corrente --- */
    const barsPerChord = t.bpm < 100 ? 2 : 1;
    const chordIdx = Math.floor(bar / barsPerChord) % t.prog.length;
    const deg = t.prog[chordIdx];

    /* --- basso --- */
    if (L.bass > 0.25) {
      for (let i = 0; i < P.bass.length; i++) {
        const e = P.bass[i];
        if (e.step !== step) continue;
        if (!on(L.bass)) continue;
        const note = C.scaleNote(t.scale, t.root, deg + e.degOff, BASS_OCT) - (t.genre === 'dnb' ? 12 : 0);
        V.bass(ch, time + hum(), {
          note,
          len: e.len * stepDur,
          vel: e.vel * (0.85 + t.energy * 0.25) * intens,
          wave: S.bassWave,
          cutoff: S.bassCutoff * (0.7 + intens * 0.5),
          reso: S.bassReso,
          sub: S.bassSub,
          detune: S.detune || 0,
          glideFrom: (t.genre === 'techno' && Math.random() < 0.15) ? note - 5 : 0
        });
      }
    }

    /* --- accordi --- */
    const notes = C.chordNotes(t.scale, t.root, deg, CHORD_OCT, t.chordSize);
    if (S.chordStyle === 'pad' || (P.padOn && (sec.type === 'break' || sec.type === 'intro'))) {
      if (step === 0 && bar % barsPerChord === 0 && on(L.pad)) {
        V.chord(ch, time, {
          notes: notes.map(n => n - 12), pad: true,
          len: barsPerChord * 4 * beat * 0.95,
          vel: (0.3 + t.brightness * 0.2) * (sec.type === 'break' ? 1.25 : 1),
          cutoff: S.chordCutoff * (sec.type === 'break' ? 1.2 : 1)
        });
      }
    }
    if (S.chordStyle === 'stab' && on(L.chord)) {
      const stabSteps = t.genre === 'techno' ? [6, 14] : [2, 6, 10, 14];
      if (stabSteps.indexOf(step) >= 0 && Math.random() < 0.5 + t.density * 0.4) {
        V.chord(ch, time + hum(), {
          notes, len: stepDur * 1.6,
          vel: 0.24 + t.energy * 0.14,
          cutoff: S.chordCutoff, del: 0.2
        });
      }
    }
    if (S.chordStyle === 'pluck' && on(L.chord)) {
      const pl = [0, 3, 6, 10, 11, 14];
      if (pl.indexOf(step) >= 0 && Math.random() < 0.45 + t.density * 0.4) {
        const n = notes[Math.floor(Math.random() * notes.length)];
        V.pluck(ch, time + hum(), { note: n, len: stepDur * 2, vel: 0.3, cutoff: S.chordCutoff });
      }
    }

    /* --- arpeggio --- */
    if (P.arpOn && on(L.arp) && step % P.arpRate === 0) {
      const idx = Math.floor(local / P.arpRate);
      let n;
      const pool = notes.concat(notes.map(x => x + 12));
      if (P.arpShape === 'up') n = pool[idx % pool.length];
      else if (P.arpShape === 'updown') {
        const per = pool.length * 2 - 2;
        const k = idx % per;
        n = pool[k < pool.length ? k : per - k];
      } else if (P.arpShape === 'octave') n = pool[(idx % 2) * (pool.length - 1)];
      else n = pool[Math.floor(Math.random() * pool.length)];
      V.pluck(ch, time + hum(), {
        note: n + (t.genre === 'trance' ? 0 : 0),
        len: stepDur * 1.4,
        vel: 0.16 + t.brightness * 0.16,
        cutoff: 1800 + t.brightness * 5000,
        del: 0.4
      });
    }

    /* --- lead --- */
    if (P.leadOn && on(L.lead) && step === 0 && bar % 2 === 0) {
      const n = C.scaleNote(t.scale, t.root, deg + (Math.random() < 0.5 ? 4 : 2), LEAD_OCT);
      V.lead(ch, time, { note: n, len: beat * (1 + Math.random() * 2), vel: 0.2 + t.energy * 0.16, cutoff: 2200 + t.brightness * 4000 });
    }
  };

  /* --------------------------------------------------------------- */
  /* riproduzione file utente                                         */
  Deck.prototype._fileStep = function (local, time) {
    if (local === 0 && !this.source) {
      const t = this.track, ctx = Engine.ctx;
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      const rate = clamp(Transport.bpm / t.srcBpm, 0.86, 1.16);
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = (t.trim != null ? t.trim : 1) * 0.8;
      src.connect(g); g.connect(this.channel.input);
      // piccola mandata di riverbero per incollare il brano al resto del set
      const rs = ctx.createGain(); rs.gain.value = 0.06;
      g.connect(rs); rs.connect(this.channel.revIn);
      try { src.start(time, t.offset || 0); } catch (e) { src.start(time); }
      this.source = src;
      this._fileGain = g;
      this._rate = rate;
      src.onended = () => { this.finished = true; };
    }
    const bar = Math.floor(local / 16);
    if (bar >= this.totalBars) this.finished = true;
  };

  DJ.Deck = Deck;
})(window.DJ);
