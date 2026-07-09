"""
Plain-English "what's happening in this data" narrative for the
Day-wise Report section.

Same philosophy as fuzzy_match.py: rather than reaching for a hosted
vector database or an LLM API call, every changed cell is turned into a
short text description ("column: before -> after"), embedded as a TF-IDF
vector, and grouped with cosine-similarity-based clustering (KMeans) so
that semantically similar changes land together — e.g. every "Cost Per
Trip/Day went up" edit clusters even though the exact numbers differ.
That in-memory TF-IDF index *is* the vector store here: nothing is
persisted or sent over the network, it's built and discarded within the
request, exactly like the rest of the reconciliation engine.

Each cluster, plus a handful of rule-based statistics (column-level
frequency, numeric trend direction, busiest day), is turned into one or
two plain-English sentences. The output is meant to be read top-to-bottom
as a short report, not just a table of numbers.
"""

import re
from collections import Counter
from typing import Dict, List, Optional

import numpy as np
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer

_NUMBER_RE = re.compile(r"^-?[\d,]*\.?\d+$")


def _parse_number(text: str) -> Optional[float]:
    """Best-effort numeric parse, tolerant of $ and , the same way
    canonical_value() in app.py is — but returns None instead of a
    canonical string, since here we want the actual magnitude."""
    if text is None:
        return None
    stripped = str(text).strip().replace(",", "")
    if stripped.startswith("$"):
        stripped = stripped[1:]
    if not _NUMBER_RE.match(stripped):
        return None
    try:
        return float(stripped)
    except ValueError:
        return None


def _pct(part: int, whole: int) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def _churn_label(pct: float) -> str:
    if pct < 5:
        return "very stable"
    if pct < 15:
        return "mostly stable, with some routine changes"
    if pct < 35:
        return "moderate churn"
    return "significant churn"


def _column_change_counts(diff_report: Dict) -> Counter:
    counts = Counter()
    for bucket in ("mismatches", "format_inconsistencies"):
        for row in diff_report.get(bucket, {}).get("rows", []):
            for col in row.get("changed_columns", []):
                counts[col] += 1
    return counts


def _numeric_trend_per_column(diff_report: Dict) -> Dict[str, Dict]:
    """For every column that changed in a value-mismatch row, work out
    whether its numeric values mostly went up, mostly went down, or moved
    both ways — and by roughly how much on average."""
    per_column = {}
    for row in diff_report.get("mismatches", {}).get("rows", []):
        for diff in row.get("differences", []):
            col = diff.get("column")
            before = _parse_number(diff.get("source_value"))
            after = _parse_number(diff.get("target_value"))
            if before is None or after is None:
                continue
            bucket = per_column.setdefault(col, {"deltas": []})
            bucket["deltas"].append(after - before)

    trends = {}
    for col, data in per_column.items():
        deltas = data["deltas"]
        if not deltas:
            continue
        up = sum(1 for d in deltas if d > 0)
        down = sum(1 for d in deltas if d < 0)
        flat = len(deltas) - up - down
        avg_change = sum(deltas) / len(deltas)
        if up and down == 0 and flat == 0:
            direction = "increased"
        elif down and up == 0 and flat == 0:
            direction = "decreased"
        elif up >= down * 2 and up > flat:
            direction = "mostly increased"
        elif down >= up * 2 and down > flat:
            direction = "mostly decreased"
        else:
            direction = "moved in both directions"
        trends[col] = {
            "count": len(deltas),
            "direction": direction,
            "avg_change": round(avg_change, 2),
        }
    return trends


def _change_texts(diff_report: Dict) -> List[Dict]:
    """Flatten every changed cell (value mismatches + format-only
    differences) into a short text description, ready to vectorize."""
    texts = []
    for bucket, kind in (("mismatches", "value change"), ("format_inconsistencies", "formatting difference")):
        for row in diff_report.get(bucket, {}).get("rows", []):
            for diff in row.get("differences", []):
                col = diff.get("column", "")
                before = str(diff.get("source_value", ""))
                after = str(diff.get("target_value", ""))
                texts.append({
                    "text": f"{col} {kind} {before} {after}",
                    "column": col,
                    "before": before,
                    "after": after,
                    "kind": kind,
                })
    return texts


def _cluster_changes(change_rows: List[Dict], max_clusters: int = 4) -> List[Dict]:
    """Group semantically similar changes using TF-IDF + KMeans. This is
    the 'vector DB + semantic analysis' step: change descriptions that
    share vocabulary (same column, similar wording of the values) land in
    the same cluster even when the exact numbers/text differ."""
    if len(change_rows) < 4:
        return []

    texts = [c["text"] for c in change_rows]
    vectorizer = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), stop_words="english", min_df=1)
    try:
        vectors = vectorizer.fit_transform(texts)
    except ValueError:
        return []

    if vectors.shape[1] == 0:
        return []

    k = max(2, min(max_clusters, len(change_rows) // 3 or 1))
    k = min(k, len(change_rows))
    if k < 2:
        return []

    try:
        labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(vectors)
    except ValueError:
        return []

    feature_names = np.array(vectorizer.get_feature_names_out())
    clusters = []
    for cluster_id in range(k):
        members = [c for c, lbl in zip(change_rows, labels) if lbl == cluster_id]
        if not members:
            continue
        member_mask = labels == cluster_id
        mean_tfidf = np.asarray(vectors[member_mask].mean(axis=0)).ravel()
        top_terms = feature_names[np.argsort(mean_tfidf)[::-1][:3]]
        dominant_column = Counter(m["column"] for m in members).most_common(1)[0][0]
        clusters.append({
            "label": dominant_column,
            "count": len(members),
            "top_terms": [t for t in top_terms if t not in (dominant_column.lower(),)],
            "example": f"{members[0]['column']}: '{members[0]['before']}' → '{members[0]['after']}'",
        })

    clusters.sort(key=lambda c: c["count"], reverse=True)
    return clusters


def _day_trend(day_summary: List[Dict]) -> Dict:
    dated = [d for d in day_summary if d.get("date") and d["date"] != "Undated"]
    if not dated:
        return {"direction": None, "busiest_day": None, "has_undated": any(d.get("date") == "Undated" for d in day_summary)}

    def issue_count(d):
        return (d.get("missing_in_target", 0) + d.get("missing_in_source", 0)
                + d.get("duplicates_source", 0) + d.get("duplicates_target", 0)
                + d.get("mismatches", 0) + d.get("format_inconsistencies", 0))

    dated_sorted = sorted(dated, key=lambda d: d["date"])
    busiest = max(dated_sorted, key=issue_count)

    if len(dated_sorted) >= 2:
        midpoint = len(dated_sorted) // 2
        first_half_avg = sum(issue_count(d) for d in dated_sorted[:midpoint or 1]) / max(midpoint, 1)
        second_half = dated_sorted[midpoint:]
        second_half_avg = sum(issue_count(d) for d in second_half) / max(len(second_half), 1)
        if second_half_avg > first_half_avg * 1.2:
            direction = "up"
        elif second_half_avg < first_half_avg * 0.8:
            direction = "down"
        else:
            direction = "flat"
    else:
        direction = None

    return {
        "direction": direction,
        "busiest_day": busiest["date"] if issue_count(busiest) > 0 else None,
        "has_undated": any(d.get("date") == "Undated" for d in day_summary),
    }


def generate_plain_english_summary(diff_report: Dict, day_summary: List[Dict], key_columns: List[str],
                                    before_label: str = "Source", after_label: str = "Target") -> Dict:
    source_count = diff_report.get("source_record_count", 0)
    target_count = diff_report.get("target_record_count", 0)
    added = diff_report.get("missing_in_source", {}).get("count", 0)
    deleted = diff_report.get("missing_in_target", {}).get("count", 0)
    updated = diff_report.get("mismatches", {}).get("count", 0)
    renamed = diff_report.get("fuzzy_matches", {}).get("count", 0)
    format_issues = diff_report.get("format_inconsistencies", {}).get("count", 0)
    dup_source = diff_report.get("duplicates_source", {}).get("count", 0)
    dup_target = diff_report.get("duplicates_target", {}).get("count", 0)

    touched = added + deleted + updated + dup_source + dup_target
    churn_pct = _pct(touched, max(source_count, target_count))
    churn = _churn_label(churn_pct)
    key_text = ", ".join(key_columns) if key_columns else "the matched key"

    narrative: List[str] = []

    narrative.append(
        f"Comparing {before_label} ({source_count} rows) to {after_label} ({target_count} rows), matched on {key_text}: "
        f"the data is {churn} — about {churn_pct}% of rows were touched in some way."
    )

    change_bits = []
    if added:
        change_bits.append(f"{added} new record{'s' if added != 1 else ''} appeared")
    if deleted:
        change_bits.append(f"{deleted} record{'s' if deleted != 1 else ''} disappeared")
    if updated:
        change_bits.append(f"{updated} existing record{'s' if updated != 1 else ''} had value changes")
    if change_bits:
        narrative.append(", ".join(change_bits).capitalize() + ".")
    else:
        narrative.append(f"No records were added or removed — {after_label} has exactly the same keys as {before_label}.")

    if renamed:
        narrative.append(
            f"{renamed} record{'s' if renamed != 1 else ''} look{'s' if renamed == 1 else ''} like a rename rather than a "
            f"delete+add — the key text changed but the row content matched closely enough (semantic key similarity) to "
            f"treat it as the same record."
        )

    if dup_source or dup_target:
        dup_bits = []
        if dup_source:
            dup_bits.append(f"{dup_source} in {before_label}")
        if dup_target:
            dup_bits.append(f"{dup_target} in {after_label}")
        narrative.append(f"Duplicate keys were found: {' and '.join(dup_bits)} — check whether {key_text} is really unique.")

    # Column-level breakdown
    column_counts = _column_change_counts(diff_report)
    top_columns = column_counts.most_common(3)
    if top_columns:
        total_changes = sum(column_counts.values())
        lead_col, lead_count = top_columns[0]
        lead_share = _pct(lead_count, total_changes)
        if lead_share >= 40:
            narrative.append(
                f"Most of the changes are concentrated in one place: '{lead_col}' accounts for {lead_count} of {total_changes} "
                f"changed cells ({lead_share}%)."
            )
        else:
            cols_text = ", ".join(f"'{c}' ({n})" for c, n in top_columns)
            narrative.append(f"Changes are spread across several fields, most often {cols_text}.")

    # Numeric trend per column
    trends = _numeric_trend_per_column(diff_report)
    for col, t in sorted(trends.items(), key=lambda kv: kv[1]["count"], reverse=True)[:3]:
        if t["direction"] in ("increased", "mostly increased"):
            narrative.append(f"'{col}' values {t['direction']} in {after_label}, by {abs(t['avg_change'])} on average.")
        elif t["direction"] in ("decreased", "mostly decreased"):
            narrative.append(f"'{col}' values {t['direction']} in {after_label}, by {abs(t['avg_change'])} on average.")

    if format_issues:
        narrative.append(
            f"{format_issues} value{'s' if format_issues != 1 else ''} only differ in formatting (spacing, casing, or "
            f"number formatting) — the underlying data didn't actually change."
        )

    # Day-wise trend
    trend = _day_trend(day_summary or [])
    if trend["busiest_day"]:
        narrative.append(f"{trend['busiest_day']} had the most activity of any day in this comparison.")
    if trend["direction"] == "up":
        narrative.append("Issues are trending upward across the date range — later days have more discrepancies than earlier ones.")
    elif trend["direction"] == "down":
        narrative.append("Issues are trending downward across the date range — later days look cleaner than earlier ones.")
    if trend.get("has_undated"):
        narrative.append("Some rows had no usable date and were grouped under 'Undated'.")

    # Semantic clustering of changes ("vector DB" step)
    change_rows = _change_texts(diff_report)
    clusters = _cluster_changes(change_rows)
    for cluster in clusters[:3]:
        narrative.append(
            f"Pattern: {cluster['count']} changes cluster around '{cluster['label']}' — for example {cluster['example']}."
        )

    if touched == 0 and not renamed:
        narrative = [
            f"{before_label} and {after_label} match exactly on the {touched_scope(key_text)} compared — no additions, "
            f"deletions, or value changes were found."
        ]

    return {
        "headline": narrative[0] if narrative else "No comparison data available.",
        "narrative": narrative,
        "churn_percent": churn_pct,
        "churn_label": churn,
        "top_columns": [{"column": c, "changes": n} for c, n in top_columns],
        "numeric_trends": trends,
        "clusters": clusters,
        "day_trend": trend,
    }


def touched_scope(key_text: str) -> str:
    return f"records ({key_text})"