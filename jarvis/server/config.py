"""Configurazione JARVIS: solo env vars, zero dipendenze esterne."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Mini parser .env (evita la dipendenza python-dotenv)."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(ROOT / ".env")


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _bool(key: str, default: bool = False) -> bool:
    return _env(key, str(default)).lower() in {"1", "true", "yes", "on"}


def _path(key: str, default: str) -> Path:
    raw = _env(key, default)
    p = Path(raw)
    return p if p.is_absolute() else (ROOT / p).resolve()


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: _env("JARVIS_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("JARVIS_PORT", "8080")))
    lang: str = field(default_factory=lambda: _env("JARVIS_LANG", "it"))

    # LLM
    llm_provider: str = field(default_factory=lambda: _env("JARVIS_LLM_PROVIDER", "ollama").lower())
    llm_temperature: float = field(default_factory=lambda: float(_env("JARVIS_LLM_TEMPERATURE", "0.6")))
    ollama_host: str = field(default_factory=lambda: _env("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/"))
    ollama_model: str = field(default_factory=lambda: _env("OLLAMA_MODEL", "qwen3:4b"))
    groq_api_key: str = field(default_factory=lambda: _env("GROQ_API_KEY"))
    groq_model: str = field(default_factory=lambda: _env("GROQ_MODEL", "llama-3.3-70b-versatile"))
    openai_base_url: str = field(default_factory=lambda: _env("OPENAI_COMPAT_BASE_URL").rstrip("/"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_COMPAT_API_KEY"))
    openai_model: str = field(default_factory=lambda: _env("OPENAI_COMPAT_MODEL"))

    # STT
    stt_provider: str = field(default_factory=lambda: _env("JARVIS_STT_PROVIDER", "local").lower())
    whisper_model: str = field(default_factory=lambda: _env("JARVIS_WHISPER_MODEL", "base"))
    whisper_compute: str = field(default_factory=lambda: _env("JARVIS_WHISPER_COMPUTE", "int8"))
    groq_stt_model: str = field(default_factory=lambda: _env("GROQ_STT_MODEL", "whisper-large-v3-turbo"))

    # TTS
    tts_provider: str = field(default_factory=lambda: _env("JARVIS_TTS_PROVIDER", "piper").lower())
    piper_voice: str = field(default_factory=lambda: _env("JARVIS_PIPER_VOICE", "it_IT-paola-medium"))
    piper_data_dir: Path = field(default_factory=lambda: _path("JARVIS_PIPER_DATA_DIR", "./voices"))

    # Privacy
    save_transcripts: bool = field(default_factory=lambda: _bool("JARVIS_SAVE_TRANSCRIPTS", False))
    transcript_dir: Path = field(default_factory=lambda: _path("JARVIS_TRANSCRIPT_DIR", "./data/transcripts"))


settings = Settings()
