"""
LLM-Assisted Semantic Review Layer for Schema Mapping.

The statistical engine (schema_engine.py) handles the bulk of column mapping
using 8 weighted signals + Hungarian optimal assignment — fast, deterministic,
explainable, and free. It's excellent when headers are structurally similar
(PartyNumber -> PARTY_NUMBER) or values overlap directly.

It struggles when a source and target column are semantically identical but
textually and statistically dissimilar, e.g.:
    entity_name_original  ->  PARTY_NAME
    addr1_ora              ->  STREET_ADDRESS_LINE_1

This module is a SECOND PASS: it only runs on columns the statistical engine
was NOT confident about (score < LOW_CONFIDENCE_THRESHOLD), asks an LLM
(Groq primary, Ollama fallback — mirroring the same primary/fallback pattern
already used in app.py's /api/chat route) to reason about the remaining
unmapped source/target columns using their names + real sample values, and
returns a structured suggestion with a short natural-language justification.

Design principles:
- Never required. If the selected provider(s) are unavailable/unreachable, this
  module returns an empty result and the statistical recommendations from
  schema_engine.py stand on their own, unchanged. Nothing else in the app
  depends on this module (same defensive philosophy as ollama_service.py).
- Only sends column names + a handful of sample values per column, never the
  full dataset — keeps prompts small and avoids leaking bulk data.
- Forces strict JSON output and parses defensively (fenced code blocks, stray
  prose around the JSON, a bare list instead of {"mappings": [...]}) so minor
  differences between models don't silently kill the feature.
- Provider/model are caller-selectable (see llm_review_low_confidence_mappings'
  `provider` and `model` params): "auto" (Groq -> Ollama fallback, default),
  "groq", or "ollama". Lets the UI expose a picker instead of hardcoding one
  provider.
"""

import json
import re
from typing import Any, Dict, List, Optional

from llm_json_utils import strip_fences, parse_json_list
from groq_service import (
    generate_response as groq_generate,
    GroqError,
    is_available as groq_available,
    GROQ_MODELS,
    GROQ_MODEL as GROQ_DEFAULT_MODEL,
)
from ollama_service import (
    generate_response as ollama_generate,
    OllamaError,
    is_available as ollama_available,
    OLLAMA_MODEL as OLLAMA_DEFAULT_MODEL,
)

LOW_CONFIDENCE_THRESHOLD = 0.70  # below "HIGH" -> eligible for LLM review
MAX_SAMPLE_VALUES = 4
VALID_PROVIDERS = {"auto", "groq", "ollama"}


def get_provider_status() -> Dict[str, Any]:
    """Reports what's actually usable right now, for the frontend's picker.
    Ollama's check is a short network probe (~3s timeout); Groq's is a cheap
    env-var check — mirrors is_available() in each service module."""
    return {
        "groq": {
            "configured": groq_available(),
            "default_model": GROQ_DEFAULT_MODEL,
            "models": GROQ_MODELS,
        },
        "ollama": {
            "configured": ollama_available(),
            "default_model": OLLAMA_DEFAULT_MODEL,
            "models": [{"id": OLLAMA_DEFAULT_MODEL, "label": OLLAMA_DEFAULT_MODEL, "badge": "Local"}],
        },
    }


def _build_prompt(
    low_conf_source_cols: List[str],
    src_profiles: Dict[str, Any],
    tgt_profiles: Dict[str, Any],
    available_targets: List[str],
) -> str:
    lines = [
        "You are assisting a data reconciliation tool in mapping columns between "
        "a SOURCE file and a TARGET file that describe the same underlying "
        "financial/entity records but use different column naming conventions.",
        "",
        "A statistical algorithm already confidently mapped most columns. Below are "
        "ONLY the source columns it was NOT confident about, plus the target columns "
        "that are still unclaimed. For each source column, decide if one of the "
        "available target columns is semantically the same field (e.g. "
        "'entity_name_original' and 'PARTY_NAME' both hold a company/customer name). "
        "If none genuinely matches, say so — do not force a match.",
        "",
        "SOURCE COLUMNS (unconfident):",
    ]
    for c in low_conf_source_cols:
        prof = src_profiles.get(c, {})
        samples = prof.get("sample_values", [])[:MAX_SAMPLE_VALUES]
        lines.append(f'- "{c}" | inferred_type={prof.get("inferred_logical_type", "?")} | samples={samples}')

    lines.append("")
    lines.append("AVAILABLE TARGET COLUMNS (unclaimed):")
    for c in available_targets:
        prof = tgt_profiles.get(c, {})
        samples = prof.get("sample_values", [])[:MAX_SAMPLE_VALUES]
        lines.append(f'- "{c}" | inferred_type={prof.get("inferred_logical_type", "?")} | samples={samples}')

    lines.append("")
    lines.append(
        "Respond with STRICT JSON ONLY, no markdown, no commentary, in exactly this shape:"
    )
    lines.append(
        '{"mappings": [{"source_column": "<exact source name>", '
        '"suggested_target": "<exact target name or null>", '
        '"confidence": <0.0-1.0>, "reason": "<one short sentence>"}]}'
    )
    lines.append(
        "Include one entry per source column listed above. Use null for suggested_target "
        "if nothing genuinely matches. Never invent a target column name that wasn't listed."
    )
    return "\n".join(lines)


def _parse_llm_json(raw_text: str) -> List[Dict[str, Any]]:
    """Defensively parses the model's response into a list of mapping dicts."""
    return parse_json_list(raw_text, list_key="mappings")


def llm_review_low_confidence_mappings(
    recommended_mappings: List[Dict[str, Any]],
    src_profiles: Dict[str, Any],
    tgt_profiles: Dict[str, Any],
    tgt_cols: List[str],
    provider: str = "auto",
    model: Optional[str] = None,
    provider_used_out: Dict[str, str] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Reviews only the low-confidence entries from the statistical pass.

    provider: "auto" (Groq, falling back to Ollama, default) | "groq" (Groq
    only, no fallback) | "ollama" (Ollama only, no fallback). Invalid values
    fall back to "auto".
    model: optional model override, passed through to whichever provider
    ends up handling the request (ignored if it doesn't apply, e.g. an Ollama
    model id passed while provider="groq").

    Returns a dict keyed by source_column -> {suggested_target, confidence, reason, provider}
    for columns the LLM found a genuine match for. Empty dict if nothing to review,
    or if the selected provider(s) are unavailable/fail.
    """
    if provider not in VALID_PROVIDERS:
        provider = "auto"

    already_claimed = {
        m["recommended_target"]
        for m in recommended_mappings
        if m.get("recommended_target") not in (None, "__ignore__")
    }
    available_targets = [t for t in tgt_cols if t not in already_claimed]

    low_conf_cols = [
        m["source_column"]
        for m in recommended_mappings
        if m.get("confidence", 0.0) < LOW_CONFIDENCE_THRESHOLD
    ]

    if not low_conf_cols or not available_targets:
        return {}

    prompt = _build_prompt(low_conf_cols, src_profiles, tgt_profiles, available_targets)

    raw_text = None
    used_provider = None

    try_groq = provider in ("auto", "groq")
    try_ollama = provider in ("auto", "ollama")

    if try_groq and groq_available():
        try:
            raw_text = groq_generate(prompt, model=model)
            used_provider = "groq"
        except GroqError:
            raw_text = None
            if provider == "groq":
                return {}  # explicit choice, no fallback

    if raw_text is None and try_ollama:
        try:
            raw_text = ollama_generate(prompt, model=model)
            used_provider = "ollama"
        except OllamaError:
            return {}

    if not raw_text:
        return {}

    parsed = _parse_llm_json(raw_text)
    if not parsed:
        return {}

    results = {}
    claimed_by_llm = set()
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        sc = entry.get("source_column")
        tc = entry.get("suggested_target")
        if not sc or sc not in low_conf_cols:
            continue
        if not tc or tc == "null" or tc not in available_targets or tc in claimed_by_llm:
            continue
        try:
            conf = float(entry.get("confidence", 0.6))
        except (TypeError, ValueError):
            conf = 0.6
        conf = max(0.0, min(conf, 1.0))
        results[sc] = {
            "suggested_target": tc,
            "confidence": round(conf, 4),
            "reason": str(entry.get("reason", ""))[:280],
            "provider": used_provider,
        }
        claimed_by_llm.add(tc)

    if provider_used_out is not None and results:
        provider_used_out["provider"] = used_provider

    return results