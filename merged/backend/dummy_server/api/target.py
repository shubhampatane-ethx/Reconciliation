"""
=====================================================================
 DUMMY SERVER  ->  api/target.py
=====================================================================
NEW FILE — Phase 1 addition.

Purpose:
    "API layer" for the Dummy Server — the ONLY HTTP-facing part of
    this whole module. Defines:

        GET /target-data

    which is the exact endpoint the existing (Flask) reconciliation
    backend will call to fetch "target system" data instead of the
    user uploading a Target file by hand.

    This file deliberately contains NO business logic itself — it
    just validates the request, calls into services/target_service.py,
    and shapes the response using schemas.py. That is the
    "Repository / Service Architecture" separation asked for.
=====================================================================
"""

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from dummy_server.database import get_db
from dummy_server.schemas import TargetDataResponse
from dummy_server.services import target_service
from dummy_server.target_registry import TARGET_REGISTRY, DEFAULT_PROJECT

# A dedicated router keeps this endpoint self-contained; app.py just
# mounts it. Tag shows up nicely in the auto-generated /docs UI.
router = APIRouter(tags=["target-data"])


@router.get("/target-projects")
def list_target_projects():
    """
    List every project_name this Dummy Server can serve target data
    for (see target_registry.py), plus which one is used by default
    when a caller doesn't specify project_name at all.

    NEW -- Multi-target addition. Lets the main Flask backend / frontend
    build a "which target dataset?" picker instead of only ever being
    able to fetch CJBS.
    """
    return {
        "default_project": DEFAULT_PROJECT,
        "projects": [
            {"project_name": key, "label": entry["label"]}
            for key, entry in TARGET_REGISTRY.items()
        ],
    }


@router.get("/target-data", response_model=TargetDataResponse)
def read_target_data(
    project_name: Optional[str] = None,
    entity_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Return target data as JSON, simulating a call to an external
    enterprise system.

    Optional query params let a caller narrow the results down to one
    client/project and/or one entity type, e.g.:

        GET /target-data?project_name=acme_corp&entity_name=customer

    With no query params at all, every target row in the table is
    returned (fine for a "dummy" server / small demo datasets).
    """
    rows = target_service.get_target_data(
        db, project_name=project_name, entity_name=entity_name
    )
    return TargetDataResponse(total_records=len(rows), data=rows)
