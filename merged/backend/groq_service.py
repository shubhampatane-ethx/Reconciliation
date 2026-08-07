"""
Thin OpenAI-compatible client for Groq (https://console.groq.com).

Same defensive philosophy as ollama_service.py: if GROQ_API_KEY isn't set,
the network is unreachable, or the API returns something unexpected,
generate_response() raises GroqError with a clear message that the
/api/chat route turns into a JSON error. Nothing else in the app depends
on this module, so the rest of the app keeps working when Groq is
unconfigured or offline.

Groq is the PRIMARY provider in the chat flow; Ollama (ollama_service.py)
is the automatic fallback whenever Groq can't answer.
"""

import os
import time
import requests

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_TIMEOUT = int(os.environ.get("GROQ_TIMEOUT", "120"))
GROQ_MAX_RETRIES = int(os.environ.get("GROQ_MAX_RETRIES", "3"))
GROQ_BACKOFF_SECONDS = int(os.environ.get("GROQ_BACKOFF_SECONDS", "2"))
# 0 means "use the per-model default below".
GROQ_MAX_INPUT_CHARS = int(os.environ.get("GROQ_MAX_INPUT_CHARS", "0"))

ASSISTANT_SYSTEM_PROMPT = (
    "You are an AI Data Reconciliation Assistant. Answer only using the "
    "supplied reconciliation context and never invent, guess, or estimate "
    "values that are not present in it. If the information needed to answer "
    "is not available, say plainly that it is unavailable. Explain "
    "reconciliation statistics in simple, plain language a non-technical "
    "business user can understand, reference concrete numbers from the "
    "context when relevant, and keep answers concise but informative."
)

# Free Groq models surfaced in the UI's model picker.
#
# NOTE: `groq/compound` (the agentic router) is intentionally excluded: it
# hard-rejects requests around ~24k input chars with HTTP 413
# "request_too_large" and routes larger prompts to a model with its own TPM
# limit, so it is unusable for full reconciliation prompts. `groq/compound-mini`
# routes through llama-3.3-70b (12k TPM) and is kept.
GROQ_MODELS = [
    {"id": "openai/gpt-oss-20b", "label": "GPT-OSS 20B", "badge": "OpenAI"},
    {"id": "openai/gpt-oss-120b", "label": "GPT-OSS 120B", "badge": "OpenAI"},
    {"id": "llama-3.3-70b-versatile", "label": "Best overall", "badge": "Meta"},
    {"id": "llama-3.1-8b-instant", "label": "Fastest", "badge": "Meta"},
    {"id": "qwen/qwen3.6-27b", "label": "Qwen 3.6 27B", "badge": "Qwen"},
    {"id": "groq/compound-mini", "label": "Compound Mini", "badge": "Groq"},
]

# Groq's free ("on_demand") tier caps tokens per minute (TPM) per model, and
# the API rejects a single request whose input exceeds that limit with HTTP
# 413. The reconciliation prompt can be several thousand tokens, so we keep
# the input comfortably under each model's reported limit. Values are in
# input characters, calibrated against the actual TPM each model reported
# when the full 31.5KB prompt was sent (tokenisers differ per model):
#   - llama-3.3-70b-versatile: 12,000 TPM, accepts the full prompt
#   - groq/compound-mini: routes via llama-3.3-70b (12,000 TPM) but the
#     router itself hard-rejects ~20k+ chars with "Request Entity Too Large"
#   - openai/gpt-oss-20b / gpt-oss-120b: 8,000 TPM
#   - qwen/qwen3.6-27b: 8,000 TPM (denser tokeniser, so a smaller cap)
#   - llama-3.1-8b-instant: 6,000 TPM
# Unknown models default to the 8k-TPM bucket.
GROQ_MODEL_MAX_INPUT_CHARS = {
    "llama-3.3-70b-versatile": 36000,
    "groq/compound-mini": 19000,
    "openai/gpt-oss-20b": 22000,
    "openai/gpt-oss-120b": 22000,
    "qwen/qwen3.6-27b": 18000,
    "llama-3.1-8b-instant": 17000,
}
GROQ_DEFAULT_MAX_INPUT_CHARS = 22000


def _max_input_chars(model: str) -> int:
    """Per-model input cap in characters, overridable via GROQ_MAX_INPUT_CHARS."""
    if GROQ_MAX_INPUT_CHARS > 0:
        return GROQ_MAX_INPUT_CHARS
    return GROQ_MODEL_MAX_INPUT_CHARS.get(model or GROQ_MODEL, GROQ_DEFAULT_MAX_INPUT_CHARS)


def _trim_prompt(prompt: str, max_chars: int) -> str:
    """Trim a too-large prompt to fit a model's input cap.

    Keeps the head (system instructions + reconciliation stats, which lead
    the prompt) and the tail (chat history + the user's question, which end
    it) intact, dropping only the middle sample rows.
    """
    if len(prompt) <= max_chars:
        return prompt
    keep = max_chars // 2
    return (
        prompt[:keep]
        + "\n\n[... additional reconciliation context omitted to fit the "
        + "model's input limit ...]\n\n"
        + prompt[-keep:]
    )


class GroqError(Exception):
    """Raised when Groq isn't configured, can't be reached, or errors out."""


def is_available() -> bool:
    """Cheap config check — Groq is available when an API key is set."""
    return bool(GROQ_API_KEY)


def generate_response(prompt: str, model: str = None) -> str:
    """Send a single prompt to Groq's OpenAI-compatible chat endpoint and
    return the generated text.

    `model` optionally overrides GROQ_MODEL for this call only, so the model
    stays configurable per-request without touching the env var.
    """
    if not GROQ_API_KEY:
        raise GroqError("GROQ_API_KEY is not set.")

    if not prompt or not prompt.strip():
        raise GroqError("Prompt is empty.")

    selected_model = model or GROQ_MODEL
    prompt = _trim_prompt(prompt, _max_input_chars(selected_model))

    payload = {
        "model": selected_model,
        "messages": [
            {"role": "system", "content": ASSISTANT_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    last_error = None
    for attempt in range(GROQ_MAX_RETRIES + 1):
        try:
            resp = requests.post(
                f"{GROQ_BASE_URL}/chat/completions",
                json=payload,
                headers=headers,
                timeout=GROQ_TIMEOUT,
            )
        except requests.RequestException as exc:
            last_error = exc
            if attempt < GROQ_MAX_RETRIES:
                time.sleep(GROQ_BACKOFF_SECONDS * (2 ** attempt))
                continue
            raise GroqError(
                f"Could not reach Groq at {GROQ_BASE_URL} (model='{model or GROQ_MODEL}'): {exc}"
            ) from exc

        if resp.status_code == 429 or resp.status_code >= 500:
            # Rate-limited or temporarily unavailable — retry with backoff,
            # honouring Retry-After when the API tells us how long to wait.
            if attempt < GROQ_MAX_RETRIES:
                retry_after = resp.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else None
                except ValueError:
                    delay = None
                if delay is None:
                    delay = GROQ_BACKOFF_SECONDS * (2 ** attempt)
                time.sleep(delay)
                continue
            body = (resp.text or "").strip()[:500]
            raise GroqError(
                f"Groq is rate-limited or temporarily unavailable (HTTP {resp.status_code}) "
                f"for model='{model or GROQ_MODEL}'. Retry in a moment. "
                f"Details: {body}"
            )

        if resp.status_code >= 400:
            # Auth failures and bad requests fail fast with the API's own message.
            body = (resp.text or "").strip()[:500]
            raise GroqError(
                f"Groq returned HTTP {resp.status_code} for model='{model or GROQ_MODEL}': {body}"
            )

        break
    else:
        if last_error is not None:
            raise GroqError(
                f"Could not reach Groq at {GROQ_BASE_URL} (model='{model or GROQ_MODEL}'): {last_error}"
            ) from last_error
        raise GroqError("Groq could not be reached after retries.")

    try:
        data = resp.json()
    except ValueError as exc:
        raise GroqError("Groq returned an unexpected (non-JSON) response.") from exc

    try:
        text = (data["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise GroqError("Groq returned an unexpected response shape.") from exc

    if not text:
        raise GroqError("Groq returned an empty response.")
    return text
