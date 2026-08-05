import psycopg2
import os
from psycopg2.extras import RealDictCursor

db_url = os.environ.get("DATABASE_URL", "postgresql://consistency:consistency@reconciliation-db-1:5432/consistency")
conn = psycopg2.connect(db_url)
cur = conn.cursor(cursor_factory=RealDictCursor)

cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
for r in cur.fetchall():
    print(r)

conn.close()
