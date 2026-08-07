"""
Thin client for a locally-running Ollama server.

Same philosophy as db.py: every call is defensive. If Ollama isn't running
or OLLAMA_BASE_URL isn't reachable, generate_response() raises OllamaError
with a clear message that the /api/chat route turns into a JSON error —
nothing else in the app depends on this module, so the rest of the app
keeps working with Ollama offline, exactly like the Postgres-optional
pattern in db.py.

No RAG, no embeddings, no vector store here: the caller (app.py) is
expected to pass whatever reconciliation report/context text it wants
explained, and this module just forwards a prompt to the local model and
returns the generated text.
"""

import os
import requests

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3")
OLLAMA_TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT", "120"))


class OllamaError(Exception):
    """Raised when the local Ollama server can't be reached or errors out."""


def is_available() -> bool:
    """Cheap reachability check, mirrors db.is_available()."""
    try:
        resp = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=3)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def generate_response(prompt: str, model: str = None) -> str:
    """Send a single prompt to the local Ollama server and return the
    generated text.

    `model` optionally overrides OLLAMA_MODEL for this call only, so the
    model stays configurable per-request without touching the env var.
    """
    if not prompt or not prompt.strip():
        raise OllamaError("Prompt is empty.")

    payload = {
        "model": model or OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }

    try:
        resp = requests.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload, timeout=OLLAMA_TIMEOUT)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise OllamaError(
            f"Could not reach Ollama at {OLLAMA_BASE_URL} (model='{model or OLLAMA_MODEL}'): {exc}"
        ) from exc

    data = resp.json()
    text = (data.get("response") or "").strip()
    if not text:
        raise OllamaError("Ollama returned an empty response.")
    return text
