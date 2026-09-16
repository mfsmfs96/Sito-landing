"""Text-to-Speech: Piper locale (offline) o sintesi del browser."""
from __future__ import annotations

import io
import wave
from pathlib import Path

from .config import settings

_voice = None  # cache della voce Piper


class TTSError(RuntimeError):
    pass


def voice_path() -> Path:
    return settings.piper_data_dir / f"{settings.piper_voice}.onnx"


def _load_voice():
    global _voice
    if _voice is None:
        try:
            from piper import PiperVoice
        except ImportError as exc:
            raise TTSError("piper-tts non installato. Esegui: pip install piper-tts") from exc
        path = voice_path()
        if not path.is_file():
            raise TTSError(
                f"Voce Piper mancante: {path}. Scaricala con: "
                f"python -m piper.download_voices {settings.piper_voice} "
                f"--data-dir {settings.piper_data_dir}"
            )
        _voice = PiperVoice.load(str(path))
    return _voice


def _synth_wav(text: str) -> bytes:
    voice = _load_voice()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    return buf.getvalue()


async def synthesize(text: str) -> bytes:
    """Restituisce un WAV. Vuoto se il TTS e' delegato al browser."""
    text = (text or "").strip()
    if not text:
        return b""
    provider = settings.tts_provider
    if provider == "piper":
        import anyio

        return await anyio.to_thread.run_sync(_synth_wav, text)
    if provider in {"browser", "none"}:
        return b""
    raise TTSError(f"Provider TTS sconosciuto: {provider}")


def status() -> dict:
    provider = settings.tts_provider
    if provider == "piper":
        try:
            import piper  # noqa: F401
        except ImportError:
            return {"provider": "piper", "ready": False,
                    "detail": "piper-tts non installato (pip install piper-tts)"}
        path = voice_path()
        if not path.is_file():
            return {"provider": "piper", "voice": settings.piper_voice, "ready": False,
                    "detail": f"voce mancante: python -m piper.download_voices {settings.piper_voice} "
                              f"--data-dir {settings.piper_data_dir}"}
        return {"provider": "piper", "voice": settings.piper_voice, "ready": True, "detail": "ok"}
    if provider in {"browser", "none"}:
        return {"provider": provider, "ready": True, "detail": "sintesi lato browser"}
    return {"provider": provider, "ready": False, "detail": "provider sconosciuto"}
