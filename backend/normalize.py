"""
=====================================================================
 normalize.py
=====================================================================
Shared value-normalization helpers used by both app.py's
difference_summary() (the main Source vs Target diff) and db.py's
get_value_history() (the "Value History Over Time" panel), so both
features agree on one definition of "did this value actually change?"
=====================================================================
"""

from decimal import Decimal, InvalidOperation
import re as _re

import pandas as pd
_PLAIN_NUMBER_RE = _re.compile(r'^[\$\-\+]?[\d,]+\.?\d*$')
_DATE_LIKE_RE = _re.compile(r'^\d{1,4}[\-\/\.]\d{1,4}[\-\/\.]\d{1,4}(\s+\d{1,2}:\d{1,2}(:\d{1,2})?)?$')


import functools

@functools.lru_cache(maxsize=32768)
def _canonical_value_cached(val_str):
    stripped = val_str.strip()
    if stripped == "":
        return ""

    number_text = stripped.replace(",", "")
    if number_text.startswith("$"):
        number_text = number_text[1:]
    try:
        return f"number:{Decimal(number_text).normalize()}"
    except InvalidOperation:
        pass

    # Only attempt date parsing when the value looks like a date, not a plain number.
    if not _PLAIN_NUMBER_RE.match(stripped) and _DATE_LIKE_RE.match(stripped):
        parsed_date = pd.to_datetime(stripped, errors="coerce")
        if not pd.isna(parsed_date):
            return f"date:{parsed_date.date().isoformat()}"

    return f"text:{stripped.casefold()}"


def canonical_value(value):
    """Normalize a cell value for EQUALITY comparison only."""
    val_str = "" if pd.isna(value) else str(value)
    return _canonical_value_cached(val_str)


@functools.lru_cache(maxsize=32768)
def _display_value_cached(val_str):
    stripped = val_str.strip()
    if stripped == "":
        return stripped

    canon = canonical_value(stripped)
    if canon.startswith("date:"):
        return canon.split(":", 1)[1]

    return stripped


def display_value(value):
    """Return a clean, human-readable form of a cell value for showing
    in the UI."""
    val_str = "" if pd.isna(value) else str(value)
    return _display_value_cached(val_str)
