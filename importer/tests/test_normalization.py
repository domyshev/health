from __future__ import annotations

from health_hub_garmin.normalization import (
    normalize_activity,
    normalize_swimming,
    seconds_per_100m,
)


def test_seconds_per_100m_rejects_invalid_speed():
    assert seconds_per_100m(None) is None
    assert seconds_per_100m(0) is None
    assert seconds_per_100m(-1) is None
    assert seconds_per_100m(0.5) == 200.0


def test_normalize_pool_swim_and_lengths():
    activity = {
        "activityId": 42,
        "activityName": "Lunch Swim",
        "activityType": {"typeKey": "lap_swimming"},
        "startTimeGMT": "2026-09-20 15:00:00",
        "distance": 100.0,
        "duration": 130.0,
        "calories": 75,
        "averageHR": 120,
        "maxHR": 150,
    }
    details = {
        "summaryDTO": {
            "distance": 100.0,
            "duration": 130.0,
            "movingDuration": 120.0,
            "elapsedDuration": 140.0,
            "calories": 75,
            "averageHR": 120,
            "maxHR": 150,
            "averageSpeed": 0.8,
            "poolLength": 25.0,
            "numberOfActiveLengths": 4,
            "totalNumberOfStrokes": 44,
            "averageStrokes": 11.0,
            "averageSwimCadence": 22.0,
            "averageSWOLF": 41.0,
        },
        "metadataDTO": {"lapCount": 1},
    }
    splits = {
        "lapDTOs": [
            {
                "lengthDTOs": [
                    {
                        "startTimeGMT": "2026-09-20 15:00:00",
                        "distance": 25.0,
                        "duration": 30.0,
                        "averageSpeed": 0.833333,
                        "swimStroke": "FREESTYLE",
                        "calories": 10,
                        "averageHR": 118,
                        "maxHR": 130,
                        "totalNumberOfStrokes": 10,
                        "averageSWOLF": 40,
                    },
                    {
                        "startTimeGMT": "2026-09-20 15:00:30",
                        "distance": 0.0,
                        "duration": 10.0,
                        "lengthType": "IDLE",
                    },
                ]
            }
        ]
    }

    normalized = normalize_activity(activity, details)
    swim, lengths = normalize_swimming(activity, details, splits)

    assert normalized == {
        "external_id": "42",
        "activity_type": "lap_swimming",
        "name": "Lunch Swim",
        "started_at": "2026-09-20T15:00:00Z",
        "timezone": None,
        "distance_m": 100.0,
        "duration_s": 130.0,
        "moving_duration_s": 120.0,
        "elapsed_duration_s": 140.0,
        "calories_kcal": 75,
        "average_hr_bpm": 120,
        "max_hr_bpm": 150,
        "source_updated_at": None,
    }
    assert swim["environment"] == "pool"
    assert swim["pool_length_m"] == 25.0
    assert swim["average_pace_per_100m_s"] == 125.0
    assert swim["lap_count"] == 1
    assert lengths[0]["pace_per_100m_s"] == 120.0
    assert lengths[0]["stroke_type"] == "FREESTYLE"
    assert lengths[0]["stroke_count"] == 10
    assert lengths[0]["swolf"] == 40
    assert lengths[0]["is_rest"] is False
    assert lengths[1]["is_rest"] is True


def test_normalize_garmin_activity_dto_shape():
    # Synthetic values exercise the Garmin DTO structure without personal data.
    activity = {
        "activityId": 43,
        "activityName": "Example Open Water Swim",
        "activityTypeDTO": {"typeKey": "open_water_swimming"},
        "summaryDTO": {
            "startTimeGMT": "2000-01-01T12:00:00.0",
            "startTimeLocal": "2000-01-01T12:00:00.0",
            "distance": 100.0,
            "duration": 200.0,
            "movingDuration": 180.0,
            "elapsedDuration": 200.0,
            "calories": 30.0,
            "averageHR": 120.0,
            "maxHR": 140.0,
            "averageSpeed": 0.5,
            "totalNumberOfStrokes": 80,
            "averageSwimCadence": 30.0,
            "averageSWOLF": 50.0,
        },
        "metadataDTO": {"lapCount": 1, "lastUpdateDate": "2000-01-02T12:00:00.0"},
        "timeZoneUnitDTO": {"unitKey": "UTC"},
    }

    normalized = normalize_activity(activity, {"activityDetailMetrics": []})
    swim, _ = normalize_swimming(activity, {"activityDetailMetrics": []}, {"lapDTOs": []})

    assert normalized["activity_type"] == "open_water_swimming"
    assert normalized["started_at"] == "2000-01-01T12:00:00Z"
    assert normalized["timezone"] == "UTC"
    assert normalized["distance_m"] == 100.0
    assert normalized["duration_s"] == 200.0
    assert normalized["calories_kcal"] == 30.0
    assert normalized["average_hr_bpm"] == 120.0
    assert swim["environment"] == "open_water"
    assert swim["average_pace_per_100m_s"] == 200.0


def test_open_water_swim_has_no_pool_length():
    activity = {"activityId": 7, "activityType": {"typeKey": "open_water_swimming"}}

    swim, lengths = normalize_swimming(
        activity, {"summaryDTO": {"poolLength": 25}}, {"lapDTOs": []}
    )

    assert swim["environment"] == "open_water"
    assert swim["pool_length_m"] is None
    assert lengths == []
