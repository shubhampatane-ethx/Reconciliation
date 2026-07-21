"""
=====================================================================
 dummy_integration  ->  dummy_client.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    ***THIS is the file where the existing backend talks to the new
    Dummy Server.*** It is a thin HTTP client around the Dummy
    Server's `GET /target-data` endpoint (backend/dummy_server/api/target.py).

    Kept deliberately tiny and isolated so that later, replacing the
    Dummy Server with a real ERP / SAP / Oracle / Salesforce / REST
    API only means changing THIS file (and nothing in routes.py or
    the existing reconciliation code has to change).
=====================================================================
"""

import logging

import requests

from dummy_integration.config import DUMMY_SERVER_BASE_URL, DUMMY_SERVER_TIMEOUT_SECONDS

logger = logging.getLogger("dummy_integration")


def fetch_target_data(project_name: str = None, entity_name: str = None) -> dict:
    """
    Call the Dummy Server's GET /target-data endpoint and return its
    JSON response as a Python dict: {"total_records": N, "data": [...]}.

    Per Phase 1 scope, this JSON is only logged/returned here — it is
    NOT passed into the existing comparison/reconciliation logic yet.

    On any network/HTTP error, this does not raise — it logs the
    problem and returns an empty-but-well-formed payload, so a source
    upload never fails just because the (simulated) external system
    happens to be down.
    """
    params = {}
    if project_name:
        params["project_name"] = project_name
    if entity_name:
        params["entity_name"] = entity_name

    url = f"{DUMMY_SERVER_BASE_URL}/target-data"
    try:
        response = requests.get(url, params=params, timeout=DUMMY_SERVER_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()

        # Step 9 of the requested workflow: "Print or log the response."
        logger.info(
            "Dummy Server returned %s target record(s) for project=%s entity=%s",
            payload.get("total_records"), project_name, entity_name,
        )
        print(f"[dummy_client] Dummy Server response: {payload}")  # simple, visible log for local dev

        return payload
    except requests.RequestException as exc:
        logger.warning("Could not reach Dummy Server at %s: %s", url, exc)
        print(f"[dummy_client] WARNING: could not reach Dummy Server at {url}: {exc}")
        return {"total_records": 0, "data": [], "error": str(exc)}
