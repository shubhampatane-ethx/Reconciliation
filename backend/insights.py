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
        return "barely any changes"
    if pct < 15:
        return "a few routine changes"
    if pct < 35:
        return "a moderate amount of change"
    return "a lot of change"


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


def _describe_shape(members: List[Dict]) -> str:
    """Turn a cluster of raw before/after pairs into one plain phrase
    describing what generally happened, without quoting any actual values."""
    cleared = sum(1 for m in members if m["before"].strip() and not m["after"].strip())
    filled = sum(1 for m in members if not m["before"].strip() and m["after"].strip())
    total = len(members)

    if total and cleared / total >= 0.6:
        return "cleared out"
    if total and filled / total >= 0.6:
        return "filled in for the first time"

    deltas = []
    for m in members:
        before_num = _parse_number(m["before"])
        after_num = _parse_number(m["after"])
        if before_num is not None and after_num is not None:
            deltas.append(after_num - before_num)

    if deltas and len(deltas) / total >= 0.6:
        up = sum(1 for d in deltas if d > 0)
        down = sum(1 for d in deltas if d < 0)
        if up and not down:
            return "increased"
        if down and not up:
            return "decreased"
        if up >= down * 2:
            return "mostly increased"
        if down >= up * 2:
            return "mostly decreased"

    return "changed to a different value"


def _cluster_changes(change_rows: List[Dict], max_clusters: int = 4) -> List[Dict]:
    """Group semantically similar changes using TF-IDF + KMeans. This is
    the 'vector DB + semantic analysis' step: change descriptions that
    share vocabulary (same column, similar wording of the values) land in
    the same cluster even when the exact numbers/text differ. Each cluster
    is then reduced to a plain-English shape (cleared out / filled in /
    increased / etc.) — no raw values are surfaced from here on out."""
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

    clusters = []
    for cluster_id in range(k):
        members = [c for c, lbl in zip(change_rows, labels) if lbl == cluster_id]
        if not members:
            continue
        dominant_column = Counter(m["column"] for m in members).most_common(1)[0][0]
        clusters.append({
            "column": dominant_column,
            "count": len(members),
            "shape": _describe_shape(members),
        })

    clusters.sort(key=lambda c: c["count"], reverse=True)
    return clusters


def _day_trend(day_summary: List[Dict]) -> Dict:
    """Build the per-day breakdown the timeline chart is drawn from, plus
    the couple of facts still worth saying in plain English (busiest day,
    whether some rows had no date at all). The old up/down/flat guess is
    gone — with the actual chart on screen, a two-bucket heuristic just
    hides information the chart already shows better."""
    def issue_count(d):
        return (d.get("missing_in_target", 0) + d.get("missing_in_source", 0)
                + d.get("duplicates_source", 0) + d.get("duplicates_target", 0)
                + d.get("mismatches", 0) + d.get("format_inconsistencies", 0))

    has_undated = any(d.get("date") == "Undated" for d in day_summary)
    dated = [d for d in day_summary if d.get("date") and d["date"] != "Undated"]
    if not dated:
        return {"busiest_day": None, "has_undated": has_undated, "timeline": []}

    dated_sorted = sorted(dated, key=lambda d: d["date"])
    busiest = max(dated_sorted, key=issue_count)

    timeline = [
        {
            "date": d["date"],
            "added": d.get("missing_in_source", 0),
            "deleted": d.get("missing_in_target", 0),
            "duplicates": d.get("duplicates_source", 0) + d.get("duplicates_target", 0),
            "value_changes": d.get("mismatches", 0),
            "format_issues": d.get("format_inconsistencies", 0),
            "total": issue_count(d),
        }
        for d in dated_sorted
    ]

    return {
        "busiest_day": busiest["date"] if issue_count(busiest) > 0 else None,
        "has_undated": has_undated,
        "timeline": timeline,
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
    key_text = ", ".join(key_columns) if key_columns else "a matching column"

    # Semantic clustering of changes — the "vector DB" step. Computed early
    # so its plain-English shape can be woven into the column sentence below
    # instead of appearing as a separate technical "pattern" line.
    change_rows = _change_texts(diff_report)
    clusters = _cluster_changes(change_rows)
    cluster_by_column = {}
    for c in clusters:
        cluster_by_column.setdefault(c["column"], c)

    narrative: List[str] = []

    narrative.append(
        f"Comparing {before_label} ({source_count} rows) to {after_label} ({target_count} rows), matched by {key_text}: "
        f"about {churn_pct}% of rows changed in some way — {churn}."
    )

    change_bits = []
    if added:
        change_bits.append(f"{added} new record{'s' if added != 1 else ''} showed up")
    if deleted:
        change_bits.append(f"{deleted} record{'s' if deleted != 1 else ''} went missing")
    if updated:
        change_bits.append(f"{updated} existing record{'s' if updated != 1 else ''} had something change")
    if change_bits:
        narrative.append(", ".join(change_bits).capitalize() + ".")
    else:
        narrative.append(f"No records were added or removed — {after_label} has exactly the same rows as {before_label}.")

    if renamed:
        narrative.append(
            f"{renamed} record{'s' if renamed != 1 else ''} look{'s' if renamed == 1 else ''} like a rename rather than "
            f"a delete-and-re-add — the name changed, but the rest of the row was similar enough to treat it as the same record."
        )

    if dup_source or dup_target:
        dup_bits = []
        if dup_source:
            dup_bits.append(f"{dup_source} in {before_label}")
        if dup_target:
            dup_bits.append(f"{dup_target} in {after_label}")
        narrative.append(f"Some {key_text} values show up more than once: {' and '.join(dup_bits)} — worth checking these should really be unique.")

    # Column-level breakdown, enriched with what kind of change it mostly
    # was (cleared out / filled in / went up / etc.) using the clusters
    # computed above — plain English, no raw before/after values shown.
    column_counts = _column_change_counts(diff_report)
    top_columns = column_counts.most_common(3)
    mentioned_columns = set()
    if top_columns:
        total_changes = sum(column_counts.values())
        lead_col, lead_count = top_columns[0]
        lead_share = _pct(lead_count, total_changes)
        shape = cluster_by_column.get(lead_col, {}).get("shape")
        shape_bit = f" — most of the time it was {shape}" if shape else ""
        if lead_share >= 40:
            narrative.append(f"Most of the changes happened in one place: the '{lead_col}' column changed {lead_count} times{shape_bit}.")
        else:
            cols_text = ", ".join(f"'{c}'" for c, n in top_columns)
            narrative.append(f"The changes are spread across a few different columns, most often {cols_text}.")
        mentioned_columns.add(lead_col)

    # Any other column with a strong, clear pattern worth calling out on
    # its own (skip the one already covered above).
    for c in clusters:
        if c["column"] in mentioned_columns:
            continue
        if c["count"] < 3:
            continue
        narrative.append(f"'{c['column']}' also changed several times ({c['count']}) — mostly {c['shape']}.")
        mentioned_columns.add(c["column"])
        if len(mentioned_columns) >= 3:
            break

    # Numeric trend per column
    trends = _numeric_trend_per_column(diff_report)
    for col, t in sorted(trends.items(), key=lambda kv: kv[1]["count"], reverse=True)[:3]:
        if t["direction"] in ("increased", "mostly increased", "decreased", "mostly decreased"):
            narrative.append(f"The numbers in '{col}' generally {t['direction']} in {after_label}, by about {abs(t['avg_change'])} on average.")

    if format_issues:
        narrative.append(
            f"{format_issues} value{'s' if format_issues != 1 else ''} only look different because of formatting "
            f"(spacing, capitalization, or how a number is written) — the actual data didn't change."
        )

    # Day-wise trend — the narrative just calls out the busiest day; the
    # actual shape of the trend is shown by the chart on the frontend.
    trend = _day_trend(day_summary or [])
    if trend["busiest_day"]:
        narrative.append(f"The busiest day was {trend['busiest_day']}, with more changes than any other day — see the chart below.")
    if trend.get("has_undated"):
        narrative.append("Some rows didn't have a usable date, so they're grouped under 'Undated'.")

    if touched == 0 and not renamed:
        narrative = [
            f"{before_label} and {after_label} match exactly on the {touched_scope(key_text)} compared — nothing was "
            f"added, removed, or changed."
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
        "timeline": trend["timeline"],
    }


def touched_scope(key_text: str) -> str:
    return f"records ({key_text})"