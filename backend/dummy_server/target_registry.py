"""
=====================================================================
 DUMMY SERVER  ->  target_registry.py
=====================================================================
NEW FILE — Multi-target addition.

Why this exists:
    Previously the Dummy Server only ever knew about ONE target file
    (Cjbs_Target_file.xlsx -> cjbs_target_table), hard-coded in
    services/target_service.py. Whichever Source file you uploaded and
    whatever project_name you sent, you always got CJBS data back —
    that's why only CJBS values ever showed up.

    This registry is the single source of truth mapping a project_name
    to the Excel file it's seeded from and the Postgres table it lives
    in. Both seed_targets.py (loads every file into its own table) and
    services/target_service.py (picks the right table per request)
    import from here, so the two can never drift out of sync.

Add a new target dataset later by adding ONE entry below — drop the
workbook in dummy_server/data/, add the line, reseed. Nothing else
in this codebase needs to change.
=====================================================================
"""

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"

# project_name (what the frontend/API sends, case-insensitive) -> config
TARGET_REGISTRY = {
    "cjbs": {
        "file": DATA_DIR / "Cjbs_Target_file.xlsx",
        "table": "cjbs_target_table",
        "label": "CJBS Project Tracker",
    },
    "etairos": {
        "file": DATA_DIR / "Etairos-Customers_Recon.xlsx",
        "table": "etairos_target_table",
        "label": "Etairos Customers",
    },
    "airetech": {
        "file": DATA_DIR / "Airetech_Recon.xlsx",
        "table": "airetech_target_table",
        "label": "Airetech",
    },
    "ats": {
        "file": DATA_DIR / "ATS_Recon.xlsx",
        "table": "ats_target_table",
        "label": "ATS",
    },
     "ar_dorse": {
        "file": DATA_DIR / "AR Dorse.xlsx",
        "table": "AR_Dorse_table",
        "label": "AR_Dorse",
    },
    "dorse-ap": {
        "file": DATA_DIR / "Dorse-AP.xlsx",
        "table": "Dorse-AP_table",
        "label": "Dorse-AP",
    },
    "ar_etarios": {
        "file": DATA_DIR / "AR Etarios.xlsx",
        "table": "AR_Etarios_target_table",
        "label": "AR_Etarios",
    },
    "etarios_ap": {
        "file": DATA_DIR / "Etarios_AP.xlsx",
        "table": "Etarios_AP_target_table",
        "label": "Etarios_AP",
    },


}

# Used whenever a caller doesn't specify a project_name at all (keeps
# old behaviour/URLs working exactly as before this change).
DEFAULT_PROJECT = "cjbs"


def normalize_project_name(project_name):
    """Lowercase/trim, e.g. 'Etairos', ' ETAIROS ' -> 'etairos'."""
    if not project_name:
        return None
    return str(project_name).strip().lower()


def resolve_entry(project_name):
    """
    Look up the registry entry for a project_name. Falls back to
    DEFAULT_PROJECT if project_name is missing or unrecognized, so
    existing callers that never set project_name keep working exactly
    as before.
    """
    key = normalize_project_name(project_name)
    if key and key in TARGET_REGISTRY:
        return key, TARGET_REGISTRY[key]
    return DEFAULT_PROJECT, TARGET_REGISTRY[DEFAULT_PROJECT]


def resolve_table(project_name):
    """Convenience wrapper — just the Postgres table name."""
    _, entry = resolve_entry(project_name)
    return entry["table"]
