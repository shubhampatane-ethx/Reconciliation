"""
=====================================================================
 DUMMY SERVER  ->  seed_cjbs_target.py
=====================================================================
Loads the real CJBS project-tracker Excel file into the dockerized
Target_Data PostgreSQL database, creating "cjbs_target_table" so it
matches the workbook exactly (column-for-column, all as TEXT).

NOTE: this now seeds ONLY the CJBS table. It's kept around so any
existing `docker compose run --rm target_db_seed` muscle-memory /
docs referencing this module name still work. To seed every
registered target file (CJBS + Etairos + Airetech + ATS) in one go,
use `python -m dummy_server.seed_targets` instead — that's also what
docker-compose.yml's `target_db_seed` service now runs by default.

The actual Excel-reading / table-creation logic lives in seed_utils.py
so this file and seed_targets.py share one identical code path.

Safe to re-run any time: it always DROPs and re-CREATEs the table from
the workbook, so the table is guaranteed to match the file exactly, even
if you replace backend/dummy_server/data/Cjbs_Target_file.xlsx with an
updated export later and re-run.

Run manually if you ever need to reseed without restarting everything:
    docker compose run --rm target_db_seed
=====================================================================
"""

from dummy_server.database import engine
from dummy_server.seed_utils import seed_table_from_excel
from dummy_server.target_registry import TARGET_REGISTRY


def run():
    entry = TARGET_REGISTRY["cjbs"]
    seed_table_from_excel(engine, entry["file"], entry["table"], label=entry["label"])


if __name__ == "__main__":
    run()
