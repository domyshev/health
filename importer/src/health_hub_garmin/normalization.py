from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def seconds_per_100m(speed_mps: Any) -> float | None:
    if (
        not isinstance(speed_mps, (int, float))
        or isinstance(speed_mps, bool)
        or speed_mps <= 0
    ):
        return None
    return round(100.0 / float(speed_mps), 1)


def _first(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None:
            return value
    return None


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _iso_datetime(value: Any, *, assume_utc: bool = False) -> str | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = (
            float(value) / 1000
            if abs(float(value)) >= 100_000_000_000
            else float(value)
        )
        try:
            return (
                datetime.fromtimestamp(seconds, tz=UTC)
                .isoformat()
                .replace("+00:00", "Z")
            )
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    candidate = text.replace(" ", "T")
    if candidate.endswith("Z"):
        return candidate
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return text
    if assume_utc and parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    if parsed.tzinfo is not None:
        return parsed.isoformat().replace("+00:00", "Z")
    return parsed.isoformat()


def _activity_type(activity: dict[str, Any]) -> str | None:
    value = activity.get("activityType")
    if isinstance(value, dict):
        type_key = value.get("typeKey")
        return str(type_key) if type_key is not None else None
    return str(value) if value is not None else None


def normalize_activity(
    activity: dict[str, Any], details: dict[str, Any]
) -> dict[str, Any]:
    summary = _as_dict(details.get("summaryDTO"))
    metadata = _as_dict(details.get("metadataDTO"))
    activity_id = _first(activity, "activityId", "activity_id")
    if activity_id is None:
        raise ValueError("activity payload has no activityId")
    started_gmt = _first(summary, "startTimeGMT") or _first(activity, "startTimeGMT")
    started_local = _first(summary, "startTimeLocal") or _first(
        activity, "startTimeLocal"
    )
    timezone = _first(activity, "timeZoneId", "timezone") or _first(
        metadata, "timeZoneId"
    )
    timezone_unit = metadata.get("timeZoneUnitDTO")
    if timezone is None and isinstance(timezone_unit, dict):
        timezone = _first(timezone_unit, "unitKey", "timeZoneId")

    return {
        "external_id": str(activity_id),
        "activity_type": _activity_type(activity),
        "name": _first(activity, "activityName", "name"),
        "started_at": _iso_datetime(started_gmt, assume_utc=True)
        or _iso_datetime(started_local),
        "timezone": timezone,
        "distance_m": _first(summary, "distance")
        if summary
        else _first(activity, "distance"),
        "duration_s": _first(summary, "duration")
        if summary
        else _first(activity, "duration"),
        "moving_duration_s": _first(summary, "movingDuration"),
        "elapsed_duration_s": _first(summary, "elapsedDuration"),
        "calories_kcal": _first(summary, "calories")
        if summary
        else _first(activity, "calories"),
        "average_hr_bpm": _first(summary, "averageHR")
        if summary
        else _first(activity, "averageHR"),
        "max_hr_bpm": _first(summary, "maxHR")
        if summary
        else _first(activity, "maxHR"),
        "source_updated_at": _iso_datetime(
            _first(activity, "activityUpdateTimestamp", "lastUpdated", "updatedAt"),
            assume_utc=True,
        ),
    }


def normalize_swimming(
    activity: dict[str, Any],
    details: dict[str, Any],
    splits: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    activity_type = _activity_type(activity)
    if activity_type == "lap_swimming":
        environment = "pool"
    elif activity_type == "open_water_swimming":
        environment = "open_water"
    else:
        raise ValueError("activity is not a supported swimming activity")

    summary = _as_dict(details.get("summaryDTO"))
    metadata = _as_dict(details.get("metadataDTO"))
    swim = {
        "environment": environment,
        "pool_length_m": _first(summary, "poolLength")
        if environment == "pool"
        else None,
        "active_lengths": _first(summary, "numberOfActiveLengths"),
        "lap_count": _first(metadata, "lapCount"),
        "average_pace_per_100m_s": seconds_per_100m(_first(summary, "averageSpeed")),
        "total_strokes": _first(summary, "totalNumberOfStrokes"),
        "average_strokes_per_length": _first(summary, "averageStrokes"),
        "average_stroke_cadence_per_minute": _first(summary, "averageSwimCadence"),
        "average_swolf": _first(summary, "averageSWOLF"),
    }

    lengths: list[dict[str, Any]] = []
    laps = splits.get("lapDTOs") if isinstance(splits, dict) else None
    for lap_index, lap in enumerate(laps or []):
        if not isinstance(lap, dict):
            continue
        raw_lengths = lap.get("lengthDTOs") or []
        for length_index, length in enumerate(raw_lengths):
            if not isinstance(length, dict):
                continue
            distance = _first(length, "distance")
            length_type = str(_first(length, "lengthType") or "").upper()
            stroke_type = _first(length, "swimStroke")
            is_rest = (
                length_type in {"IDLE", "REST"}
                or stroke_type == "REST"
                or distance in (None, 0)
            )
            lengths.append(
                {
                    "lap_index": lap_index,
                    "length_index": length_index,
                    "started_at": _iso_datetime(
                        _first(length, "startTimeGMT"), assume_utc=True
                    )
                    or _iso_datetime(_first(length, "startTimeLocal")),
                    "distance_m": distance,
                    "duration_s": _first(length, "duration"),
                    "average_speed_mps": _first(length, "averageSpeed"),
                    "pace_per_100m_s": seconds_per_100m(_first(length, "averageSpeed")),
                    "stroke_type": stroke_type,
                    "calories_kcal": _first(length, "calories"),
                    "average_hr_bpm": _first(length, "averageHR"),
                    "max_hr_bpm": _first(length, "maxHR"),
                    "stroke_count": _first(length, "totalNumberOfStrokes", "strokes"),
                    "swolf": _first(length, "averageSWOLF", "swolf"),
                    "is_rest": is_rest,
                }
            )
    return swim, lengths
