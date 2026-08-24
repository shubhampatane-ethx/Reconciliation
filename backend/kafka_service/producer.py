"""
Kafka Producer Manager with automatic fallback and non-blocking delivery.
"""

import json
import logging
from typing import Any, Dict, Optional

from .config import (
    KAFKA_BOOTSTRAP_SERVERS,
    KAFKA_CLIENT_ID,
    KAFKA_ENABLED,
    TOPIC_ERP_SYNC_EVENTS,
    TOPIC_RECON_EVENTS_AUDIT,
    TOPIC_RECON_JOBS_COMPLETED,
    TOPIC_RECON_JOBS_QUEUED,
    TOPIC_RECON_NOTIFICATIONS,
)

logger = logging.getLogger("kafka_producer")

_producer_instance = None
_producer_failed = False


def _json_serializer(v: Any) -> bytes:
    return json.dumps(v, default=str).encode("utf-8")


def get_kafka_producer():
    """Returns singleton KafkaProducer or None if unavailable/disabled."""
    global _producer_instance, _producer_failed
    if not KAFKA_ENABLED or _producer_failed:
        return None

    if _producer_instance is not None:
        return _producer_instance

    try:
        from kafka import KafkaProducer
        servers = [s.strip() for s in KAFKA_BOOTSTRAP_SERVERS.split(",") if s.strip()]
        _producer_instance = KafkaProducer(
            bootstrap_servers=servers,
            client_id=KAFKA_CLIENT_ID,
            value_serializer=_json_serializer,
            key_serializer=lambda k: str(k).encode("utf-8") if k is not None else None,
            retries=3,
            request_timeout_ms=5000,
            max_block_ms=3000,
            acks=1,
        )
        logger.info(f"[Kafka Producer] Connected to {servers}")
        return _producer_instance
    except Exception as exc:
        logger.warning(f"[Kafka Producer] Could not connect to Kafka ({exc}). Fallback to sync mode.")
        _producer_failed = True
        return None


def is_kafka_available() -> bool:
    """Checks if Kafka producer is available and healthy."""
    producer = get_kafka_producer()
    return producer is not None


def publish_recon_job(job_id: str, payload: Dict[str, Any]) -> bool:
    """Publishes a reconciliation job to the queue topic."""
    producer = get_kafka_producer()
    if producer is None:
        return False
    try:
        future = producer.send(
            TOPIC_RECON_JOBS_QUEUED,
            key=job_id,
            value=payload,
        )
        producer.flush(timeout=2)
        logger.info(f"[Kafka] Published job {job_id} to {TOPIC_RECON_JOBS_QUEUED}")
        return True
    except Exception as exc:
        logger.error(f"[Kafka] Failed to publish job {job_id}: {exc}")
        return False


def publish_recon_completed(job_id: str, payload: Dict[str, Any]) -> bool:
    """Publishes a completed job notification."""
    producer = get_kafka_producer()
    if producer is None:
        return False
    try:
        producer.send(
            TOPIC_RECON_JOBS_COMPLETED,
            key=job_id,
            value=payload,
        )
        producer.flush(timeout=2)
        return True
    except Exception as exc:
        logger.error(f"[Kafka] Failed to publish completion for job {job_id}: {exc}")
        return False


def publish_audit_event(event_type: str, payload: Dict[str, Any], user_id: Optional[int] = None) -> bool:
    """Publishes an audit / telemetry event to the audit topic."""
    producer = get_kafka_producer()
    if producer is None:
        return False
    try:
        event = {
            "event_type": event_type,
            "user_id": user_id,
            "payload": payload,
        }
        producer.send(
            TOPIC_RECON_EVENTS_AUDIT,
            key=event_type,
            value=event,
        )
        producer.flush(timeout=1)
        return True
    except Exception as exc:
        logger.debug(f"[Kafka] Failed to publish audit event {event_type}: {exc}")
        return False


def publish_erp_sync_event(payload: Dict[str, Any]) -> bool:
    """Publishes an ERP sync trigger event."""
    producer = get_kafka_producer()
    if producer is None:
        return False
    try:
        sync_id = payload.get("sync_id", "sync")
        producer.send(
            TOPIC_ERP_SYNC_EVENTS,
            key=sync_id,
            value=payload,
        )
        producer.flush(timeout=2)
        return True
    except Exception as exc:
        logger.error(f"[Kafka] Failed to publish ERP sync event: {exc}")
        return False


def publish_notification_event(job_id: str, user_id: Optional[int], status: str, details: str) -> bool:
    """Publishes a notification event (for email alerts etc) to the notifications topic."""
    producer = get_kafka_producer()
    if producer is None:
        return False
    try:
        payload = {
            "job_id": job_id,
            "user_id": user_id,
            "status": status,
            "details": details,
        }
        producer.send(
            TOPIC_RECON_NOTIFICATIONS,
            key=job_id,
            value=payload,
        )
        producer.flush(timeout=2)
        logger.info(f"[Kafka] Published notification event for job {job_id} ({status}) to {TOPIC_RECON_NOTIFICATIONS}")
        return True
    except Exception as exc:
        logger.error(f"[Kafka] Failed to publish notification event for job {job_id}: {exc}")
        return False

