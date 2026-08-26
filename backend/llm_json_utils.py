"""
Shared, forgiving JSON parsing for LLM responses.

Different models (and even the same model on different calls) format
"strict JSON only" instructions inconsistently: some wrap the answer in
```json fences, some add a sentence of preamble first, some return a bare
list instead of the requested {"key": [...]} shape. Every LLM-assisted
feature in this app (schema mapping, fuzzy value review) hits the same
class of parsing problem, so it's handled once, here.
"""

import json
import re
from typing import Any, List, Optional


def strip_fences(text: str) -> str:
    """Strip ```json ... ``` or ``` ... ``` code fences some models wrap
    JSON responses in."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def parse_json_list(raw_text: str, list_key: Optional[str] = None) -> List[Any]:
    """Parses an LLM response into a list, tolerating common formatting
    deviations.

    Tries, in order:
      1. Direct json.loads of the fence-stripped text.
      2. If `list_key` is given and the result is a dict, return data[list_key].
      3. If the result is already a bare list, return it as-is.
      4. Regex-extract the first {...} or [...] block from within any
         surrounding prose, and retry steps 1-3 on just that substring.

    Returns [] if nothing parseable is found — callers should treat that as
    "no LLM suggestions available" and fall back gracefully, never raise.
    """
    cleaned = strip_fences(raw_text)

    def _try(text: str) -> Optional[List[Any]]:
        try:
            data = json.loads(text)
        except (ValueError, TypeError):
            return None
        if isinstance(data, dict):
            if list_key and isinstance(data.get(list_key), list):
                return data[list_key]
            return None
        if isinstance(data, list):
            return data
        return None

    result = _try(cleaned)
    if result is not None:
        return result

    match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
    if match:
        result = _try(match.group(1))
        if result is not None:
            return result

    return []