# /// script
# requires-python = ">=3.12"
# dependencies = ["mcp==2.3.0", "google-auth==2.62.1", "requests==2.34.2"]
# ///
"""Read-only MCP server: Google Search Console + PageSpeed Insights for openqareer.

Credentials come from GOOGLE_APPLICATION_CREDENTIALS (the openqareer service
account, a restricted Search Console user); scripts/gsc-mcp.sh sets it from
~/.openqareer/openqareer.env. Nothing here can write to Search Console.
"""
from __future__ import annotations

import functools
import os
from typing import Any, Callable, TypeVar

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

import gsc_client as gc

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
SITE_URL = os.environ.get("GSC_SITE_URL", "https://openqareer.com/")
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=True)

server = MCPServer(
    name="gsc",
    instructions=(
        "Google Search Console и PageSpeed для openqareer.com, только чтение. "
        f"Ресурс по умолчанию {SITE_URL}. Данные GSC отстают на 2-3 дня; "
        "для свежих дней передавай data_state='all'."
    ),
)
_session: AuthorizedSession | None = None
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


def session() -> AuthorizedSession:
    global _session
    if _session is None:
        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not path or not os.path.isfile(path):
            raise gc.GscError("GOOGLE_APPLICATION_CREDENTIALS не задан или файла нет")
        creds = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)
        _session = AuthorizedSession(creds)
    return _session


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
    if not url.startswith(site_url):
        raise ValueError(f"URL должен начинаться с {site_url}")
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


if __name__ == "__main__":
    server.run("stdio")
