#!/usr/bin/env python3
"""Inspect read-only Garmin swim payloads without dumping GPS or tokens."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from garminconnect import Garmin


ROOT = Path(__file__).resolve().parents[1]
MATCH = re.compile(
    r"activitytype|calor|pace|speed|swim|stroke|pool|length|lap|distance|duration|swolf",
    re.IGNORECASE,
)


def interesting(value: Any, path: str = "") -> list[tuple[str, Any]]:
    found: list[tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}" if path else key
            if isinstance(item, (dict, list)):
                found.extend(interesting(item, child))
            elif MATCH.search(child):
                found.append((child, item))
    elif isinstance(value, list):
        for index, item in enumerate(value[:5]):
            found.extend(interesting(item, f"{path}[{index}]"))
    return found


client = Garmin()
client.login(str(ROOT / ".secrets" / "garmin"))

activities = client.get_activities(0, 20)
swim = next(
    item
    for item in activities
    if "swim" in ((item.get("activityType") or {}).get("typeKey") or "")
)
activity_id = str(swim["activityId"])

payloads = {
    "activity-list-item": swim,
    "activity": client.get_activity(activity_id),
    "splits": client.get_activity_splits(activity_id),
    "typed-splits": client.get_activity_typed_splits(activity_id),
    "split-summaries": client.get_activity_split_summaries(activity_id),
    "details": client.get_activity_details(activity_id),
}

print(f"activityId={activity_id}")
for name, payload in payloads.items():
    print(f"\n## {name}")
    for path, value in interesting(payload):
        print(f"{path}={value!r}")
