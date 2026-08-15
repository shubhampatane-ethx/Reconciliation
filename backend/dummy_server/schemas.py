"""
=====================================================================
 DUMMY SERVER  ->  schemas.py
=====================================================================
Pydantic request/response models for the Dummy Server API.
Updated to reflect the actual cjbs_target_table column structure
so Swagger UI shows the real schema instead of a generic empty object.
=====================================================================
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class CJBSRowData(BaseModel):
    """
    Represents one row from cjbs_target_table with its actual columns.
    All fields are Optional[str] because any column can be empty,
    and dates/numbers are stored as strings after serialisation.
    """
    project_name_col:            Optional[str] = None  # "Project Name"
    project_number:              Optional[str] = None  # "Project Number"
    project_status:              Optional[str] = None  # "Project Status"
    project_unit:                Optional[str] = None  # "Project Unit"
    project_type:                Optional[str] = None  # "Project Type"
    project_manager:             Optional[str] = None  # "Project Manager"
    customer:                    Optional[str] = None  # "Customer"
    start_date:                  Optional[str] = None  # "Start Date"
    finish_date:                 Optional[str] = None  # "Finish Date"
    project_description:         Optional[str] = None  # "Project Description"
    operating_company:           Optional[str] = None  # "Operating Company (OpCo)"
    branch:                      Optional[str] = None  # "Branch"
    project_ledger_currency:     Optional[str] = None  # "Project Ledger Currency"
    quote_number:                Optional[str] = None  # "Quote Number"
    contract_type:               Optional[str] = None  # "Contract Type"
    product_estimated:           Optional[str] = None  # "Product Estimated"
    distribution_to:             Optional[str] = None  # "Distribution To"
    cost_per_trip_day:           Optional[str] = None  # "Cost Per Trip/Day"

    class Config:
        # Allow extra fields in case the table gets new columns later —
        # the API won't crash, it'll just pass them through.
        extra = "allow"


class TargetRow(BaseModel):
    """
    A single row of target data as returned to the caller.

    row_data holds the actual cjbs_target_table columns.
    Typed as Dict[str, Any] to stay fully generic — the CJBSRowData
    model above documents what's inside for Swagger purposes.
    """
    id: int
    project_name: str
    entity_name: str
    business_key: Optional[str] = None
    updated_at: Optional[str] = None   # str (not datetime) — already serialised
    row_data: Dict[str, Any]           # keys = actual column names from the table

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "project_name": "default_project",
                "entity_name": "cjbs_target_table",
                "business_key": None,
                "updated_at": None,
                "row_data": {
                    "Project Name": "1701 Fall Hill SA 26-27",
                    "Project Number": "0126-6906",
                    "Project Status": "Active",
                    "Project Unit": "CJBS PU",
                    "Project Type": "CJBS_Billable Project Type",
                    "Project Manager": "Halferty, April",
                    "Customer": "THALHIMER",
                    "Start Date": "2026-03-01 00:00:00",
                    "Finish Date": "2027-05-01 00:00:00",
                    "Project Description": "1701 Fall Hill Ave Fredericksburg, VA 22401",
                    "Operating Company (OpCo)": "CJBS",
                    "Branch": "Richmond-C&J-Services",
                    "Project Ledger Currency": "USD",
                    "Quote Number": "0126-6906",
                    "Contract Type": "Service Contract",
                    "Product Estimated": "Tridium",
                    "Distribution To": "CONTRACTOR",
                    "Cost Per Trip/Day": "87"
                }
            }
        }


class TargetDataResponse(BaseModel):
    """
    Response body for GET /target-data.

        {
            "total_records": 103,
            "data": [ ... ]
        }
    """
    total_records: int
    data: List[TargetRow]

    class Config:
        json_schema_extra = {
            "example": {
                "total_records": 103,
                "data": [
                    {
                        "id": 1,
                        "project_name": "default_project",
                        "entity_name": "cjbs_target_table",
                        "business_key": None,
                        "updated_at": None,
                        "row_data": {
                            "Project Name": "1701 Fall Hill SA 26-27",
                            "Project Number": "0126-6906",
                            "Project Status": "Active",
                            "Cost Per Trip/Day": "87"
                        }
                    }
                ]
            }
        }
