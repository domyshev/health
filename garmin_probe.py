#!/usr/bin/env python3
"""Read-only smoke test for an unofficial Garmin Connect client."""

from __future__ import annotations

import contextlib
import argparse
import json
import sys
from datetime import date
from getpass import getpass
from pathlib import Path
from typing import Any, Callable

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)


TOKEN_DIR = Path(__file__).resolve().parent / ".secrets" / "garmin"


def login() -> Garmin:
    """Restore saved tokens or perform an interactive login."""
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)

    try:
        client = Garmin()
        client.login(str(TOKEN_DIR))
        print("Авторизация: использован сохранённый токен.")
        return client
    except (GarminConnectAuthenticationError, GarminConnectConnectionError):
        pass

    print("Сохранённого токена нет или он недействителен.")
    email = input("Garmin email: ").strip()
    password = getpass("Garmin password (не отображается): ")
    client = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("Garmin MFA code: ").strip(),
    )
    password = ""
    client.login(str(TOKEN_DIR))
    print(f"Авторизация успешна. Токен сохранён в {TOKEN_DIR}")
    return client


def read(label: str, call: Callable[[], Any]) -> Any | None:
    """Call one read-only endpoint without aborting the whole probe."""
    try:
        value = call()
        print(f"✓ {label}")
        return value
    except Exception as exc:  # Endpoints vary by account and region.
        print(f"✗ {label}: {type(exc).__name__}: {exc}")
        return None


def activity_preview(activity: dict[str, Any]) -> dict[str, Any]:
    """Return a deliberately small, non-GPS activity preview."""
    activity_type = activity.get("activityType") or {}
    return {
        "activityId": activity.get("activityId"),
        "name": activity.get("activityName"),
        "type": activity_type.get("typeKey"),
        "startedAtLocal": activity.get("startTimeLocal"),
        "durationSeconds": activity.get("duration"),
        "distanceMeters": activity.get("distance"),
        "caloriesKcal": activity.get("calories"),
        "averageHeartRateBpm": activity.get("averageHR"),
        "maxHeartRateBpm": activity.get("maxHR"),
    }


def seconds_per_100m(speed_mps: Any) -> float | None:
    if not isinstance(speed_mps, (int, float)) or speed_mps <= 0:
        return None
    return round(100 / speed_mps, 1)


def swim_preview(
    client: Garmin, activity: dict[str, Any]
) -> dict[str, Any] | None:
    """Fetch a detailed swim summary without GPS coordinates."""
    activity_type = (activity.get("activityType") or {}).get("typeKey") or ""
    if "swim" not in activity_type:
        return None

    activity_id = str(activity["activityId"])
    detail = client.get_activity(activity_id)
    summary = detail.get("summaryDTO") or {}
    split_data = client.get_activity_splits(activity_id)
    laps = split_data.get("lapDTOs") or []

    stroke_lengths: dict[str, int] = {}
    stroke_distances: dict[str, float] = {}
    for lap in laps:
        for length in lap.get("lengthDTOs") or []:
            stroke = length.get("swimStroke")
            distance = length.get("distance")
            if not stroke or not isinstance(distance, (int, float)) or distance <= 0:
                continue
            stroke_lengths[stroke] = stroke_lengths.get(stroke, 0) + 1
            stroke_distances[stroke] = round(
                stroke_distances.get(stroke, 0.0) + distance, 1
            )

    environment = {
        "lap_swimming": "pool",
        "open_water_swimming": "open_water",
    }.get(activity_type, "other")

    return {
        "activityId": activity.get("activityId"),
        "name": activity.get("activityName"),
        "type": activity_type,
        "environment": environment,
        "startedAtLocal": activity.get("startTimeLocal"),
        "distanceMeters": summary.get("distance"),
        "durationSeconds": summary.get("duration"),
        "movingDurationSeconds": summary.get("movingDuration"),
        "elapsedDurationSeconds": summary.get("elapsedDuration"),
        "caloriesKcal": summary.get("calories"),
        "bmrCaloriesKcal": summary.get("bmrCalories"),
        "averagePacePer100mSeconds": seconds_per_100m(summary.get("averageSpeed")),
        "maxPacePer100mSeconds": seconds_per_100m(summary.get("maxSpeed")),
        "averageHeartRateBpm": summary.get("averageHR"),
        "maxHeartRateBpm": summary.get("maxHR"),
        "poolLengthMeters": summary.get("poolLength"),
        "activeLengths": summary.get("numberOfActiveLengths"),
        "lapCount": (detail.get("metadataDTO") or {}).get("lapCount"),
        "totalStrokes": summary.get("totalNumberOfStrokes"),
        "averageStrokesPerLength": summary.get("averageStrokes"),
        "averageStrokeCadencePerMinute": summary.get("averageSwimCadence"),
        "averageSwolf": summary.get("averageSWOLF"),
        "strokeLengths": stroke_lengths,
        "strokeDistancesMeters": stroke_distances,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only Garmin Connect probe")
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="Date to query in YYYY-MM-DD format (default: today)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("Garmin Connect: проверка чтения данных (без изменений аккаунта)\n")
    client = login()
    query_date = date.fromisoformat(args.date).isoformat()

    summary = read("дневная сводка", lambda: client.get_user_summary(query_date))
    heart_rate = read("пульс", lambda: client.get_heart_rates(query_date))
    sleep = read("сон", lambda: client.get_sleep_data(query_date))
    activities = read("последние тренировки", lambda: client.get_activities(0, 5))

    detailed_swims = []
    for activity in activities or []:
        if "swim" not in ((activity.get("activityType") or {}).get("typeKey") or ""):
            continue
        detailed = read(
            f"детали плавания {activity.get('activityId')}",
            lambda activity=activity: swim_preview(client, activity),
        )
        if detailed:
            detailed_swims.append(detailed)

    result = {
        "date": query_date,
        "summary": {
            "steps": (summary or {}).get("totalSteps"),
            "caloriesKcal": (summary or {}).get("totalKilocalories"),
            "distanceMeters": (summary or {}).get("totalDistanceMeters"),
        },
        "heartRate": {
            "restingBpm": (heart_rate or {}).get("restingHeartRate"),
            "maxBpm": (heart_rate or {}).get("maxHeartRate"),
        },
        "sleep": {
            "seconds": ((sleep or {}).get("dailySleepDTO") or {}).get("sleepTimeSeconds"),
            "score": (((sleep or {}).get("dailySleepDTO") or {}).get("sleepScores") or {})
            .get("overall", {})
            .get("value"),
        },
        "recentActivities": [activity_preview(item) for item in (activities or [])],
        "detailedSwims": detailed_swims,
    }

    print("\nПолученные данные (сокращённая выборка, без GPS):")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GarminConnectAuthenticationError as exc:
        print(f"Ошибка авторизации Garmin: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    except GarminConnectTooManyRequestsError as exc:
        print(f"Garmin временно ограничил запросы: {exc}", file=sys.stderr)
        raise SystemExit(3) from exc
    except GarminConnectConnectionError as exc:
        print(f"Ошибка соединения с Garmin: {exc}", file=sys.stderr)
        raise SystemExit(4) from exc
    except KeyboardInterrupt:
        print("\nОстановлено пользователем.")
