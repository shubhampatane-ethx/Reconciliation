import time
import pandas as pd
import random
import os
import json
import sys

# Add backend to path
sys.path.append(os.path.dirname(__file__))

from app import (
    normalize_dataframe, difference_summary, extract_day_summary, resolve_data_type
)
from insights import generate_plain_english_summary
import db as db_module
from storage import (
    create_series, add_series_version, save_series_diff_json, store_series_excel_report
)

def benchmark():
    print("==================================================")
    print("         RECONCILIATION PROFILER START            ")
    print("==================================================")

    # 1. Generate 5,000 rows
    print("1. Generating 5,000 test rows...")
    t0 = time.time()
    src_rows = []
    for i in range(1, 5001):
        src_rows.append({
            "PartyNumber": f"P-{1000+i}",
            "PartyName": f"Acme Corp {i}",
            "Address": f"{i} Main St",
            "City": f"City{i%20}",
            "State": f"State{i%5}",
            "Amount": str(round(random.uniform(100, 5000), 2))
        })
    df_src = normalize_dataframe(pd.DataFrame(src_rows))

    tgt_rows = []
    for i in range(1, 5001):
        amt = 1000.00 if i > 100 else 1050.00  # 100 mismatches
        tgt_rows.append({
            "PartyNumber": f"P-{1000+i}",
            "PartyName": f"Acme Corp {i}",
            "Address": f"{i} Main St",
            "City": f"City{i%20}",
            "State": f"State{i%5}",
            "Amount": str(amt)
        })
    df_tgt = normalize_dataframe(pd.DataFrame(tgt_rows))
    print(f"   Done in {round((time.time() - t0)*1000, 2)} ms")

    # 2. Difference Summary
    print("\n2. Running difference_summary...")
    t = time.time()
    key_columns = ["PartyNumber"]
    data_type = "master"
    diff_report = difference_summary(df_src, df_tgt, key_columns, data_type)
    print(f"   difference_summary took: {round((time.time() - t)*1000, 2)} ms")

    # 3. Day Summary
    print("\n3. Running extract_day_summary...")
    t = time.time()
    day_summary = extract_day_summary(df_src, df_tgt, key_columns, diff_report)
    print(f"   extract_day_summary took: {round((time.time() - t)*1000, 2)} ms")

    # 4. AI Insights
    print("\n4. Running generate_plain_english_summary (AI Insights)...")
    t = time.time()
    insights = generate_plain_english_summary(diff_report, day_summary, key_columns, "Source", "Target")
    print(f"   generate_plain_english_summary took: {round((time.time() - t)*1000, 2)} ms")

    # 5. Database: Create Series
    print("\n5. Registering series in database (create_series)...")
    t = time.time()
    series = create_series("Profiler_Test_Series", "src.csv", df_src, data_type=data_type)
    series_id = series["series_id"]
    db_module.upsert_series_metadata(series_id, series["name"])
    print(f"   create_series took: {round((time.time() - t)*1000, 2)} ms")

    # 6. Save JSON report
    print("\n6. Saving diff JSON report...")
    t = time.time()
    diff_report_filename = save_series_diff_json(series_id, 1, diff_report)
    print(f"   save_series_diff_json took: {round((time.time() - t)*1000, 2)} ms")

    # 7. Generate Excel Report
    print("\n7. Generating Excel Report (store_series_excel_report)...")
    t = time.time()
    excel_report_info = store_series_excel_report(
        series_id, series["name"], "Source", "Target", 1,
        diff_report, key_columns, day_summary,
    )
    print(f"   store_series_excel_report took: {round((time.time() - t)*1000, 2)} ms")

    # 8. Add Series Version
    print("\n8. Adding series version in database (add_series_version)...")
    t = time.time()
    diff_summary = {
        "data_type": data_type,
        "added": diff_report["missing_in_source"]["count"],
        "deleted": diff_report["missing_in_target"]["count"],
        "duplicates": diff_report["duplicates_source"]["count"] + diff_report["duplicates_target"]["count"],
        "updated": diff_report["mismatches"]["count"],
        "renamed": diff_report["fuzzy_matches"]["count"],
        "format_issues": diff_report["format_inconsistencies"]["count"],
        "compared_against_version": 0,
        "compared_against_label": "Source",
    }
    version_entry = add_series_version(
        series_id, "tgt.csv", df_tgt, key_columns,
        diff_summary, excel_report_info["report_file"], label="Target", data_type=data_type,
    )
    db_module.upsert_series_metadata(series_id, series["name"], key_columns)
    db_module.upsert_series_version(
        series_id, 1, "Target", "tgt.csv",
        len(df_tgt), len(df_tgt.columns), key_columns, diff_summary,
        excel_report_info["report_file"],
    )
    print(f"   add_series_version took: {round((time.time() - t)*1000, 2)} ms")

    # 9. Save Row Snapshots
    print("\n9. Saving row snapshots to PostgreSQL (save_row_snapshot)...")
    t = time.time()
    db_module.save_row_snapshot(series_id, 0, key_columns, df_src)
    db_module.save_row_snapshot(series_id, 1, key_columns, df_tgt)
    print(f"   save_row_snapshot took: {round((time.time() - t)*1000, 2)} ms")

    # 10. Value History
    print("\n10. Fetching value history pivot (get_value_history)...")
    t = time.time()
    history = db_module.get_value_history(series_id, only_changed=True)
    print(f"   get_value_history took: {round((time.time() - t)*1000, 2)} ms")

    print("\n==================================================")
    print(f" TOTAL BENCHMARK TIME: {round((time.time() - t0), 3)} seconds")
    print("==================================================")

    # Cleanup
    db_module.delete_series_from_db(series_id)

if __name__ == "__main__":
    benchmark()
