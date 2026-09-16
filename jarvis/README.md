# JARVIS V0 — assistente vocale locale (costo €0)

Microfono → **STT** → **LLM** → **TTS** → voce. Tutto in locale, tutto open-source, zero euro.

```
Browser (mic, MediaRecorder)
   │  POST /api/voice  (webm/opus)
   ▼
FastAPI  ──►  STT   faster-whisper  (offline, CPU)
         ──►  LLM   Ollama          (offline, CPU/GPU)
         ──►  TTS   Piper           (offline, voce IT)
   │  JSON { transcript, reply, audio(wav base64) }
   ▼
Browser riproduce la risposta
```

L'audio **non tocca mai il disco**: resta in RAM per la durata della richiesta.

---

## 1. Cosa installi (e quanto costa)

| Componente | Software | Costo | Note |
|---|---|---|---|
| Runtime | Python ≥ 3.10 | €0 | |
| API | FastAPI + Uvicorn | €0 | MIT |
| STT | faster-whisper 1.2.1 | €0 | offline, modello `base` ≈ 150 MB |
| LLM | Ollama + `qwen3:4b` | €0 | offline, ≈ 2,5 GB su disco |
| TTS | piper-tts 1.8.0 + voce `it_IT-paola-medium` | €0 | offline, ≈ 61 MB |

**Requisiti reali**: 8 GB di RAM bastano con `qwen3:4b`. Con 16 GB puoi usare `llama3.1:8b`.
Senza Ollama installato puoi usare il free tier di **Groq** (serve solo un account, nessuna carta).

Fallback senza installare nulla (`--lite`): STT e TTS del browser (Web Speech API, solo Chrome/Edge).
È gratis ma **l'audio passa dai server Google**: comodo per provare, non per la privacy.

---

## 2. Installazione (3 comandi)

```bash
# 1. Ollama (motore LLM locale)
curl -fsSL https://ollama.com/install.sh | sh     # macOS: brew install ollama
ollama serve &                                    # lascialo girare
ollama pull qwen3:4b

# 2. JARVIS
cd jarvis
./scripts/setup.sh            # venv + dipendenze + voce italiana  (usa --lite per la versione senza installazioni pesanti)

# 3. Avvio
./run.sh                      # → http://127.0.0.1:8080
```

Apri **http://127.0.0.1:8080** (non `0.0.0.0`: il microfono richiede `localhost` o HTTPS),
tieni premuto **Spazio** e parla.

Se qualcosa non torna:

```bash
.venv/bin/python scripts/doctor.py     # dice cosa manca e il comando esatto per sistemarlo
```

---

## 3. Test

```bash
.venv/bin/python -m pytest tests -q     # 10 test, provider simulati
curl -s http://127.0.0.1:8080/api/health | python3 -m json.tool
```

Prestazioni misurate su CPU (nessuna GPU), frase da 3 secondi:
trascrizione + sintesi ≈ **4 s** end-to-end con `whisper base` e Piper.

---

## 4. Configurazione

Tutto in `.env` (copiato da `.env.example` dal setup).

| Variabile | Default | Alternative |
|---|---|---|
| `JARVIS_LLM_PROVIDER` | `ollama` | `groq`, `openai_compat` |
| `OLLAMA_MODEL` | `qwen3:4b` | `llama3.1:8b`, `gemma3:4b`, `qwen2.5:7b` |
| `JARVIS_STT_PROVIDER` | `local` | `groq` (whisper-large-v3-turbo), `browser` |
| `JARVIS_WHISPER_MODEL` | `base` | `tiny` (più veloce), `small` (più preciso) |
| `JARVIS_TTS_PROVIDER` | `piper` | `browser`, `none` |
| `JARVIS_PIPER_VOICE` | `it_IT-paola-medium` | `it_IT-serena-medium`, `it_IT-riccardo-x_low` (voce maschile) |
| `JARVIS_SAVE_TRANSCRIPTS` | `false` | `true` → JSONL locale in `data/transcripts/` |

---

## 5. Privacy (scelte già prese)

- L'audio non viene mai scritto su disco, in nessuna modalità.
- I trascritti restano in RAM salvo `JARVIS_SAVE_TRANSCRIPTS=true`.
- Il server ascolta solo su `127.0.0.1`: niente è esposto in rete.
- Con i default (Ollama + faster-whisper + Piper) **nessun dato lascia il computer**.
- I provider cloud opzionali (Groq) sono disattivati finché non metti una API key.

---

## 6. API

| Endpoint | Metodo | Input | Output |
|---|---|---|---|
| `/api/health` | GET | — | stato di LLM/STT/TTS + privacy |
| `/api/voice` | POST | `audio` (file) + `history` (JSON) | `{transcript, reply, audio}` |
| `/api/stt` | POST | `audio` (file) | `{text}` |
| `/api/chat` | POST | `{messages[], text?}` | `{reply}` |
| `/api/tts` | POST | `{text}` | `audio/wav` |

Docs interattive: `http://127.0.0.1:8080/api/docs`.

---

## 7. Struttura

```
jarvis/
├── server/       config.py · llm.py · stt.py · tts.py · prompts.py · main.py
├── web/          index.html · app.js · style.css
├── scripts/      setup.sh · doctor.py
├── tests/        test_api.py
└── run.sh
```

Ogni livello (STT, LLM, TTS) è un modulo con provider intercambiabili: è la base su cui
si innestano le versioni successive.

---

## 8. Roadmap

- **V0 — fatto**: voce → risposta vocale, 100% locale.
- **V1**: memoria persistente (SQLite) di persone, conversazioni e preferenze.
- **V2**: strumenti (calendario, email, contatti, task, web) via tool-calling.
- **V3**: telefonia (SIP/WebRTC, es. Asterisk o FreePBX self-hosted) con avviso di registrazione
  obbligatorio — il consenso è un requisito legale, non un dettaglio.
- **V4**: callback intelligente con riepilogo della chiamata.
- **V5**: autonomia operativa entro limiti definiti esplicitamente.
