/* AURA DJ — lo speaker
   Voce di sistema del browser (Web Speech API): annuncia i brani sopra il mix
   e abbassa la musica mentre parla, come in radio. Nessun servizio esterno.
   Nota: questo audio esce fuori dal mixer, quindi non prende gli effetti e
   non entra nella registrazione del set. */
(function (DJ) {
  'use strict';
  const { Engine } = DJ;

  const Speaker = {
    voices: [],
    voice: null,
    enabled: false,
    every: 2,          // annuncia un brano su N
    volume: 1,
    rate: 1,
    duckTo: 0.32,      // quanto scende la musica mentre parla
    speaking: false,
    hype: false,
    counter: 0,
    _primed: false,

    supported() {
      return typeof window !== 'undefined' &&
        'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    },

    init(onVoices) {
      if (!this.supported()) return false;
      const load = () => {
        this.voices = window.speechSynthesis.getVoices() || [];
        // le voci italiane prima, poi tutte le altre
        this.voices.sort((a, b) => (b.lang.indexOf('it') === 0) - (a.lang.indexOf('it') === 0));
        if (!this.voice && this.voices.length) this.voice = this.preferred();
        if (onVoices) onVoices(this.voices);
      };
      load();
      window.speechSynthesis.onvoiceschanged = load;
      return true;
    },

    preferred() {
      const it = this.voices.filter(v => v.lang && v.lang.toLowerCase().indexOf('it') === 0);
      if (it.length) {
        const local = it.find(v => v.localService);
        return local || it[0];
      }
      return this.voices[0] || null;
    },

    setVoice(name) {
      this.voice = this.voices.find(v => v.name === name) || this.voice;
    },

    /** la prima chiamata dentro il gesto dell'utente sblocca la sintesi su alcuni browser */
    prime() {
      if (this._primed || !this.supported()) return;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
        this._primed = true;
      } catch (e) {}
    },

    say(text, opts) {
      if (!this.supported() || !text) return false;
      opts = opts || {};
      const synth = window.speechSynthesis;
      if (opts.interrupt) synth.cancel();
      else if (this.speaking) return false;      // non si accavalla sopra se stesso

      let u;
      try { u = new SpeechSynthesisUtterance(text); } catch (e) { return false; }
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
      else u.lang = 'it-IT';
      u.volume = this.volume;
      u.rate = this.rate;
      u.pitch = opts.pitch != null ? opts.pitch : 1;

      const end = () => { this.speaking = false; this.duck(false); };
      u.onstart = () => { this.speaking = true; this.duck(true); };
      u.onend = end;
      u.onerror = end;

      try { synth.speak(u); } catch (e) { return false; }
      // rete di sicurezza: se onend non arriva (capita su alcuni browser) la musica torna su
      clearTimeout(this._guard);
      this._guard = setTimeout(end, Math.max(4000, text.length * 120));
      return true;
    },

    /** abbassa e rialza la musica sotto la voce */
    duck(on) {
      if (!Engine.ctx || !Engine.master) return;
      const D = DJ.Director;
      if (D && D.paused) return;
      const vol = (D && D.userVol != null) ? D.userVol : 0.8;
      const t = Engine.ctx.currentTime;
      const g = Engine.master.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.linearRampToValueAtTime(on ? vol * this.duckTo : vol, t + (on ? 0.25 : 0.6));
    },

    /* ---------- che cosa dice ---------- */
    phraseFor(track, first) {
      const g = track.genreName;
      if (track.kind === 'file') {
        return pick(first
          ? ['Si comincia con un pezzo tuo: ' + track.title + '.']
          : ['Un pezzo tuo: ' + track.title + '.',
             'Dalla tua libreria: ' + track.title + '.',
             'Questa la conosci: ' + track.title + '.']);
      }
      if (first) {
        return pick(['Si comincia. ' + track.title + ', ' + g + '.',
                     'Partiamo con ' + track.title + '. ' + g + ', ' + track.bpm + ' BPM.']);
      }
      return pick([
        'Adesso ' + track.title + '. ' + g + ', ' + track.bpm + ' BPM.',
        'Si cambia aria: ' + track.title + ', ' + g + '.',
        track.title + '. ' + g + '.',
        'Restiamo in pista con ' + track.title + '.',
        g + ' adesso: ' + track.title + '.'
      ]);
    },

    hypeLine() {
      return pick(['Si balla.', 'Tutti in pista.', 'Questo è il momento.', 'Non vi fermate.']);
    },

    /** chiamato dal regista a ogni mix: decide se parlare */
    announce(track, first) {
      if (!this.enabled || !track) return;
      this.counter++;
      if (!first && this.every > 0 && (this.counter % this.every) !== 0) return;
      if (this.every === 0 && !first) return;
      this.say(this.phraseFor(track, first));
    }
  };

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  DJ.Speaker = Speaker;
})(window.DJ);
