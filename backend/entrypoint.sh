#!/bin/sh
# Run pending Alembic migrations (creates/upgrades the `users` table),
# then start the Flask app. Alembic's own retry-free connection is
# usually fine here because docker-compose's `depends_on: db: condition:
# service_healthy` already waits for Postgres to accept connections.
set -e

echo "Running database migrations (alembic upgrade head)..."
alembic upgrade head

echo "Starting Flask app..."
exec flask run --host=0.0.0.0 --port=5000
