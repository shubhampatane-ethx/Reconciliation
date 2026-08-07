# Groq AI Chat Integration — What Changed & How It Works

This document records the **Groq integration** for the AI Reconciliation Chat
assistant, every change made to get it working, and the operational notes you
need to run it day-to-day (models, free-tier limits, fallbacks).

---

## 1. Overview

The chat assistant ("AI Assistant" widget in the top-right of the dashboard)
answers questions about reconciliation reports. It has three provider modes:

| Provider | Meaning |
|---|---|
| `auto` (default) | Try **Groq** first; if it fails, automatically fall back to **Ollama**. |
| `groq` | Explicitly use Groq; if the selected Groq model fails, automatically fall back to Ollama. |
| `ollama` | Use the local Ollama model only. |

**Groq is the primary provider** (hosted, fast, high-quality); Ollama is the
local/offline fallback. The selection is made in the chat widget's dropdown,
and a per-request Groq model can be chosen in the second dropdown.

---

## 2. Files Changed

| File | What changed |
|---|---|
| `backend/groq_service.py` | **New** — thin OpenAI-compatible Groq client. |
| `backend/app.py` | `/api/chat` routes the `provider`/`model` values; added automatic Ollama fallback + a `note` field when fallback happens. |
| `frontend/src/ChatWidget.jsx` | Provider + model pickers; renders a small note bubble when the backend falls back to Ollama. |
| `frontend/src/styles.css` | Added `.chat-bubble-system` (subtle amber note bubble) + the existing chat widget styling. |
| `docker-compose.yml` | Backend service gets `GROQ_*` env vars (from root `.env`). |
| `.env` | Holds the real `GROQ_API_KEY`. |
| `backend/.env.example` | Documents all Groq env vars. |

---

## 3. Backend — `backend/groq_service.py`

Thin client calling Groq's OpenAI-compatible endpoint
(`https://api.groq.com/openai/v1/chat/completions`).

- **Defensive by design** (same philosophy as `ollama_service.py`): missing
  key, network failure, or bad response raises `GroqError` with a readable
  message; the rest of the app is unaffected if Groq is offline.
- **System prompt** (`ASSISTANT_SYSTEM_PROMPT`): instructs the model to only
  answer from the supplied reconciliation context and never invent numbers.
- **Retry with exponential backoff** for HTTP 429 / 5xx, honouring the
  `Retry-After` header when present (`GROQ_MAX_RETRIES`, `GROQ_BACKOFF_SECONDS`).

### 3.1 Free-tier model list (`GROQ_MODELS`)

Models offered in the UI picker:

| id | Label | Backing |
|---|---|---|
| `openai/gpt-oss-20b` | GPT-OSS 20B | OpenAI |
| `openai/gpt-oss-120b` | GPT-OSS 120B | OpenAI |
| `llama-3.3-70b-versatile` | Best overall | Meta |
| `llama-3.1-8b-instant` | Fastest | Meta |
| `qwen/qwen3.6-27b` | Qwen 3.6 27B | Qwen |
| `groq/compound-mini` | Compound Mini | Groq |

> **`groq/compound` was intentionally removed.** It is an agentic router that
> hard-rejects requests around ~24k input chars with HTTP 413
> `request_too_large`, and routes bigger prompts to a model with its own TPM
> limit — unusable for full reconciliation prompts.

---

## 4. Prompt-Size Handling (why models were failing — fixed)

### The problem
The reconciliation prompt is ~31.5KB (~9,900 tokens). Groq's free
(`on_demand`) tier caps **tokens per minute (TPM) per model**, and the API
rejects a single request whose input exceeds that cap with HTTP 413
"Request too large". Several models were failing on real prompts:

| Model | Free-tier TPM | Status with full prompt |
|---|---|---|
| `llama-3.3-70b-versatile` | 12,000 | Works |
| `groq/compound-mini` | 12,000 (via llama-3.3-70b) | Works (router hard-caps ~19k chars) |
| `openai/gpt-oss-20b` | 8,000 | Failed → fixed |
| `openai/gpt-oss-120b` | 8,000 | Failed → fixed |
| `qwen/qwen3.6-27b` | 8,000 | Failed → fixed |
| `llama-3.1-8b-instant` | 6,000 | Failed → fixed |

### The fix (in `groq_service.py`)
- `GROQ_MODEL_MAX_INPUT_CHARS`: a per-model input cap in characters,
  calibrated against each model's real TPM (tokenisers differ per model).
- `_trim_prompt()`: if the prompt exceeds a model's cap, it keeps the **head**
  (system instructions + reconciliation stats) and the **tail** (chat history
  + the user's question), and drops only the middle sample rows, inserting a
  note that context was truncated.
- `GROQ_MAX_INPUT_CHARS` env var overrides the per-model defaults
  (`0` = use the defaults).

Result: **all 6 remaining models now answer the full reconciliation prompt.**

---

## 5. Rate-Limit Handling (free-tier caps — fixed)

Groq's free tier also caps **tokens per day (TPD)** at 100,000 per model. When
a model is exhausted, the API returns HTTP 429 with a message like
`Rate limit reached ... on tokens per day (TPD): Limit 100000, Used ...`.

Handling in `backend/app.py`:
1. The Groq client retries transient 429/5xx with backoff.
2. If a selected Groq model still fails, the backend **automatically falls
   back to Ollama** (using Ollama's own default model — it never forwards the
   Groq model id to Ollama) and returns a `note` field explaining that the
   answer came from Ollama.
3. `frontend/src/ChatWidget.jsx` renders that note as a subtle amber bubble
   above the answer, so the user always knows what answered.

> Each model has its **own** daily budget. If one model is throttled (e.g.
> `llama-3.3-70b-versatile` / `compound-mini` after heavy use), the others
> (GPT-OSS 20B/120B, Qwen 3.6 27B, Fastest) still work.

---

## 6. Configuration

All Groq settings are env vars (root `.env` → `docker-compose.yml`):

```env
GROQ_API_KEY=gsk_...                # Get one at https://console.groq.com → API Keys
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.3-70b-versatile  # default model
GROQ_TIMEOUT=120
GROQ_MAX_RETRIES=3
GROQ_BACKOFF_SECONDS=2
GROQ_MAX_INPUT_CHARS=0              # 0 = use per-model defaults in groq_service.py
```

- **Empty `GROQ_API_KEY`** forces the Ollama fallback (the app keeps working).
- Settings live in `backend/.env.example` for reference.

---

## 7. Frontend — `frontend/src/ChatWidget.jsx`

- **Provider picker**: `⚡ Auto — Groq → Ollama` / `Groq` / `Ollama`.
- **Model picker**: only shown for Groq/Auto; lists the 6 models above.
- On the response, if the backend includes `note`, the widget inserts a
  `system` role bubble (styled `.chat-bubble-system` in `styles.css`).

---

## 8. Known Limitations

1. **Free-tier daily caps**: 100,000 tokens/day per model. Heavy usage
   (or debugging with full prompts) can exhaust a model for the rest of the
   day; it replenishes on a rolling window (minutes–hours) or by the next day.
2. **Ollama fallback is slow on CPU**: on this machine a trivial prompt took
   ~53s and a full 31.5KB prompt exceeded 300s. The fallback produces a clear
   message, but the hosted Groq models are the recommended path.
3. **`groq/compound`** is excluded (see §3.1) because its request-size cap
   makes it unusable for reconciliation prompts.
4. **Prompt trimming** (when a model's cap is hit) drops the middle sample
   rows of the context — the reconciliation statistics and the user's question
   are always preserved.

---

## 9. Verification Performed

- All 6 models answered the full ~31.5KB reconciliation prompt after the fix.
- `provider='groq'` with an exhausted model → backend falls back to Ollama and
  returns a `note` (verified end-to-end via `POST /api/chat`).
- `provider` validation accepts `''`, `'auto'`, `'groq'`, `'ollama'`
  (`backend/app.py`).
- Both backend and frontend Docker images were rebuilt so the changes are
  baked in (not only live via the `./backend:/app` volume mount).

---

*See also: `backend/ollama_service.py` (fallback provider) and
`AR_Reconciliation_Feature_Spec.md` for the broader reconciliation feature.*
