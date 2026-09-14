/* AURA DJ — interfaccia */
(function (DJ) {
  'use strict';
  const { Engine, Transport, util } = DJ;
  const { clamp } = util;
  const C = DJ.Composer, Taste = DJ.Taste, D = DJ.Director;

  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const fmt = s => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
  };

  Taste.load();
  let started = false, vizOn = true, beatPulse = 0, lastBar = -1, lastSection = null;

  /* ================= BOOT ================= */
  function buildBootChips() {
    const box = $('#bootGenres');
    box.innerHTML = '';
    C.GENRE_KEYS.forEach(k => {
      const g = C.GENRES[k];
      const b = document.createElement('button');
      b.className = 'chip' + (Taste.profile.genres[k] >= 0.5 ? ' on' : '');
      b.textContent = g.name;
      b.style.setProperty('--c', g.color);
      b.addEventListener('click', () => {
        const on = b.classList.toggle('on');
        Taste.profile.genres[k] = on ? 0.8 : 0.12;
        Taste.save();
        renderGenreList();
      });
      box.appendChild(b);
    });
  }

  function boot() {
    if (started) return;
    started = true;
    Engine.init();
    Engine.resume();
    Sp.prime();
    D.plan.vibe = $('#bootVibe').value;
    D.start({ durationMin: parseInt($('#bootDuration').value, 10), vibe: $('#bootVibe').value });
    applyMixer();   // i canali dei deck esistono solo dopo l'avvio
    $('#boot').classList.add('gone');
    setTimeout(() => $('#boot').remove(), 600);
    requestWakeLock();
    requestAnimationFrame(frame);
  }
  $('#bootStart').addEventListener('click', boot);

  /* ================= PANNELLI ================= */
  $$('.rt').forEach(b => b.addEventListener('click', () => {
    $$('.rt').forEach(x => x.classList.remove('active'));
    $$('.panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#panel-' + b.dataset.panel).classList.add('active');
  }));
  $('#panelBtn').addEventListener('click', () => $('#rack').classList.toggle('open'));

  /* ================= GUSTI ================= */
  function renderGenreList() {
    const box = $('#genreList');
    box.innerHTML = '';
    C.GENRE_KEYS.forEach(k => {
      const g = C.GENRES[k];
      const row = document.createElement('div');
      row.className = 'genre-row';
      row.innerHTML =
        '<span class="gname" style="--c:' + g.color + '">' + g.name + '</span>' +
        '<input type="range" min="0" max="100" value="' + Math.round((Taste.profile.genres[k] || 0) * 100) + '">' +
        '<span class="gval">' + Math.round((Taste.profile.genres[k] || 0) * 100) + '</span>';
      const inp = row.querySelector('input');
      inp.addEventListener('input', () => {
        Taste.profile.genres[k] = inp.value / 100;
        row.querySelector('.gval').textContent = inp.value;
        Taste.save();
      });
      box.appendChild(row);
    });
    renderLearned();
  }

  const FEAT_LABEL = {
    g: 'genere', bpm: 'tempo', br: 'luminosità', de: 'densità', sc: 'scala', en: 'energia', mine: 'i tuoi brani'
  };
  const VAL_LABEL = { lo: 'bassa', mid: 'media', hi: 'alta', '1': '' };
  const SCALE_LABEL = {
    minor: 'minore', major: 'maggiore', dorian: 'dorica', phrygian: 'frigia',
    lydian: 'lidia', mixolydian: 'misolidia', harmonicMinor: 'minore armonica'
  };
  function renderLearned() {
    const box = $('#learned');
    const top = Taste.topLearned(10);
    const st = Taste.profile.stats;
    if (!top.length) {
      box.innerHTML = '<p class="hint">Ancora niente. Metti 👍 o 👎 mentre suona e qui comparirà quello che ho capito di te.</p>';
    } else {
      box.innerHTML = top.map(x => {
        const [kind, val] = x.k.split(':');
        const name = kind === 'g' ? (C.GENRES[val] ? C.GENRES[val].name : val)
          : kind === 'bpm' ? val + ' BPM'
            : kind === 'sc' ? 'scala ' + (SCALE_LABEL[val] || val)
              : kind === 'mine' ? 'i tuoi brani'
                : (FEAT_LABEL[kind] || kind) + ' ' + (VAL_LABEL[val] || val);
        const w = Math.round(Math.abs(x.v) * 62);
        return '<div class="lrow ' + (x.v > 0 ? 'pos' : 'neg') + '">' +
          '<span>' + (x.v > 0 ? '▲' : '▼') + ' ' + name + '</span>' +
          '<i style="width:' + w + '%"></i></div>';
      }).join('');
    }
    box.insertAdjacentHTML('beforeend',
      '<p class="hint">' + st.likes + ' ❤ · ' + st.skips + ' 👎 · ' + st.played + ' brani suonati</p>');
  }

  function bindRange(id, get, set, fmtv) {
    const el = $(id), out = $(id + 'Val') || $('#' + el.id + 'Val');
    const paint = () => { if (out) out.textContent = fmtv ? fmtv(el.value) : el.value; };
    el.value = get();
    paint();
    el.addEventListener('input', () => { set(el.value); paint(); Taste.save(); });
    return el;
  }

  function initTastePanel() {
    renderGenreList();
    const bmin = $('#bpmMin'), bmax = $('#bpmMax');
    bmin.value = Taste.profile.bpm[0]; bmax.value = Taste.profile.bpm[1];
    const paintBpm = () => {
      let lo = Math.min(+bmin.value, +bmax.value - 4), hi = Math.max(+bmax.value, +bmin.value + 4);
      Taste.profile.bpm = [lo, hi];
      $('#bpmRangeVal').textContent = lo + '–' + hi;
      Taste.save();
    };
    bmin.addEventListener('input', paintBpm); bmax.addEventListener('input', paintBpm);
    paintBpm();

    bindRange('#bright', () => Taste.profile.brightness * 100, v => Taste.profile.brightness = v / 100);
    bindRange('#dens', () => Taste.profile.density * 100, v => Taste.profile.density = v / 100);
    bindRange('#trackLen', () => Taste.profile.lengthPref * 100, v => Taste.profile.lengthPref = v / 100,
      v => v < 34 ? 'corta' : (v > 66 ? 'lunga' : 'media'));
    bindRange('#mixLen', () => Taste.profile.mixLen, v => Taste.profile.mixLen = +v, v => v + ' battute');
    bindRange('#mixRate', () => Taste.profile.mixRate * 100, v => Taste.profile.mixRate = v / 100,
      v => v < 8 ? 'quasi mai' : '1 su ' + Math.max(2, Math.round(100 / Math.max(1, v))));

    $('#fxAllowed').checked = Taste.profile.fx;
    $('#fxAllowed').addEventListener('change', e => { Taste.profile.fx = e.target.checked; Taste.save(); });
    $('#useLibrary').checked = Taste.profile.useLibrary;
    $('#useLibrary').addEventListener('change', e => { Taste.profile.useLibrary = e.target.checked; Taste.save(); });

    $('#resetTaste').addEventListener('click', () => {
      Taste.reset();
      buildBootChips(); initTastePanel();
      D.log('Gusti azzerati: riparto da zero.', 'cmd');
    });
  }

  /* ================= VOCE ================= */
  const Sp = DJ.Speaker;

  function initVoicePanel() {
    // quanta voce nei brani generati
    const amt = $('#voiceAmt');
    amt.value = Math.round(Taste.profile.voice * 100);
    $('#voiceAmtVal').textContent = amt.value;
    amt.addEventListener('input', () => {
      Taste.profile.voice = amt.value / 100;
      $('#voiceAmtVal').textContent = amt.value;
      Taste.save();
    });

    const mc = Taste.profile.mc;
    const sel = $('#mcVoice');

    if (!Sp.supported()) {
      $('#mcStatus').textContent = 'Questo browser non ha la sintesi vocale: lo speaker non è disponibile.';
      ['#mcOn', '#mcVoice', '#mcEvery', '#mcVol', '#mcRate', '#mcDuck', '#mcHype', '#mcTest']
        .forEach(id => { $(id).disabled = true; });
      return;
    }

    const fillVoices = voices => {
      sel.innerHTML = '';
      if (!voices.length) {
        $('#mcStatus').textContent = 'Nessuna voce installata sul dispositivo: lo speaker resta muto.';
        sel.innerHTML = '<option>nessuna voce disponibile</option>';
        return;
      }
      voices.forEach(v => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = v.name + ' · ' + v.lang;
        sel.appendChild(o);
      });
      if (mc.voiceName) Sp.setVoice(mc.voiceName);
      if (Sp.voice) sel.value = Sp.voice.name;
      const italiane = voices.filter(v => v.lang && v.lang.toLowerCase().indexOf('it') === 0).length;
      $('#mcStatus').textContent = italiane
        ? italiane + ' voci italiane disponibili su questo dispositivo.'
        : 'Nessuna voce italiana installata: leggerà con accento straniero.';
    };

    Sp.init(fillVoices);
    fillVoices(Sp.voices);

    sel.addEventListener('change', () => {
      Sp.setVoice(sel.value);
      mc.voiceName = sel.value;
      Taste.save();
    });

    Sp.enabled = !!mc.on; $('#mcOn').checked = !!mc.on;
    $('#mcOn').addEventListener('change', e => {
      Sp.enabled = e.target.checked; mc.on = Sp.enabled; Taste.save();
      D.log(Sp.enabled ? 'Speaker acceso.' : 'Speaker spento.', 'cmd');
      if (!Sp.enabled) { try { speechSynthesis.cancel(); } catch (err) {} Sp.duck(false); }
    });

    const everyLabel = v => +v === 0 ? 'mai da solo' : (+v === 1 ? 'ogni brano' : 'un brano su ' + v);
    Sp.every = mc.every; $('#mcEvery').value = mc.every; $('#mcEveryVal').textContent = everyLabel(mc.every);
    $('#mcEvery').addEventListener('input', e => {
      Sp.every = +e.target.value; mc.every = Sp.every;
      $('#mcEveryVal').textContent = everyLabel(e.target.value); Taste.save();
    });

    Sp.volume = mc.volume; $('#mcVol').value = Math.round(mc.volume * 100); $('#mcVolVal').textContent = $('#mcVol').value;
    $('#mcVol').addEventListener('input', e => {
      Sp.volume = e.target.value / 100; mc.volume = Sp.volume;
      $('#mcVolVal').textContent = e.target.value; Taste.save();
    });

    Sp.rate = mc.rate; $('#mcRate').value = Math.round(mc.rate * 100);
    $('#mcRateVal').textContent = (mc.rate).toFixed(1) + '×';
    $('#mcRate').addEventListener('input', e => {
      Sp.rate = e.target.value / 100; mc.rate = Sp.rate;
      $('#mcRateVal').textContent = Sp.rate.toFixed(1) + '×'; Taste.save();
    });

    Sp.duckTo = mc.duck; $('#mcDuck').value = Math.round(mc.duck * 100); $('#mcDuckVal').textContent = $('#mcDuck').value;
    $('#mcDuck').addEventListener('input', e => {
      Sp.duckTo = e.target.value / 100; mc.duck = Sp.duckTo;
      $('#mcDuckVal').textContent = e.target.value; Taste.save();
    });

    Sp.hype = !!mc.hype; $('#mcHype').checked = Sp.hype;
    $('#mcHype').addEventListener('change', e => { Sp.hype = e.target.checked; mc.hype = Sp.hype; Taste.save(); });

    $('#mcTest').addEventListener('click', () => {
      Sp.prime();
      const t = D.currentTrack();
      const ok = Sp.say(t ? Sp.phraseFor(t, false) : 'Sono il tuo DJ. Quando vuoi, si parte.', { interrupt: true });
      if (!ok) D.log('La voce non ha risposto: controlla le voci installate sul dispositivo.', 'warn');
    });
  }

  /* annunci: il DJ parla sopra l'inizio del mix, come alla radio */
  D.on('transition', e => {
    if (!Sp.enabled) return;
    setTimeout(() => Sp.announce(e.track, false), 1200);
  });
  D.on('track', e => {
    if (!Sp.enabled) return;
    if (D.trackCount <= 1) setTimeout(() => Sp.announce(e.track, true), 600);
  });

  /* ================= MIXER ================= */
  function applyMixer() {
    const vol = $('#masterVol').value / 100;
    D.userVol = vol;
    if (Engine.ctx && !D.paused) Engine.master.gain.value = vol;
    if (Engine.ctx) {
      Engine.setReverb($('#revAmt').value / 100);
      Engine.mLow.gain.value = $('#bassTilt').value / 10;
      Engine.mHigh.gain.value = $('#airTilt').value / 10;
    }
  }
  const MIX_OUT = { masterVol: '#volVal', revAmt: '#revVal', bassTilt: '#bassVal', airTilt: '#airVal' };
  Object.keys(MIX_OUT).forEach(id => {
    const el = $('#' + id);
    el.addEventListener('input', () => {
      $(MIX_OUT[id]).textContent = el.value;
      applyMixer();
    });
  });
  $('#vizOn').addEventListener('change', e => { vizOn = e.target.checked; });
  $('#btnMixNow').addEventListener('click', () => D.skip('manual'));

  /* ================= TRANSPORT ================= */
  $('#btnPlay').addEventListener('click', () => {
    if (!started) return boot();
    D.setPaused(!D.paused);
    $('#btnPlay').textContent = D.paused ? '▶' : '⏸';
  });
  $('#btnSkip').addEventListener('click', () => D.skip('manual'));
  $('#btnLike').addEventListener('click', () => { D.like(); flash('#btnLike'); });
  $('#btnDislike').addEventListener('click', () => { D.dislike(); flash('#btnDislike'); });
  $('#btnNextEnergy').addEventListener('click', () => { D.nudgeEnergy(0.12); syncEnergyUI(); });
  $('#btnPrevEnergy').addEventListener('click', () => { D.nudgeEnergy(-0.12); syncEnergyUI(); });
  $('#energy').addEventListener('input', e => {
    D.setEnergy(e.target.value / 100);
    $('#btnAuto').classList.remove('on');
    $('#energyVal').textContent = e.target.value;
  });
  $('#btnAuto').addEventListener('click', () => {
    const on = !$('#btnAuto').classList.contains('on');
    $('#btnAuto').classList.toggle('on', on);
    D.setAutoEnergy(on);
  });
  function syncEnergyUI() {
    const v = Math.round(D.targetEnergy() * 100);
    $('#energy').value = v;
    $('#energyVal').textContent = v;
    $('#btnAuto').classList.toggle('on', D.autoEnergy);
  }
  function flash(sel) {
    const el = $(sel); el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 420);
  }

  /* crossfader: mostra l'automazione, ma resta afferrabile */
  const xf = $('#xfader');
  let manualX = 0;
  xf.addEventListener('input', () => {
    if (!D.decks.length) return;
    manualX = Date.now();
    const x = +xf.value;
    const t = Engine.ctx.currentTime;
    D.decks.forEach((d, i) => {
      const g = d.channel.fader.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(i === 0 ? Math.cos(x * Math.PI / 2) : Math.sin(x * Math.PI / 2), t);
    });
    $('#xfaderMode').textContent = 'manuale';
  });

  /* tastiera */
  addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); }
    else if (e.code === 'ArrowRight') D.skip('manual');
    else if (e.key === 'l' || e.key === 'L') $('#btnLike').click();
    else if (e.key === 'd' || e.key === 'D') $('#btnDislike').click();
    else if (e.key === 'ArrowUp') { D.nudgeEnergy(0.08); syncEnergyUI(); }
    else if (e.key === 'ArrowDown') { D.nudgeEnergy(-0.08); syncEnergyUI(); }
  });

  /* ================= LIBRERIA ================= */
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => e.preventDefault());
  $('#pickFiles').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => handleFiles(e.target.files));

  function handleFiles(list) {
    Engine.init();
    const files = Array.prototype.slice.call(list).filter(f => /audio|\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(f.type + f.name));
    if (!files.length) return;
    files.forEach(f => {
      const row = pendingRow(f.name);
      DJ.Analysis.analyze(f).then(track => {
        D.addToLibrary(track);
        row.remove();
        renderLibrary();
        D.log('Aggiunto “' + track.title + '” — ' + track.bpm + ' BPM' +
          (track.confidence < 0.35 ? ' (tempo incerto)' : ''), 'lib');
      }).catch(err => {
        row.querySelector('.tl-meta').textContent = 'non riesco a leggerlo';
        row.classList.add('err');
        console.warn(err);
      });
    });
  }

  function pendingRow(name) {
    const row = document.createElement('div');
    row.className = 'tl-row pending';
    row.innerHTML = '<span class="tl-name">' + escapeHtml(name) + '</span><span class="tl-meta">analizzo…</span>';
    $('#trackList').appendChild(row);
    return row;
  }

  function renderLibrary() {
    const box = $('#trackList');
    box.innerHTML = '';
    if (!D.library.length) {
      box.innerHTML = '<p class="hint">Nessun brano tuo in lista.</p>';
      return;
    }
    D.library.forEach(t => {
      const row = document.createElement('div');
      row.className = 'tl-row';
      row.innerHTML =
        '<span class="tl-name">' + escapeHtml(t.title) + '</span>' +
        '<span class="tl-meta">' + t.bpm + ' BPM · ' + fmt(t.duration) + '</span>' +
        '<button class="tl-x" title="Togli">×</button>';
      row.querySelector('.tl-x').addEventListener('click', () => {
        D.removeFromLibrary(t.id); renderLibrary();
      });
      box.appendChild(row);
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ================= REGISTRAZIONE ================= */
  let recorder = null, chunks = [];
  $('#recBtn').addEventListener('click', () => {
    if (!Engine.ctx) return;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    try {
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(Engine.recDest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
      chunks = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
        const name = 'aura-set-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.webm';
        $('#recBtn').classList.remove('rec');
        saveRecording(blob, name);
      };
      recorder.start(4000);
      $('#recBtn').classList.add('rec');
      D.log('Sto registrando il set.', 'cmd');
    } catch (e) {
      D.log('Registrazione non supportata dal browser.', 'warn');
    }
  });

  /** Salvataggio del set: nell'anteprima passa dal permesso del visualizzatore,
      altrove è un normale link di download. */
  function saveRecording(blob, filename) {
    const host = (window.claude && typeof window.claude.use === 'function')
      ? window.claude.use('downloads').catch(() => null)
      : Promise.resolve(null);

    host.then(dl => {
      if (dl) {
        dl.save({ filename, data: blob }).then(
          () => D.log('Registrazione salvata.', 'cmd'),
          err => D.log(err && err.code === 'declined'
            ? 'Salvataggio annullato.'
            : 'Non sono riuscito a salvare il file (' + ((err && err.code) || 'errore') + ').', 'warn')
        );
        return;
      }
      if (window.claude) {
        D.log('Qui il salvataggio è bloccato: apri il set dal sito per scaricarlo.', 'warn');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      D.log('Registrazione salvata.', 'cmd');
    });
  }

  /* ================= WAKE LOCK ================= */
  let wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(w => {
      wakeLock = w;
      $('#wakeBtn').classList.add('on');
      w.addEventListener('release', () => $('#wakeBtn').classList.remove('on'));
    }).catch(() => {});
  }
  $('#wakeBtn').addEventListener('click', () => {
    if (wakeLock) { wakeLock.release(); wakeLock = null; $('#wakeBtn').classList.remove('on'); }
    else requestWakeLock();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (wakeLock === null && $('#wakeBtn').classList.contains('on')) requestWakeLock();
      Engine.resume();
    }
  });

  /* ================= LOG ================= */
  const KIND_ICON = { start: '◆', track: '♪', plan: '›', mix: '⇄', like: '❤', dislike: '✕', cmd: '·', lib: '+', warn: '!' };
  D.on('log', e => {
    const box = $('#log');
    const row = document.createElement('div');
    row.className = 'log-row ' + e.kind;
    const d = new Date(e.at);
    row.innerHTML = '<time>' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</time>' +
      '<span class="li">' + (KIND_ICON[e.kind] || '·') + '</span>' + escapeHtml(e.msg);
    box.prepend(row);
    while (box.children.length > 140) box.lastChild.remove();
  });
  D.on('taste', () => { renderGenreList(); });
  D.on('library', renderLibrary);
  D.on('next', t => {
    $('#nextTitle').textContent = t.title + ' · ' + t.genreName + ' · ' + t.bpm + ' BPM';
  });
  D.on('track', () => { $('#nextTitle').textContent = 'il DJ ci sta pensando…'; $('#nextCount').textContent = ''; });

  /* ================= VISUALIZER + REFRESH ================= */
  const cv = $('#viz'), cx = cv.getContext('2d');
  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.max(1, r.width * dpr);
    cv.height = Math.max(1, r.height * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize);

  function drawViz(w, h, color) {
    cx.clearRect(0, 0, w, h);
    if (!vizOn || !Engine.analyser) return;
    Engine.analyser.getByteFrequencyData(Engine.freqData);
    const data = Engine.freqData;
    const bars = 56;
    const bw = w / bars;
    const baseline = h * 0.82;

    // barre spettrali su scala logaritmica
    for (let i = 0; i < bars; i++) {
      const lo = Math.floor(Math.pow(i / bars, 2.1) * 420) + 1;
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 2.1) * 420) + 1);
      let sum = 0;
      for (let j = lo; j < hi && j < data.length; j++) sum += data[j];
      const v = (sum / (hi - lo)) / 255;
      const bh = Math.pow(v, 1.5) * h * 0.62;
      const x = i * bw;
      const g = cx.createLinearGradient(0, baseline - bh, 0, baseline);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(124,92,255,0.08)');
      cx.fillStyle = g;
      cx.fillRect(x + bw * 0.16, baseline - bh, bw * 0.68, bh);
      cx.globalAlpha = 0.16;
      cx.fillRect(x + bw * 0.16, baseline, bw * 0.68, bh * 0.42);
      cx.globalAlpha = 1;
    }

    // anello di battito
    const cxp = w / 2, cyp = h * 0.38, R = Math.min(w, h) * 0.17;
    const pulse = 1 + beatPulse * 0.1;
    cx.beginPath();
    cx.arc(cxp, cyp, R * pulse, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(255,255,255,' + (0.08 + beatPulse * 0.22) + ')';
    cx.lineWidth = 1.5;
    cx.stroke();

    const deck = D.decks[D.active];
    if (deck && deck.track) {
      const p = deck.progress();
      cx.beginPath();
      cx.arc(cxp, cyp, R * pulse, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      cx.strokeStyle = color;
      cx.lineWidth = 3;
      cx.lineCap = 'round';
      cx.stroke();
    }
    beatPulse *= 0.9;
  }

  function deckPaint(id, deck) {
    const t = deck && deck.track;
    $('#d' + id + '-state').textContent = !t ? 'libero' : (D.decks[D.active] === deck ? 'in onda' : 'in cue');
    $('#d' + id + '-title').textContent = t ? t.title : '—';
    $('#d' + id + '-meta').textContent = t
      ? (t.genreName + ' · ' + t.bpm + ' BPM' + (t.keyName && t.keyName !== '—' ? ' · ' + t.keyName : ''))
      : '—';
    $('#d' + id + '-bar').style.width = t ? (deck.progress() * 100).toFixed(1) + '%' : '0%';
    const lvl = deck ? deck.channel.level() : 0;
    $('#d' + id + '-vu').style.width = Math.min(100, lvl * 130).toFixed(0) + '%';
    const card = $('#deck' + id);
    card.classList.toggle('live', !!t && D.decks[D.active] === deck);
    if (t) card.style.setProperty('--c', t.color || '#7c5cff');
  }

  let lastFrame = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!started) return;
    if (ts - lastFrame < 1000 / 40) return;
    lastFrame = ts;
    const rect = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (Math.abs(rect.width * dpr - cv.width) > 2 || Math.abs(rect.height * dpr - cv.height) > 2) resize();

    const deck = D.decks[D.active];
    const t = deck && deck.track;
    const color = (t && t.color) || '#7c5cff';

    // battito
    const beatPos = (Transport.step % 4);
    if (beatPos === 0 && Transport.step !== lastBar) { beatPulse = 1; lastBar = Transport.step; }

    drawViz(rect.width, rect.height, color);

    $('#nowTitle').textContent = t ? t.title : '—';
    $('#nowMeta').textContent = t
      ? (t.kind === 'file' ? 'Tuo brano' : t.genreName) + ' · ' + Math.round(Transport.bpm) + ' BPM' +
        (t.keyName && t.keyName !== '—' ? ' · ' + t.keyName : '') +
        ' · ' + (deck.bar() + 1) + '/' + deck.totalBars + ' battute'
      : '—';
    $('#nowBar').style.width = t ? (deck.progress() * 100).toFixed(2) + '%' : '0%';
    $('#nowSection').textContent = t && deck.section ? SECT[deck.section.type] || deck.section.type : '';
    if (t && deck.section && deck.section.type !== lastSection) {
      lastSection = deck.section.type;
      if (Sp.enabled && Sp.hype && lastSection === 'drop' && D.targetEnergy() > 0.7 && Math.random() < 0.35) {
        Sp.say(Sp.hypeLine(), { pitch: 1.05 });
      }
    }
    $('#nowLabel').textContent = D.transition ? 'Mix in corso' : 'In riproduzione';
    $('#nowTitle').style.color = color;

    deckPaint('A', D.decks[0]);
    deckPaint('B', D.decks[1]);

    $('#bpmStat').textContent = Math.round(Transport.bpm) + ' BPM';
    $('#keyStat').textContent = t && t.keyName ? t.keyName : '—';
    $('#clock').textContent = fmt((Date.now() - D.plan.startMs) / 1000);
    $('#setProgress').style.width = (D.sessionProgress() * 100).toFixed(2) + '%';
    $('#autoBadge').classList.toggle('off', !D.autoEnergy);

    // crossfader in sola lettura quando decide il DJ
    if (Date.now() - manualX > 2500 && D.decks.length) {
      const gA = D.decks[0].channel.fader.gain.value, gB = D.decks[1].channel.fader.gain.value;
      const sum = gA + gB;
      xf.value = sum > 0.001 ? clamp(gB / sum, 0, 1) : (D.active === 0 ? 0 : 1);
      $('#xfaderMode').textContent = D.transition ? 'mix ' + D.transition.type : 'auto';
    }

    // conto alla rovescia al prossimo mix
    if (t && !D.transition) {
      const rem = deck.remainingBars() - (t.mixBars || 32);
      const secs = rem * 4 * (60 / Transport.bpm);
      $('#nextCount').textContent = rem > 0 ? 'tra ' + fmt(secs) : 'a momenti';
    } else if (D.transition) {
      $('#nextCount').textContent = 'in mix';
    }

    if (D.autoEnergy) {
      const v = Math.round(D.targetEnergy() * 100);
      $('#energy').value = v;
      $('#energyVal').textContent = v;
    }
  }

  const SECT = { intro: 'intro', build: 'salita', drop: 'drop', main: 'corpo', break: 'break', outro: 'chiusura' };

  /* ================= INIT ================= */
  buildBootChips();
  initTastePanel();
  initVoicePanel();
  renderLibrary();
  syncEnergyUI();
  resize();

  // suggerimento iniziale nel booth
  D.log('Pronto. Scegli i generi e avvia il set.', 'start');
})(window.DJ);
