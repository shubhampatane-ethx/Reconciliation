"""
Daily Reconciliation Tracker
Manages progressive daily comparisons where each day is compared to the previous day.
"""

import json
import os
from typing import Dict, Optional, List
from datetime import datetime

BASE_DIR = os.path.dirname(__file__)
PERSIST_DIR = os.path.join(BASE_DIR, "vector_store")
DAILY_TRACKING_FILE = os.path.join(PERSIST_DIR, "daily_tracking.json")

os.makedirs(PERSIST_DIR, exist_ok=True)


def _load_daily_tracking() -> Dict:
    """Load daily reconciliation tracking data."""
    if not os.path.exists(DAILY_TRACKING_FILE):
        return {"chains": {}, "baselines": {}}
    try:
        with open(DAILY_TRACKING_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return {"chains": {}, "baselines": {}}


def _save_daily_tracking(data: Dict):
    """Save daily reconciliation tracking data."""
    with open(DAILY_TRACKING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def init_daily_chain(chain_name: str, source_file_id: str) -> Dict:
    """
    Initialize a new daily reconciliation chain.
    
    Args:
        chain_name: Name of the reconciliation chain (e.g., "Customer Data", "Transactions")
        source_file_id: The original source file ID
        
    Returns:
        Chain metadata
    """
    tracking = _load_daily_tracking()
    
    if chain_name in tracking["chains"]:
        return tracking["chains"][chain_name]
    
    chain_data = {
        "name": chain_name,
        "source_file_id": source_file_id,
        "created_at": datetime.now().isoformat(),
        "days": [
            {
                "day": 0,
                "file_id": source_file_id,
                "comparison_date": None,
                "is_source": True,
                "changes": None
            }
        ],
        "baseline_file_id": source_file_id
    }
    
    tracking["chains"][chain_name] = chain_data
    _save_daily_tracking(tracking)
    
    return chain_data


def add_daily_file(chain_name: str, day_number: int, file_id: str, changes: Dict) -> Dict:
    """
    Add a new day's file to the reconciliation chain.
    
    Args:
        chain_name: Name of the chain
        day_number: Day number (1, 2, 3, etc.)
        file_id: The new file ID for this day
        changes: Dictionary with added, deleted, updated row counts and details
        
    Returns:
        Updated chain metadata
    """
    tracking = _load_daily_tracking()
    
    if chain_name not in tracking["chains"]:
        raise ValueError(f"Chain '{chain_name}' does not exist")
    
    chain = tracking["chains"][chain_name]
    
    day_entry = {
        "day": day_number,
        "file_id": file_id,
        "comparison_date": datetime.now().isoformat(),
        "is_source": False,
        "changes": changes
    }
    
    chain["days"].append(day_entry)
    chain["baseline_file_id"] = file_id  # New baseline for next day
    
    tracking["chains"][chain_name] = chain
    _save_daily_tracking(tracking)
    
    return chain


def get_daily_chain(chain_name: str) -> Optional[Dict]:
    """Get the full reconciliation chain."""
    tracking = _load_daily_tracking()
    return tracking["chains"].get(chain_name)


def get_all_chains() -> List[Dict]:
    """Get all reconciliation chains."""
    tracking = _load_daily_tracking()
    return list(tracking["chains"].values())


def get_baseline_file_id(chain_name: str) -> Optional[str]:
    """Get the current baseline file ID for a chain."""
    tracking = _load_daily_tracking()
    chain = tracking["chains"].get(chain_name)
    return chain["baseline_file_id"] if chain else None


def get_day_details(chain_name: str, day_number: int) -> Optional[Dict]:
    """Get details for a specific day in a chain."""
    chain = get_daily_chain(chain_name)
    if not chain:
        return None
    
    for day in chain["days"]:
        if day["day"] == day_number:
            return day
    
    return None


def get_progression_summary(chain_name: str) -> Optional[Dict]:
    """Get a summary of all days in the chain."""
    chain = get_daily_chain(chain_name)
    if not chain:
        return None
    
    summary = {
        "chain_name": chain["name"],
        "created_at": chain["created_at"],
        "total_days": len(chain["days"]) - 1,  # Excluding source day 0
        "days": []
    }
    
    for day in chain["days"]:
        day_summary = {
            "day": day["day"],
            "comparison_date": day["comparison_date"],
            "is_source": day["is_source"]
        }
        
        if day["changes"]:
            day_summary["changes"] = {
                "added_count": day["changes"].get("added_count", 0),
                "deleted_count": day["changes"].get("deleted_count", 0),
                "updated_count": day["changes"].get("updated_count", 0),
                "total_changes": day["changes"].get("total_changes", 0)
            }
        
        summary["days"].append(day_summary)
    
    return summary
