"""Livello LLM: Ollama (locale) / Groq (free tier) / endpoint OpenAI-compatible."""
from __future__ import annotations

import re

import httpx

from .config import settings
from .prompts import SYSTEM_PROMPT

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
TIMEOUT = httpx.Timeout(120.0, connect=5.0)


class LLMError(RuntimeError):
    pass


def _clean(text: str) -> str:
    """Rimuove il reasoning dei modelli 'thinking' e il markdown residuo."""
    text = _THINK_RE.sub("", text)
    text = re.sub(r"^\s*<think>.*", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"[*_`#]+", "", text)
    return text.strip()


def _with_system(messages: list[dict]) -> list[dict]:
    if messages and messages[0].get("role") == "system":
        return messages
    return [{"role": "system", "content": SYSTEM_PROMPT}, *messages]


async def _ollama(messages: list[dict]) -> str:
    payload = {
        "model": settings.ollama_model,
        "messages": _with_system(messages),
        "stream": False,
        "think": False,  # ignorato dai modelli non-thinking
        "options": {"temperature": settings.llm_temperature},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(f"{settings.ollama_host}/api/chat", json=payload)
        if r.status_code == 400:  # alcuni modelli rifiutano "think"
            payload.pop("think", None)
            r = await client.post(f"{settings.ollama_host}/api/chat", json=payload)
        r.raise_for_status()
        return r.json().get("message", {}).get("content", "")


async def _openai_style(base_url: str, api_key: str, model: str, messages: list[dict]) -> str:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": _with_system(messages),
                "temperature": settings.llm_temperature,
            },
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


async def chat(messages: list[dict]) -> str:
    """messages: [{'role': 'user'|'assistant', 'content': str}, ...] -> risposta."""
    provider = settings.llm_provider
    try:
        if provider == "ollama":
            raw = await _ollama(messages)
        elif provider == "groq":
            if not settings.groq_api_key:
                raise LLMError("GROQ_API_KEY non impostata nel file .env")
            raw = await _openai_style(
                "https://api.groq.com/openai/v1",
                settings.groq_api_key,
                settings.groq_model,
                messages,
            )
        elif provider == "openai_compat":
            if not settings.openai_base_url or not settings.openai_model:
                raise LLMError("OPENAI_COMPAT_BASE_URL / OPENAI_COMPAT_MODEL non impostati")
            raw = await _openai_style(
                settings.openai_base_url,
                settings.openai_api_key,
                settings.openai_model,
                messages,
            )
        else:
            raise LLMError(f"Provider LLM sconosciuto: {provider}")
    except httpx.ConnectError as exc:
        raise LLMError(
            f"Non riesco a contattare il provider LLM '{provider}'. "
            "Se usi Ollama verifica che sia avviato: `ollama serve`."
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise LLMError(f"LLM {provider} ha risposto {exc.response.status_code}: {exc.response.text[:300]}") from exc

    reply = _clean(raw)
    return reply or "Non sono riuscito a formulare una risposta."


async def status() -> dict:
    """Diagnostica non bloccante per /api/health."""
    provider = settings.llm_provider
    if provider == "ollama":
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(4.0)) as client:
                r = await client.get(f"{settings.ollama_host}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
            wanted = settings.ollama_model
            ok = any(m == wanted or m.split(":")[0] == wanted.split(":")[0] for m in models)
            return {
                "provider": "ollama",
                "model": wanted,
                "ready": ok,
                "detail": "ok" if ok else f"modello non scaricato. Esegui: ollama pull {wanted}",
                "models": models,
            }
        except Exception as exc:  # noqa: BLE001 - diagnostica
            return {"provider": "ollama", "model": settings.ollama_model, "ready": False,
                    "detail": f"Ollama non raggiungibile su {settings.ollama_host} ({exc.__class__.__name__}). Avvia `ollama serve`."}
    if provider == "groq":
        ok = bool(settings.groq_api_key)
        return {"provider": "groq", "model": settings.groq_model, "ready": ok,
                "detail": "ok" if ok else "GROQ_API_KEY mancante"}
    if provider == "openai_compat":
        ok = bool(settings.openai_base_url and settings.openai_model)
        return {"provider": "openai_compat", "model": settings.openai_model, "ready": ok,
                "detail": "ok" if ok else "base_url/model mancanti"}
    return {"provider": provider, "ready": False, "detail": "provider sconosciuto"}
