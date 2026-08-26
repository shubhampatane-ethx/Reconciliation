"""
Fuzzy VALUE matching — for field values within already-paired rows
(e.g. Name column says "ABC Corp" in source, "abc corp" in target), as
opposed to fuzzy_match.py which matches ROW KEYS to pair up rows in the
first place (e.g. "Alpha Proj" -> "Project Alpha").

This module is used two ways, both feeding into the same batched LLM call:

1. FIELD VALUES (via classify_similarity + collect as a "field" candidate):
   canonical_value() in normalize.py already treats case/whitespace as
   equal. This module handles the next tier up: values that are similar
   but NOT identical after that normalization (typos, abbreviations,
   legal-suffix differences — "ABC Corp" vs "ABC Corporation").

2. ROW KEYS (via fuzzy_match.py's borderline band): TF-IDF cosine
   similarity already auto-accepts confident renames. Candidates that
   score just below that threshold — too uncertain to auto-accept, too
   plausible to ignore — get queued here instead of silently becoming a
   false "Deleted" + "Added" pair.

Three-tier design, cheapest first:
  - similarity >= AUTO_ACCEPT_THRESHOLD  -> accept immediately, no LLM call
  - similarity <  LLM_REVIEW_FLOOR       -> reject immediately, no LLM call
  - in between                            -> queue for ONE batched LLM call
    covering every ambiguous candidate from the whole reconciliation run
    (not one call per cell — that would be slow and expensive on a large
    file). Only the genuinely ambiguous middle band ever reaches the LLM.

Numbers and dates are deliberately never fuzzy-matched here — financial
amounts and dates must match exactly (after canonical_value's format
normalization) or be reported as a real mismatch. Fuzzy leniency is a text
value in the first case, not for money.
"""

import difflib
import re
from typing import Any, Dict, List, Optional

from llm_json_utils import parse_json_list
from groq_service import generate_response as groq_generate, GroqError, is_available as groq_available
from ollama_service import generate_response as ollama_generate, OllamaError

AUTO_ACCEPT_THRESHOLD = 0.88  # confident enough to accept with no LLM call
LLM_REVIEW_FLOOR = 0.55       # below this, too dissimilar to be worth an LLM call
MAX_CANDIDATES_PER_CALL = 80  # bounds prompt size / cost regardless of file size


def _normalize_for_similarity(text: str) -> str:
    text = text.strip().casefold()
    text = re.sub(r"\s+", " ", text)
    return text


def text_similarity(a: str, b: str) -> float:
    """0..1 similarity, tolerant of both typos and word reordering.

    Takes the max of:
      - difflib SequenceMatcher ratio (catches typos, partial overlaps)
      - a token-sort ratio (catches reordering, e.g. "Corp ABC" vs "ABC Corp")
    so neither failure mode alone tanks the score.
    """
    na, nb = _normalize_for_similarity(a), _normalize_for_similarity(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0

    seq_ratio = difflib.SequenceMatcher(None, na, nb).ratio()

    tokens_a = " ".join(sorted(na.split()))
    tokens_b = " ".join(sorted(nb.split()))
    token_ratio = difflib.SequenceMatcher(None, tokens_a, tokens_b).ratio()

    return max(seq_ratio, token_ratio)


def classify_similarity(similarity: float) -> str:
    """Returns 'auto_fuzzy' | 'llm_review' | 'mismatch'."""
    if similarity >= AUTO_ACCEPT_THRESHOLD:
        return "auto_fuzzy"
    if similarity >= LLM_REVIEW_FLOOR:
        return "llm_review"
    return "mismatch"


def _build_batch_prompt(candidates: List[Dict[str, Any]]) -> str:
    lines = [
        "You are assisting a data reconciliation tool. Below is a numbered list "
        "of value pairs found in different files that a fast text-similarity "
        "check could not confidently classify. For EACH pair, decide whether "
        "the two values refer to the SAME real-world thing (e.g. \"ABC Corp\" "
        "and \"ABC Corporation\" are the same company; \"ABC Corp\" and \"XYZ "
        "Corp\" are not). Consider common abbreviations, legal suffixes "
        "(Corp/Corporation/Inc/Ltd/LLC), initials, and typos as potentially "
        "the same; consider genuinely different names, numbers, or entities "
        "as different.",
        "",
    ]
    for c in candidates:
        context = f' (column: "{c["context"]}")' if c.get("context") else ""
        lines.append(f'{c["id"]}. "{c["source_value"]}" vs "{c["target_value"]}"{context}')

    lines.append("")
    lines.append("Respond with STRICT JSON ONLY, no markdown, no commentary, in exactly this shape:")
    lines.append(
        '{"verdicts": [{"id": "<id from the list above>", "same": true|false, '
        '"confidence": <0.0-1.0>, "reason": "<one short sentence>"}]}'
    )
    lines.append("Include exactly one entry per numbered pair above, using its exact id.")
    return "\n".join(lines)


def llm_review_fuzzy_candidates(
    candidates: List[Dict[str, Any]],
    provider: str = "auto",
    model: Optional[str] = None,
    provider_used_out: Dict[str, str] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Batch-reviews ambiguous fuzzy-match candidates in ONE LLM call.

    candidates: list of {"id": str, "source_value": str, "target_value": str,
                          "context": str (optional, e.g. column name), "similarity": float}
    provider: "auto" (Groq -> Ollama fallback) | "groq" | "ollama"
    model: optional model override

    Returns dict keyed by candidate id -> {"same": bool, "confidence": float, "reason": str, "provider": str}.
    Missing ids (LLM omitted them, or the call/parse failed entirely) simply
    aren't in the result — callers should treat that as "no verdict, keep
    the default/provisional classification" rather than erroring.
    """
    if not candidates:
        return {}

    if provider not in ("auto", "groq", "ollama"):
        provider = "auto"

    # Bound the call size regardless of how many candidates the whole
    # reconciliation run produced — a huge prompt is slow, costly, and more
    # likely to get truncated or garbled by the model anyway. Anything
    # beyond the cap simply keeps its provisional (mismatch) classification.
    batch = candidates[:MAX_CANDIDATES_PER_CALL]
    prompt = _build_batch_prompt(batch)

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
                return {}

    if raw_text is None and try_ollama:
        try:
            raw_text = ollama_generate(prompt, model=model)
            used_provider = "ollama"
        except OllamaError:
            return {}

    if not raw_text:
        return {}

    parsed = parse_json_list(raw_text, list_key="verdicts")
    if not parsed:
        return {}

    valid_ids = {c["id"] for c in batch}
    results = {}
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        cid = entry.get("id")
        if cid not in valid_ids:
            continue
        same = bool(entry.get("same"))
        try:
            conf = float(entry.get("confidence", 0.6))
        except (TypeError, ValueError):
            conf = 0.6
        conf = max(0.0, min(conf, 1.0))
        results[cid] = {
            "same": same,
            "confidence": round(conf, 4),
            "reason": str(entry.get("reason", ""))[:280],
            "provider": used_provider,
        }

    if provider_used_out is not None and results:
        provider_used_out["provider"] = used_provider

    return results