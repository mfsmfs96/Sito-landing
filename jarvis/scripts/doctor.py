"""Diagnostica JARVIS: dice cosa manca e il comando esatto per sistemarlo."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.config import settings  # noqa: E402

OK, KO = "  ok  ", " MANCA"


def line(label: str, ok: bool, detail: str = "") -> bool:
    print(f"[{OK if ok else KO}] {label}" + (f" — {detail}" if detail else ""))
    return ok


def main() -> int:
    print("=== JARVIS doctor ===\n")
    problems: list[str] = []

    line("Python " + sys.version.split()[0], sys.version_info >= (3, 10),
         "" if sys.version_info >= (3, 10) else "serve >= 3.10")

    for mod, fix in (("fastapi", "pip install -r requirements.txt"),
                     ("uvicorn", "pip install -r requirements.txt"),
                     ("httpx", "pip install -r requirements.txt")):
        try:
            __import__(mod)
            line(mod, True)
        except ImportError:
            line(mod, False, fix)
            problems.append(fix)

    # LLM
    if settings.llm_provider == "ollama":
        url = f"{settings.ollama_host}/api/tags"
        try:
            with urllib.request.urlopen(url, timeout=4) as resp:  # noqa: S310
                models = [m["name"] for m in json.load(resp).get("models", [])]
            line(f"Ollama ({settings.ollama_host})", True, f"{len(models)} modelli")
            want = settings.ollama_model
            has = any(m == want or m.split(":")[0] == want.split(":")[0] for m in models)
            if not line(f"modello {want}", has, "" if has else f"ollama pull {want}"):
                problems.append(f"ollama pull {want}")
        except (urllib.error.URLError, OSError, TimeoutError):
            line(f"Ollama ({settings.ollama_host})", False, "avvia `ollama serve`")
            problems.append("ollama serve")
    elif settings.llm_provider == "groq":
        if not line("GROQ_API_KEY", bool(settings.groq_api_key), "impostala nel file .env"):
            problems.append("imposta GROQ_API_KEY in .env")

    # STT
    if settings.stt_provider == "local":
        try:
            import faster_whisper  # noqa: F401
            line("faster-whisper", True, f"modello '{settings.whisper_model}'")
        except ImportError:
            line("faster-whisper", False, "pip install faster-whisper")
            problems.append("pip install faster-whisper")
    else:
        line(f"STT provider '{settings.stt_provider}'", True)

    # TTS
    if settings.tts_provider == "piper":
        try:
            import piper  # noqa: F401
            line("piper-tts", True)
            path = settings.piper_data_dir / f"{settings.piper_voice}.onnx"
            fix = (f"python -m piper.download_voices {settings.piper_voice} "
                   f"--data-dir {settings.piper_data_dir}")
            if not line(f"voce {settings.piper_voice}", path.is_file(), "" if path.is_file() else fix):
                problems.append(fix)
        except ImportError:
            line("piper-tts", False, "pip install piper-tts")
            problems.append("pip install piper-tts")
    else:
        line(f"TTS provider '{settings.tts_provider}'", True)

    print(f"\nPrivacy: audio su disco = NO | trascritti su disco = {'SI' if settings.save_transcripts else 'NO'}")
    if problems:
        print("\nDa sistemare:")
        for p in dict.fromkeys(problems):
            print("  $ " + p)
        return 1
    print("\nTutto pronto. Avvia con ./run.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
