/* AURA DJ — regia autonoma
   Decide che cosa suonare, quando entrare e come mixare. Una volta avviato
   non ha più bisogno di interventi: pianifica, prepara il deck libero,
   programma le automazioni del mixer e ricomincia. */
(function (DJ) {
  'use strict';
  const { Engine, Transport, util } = DJ;
  const { clamp } = util;
  const C = DJ.Composer;
  const Taste = DJ.Taste;

  const ARCS = {
    warmup:     [[0, .32], [.12, .5], [.35, .66], [.55, .86], [.75, 1], [.88, .9], [1, .5]],
    peak:       [[0, .78], [.2, .92], [.5, 1], [.75, .95], [.9, .85], [1, .6]],
    chill:      [[0, .14], [.3, .32], [.6, .42], [.85, .34], [1, .18]],
    afterhours: [[0, .48], [.25, .62], [.5, .74], [.75, .66], [1, .42]]
  };

  function curveAt(table, p) {
    p = clamp(p, 0, 1);
    for (let i = 1; i < table.length; i++) {
      if (p <= table[i][0]) {
        const [x0, y0] = table[i - 1], [x1, y1] = table[i];
        const k = (p - x0) / Math.max(1e-6, x1 - x0);
        return y0 + (y1 - y0) * k;
      }
    }
    return table[table.length - 1][1];
  }

  const Director = {
    decks: [],
    active: 0,
    transition: null,
    pending: null,
    library: [],
    history: [],
    genreHistory: [],
    plan: { startMs: 0, durationMin: 240, vibe: 'warmup' },
    autoEnergy: true,
    manualEnergy: 0.45,
    running: false,
    listeners: {},
    lastFileAt: -999,
    trackCount: 0,

    /* ---------- eventi verso l'interfaccia ---------- */
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    emit(ev, data) { (this.listeners[ev] || []).forEach(f => { try { f(data); } catch (e) { console.error(e); } }); },
    log(msg, kind) { this.emit('log', { msg, kind: kind || 'info', at: Date.now() }); },

    /* ---------- avvio ---------- */
    start(opts) {
      opts = opts || {};
      Engine.init();
      if (!this.decks.length) {
        this.decks = [new DJ.Deck('A'), new DJ.Deck('B')];
        Transport.onStep((s, t) => this.onStep(s, t));
      }
      this.plan.startMs = Date.now();
      this.plan.durationMin = opts.durationMin != null ? opts.durationMin : 240;
      this.plan.vibe = opts.vibe || 'warmup';
      this.running = true;

      const energy = this.targetEnergy();
      const first = this.makeCandidate(energy, null);
      Transport.setBpm(first.bpm, true);
      Transport.swing = first.swing || 0;
      Transport.start();

      // il primo brano parte sul primo 16esimo, senza attesa
      const startStep = Transport.step;
      this.loadOn(0, first, startStep);
      this.active = 0;
      this.setFader(0, Engine.ctx.currentTime);
      this.log('Set aperto con “' + first.title + '” — ' + first.genreName + ', ' + first.bpm + ' BPM, ' + first.keyName, 'start');
      this.emit('track', { deck: 0, track: first });
      this.pending = null;
    },

    stop() {
      this.running = false;
      Transport.stop();
      this.decks.forEach(d => d.clear());
    },

    /** pausa: sfuma il master e sospende il contesto, così la griglia resta intatta */
    setPaused(p) {
      const ctx = Engine.ctx, t = ctx.currentTime;
      const vol = this.userVol != null ? this.userVol : 0.8;
      this.paused = !!p;
      Engine.userPaused = this.paused;
      Engine.master.gain.cancelScheduledValues(t);
      Engine.master.gain.setValueAtTime(Math.max(Engine.master.gain.value, 0.0001), t);
      if (p) {
        Engine.master.gain.linearRampToValueAtTime(0.0001, t + 0.3);
        setTimeout(() => { if (this.paused) ctx.suspend(); }, 360);
      } else {
        ctx.resume().then(() => {
          const now = ctx.currentTime;
          Engine.master.gain.cancelScheduledValues(now);
          Engine.master.gain.setValueAtTime(0.0001, now);
          Engine.master.gain.linearRampToValueAtTime(vol, now + 0.3);
        });
      }
      this.emit('paused', this.paused);
    },

    /* ---------- energia ---------- */
    targetEnergy() {
      if (!this.autoEnergy) return this.manualEnergy;
      const mins = (Date.now() - this.plan.startMs) / 60000;
      const total = this.plan.durationMin || 0;
      const p = total > 0 ? clamp(mins / total, 0, 1) : (mins % 90) / 90;
      const base = curveAt(ARCS[this.plan.vibe] || ARCS.warmup, p);
      const wave = Math.sin(mins / 9 * Math.PI * 2) * 0.05;   // respiro naturale del set
      return clamp(base + wave, 0.05, 1);
    },

    sessionProgress() {
      const total = this.plan.durationMin || 0;
      if (!total) return ((Date.now() - this.plan.startMs) / 60000 % 90) / 90;
      return clamp((Date.now() - this.plan.startMs) / (total * 60000), 0, 1);
    },

    /* ---------- scelta del brano ---------- */
    makeCandidate(energy, fromTrack) {
      const p = Taste.profile;
      const key = fromTrack && fromTrack.kind === 'generated'
        ? C.relatedKeys(fromTrack.root, fromTrack.scale)[Math.floor(Math.random() * 5)]
        : null;
      // se gli ultimi due brani erano dello stesso genere, il DJ cambia aria
      const g2 = this.genreHistory.slice(-2);
      Taste.avoid = (g2.length === 2 && g2[0] === g2[1]) ? g2[0] : null;
      const genre = Taste.sampleGenre(energy);
      Taste.avoid = null;
      const bpmHint = fromTrack
        ? clamp(Transport.bpm + (Math.random() * 6 - 2) + (energy - 0.5) * 8, p.bpm[0] - 6, p.bpm[1] + 6)
        : clamp(p.bpm[0] + (p.bpm[1] - p.bpm[0]) * (0.2 + energy * 0.6), 60, 190);
      return C.makeTrack({
        genre,
        energy: energy + (Math.random() * 0.14 - 0.07),
        bpm: bpmHint,
        brightness: clamp(p.brightness + (Math.random() * 0.3 - 0.15), 0, 1),
        density: clamp(p.density + (Math.random() * 0.3 - 0.15), 0, 1),
        lengthPref: p.lengthPref,
        voice: p.voice,
        root: key ? key.root : undefined,
        scale: key ? key.scale : undefined
      });
    },

    planNext() {
      const energy = this.targetEnergy();
      const cur = this.decks[this.active].track;
      const cands = [];

      const p = Taste.profile;
      const sinceFile = this.trackCount - this.lastFileAt;
      const wantFile = p.useLibrary && this.library.length &&
        sinceFile >= Math.max(1, Math.round(1 / Math.max(0.08, p.mixRate)) - 1) &&
        Math.random() < p.mixRate + 0.15;

      if (wantFile) {
        const pool = this.library.filter(f => !this.history.slice(-4).some(h => h === f.id));
        const src = (pool.length ? pool : this.library);
        for (let i = 0; i < Math.min(3, src.length); i++) {
          cands.push(src[Math.floor(Math.random() * src.length)]);
        }
      }
      for (let i = 0; i < 5; i++) cands.push(this.makeCandidate(energy, cur));

      const chosen = Taste.choose(cands, 0.5);
      this.pending = chosen;
      this.emit('next', chosen);
      return chosen;
    },

    /* ---------- caricamento ---------- */
    loadOn(deckIdx, track, startStep) {
      const d = this.decks[deckIdx];
      if (track.kind === 'file') {
        // il tempo del set si adatta al brano, così il pitch resta naturale
        const p = Taste.profile;
        const tgt = clamp(track.srcBpm, p.bpm[0] - 8, p.bpm[1] + 8);
        const rate = clamp(tgt / track.srcBpm, 0.9, 1.12);
        const barDur = 4 * 60 / tgt;
        const playable = (track.duration - (track.offset || 0)) / rate;
        track.bars = clamp(Math.floor(playable / barDur) - 1, 8, 400);
        track.mixBars = clamp(Math.min(16, Math.floor(track.bars / 3)), 4, 32);
      } else {
        track.mixBars = clamp(Math.min(Taste.profile.mixLen, Math.floor(track.bars / 3)), 8, 64);
      }
      d.load(track, startStep);
      this.history.push(track.id);
      if (this.history.length > 30) this.history.shift();
      this.genreHistory.push(track.genre);
      if (this.genreHistory.length > 12) this.genreHistory.shift();
      this.trackCount++;
      if (track.kind === 'file') this.lastFileAt = this.trackCount;
      Taste.profile.stats.played++;
      return d;
    },

    /* ---------- loop principale ---------- */
    onStep(gstep, time) {
      for (let i = 0; i < this.decks.length; i++) this.decks[i].onStep(gstep, time);
      if (gstep % 16 !== 0) return;
      this.onBar(gstep, time);
    },

    onBar(gstep, time) {
      if (!this.running) return;

      // chiusura transizione: da qui in poi il deck attivo è quello entrante
      if (this.transition && gstep >= this.transition.endStep) {
        const outIdx = this.transition.from;
        this.decks[outIdx].stopAt(time + 0.2);
        this.active = this.transition.to;
        Transport.glideRate = 0.02;
        this.transition = null;
        this.emit('track', { deck: this.active, track: this.decks[this.active].track });
        this.log('Ora in pista: “' + this.decks[this.active].track.title + '”', 'track');
      }

      const cur = this.decks[this.active];
      if (!cur || !cur.track || !cur.playing) {
        // rete di sicurezza: non lasciare mai il silenzio
        if (!this.transition) this.recover(gstep, time);
        return;
      }

      const remaining = cur.remainingBars();
      const mixBars = cur.track.mixBars || 32;

      if (!this.transition) {
        if (!this.pending && remaining <= mixBars + 8) {
          const nx = this.planNext();
          this.log('Prossima: “' + nx.title + '” — ' + nx.genreName + ', ' + nx.bpm + ' BPM' +
            (nx.kind === 'file' ? ' (tuo brano)' : ', ' + nx.keyName), 'plan');
        }
        if (remaining <= mixBars) {
          this.beginTransition(this.pending || this.planNext(), gstep, time, null);
        }
      }

      // manutenzione: statistiche e salvataggio ogni 16 battute
      if (gstep % (16 * 16) === 0) {
        Taste.profile.stats.minutes = Math.round((Date.now() - this.plan.startMs) / 60000);
        Taste.save();
        Engine.resume();
      }
      this.emit('bar', { gstep, time });
    },

    recover(gstep, time) {
      const t = this.pending || this.makeCandidate(this.targetEnergy(), null);
      this.pending = null;
      const start = gstep + 16;
      this.loadOn(this.active, t, start);
      this.setFader(this.active, time);
      this.log('Ripresa del set con “' + t.title + '”', 'plan');
      this.emit('track', { deck: this.active, track: t });
    },

    /* ---------- transizioni ---------- */
    chooseTransition(fromT, toT, forced) {
      if (forced) return forced;
      const dBpm = Math.abs((toT.bpm || Transport.bpm) - Transport.bpm);
      const fx = Taste.profile.fx;
      if (dBpm > 9) return 'cut';
      if (!fx) return 'blend';
      const r = Math.random();
      if (toT.kind === 'file' || fromT.kind === 'file') return r < 0.5 ? 'sweep' : 'blend';
      if (r < 0.5) return 'blend';
      if (r < 0.8) return 'sweep';
      return 'echo';
    },

    beginTransition(nextTrack, gstep, time, forcedType) {
      const fromIdx = this.active;
      const toIdx = 1 - fromIdx;
      const fromDeck = this.decks[fromIdx];
      const toDeck = this.decks[toIdx];
      const fromT = fromDeck.track || { kind: 'generated', bpm: Transport.bpm };
      const type = this.chooseTransition(fromT, nextTrack, forcedType);

      let bars;
      if (type === 'cut') bars = 2;
      else if (type === 'echo') bars = 4;
      else if (type === 'sweep') bars = Math.max(8, Math.round((nextTrack.mixBars || 16) / 2));
      else bars = nextTrack.kind === 'file' ? 16 : clamp(Taste.profile.mixLen, 8, 64);

      const startStep = gstep;
      const endStep = gstep + bars * 16;
      const t0 = Math.max(time, Engine.ctx.currentTime + 0.05);
      const t1 = Transport.timeAt(endStep);
      const dur = Math.max(0.5, t1 - t0);

      this.loadOn(toIdx, nextTrack, startStep);
      // se siamo dentro la callback di questo 16esimo, il deck lo ha già mancato: lo eseguiamo a mano
      if (startStep === Transport.step) this.decks[toIdx].onStep(startStep, time);
      this.pending = null;

      // tempo: glide calibrato sulla durata della transizione
      const targetBpm = nextTrack.kind === 'file'
        ? clamp(nextTrack.srcBpm, Taste.profile.bpm[0] - 8, Taste.profile.bpm[1] + 8)
        : nextTrack.bpm;
      const steps = Math.max(1, bars * 16);
      if (type === 'cut') {
        // stacco netto: il tempo nuovo parte con la traccia nuova
        Transport.glideRate = 0.02;
        setTimeout(() => Transport.setBpm(targetBpm, true), Math.max(0, (t1 - Engine.ctx.currentTime) * 1000 - 40));
      } else {
        Transport.glideRate = Math.max(0.02, Math.abs(targetBpm - Transport.bpm) / steps);
        Transport.setBpm(targetBpm, false);
      }
      setTimeout(() => { Transport.swing = nextTrack.swing || 0; },
        Math.max(0, (t0 + dur * 0.5 - Engine.ctx.currentTime) * 1000));

      this.automate(type, this.decks[fromIdx].channel, this.decks[toIdx].channel, t0, dur, fromIdx, toIdx);

      this.transition = { from: fromIdx, to: toIdx, startStep, endStep, type, bars };
      this.emit('transition', { type, bars, from: fromIdx, to: toIdx, track: nextTrack });
      this.log('Mix ' + LABEL[type] + ' su ' + bars + ' battute → “' + nextTrack.title + '”', 'mix');
    },

    automate(type, chOut, chIn, t0, dur, fromIdx, toIdx) {
      const ctx = Engine.ctx;
      const N = 64;
      const outCurve = new Float32Array(N), inCurve = new Float32Array(N);

      for (let i = 0; i < N; i++) {
        let x = i / (N - 1);
        if (type === 'cut') x = x < 0.75 ? x / 0.75 * 0.85 : 1;       // taglio rapido
        if (type === 'echo') x = Math.pow(x, 0.6);
        outCurve[i] = Math.cos(x * Math.PI / 2);
        inCurve[i] = Math.sin(x * Math.PI / 2);
      }

      [[chOut.fader, outCurve], [chIn.fader, inCurve]].forEach(([param, curve]) => {
        param.gain.cancelScheduledValues(t0);
        param.gain.setValueAtTime(param.gain.value, t0);
        try { param.gain.setValueCurveAtTime(curve, t0, dur); }
        catch (e) { param.gain.linearRampToValueAtTime(curve[N - 1], t0 + dur); }
      });

      // gestione dei bassi: mai due casse sovrapposte a pieno volume
      const swapAt = t0 + dur * (type === 'blend' ? 0.55 : 0.4);
      chIn.low.gain.cancelScheduledValues(t0);
      chIn.low.gain.setValueAtTime(-26, t0);
      chIn.low.gain.linearRampToValueAtTime(-26, swapAt - Math.min(0.8, dur * 0.1));
      chIn.low.gain.linearRampToValueAtTime(0, swapAt + Math.min(1.2, dur * 0.12));
      chOut.low.gain.cancelScheduledValues(t0);
      chOut.low.gain.setValueAtTime(0, t0);
      chOut.low.gain.linearRampToValueAtTime(0, swapAt - Math.min(0.8, dur * 0.1));
      chOut.low.gain.linearRampToValueAtTime(-30, swapAt + Math.min(1.2, dur * 0.12));

      if (type === 'sweep') {
        chIn.hp.frequency.cancelScheduledValues(t0);
        chIn.hp.frequency.setValueAtTime(700, t0);
        chIn.hp.frequency.exponentialRampToValueAtTime(20, t0 + dur * 0.9);
        chOut.lp.frequency.cancelScheduledValues(t0);
        chOut.lp.frequency.setValueAtTime(20000, t0);
        chOut.lp.frequency.exponentialRampToValueAtTime(420, t0 + dur);
      }
      if (type === 'echo' || type === 'cut') {
        chOut.delRet.gain.cancelScheduledValues(t0);
        chOut.delRet.gain.setValueAtTime(0.8, t0);
        chOut.delRet.gain.linearRampToValueAtTime(1.4, t0 + dur * 0.3);
        chOut.delFb.gain.cancelScheduledValues(t0);
        chOut.delFb.gain.setValueAtTime(0.32, t0);
        chOut.delFb.gain.linearRampToValueAtTime(0.72, t0 + dur * 0.35);
        chOut.delFb.gain.linearRampToValueAtTime(0.1, t0 + dur + 1.2);
        chOut.lp.frequency.cancelScheduledValues(t0);
        chOut.lp.frequency.setValueAtTime(20000, t0);
        chOut.lp.frequency.exponentialRampToValueAtTime(900, t0 + dur);
        if (type === 'cut') DJ.V.impact(chIn, t0 + dur, { vel: 0.5 });
      }
      this.emit('xfade', { t0, dur, toIdx });
    },

    setFader(idx, time) {
      this.decks.forEach((d, i) => {
        const g = d.channel.fader.gain;
        g.cancelScheduledValues(time);
        g.setValueAtTime(i === idx ? 1 : 0, time);
      });
    },

    /* ---------- comandi ---------- */
    skip(reason) {
      if (!this.running) return;
      const cur = this.decks[this.active];
      if (!cur.track) return;
      if (this.transition) return;                      // già in transizione
      const next = this.pending || this.planNext();
      let gstep = (Math.floor(Transport.step / 16) + 1) * 16;
      if (Transport.timeAt(gstep) < Engine.ctx.currentTime + Transport.lookahead + 0.1) gstep += 16;
      const time = Transport.timeAt(gstep);
      this.beginTransition(next, gstep, time, reason === 'dislike' ? 'cut' : 'echo');
      this.log(reason === 'dislike' ? 'Capito, cambio registro.' : 'Salto avanti.', 'cmd');
    },

    like() {
      const t = this.decks[this.active].track;
      if (!t) return;
      Taste.reward(t, 1);
      Taste.profile.stats.likes++;
      Taste.save();
      this.log('❤ Segnato: più cose come “' + t.title + '” (' + t.genreName + ')', 'like');
      this.emit('taste');
    },

    dislike() {
      const t = this.decks[this.active].track;
      if (t) {
        Taste.reward(t, -1.1);
        Taste.profile.stats.skips++;
        Taste.save();
        this.log('👎 Evito ' + t.genreName + ' su questi toni.', 'dislike');
        this.emit('taste');
      }
      this.skip('dislike');
    },

    nudgeEnergy(delta) {
      this.autoEnergy = false;
      this.manualEnergy = clamp((this.autoEnergy ? this.targetEnergy() : this.manualEnergy) + delta, 0.05, 1);
      this.emit('energy', this.manualEnergy);
      this.log('Energia a ' + Math.round(this.manualEnergy * 100) + '%.', 'cmd');
    },

    setEnergy(v) {
      this.autoEnergy = false;
      this.manualEnergy = clamp(v, 0.02, 1);
      this.emit('energy', this.manualEnergy);
    },

    setAutoEnergy(on) {
      this.autoEnergy = !!on;
      this.emit('energy', this.targetEnergy());
      this.log(on ? 'Energia di nuovo in mano al DJ.' : 'Energia bloccata da te.', 'cmd');
    },

    addToLibrary(track) {
      this.library.push(track);
      this.emit('library', this.library);
    },

    removeFromLibrary(id) {
      this.library = this.library.filter(t => t.id !== id);
      this.emit('library', this.library);
    },

    currentTrack() { return this.decks.length ? this.decks[this.active].track : null; }
  };

  const LABEL = { blend: 'lungo', sweep: 'con filtro', echo: 'in echo', cut: 'a stacco' };

  DJ.Director = Director;
})(window.DJ);
