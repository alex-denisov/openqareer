# /// script
# requires-python = ">=3.12"
# dependencies = ["mcp==2.3.0", "google-auth==2.62.1", "requests==2.34.2"]
# ///
"""MCP server: Google Search Console, Indexing API and PageSpeed for openqareer.

Credentials come from GOOGLE_APPLICATION_CREDENTIALS (the openqareer service
account, owner of the Search Console property); scripts/gsc-mcp.sh sets it from
~/.openqareer/openqareer.env. Reports are read with the read-only scope; the
only writes are submit_sitemap and notify_urls, each guarded in gsc_client.
"""
from __future__ import annotations

import functools
import os
from typing import Any, Callable, TypeVar

import requests
from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

import gsc_client as gc

READ_SCOPES = ("https://www.googleapis.com/auth/webmasters.readonly",)
WRITE_SCOPES = ("https://www.googleapis.com/auth/webmasters",
                "https://www.googleapis.com/auth/indexing")
SITE_URL = os.environ.get("GSC_SITE_URL", "https://openqareer.com/")
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=True)
WRITES = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True,
                         openWorldHint=True)

server = MCPServer(
    name="gsc",
    instructions=(
        "Google Search Console, Indexing API и PageSpeed для openqareer.com. "
        f"Ресурс по умолчанию {SITE_URL}. Данные GSC отстают на 2-3 дня; "
        "для свежих дней передавай data_state='all'. Запись только две: "
        "submit_sitemap и notify_urls (Indexing API, только карточки вакансий с "
        "JobPosting; каждый адрес тратит небольшую дневную квоту проекта)."
    ),
)
_sessions: dict[tuple[str, ...], AuthorizedSession] = {}
F = TypeVar("F", bound=Callable[..., Any])


def readable_errors(fn: F) -> F:
    """Bad input and API refusals reach the agent as text, not a bare failure."""
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except (ValueError, gc.GscError) as err:
            raise ToolError(str(err)) from err
    return wrapper  # type: ignore[return-value]


def session(scopes: tuple[str, ...] = READ_SCOPES) -> AuthorizedSession:
    """One session per scope set: reports never carry a write-capable token."""
    if scopes not in _sessions:
        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not path or not os.path.isfile(path):
            raise gc.GscError("GOOGLE_APPLICATION_CREDENTIALS не задан или файла нет")
        creds = service_account.Credentials.from_service_account_file(path, scopes=list(scopes))
        _sessions[scopes] = AuthorizedSession(creds)
    return _sessions[scopes]


@server.tool(annotations=READ_ONLY)
@readable_errors
def list_sites() -> list[dict[str, str]]:
    """Ресурсы Search Console, доступные сервисному аккаунту, и уровень доступа."""
    body = gc.call(session(), "GET", f"{gc.GSC_API}/sites")
    return body.get("siteEntry", [])


@server.tool(annotations=READ_ONLY)
@readable_errors
def search_analytics(start_date: str, end_date: str, dimensions: list[str],
                     row_limit: int = 1000, start_row: int = 0,
                     filters: list[dict[str, str]] | None = None,
                     search_type: str = "web", data_state: str = "final",
                     site_url: str = SITE_URL) -> dict[str, Any]:
    """Отчёт «Эффективность»: клики, показы, CTR, позиция.

    dimensions: query, page, country, device, date, searchAppearance.
    filters: [{"dimension": "page", "operator": "contains", "expression": "/vacancies/"}],
    операторы equals, notEquals, contains, notContains, includingRegex, excludingRegex.
    Строк до 25 000 за запрос; дальше листай start_row.
    """
    body = gc.search_analytics_body(start_date, end_date, dimensions, row_limit, start_row,
                                    filters, search_type, data_state)
    raw = gc.call(session(), "POST",
                  f"{gc.GSC_API}/sites/{gc.site_path(site_url)}/searchAnalytics/query", json=body)
    rows = gc.shape_rows(dimensions, raw.get("rows", []))
    return {"rows": rows, "row_count": len(rows),
            "aggregation": raw.get("responseAggregationType")}


@server.tool(annotations=READ_ONLY)
@readable_errors
def inspect_url(url: str, site_url: str = SITE_URL) -> dict[str, Any]:
    """Проверка URL: в индексе ли страница, канонический адрес, последний обход, разметка."""
    gc.check_on_site(url, site_url)
    raw = gc.call(session(), "POST", gc.INSPECT_API,
                  json={"inspectionUrl": url, "siteUrl": site_url, "languageCode": "ru"})
    return raw.get("inspectionResult", {})


@server.tool(annotations=READ_ONLY)
@readable_errors
def list_sitemaps(site_url: str = SITE_URL) -> list[dict[str, Any]]:
    """Отправленные sitemap: когда прочитаны, ошибки, предупреждения, число адресов."""
    raw = gc.call(session(), "GET", f"{gc.GSC_API}/sites/{gc.site_path(site_url)}/sitemaps")
    return raw.get("sitemap", [])


@server.tool(annotations=READ_ONLY)
@readable_errors
def pagespeed(url: str, strategy: str = "mobile") -> dict[str, Any]:
    """PageSpeed Insights: оценки Lighthouse, ключевые метрики и полевые данные CrUX.

    Вызов идёт с токеном сервисного аккаунта, чтобы считалась квота проекта:
    без ключа или токена у PageSpeed почти нулевой лимит.
    """
    if strategy not in ("mobile", "desktop"):
        raise ValueError("strategy: mobile или desktop")
    params = [("url", url), ("strategy", strategy)] + [
        ("category", c) for c in ("performance", "accessibility", "best-practices", "seo")]
    return gc.summarize_pagespeed(gc.call(session(), "GET", gc.PAGESPEED_API, params=params))


@server.tool(annotations=WRITES)
@readable_errors
def submit_sitemap(feed_url: str) -> dict[str, Any]:
    """Отправить sitemap в Search Console (повторная отправка просит Google перечитать его).

    Только для openqareer.com: ресурс записи не передаётся параметром.
    """
    feed = gc.check_sitemap(SITE_URL, feed_url)
    base = f"{gc.GSC_API}/sites/{gc.site_path(SITE_URL)}/sitemaps/{feed}"
    gc.call(session(WRITE_SCOPES), "PUT", base)
    raw = gc.call(session(), "GET", base)
    return {"submitted": feed_url, "status": raw}


def _fetch(url: str) -> tuple[int, str]:
    try:
        response = requests.get(url, timeout=30, allow_redirects=False,
                                headers={"User-Agent": "openqareer-gsc-mcp"})
    except requests.RequestException as err:
        raise ValueError(f"страница не открылась: {err}") from err
    return response.status_code, response.text


@server.tool(annotations=WRITES)
@readable_errors
def notify_urls(urls: list[str], kind: str = "URL_UPDATED") -> dict[str, Any]:
    """Уведомить Google через Indexing API о новых/изменённых (URL_UPDATED) или
    снятых (URL_DELETED) карточках вакансий.

    Перед отправкой каждая страница открывается: URL_UPDATED уходит только для 200
    с разметкой JobPosting, URL_DELETED только для 404/410. Не прошедшие проверку
    адреса пропускаются с причиной, остальные отправляются. До 100 адресов за вызов;
    каждый отправленный тратит дневную квоту Indexing API (Quotas в Google Cloud).
    Только для openqareer.com: сайт не передаётся параметром.
    """
    gc.check_batch(urls)
    results = []
    for url in dict.fromkeys(urls):
        try:
            gc.check_on_site(url, SITE_URL)  # before any request to the page
            gc.check_notification(url, kind, SITE_URL, *_fetch(url))
            # Google answers 200 with just the URL; its metadata appears minutes later.
            gc.call(session(WRITE_SCOPES), "POST", f"{gc.INDEXING_API}:publish",
                    json={"url": url, "type": kind})
            results.append({"url": url, "sent": True})
        except (ValueError, gc.GscError) as err:
            results.append({"url": url, "sent": False, "reason": str(err)})
    return {"kind": kind, "sent": sum(r["sent"] for r in results),
            "skipped": sum(not r["sent"] for r in results), "results": results}


@server.tool(annotations=READ_ONLY)
@readable_errors
def url_notification_status(url: str) -> dict[str, Any]:
    """Когда Google последний раз получал от нас уведомление об адресе через Indexing API.

    Только читает, но Indexing API не принимает read-only scope, поэтому сессия записи.
    """
    gc.check_on_site(url, SITE_URL)
    try:
        return gc.call(session(WRITE_SCOPES), "GET", f"{gc.INDEXING_API}/metadata",
                       params={"url": url})
    except gc.GscError as err:
        if err.status == 404:
            return {"url": url, "status": "уведомлений нет или Google ещё не показал "
                    "отправленное (метаданные появляются через несколько минут)"}
        raise


if __name__ == "__main__":
    server.run("stdio")
