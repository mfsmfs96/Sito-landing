/* AURA DJ — analisi dei file dell'utente
   Decodifica in memoria, stima BPM (inviluppo di onset + autocorrelazione),
   trova il primo battere e il volume medio per allineare il brano al set.
   I file non lasciano mai il browser. */
(function (DJ) {
  'use strict';
  const { clamp } = DJ.util;
  const Engine = DJ.Engine;

  const HOP = 256;
  const MIN_BPM = 70, MAX_BPM = 190;

  function decode(file) {
    return file.arrayBuffer().then(ab => new Promise((res, rej) => {
      const p = Engine.ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    }));
  }

  /** inviluppo di onset: energia per hop, differenza rettificata */
  function onsetEnvelope(buffer, maxSeconds) {
    const sr = buffer.sampleRate;
    const n = Math.min(buffer.length, Math.floor(sr * (maxSeconds || 90)));
    const chs = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chs.push(buffer.getChannelData(c));
    const frames = Math.floor(n / HOP);
    const env = new Float32Array(frames);
    let prev = 0;
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const start = f * HOP;
      for (let i = 0; i < HOP; i += 2) {
        let v = 0;
        for (let c = 0; c < chs.length; c++) v += chs[c][start + i];
        v /= chs.length;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / (HOP / 2));
      env[f] = Math.max(0, rms - prev);
      prev = rms * 0.72 + prev * 0.28;   // inseguitore lento: mette in risalto gli attacchi
    }
    // normalizza
    let mx = 0;
    for (let i = 0; i < frames; i++) if (env[i] > mx) mx = env[i];
    if (mx > 0) for (let i = 0; i < frames; i++) env[i] /= mx;
    return { env, rate: sr / HOP };
  }

  function detectTempo(env, rate) {
    const minLag = Math.floor(rate * 60 / MAX_BPM);
    const maxLag = Math.ceil(rate * 60 / MIN_BPM);
    const n = env.length;
    if (n < maxLag * 2) return { bpm: 120, confidence: 0 };

    const scores = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0, count = 0;
      for (let i = 0; i + lag < n; i++) { s += env[i] * env[i + lag]; count++; }
      let v = count ? s / count : 0;
      // rinforza chi è coerente anche a 2 e 4 volte il periodo (battute intere)
      const l2 = lag * 2, l4 = lag * 4;
      if (l4 < n) {
        let s2 = 0, s4 = 0, c2 = 0, c4 = 0;
        for (let i = 0; i + l4 < n; i++) { s2 += env[i] * env[i + l2]; c2++; s4 += env[i] * env[i + l4]; c4++; }
        v = v * 0.6 + (c2 ? s2 / c2 : 0) * 0.25 + (c4 ? s4 / c4 : 0) * 0.15;
      }
      scores[lag] = v;
    }
    let best = minLag, bestV = -1;
    for (let lag = minLag; lag <= maxLag; lag++) if (scores[lag] > bestV) { bestV = scores[lag]; best = lag; }

    let bpm = 60 * rate / best;
    // correggi gli errori di ottava verso la fascia da ballo
    while (bpm < 84) bpm *= 2;
    while (bpm > 176) bpm /= 2;

    let mean = 0;
    for (let lag = minLag; lag <= maxLag; lag++) mean += scores[lag];
    mean /= (maxLag - minLag + 1);
    const confidence = mean > 0 ? clamp((bestV / mean - 1) / 2.5, 0, 1) : 0;
    return { bpm: Math.round(bpm * 10) / 10, confidence };
  }

  /** fase del primo battere: massimizza l'energia sulle posizioni di beat */
  function detectOffset(env, rate, bpm) {
    const period = rate * 60 / bpm;
    const n = env.length;
    let bestPhase = 0, bestScore = -1;
    const steps = Math.max(8, Math.floor(period));
    for (let p = 0; p < steps; p++) {
      let s = 0;
      for (let i = p; i < n; i += period) {
        const idx = Math.round(i);
        if (idx < n) s += env[idx] + 0.5 * (env[idx + 1] || 0) + 0.5 * (env[idx - 1] || 0);
      }
      if (s > bestScore) { bestScore = s; bestPhase = p; }
    }
    return bestPhase / rate;
  }

  function loudness(buffer, maxSeconds) {
    const d = buffer.getChannelData(0);
    const n = Math.min(d.length, Math.floor(buffer.sampleRate * (maxSeconds || 60)));
    let sum = 0, count = 0;
    for (let i = 0; i < n; i += 64) { sum += d[i] * d[i]; count++; }
    return Math.sqrt(sum / Math.max(1, count));
  }

  /** analizza un file e restituisce una "traccia" pronta per il deck */
  function analyze(file) {
    return decode(file).then(buffer => {
      const { env, rate } = onsetEnvelope(buffer, 90);
      const { bpm, confidence } = detectTempo(env, rate);
      const offset = detectOffset(env, rate, bpm);
      const rms = loudness(buffer, 60);
      const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ');
      return {
        id: 'f' + Math.random().toString(36).slice(2, 9),
        kind: 'file',
        title: name,
        genre: 'mine',
        genreName: 'Tuo brano',
        color: '#00e0c6',
        buffer,
        srcBpm: bpm,
        bpm: Math.round(bpm),
        confidence,
        offset,
        trim: clamp(0.14 / Math.max(rms, 0.01), 0.35, 2.2),
        duration: buffer.duration,
        energy: clamp(rms * 4.5, 0.15, 1),
        brightness: 0.5,
        density: 0.5,
        keyName: '—',
        fileName: file.name
      };
    });
  }

  DJ.Analysis = { analyze, detectTempo, onsetEnvelope };
})(window.DJ);
