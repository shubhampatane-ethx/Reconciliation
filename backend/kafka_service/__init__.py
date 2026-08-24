"""
Kafka Integration Package for ReconcileHub.

Provides robust Kafka producers, consumers, background workers, and topic management
with automatic fallback to synchronous in-process execution when Kafka is unavailable.
"""

from .config import (
    KAFKA_BOOTSTRAP_SERVERS,
    KAFKA_ENABLED,
    TOPIC_RECON_JOBS_QUEUED,
    TOPIC_RECON_JOBS_COMPLETED,
    TOPIC_RECON_EVENTS_AUDIT,
    TOPIC_ERP_SYNC_EVENTS,
    TOPIC_RECON_NOTIFICATIONS,
)
from .producer import get_kafka_producer, publish_recon_job, publish_audit_event, publish_erp_sync_event, publish_notification_event

__all__ = [
    "KAFKA_BOOTSTRAP_SERVERS",
    "KAFKA_ENABLED",
    "TOPIC_RECON_JOBS_QUEUED",
    "TOPIC_RECON_JOBS_COMPLETED",
    "TOPIC_RECON_EVENTS_AUDIT",
    "TOPIC_ERP_SYNC_EVENTS",
    "TOPIC_RECON_NOTIFICATIONS",
    "get_kafka_producer",
    "publish_recon_job",
    "publish_audit_event",
    "publish_erp_sync_event",
    "publish_notification_event",
]
