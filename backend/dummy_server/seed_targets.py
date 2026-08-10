"""
=====================================================================
 DUMMY SERVER  ->  seed_targets.py
=====================================================================
NEW FILE — Multi-target addition.

Loads EVERY workbook registered in target_registry.py into its own
Postgres table (one DROP + CREATE + bulk-insert per entry), instead
of only ever loading CJBS. This is what fixes "I can only see values
for CJBS, not the other target files" — those other files (Etairos,
Airetech, ATS) were never being loaded into the Target_Data database
at all before this file existed.

Run automatically once per `docker compose up` by the `target_db_seed`
service in docker-compose.yml.

Safe to re-run any time — each table is always dropped and re-created
from its workbook, so re-running (e.g. after replacing a file in
dummy_server/data/) is always safe:
    docker compose run --rm target_db_seed
=====================================================================
"""

from dummy_server.database import engine
from dummy_server.seed_utils import seed_table_from_excel
from dummy_server.target_registry import TARGET_REGISTRY


def run():
    print(f"[seed_targets] Seeding {len(TARGET_REGISTRY)} target table(s): "
          f"{', '.join(TARGET_REGISTRY.keys())}")
    summary = []
    for project_name, entry in TARGET_REGISTRY.items():
        row_count, col_count = seed_table_from_excel(
            engine, entry["file"], entry["table"], label=f"{project_name} ({entry['label']})"
        )
        summary.append((project_name, entry["table"], row_count, col_count))

    print("[seed_targets] Summary:")
    for project_name, table, row_count, col_count in summary:
        status = "OK" if row_count > 0 else "SKIPPED (file missing or empty)"
        print(f"  - {project_name:12s} -> {table:24s} {row_count:5d} row(s) "
              f"{col_count:3d} col(s)  [{status}]")


if __name__ == "__main__":
    run()
