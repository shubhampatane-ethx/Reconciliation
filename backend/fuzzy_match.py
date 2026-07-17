"""
Fuzzy / vector-based key matching for reconciliation.

Exact-key matching (in app.py's difference_summary) is fast and 100%
reliable when a record's key text is identical between the source and
target file. But when a key was renamed, retyped, or has a typo between
versions (e.g. "Alpha Proj" -> "Project Alpha"), an exact match fails.
Today that shows up as a false "Deleted" row + a false "Added" row,
instead of what actually happened: one row was updated/renamed.

This module is only ever run on the LEFTOVERS from the exact-key pass —
whatever didn't match exactly. It turns each leftover key string into a
vector and finds its nearest neighbour on the other side using cosine
similarity. Pairs above a similarity threshold are reported back as a
likely rename, with a confidence score, so a person can review it rather
than have it silently auto-merged.

Vector store: this uses an in-memory, per-request TF-IDF vector index
(scikit-learn) rather than a hosted vector database (Chroma/FAISS/etc).
That's a deliberate choice for this app:
  - Reconciliation runs are one-shot: rows are embedded, matched, and
    discarded within a single request. There's nothing to persist.
  - Character n-gram TF-IDF is actually a strong fit for short,
    structured strings like project names/IDs — it's typo- and
    rename-tolerant without needing to download or run a neural embedding
    model, and needs no network access at request time.
  - If this ever needs to scale to comparing tens of thousands of rows,
    or the same vectors need to be reused/persisted across requests
    (e.g. for the "semantic search over stored files" feature), swapping
    the `_vectorize` function below for a real vector DB client
    (e.g. chromadb.Client()) is a self-contained change — nothing in
    app.py needs to know the difference.
"""

from typing import Dict, List, Tuple

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Cosine similarity (0..1) required to accept a fuzzy match. Tuned for
# short key-like strings using character n-grams: 0.6 comfortably catches
# reorderings, minor typos, and partial renames, while still rejecting
# genuinely different keys. Lower = more aggressive matching, more false
# positives; higher = safer, may miss real renames.
DEFAULT_THRESHOLD = 0.6


def _vectorize(texts: List[str]):
    """Turn key strings into TF-IDF vectors over character n-grams.

    char_wb n-grams (word-boundary-aware character n-grams) are used
    instead of word-level tokens because reconciliation keys are often
    short (a name, an ID) where a couple of transposed/typo'd characters
    shouldn't tank the whole similarity score the way a word-level
    tokenizer would.
    """
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), lowercase=True)
    return vectorizer.fit_transform(texts)


def find_fuzzy_matches(
    deleted_texts: Dict[int, str],
    added_texts: Dict[int, str],
    threshold: float = DEFAULT_THRESHOLD,
) -> Tuple[List[Tuple[int, int, float]], List[int], List[int]]:
    """Match leftover "deleted" keys against leftover "added" keys by
    vector similarity.

    Args:
        deleted_texts: {row_index: key_text} for rows that exist in the
            source but had no exact-key match in the target.
        added_texts: {row_index: key_text} for rows that exist in the
            target but had no exact-key match in the source.
        threshold: minimum cosine similarity to accept a pair as a match.

    Returns:
        (matched_pairs, unmatched_deleted_idx, unmatched_added_idx)
        matched_pairs is a list of (deleted_idx, added_idx, confidence)
        sorted by confidence descending. Every index in deleted_texts /
        added_texts appears in exactly one place: either paired up in
        matched_pairs, or in the corresponding unmatched list.
    """
    deleted_idx = list(deleted_texts.keys())
    added_idx = list(added_texts.keys())

    if not deleted_idx or not added_idx:
        return [], deleted_idx, added_idx

    deleted_strings = [deleted_texts[i] for i in deleted_idx]
    added_strings = [added_texts[i] for i in added_idx]

    # Blank keys (e.g. a genuinely empty key column) are meaningless to
    # fuzzy-match against each other — they'd all look "identical" and
    # produce nonsense matches. Skip them entirely; they fall through to
    # unmatched, same as if fuzzy matching had never run.
    vectorizable_deleted = [(i, t) for i, t in zip(deleted_idx, deleted_strings) if t.strip()]
    vectorizable_added = [(i, t) for i, t in zip(added_idx, added_strings) if t.strip()]

    if not vectorizable_deleted or not vectorizable_added:
        return [], deleted_idx, added_idx

    all_strings = [t for _, t in vectorizable_deleted] + [t for _, t in vectorizable_added]
    vectors = _vectorize(all_strings)
    split = len(vectorizable_deleted)
    deleted_vectors = vectors[:split]
    added_vectors = vectors[split:]

    similarity_matrix = cosine_similarity(deleted_vectors, added_vectors)

    # Greedy best-first matching: repeatedly lock in the single
    # highest-similarity pair remaining on the board. This avoids one
    # ambiguous, mediocre match "stealing" a row that has a much better
    # match available elsewhere.
    candidates = [
        (similarity_matrix[r, c], r, c)
        for r in range(similarity_matrix.shape[0])
        for c in range(similarity_matrix.shape[1])
        if similarity_matrix[r, c] >= threshold
    ]
    candidates.sort(key=lambda item: item[0], reverse=True)

    used_rows, used_cols = set(), set()
    matched_pairs: List[Tuple[int, int, float]] = []
    for score, r, c in candidates:
        if r in used_rows or c in used_cols:
            continue
        used_rows.add(r)
        used_cols.add(c)
        deleted_row_idx = vectorizable_deleted[r][0]
        added_row_idx = vectorizable_added[c][0]
        matched_pairs.append((deleted_row_idx, added_row_idx, round(float(score), 4)))

    matched_deleted_idx = {pair[0] for pair in matched_pairs}
    matched_added_idx = {pair[1] for pair in matched_pairs}
    unmatched_deleted_idx = [i for i in deleted_idx if i not in matched_deleted_idx]
    unmatched_added_idx = [i for i in added_idx if i not in matched_added_idx]

    return matched_pairs, unmatched_deleted_idx, unmatched_added_idx