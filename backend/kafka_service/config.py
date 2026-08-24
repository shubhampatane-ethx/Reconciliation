"""
Kafka configuration and topic definitions.
"""

import os

KAFKA_BOOTSTRAP_SERVERS = os.environ.get(
    "KAFKA_BOOTSTRAP_SERVERS",
    "kafka:9092,localhost:9092",
)

KAFKA_ENABLED = os.environ.get("KAFKA_ENABLED", "true").lower() in ("true", "1", "yes")

KAFKA_CLIENT_ID = os.environ.get("KAFKA_CLIENT_ID", "reconcilehub-backend")
KAFKA_CONSUMER_GROUP = os.environ.get("KAFKA_CONSUMER_GROUP", "recon-workers-group")

# Topic Definitions
TOPIC_RECON_JOBS_QUEUED = os.environ.get("TOPIC_RECON_JOBS_QUEUED", "recon.jobs.queued")
TOPIC_RECON_JOBS_COMPLETED = os.environ.get("TOPIC_RECON_JOBS_COMPLETED", "recon.jobs.completed")
TOPIC_RECON_EVENTS_AUDIT = os.environ.get("TOPIC_RECON_EVENTS_AUDIT", "recon.events.audit")
TOPIC_ERP_SYNC_EVENTS = os.environ.get("TOPIC_ERP_SYNC_EVENTS", "erp.sync.events")
TOPIC_RECON_NOTIFICATIONS = os.environ.get("TOPIC_RECON_NOTIFICATIONS", "recon.notifications")

ALL_TOPICS = [
    TOPIC_RECON_JOBS_QUEUED,
    TOPIC_RECON_JOBS_COMPLETED,
    TOPIC_RECON_EVENTS_AUDIT,
    TOPIC_ERP_SYNC_EVENTS,
    TOPIC_RECON_NOTIFICATIONS,
]


def ensure_topics_exist():
    """Idempotently ensure required Kafka topics exist."""
    if not KAFKA_ENABLED:
        return
    try:
        from kafka.admin import KafkaAdminClient, NewTopic
        servers = [s.strip() for s in KAFKA_BOOTSTRAP_SERVERS.split(",") if s.strip()]
        admin = KafkaAdminClient(
            bootstrap_servers=servers,
            client_id=f"{KAFKA_CLIENT_ID}-admin",
            request_timeout_ms=5000,
        )
        existing_topics = set(admin.list_topics())
        new_topics = []
        for topic_name in ALL_TOPICS:
            if topic_name not in existing_topics:
                new_topics.append(NewTopic(name=topic_name, num_partitions=3, replication_factor=1))

        if new_topics:
            admin.create_topics(new_topics=new_topics, validate_only=False)
            print(f"[Kafka] Created missing topics: {[t.name for t in new_topics]}")
        admin.close()
    except Exception as exc:
        print(f"[Kafka] Topic check notice: {exc}")
