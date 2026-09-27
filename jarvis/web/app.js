/* JARVIS V0 — client vocale: microfono -> /api/voice -> risposta parlata.
   Nessun dato viene salvato nel browser: la memoria vive solo in RAM. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const micBtn = $("micBtn"), stateEl = $("state"), logEl = $("log");
  const chipsEl = $("chips"), dotEl = $("statusDot"), hintEl = $("hint");
  const textForm = $("textForm"), textInput = $("textInput");

  const history = [];           // [{role, content}] — solo in memoria
  let health = null;
  let sttMode = "server";       // "server" | "browser"
  let ttsMode = "server";       // "server" | "browser"
  let recorder = null, chunks = [], stream = null;
  let recognition = null;
  let busy = false, recording = false;

  // ---------- UI ----------
  function setState(text, isError = false) {
    stateEl.textContent = text;
    stateEl.classList.toggle("err", !!isError);
  }
  function chip(label, ok) {
    const el = document.createElement("span");
    el.className = "chip " + (ok ? "ok" : "bad");
    el.textContent = label;
    chipsEl.appendChild(el);
  }
  function addMsg(who, text) {
    const el = document.createElement("div");
    el.className = "msg " + who;
    if (who !== "sys") {
      const tag = document.createElement("span");
      tag.className = "who";
      tag.textContent = who === "user" ? "MASSIMO" : "JARVIS";
      el.appendChild(tag);
    }
    el.appendChild(document.createTextNode(text));
    logEl.appendChild(el);
    el.scrollIntoView({ behavior: "smooth", block: "end" });
  }
  function setBusy(v) {
    busy = v;
    micBtn.classList.toggle("busy", v);
  }

  // ---------- Health ----------
  async function loadHealth() {
    try {
      const r = await fetch("/api/health");
      health = await r.json();
    } catch {
      dotEl.className = "dot err";
      setState("Backend non raggiungibile. Avvia il server con ./run.sh", true);
      return;
    }
    chipsEl.innerHTML = "";
    const supportsSR = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;

    sttMode = health.stt.ready && health.stt.provider !== "browser" ? "server" : "browser";
    if (sttMode === "browser" && !supportsSR) sttMode = "unavailable";
    ttsMode = health.tts.ready && health.tts.provider !== "browser" ? "server" : "browser";

    chip("LLM " + (health.llm.model || health.llm.provider), health.llm.ready);
    chip("STT " + (sttMode === "server" ? health.stt.model || health.stt.provider : "browser"),
         sttMode !== "unavailable");
    chip("TTS " + (ttsMode === "server" ? health.tts.voice || "piper" : "browser"), true);

    const problems = [];
    if (!health.llm.ready) problems.push("LLM: " + health.llm.detail);
    if (sttMode === "unavailable") problems.push("STT non disponibile: installa faster-whisper o usa Chrome");
    dotEl.className = "dot " + (problems.length ? (health.llm.ready ? "warn" : "err") : "ok");

    if (problems.length) {
      setState(problems[0], !health.llm.ready);
      problems.forEach((p) => addMsg("sys", p));
    } else {
      setState("Pronto.");
      addMsg("jarvis", health.greeting);
      if (ttsMode === "browser") speakBrowser(health.greeting);
    }
    if (sttMode === "browser" && health.stt.provider === "local") {
      hintEl.textContent = "Modalità browser (STT Google). Per il 100% offline installa faster-whisper.";
    }
  }

  // ---------- TTS ----------
  function speakBrowser(text) {
    if (!("speechSynthesis" in window) || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (health && health.lang === "it" ? "it-IT" : health?.lang) || "it-IT";
    const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith("it"));
    if (v) u.voice = v;
    u.rate = 1.05;
    micBtn.classList.add("speak");
    u.onend = u.onerror = () => micBtn.classList.remove("speak");
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  function playAudio(src, revoke) {
    return new Promise((resolve) => {
      const audio = new Audio(src);
      const done = () => {
        micBtn.classList.remove("speak");
        if (revoke) URL.revokeObjectURL(src);
        resolve();
      };
      micBtn.classList.add("speak");
      audio.onended = audio.onerror = done;
      audio.play().catch(done);
    });
  }
  const playWav = (b64) => playAudio("data:audio/wav;base64," + b64);
  const playBlob = (blob) => playAudio(URL.createObjectURL(blob), true);
  function speak(reply, b64) {
    if (b64) return playWav(b64);
    speakBrowser(reply);
    return Promise.resolve();
  }

  // ---------- Pipeline ----------
  async function sendAudio(blob, filename) {
    setBusy(true);
    setState("Trascrivo…");
    const fd = new FormData();
    fd.append("audio", blob, filename);
    fd.append("history", JSON.stringify(history));
    try {
      const r = await fetch("/api/voice", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Errore " + r.status);
      if (!data.transcript) { setState(data.detail || "Non ho sentito nulla."); return; }
      addMsg("user", data.transcript);
      addMsg("jarvis", data.reply);
      history.push({ role: "user", content: data.transcript },
                   { role: "assistant", content: data.reply });
      setState("");
      await speak(data.reply, data.audio);
    } catch (e) {
      setState(String(e.message || e), true);
    } finally {
      setBusy(false);
    }
  }

  async function sendText(text) {
    if (!text.trim()) return;
    setBusy(true);
    addMsg("user", text);
    setState("Elaboro…");
    history.push({ role: "user", content: text });
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Errore " + r.status);
      addMsg("jarvis", data.reply);
      history.push({ role: "assistant", content: data.reply });
      setState("");
      if (ttsMode === "server") {
        const t = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: data.reply }),
        });
        if (t.ok && (t.headers.get("content-type") || "").startsWith("audio/")) {
          await playBlob(await t.blob());
        } else speakBrowser(data.reply);
      } else speakBrowser(data.reply);
    } catch (e) {
      setState(String(e.message || e), true);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Registrazione (server STT) ----------
  function pickMime() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }

  async function startRecording() {
    if (busy || recording) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      setState("Microfono negato. Autorizzalo nel browser (serve http://localhost o HTTPS).", true);
      return;
    }
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      chunks = [];
      if (blob.size < 1200) { setState("Registrazione troppo breve."); return; }
      sendAudio(blob, "speech." + ext);
    };
    recorder.start();
    recording = true;
    micBtn.classList.add("rec");
    setState("Ti ascolto…");
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    micBtn.classList.remove("rec");
    try { recorder.stop(); } catch { /* già fermo */ }
  }

  // ---------- Registrazione (browser STT) ----------
  function startBrowserSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setState("Riconoscimento vocale non supportato da questo browser.", true); return; }
    recognition = new SR();
    recognition.lang = "it-IT";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (e) => { stopBrowserSTT(); sendText(e.results[0][0].transcript); };
    recognition.onerror = (e) => { stopBrowserSTT(); setState("Errore microfono: " + e.error, true); };
    recognition.onend = () => { recording = false; micBtn.classList.remove("rec"); };
    recognition.start();
    recording = true;
    micBtn.classList.add("rec");
    setState("Ti ascolto…");
  }
  function stopBrowserSTT() {
    if (recognition) { try { recognition.stop(); } catch { /* noop */ } }
    recording = false;
    micBtn.classList.remove("rec");
  }

  function toggle() {
    if (busy) return;
    if (sttMode === "unavailable") { setState("STT non disponibile: usa il pulsante Scrivi.", true); return; }
    if (recording) { sttMode === "server" ? stopRecording() : stopBrowserSTT(); }
    else { sttMode === "server" ? startRecording() : startBrowserSTT(); }
  }

  // ---------- Eventi ----------
  micBtn.addEventListener("click", toggle);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat && document.activeElement !== textInput) {
      e.preventDefault(); if (!recording) toggle();
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space" && document.activeElement !== textInput) {
      e.preventDefault(); if (recording) toggle();
    }
  });
  $("clearBtn").addEventListener("click", () => {
    history.length = 0;
    logEl.innerHTML = "";
    addMsg("sys", "Memoria di lavoro azzerata.");
    setState("Pronto.");
  });
  $("textBtn").addEventListener("click", () => {
    textForm.hidden = !textForm.hidden;
    if (!textForm.hidden) textInput.focus();
  });
  textForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = textInput.value;
    textInput.value = "";
    sendText(v);
  });

  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  loadHealth();
})();
