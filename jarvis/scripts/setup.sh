#!/usr/bin/env bash
# JARVIS V0 — installazione completa (tutto gratuito, tutto locale).
#   ./scripts/setup.sh          -> core + STT locale + TTS locale + voce italiana
#   ./scripts/setup.sh --lite   -> solo core (STT/TTS delegati al browser)
set -euo pipefail

cd "$(dirname "$0")/.."
LITE=0
[[ "${1:-}" == "--lite" ]] && LITE=1

echo "▶ Python: $(python3 --version)"
python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    sys.exit("Serve Python 3.10 o superiore.")
PY

[[ -d .venv ]] || { echo "▶ Creo il virtualenv .venv"; python3 -m venv .venv; }
# shellcheck disable=SC1091
source .venv/bin/activate

echo "▶ Installo le dipendenze core"
pip install --upgrade pip >/dev/null
pip install -q -r requirements.txt

if [[ $LITE -eq 0 ]]; then
  echo "▶ Installo STT locale (faster-whisper) e TTS locale (piper-tts)"
  pip install -q "faster-whisper==1.2.1" "piper-tts==1.8.0"

  VOICE="$(grep -E '^JARVIS_PIPER_VOICE=' .env 2>/dev/null | cut -d= -f2 || true)"
  VOICE="${VOICE:-it_IT-paola-medium}"
  DIR="$(grep -E '^JARVIS_PIPER_DATA_DIR=' .env 2>/dev/null | cut -d= -f2 || true)"
  DIR="${DIR:-./voices}"
  mkdir -p "$DIR"
  if [[ ! -f "$DIR/$VOICE.onnx" ]]; then
    echo "▶ Scarico la voce italiana $VOICE (~60 MB)"
    python -m piper.download_voices "$VOICE" --data-dir "$DIR"
  fi
fi

[[ -f .env ]] || { cp .env.example .env; echo "▶ Creato .env da .env.example"; }
if [[ $LITE -eq 1 ]]; then
  sed -i.bak 's/^JARVIS_STT_PROVIDER=.*/JARVIS_STT_PROVIDER=browser/; s/^JARVIS_TTS_PROVIDER=.*/JARVIS_TTS_PROVIDER=browser/' .env && rm -f .env.bak
  echo "▶ Modalità lite: STT e TTS impostati su 'browser'"
fi

echo
echo "✔ Setup completato."
python scripts/doctor.py || true
echo
echo "Prossimo passo:  ./run.sh   →  http://127.0.0.1:8080"
