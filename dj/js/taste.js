/* AURA DJ — profilo di gusto
   Due livelli: le preferenze dichiarate (slider) e quelle apprese dai 👍/👎
   e da quanto lasci suonare una traccia. Tutto in localStorage, niente server. */
(function (DJ) {
  'use strict';
  const { clamp } = DJ.util;
  const C = DJ.Composer;
  const KEY = 'aura-dj-taste-v1';

  const DEFAULTS = () => ({
    genres: {
      house: 0.7, deep: 0.6, techno: 0.4, melodic: 0.6, afro: 0.5, disco: 0.5,
      nudisco: 0.5, synthwave: 0.35, lofi: 0.3, dnb: 0.2, trance: 0.3, ambient: 0.2
    },
    learned: {},
    bpm: [112, 132],
    brightness: 0.5,
    density: 0.5,
    lengthPref: 0.5,
    mixLen: 32,
    fx: true,
    useLibrary: true,
    mixRate: 0.33,
    voice: 0.5,
    mc: { on: false, every: 2, volume: 1, rate: 1, duck: 0.32, hype: false, voiceName: null },
    stats: { likes: 0, skips: 0, played: 0, minutes: 0 }
  });

  const Taste = {
    profile: DEFAULTS(),

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw);
          const d = DEFAULTS();
          this.profile = Object.assign(d, p);
          this.profile.genres = Object.assign(d.genres, p.genres || {});
          this.profile.stats = Object.assign(d.stats, p.stats || {});
          this.profile.mc = Object.assign(d.mc, p.mc || {});
          this.profile.learned = p.learned || {};
        }
      } catch (e) { /* profilo di default */ }
      return this.profile;
    },

    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.profile)); } catch (e) {}
    },

    reset() {
      this.profile = DEFAULTS();
      this.save();
    },

    /* --- caratteristiche di una traccia, usate per imparare --- */
    features(track) {
      const bpmBand = 'bpm:' + (Math.round(track.bpm / 6) * 6);
      const f = ['g:' + track.genre, bpmBand];
      if (track.kind === 'generated') {
        f.push('br:' + band(track.brightness), 'de:' + band(track.density), 'sc:' + track.scale,
               'en:' + band(track.energy));
      } else {
        f.push('mine:1');
      }
      return f;
    },

    score(track) {
      const p = this.profile;
      let s = (p.genres[track.genre] != null ? p.genres[track.genre] : 0.4) * 2.2;
      if (track.kind === 'file') s += 0.5 + (p.mixRate - 0.33);
      this.features(track).forEach(f => { s += (p.learned[f] || 0); });
      // penalizza chi esce dai confini dichiarati
      const [lo, hi] = p.bpm;
      if (track.bpm < lo) s -= (lo - track.bpm) * 0.06;
      if (track.bpm > hi) s -= (track.bpm - hi) * 0.06;
      return s;
    },

    /** premio/punizione: amount positivo = di più così */
    reward(track, amount) {
      if (!track) return;
      const p = this.profile;
      const feats = this.features(track);
      const per = amount / Math.sqrt(feats.length);
      feats.forEach(f => {
        p.learned[f] = clamp((p.learned[f] || 0) * 0.995 + per, -1.6, 1.6);
      });
      // il genere si muove anche negli slider visibili, più lentamente
      if (p.genres[track.genre] != null) {
        p.genres[track.genre] = clamp(p.genres[track.genre] + amount * 0.09, 0.02, 1);
      }
      if (track.kind === 'generated') {
        p.brightness = clamp(p.brightness + (track.brightness - p.brightness) * amount * 0.12, 0, 1);
        p.density = clamp(p.density + (track.density - p.density) * amount * 0.12, 0, 1);
      }
      this.save();
    },

    /** scelta morbida: preferisce i punteggi alti senza essere prevedibile */
    choose(candidates, temperature) {
      const T = temperature || 0.55;
      const scored = candidates.map(c => ({ c, s: this.score(c) }));
      const max = Math.max.apply(null, scored.map(x => x.s));
      let total = 0;
      scored.forEach(x => { x.w = Math.exp((x.s - max) / T); total += x.w; });
      let r = Math.random() * total;
      for (let i = 0; i < scored.length; i++) {
        r -= scored[i].w;
        if (r <= 0) return scored[i].c;
      }
      return scored[scored.length - 1].c;
    },

    /** genere estratto secondo le preferenze, filtrato per energia richiesta */
    sampleGenre(energy) {
      const p = this.profile;
      const [lo, hi] = p.bpm;
      const fits = k => {
        const g = C.GENRES[k];
        return g.bpm[1] >= lo - 6 && g.bpm[0] <= hi + 6;          // il tempo dichiarato comanda
      };
      const suits = k => {
        const g = C.GENRES[k];
        return energy >= g.energy[0] - 0.22 && energy <= g.energy[1] + 0.22;
      };
      let keys = C.GENRE_KEYS.filter(k => fits(k) && suits(k));
      if (!keys.length) keys = C.GENRE_KEYS.filter(fits);
      if (!keys.length) keys = C.GENRE_KEYS.filter(suits);
      const pool = keys.length ? keys : C.GENRE_KEYS;
      if (this.avoid && pool.length > 2) {
        const varied = pool.filter(k => k !== this.avoid);
        if (varied.length) return weighted(varied, p);
      }
      let total = 0;
      const ws = pool.map(k => {
        const w = Math.pow(Math.max(0.02, p.genres[k] != null ? p.genres[k] : 0.3), 2.1);
        total += w; return w;
      });
      let r = Math.random() * total;
      for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
      return pool[0];
    },

    topLearned(n) {
      const p = this.profile;
      return Object.keys(p.learned)
        .map(k => ({ k, v: p.learned[k] }))
        .filter(x => Math.abs(x.v) > 0.08)
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
        .slice(0, n || 8);
    }
  };

  function band(v) { return v < 0.34 ? 'lo' : (v < 0.67 ? 'mid' : 'hi'); }

  /* estrazione pesata su un insieme di generi */
  function weighted(pool, p) {
    let total = 0;
    const ws = pool.map(k => {
      const w = Math.pow(Math.max(0.02, p.genres[k] != null ? p.genres[k] : 0.3), 2.1);
      total += w; return w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
    return pool[0];
  }

  DJ.Taste = Taste;
})(window.DJ);
