"""
=====================================================================
 dummy_integration  ->  business_key.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    Guess which uploaded column is the Business Key / Primary Key for
    an arbitrary, previously-unknown Excel structure (step 4 of the
    requested workflow), without any manual, per-client configuration.

    This is intentionally a simple heuristic, not magic: it looks for
    column names that read like an identifier (...ID, ...No, ...Code,
    ...Key, ...Number), then — if more than one candidate matches —
    prefers whichever candidate column actually has unique values in
    the uploaded data. It always returns something (falls back to the
    first column) so the workflow never breaks on an unusual file.
=====================================================================
"""

from typing import List, Optional

import pandas as pd

# Ordered by how strongly the name implies "this is an identifier".
_KEY_NAME_HINTS = ["id", "key", "code", "no", "number"]


def _looks_like_key_column(column_name: str) -> bool:
    normalized = column_name.strip().lower().replace("_", "").replace(" ", "")
    return any(hint in normalized for hint in _KEY_NAME_HINTS)


def detect_business_key(df: pd.DataFrame) -> Optional[str]:
    """
    Return the column name most likely to be the business/primary key
    for this dataframe, or None if the dataframe has no columns at all.

    Examples this is designed to handle correctly:
        CustomerID, Name, City, Balance          -> "CustomerID"
        EmployeeID, Department, Salary            -> "EmployeeID"
        PolicyNo, Premium, ExpiryDate, Agent       -> "PolicyNo"
        InvoiceNo, GST, Currency, Tax, Vendor       -> "InvoiceNo"
    """
    columns: List[str] = list(df.columns)
    if not columns:
        return None

    candidates = [c for c in columns if _looks_like_key_column(str(c))]
    if not candidates:
        # No column name looks like an identifier — fall back to the
        # first column rather than failing the whole upload.
        return columns[0]

    if len(candidates) == 1:
        return candidates[0]

    # Multiple candidates (e.g. "CustomerID" and "OrderNo" both present)
    # -> prefer the one whose values are actually unique in this file,
    # since that is the strongest real signal of a true primary key.
    for col in candidates:
        series = df[col].dropna()
        if len(series) > 0 and series.is_unique:
            return col

    # None of the candidates were fully unique (dirty/sample data) —
    # just go with the first name-based candidate.
    return candidates[0]
