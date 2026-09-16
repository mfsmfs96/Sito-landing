"""Smoke test della pipeline V0 (nessun modello reale: provider simulati)."""
import io
import json
import sys
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import llm, main, stt, tts  # noqa: E402

client = TestClient(main.app)


def _fake_wav() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\x00\x00" * 2205)
    return buf.getvalue()


@pytest.fixture
def fake_stack(monkeypatch):
    async def fake_chat(messages):
        return f"Ricevuto: {messages[-1]['content']}"

    async def fake_transcribe(audio, filename="a.webm"):
        return "ciao jarvis"

    async def fake_synth(text):
        return _fake_wav()

    monkeypatch.setattr(llm, "chat", fake_chat)
    monkeypatch.setattr(stt, "transcribe", fake_transcribe)
    monkeypatch.setattr(tts, "synthesize", fake_synth)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert {"llm", "stt", "tts", "privacy"} <= body.keys()
    assert body["privacy"]["audio_persisted"] is False


def test_index_served():
    r = client.get("/")
    assert r.status_code == 200
    assert "JARVIS" in r.text


def test_chat(fake_stack):
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "che ore sono"}]})
    assert r.status_code == 200
    assert r.json()["reply"] == "Ricevuto: che ore sono"


def test_chat_requires_message():
    assert client.post("/api/chat", json={"messages": []}).status_code == 400


def test_voice_pipeline(fake_stack):
    r = client.post(
        "/api/voice",
        files={"audio": ("speech.webm", b"fake-audio-bytes", "audio/webm")},
        data={"history": json.dumps([{"role": "user", "content": "test"},
                                     {"role": "assistant", "content": "ok"}])},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["transcript"] == "ciao jarvis"
    assert body["reply"] == "Ricevuto: ciao jarvis"
    assert body["audio"] and isinstance(body["audio"], str)


def test_voice_with_broken_history(fake_stack):
    r = client.post(
        "/api/voice",
        files={"audio": ("speech.webm", b"fake", "audio/webm")},
        data={"history": "non-json"},
    )
    assert r.status_code == 200


def test_tts_endpoint(fake_stack):
    r = client.post("/api/tts", json={"text": "buongiorno"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"


def test_stt_error_becomes_503(monkeypatch):
    async def boom(audio, filename="a.webm"):
        raise stt.STTError("modello mancante")

    monkeypatch.setattr(stt, "transcribe", boom)
    r = client.post("/api/voice", files={"audio": ("a.webm", b"x", "audio/webm")})
    assert r.status_code == 503
    assert "modello mancante" in r.json()["detail"]


def test_clean_strips_thinking_and_markdown():
    assert llm._clean("<think>ragiono</think>**Ciao** Massimo") == "Ciao Massimo"


def test_history_is_trimmed():
    msgs = [main.Message(role="user", content=str(i)) for i in range(100)]
    assert len(main._history(msgs)) == main.MAX_HISTORY_TURNS * 2
