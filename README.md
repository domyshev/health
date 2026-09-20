# health-hub

A self-hosted personal health, fitness, and nutrition data platform. The
project is currently at the Garmin Connect ingestion prototype stage.

The current probe authenticates with Garmin Connect, reuses locally stored
OAuth tokens, and reads daily metrics, recent activities, and detailed swimming
data without relying on Apple Health.

## Garmin Connect client

Garmin data is collected with
[`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect),
installed from PyPI as the `garminconnect` package. The currently tested and
pinned version is `garminconnect==0.3.16` on Python 3.12.

`python-garminconnect` is an unofficial client for Garmin Connect web services.
This repository does not modify the library. Project-specific fetching,
normalization, and derived metrics are implemented in `garmin_probe.py`.

The prototype currently uses read-only methods to retrieve:

- daily steps, calories, and distance;
- heart-rate summaries;
- sleep responses;
- recent activities;
- activity details and splits;
- pool-swimming metrics such as pace, calories, pool length, strokes, stroke
  type, SWOLF, and heart rate per length.

## Run locally

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python garmin_probe.py
```

To query a particular date:

```bash
.venv/bin/python garmin_probe.py --date 2026-09-16
```

On the first run, the script interactively requests the Garmin email, password,
and MFA code when required. The password is not displayed and is not stored by
the project. OAuth tokens are saved under `.secrets/garmin/`, which is excluded
from Git. Later runs reuse the saved token.

## Security and scope

- Never commit or publish `.secrets`, Garmin tokens, raw health payloads, FIT
  files, or precise location data.
- The current client is unofficial and intended for personal use and
  development, not as the authentication foundation for a public multi-user
  service.
- Start with read-only Garmin methods. Upload, edit, and delete operations are
  outside the current project scope.
