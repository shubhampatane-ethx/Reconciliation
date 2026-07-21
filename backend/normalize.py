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

import pandas as pd


def canonical_value(value):
    """Normalize a cell value for EQUALITY comparison only (not for
    display — a whole number can come back in scientific notation,
    e.g. Decimal('100').normalize() -> '1E+2'). Two values with the
    same canonical form are considered the same underlying value,
    even if their raw text/formatting differs."""
    text = "" if pd.isna(value) else str(value)
    stripped = text.strip()
    if stripped == "":
        return ""

    number_text = stripped.replace(",", "")
    if number_text.startswith("$"):
        number_text = number_text[1:]
    try:
        return f"number:{Decimal(number_text).normalize()}"
    except InvalidOperation:
        pass

    parsed_date = pd.to_datetime(stripped, errors="coerce")
    if not pd.isna(parsed_date):
        return f"date:{parsed_date.date().isoformat()}"

    return f"text:{stripped.casefold()}"


def display_value(value):
    """Return a clean, human-readable form of a cell value for showing
    in the UI. Only dates get reformatted (e.g. "2026-11-01 00:00:00"
    -> "2026-11-01") since that's the formatting inconsistency that
    actually confuses readers; numbers and text are left exactly as
    stored so nothing is silently altered."""
    text = "" if pd.isna(value) else str(value)
    stripped = text.strip()
    if stripped == "":
        return stripped

    canon = canonical_value(stripped)
    if canon.startswith("date:"):
        return canon.split(":", 1)[1]

    return stripped
