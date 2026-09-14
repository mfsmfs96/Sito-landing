/* AURA DJ — compositore
   Genera "ricette" di traccia complete (pattern, armonia, struttura, sound design)
   a partire da genere + energia + seme. Deterministico: stesso seme = stessa traccia. */
(function (DJ) {
  'use strict';
  const { clamp } = DJ.util;

  /* ---------- random deterministico ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const chance = (r, p) => r() < p;

  /* ---------- armonia ---------- */
  const SCALES = {
    minor:        [0, 2, 3, 5, 7, 8, 10],
    major:        [0, 2, 4, 5, 7, 9, 11],
    dorian:       [0, 2, 3, 5, 7, 9, 10],
    phrygian:     [0, 1, 3, 5, 7, 8, 10],
    lydian:       [0, 2, 4, 6, 7, 9, 11],
    mixolydian:   [0, 2, 4, 5, 7, 9, 10],
    harmonicMinor:[0, 2, 3, 5, 7, 8, 11]
  };
  const NOTE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const MODE_LABEL = { minor: 'min', major: 'maj', dorian: 'dor', phrygian: 'phr', lydian: 'lyd', mixolydian: 'mix', harmonicMinor: 'h.min' };

  const PROGS = {
    dark:   [[0, 0, 5, 4], [0, 6, 5, 4], [0, 5, 3, 4], [0, 0, 3, 4], [0, 4, 5, 3]],
    warm:   [[0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3], [3, 4, 0, 5], [0, 4, 5, 4]],
    bright: [[0, 4, 5, 3], [0, 3, 4, 4], [5, 3, 0, 4], [0, 5, 1, 4]],
    static: [[0, 0, 0, 0], [0, 0, 5, 5], [0, 0, 3, 3]]
  };

  function scaleNote(scaleName, root, degree, octave) {
    const sc = SCALES[scaleName] || SCALES.minor;
    const i = ((degree % 7) + 7) % 7;
    const o = Math.floor(degree / 7);
    return root + 12 * (octave + o) + sc[i];
  }
  function chordNotes(scaleName, root, degree, octave, size) {
    const steps = size >= 4 ? [0, 2, 4, 6] : [0, 2, 4];
    const notes = steps.map(s => scaleNote(scaleName, root, degree + s, octave));
    if (size >= 5) notes.push(scaleNote(scaleName, root, degree + 8, octave));
    return notes;
  }
  function keyLabel(root, scale) {
    return NOTE_NAMES[((root % 12) + 12) % 12] + ' ' + (MODE_LABEL[scale] || scale);
  }
  /** chiavi compatibili per il mix armonico: stessa, quinta, quarta, relativa */
  function relatedKeys(root, scale) {
    const minorish = scale !== 'major' && scale !== 'lydian' && scale !== 'mixolydian';
    return [
      { root, scale },
      { root: (root + 7) % 12, scale },
      { root: (root + 5) % 12, scale },
      { root: (root + (minorish ? 3 : 9)) % 12, scale: minorish ? 'major' : 'minor' },
      { root, scale: minorish ? 'dorian' : 'mixolydian' }
    ];
  }

  /* ---------- generi ---------- */
  /* ogni genere è un set di preferenze; i pattern veri vengono generati per traccia */
  const GENRES = {
    house: {
      name: 'House', color: '#ff9f43', bpm: [122, 127], energy: [0.35, 0.85],
      kick: 'four', clapOn: [4, 12], hats: 'offbeat', ohatOff: true, percAmt: 0.45,
      bassStyle: 'offbeat', bassWave: 'sawtooth', cutoff: [420, 1500], sub: 0.7,
      chordStyle: 'stab', chordSize: 4, prog: 'warm', scales: ['minor', 'dorian', 'major'],
      arp: 0.25, lead: 0.15, pad: 0.35, swing: 0.08, texture: null
    },
    deep: {
      name: 'Deep House', color: '#5ad2a0', bpm: [118, 124], energy: [0.25, 0.65],
      kick: 'four', clapOn: [4, 12], hats: 'offbeat', ohatOff: true, percAmt: 0.5,
      bassStyle: 'offbeat', bassWave: 'sawtooth', cutoff: [300, 900], sub: 0.9,
      chordStyle: 'pad', chordSize: 5, prog: 'warm', scales: ['dorian', 'minor'],
      arp: 0.2, lead: 0.1, pad: 0.7, swing: 0.12, texture: { freq: 2600, vel: 0.02 }
    },
    techno: {
      name: 'Techno', color: '#8f8fff', bpm: [130, 140], energy: [0.5, 1],
      kick: 'four', clapOn: [12], hats: 'sixteen', ohatOff: true, percAmt: 0.6,
      bassStyle: 'rolling', bassWave: 'square', cutoff: [280, 1100], sub: 0.6,
      chordStyle: 'stab', chordSize: 3, prog: 'dark', scales: ['minor', 'phrygian'],
      arp: 0.3, lead: 0.1, pad: 0.25, swing: 0, texture: null
    },
    melodic: {
      name: 'Melodic Techno', color: '#6ec8ff', bpm: [120, 126], energy: [0.4, 0.9],
      kick: 'four', clapOn: [12], hats: 'offbeat', ohatOff: true, percAmt: 0.4,
      bassStyle: 'rolling', bassWave: 'sawtooth', cutoff: [320, 1200], sub: 0.8,
      chordStyle: 'pad', chordSize: 4, prog: 'dark', scales: ['minor', 'harmonicMinor', 'dorian'],
      arp: 0.75, lead: 0.4, pad: 0.8, swing: 0, texture: null
    },
    afro: {
      name: 'Afro House', color: '#ffb05c', bpm: [118, 124], energy: [0.4, 0.85],
      kick: 'fourSync', clapOn: [12], hats: 'tribal', ohatOff: true, percAmt: 1,
      bassStyle: 'offbeat', bassWave: 'sawtooth', cutoff: [380, 1200], sub: 0.8,
      chordStyle: 'stab', chordSize: 4, prog: 'warm', scales: ['dorian', 'minor', 'mixolydian'],
      arp: 0.4, lead: 0.25, pad: 0.4, swing: 0.14, texture: null
    },
    disco: {
      name: 'Disco / Funk', color: '#ff6fae', bpm: [112, 120], energy: [0.4, 0.85],
      kick: 'four', clapOn: [4, 12], hats: 'sixteen', ohatOff: true, percAmt: 0.55,
      bassStyle: 'funk', bassWave: 'sawtooth', cutoff: [500, 1800], sub: 0.5,
      chordStyle: 'pluck', chordSize: 4, prog: 'bright', scales: ['major', 'mixolydian', 'dorian'],
      arp: 0.45, lead: 0.3, pad: 0.25, swing: 0.16, texture: null
    },
    nudisco: {
      name: 'Nu Disco', color: '#ffd166', bpm: [116, 122], energy: [0.4, 0.8],
      kick: 'four', clapOn: [4, 12], hats: 'offbeat', ohatOff: true, percAmt: 0.4,
      bassStyle: 'funk', bassWave: 'sawtooth', cutoff: [520, 1600], sub: 0.6,
      chordStyle: 'pluck', chordSize: 4, prog: 'bright', scales: ['major', 'mixolydian'],
      arp: 0.5, lead: 0.35, pad: 0.4, swing: 0.1, texture: null
    },
    synthwave: {
      name: 'Synthwave', color: '#ff5fd2', bpm: [98, 110], energy: [0.3, 0.7],
      kick: 'rock', clapOn: [4, 12], hats: 'eight', ohatOff: false, percAmt: 0.25,
      bassStyle: 'arpBass', bassWave: 'square', cutoff: [420, 1400], sub: 0.6,
      chordStyle: 'pad', chordSize: 4, prog: 'dark', scales: ['minor', 'harmonicMinor'],
      arp: 0.6, lead: 0.6, pad: 0.8, swing: 0, texture: null
    },
    lofi: {
      name: 'Lo‑fi', color: '#c0a68c', bpm: [76, 90], energy: [0.1, 0.4],
      kick: 'boombap', clapOn: [8], hats: 'swung', ohatOff: false, percAmt: 0.3,
      bassStyle: 'walk', bassWave: 'triangle', cutoff: [260, 700], sub: 0.9,
      chordStyle: 'pluck', chordSize: 5, prog: 'warm', scales: ['dorian', 'minor', 'major'],
      arp: 0.2, lead: 0.2, pad: 0.5, swing: 0.28, texture: { freq: 4200, vel: 0.05, q: 0.4 }
    },
    dnb: {
      name: 'Drum & Bass', color: '#67ffa8', bpm: [170, 176], energy: [0.6, 1],
      kick: 'break', clapOn: [10], hats: 'sixteen', ohatOff: true, percAmt: 0.5,
      bassStyle: 'reese', bassWave: 'sawtooth', cutoff: [220, 900], sub: 1,
      chordStyle: 'stab', chordSize: 4, prog: 'dark', scales: ['minor', 'phrygian'],
      arp: 0.3, lead: 0.2, pad: 0.4, swing: 0, texture: null
    },
    trance: {
      name: 'Trance', color: '#7c5cff', bpm: [134, 140], energy: [0.6, 1],
      kick: 'four', clapOn: [4, 12], hats: 'offbeat', ohatOff: true, percAmt: 0.35,
      bassStyle: 'rolling', bassWave: 'sawtooth', cutoff: [300, 1000], sub: 0.7,
      chordStyle: 'pad', chordSize: 4, prog: 'bright', scales: ['minor', 'major'],
      arp: 0.9, lead: 0.7, pad: 0.9, swing: 0, texture: null
    },
    ambient: {
      name: 'Ambient', color: '#9fb4c7', bpm: [66, 84], energy: [0, 0.3],
      kick: 'none', clapOn: [], hats: 'none', ohatOff: false, percAmt: 0.1,
      bassStyle: 'drone', bassWave: 'triangle', cutoff: [200, 600], sub: 1,
      chordStyle: 'pad', chordSize: 5, prog: 'static', scales: ['lydian', 'dorian', 'major', 'minor'],
      arp: 0.25, lead: 0.2, pad: 1, swing: 0, texture: { freq: 1800, vel: 0.03, q: 0.3 }
    }
  };
  const GENRE_KEYS = Object.keys(GENRES);

  /* ---------- pattern di batteria ---------- */
  function kickPattern(style, r, energy) {
    const p = new Array(16).fill(0);
    switch (style) {
      case 'none': break;
      case 'four':
        [0, 4, 8, 12].forEach(i => p[i] = 1);
        if (chance(r, 0.25 * energy)) p[14] = 0.7;
        if (chance(r, 0.18 * energy)) p[10] = 0.6;
        break;
      case 'fourSync':
        [0, 4, 8, 12].forEach(i => p[i] = 1);
        if (chance(r, 0.6)) p[7] = 0.55;
        if (chance(r, 0.4)) p[15] = 0.5;
        break;
      case 'rock':
        p[0] = 1; p[6] = 0.8; p[8] = 0.6; p[10] = 0.85;
        break;
      case 'boombap':
        p[0] = 1; p[7] = 0.75; p[10] = 0.6;
        if (chance(r, 0.4)) p[14] = 0.5;
        break;
      case 'break':
        p[0] = 1; p[10] = 0.9;
        if (chance(r, 0.5)) p[6] = 0.5;
        break;
    }
    return p;
  }

  function hatPattern(style, r, density) {
    const p = new Array(16).fill(0);
    switch (style) {
      case 'none': break;
      case 'offbeat':
        [2, 6, 10, 14].forEach(i => p[i] = 0.5);
        for (let i = 0; i < 16; i++) if (i % 2 === 0 && chance(r, 0.25 * density)) p[i] = 0.3;
        break;
      case 'eight':
        for (let i = 0; i < 16; i += 2) p[i] = i % 4 === 0 ? 0.55 : 0.4;
        break;
      case 'sixteen':
        for (let i = 0; i < 16; i++) p[i] = (i % 4 === 0) ? 0.55 : (i % 2 === 0 ? 0.4 : 0.28);
        break;
      case 'swung':
        [0, 3, 4, 7, 8, 11, 12, 15].forEach(i => p[i] = i % 4 === 0 ? 0.5 : 0.3);
        break;
      case 'tribal':
        for (let i = 0; i < 16; i++) if (chance(r, 0.35 + 0.35 * density)) p[i] = 0.25 + r() * 0.3;
        [2, 6, 10, 14].forEach(i => p[i] = Math.max(p[i], 0.45));
        break;
    }
    return p;
  }

  function percPattern(r, amount, density) {
    const p = new Array(16).fill(0);
    if (amount <= 0) return p;
    const hits = Math.round((2 + r() * 5) * amount * (0.6 + density * 0.8));
    const spots = [3, 6, 7, 10, 11, 13, 14, 15, 2, 5, 9];
    for (let i = 0; i < hits; i++) {
      const s = spots[Math.floor(r() * spots.length)];
      p[s] = 0.25 + r() * 0.4;
    }
    return p;
  }

  /* ---------- basso ---------- */
  function bassPattern(style, r, density, energy) {
    // eventi {step, len(in 16esimi), degOff}
    const ev = [];
    const push = (step, len, degOff, vel) => ev.push({ step, len, degOff: degOff || 0, vel: vel || 0.85 });
    switch (style) {
      case 'drone':
        push(0, 16, 0, 0.7);
        break;
      case 'offbeat':
        [2, 6, 10, 14].forEach(s => push(s, 2, 0, 0.85));
        if (chance(r, 0.4 * density)) push(7, 1, chance(r, 0.5) ? 2 : 4, 0.6);
        break;
      case 'rolling':
        for (let s = 0; s < 16; s += 2) push(s, 1.6, 0, s % 4 === 0 ? 0.9 : 0.7);
        if (chance(r, 0.5)) { ev.forEach((e, i) => { if (i % 4 === 3) e.degOff = chance(r, 0.5) ? 2 : -3; }); }
        break;
      case 'funk': {
        const spots = [0, 3, 6, 7, 10, 13, 14];
        spots.forEach(s => { if (chance(r, 0.55 + 0.3 * density)) push(s, 1.4, chance(r, 0.3) ? pick(r, [2, 4, -3]) : 0, 0.8); });
        push(0, 1.4, 0, 0.95);
        break;
      }
      case 'walk': {
        [0, 6, 8, 14].forEach((s, i) => push(s, 3, i === 0 ? 0 : pick(r, [0, 2, 4, -3]), 0.75));
        break;
      }
      case 'arpBass':
        for (let s = 0; s < 16; s += 2) push(s, 1.6, [0, 4, 7 - 7, 2][(s / 2) % 4], 0.8);
        break;
      case 'reese':
        push(0, 8, 0, 0.9); push(8, 6, chance(r, 0.5) ? 0 : -3, 0.85);
        break;
      default:
        [0, 8].forEach(s => push(s, 4, 0, 0.8));
    }
    if (energy > 0.8 && style !== 'drone' && chance(r, 0.4)) push(15, 1, 5, 0.6);
    return ev;
  }

  /* ---------- struttura ---------- */
  function buildStructure(r, energy, genre, lengthPref) {
    const long = lengthPref > 0.66, short = lengthPref < 0.34;
    const unit = short ? 8 : (long ? 16 : 8);
    const s = [];
    const add = (type, bars) => s.push({ type, bars });

    if (genre.kick === 'none') {          // ambient: forma libera
      add('intro', unit * 2); add('main', unit * 3); add('break', unit * 2);
      add('main', unit * 3); add('outro', unit * 2);
      return s;
    }
    add('intro', short ? 8 : 16);
    add('build', 8);
    add('drop', long ? 32 : 16);
    add('main', long ? 32 : 16);
    add('break', energy > 0.75 ? 8 : 16);
    add('build', 8);
    add('drop', long ? 32 : 24);
    if (long) add('main', 16);
    add('outro', short ? 8 : 16);
    return s;
  }

  /* strati attivi per tipo di sezione */
  const LAYERS = {
    intro: { kick: 0.6, hat: 1, perc: 0.7, bass: 0.35, chord: 0.5, pad: 1, arp: 0.3, lead: 0, snare: 0.3 },
    build: { kick: 1, hat: 1, perc: 1, bass: 0.8, chord: 0.7, pad: 1, arp: 0.9, lead: 0.3, snare: 0.8 },
    drop:  { kick: 1, hat: 1, perc: 1, bass: 1, chord: 1, pad: 0.7, arp: 1, lead: 1, snare: 1 },
    main:  { kick: 1, hat: 1, perc: 1, bass: 1, chord: 0.9, pad: 0.6, arp: 0.7, lead: 0.5, snare: 1 },
    break: { kick: 0, hat: 0.4, perc: 0.6, bass: 0.2, chord: 1, pad: 1, arp: 0.8, lead: 0.7, snare: 0.2 },
    outro: { kick: 1, hat: 0.9, perc: 0.8, bass: 0.5, chord: 0.3, pad: 0.6, arp: 0.2, lead: 0, snare: 0.6 }
  };

  /* ---------- titoli ---------- */
  const W1 = ['Neon', 'Velluto', 'Midnight', 'Sale', 'Cobalto', 'Aurora', 'Vetro', 'Fosforo', 'Marea', 'Ombra',
    'Zenith', 'Lume', 'Prisma', 'Nebbia', 'Elettra', 'Vertigo', 'Sabbia', 'Cromo', 'Eco', 'Solaris',
    'Static', 'Indaco', 'Miraggio', 'Kinetic', 'Ottone', 'Polvere', 'Delta', 'Meridiana'];
  const W2 = ['Drive', 'Circuito', 'Orizzonte', 'Rituale', 'Corrente', 'Riflesso', 'Machine', 'Sogno', 'Traccia', 'Fuoco',
    'Pulse', 'Sequenza', 'Deriva', 'Frequenza', 'Danza', 'Motion', 'Alba', 'Segnale', 'Camera', 'Loop',
    'Teoria', 'Vortice', 'Notturno', 'Fase'];
  function makeTitle(r) {
    let t = pick(r, W1) + ' ' + pick(r, W2);
    if (chance(r, 0.16)) t += ' (' + pick(r, ['reprise', 'extended', 'dub', 'notturno', 'rework', 'live take']) + ')';
    return t;
  }

  /* ---------- generazione traccia ---------- */
  function makeTrack(opt) {
    opt = opt || {};
    const seed = opt.seed != null ? opt.seed : Math.floor(Math.random() * 1e9);
    const r = rng(seed);
    const key = opt.genre && GENRES[opt.genre] ? opt.genre : pick(r, GENRE_KEYS);
    const G = GENRES[key];

    const energy = clamp(opt.energy != null ? opt.energy : 0.5, 0, 1);
    // l'energia richiesta viene ricondotta nel range del genere
    const gE = clamp(energy, G.energy[0], G.energy[1]);
    const brightness = clamp(opt.brightness != null ? opt.brightness : 0.5, 0, 1);
    const density = clamp(opt.density != null ? opt.density : 0.5, 0, 1);
    const lengthPref = clamp(opt.lengthPref != null ? opt.lengthPref : 0.5, 0, 1);

    const bpm = Math.round(opt.bpm != null
      ? clamp(opt.bpm, G.bpm[0] - 4, G.bpm[1] + 4)
      : G.bpm[0] + (G.bpm[1] - G.bpm[0]) * (0.3 + gE * 0.7));

    const scale = opt.scale || pick(r, G.scales);
    const root = opt.root != null ? opt.root : Math.floor(r() * 12);

    const prog = pick(r, PROGS[G.prog] || PROGS.warm);
    const chordSize = G.chordSize + (brightness > 0.7 && chance(r, 0.4) ? 1 : 0);

    const cutBase = G.cutoff[0] + (G.cutoff[1] - G.cutoff[0]) * (0.25 + brightness * 0.75);

    const track = {
      id: 'g' + seed.toString(36),
      kind: 'generated',
      seed,
      genre: key,
      genreName: G.name,
      color: G.color,
      title: makeTitle(r),
      bpm,
      root, scale,
      keyName: keyLabel(root, scale),
      energy: gE, brightness, density,
      swing: G.swing * (0.6 + r() * 0.8),
      structure: buildStructure(r, gE, G, lengthPref),
      prog,
      chordSize,
      sound: {
        kickTune: 0.9 + r() * 0.3,
        kickDecay: 0.28 + (1 - gE) * 0.25,
        bassWave: G.bassWave,
        bassCutoff: cutBase,
        bassSub: G.sub,
        bassReso: 3 + r() * 5,
        chordCutoff: 900 + brightness * 4200,
        chordStyle: G.chordStyle,
        detune: key === 'dnb' ? 18 : 0,
        texture: G.texture
      },
      patterns: {
        kick: kickPattern(G.kick, r, gE),
        hat: hatPattern(G.hats, r, density),
        ohat: G.ohatOff ? [2, 6, 10, 14] : [],
        perc: percPattern(r, G.percAmt, density),
        snare: (G.clapOn || []).slice(),
        bass: bassPattern(G.bassStyle, r, density, gE),
        arpOn: chance(r, G.arp * (0.5 + gE * 0.8)),
        leadOn: chance(r, G.lead * (0.4 + gE)),
        padOn: chance(r, G.pad * 1.1),
        arpRate: pick(r, [2, 2, 1, 4]),
        arpShape: pick(r, ['up', 'updown', 'random', 'octave'])
      }
    };

    track.bars = track.structure.reduce((a, s) => a + s.bars, 0);
    track.durationSec = track.bars * 4 * (60 / bpm);
    return track;
  }

  DJ.Composer = {
    GENRES, GENRE_KEYS, SCALES, LAYERS, NOTE_NAMES,
    makeTrack, scaleNote, chordNotes, keyLabel, relatedKeys, rng, makeTitle
  };
})(window.DJ);
