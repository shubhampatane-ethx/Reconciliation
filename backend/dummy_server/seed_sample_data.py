"""
=====================================================================
 DUMMY SERVER  ->  seed_sample_data.py   (OPTIONAL test utility)
=====================================================================
NEW FILE — Phase 1 addition. Not required for the app to run.

Purpose:
    Inserts a handful of sample target rows into `target_data` so
    there is something for GET /target-data to return while you are
    testing the integration end-to-end. Safe to run multiple times —
    it only inserts if the table is empty for that project/entity.

    Run manually, once, after the table has been created (i.e. after
    app.py has started at least once):

        cd backend/dummy_server
        python seed_sample_data.py
=====================================================================
"""

from dummy_server.database import Base, engine, SessionLocal
from dummy_server.models import TargetData

# Make sure the table exists even if this is run before app.py ever was.
Base.metadata.create_all(bind=engine)

SAMPLE_ROWS = [
    # project_name, entity_name, business_key, row_data
    ("default_project", "customer", "CustomerID", {"CustomerID": 101, "Name": "Amit", "City": "Pune", "Balance": 5000}),
    ("default_project", "customer", "CustomerID", {"CustomerID": 102, "Name": "Priya", "City": "Mumbai", "Balance": 7200}),
    ("default_project", "customer", "CustomerID", {"CustomerID": 103, "Name": "Rahul", "City": "Delhi", "Balance": 3100}),
]


def run():
    db = SessionLocal()
    try:
        inserted = 0
        for project_name, entity_name, business_key, row_data in SAMPLE_ROWS:
            exists = (
                db.query(TargetData)
                .filter(
                    TargetData.project_name == project_name,
                    TargetData.entity_name == entity_name,
                    TargetData.row_data[business_key].astext == str(row_data[business_key]),
                )
                .first()
            )
            if exists:
                continue
            db.add(TargetData(
                project_name=project_name,
                entity_name=entity_name,
                business_key=business_key,
                row_data=row_data,
            ))
            inserted += 1
        db.commit()
        print(f"Seed complete. Inserted {inserted} new row(s).")
    finally:
        db.close()


if __name__ == "__main__":
    run()
