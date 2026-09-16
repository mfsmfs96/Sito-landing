"""Speech-to-Text: faster-whisper locale (offline) o Groq Whisper (free tier)."""
from __future__ import annotations

import io

import httpx

from .config import settings

_model = None  # cache del modello locale (caricato una sola volta)


class STTError(RuntimeError):
    pass


def _load_local():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise STTError(
                "faster-whisper non installato. Esegui: pip install faster-whisper"
            ) from exc
        _model = WhisperModel(
            settings.whisper_model,
            device="cpu",
            compute_type=settings.whisper_compute,
        )
    return _model


def _transcribe_local(audio: bytes) -> str:
    model = _load_local()
    segments, _info = model.transcribe(
        io.BytesIO(audio),
        language=settings.lang or None,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    return " ".join(s.text.strip() for s in segments).strip()


async def _transcribe_groq(audio: bytes, filename: str) -> str:
    if not settings.groq_api_key:
        raise STTError("GROQ_API_KEY non impostata nel file .env")
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=5.0)) as client:
        r = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            files={"file": (filename, audio, "application/octet-stream")},
            data={"model": settings.groq_stt_model, "language": settings.lang},
        )
        if r.status_code >= 400:
            raise STTError(f"Groq STT {r.status_code}: {r.text[:300]}")
        return (r.json().get("text") or "").strip()


async def transcribe(audio: bytes, filename: str = "audio.webm") -> str:
    if not audio:
        raise STTError("Audio vuoto")
    provider = settings.stt_provider
    if provider == "local":
        import anyio

        return await anyio.to_thread.run_sync(_transcribe_local, audio)
    if provider == "groq":
        return await _transcribe_groq(audio, filename)
    if provider == "browser":
        raise STTError("STT impostato su 'browser': la trascrizione avviene lato client")
    raise STTError(f"Provider STT sconosciuto: {provider}")


def status() -> dict:
    provider = settings.stt_provider
    if provider == "local":
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return {"provider": "local", "ready": False,
                    "detail": "faster-whisper non installato (pip install faster-whisper)"}
        return {"provider": "local", "model": settings.whisper_model, "ready": True,
                "detail": "ok (il primo utilizzo scarica il modello, ~150 MB per 'base')"}
    if provider == "groq":
        ok = bool(settings.groq_api_key)
        return {"provider": "groq", "model": settings.groq_stt_model, "ready": ok,
                "detail": "ok" if ok else "GROQ_API_KEY mancante"}
    if provider == "browser":
        return {"provider": "browser", "ready": True, "detail": "Web Speech API (Chrome/Edge)"}
    return {"provider": provider, "ready": False, "detail": "provider sconosciuto"}
