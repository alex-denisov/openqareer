"""Read-only Google Search Console + PageSpeed client used by server.py.

Pure helpers (validation, request bodies, response shaping) are separate from
the HTTP call so they are unit-tested without the network.
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Protocol
from urllib.parse import quote

GSC_API = "https://www.googleapis.com/webmasters/v3"
INSPECT_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
PAGESPEED_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

DIMENSIONS = frozenset({"query", "page", "country", "device", "date", "searchAppearance"})
OPERATORS = frozenset({"equals", "notEquals", "contains", "notContains",
                       "includingRegex", "excludingRegex"})
SEARCH_TYPES = frozenset({"web", "image", "video", "news", "discover", "googleNews"})
DATA_STATES = frozenset({"final", "all"})
MAX_ROWS = 25_000
CORE_AUDITS = ("first-contentful-paint", "largest-contentful-paint", "total-blocking-time",
               "cumulative-layout-shift", "speed-index", "interactive")


class GscError(RuntimeError):
    """An API call failed; the message is safe to show to the agent."""


class Session(Protocol):
    def request(self, method: str, url: str, **kwargs: Any) -> Any: ...


def site_path(site_url: str) -> str:
    return quote(site_url, safe="")


def _date(value: str, name: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as err:
        raise ValueError(f"{name} должна быть в формате ГГГГ-ММ-ДД, получено {value!r}") from err


def search_analytics_body(start_date: str, end_date: str, dimensions: list[str],
                          row_limit: int, start_row: int,
                          filters: list[dict[str, str]] | None,
                          search_type: str, data_state: str) -> dict[str, Any]:
    if _date(start_date, "start_date") > _date(end_date, "end_date"):
        raise ValueError("start_date позже end_date")
    unknown = [d for d in dimensions if d not in DIMENSIONS]
    if unknown:
        raise ValueError(f"неизвестные измерения {unknown}; допустимы {sorted(DIMENSIONS)}")
    if not 1 <= row_limit <= MAX_ROWS:
        raise ValueError(f"row_limit от 1 до {MAX_ROWS}")
    if start_row < 0:
        raise ValueError("start_row не может быть отрицательным")
    if search_type not in SEARCH_TYPES:
        raise ValueError(f"search_type: одно из {sorted(SEARCH_TYPES)}")
    if data_state not in DATA_STATES:
        raise ValueError("data_state: final или all")
    body: dict[str, Any] = {"startDate": start_date, "endDate": end_date,
                            "dimensions": list(dimensions), "rowLimit": row_limit,
                            "startRow": start_row, "type": search_type,
                            "dataState": data_state}
    if filters:
        body["dimensionFilterGroups"] = [{"filters": [_filter(f) for f in filters]}]
    return body


def _filter(raw: dict[str, str]) -> dict[str, str]:
    dimension, operator = raw.get("dimension"), raw.get("operator", "equals")
    expression = raw.get("expression")
    if dimension not in DIMENSIONS - {"date"}:
        raise ValueError(f"фильтр: неизвестное измерение {dimension!r}")
    if operator not in OPERATORS:
        raise ValueError(f"фильтр: оператор одно из {sorted(OPERATORS)}")
    if not expression:
        raise ValueError("фильтр: пустое expression")
    return {"dimension": dimension, "operator": operator, "expression": expression}


def shape_rows(dimensions: list[str], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**dict(zip(dimensions, r.get("keys", []))),
             "clicks": r.get("clicks", 0), "impressions": r.get("impressions", 0),
             "ctr": round(r.get("ctr", 0.0), 4), "position": round(r.get("position", 0.0), 1)}
            for r in rows]


def summarize_pagespeed(raw: dict[str, Any]) -> dict[str, Any]:
    lh = raw.get("lighthouseResult", {})
    audits = lh.get("audits", {})
    return {
        "url": lh.get("finalUrl"),
        "scores": {k: round((v.get("score") or 0) * 100)
                   for k, v in lh.get("categories", {}).items()},
        "metrics": {k: audits[k].get("displayValue") for k in CORE_AUDITS if k in audits},
        "field_data": raw.get("loadingExperience", {}).get("overall_category"),
    }


def call(session: Session, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    response = session.request(method, url, timeout=120, **kwargs)
    try:
        body = response.json()
    except ValueError:
        body = {}
    if not response.ok:
        err = body.get("error", {}) if isinstance(body, dict) else {}
        raise GscError(f"Google API {response.status_code} {err.get('status', '')}: "
                       f"{err.get('message', 'нет описания')}"[:500])
    return body
