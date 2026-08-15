"""
Chunk-based file ingestion for large AR reconciliation uploads.

Purely additive and behavior-preserving: for a given file, the returned
DataFrame is identical (same rows, same columns, same header=None layout)
to what a single `pd.read_csv(..., header=None)` / `pd.read_excel(...,
header=None)` call would have produced before. The only difference is how
the bytes are turned into that DataFrame:

  - CSV: streamed and parsed in bounded-size row chunks (CHUNK_ROWS at a
    time) and concatenated, instead of one single parse call holding the
    entire file's intermediate parser state in memory at once.
  - Excel (.xlsx/.xls): unchanged — pd.read_excel already streams the
    underlying zip/XML via openpyxl, and this file layout (merged headers,
    multiple sheets, etc.) is exercised elsewhere in the app, so it is left
    exactly as it was rather than risking a behavior change here.
"""
from io import BytesIO
import pandas as pd

CHUNK_ROWS = 50_000


def _read_csv_chunked(content: bytes, header=None) -> pd.DataFrame:
    # dtype=str is mandatory here, not optional: without it, pandas infers
    # a dtype independently PER CHUNK. A column that's numeric-looking in
    # every chunk except the one containing the text header row (row 0,
    # since header=None treats it as data) would then be inferred as
    # float in the numeric-only chunks and string in the header chunk --
    # concatenation silently reconciles that by coercing floats back to
    # strings, which drops formatting (e.g. "599.50" -> "599.5"). Forcing
    # dtype=str makes every chunk parse identically regardless of chunk
    # boundaries, and matches the dtype=str convention already used for
    # CSV elsewhere in this codebase (see read_dataframe() in app.py).
    reader = pd.read_csv(BytesIO(content), header=header, dtype=str, chunksize=CHUNK_ROWS)
    chunks = list(reader)
    if not chunks:
        return pd.DataFrame()
    return pd.concat(chunks, ignore_index=True)


def read_raw_chunked(content: bytes, filename: str) -> pd.DataFrame:
    """Drop-in replacement for the previous inline read_excel/read_csv
    branch in the AR reconcile route. Returns a raw, header=None DataFrame
    (header-row detection happens later, in ar_column_mapper.load_and_map)."""
    if filename.lower().endswith(('.xlsx', '.xls')):
        return pd.read_excel(BytesIO(content), header=None)
    return _read_csv_chunked(content, header=None)
