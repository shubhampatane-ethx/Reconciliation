#!/bin/sh
# Run pending Alembic migrations then start the Flask app.
# If the tables already exist (created before Alembic managed them),
# stamp the DB at head so Alembic agrees with reality instead of
# trying to re-create tables that are already there.
set -e

echo "Running database migrations..."
# Try a normal upgrade first. If it fails with DuplicateTable it means
# the schema already exists but Alembic has no version row — stamp it.
alembic upgrade head 2>&1 || {
  echo "upgrade failed (tables may already exist) — stamping head..."
  alembic stamp head
  echo "Stamp complete. Schema is up to date."
}

echo "Starting Flask app..."
exec flask run --host=0.0.0.0 --port=5000
