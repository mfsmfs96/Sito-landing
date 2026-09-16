"""JARVIS V0 — API vocale: microfono -> STT -> LLM -> TTS.

Avvio:  python -m uvicorn server.main:app --host 127.0.0.1 --port 8080
        (oppure ./run.sh)
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import llm, stt, tts
from .config import ROOT, settings
from .prompts import GREETING

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("jarvis")

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB, ~ 20 minuti di Opus
MAX_HISTORY_TURNS = 12  # memoria di lavoro V0 (RAM, lato client)

app = FastAPI(title="JARVIS V0", version="0.1.0", docs_url="/api/docs", redoc_url=None)
WEB_DIR = ROOT / "web"


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[Message] = []
    text: str | None = None


class TTSRequest(BaseModel):
    text: str


def _log_transcript(user_text: str, reply: str) -> None:
    """Salva il trascritto SOLO se esplicitamente abilitato. L'audio non e' mai salvato."""
    if not settings.save_transcripts:
        return
    settings.transcript_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "user": user_text,
        "jarvis": reply,
    }
    with (settings.transcript_dir / f"{day}.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def _history(messages: list[Message]) -> list[dict]:
    trimmed = messages[-MAX_HISTORY_TURNS * 2:]
    return [{"role": m.role, "content": m.content} for m in trimmed]


@app.get("/api/health")
async def health() -> dict:
    llm_status = await llm.status()
    return {
        "ok": True,
        "version": app.version,
        "lang": settings.lang,
        "greeting": GREETING,
        "privacy": {
            "audio_persisted": False,
            "transcripts_persisted": settings.save_transcripts,
        },
        "llm": llm_status,
        "stt": stt.status(),
        "tts": tts.status(),
    }


@app.post("/api/stt")
async def api_stt(audio: UploadFile = File(...)) -> dict:
    data = await audio.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio troppo grande")
    try:
        text = await stt.transcribe(data, audio.filename or "audio.webm")
    except stt.STTError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"text": text}


@app.post("/api/chat")
async def api_chat(req: ChatRequest) -> dict:
    messages = _history(req.messages)
    if req.text:
        messages.append({"role": "user", "content": req.text})
    if not messages:
        raise HTTPException(400, "Nessun messaggio")
    try:
        reply = await llm.chat(messages)
    except llm.LLMError as exc:
        raise HTTPException(503, str(exc)) from exc
    _log_transcript(messages[-1]["content"], reply)
    return {"reply": reply}


@app.post("/api/tts")
async def api_tts(req: TTSRequest) -> Response:
    try:
        wav = await tts.synthesize(req.text)
    except tts.TTSError as exc:
        raise HTTPException(503, str(exc)) from exc
    if not wav:
        return JSONResponse({"audio": None, "detail": "TTS delegato al browser"})
    return Response(content=wav, media_type="audio/wav")


@app.post("/api/voice")
async def api_voice(audio: UploadFile = File(...), history: str = "[]") -> dict:
    """Pipeline completa in una chiamata: audio -> trascrizione -> risposta -> voce."""
    data = await audio.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio troppo grande")
    try:
        transcript = await stt.transcribe(data, audio.filename or "audio.webm")
    except stt.STTError as exc:
        raise HTTPException(503, str(exc)) from exc
    del data  # l'audio non viene mai scritto su disco

    if not transcript:
        return {"transcript": "", "reply": "", "audio": None, "detail": "Non ho sentito nulla."}

    try:
        past = [Message(**m) for m in json.loads(history)]
    except (json.JSONDecodeError, TypeError, ValueError):
        past = []

    messages = _history(past) + [{"role": "user", "content": transcript}]
    try:
        reply = await llm.chat(messages)
    except llm.LLMError as exc:
        raise HTTPException(503, str(exc)) from exc

    audio_b64 = None
    try:
        wav = await tts.synthesize(reply)
        if wav:
            audio_b64 = base64.b64encode(wav).decode("ascii")
    except tts.TTSError as exc:
        log.warning("TTS non disponibile: %s", exc)

    _log_transcript(transcript, reply)
    return {"transcript": transcript, "reply": reply, "audio": audio_b64}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
