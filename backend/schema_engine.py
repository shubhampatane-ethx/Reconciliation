"""
Enterprise-Grade Dynamic Schema Mapping Engine.

Dataset-agnostic schema discovery, profiling, semantic type inference, 8-signal scoring,
similarity matrix computation, Hungarian global optimal assignment (scipy.optimize.linear_sum_assignment),
and key candidate detection.

Zero hardcoded column names, zero hardcoded primary keys, zero hardcoded dataset logic.
"""

import re
import math
import difflib
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Any, Optional
from scipy.optimize import linear_sum_assignment


def normalize_header(name: str) -> str:
    """Generic header normalization: lowercase, strip system prefixes/suffixes, camelCase splitting."""
    if not name:
        return ""
    s = str(name)
    # Strip common system prefixes & suffixes
    s = re.sub(r'^(site1_|site2_|src_|tgt_|source_|target_|ora_|db_)', '', s, flags=re.IGNORECASE)
    s = re.sub(r'(_original|_ora|_src|_tgt|_source|_target|_desc|_table|_file|_data|_info)$', '', s, flags=re.IGNORECASE)
    # Split camelCase
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)
    # Keep only alphanumeric and spaces
    s = re.sub(r'[^a-zA-Z0-9\s]', ' ', s).lower()
    # Normalize spaces
    return " ".join(s.split())


class ColumnProfiler:
    """Dynamically profiles any DataFrame column without dataset-specific assumptions."""

    @staticmethod
    def profile_column(series: pd.Series, col_name: str) -> Dict[str, Any]:
        total_rows = len(series)
        non_null_series = series.dropna()
        non_null_count = len(non_null_series)
        null_count = total_rows - non_null_count
        null_pct = round((null_count / total_rows * 100.0), 2) if total_rows > 0 else 0.0

        unique_count = int(non_null_series.nunique())
        uniqueness_ratio = round((unique_count / non_null_count), 4) if non_null_count > 0 else 0.0
        duplicate_count = non_null_count - unique_count

        samples = non_null_series.head(10).astype(str).tolist()

        profile = {
            "column_name": col_name,
            "normalized_name": normalize_header(col_name),
            "pandas_dtype": str(series.dtype),
            "total_rows": total_rows,
            "non_null_count": non_null_count,
            "null_count": null_count,
            "null_percentage": null_pct,
            "unique_count": unique_count,
            "uniqueness_ratio": uniqueness_ratio,
            "duplicate_count": duplicate_count,
            "sample_values": samples[:5],
            "min_val": None,
            "max_val": None,
            "mean_val": None,
            "median_val": None,
            "std_val": None,
            "avg_str_length": 0.0,
            "value_pattern": None,
        }

        # Numeric stats
        if pd.api.types.is_numeric_dtype(series):
            if non_null_count > 0:
                profile["min_val"] = float(non_null_series.min())
                profile["max_val"] = float(non_null_series.max())
                profile["mean_val"] = float(non_null_series.mean())
                profile["median_val"] = float(non_null_series.median())
                profile["std_val"] = float(non_null_series.std()) if non_null_count > 1 else 0.0
        else:
            str_vals = non_null_series.astype(str)
            if len(str_vals) > 0:
                profile["avg_str_length"] = round(float(str_vals.str.len().mean()), 2)

        profile["inferred_logical_type"] = TypeInferenceEngine.infer_type(series, profile)
        return profile


class TypeInferenceEngine:
    """Infers semantic data types from actual data distributions and value patterns."""

    EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    PHONE_RE = re.compile(r"^\+?[0-9()\-.\s]{7,20}$")
    UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    ID_RE = re.compile(r"^[A-Za-z0-9\-_/#]+$")

    @classmethod
    def infer_type(cls, series: pd.Series, profile: Dict[str, Any]) -> str:
        s = series.dropna().astype(str).str.strip()
        if len(s) == 0:
            return "String"

        # Check Boolean
        unique_lower = set(s.str.lower().unique())
        if unique_lower.issubset({"true", "false", "1", "0", "yes", "no", "y", "n", "t", "f"}):
            return "Boolean"

        # Check Numeric
        if pd.api.types.is_numeric_dtype(series):
            if pd.api.types.is_integer_dtype(series):
                if profile["uniqueness_ratio"] > 0.85:
                    return "Identifier"
                return "Integer"
            return "Decimal"

        # Try Date / Datetime
        parsed_dates = pd.to_datetime(s.head(100), format='mixed', errors="coerce")
        if parsed_dates.notna().mean() >= 0.7:
            return "Datetime" if any(":" in v for v in s.head(10)) else "Date"

        # Email check
        if s.apply(lambda v: bool(cls.EMAIL_RE.match(v))).mean() >= 0.7:
            return "Email"

        # Phone check
        if s.apply(lambda v: bool(cls.PHONE_RE.match(v)) and sum(c.isdigit() for c in v) >= 7).mean() >= 0.7:
            return "Phone"

        # Identifier check (high uniqueness string/alphanumeric)
        if profile["uniqueness_ratio"] >= 0.85 and s.apply(lambda v: bool(cls.ID_RE.match(v))).mean() >= 0.85:
            return "Identifier"

        # Categorical
        if profile["uniqueness_ratio"] <= 0.20 and profile["unique_count"] <= 50:
            return "Categorical"

        if profile["avg_str_length"] > 40:
            return "Free Text"

        return "String"


class MultiSignalMatcher:
    """Calculates weighted similarity scores across 8 independent signals."""

    # Configurable weights for 8 signals
    WEIGHTS = {
        "header_similarity": 0.25,
        "datatype_compatibility": 0.15,
        "value_overlap": 0.20,
        "pattern_similarity": 0.10,
        "profile_similarity": 0.10,
        "semantic_similarity": 0.10,
        "uniqueness_compatibility": 0.05,
        "null_compatibility": 0.05,
    }

    @classmethod
    def compute_signal_scores(
        cls,
        src_profile: Dict[str, Any],
        tgt_profile: Dict[str, Any],
        src_series: pd.Series,
        tgt_series: pd.Series,
    ) -> Dict[str, float]:
        # Signal 1: Header Similarity
        h1 = src_profile["normalized_name"]
        h2 = tgt_profile["normalized_name"]
        header_sim = difflib.SequenceMatcher(None, h1, h2).ratio()
        if h1 and h2 and (h1 in h2 or h2 in h1):
            header_sim = max(header_sim, 0.85)

        # Signal 2: Datatype Compatibility
        type_match = 1.0 if src_profile["inferred_logical_type"] == tgt_profile["inferred_logical_type"] else 0.4
        if {src_profile["inferred_logical_type"], tgt_profile["inferred_logical_type"]}.issubset({"Integer", "Decimal", "Identifier"}):
            type_match = max(type_match, 0.8)
        if {src_profile["inferred_logical_type"], tgt_profile["inferred_logical_type"]}.issubset({"Date", "Datetime"}):
            type_match = max(type_match, 0.9)

        # Signal 3: Value Overlap
        s_vals = set(src_series.dropna().astype(str).str.strip().head(500))
        t_vals = set(tgt_series.dropna().astype(str).str.strip().head(500))
        if s_vals and t_vals:
            intersection = len(s_vals & t_vals)
            union = len(s_vals | t_vals)
            value_overlap = intersection / union if union > 0 else 0.0
        else:
            value_overlap = 0.0

        # Signal 4: Pattern Similarity
        pattern_sim = 1.0 if src_profile["inferred_logical_type"] in ("Email", "Phone", "Identifier", "Date", "Datetime") and src_profile["inferred_logical_type"] == tgt_profile["inferred_logical_type"] else 0.5

        # Signal 5: Profile Similarity
        len_diff = abs(src_profile["avg_str_length"] - tgt_profile["avg_str_length"])
        profile_sim = max(0.0, 1.0 - (len_diff / 50.0)) if src_profile["avg_str_length"] > 0 else 0.7

        # Signal 6: Semantic Similarity
        # Token set overlap on headers
        tokens1 = set(h1.split())
        tokens2 = set(h2.split())
        semantic_sim = len(tokens1 & tokens2) / len(tokens1 | tokens2) if tokens1 or tokens2 else 0.0

        # Signal 7: Uniqueness Compatibility
        uniq_diff = abs(src_profile["uniqueness_ratio"] - tgt_profile["uniqueness_ratio"])
        uniqueness_comp = max(0.0, 1.0 - uniq_diff)

        # Signal 8: Null Compatibility
        null_diff = abs(src_profile["null_percentage"] - tgt_profile["null_percentage"])
        null_comp = max(0.0, 1.0 - (null_diff / 100.0))

        return {
            "header_similarity": round(header_sim, 4),
            "datatype_compatibility": round(type_match, 4),
            "value_overlap": round(value_overlap, 4),
            "pattern_similarity": round(pattern_sim, 4),
            "profile_similarity": round(profile_sim, 4),
            "semantic_similarity": round(semantic_sim, 4),
            "uniqueness_compatibility": round(uniqueness_comp, 4),
            "null_compatibility": round(null_comp, 4),
        }

    @classmethod
    def calculate_overall_confidence(cls, signals: Dict[str, float]) -> float:
        total = sum(signals[k] * cls.WEIGHTS[k] for k in cls.WEIGHTS)
        return round(total, 4)

    @classmethod
    def categorize_confidence(cls, score: float) -> str:
        if score >= 0.85:
            return "VERY HIGH"
        if score >= 0.70:
            return "HIGH"
        if score >= 0.50:
            return "NEEDS REVIEW"
        return "LOW"


class MappingOptimizer:
    """Uses Hungarian Algorithm (scipy.optimize.linear_sum_assignment) for global 1-to-1 column matching."""

    @staticmethod
    def optimize_assignments(matrix: np.ndarray) -> List[Tuple[int, int]]:
        if matrix.size == 0:
            return []
        # Convert similarity matrix (high is good) to cost matrix (low is good)
        cost_matrix = 1.0 - matrix
        row_ind, col_ind = linear_sum_assignment(cost_matrix)
        return list(zip(row_ind, col_ind))


class KeyCandidateDetector:
    """Ranks dynamic primary/key candidates for source and target datasets."""

    @staticmethod
    def detect_candidates(df: pd.DataFrame) -> List[Dict[str, Any]]:
        candidates = []
        for col in df.columns:
            series = df[col]
            profile = ColumnProfiler.profile_column(series, col)

            # Score key suitability
            score = 0.0
            # 1. Uniqueness
            score += profile["uniqueness_ratio"] * 0.55
            # 2. Non-null completeness
            completeness = (100.0 - profile["null_percentage"]) / 100.0
            score += completeness * 0.25
            # 3. Header keyword bonus
            norm_name = profile["normalized_name"]
            if any(k in norm_name for k in ["id", "num", "number", "code", "key", "no"]):
                score += 0.20

            candidates.append({
                "column_name": col,
                "score": round(score, 4),
                "uniqueness_ratio": profile["uniqueness_ratio"],
                "null_percentage": profile["null_percentage"],
                "logical_type": profile["inferred_logical_type"],
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates


def generate_schema_mapping_analysis(df_source: pd.DataFrame, df_target: pd.DataFrame) -> Dict[str, Any]:
    """
    Main entry point for Header/Column Mapping mode.
    Profiles source & target columns, computes full 8-signal matrix, runs Hungarian optimization,
    detects key candidates, and generates explainable mapping payload.
    """
    src_cols = list(df_source.columns)
    tgt_cols = list(df_target.columns)

    src_profiles = {c: ColumnProfiler.profile_column(df_source[c], c) for c in src_cols}
    tgt_profiles = {c: ColumnProfiler.profile_column(df_target[c], c) for c in tgt_cols}

    n_src = len(src_cols)
    n_tgt = len(tgt_cols)
    similarity_matrix = np.zeros((n_src, n_tgt))
    details_matrix = []

    for i, sc in enumerate(src_cols):
        row_details = []
        for j, tc in enumerate(tgt_cols):
            signals = MultiSignalMatcher.compute_signal_scores(
                src_profiles[sc], tgt_profiles[tc], df_source[sc], df_target[tc]
            )
            overall = MultiSignalMatcher.calculate_overall_confidence(signals)
            similarity_matrix[i, j] = overall
            row_details.append({
                "source_column": sc,
                "target_column": tc,
                "overall_confidence": overall,
                "confidence_category": MultiSignalMatcher.categorize_confidence(overall),
                "signals": signals,
            })
        details_matrix.append(row_details)

    # Hungarian assignment
    assigned_pairs = MappingOptimizer.optimize_assignments(similarity_matrix)
    recommended_mappings = []
    mapped_target_cols = set()

    for i, j in assigned_pairs:
        sc = src_cols[i]
        tc = tgt_cols[j]
        match_detail = details_matrix[i][j]
        # Accept recommendation if overall confidence >= 0.40
        if match_detail["overall_confidence"] >= 0.40:
            recommended_mappings.append({
                "source_column": sc,
                "recommended_target": tc,
                "confidence": match_detail["overall_confidence"],
                "category": match_detail["confidence_category"],
                "signals": match_detail["signals"],
            })
            mapped_target_cols.add(tc)
        else:
            recommended_mappings.append({
                "source_column": sc,
                "recommended_target": "__ignore__",
                "confidence": 0.0,
                "category": "UNMAPPED",
                "signals": match_detail["signals"],
            })

    # Add unmapped source columns
    mapped_src_cols = {m["source_column"] for m in recommended_mappings}
    for sc in src_cols:
        if sc not in mapped_src_cols:
            recommended_mappings.append({
                "source_column": sc,
                "recommended_target": "__ignore__",
                "confidence": 0.0,
                "category": "UNMAPPED",
                "signals": {},
            })

    src_keys = KeyCandidateDetector.detect_candidates(df_source)
    tgt_keys = KeyCandidateDetector.detect_candidates(df_target)

    return {
        "mapping_mode": "HEADER_COLUMN",
        "source_columns": src_cols,
        "target_columns": tgt_cols,
        "source_profiles": src_profiles,
        "target_profiles": tgt_profiles,
        "recommended_mappings": recommended_mappings,
        "suggested_source_key": src_keys[0]["column_name"] if src_keys else (src_cols[0] if src_cols else None),
        "suggested_target_key": tgt_keys[0]["column_name"] if tgt_keys else (tgt_cols[0] if tgt_cols else None),
        "source_key_candidates": src_keys,
        "target_key_candidates": tgt_keys,
        "similarity_matrix": similarity_matrix.tolist(),
    }
