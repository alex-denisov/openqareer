#!/usr/bin/env python3
"""Resumable, evidence-first company registry enrichment tools (stdlib only).

LinkedIn is an import-only evidence provider. This module never fetches it.
"""
from __future__ import annotations

import argparse
import contextlib
from collections import Counter
import datetime as dt
import hashlib
import html.parser
import http.client
import ipaddress
import json
import os
import random
import re
import secrets
import shutil
import socket
import sqlite3
import ssl
import sys
import tempfile
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable

FIELDS = (
    "website_url", "careers_url", "linkedin_url", "linkedin_org_id",
    "geo", "industry", "domain_group",
)
FULL_COLUMNS = (
    "company_key", "company_name", "website_url", "careers_url", "linkedin_url",
    "linkedin_org_id", "source_type", "ats_provider", "ats_slug", "status", "geo",
    "industry", "domain_group", "notes", "created_at", "updated_at",
)
FIELD_TASK = {
    "website_url": "corporate_homepage", "careers_url": "corporate_careers",
    "linkedin_url": "linkedin_import", "linkedin_org_id": "linkedin_identity_import",
    "geo": "corporate_profile", "industry": "corporate_profile", "domain_group": "corporate_profile",
}
TERMINAL = {"completed", "unavailable", "policy_denied", "source_refused", "failed"}
TASK_STATUSES = {"pending", "leased", "awaiting_import", "cooldown_pending", *TERMINAL}
SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies (
  company_key TEXT PRIMARY KEY, company_name TEXT NOT NULL, row_json TEXT NOT NULL,
  row_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY, company_key TEXT NOT NULL, task_kind TEXT NOT NULL,
  provider TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until REAL,
  not_before REAL, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(company_key, task_kind, provider, source_url)
);
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs(status, not_before, job_id);
CREATE TABLE IF NOT EXISTS source_cache (
  cache_key TEXT PRIMARY KEY, provider TEXT NOT NULL, source_url TEXT NOT NULL,
  response_sha256 TEXT NOT NULL, observed_status INTEGER, evidence_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS source_cache_url_idx ON source_cache(provider,source_url,observed_at DESC);
CREATE TABLE IF NOT EXISTS proposals (
  candidate_id TEXT PRIMARY KEY, company_key TEXT NOT NULL, field TEXT NOT NULL,
  expected_json TEXT NOT NULL, new_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL, identity_confidence TEXT NOT NULL,
  validation_status TEXT NOT NULL, validation_reason TEXT,
  approved INTEGER NOT NULL DEFAULT 0, reviewer TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_company_idx ON proposals(company_key, field);
CREATE TABLE IF NOT EXISTS exceptions (
  exception_id TEXT PRIMARY KEY, company_key TEXT NOT NULL, field TEXT,
  reason TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS host_budget (
  provider TEXT NOT NULL, host TEXT NOT NULL, next_allowed REAL NOT NULL DEFAULT 0,
  consecutive_429 INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(provider, host)
);
CREATE TABLE IF NOT EXISTS audit (
  audit_id TEXT PRIMARY KEY, action TEXT NOT NULL, subject TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
"""


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_value(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def private_directory(path: Path) -> None:
    path = path.expanduser()
    if not path.exists():
        if path.parent != path:
            private_directory(path.parent)
        path.mkdir(mode=0o700)
        os.chmod(path, 0o700)
    if not path.is_dir():
        raise NotADirectoryError(path)
    if path.stat().st_mode & 0o077:
        raise PermissionError(f"private artifact directory must have mode 0700: {path}")


def ensure_private_external_path(path: str | Path) -> Path:
    candidate = Path(path).expanduser().absolute()
    if candidate.is_symlink():
        raise PermissionError(f"symlink output path is not allowed: {candidate}")
    canonical_parent = candidate.parent.resolve(strict=False)
    absolute = canonical_parent / candidate.name
    repo_root = Path(__file__).resolve().parents[2]
    try:
        absolute.resolve(strict=False).relative_to(repo_root)
    except ValueError:
        pass
    else:
        raise PermissionError("private enrichment artifacts must be written outside the Git worktree")
    if canonical_parent.exists() and canonical_parent.stat().st_mode & 0o077:
        raise PermissionError(f"private artifact parent must have mode 0700: {canonical_parent}")
    return absolute


def private_write(path: Path, data: bytes, *, exclusive: bool = True) -> None:
    private_directory(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        with contextlib.suppress(OSError):
            os.close(fd)
        raise
    os.chmod(path, 0o600)


def read_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as stream:
        return json.load(stream)


def load_task_file(path: str | Path) -> list[dict[str, Any]]:
    text = Path(path).read_text(encoding="utf-8")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            tasks = parsed
        elif isinstance(parsed, dict) and isinstance(parsed.get("tasks"), list):
            tasks = parsed["tasks"]
        else:
            raise ValueError("task file must be a JSON array or {tasks:[...]}")
    except json.JSONDecodeError:
        tasks = [json.loads(line) for line in text.splitlines() if line.strip()]
    if not all(isinstance(item, dict) for item in tasks):
        raise ValueError("every task must be an object")
    return tasks


def db_connect(path: str | Path) -> sqlite3.Connection:
    db_path = Path(path)
    private_directory(db_path.parent)
    conn = sqlite3.connect(str(db_path), timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    os.chmod(db_path, 0o600)
    return conn


def open_state(path: str | Path) -> sqlite3.Connection:
    conn = db_connect(path)
    conn.executescript(SCHEMA)
    return conn


def validate_full_baseline(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list) or not rows:
        raise ValueError("baseline must be a nonempty JSON array")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    expected = set(FULL_COLUMNS)
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ValueError(f"baseline row {index} is not an object")
        missing = expected - set(row)
        extra = set(row) - expected
        if missing or extra:
            raise ValueError(f"baseline row {index} must be full SELECT * shape; missing={sorted(missing)} extra={sorted(extra)}")
        key = row.get("company_key")
        if not isinstance(key, str) or not key.strip() or key in seen:
            raise ValueError(f"baseline row {index} has missing or duplicate company_key")
        if not isinstance(row.get("company_name"), str) or not row["company_name"].strip():
            raise ValueError(f"baseline row {index} has no company_name")
        seen.add(key)
        normalized.append({column: row[column] for column in FULL_COLUMNS})
    return sorted(normalized, key=lambda row: row["company_key"])


def init_state(state_path: str | Path, baseline_path: str | Path) -> dict[str, Any]:
    baseline = validate_full_baseline(read_json(baseline_path))
    state_file = ensure_private_external_path(state_path)
    private_directory(state_file.parent)
    if state_file.exists():
        raise FileExistsError(f"state already exists: {state_file}")
    conn = open_state(state_file)
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.executemany(
            "INSERT INTO companies(company_key,company_name,row_json,row_sha256) VALUES(?,?,?,?)",
            [(row["company_key"], row["company_name"], canonical_json(row), sha256_value(row)) for row in baseline],
        )
        conn.executemany("INSERT INTO meta(key,value) VALUES(?,?)", [
            ("baseline_sha256", sha256_value(baseline)),
            ("baseline_count", str(len(baseline))),
            ("baseline_columns", canonical_json(list(FULL_COLUMNS))),
            ("schema_version", "1"),
        ])
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        state_file.unlink(missing_ok=True)
        raise
    conn.close()
    return {"companies": len(baseline), "baseline_sha256": sha256_value(baseline), "state": str(state_file)}


def get_baseline(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT row_json FROM companies ORDER BY company_key").fetchall()
    if not rows:
        raise ValueError("state has no baseline; run init first")
    return [json.loads(row[0]) for row in rows]


def task_id(task: dict[str, Any]) -> str:
    key = task.get("company_key")
    kind = task.get("task_kind")
    provider = task.get("provider")
    url = task.get("source_url", "") or ""
    if not all(isinstance(value, str) and value for value in (key, kind, provider)):
        raise ValueError("task needs nonempty company_key, task_kind and provider")
    if not isinstance(url, str):
        raise ValueError("task source_url must be a string")
    return sha256_value({"company_key": key, "task_kind": kind, "provider": provider, "source_url": url})


def enqueue_tasks(conn: sqlite3.Connection, tasks: Iterable[dict[str, Any]]) -> dict[str, int]:
    added = 0
    existing = 0
    conn.execute("BEGIN IMMEDIATE")
    try:
        for task in tasks:
            job_id = task_id(task)
            provider = task["provider"]
            status = "awaiting_import" if provider in {"linkedin", "linkedin_import"} else "pending"
            now = utc_now()
            cursor = conn.execute(
                "INSERT OR IGNORE INTO jobs(job_id,company_key,task_kind,provider,source_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                (job_id, task["company_key"], task["task_kind"], provider, task.get("source_url", "") or "", status, now, now),
            )
            if cursor.rowcount:
                added += 1
            else:
                existing += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"added": added, "deduplicated": existing}


def baseline_tasks(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    tasks: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for row in get_baseline(conn):
        for field, kind in FIELD_TASK.items():
            provider = "linkedin_import" if kind.startswith("linkedin_") else "corporate"
            url = row.get("website_url") if kind in {"corporate_homepage", "corporate_profile"} else row.get("careers_url") if kind == "corporate_careers" else row.get("linkedin_url") or ""
            # One corporate homepage observation supports the three profile categories; keep task kinds explicit but stable.
            task = {"company_key": row["company_key"], "task_kind": kind, "provider": provider, "source_url": url or ""}
            tasks[(task["company_key"], kind, provider, task["source_url"])] = task
    return list(tasks.values())


def claim_jobs(conn: sqlite3.Connection, limit: int, lease_seconds: int, now: float | None = None) -> list[dict[str, Any]]:
    if limit < 1 or lease_seconds < 1:
        raise ValueError("limit and lease-seconds must be positive")
    now = time.time() if now is None else now
    claimed: list[dict[str, Any]] = []
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("UPDATE jobs SET status='pending',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='leased' AND lease_until<=?", (utc_now(), now))
        ready = conn.execute(
            "SELECT * FROM jobs WHERE provider NOT IN ('linkedin','linkedin_import') AND (status='pending' OR (status='cooldown_pending' AND COALESCE(not_before,0)<=?)) ORDER BY job_id LIMIT ?",
            (now, limit),
        ).fetchall()
        for job in ready:
            token = secrets.token_urlsafe(18)
            conn.execute("UPDATE jobs SET status='leased',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE job_id=? AND status IN ('pending','cooldown_pending')",
                         (token, now + lease_seconds, utc_now(), job["job_id"]))
            claimed.append({"job_id": job["job_id"], "company_key": job["company_key"], "task_kind": job["task_kind"],
                            "provider": job["provider"], "source_url": job["source_url"], "attempt": job["attempts"] + 1,
                            "lease_token": token})
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return claimed


def retry_after_seconds(value: str | None, now: dt.datetime | None = None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value.strip()))
    except ValueError:
        try:
            parsed = dt.datetime.strptime(value.strip(), "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=dt.timezone.utc)
            return max(0.0, (parsed - (now or dt.datetime.now(dt.timezone.utc))).total_seconds())
        except ValueError:
            return None


def backoff_delay(attempt: int, retry_after: float | None = None, *, base: float = 30, cap: float = 3600,
                  jitter_fraction: float = 0.2, rand: Any = random.random) -> float:
    exponential = min(cap, base * (2 ** max(0, attempt - 1)))
    jittered = exponential * (1 + max(0.0, min(1.0, rand())) * jitter_fraction)
    return max(jittered, retry_after or 0.0)


def source_outcome(provider: str, http_status: int | None, headers: dict[str, str] | None = None,
                   body_excerpt: str = "", attempt: int = 1, *, rand: Any = random.random) -> tuple[str, dict[str, Any]]:
    headers = {key.lower(): value for key, value in (headers or {}).items()}
    excerpt = body_excerpt[:2000]
    if provider in {"linkedin", "linkedin_import"}:
        return "policy_denied", {"reason": "linkedin_live_fetch_disabled", "http_status": http_status}
    if http_status is None:
        delay = backoff_delay(attempt, rand=rand)
        return "cooldown_pending", {"reason": "transport_error", "retry_after_seconds": delay}
    if http_status == 429:
        requested = retry_after_seconds(headers.get("retry-after"))
        delay = backoff_delay(attempt, requested, rand=rand)
        return "cooldown_pending", {"reason": "rate_limited", "retry_after_seconds": delay, "retry_after_header": headers.get("retry-after")}
    if http_status == 403 and re.search(r"robots\.txt|robots exclusion|disallowed by robots", excerpt, re.I):
        return "policy_denied", {"reason": "robots_policy_denial", "http_status": 403}
    if http_status == 403:
        return "source_refused", {"reason": "http_403_access_denied", "http_status": 403}
    if http_status == 404:
        return "unavailable", {"reason": "http_404", "http_status": 404}
    if 500 <= http_status <= 599:
        return "cooldown_pending", {"reason": "http_transient_server_error", "retry_after_seconds": backoff_delay(attempt, rand=rand), "http_status": http_status}
    if 200 <= http_status <= 299:
        return "completed", {"reason": "http_ok", "http_status": http_status}
    return "source_refused", {"reason": f"http_{http_status}", "http_status": http_status}


def record_jobs_batch(conn: sqlite3.Connection, records: list[dict[str, Any]], *, now: float | None = None) -> None:
    if not records:
        return
    now = time.time() if now is None else now
    seen: set[str] = set()
    allowed = TASK_STATUSES - {"pending", "leased", "awaiting_import"}
    conn.execute("BEGIN IMMEDIATE")
    try:
        updates = []
        audit_rows = []
        timestamp = utc_now()
        for item in records:
            job_id_value = item.get("job_id", "")
            lease_token = item.get("lease_token", "")
            status = item.get("status")
            result = item.get("result", {})
            if status not in allowed:
                raise ValueError(f"invalid terminal job status {status}")
            if job_id_value in seen:
                raise ValueError("duplicate job result in checkpoint batch")
            seen.add(job_id_value)
            job = conn.execute("SELECT status,lease_token FROM jobs WHERE job_id=?", (job_id_value,)).fetchone()
            if not job or job["status"] != "leased" or job["lease_token"] != lease_token:
                raise ValueError(f"stale job lease; refusing result write: {job_id_value}")
            not_before = now + float(result.get("retry_after_seconds", 0)) if status == "cooldown_pending" else None
            updates.append((status, not_before, canonical_json(result), timestamp, job_id_value))
            audit_rows.append((secrets.token_hex(16), "job_result", job_id_value, canonical_json({"status": status, "result": result}), timestamp))
        conn.executemany("UPDATE jobs SET status=?,lease_token=NULL,lease_until=NULL,not_before=?,result_json=?,updated_at=? WHERE job_id=?", updates)
        conn.executemany("INSERT INTO audit(audit_id,action,subject,payload_json,created_at) VALUES(?,?,?,?,?)", audit_rows)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def record_job(conn: sqlite3.Connection, job_id_value: str, lease_token: str, status: str,
               result: dict[str, Any], *, now: float | None = None) -> None:
    record_jobs_batch(conn, [{"job_id": job_id_value, "lease_token": lease_token, "status": status, "result": result}], now=now)


def normalize_name(value: str) -> str:
    value = value.casefold().replace("&", " and ")
    value = re.sub(r"\b(incorporated|inc|llc|ltd|limited|plc|corp|corporation|company|co|group|holdings?)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", "", value)


def is_company_jobs_url(value: str) -> bool:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname not in {"linkedin.com", "www.linkedin.com"}:
        return False
    if parsed.query or parsed.fragment:
        return False
    return bool(re.fullmatch(r"/company/[^/]+/jobs/?", parsed.path, re.I))


def is_direct_careers_portal(value: str) -> bool:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        return False
    host = parsed.hostname.casefold().rstrip(".")
    ats_hosts = ("greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
                 "workday.com", "myworkdayjobs.com", "pinpointhq.com")
    path = parsed.path.rstrip("/").casefold()
    segments = [seg for seg in path.split("/") if seg]
    ats_domain = next((ats for ats in ats_hosts if host == ats or host.endswith("." + ats)), None)
    narrow_tokens = {"career-types", "job-categories", "departments", "department", "locations", "location", "teams", "team",
                     "technology", "tech", "students", "student", "internships", "internship", "graduate", "graduates",
                     "campus", "early-careers", "earlycareer", "stories", "blog"}
    if any(segment in narrow_tokens for segment in segments):
        return False
    if len(segments) >= 3 and any(segment in {"careers", "career", "jobs", "job-openings", "join-us", "join-our-team"} for segment in segments[:-1]):
        return False
    if ats_domain:
        tenant_path = bool(segments and segments[0] not in {"jobs", "careers", "apply", "boards", "www"})
        subdomain = host[:-len("." + ats_domain)] if host != ats_domain else ""
        generic_hosts = {"www", "jobs", "careers", "apply", "boards", "app"}
        tenant_host = bool(subdomain and subdomain.split(".")[0] not in generic_hosts)
        if ats_domain == "myworkdayjobs.com" and subdomain and len(subdomain.split(".")) < 2:
            tenant_host = False
        return tenant_path or tenant_host
    if segments and segments[0] in {"us", "uk", "eu", "fr", "de", "in", "au", "ca", "sg"}:
        return False
    return bool(segments) and segments[-1] in {"careers", "career", "jobs", "job-openings", "join-us", "join-our-team", "open-positions", "vacancies"}


def is_actual_challenge(status: int, url: str, title: str, text: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    excerpt = (title + " " + text).casefold()
    signup_route = bool(re.search(r"/(signup|sign-up|join)(/|$)", parsed.path, re.I))
    static_security = "security verification" in excerpt or "security verification" in title.casefold()
    hard_status = status in {401, 403, 429}
    marker = bool(re.search(r"captcha|checkpoint|verify you are human|unusual traffic|automated requests", excerpt))
    if signup_route and status == 200 and static_security and not marker:
        return False
    return hard_status or marker


def split_capture_blocks(raw_text: str) -> list[str]:
    """Split saved web output on literal 80-dash source boundaries, including inline ones."""
    return re.split(r"-{80}", raw_text)


def exact_primary_page_blocks(raw_text: str) -> list[str]:
    """Return URL-sourced pages after splitting the capture's exact source boundaries."""
    return [part for part in split_capture_blocks(raw_text)
            if re.search(r"(?m)^\s*Source:\s*https?://", part)]


def is_linkedin_host(hostname: str | None) -> bool:
    host = (hostname or "").casefold().rstrip(".")
    return host == "linkedin.com" or host.endswith(".linkedin.com")


def _linkedin_https_url(parsed: urllib.parse.SplitResult) -> bool:
    try:
        port_ok = parsed.port in (None, 443)
    except ValueError:
        return False
    return (parsed.scheme.casefold() == "https" and is_linkedin_host(parsed.hostname)
            and parsed.username is None and parsed.password is None and port_ok)


def _single_numeric_facet_id(query: str, *, allowed_keys: tuple[str, ...] = ("facetCurrentCompany", "currentCompany")) -> str | None:
    params = urllib.parse.parse_qs(query, keep_blank_values=True)
    if any(key.casefold() == "keywords" for key in params):
        return None
    known = {"facetcurrentcompany", "currentcompany"}
    keys = [key for key in params if key.casefold() in known]
    allowed = {key.casefold() for key in allowed_keys}
    if len(keys) != 1 or keys[0].casefold() not in allowed or len(params[keys[0]]) != 1:
        return None
    raw = params[keys[0]][0].strip()
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, list) and len(decoded) == 1:
            raw = str(decoded[0])
        elif isinstance(decoded, (int, str)) and not isinstance(decoded, bool):
            raw = str(decoded)
        else:
            return None
    except json.JSONDecodeError:
        pass
    return raw if re.fullmatch(r"[1-9]\d*", raw) else None


def parse_linkedin_company_id(href: str) -> str | None:
    parsed = urllib.parse.urlsplit(href)
    if not _linkedin_https_url(parsed):
        return None
    match = re.fullmatch(r"/company/(\d+)(?:/(?:employees|jobs))?/?", parsed.path, re.I)
    if match:
        return match.group(1) if not re.search(r"(?:^|&)keywords=", parsed.query, re.I) else None
    if parsed.path.casefold() == "/search/results/people/":
        return _single_numeric_facet_id(parsed.query)
    if parsed.path.casefold() == "/signup/cold-join":
        params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        redirect_keys = [key for key in params if key.casefold() == "session_redirect"]
        if len(redirect_keys) != 1 or len(params[redirect_keys[0]]) != 1:
            return None
        nested = urllib.parse.urlsplit(params[redirect_keys[0]][0])
        if not _linkedin_https_url(nested) or nested.path.casefold() != "/search/results/people/":
            return None
        return _single_numeric_facet_id(nested.query)
    return None


def parse_linkedin_employee_cta_id(href: str) -> str | None:
    """Read one exact facetCurrentCompany ID from an employee CTA's original target."""
    parsed = urllib.parse.urlsplit(href)
    if not _linkedin_https_url(parsed):
        return None
    if parsed.path.casefold() == "/search/results/people/":
        return _single_numeric_facet_id(parsed.query, allowed_keys=("facetCurrentCompany",))
    if parsed.path.casefold() != "/signup/cold-join":
        return None
    params = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    redirect_keys = [key for key in params if key.casefold() == "session_redirect"]
    if len(redirect_keys) != 1 or len(params[redirect_keys[0]]) != 1:
        return None
    nested = urllib.parse.urlsplit(params[redirect_keys[0]][0])
    if not _linkedin_https_url(nested) or nested.path.casefold() != "/search/results/people/":
        return None
    return _single_numeric_facet_id(nested.query, allowed_keys=("facetCurrentCompany",))


def extract_raw_rendered_links(raw_source_block: str, source_ref: str) -> list[dict[str, Any]]:
    if source_ref not in raw_source_block:
        return []
    links: list[dict[str, Any]] = []
    marker_pattern = re.compile(r"(?:\[(\d+)\]|【(\d+)†[^】]*】)")
    for line in raw_source_block.splitlines():
        markers = list(marker_pattern.finditer(line))
        for index, match in enumerate(markers):
            link_id = int(match.group(1) or match.group(2))
            span_end = markers[index + 1].start() if index + 1 < len(markers) else len(line)
            link_text = line[match.end():span_end]
            url_match = re.search(r"(?:href\s*[:=]\s*)?(https://[^\s)>]+)", link_text, re.I)
            if url_match:
                href = url_match.group(1).rstrip(".,;)")
                links.append({"id": link_id, "href": href, "source_ref": source_ref})
    return links


def validate_rendered_cta(*, rendered_ref: str, link_ref: str, link_id: int,
                          source_url: str, page_title: str, raw_source_block: str) -> dict[str, Any]:
    """Derive the CTA href from one exact raw primary block; caller-provided link maps are not evidence."""
    if rendered_ref != link_ref:
        raise ValueError("stale_ref_link_id_pair")
    if re.search(r"internalerror|access denied|not found|page unavailable", page_title, re.I):
        raise ValueError("source_page_not_identity_verified")
    if not isinstance(raw_source_block, str) or rendered_ref not in raw_source_block:
        raise ValueError("source_reference_not_present_in_raw_rendering")
    source_match = re.search(r"(?m)^\s*Source:\s*(https?://\S+)", raw_source_block)
    if not source_match or urllib.parse.urldefrag(source_match.group(1).rstrip("/"))[0] != urllib.parse.urldefrag(source_url.rstrip("/"))[0]:
        raise ValueError("source_url_not_present_in_raw_rendering")
    link = next((item for item in extract_raw_rendered_links(raw_source_block, rendered_ref) if item["id"] == link_id), None)
    if not link:
        raise ValueError("link_id_and_href_not_present_together_in_raw_rendering")
    href = link["href"]
    resolved = urllib.parse.urlsplit(urllib.parse.urljoin(source_url, href))
    if not _linkedin_https_url(resolved):
        raise ValueError("href_does_not_resolve_to_linkedin")
    company_id = parse_linkedin_company_id(urllib.parse.urlunsplit(resolved))
    if company_id is None:
        raise ValueError("href_is_not_exact_company_or_currentCompany_target")
    return {"raw_href": href, "linkedin_org_id": company_id, "rendered_ref": rendered_ref,
            "link_id": link_id, "href_host": resolved.hostname}


def wrapped_transport_status(evidence: dict[str, Any]) -> int | None:
    text = " ".join(str(evidence.get(key, "")) for key in ("excerpt", "transport_error", "raw_response_excerpt", "error"))
    patterns = (r"\(\s*429\s*\)\s*too many requests", r"failed to fetch[^\n]{0,300}\(?\s*429\s*\)?",
                r"\b429\s+too many requests\b", r"http(?:error| status)?[^\n]{0,80}\b429\b", r"status(?: code)?\s*[:=]?\s*429\b")
    return 429 if any(re.search(pattern, text, re.I) for pattern in patterns) else None


def validate_candidate(field: str, value: Any, evidence: dict[str, Any], company: dict[str, Any]) -> tuple[str, str | None, str]:
    """Return (validation status, reason, identity confidence). Never infers missing evidence."""
    if field not in FIELDS:
        return "rejected", "field_not_allowed", "none"
    if not isinstance(evidence, dict):
        return "exception", "evidence_not_object", "none"
    source_url = evidence.get("source_url")
    excerpt = evidence.get("excerpt")
    if wrapped_transport_status(evidence) == 429:
        return "deferred_cooldown", "wrapped_http_429_retry_after_required", "none"
    if evidence.get("adapter_gap") == "unsupported_raw_evidence_shape":
        return "exception", "adapter_gap:unsupported_raw_evidence_shape", "none"
    careers_gap = evidence.get("adapter_gap")
    if isinstance(careers_gap, str) and careers_gap.startswith("careers_"):
        raw_source_status = evidence.get("http_status", evidence.get("status"))
        if raw_source_status is None:
            return "exception", f"adapter_gap:{careers_gap}", "none"
        try:
            normalized_source_status = int(raw_source_status)
        except (TypeError, ValueError):
            return "exception", f"adapter_gap:{careers_gap}", "none"
        if 200 <= normalized_source_status < 300:
            return "exception", f"adapter_gap:{careers_gap}", "none"
    if evidence.get("adapter_gap") in {
        "source_file_line_shape_unsupported",
        "source_file_line_unavailable", "source_file_line_out_of_range", "source_file_line_unparseable",
    }:
        return "exception", f"adapter_gap:{evidence['adapter_gap']}", "none"
    if not isinstance(source_url, str) or urllib.parse.urlsplit(source_url).scheme != "https" or not urllib.parse.urlsplit(source_url).hostname:
        return "exception", "missing_primary_https_source_url", "none"
    if not isinstance(excerpt, str) or len(excerpt.strip()) < 12:
        return "exception", "missing_substantive_primary_excerpt", "none"
    raw_status = evidence.get("http_status", evidence.get("status"))
    source_access = evidence.get("source_access") or {}
    if raw_status is not None:
        try:
            source_status = int(raw_status)
        except (TypeError, ValueError):
            return "exception", "invalid_source_access_status", "none"
        if not 200 <= source_status < 300:
            return "exception", "source_not_opened_successfully", "none"
    elif evidence.get("adapter_gap") == "careers_source_line_binding_unverified":
        return "exception", "adapter_gap:careers_source_line_binding_unverified", "none"
    elif not (isinstance(source_access, dict) and source_access.get("status") == "content_observed"
              and source_access.get("method") in {"public_index", "cached_primary_page", "official_site",
                                                  "saved_b614_find_and_click_capture", "saved_b614_find_capture", "saved_corporate_footer_line"}):
        return "exception", "source_access_unknown_without_content_observation", "none"
    if raw_status is not None and is_actual_challenge(int(raw_status), source_url, str(evidence.get("title", "")), excerpt):
        return "exception", "source_challenge_or_checkpoint", "none"
    if evidence.get("adapter_gap"):
        return "exception", f"adapter_gap:{evidence['adapter_gap']}", "none"
    # Destination reachability is an independent observation. In particular a published
    # company link remains evidence when its destination was not opened or robots-denied.
    destination_status = evidence.get("destination_access_status")
    if destination_status not in {None, "unknown", "not_attempted", "available", "policy_denied", "access_denied", "deferred_cooldown", "cooldown_pending", "unavailable"}:
        return "exception", "invalid_destination_access_state", "none"
    identity = evidence.get("identity") or {}
    if not isinstance(identity, dict):
        return "exception", "identity_signals_missing", "none"
    company_name = str(company.get("company_name", ""))
    observed_name = str(identity.get("observed_company_name", ""))
    if not observed_name or normalize_name(company_name) != normalize_name(observed_name):
        return "exception", "company_name_identity_mismatch", "none"
    if identity.get("name_match") is False or identity.get("business_semantic_match") is False or identity.get("official_domain_match") is False:
        return "exception", "ambiguous_company_identity", "none"
    context = str(identity.get("business_context", "") or excerpt).strip()
    if len(context) < 12:
        return "exception", "insufficient_business_identity_context", "none"
    confidence = "high" if all(identity.get(k) is True for k in ("name_match", "business_semantic_match", "official_domain_match")) else "medium"

    if field in {"website_url", "careers_url", "linkedin_url"}:
        if not isinstance(value, str) or not value:
            return "rejected", "url_value_empty", confidence
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return "rejected", "url_must_be_https_without_credentials", confidence
        if field == "careers_url":
            scope = evidence.get("careers_scope")
            if not is_direct_careers_portal(value) and not (scope == "companywide_general_jobs" and _is_locale_path(value)):
                return "exception", "narrow_or_unverified_careers_subpage", confidence
            scope_excerpt = str(evidence.get("careers_scope_excerpt", "")).strip()
            if scope not in {"companywide_general_jobs", "general_jobs_portal", "all_roles"} or len(scope_excerpt) < 12:
                return "exception", "careers_scope_unverified", confidence
        if field == "linkedin_url":
            if not is_company_jobs_url(value):
                return "rejected", "linkedin_url_must_be_direct_company_jobs_route_without_keywords", confidence
            raw_href = evidence.get("raw_href")
            if raw_href and urllib.parse.urljoin(source_url, str(raw_href)).rstrip("/") != value.rstrip("/"):
                return "exception", "linkedin_jobs_url_differs_from_exact_primary_href", confidence
    elif field == "linkedin_org_id":
        text_value = str(value)
        if not re.fullmatch(r"[1-9]\d*", text_value):
            return "rejected", "linkedin_org_id_must_be_positive_numeric", confidence
        legacy_binding = evidence.get("legacy_click_binding") or {}
        if legacy_binding:
            if legacy_binding.get("verified") is not True:
                return "exception", "legacy_click_ref_id_href_binding_unverified", confidence
            if legacy_binding.get("linkedin_org_id") != text_value:
                return "exception", "candidate_id_differs_from_legacy_click_href", confidence
            if legacy_binding.get("domain_match") is False:
                return "exception", "official_domain_mismatch", confidence
        cta = evidence.get("company_cta") or {}
        published = evidence.get("published_company_href") or evidence.get("raw_href")
        exact_id = legacy_binding.get("linkedin_org_id") if legacy_binding.get("verified") is True else None
        if published and exact_id is None:
            target = urllib.parse.urlsplit(urllib.parse.urljoin(source_url, str(published)))
            exact_id = parse_linkedin_company_id(urllib.parse.urlunsplit(target))
        if exact_id is None and cta:
            try:
                exact = validate_rendered_cta(
                    rendered_ref=str(cta.get("rendered_ref", "")), link_ref=str(cta.get("link_ref", "")),
                    link_id=int(cta.get("link_id", -1)), source_url=str(cta.get("source_url", source_url)),
                    page_title=str(cta.get("page_title", "")), raw_source_block=str(evidence.get("raw_source_block") or ""),
                )
                exact_id = exact["linkedin_org_id"]
            except (ValueError, TypeError) as error:
                return "exception", str(error), confidence
        if exact_id is None:
            return "exception", "no_exact_primary_company_href", confidence
        if exact_id != text_value:
            return "exception", "candidate_id_differs_from_exact_primary_href", confidence
    elif not isinstance(value, str) or not value.strip():
        return "rejected", "classification_empty", confidence
    elif field == "geo":
        if not evidence.get("geo_basis"):
            return "exception", "geo_has_no_explicit_primary_basis", confidence
    elif field == "industry":
        if evidence.get("industry_basis") not in {"explicit_industry_metadata", "explicit_business_description"}:
            return "exception", "industry_not_explicitly_supported", confidence
    elif field == "domain_group":
        if not evidence.get("domain_group_basis"):
            return "exception", "domain_group_taxonomy_unresolved", confidence
    return "valid_pending_review", None, confidence


def exception_id(company_key: str, field: str | None, reason: str, evidence: Any) -> str:
    return sha256_value({"company_key": company_key, "field": field, "reason": reason, "evidence": evidence})


def _safe_evidence_file(raw_file: str, evidence_root: str | Path | None, max_bytes: int = 25_000_000) -> tuple[Path, str, bytes]:
    if evidence_root is None:
        raise ValueError("--evidence-root is required before a packet raw_file may be read")
    root_input = Path(evidence_root).expanduser()
    if root_input.is_symlink():
        raise PermissionError("evidence root cannot be a symlink")
    root = root_input.resolve(strict=True)
    if not root.is_dir() or root.stat().st_mode & 0o077:
        raise PermissionError("evidence root must be a private directory with mode 0700")
    try:
        root.relative_to(Path(__file__).resolve().parents[2])
    except ValueError:
        pass
    else:
        raise PermissionError("private raw evidence root must be outside the Git worktree")
    raw_input = Path(raw_file).expanduser()
    if ".." in raw_input.parts:
        raise PermissionError("raw evidence path traversal is not allowed")
    root_lexical = root_input.absolute()
    candidate = raw_input if raw_input.is_absolute() else root_lexical / raw_input
    if candidate.is_symlink():
        raise PermissionError("symlink evidence paths are not allowed")
    try:
        lexical_relative = candidate.relative_to(root_lexical)
        current = root_lexical
        for part in lexical_relative.parts:
            current = current / part
            if current.is_symlink():
                raise PermissionError("symlink evidence paths are not allowed")
    except ValueError:
        # Absolute paths may use an OS-level alias (for example /var -> /private/var).
        # Resolve their parent, then require it to remain inside the private evidence root.
        canonical_parent = candidate.parent.resolve(strict=True)
        try:
            canonical_parent.relative_to(root)
        except ValueError as error:
            raise PermissionError("raw evidence path must be directly under the approved evidence root") from error
        candidate = canonical_parent / candidate.name
    resolved = candidate.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise PermissionError("raw evidence path is outside approved evidence root") from error
    stat = resolved.stat()
    if not resolved.is_file() or stat.st_size > max_bytes:
        raise ValueError("raw evidence must be a regular file under the configured size limit")
    data = resolved.read_bytes()
    return resolved, sha256_bytes(data), data


def source_specific_raw_text(raw_text: str, source_url: str | None, source_ref: str | None) -> str:
    blocks = exact_primary_page_blocks(raw_text)
    selected = []
    normalized_url = urllib.parse.urldefrag(source_url or "")[0].rstrip("/")
    for block in blocks:
        source_match = re.search(r"(?m)^\s*Source:\s*(https?://\S+)", block)
        url_match = bool(source_match and urllib.parse.urldefrag(source_match.group(1).rstrip("/"))[0] == normalized_url)
        ref_match = bool(source_ref and source_ref in block)
        if url_match or ref_match:
            selected.append(block)
    return selected[0] if len(selected) == 1 else ""


def resolve_legacy_evidence_file(token: str, evidence_root: str | Path | None) -> tuple[Path, str, bytes]:
    if evidence_root is None:
        raise ValueError("--evidence-root is required for legacy evidence files")
    root = Path(evidence_root).expanduser().resolve(strict=True)
    if Path(token).is_absolute():
        return _safe_evidence_file(token, root)
    requested = root / token
    if requested.is_file() and not requested.is_symlink():
        return _safe_evidence_file(str(requested), root)
    # Older B614 packets store paths relative to a shard directory. Resolve only a
    # unique basename inside the approved root; never follow the packet's `..` path.
    basename = Path(token).name
    matches = [candidate for candidate in root.rglob(basename) if candidate.is_file() and not candidate.is_symlink()]
    if len(matches) != 1:
        raise ValueError(f"legacy evidence filename must resolve to one file under evidence root: {basename}")
    return _safe_evidence_file(str(matches[0]), root)


def _json_text(data: bytes) -> str:
    return data.decode("utf-8", errors="strict")


def _capture_source_invocation(block: str, tool_name: str) -> dict[str, Any] | None:
    match = re.search(r"(?m)^.*?\bSource:\s*" + re.escape(tool_name) + r"\((\{[^\r\n]*\})\)", block)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _raw_page_header(block: str) -> tuple[str, str] | None:
    for line in block.splitlines():
        match = re.match(r"^\s*(.*?)\s+\((https?://[^\s)]+)\)\s*$", line)
        if match:
            title = match.group(1).strip()
            url = match.group(2).rstrip(".,;")
            if title:
                return title, url
    return None


def _raw_page_heading(block: str) -> str | None:
    for line in block.splitlines():
        match = re.match(r"^\s*(?:L\d+:\s*)?#{1,2}\s+(.+?)\s*$", line)
        if match:
            return match.group(1).strip()
    return None


def _normalized_linkedin_page_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    return urllib.parse.urlunsplit((parsed.scheme.casefold(), (parsed.hostname or "").casefold().rstrip("."),
                                    parsed.path.rstrip("/") or "/", parsed.query, ""))


def _extract_legacy_find_capture(find_data: Any, company: dict[str, Any],
                                 candidate_primary_ref: Any, candidate_find_ref: Any,
                                 candidate_link_id: Any) -> dict[str, Any]:
    if not isinstance(find_data, dict) or not isinstance(find_data.get("rows"), list):
        raise ValueError("legacy_find_rows_missing")
    company_key = company["company_key"]
    rows = [row for row in find_data["rows"] if isinstance(row, dict) and row.get("company_key") == company_key]
    if len(rows) != 1:
        raise ValueError("legacy_find_company_row_not_unique")
    row = rows[0]
    primary_ref = row.get("source_ref")
    source_url = row.get("requested_url")
    if not isinstance(primary_ref, str) or not re.fullmatch(r"turn[\w-]+", primary_ref):
        raise ValueError("legacy_find_primary_ref_missing")
    if not isinstance(source_url, str):
        raise ValueError("legacy_find_primary_url_missing")
    source_parsed = urllib.parse.urlsplit(source_url)
    if (not _linkedin_https_url(source_parsed)
            or not re.fullmatch(r"/company/[^/]+/?", source_parsed.path, re.I)
            or source_parsed.query or source_parsed.fragment):
        raise ValueError("legacy_find_source_is_not_exact_linkedin_company_page")
    if normalize_name(str(row.get("company_name", ""))) != normalize_name(company["company_name"]):
        raise ValueError("legacy_find_company_key_name_mismatch")
    row_title = row.get("title")
    if not isinstance(row_title, str) or normalize_name(row_title.split("|", 1)[0].strip()) != normalize_name(company["company_name"]):
        raise ValueError("legacy_find_company_title_metadata_mismatch")

    findings = find_data.get("findings")
    if not isinstance(findings, str):
        raise ValueError("legacy_find_raw_results_missing")
    matches: list[dict[str, Any]] = []
    for block in split_capture_blocks(findings):
        source_args = _capture_source_invocation(block, "find")
        citations = re.findall(r"cite(turn[\w-]+)", block)
        header = _raw_page_header(block)
        heading = _raw_page_heading(block)
        if not source_args or source_args.get("ref_id") != primary_ref or len(set(citations)) != 1 or not header or not heading:
            continue
        title, rendered_url = header
        title_name = title.split("|", 1)[0].strip()
        rendered_parsed = urllib.parse.urlsplit(rendered_url)
        if (not _linkedin_https_url(rendered_parsed)
                or _normalized_linkedin_page_url(rendered_url) != _normalized_linkedin_page_url(source_url)
                or not normalize_name(title_name) == normalize_name(company["company_name"])
                or not normalize_name(heading) == normalize_name(company["company_name"])):
            continue
        if normalize_name(row_title.split("|", 1)[0].strip()) != normalize_name(title_name):
            continue
        employee_markers = re.findall(r"【(\d+)†([^】]*\bemployees?\b[^】]*)】", block, re.I)
        if len(employee_markers) != 1:
            continue
        matches.append({"block": block, "primary_page_ref": primary_ref, "primary_url": source_url,
                        "page_title": title, "observed_company_name": heading,
                        "find_result_ref": citations[0], "employee_link_id": int(employee_markers[0][0])})

    if candidate_find_ref is not None or candidate_link_id is not None or candidate_primary_ref is not None:
        def hints_match(match: dict[str, Any]) -> bool:
            if candidate_primary_ref is not None and str(candidate_primary_ref) != match["primary_page_ref"]:
                return False
            if candidate_find_ref is not None and str(candidate_find_ref) != match["find_result_ref"]:
                return False
            if candidate_link_id is not None:
                try:
                    if int(candidate_link_id) != match["employee_link_id"]:
                        return False
                except (TypeError, ValueError):
                    return False
            return True
        matching_hints = [match for match in matches if hints_match(match)]
        if len(matches) > 1:
            matches = matching_hints
        elif matches and not matching_hints:
            matches[0]["caller_hint_mismatch"] = True
    if len(matches) != 1:
        raise ValueError("legacy_find_result_cta_not_unique_or_not_raw")
    return matches[0]


def _extract_legacy_click_target(click_data: Any, company_key: str, primary_ref: str,
                                 find_ref: str, link_id: int) -> tuple[str, str, bool]:
    if not isinstance(click_data, dict) or not isinstance(click_data.get("web"), str):
        raise ValueError("legacy_click_raw_results_missing")
    queue = click_data.get("queue")
    if not isinstance(queue, list):
        raise ValueError("legacy_click_queue_missing")
    queue_rows = [row for row in queue if isinstance(row, dict) and row.get("company_key") == company_key]
    if len(queue_rows) != 1:
        raise ValueError("legacy_click_queue_row_not_unique")
    queue_row = queue_rows[0]
    try:
        queue_link_id = int(queue_row.get("employee_link_id"))
    except (TypeError, ValueError):
        queue_link_id = None
    if (queue_row.get("existing_page_ref") != primary_ref
            or queue_row.get("find_result_ref") != find_ref
            or queue_link_id != link_id):
        raise ValueError("legacy_click_queue_ref_id_mismatch")

    matches: list[tuple[str, str, bool]] = []
    for block in split_capture_blocks(click_data["web"]):
        source_args = _capture_source_invocation(block, "click")
        if not source_args or source_args.get("ref_id") != find_ref or source_args.get("id") != link_id:
            continue
        source_line = re.search(r"(?m)^.*?\bSource:\s*click\(", block)
        if not source_line:
            continue
        prefix = block[:source_line.start()]
        urls = re.findall(r"https://[^\s)>]+", prefix, re.I)
        targets = []
        for raw_url in urls:
            candidate = raw_url.rstrip(".,;)")
            parsed = urllib.parse.urlsplit(candidate)
            if parsed.path.casefold() == "/signup/cold-join" or "session_redirect" in urllib.parse.parse_qs(parsed.query, keep_blank_values=True):
                if candidate not in targets:
                    targets.append(candidate)
        # Some failed requests print the original URL only in the exact call's
        # wrapped error. Never treat an ordinary redirect destination as the CTA.
        if not targets:
            error_urls = re.findall(
                r"(?i)Failed to fetch\s*<?(https://[^\s)>]+)>?",
                block[source_line.end():],
            )
            for raw_url in error_urls:
                candidate = raw_url.rstrip(".,;:)")
                parsed = urllib.parse.urlsplit(candidate)
                if parsed.path.casefold() == "/signup/cold-join" or "session_redirect" in urllib.parse.parse_qs(parsed.query, keep_blank_values=True):
                    if candidate not in targets:
                        targets.append(candidate)
        if len(targets) != 1:
            continue
        target = targets[0]
        target_id = parse_linkedin_employee_cta_id(target)
        if target_id is None:
            continue
        queued_target = queue_row.get("target_url")
        if isinstance(queued_target, str) and queued_target.strip():
            if urllib.parse.urldefrag(queued_target.strip())[0] != urllib.parse.urldefrag(target)[0]:
                continue
        queued_facets = queue_row.get("facetCurrentCompany_ids")
        if isinstance(queued_facets, list) and queued_facets:
            if len(queued_facets) != 1 or str(queued_facets[0]) != target_id:
                continue
        cooldown = wrapped_transport_status({"raw_response_excerpt": block}) == 429
        matches.append((target, target_id, cooldown))
    if len(matches) != 1:
        raise ValueError("legacy_click_invocation_target_not_unique_or_exact")
    return matches[0]


def normalize_legacy_linkedin_observation(normalized: dict[str, Any], company: dict[str, Any],
                                          evidence_root: str | Path | None, proposed_value: Any) -> None:
    if "raw_find_file" not in normalized and "raw_click_file" not in normalized:
        return
    # Legacy packet fields can suggest values, but raw captures alone establish
    # source access, identity, click target, and any wrapped transport state.
    for key in ("http_status", "status", "source_url", "excerpt", "source_access", "identity",
                "destination_access_status", "destination_access_detail", "transport_error"):
        normalized.pop(key, None)
    find_token, click_token = normalized.get("raw_find_file"), normalized.get("raw_click_file")
    if not isinstance(find_token, str):
        normalized.update({
            "legacy_click_binding": {"verified": False, "reason": "legacy_find_file_missing"},
            "source_access": {"status": "unknown", "method": "saved_b614_find_capture_missing"},
            "identity": {},
        })
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return
    if not isinstance(click_token, str):
        normalized.update({
            "legacy_click_binding": {"verified": False, "reason": "legacy_click_file_missing"},
            "source_access": {"status": "unknown", "method": "saved_b614_find_capture_missing"},
            "identity": {},
        })
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return

    try:
        find_path, find_hash, find_bytes = resolve_legacy_evidence_file(find_token, evidence_root)
        find_data = json.loads(_json_text(find_bytes))
        found = _extract_legacy_find_capture(find_data, company, normalized.get("primary_page_ref"),
                                             normalized.get("find_result_ref"), normalized.get("employee_link_id"))
    except (FileNotFoundError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        normalized.update({
            "legacy_click_binding": {"verified": False, "reason": "legacy_find_evidence_unavailable",
                                     "detail": str(error), "company_key": company["company_key"]},
            "source_access": {"status": "unknown", "method": "saved_b614_find_evidence_unavailable"},
            "identity": {},
        })
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return

    normalized.update({
        "raw_find_file": str(find_path), "raw_find_sha256": find_hash,
        "raw_file_sha256": sha256_value([find_hash]),
        "source_url": found["primary_url"],
        "excerpt": found["page_title"] + "; " + found["observed_company_name"],
        "source_ref": found["primary_page_ref"],
        "destination_access_status": "unknown",
        "source_access": {
            "status": "content_observed",
            "method": "saved_b614_find_capture",
            "raw_sha256": [find_hash],
        },
        "identity": {
            "observed_company_name": found["observed_company_name"],
            "business_context": found["page_title"] + "; " + found["observed_company_name"],
            "name_match": True,
            "identity_basis": "raw_company_page_title_heading_and_employee_cta",
        },
    })

    click_path: Path | None = None
    click_hash: str | None = None
    try:
        click_path, click_hash, click_bytes = resolve_legacy_evidence_file(click_token, evidence_root)
        click_data = json.loads(_json_text(click_bytes))
        target, target_id, cooldown = _extract_legacy_click_target(
            click_data, company["company_key"], found["primary_page_ref"],
            found["find_result_ref"], found["employee_link_id"])
    except (FileNotFoundError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        binding = {"verified": False, "reason": str(error),
                   "company_key": company["company_key"],
                   "primary_page_ref": found["primary_page_ref"],
                   "find_result_ref": found["find_result_ref"],
                   "employee_link_id": found["employee_link_id"],
                   "find_sha256": find_hash}
        if click_path is not None and click_hash is not None:
            normalized.update({
                "raw_click_file": str(click_path),
                "raw_click_sha256": click_hash,
                "raw_file_sha256": sha256_value([find_hash, click_hash]),
            })
            binding["click_sha256"] = click_hash
        normalized.update({
            "legacy_click_binding": binding,
            "destination_access_status": "unknown",
            "destination_access_detail": "click_result_unavailable_or_unmatched",
        })
        return

    hint_mismatch = str(proposed_value) != target_id or found.get("caller_hint_mismatch") is True
    normalized.update({
        "raw_click_file": str(click_path), "raw_click_sha256": click_hash,
        "raw_file_sha256": sha256_value([find_hash, click_hash]),
        "destination_access_status": "deferred_cooldown" if cooldown else "unknown",
        "destination_access_detail": "wrapped_http_429_in_exact_click_result" if cooldown else "signup_redirect_href_only",
        **({"transport_error": "HTTP 429 Too Many Requests in exact saved LinkedIn click result"} if cooldown else {}),
        "legacy_click_binding": {
            "verified": not hint_mismatch,
            "reason": "candidate_id_or_ref_differs_from_raw_capture" if hint_mismatch else None,
            "company_key": company["company_key"],
            "primary_page_ref": found["primary_page_ref"],
            "find_result_ref": found["find_result_ref"],
            "employee_link_id": found["employee_link_id"],
            "raw_href": target,
            "linkedin_org_id": target_id,
            "find_sha256": find_hash,
            "click_sha256": click_hash,
        },
    })


def _normalized_https_host_path(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
        port_ok = parsed.port in (None, 443)
    except ValueError:
        return None
    if parsed.scheme.casefold() != "https" or not parsed.hostname or parsed.username or parsed.password or not port_ok:
        return None
    return parsed.hostname.casefold().rstrip("."), parsed.path.rstrip("/") or "/"


def _normalized_https_source_url(value: Any) -> tuple[str, str, str] | None:
    key = _normalized_https_host_path(value)
    if key is None:
        return None
    parsed = urllib.parse.urlsplit(str(value))
    return key[0], key[1], parsed.query


def _company_title_matches(title: Any, company_name: str) -> bool:
    if not isinstance(title, str) or not title.strip():
        return False
    expected = normalize_name(company_name)
    parts = re.split(r"[|•·:]|\s+[–—-]\s+", title)
    for part in parts:
        candidate = re.sub(r"(?i)^\s*(?:careers?|jobs?|work|join)\s+(?:at|for)\s+", "", part).strip()
        candidate = re.sub(r"(?i)\s+(?:careers?|jobs?|employment|open positions?)\s*$", "", candidate).strip()
        if normalize_name(candidate) == expected:
            return True
    return False


def _is_locale_path(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    first = next((segment.casefold().replace("_", "-") for segment in parsed.path.split("/") if segment), "")
    regional = {
        "us", "uk", "eu", "fr", "de", "in", "au", "ca", "sg", "jp", "kr", "br", "mx",
        "emea", "apac", "apj", "latam", "americas", "north-america", "south-america",
        "europe", "asia-pacific", "middle-east", "africa", "oceania", "mena", "anz",
        "dach", "benelux", "nordics", "asean", "gcc", "global", "worldwide",
    }
    languages = {"en", "fr", "de", "es", "pt", "zh", "ja", "ko", "ru", "it", "ar", "hi",
                 "nl", "sv", "no", "da", "fi", "pl", "tr", "vi", "th", "id", "ms"}
    locale_tag = bool(re.fullmatch(r"[a-z]{2,3}-(?:[a-z]{2}|[0-9]{3}|hans|hant)(?:-[a-z]{2})?", first))
    return first in regional or first in languages or locale_tag


def _has_non_general_careers_prefix(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    segments = [segment.casefold() for segment in parsed.path.split("/") if segment]
    if not segments:
        return False
    ats_hosts = ("greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
                 "workday.com", "myworkdayjobs.com", "pinpointhq.com")
    host = (parsed.hostname or "").casefold().rstrip(".")
    if any(host == ats or host.endswith("." + ats) for ats in ats_hosts):
        return False
    general_roots = {"careers", "career", "jobs", "job-openings", "join-us", "join-our-team",
                     "open-positions", "vacancies", "work-with-us"}
    return segments[0] not in general_roots


def _is_narrow_careers_path(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    segments = [segment.casefold() for segment in parsed.path.split("/") if segment]
    narrow = {
        "career-types", "job-categories", "departments", "department", "locations", "location",
        "teams", "team", "technology", "tech", "engineering", "product", "sales", "marketing",
        "design", "finance", "operations", "support", "students", "student", "internships",
        "internship", "graduate", "graduates", "campus", "early-careers", "earlycareer",
        "stories", "blog", "editorial",
    }
    if any(segment in narrow for segment in segments):
        return True
    career_segments = {"careers", "career", "jobs", "job-openings", "join-us", "join-our-team"}
    if len(segments) >= 3 and any(segment in career_segments for segment in segments[:-1]):
        return True
    if _is_locale_path(url):
        remaining = segments[1:]
        return not remaining or remaining[-1] not in {"careers", "career", "jobs", "job-openings", "join-us", "join-our-team"}
    return False


def _explicit_global_scope_link(destination_record: dict[str, Any]) -> dict[str, Any] | None:
    pattern = re.compile(r"\b(global|worldwide|all\s+(?:roles|jobs|locations)|international\s+(?:careers|jobs))\b", re.I)
    links = destination_record.get("careers_links")
    if not isinstance(links, list):
        return None
    for link in links:
        if isinstance(link, dict) and isinstance(link.get("label"), str) and pattern.search(link["label"]):
            if _normalized_https_host_path(link.get("url")):
                return link
    return None


def load_destination_capture(path_token: str | Path | None,
                            evidence_root: str | Path | None) -> dict[str, Any] | None:
    if path_token is None:
        return None
    try:
        path, digest, raw = resolve_legacy_evidence_file(str(path_token), evidence_root)
        data = json.loads(_json_text(raw))
    except (FileNotFoundError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return {"error": str(error), "requested_path": str(path_token)}
    if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
        return {"error": "destination_check_file_must_be_json_array_of_objects",
                "path": str(path), "sha256": digest}
    return {"path": str(path), "sha256": digest, "rows": data}


def normalize_careers_destination_capture(normalized: dict[str, Any], company: dict[str, Any],
                                          proposed_value: Any, capture: dict[str, Any] | None) -> None:
    binding = normalized.get("legacy_corporate_binding") or {}
    if not (binding.get("company_key_match") is True and binding.get("target_href_match") is True
            and binding.get("source_url_match") is True and binding.get("source_title_match") is True):
        normalized["adapter_gap"] = "careers_source_line_binding_unverified"
        return
    if not isinstance(capture, dict):
        normalized["adapter_gap"] = "careers_destination_checks_missing"
        return
    if capture.get("error"):
        normalized["adapter_gap"] = "careers_destination_checks_unavailable"
        normalized["adapter_gap_detail"] = capture["error"]
        return
    target_key = _normalized_https_host_path(proposed_value)
    if target_key is None:
        normalized["adapter_gap"] = "careers_destination_target_not_https"
        return
    matches = []
    for index, row in enumerate(capture.get("rows", [])):
        if _normalized_https_host_path(row.get("requested_url")) != target_key:
            continue
        company_keys = row.get("company_keys")
        if company_keys is not None and (not isinstance(company_keys, list) or company["company_key"] not in company_keys):
            continue
        matches.append((index, row, company_keys))
    if len(matches) != 1:
        normalized["adapter_gap"] = "careers_destination_check_missing_or_ambiguous"
        return

    index, row, company_keys = matches[0]
    raw_status = row.get("status")
    try:
        status = int(raw_status) if raw_status is not None and not isinstance(raw_status, bool) else None
    except (TypeError, ValueError):
        status = None
    final_url = row.get("final_url")
    final_key = _normalized_https_host_path(final_url)
    normalized["destination_check_evidence"] = {
        "file": capture["path"],
        "file_sha256": capture["sha256"],
        "record_index": index + 1,
        "record_sha256": sha256_value(row),
        "requested_url": row.get("requested_url"),
        "final_url": final_url,
        "status": status,
        "title": row.get("title"),
        "company_key_match": company["company_key"] in company_keys if isinstance(company_keys, list) else None,
    }
    if status == 429:
        retry_delay = retry_after_seconds(str(row.get("retry_after"))) if row.get("retry_after") is not None else None
        normalized.update({
            "destination_access_status": "cooldown_pending",
            "destination_access_detail": "http_429_in_exact_destination_capture",
            "transport_error": "HTTP 429 Too Many Requests in exact careers destination capture",
        })
        if retry_delay is not None:
            normalized["destination_retry_after_seconds"] = retry_delay
        return
    if status in {401, 403}:
        normalized["destination_access_status"] = "access_denied"
        normalized["adapter_gap"] = "careers_destination_access_denied"
        return
    if status == 404:
        normalized["destination_access_status"] = "unavailable"
        normalized["adapter_gap"] = "careers_destination_unavailable"
        return
    if status is None or not 200 <= status < 300:
        normalized["destination_access_status"] = "unknown"
        normalized["adapter_gap"] = "careers_destination_status_unverified"
        return

    normalized["destination_access_status"] = "available"
    if final_key != target_key:
        normalized["destination_access_detail"] = "redirect_target_not_canonicalized"
        normalized["adapter_gap"] = "careers_destination_redirect_unverified"
        return
    localized_target = _is_locale_path(str(proposed_value))
    scoped_target = localized_target or _has_non_general_careers_prefix(str(proposed_value))
    if _is_narrow_careers_path(str(proposed_value)) or (
        not localized_target and not is_direct_careers_portal(str(proposed_value))
    ):
        normalized["destination_access_detail"] = "destination_is_not_a_general_careers_entrypoint"
        normalized["adapter_gap"] = "careers_destination_narrow_or_unverified"
        return

    source_link_label = str(binding.get("target_href_label") or "").strip()
    source_title = str(binding.get("source_title") or "").strip()
    destination_title = str(row.get("title") or "").strip()
    if not source_link_label or not re.search(r"career|job|join", source_link_label, re.I):
        normalized["destination_access_detail"] = "employer_link_label_not_careers_or_jobs"
        normalized["adapter_gap"] = "careers_source_link_label_unverified"
        return
    if not destination_title or re.search(r"\b(?:internships?|students?|graduates?|early\s*careers?|stories|blog|editorial)\b", destination_title, re.I):
        normalized["destination_access_detail"] = "destination_title_missing_or_narrow"
        normalized["adapter_gap"] = "careers_destination_narrow_or_unverified"
        return

    if scoped_target:
        global_link = _explicit_global_scope_link(row)
        global_title = bool(re.search(
            r"\b(global|worldwide|all\s+(?:roles|jobs|locations)|international\s+(?:careers|jobs))\b",
            destination_title, re.I))
        if not global_link and not global_title:
            normalized["destination_access_detail"] = "localized_destination_without_explicit_global_roles"
            normalized["adapter_gap"] = "careers_regional_scope_unverified"
            return
        scope = "companywide_general_jobs"
        excerpt_parts = [source_title, source_link_label, destination_title]
        if global_link:
            excerpt_parts.extend([str(global_link.get("label") or ""), str(global_link.get("url") or "")])
    else:
        scope = "general_jobs_portal"
        excerpt_parts = [source_title, source_link_label, destination_title]
    normalized["careers_scope"] = scope
    normalized["careers_scope_excerpt"] = " | ".join(part for part in excerpt_parts if part)
    normalized["destination_access_detail"] = "exact_company_link_and_destination_capture_match"


def normalize_legacy_source_line(normalized: dict[str, Any], company: dict[str, Any], evidence_root: str | Path | None,
                                 field: str, proposed_value: Any) -> None:
    source_file, line_number = normalized.get("source_file"), normalized.get("line")
    if not isinstance(source_file, str):
        return
    source_url_hint = normalized.get("source_url") or normalized.get("url")
    for key in ("http_status", "status", "source_access", "identity"):
        normalized.pop(key, None)
    if not isinstance(line_number, int) or isinstance(line_number, bool) or line_number < 1:
        normalized.update({"adapter_gap": "source_file_line_shape_unsupported",
                           "source_access": {"status": "unknown", "method": "saved_corporate_source_line_unavailable"}})
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return
    try:
        path, digest, raw = resolve_legacy_evidence_file(source_file, evidence_root)
    except (FileNotFoundError, ValueError, UnicodeDecodeError) as error:
        normalized.update({"adapter_gap": "source_file_line_unavailable",
                           "adapter_gap_detail": str(error),
                           "source_access": {"status": "unknown", "method": "saved_corporate_source_line_unavailable"}})
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return
    # JSONL record indexes are LF-delimited; str.splitlines() also splits U+2028
    # embedded in a JSON string and shifts every later evidence line reference.
    lines = raw.decode("utf-8", errors="replace").split("\n")
    if line_number > len(lines):
        normalized.update({"adapter_gap": "source_file_line_out_of_range",
                           "source_access": {"status": "unknown", "method": "source_line_out_of_range", "raw_file_sha256": digest}})
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return
    line = lines[line_number - 1]
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        record = None
    if not isinstance(record, dict):
        normalized.update({"adapter_gap": "source_file_line_unparseable",
                           "source_access": {"status": "unknown", "method": "source_line_unparseable", "raw_file_sha256": digest}})
        normalized.pop("source_url", None)
        normalized.pop("excerpt", None)
        return

    links = record.get("careers_links")
    links = links if isinstance(links, list) else []
    matching_links = [item for item in links if isinstance(item, dict) and item.get("url") == proposed_value]
    key_list = record.get("company_keys")
    key_list = key_list if isinstance(key_list, list) else []
    source_status_raw = record.get("status")
    try:
        source_status = int(source_status_raw) if source_status_raw is not None and not isinstance(source_status_raw, bool) else None
    except (TypeError, ValueError):
        source_status = None
    source_url = record.get("requested_url") if isinstance(record.get("requested_url"), str) else None
    source_final_url = record.get("final_url") if isinstance(record.get("final_url"), str) else None
    source_hint_key = _normalized_https_source_url(source_url_hint)
    source_url_match = bool(source_hint_key and source_hint_key in {
        _normalized_https_source_url(source_url),
        _normalized_https_source_url(source_final_url),
    })
    source_title = record.get("title") if isinstance(record.get("title"), str) else ""
    company_key_match = company["company_key"] in key_list
    target_href_match = len(matching_links) == 1
    title_match = _company_title_matches(source_title, company["company_name"])
    excerpt = normalized.get("excerpt")
    excerpt_match = isinstance(excerpt, str) and bool(excerpt.strip()) and excerpt in line
    if not excerpt_match or len(str(excerpt).strip()) < 12:
        excerpt = source_title
    if not isinstance(excerpt, str) or not excerpt.strip():
        normalized.pop("excerpt", None)
        excerpt = ""
    else:
        normalized["excerpt"] = excerpt
    if not title_match and excerpt_match and normalize_name(company["company_name"]) in normalize_name(str(normalized.get("excerpt", ""))):
        title_match = True
    source_content_observed = (company_key_match and target_href_match and source_url_match and title_match
                               and (source_status is None or 200 <= source_status < 300))
    target_link = matching_links[0] if target_href_match else {}
    target_label = target_link.get("label") if isinstance(target_link.get("label"), str) else ""
    normalized.update({
        "raw_file": str(path), "raw_file_sha256": digest, "raw_source_block": line,
        "raw_source_block_sha256": sha256_bytes(line.encode("utf-8")),
        "source_url": source_url or "", "excerpt": excerpt, "raw_line_number": line_number,
        "legacy_corporate_binding": {
            "company_key_match": company_key_match,
            "source_url_match": source_url_match,
            "source_title_match": title_match,
            "target_href_match": target_href_match,
            "source_status": source_status,
            "source_title": source_title,
            "source_requested_url": source_url,
            "source_final_url": source_final_url,
            "target_href_label": target_label,
        },
    })
    if not source_url:
        normalized.pop("source_url", None)
    if source_status is not None:
        normalized["http_status"] = source_status
    if source_status == 429:
        normalized["transport_error"] = "HTTP 429 Too Many Requests in exact corporate source-line capture"
    normalized["source_access"] = {
        "status": "content_observed" if source_content_observed else "unknown",
        "method": "saved_corporate_footer_line",
        "raw_file_sha256": digest,
        "line": line_number,
    }
    if source_content_observed:
        context = source_title or str(excerpt)
        normalized["identity"] = {
            "observed_company_name": company["company_name"],
            "business_context": context,
            "name_match": True,
            "identity_basis": "raw_company_footer_title_link_and_source_url",
        }


def normalize_packet_evidence(evidence: Any, company: dict[str, Any], evidence_root: str | Path | None = None,
                              field: str | None = None, proposed_value: Any = None,
                              destination_capture: dict[str, Any] | None = None) -> Any:
    """Preserve source records; add only mechanically observed access/hash metadata."""
    if not isinstance(evidence, dict):
        return evidence
    normalized = dict(evidence)
    if "source_url" not in normalized and isinstance(normalized.get("url"), str):
        normalized["source_url"] = normalized["url"]
    raw_file = normalized.get("raw_file")
    raw_bytes = b""
    if isinstance(raw_file, str):
        raw_path, digest, raw_bytes = _safe_evidence_file(raw_file, evidence_root)
        normalized["raw_file"] = str(raw_path)
        normalized["raw_file_sha256"] = digest
        transport_text = raw_bytes.decode("utf-8", errors="replace")
        source_excerpt = source_specific_raw_text(transport_text, normalized.get("source_url"), normalized.get("source_ref"))
        matched = bool(source_excerpt)
        normalized.pop("raw_source_links", None)
        normalized["raw_source_reference_match"] = matched
        normalized["raw_source_block_sha256"] = sha256_bytes(source_excerpt.encode("utf-8")) if matched else None
        normalized["raw_source_block"] = source_excerpt[:50000] if matched and len(source_excerpt) <= 50000 else None
        if "http_status" not in normalized and "source_access" not in normalized:
            normalized["source_access"] = ({"status": "content_observed", "method": "cached_primary_page", "raw_file_sha256": digest}
                                            if matched else {"status": "unknown", "method": "cached_file_missing_exact_source_reference"})
        # Only inspect the matching page block; another company's 429 in a batch file
        # cannot contaminate this candidate's access state.
        if source_excerpt and wrapped_transport_status({"raw_response_excerpt": source_excerpt[:20000]}) == 429:
            normalized["transport_error"] = "wrapped_http_429_detected_in_matching_source_block"
    if "raw_find_file" in normalized or "raw_click_file" in normalized:
        normalize_legacy_linkedin_observation(normalized, company, evidence_root, proposed_value)
    if "source_file" in normalized and "line" in normalized:
        normalize_legacy_source_line(normalized, company, evidence_root, field or "", proposed_value)
    source_locator_present = "source_file" in normalized or "line" in normalized
    source_locator_supported = (
        isinstance(normalized.get("source_file"), str)
        and isinstance(normalized.get("line"), int)
        and not isinstance(normalized.get("line"), bool)
        and normalized.get("line") >= 1
    )
    if field == "careers_url" and source_locator_present and not source_locator_supported:
        normalized["adapter_gap"] = "source_file_line_shape_unsupported"
        for key in ("http_status", "status", "identity", "source_access"):
            normalized.pop(key, None)
        normalized["source_access"] = {"status": "unknown", "method": "unsupported_source_line_shape"}
    raw_like_fields = {"raw", "corporate_raw"}
    supported_raw_path = (isinstance(normalized.get("raw_file"), str)
                          or (isinstance(normalized.get("raw_find_file"), str)
                              and isinstance(normalized.get("raw_click_file"), str)))
    if raw_like_fields.intersection(normalized) and not supported_raw_path:
        normalized["adapter_gap"] = "unsupported_raw_evidence_shape"
        for key in ("http_status", "status", "identity", "source_access"):
            normalized.pop(key, None)
        normalized["source_access"] = {"status": "unknown", "method": "unsupported_evidence_adapter_gap"}
    if (not normalized.get("adapter_gap") and field == "careers_url"
            and isinstance(normalized.get("source_file"), str)
            and isinstance(normalized.get("line"), int)):
        source_binding = normalized.get("legacy_corporate_binding") or {}
        source_complete = (
            source_binding.get("company_key_match") is True
            and source_binding.get("target_href_match") is True
            and source_binding.get("source_url_match") is True
            and source_binding.get("source_title_match") is True
            and isinstance(normalized.get("source_access"), dict)
            and normalized["source_access"].get("status") == "content_observed"
        )
        if not source_complete:
            normalized["adapter_gap"] = "careers_source_line_binding_unverified"
        else:
            normalize_careers_destination_capture(normalized, company, proposed_value, destination_capture)
    # Exact registered-name text in a cited excerpt is an observation only; no HTTP or
    # official-domain flag is inferred here.
    identity = normalized.get("identity")
    excerpt = normalized.get("excerpt")
    if not normalized.get("adapter_gap") and not identity and isinstance(excerpt, str) and normalize_name(company["company_name"]) and normalize_name(company["company_name"]) in normalize_name(excerpt):
        normalized["identity"] = {"observed_company_name": company["company_name"], "business_context": excerpt,
                                   "extraction": "exact_registry_name_in_cited_excerpt"}
    return normalized


def import_packet(conn: sqlite3.Connection, packet: dict[str, Any], evidence_root: str | Path | None = None,
                  destination_checks_file: str | Path | None = None) -> dict[str, int]:
    if not isinstance(packet, dict):
        raise ValueError("packet must be an object")
    updates = packet.get("updates", packet.get("patches", packet.get("candidates")))
    if not isinstance(updates, list):
        raise ValueError("packet must contain updates or patches array")
    if packet.get("baseline") is not None:
        supplied = validate_full_baseline(packet["baseline"])
        saved = get_baseline(conn)
        if sha256_value(supplied) != sha256_value(saved):
            raise ValueError("packet baseline does not exactly match initialized full-row snapshot")
    destination_capture = load_destination_capture(destination_checks_file, evidence_root) if destination_checks_file is not None else None
    counts = {"imported": 0, "rejected": 0, "exceptions": 0, "unchanged": 0}
    known_groups = {row.get("domain_group") for row in get_baseline(conn) if row.get("domain_group") not in (None, "")}
    conn.execute("BEGIN IMMEDIATE")
    try:
        for update in updates:
            if not isinstance(update, dict) or not isinstance(update.get("fields"), dict):
                raise ValueError("each update requires company_key and fields object")
            key = update.get("company_key")
            stored = conn.execute("SELECT row_json FROM companies WHERE company_key=?", (key,)).fetchone()
            if not stored:
                raise ValueError(f"unknown company_key in packet: {key}")
            company = json.loads(stored[0])
            expected_obj = update.get("expected", {}) or {}
            evidence_obj = update.get("evidence", {}) or {}
            for field, value in update["fields"].items():
                if field not in FIELDS:
                    raise ValueError(f"field {field} is outside seven-field allowlist")
                expected = expected_obj[field] if isinstance(expected_obj, dict) and field in expected_obj else company.get(field)
                current = company.get(field)
                # A replay is a no-op only when the requested value is already
                # present; never rewrite a stale expected value to the new baseline.
                if value == current:
                    counts["unchanged"] += 1
                    continue
                if expected != current:
                    raise ValueError(f"stale expected old value for {key}.{field}")
                original_evidence = evidence_obj.get(field) if isinstance(evidence_obj, dict) and field in evidence_obj else evidence_obj
                evidence = normalize_packet_evidence(original_evidence, company, evidence_root, field, value,
                                                    destination_capture=destination_capture)
                validation, reason, confidence = validate_candidate(field, value, evidence, company)
                if field == "domain_group" and validation == "valid_pending_review":
                    if value not in known_groups:
                        validation, reason, confidence = "exception", "unknown_domain_group_taxonomy", "medium"
                evidence_hash = sha256_value(evidence)
                candidate_id = sha256_value({"company_key": key, "field": field, "expected": expected, "new": value, "evidence_sha256": evidence_hash})
                cursor = conn.execute("INSERT OR IGNORE INTO proposals(candidate_id,company_key,field,expected_json,new_json,evidence_json,evidence_sha256,identity_confidence,validation_status,validation_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                             (candidate_id, key, field, canonical_json(expected), canonical_json(value), canonical_json(evidence), evidence_hash, confidence, validation, reason, utc_now()))
                if cursor.rowcount == 0:
                    continue
                if validation == "valid_pending_review":
                    counts["imported"] += 1
                elif validation == "rejected":
                    counts["rejected"] += 1
                elif validation == "deferred_cooldown":
                    counts.setdefault("deferred", 0)
                    counts["deferred"] += 1
                    counts["exceptions"] += 1
                else:
                    counts["exceptions"] += 1
                    exc_id = exception_id(key, field, reason or "unresolved", evidence)
                    conn.execute("INSERT OR IGNORE INTO exceptions(exception_id,company_key,field,reason,evidence_json,created_at) VALUES(?,?,?,?,?,?)",
                                 (exc_id, key, field, reason or "unresolved", canonical_json(evidence), utc_now()))
        conn.execute("INSERT INTO audit(audit_id,action,subject,payload_json,created_at) VALUES(?,?,?,?,?)",
                     (secrets.token_hex(16), "import_packet", packet.get("packet_id", "unlabeled"), canonical_json(counts), utc_now()))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return counts


def candidate_hash(row: sqlite3.Row | dict[str, Any]) -> str:
    return sha256_value({k: row[k] for k in ("candidate_id", "company_key", "field", "expected_json", "new_json", "evidence_sha256", "validation_status")})


def approve_candidate(conn: sqlite3.Connection, candidate_id: str, reviewer: str, expected_sha: str) -> None:
    if not reviewer.strip():
        raise ValueError("reviewer is required")
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT * FROM proposals WHERE candidate_id=?", (candidate_id,)).fetchone()
        if not row:
            raise ValueError("candidate not found")
        if row["validation_status"] != "valid_pending_review":
            raise ValueError("only deterministically valid pending candidates can be approved")
        if candidate_hash(row) != expected_sha:
            raise ValueError("candidate changed since review; refusing stale approval")
        if row["approved"]:
            raise ValueError("candidate approval is immutable once recorded")
        conn.execute("UPDATE proposals SET approved=1,reviewer=?,reviewed_at=? WHERE candidate_id=? AND approved=0",
                     (reviewer, utc_now(), candidate_id))
        conn.execute("INSERT INTO audit(audit_id,action,subject,payload_json,created_at) VALUES(?,?,?,?,?)",
                     (secrets.token_hex(16), "approve_candidate", candidate_id, canonical_json({"reviewer": reviewer, "candidate_sha256": expected_sha}), utc_now()))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def approve_candidates(conn: sqlite3.Connection, candidates: list[dict[str, str]], reviewer: str) -> int:
    if not reviewer.strip() or not candidates:
        raise ValueError("reviewer and nonempty candidate list are required")
    conn.execute("BEGIN IMMEDIATE")
    try:
        checked: list[tuple[str, str]] = []
        seen: set[str] = set()
        for item in candidates:
            candidate_id = item.get("candidate_id", "")
            expected_sha = item.get("candidate_sha256", "")
            if not candidate_id or candidate_id in seen:
                raise ValueError("missing or duplicate candidate_id in approval manifest")
            seen.add(candidate_id)
            row = conn.execute("SELECT * FROM proposals WHERE candidate_id=?", (candidate_id,)).fetchone()
            if not row or row["validation_status"] != "valid_pending_review" or candidate_hash(row) != expected_sha:
                raise ValueError(f"candidate missing, invalid, or changed since review: {candidate_id}")
            if row["approved"]:
                raise ValueError(f"candidate approval is immutable once recorded: {candidate_id}")
            checked.append((candidate_id, expected_sha))
        for candidate_id, expected_sha in checked:
            conn.execute("UPDATE proposals SET approved=1,reviewer=?,reviewed_at=? WHERE candidate_id=? AND approved=0",
                         (reviewer, utc_now(), candidate_id))
            conn.execute("INSERT INTO audit(audit_id,action,subject,payload_json,created_at) VALUES(?,?,?,?,?)",
                         (secrets.token_hex(16), "approve_candidate", candidate_id, canonical_json({"reviewer": reviewer, "candidate_sha256": expected_sha}), utc_now()))
        conn.commit()
        return len(checked)
    except Exception:
        conn.rollback()
        raise


def make_report(conn: sqlite3.Connection) -> dict[str, Any]:
    companies = get_baseline(conn)
    out_rows: list[dict[str, Any]] = []
    totals: dict[str, dict[str, int]] = {field: {} for field in FIELDS}
    proposals: dict[tuple[str, str], list[sqlite3.Row]] = {}
    jobs: dict[tuple[str, str], list[sqlite3.Row]] = {}
    for row in conn.execute("SELECT company_key,field,validation_status,approved FROM proposals ORDER BY created_at DESC"):
        proposals.setdefault((row["company_key"], row["field"]), []).append(row)
    for row in conn.execute("SELECT company_key,task_kind,status,result_json,updated_at FROM jobs ORDER BY updated_at DESC"):
        jobs.setdefault((row["company_key"], row["task_kind"]), []).append(row)
    for company in companies:
        item: dict[str, Any] = {"company_key": company["company_key"], "company_name": company["company_name"], "fields": {}}
        for field in FIELDS:
            candidates = proposals.get((company["company_key"], field), [])
            field_jobs = jobs.get((company["company_key"], FIELD_TASK[field]), [])
            if any(row["approved"] for row in candidates):
                state = "approved_proposal_pending_apply"
            elif any(row["validation_status"] == "valid_pending_review" for row in candidates):
                state = "proposal_pending_review"
            elif any(row["validation_status"] == "deferred_cooldown" for row in candidates):
                state = "cooldown_pending"
            elif any(row["validation_status"] == "exception" for row in candidates):
                state = "identity_or_taxonomy_exception"
            elif field_jobs:
                status = field_jobs[0]["status"]
                state = {"completed": "source_observed_requires_field_validation", "unavailable": "source_unavailable", "policy_denied": "policy_denied_no_retry", "source_refused": "source_refused", "cooldown_pending": "cooldown_pending", "awaiting_import": "awaiting_permitted_evidence_import", "pending": "queued", "leased": "in_progress", "failed": "source_failed"}.get(status, status)
            else:
                state = "present_unverified" if company.get(field) not in (None, "") else "pending_source_attempt"
            item["fields"][field] = {"state": state, "baseline_value_present": company.get(field) not in (None, "")}
            totals[field][state] = totals[field].get(state, 0) + 1
        out_rows.append(item)
    return {"generated_at": utc_now(), "company_count": len(out_rows), "field_count": len(FIELDS), "rows": out_rows, "coverage": totals}


def make_approved_manifest(conn: sqlite3.Connection) -> dict[str, Any]:
    baseline = get_baseline(conn)
    rows = conn.execute("SELECT * FROM proposals WHERE approved=1 ORDER BY company_key,field,candidate_id").fetchall()
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["validation_status"] != "valid_pending_review":
            raise ValueError("approved manifest contains invalid proposal")
        group = grouped.setdefault(row["company_key"], {"company_key": row["company_key"], "fields": {}, "expected": {}, "evidence": {}, "review": {}})
        if row["field"] in group["fields"]:
            raise ValueError(f"conflicting approved candidates for {row['company_key']}.{row['field']}")
        group["fields"][row["field"]] = json.loads(row["new_json"])
        group["expected"][row["field"]] = json.loads(row["expected_json"])
        group["evidence"][row["field"]] = json.loads(row["evidence_json"])
        group["review"][row["field"]] = {"candidate_id": row["candidate_id"], "candidate_sha256": candidate_hash(row), "reviewer": row["reviewer"], "reviewed_at": row["reviewed_at"]}
    document: dict[str, Any] = {"schema_version": 1, "baseline_sha256": sha256_value(baseline), "baseline": baseline, "updates": list(grouped.values())}
    document["manifest_sha256"] = sha256_value(document)
    return document


def reconcile_expected(conn: sqlite3.Connection, expected_tasks: list[dict[str, Any]], outcomes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    ids = [task_id(task) for task in expected_tasks]
    duplicates = sorted(job for job, count in Counter(ids).items() if count > 1)
    expected = set(ids)
    stored = {row[0] for row in conn.execute("SELECT job_id FROM jobs")}
    finished = {row[0] for row in conn.execute("SELECT job_id FROM jobs WHERE status IN ('completed','unavailable','policy_denied','source_refused','failed')")}
    if outcomes is None:
        outcome_ids = sorted(finished)
    else:
        outcome_ids = [task_id(item["task"]) for item in outcomes]
    outcome_duplicates = sorted(job for job, count in Counter(outcome_ids).items() if count > 1)
    observed = set(outcome_ids)
    return {"expected_count": len(expected), "expected_duplicates": duplicates,
            "missing_jobs": sorted(expected - stored), "unexpected_jobs": sorted(stored - expected),
            "missing_outcomes": sorted(expected - observed), "duplicate_outcomes": outcome_duplicates,
            "not_terminal": sorted(expected - finished), "complete": not duplicates and not outcome_duplicates and expected == stored and expected <= finished}


class SimpleHTML(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}
        self.links: list[dict[str, str]] = []
        self._active_link: int | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key.casefold(): value or "" for key, value in attrs}
        if tag.casefold() == "title":
            self._in_title = True
        if tag.casefold() == "meta":
            name = attr.get("name", "").casefold() or attr.get("property", "").casefold()
            if name in {"description", "og:site_name", "og:title", "industry", "og:locale"}:
                self.meta[name] = attr.get("content", "")
        if tag.casefold() == "a" and attr.get("href"):
            self.links.append({"href": attr["href"], "text": ""})
            self._active_link = len(self.links) - 1
        self._text.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() == "title":
            self._in_title = False
        elif tag.casefold() == "a":
            self._active_link = None

    def handle_data(self, data: str) -> None:
        normalized = re.sub(r"\s+", " ", data).strip()
        if not normalized:
            return
        self._text.append(normalized)
        if self._in_title:
            self.title += normalized + " "
        if self._active_link is not None:
            link = self.links[self._active_link]
            link["text"] += (" " if link["text"] else "") + normalized


def extract_corporate_observation(source_url: str, status: int, body: bytes) -> dict[str, Any]:
    text = body.decode("utf-8", errors="replace")
    parser = SimpleHTML()
    parser.feed(text[:2_000_000])
    host = urllib.parse.urlsplit(source_url).hostname or ""
    career_links = []
    linkedin_links = []
    for link in parser.links:
        target = urllib.parse.urljoin(source_url, link["href"])
        target_host = urllib.parse.urlsplit(target).hostname or ""
        label = (link["text"] + " " + link["href"]).casefold()
        if target_host.casefold() in {host.casefold(), "careers." + host.casefold()} or any(x in target_host.casefold() for x in ("greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com", "workday.com")):
            if re.search(r"career|job|join|vacanc|open position", label):
                career_links.append({"href": target, "text": link["text"][:180]})
        if target_host.casefold() in {"linkedin.com", "www.linkedin.com"}:
            if re.fullmatch(r"/company/[^/]+/?", urllib.parse.urlsplit(target).path, re.I):
                linkedin_links.append({"href": target, "text": link["text"][:180]})
    return {"source_url": source_url, "http_status": status, "title": parser.title.strip()[:300],
            "meta": parser.meta, "career_links": career_links[:100], "published_linkedin_company_links": linkedin_links[:50],
            "body_sha256": sha256_bytes(body), "body_bytes": len(body)}


def safe_public_target(url: str) -> tuple[str, int, str, str]:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("only credential-free HTTPS public URLs on port 443 are allowed")
    host = parsed.hostname.encode("idna").decode("ascii").lower()
    if host == "linkedin.com" or host.endswith(".linkedin.com") or host in {"lnkd.in", "www.lnkd.in"}:
        raise PermissionError("LinkedIn and redirector destinations require imported evidence")
    port = parsed.port or 443
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as error:
        raise ConnectionError("DNS lookup failed") from error
    ips = sorted({item[4][0] for item in infos})
    if not ips or any(not ipaddress.ip_address(item.split("%", 1)[0]).is_global for item in ips):
        raise PermissionError("host resolved to a non-public address")
    target = urllib.parse.urlunsplit(("https", urllib.parse.urlunsplit(("", "", host, "", "")), parsed.path or "/", parsed.query, ""))
    return host, port, ips[0], target


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, ip: str, timeout: float) -> None:
        super().__init__(host, port=port, timeout=timeout, context=ssl.create_default_context())
        self._pinned_ip = ip

    def connect(self) -> None:
        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def fetch_public_https(url: str, *, timeout: float = 15, max_bytes: int = 2_000_000, max_redirects: int = 5) -> tuple[str, int, dict[str, str], bytes]:
    current = url
    for _ in range(max_redirects + 1):
        host, port, ip, _ = safe_public_target(current)
        parsed = urllib.parse.urlsplit(current)
        target = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
        conn = PinnedHTTPSConnection(host, port, ip, timeout)
        try:
            conn.request("GET", target, headers={"User-Agent": "OpenQareer-B614-Enrichment/1.0", "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "Connection": "close"})
            response = conn.getresponse()
            headers = {k.lower(): v for k, v in response.getheaders()}
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError("response exceeds configured byte limit")
            if response.status in {301, 302, 303, 307, 308} and headers.get("location"):
                current = urllib.parse.urljoin(current, headers["location"])
                continue
            return current, response.status, headers, body
        finally:
            conn.close()
    raise ValueError("too many redirects")


def rate_limit_result(conn: sqlite3.Connection, provider: str, host: str, attempt: int, retry_after: float | None, *, now: float | None = None) -> float:
    now = time.time() if now is None else now
    row = conn.execute("SELECT consecutive_429 FROM host_budget WHERE provider=? AND host=?", (provider, host)).fetchone()
    consecutive = (row[0] if row else 0) + 1
    delay = backoff_delay(consecutive, retry_after)
    conn.execute("INSERT INTO host_budget(provider,host,next_allowed,consecutive_429) VALUES(?,?,?,?) ON CONFLICT(provider,host) DO UPDATE SET next_allowed=excluded.next_allowed,consecutive_429=excluded.consecutive_429",
                 (provider, host, now + delay, consecutive))
    return delay


def source_cache_lookup(conn: sqlite3.Connection, provider: str, source_url: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT response_sha256,evidence_json,observed_status,observed_at FROM source_cache WHERE provider=? AND source_url=? ORDER BY observed_at DESC LIMIT 1",
                        (provider, source_url)).fetchone()
    if not row:
        return None
    return {"response_sha256": row["response_sha256"], "evidence": json.loads(row["evidence_json"]),
            "observed_status": row["observed_status"], "observed_at": row["observed_at"]}


def reserve_host_budget(state_path: str | Path, provider: str, host: str, min_interval: float) -> float:
    """Persist a per-host reservation; returns cooldown seconds instead of sleeping."""
    conn = db_connect(state_path)
    try:
        now = time.time()
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT next_allowed FROM host_budget WHERE provider=? AND host=?", (provider, host)).fetchone()
        if row and float(row[0]) > now:
            delay = float(row[0]) - now
            conn.commit()
            return delay
        conn.execute("INSERT INTO host_budget(provider,host,next_allowed,consecutive_429) VALUES(?,?,?,0) ON CONFLICT(provider,host) DO UPDATE SET next_allowed=excluded.next_allowed",
                     (provider, host, now + min_interval))
        conn.commit()
        return 0.0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def run_corporate_jobs(state_path: str | Path, *, limit: int, concurrency: int, kill_switch: str | None = None,
                       min_host_interval: float = 2.0) -> dict[str, int]:
    """Fail closed until per-request host pacing includes reviewed jitter."""
    raise PermissionError("corporate-fetch is disabled until jittered normal host pacing is implemented and reviewed")


def benchmark_synthetic(job_count: int) -> dict[str, Any]:
    if job_count < 1:
        raise ValueError("job count must be positive")
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="b614-synthetic-") as temp_dir:
        root = Path(temp_dir)
        os.chmod(root, 0o700)
        baseline = []
        tasks = []
        for i in range(job_count):
            key = f"synthetic-{i:05d}"
            baseline.append({
                "company_key": key, "company_name": f"Synthetic Company {i}", "website_url": f"https://synthetic-{i:05d}.invalid",
                "careers_url": None, "linkedin_url": None, "linkedin_org_id": None, "source_type": "corporate_portal",
                "ats_provider": None, "ats_slug": None, "status": "active", "geo": None, "industry": None,
                "domain_group": None, "notes": None, "created_at": "synthetic", "updated_at": "synthetic",
            })
            tasks.append({"company_key": key, "task_kind": "corporate_profile", "provider": "corporate", "source_url": f"https://synthetic-{i:05d}.invalid/about"})
        baseline_path = root / "baseline.json"
        private_write(baseline_path, json.dumps(baseline, separators=(",", ":")).encode())
        state_path = root / "queue.sqlite"
        init_state(state_path, baseline_path)
        conn = open_state(state_path)
        first_enqueue = enqueue_tasks(conn, tasks)
        replay_enqueue = enqueue_tasks(conn, tasks)
        claimed = claim_jobs(conn, job_count, 60, now=1000)
        first_checkpoint = [{"job_id": row["job_id"], "lease_token": row["lease_token"], "status": "completed", "result": {"synthetic": True}}
                            for row in claimed[:min(40, job_count)]]
        record_jobs_batch(conn, first_checkpoint, now=1001)
        conn.close()
        # Simulate restart after the lease expiry. The remaining work is found from the
        # persistent queue by stable ID; no array offset or batch count is trusted.
        conn = open_state(state_path)
        resumed = claim_jobs(conn, job_count, 60, now=1061)
        record_jobs_batch(conn, [{"job_id": row["job_id"], "lease_token": row["lease_token"], "status": "completed", "result": {"synthetic": True}} for row in resumed], now=1062)
        queue_complete = reconcile_expected(conn, tasks)
        # Populate compact synthetic cache entries, then look them up through the same
        # SQLite cache interface used by the corporate adapter. No network is invoked.
        cache_rows = []
        for task in tasks:
            observation = {"source_url": task["source_url"], "synthetic": True}
            digest = sha256_value(observation)
            cache_rows.append((sha256_value({"provider": "corporate", "url": task["source_url"], "body_sha256": digest}),
                               "corporate", task["source_url"], digest, 200, canonical_json(observation), "synthetic"))
        conn.executemany("INSERT INTO source_cache(cache_key,provider,source_url,response_sha256,observed_status,evidence_json,observed_at) VALUES(?,?,?,?,?,?,?)", cache_rows)
        cache_hits = sum(source_cache_lookup(conn, "corporate", task["source_url"]) is not None for task in tasks)
        conn.close()
        if not queue_complete["complete"] or first_enqueue != {"added": job_count, "deduplicated": 0} or replay_enqueue != {"added": 0, "deduplicated": job_count}:
            raise RuntimeError("synthetic SQLite queue reconciliation failed")
    elapsed = time.perf_counter() - started
    return {"mode": "synthetic_offline_sqlite_queue_cache_only", "jobs_requested": job_count,
            "first_enqueue": first_enqueue["added"], "duplicate_replay_deduplicated": replay_enqueue["deduplicated"],
            "first_checkpoint_completed": min(40, job_count), "resumed_by_stable_id": len(resumed),
            "exact_reconciliation_complete": queue_complete["complete"], "cache_hits": cache_hits,
            "network_requests": 0, "seconds": round(elapsed, 6), "jobs_per_second": round(job_count / max(elapsed, 1e-9), 1)}


def command_init(args: argparse.Namespace) -> int:
    print(json.dumps(init_state(args.state, args.baseline), ensure_ascii=False))
    return 0


def command_enqueue(args: argparse.Namespace) -> int:
    with open_state(args.state) as conn:
        tasks = baseline_tasks(conn) if args.from_baseline else load_task_file(args.tasks)
        result = enqueue_tasks(conn, tasks)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def command_claim(args: argparse.Namespace) -> int:
    with open_state(args.state) as conn:
        claimed = claim_jobs(conn, args.limit, args.lease_seconds)
    print(json.dumps({"claimed": claimed}, ensure_ascii=False))
    return 0


def command_record(args: argparse.Namespace) -> int:
    result = json.loads(args.result)
    with open_state(args.state) as conn:
        record_job(conn, args.job_id, args.lease_token, args.status, result)
    print(json.dumps({"recorded": args.job_id, "status": args.status}))
    return 0


def command_import(args: argparse.Namespace) -> int:
    packet = read_json(args.packet)
    with open_state(args.state) as conn:
        result = import_packet(conn, packet, evidence_root=args.evidence_root,
                               destination_checks_file=args.destination_checks)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def command_approve(args: argparse.Namespace) -> int:
    with open_state(args.state) as conn:
        approve_candidate(conn, args.candidate_id, args.reviewer, args.candidate_sha256)
    print(json.dumps({"approved": args.candidate_id, "reviewer": args.reviewer}))
    return 0


def command_approve_batch(args: argparse.Namespace) -> int:
    manifest = read_json(args.manifest)
    candidates = manifest.get("candidates") if isinstance(manifest, dict) else None
    if not isinstance(candidates, list):
        raise ValueError("approval manifest must contain candidates array")
    with open_state(args.state) as conn:
        count = approve_candidates(conn, candidates, args.reviewer)
    print(json.dumps({"approved": count, "reviewer": args.reviewer}))
    return 0


def command_reconcile(args: argparse.Namespace) -> int:
    tasks = load_task_file(args.tasks)
    with open_state(args.state) as conn:
        result = reconcile_expected(conn, tasks)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["complete"] else 1


def command_report(args: argparse.Namespace) -> int:
    with open_state(args.state) as conn:
        report = make_report(conn)
    encoded = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode()
    if args.out:
        private_write(ensure_private_external_path(args.out), encoded)
    else:
        print(encoded.decode(), end="")
    return 0


def command_export(args: argparse.Namespace) -> int:
    with open_state(args.state) as conn:
        manifest = make_approved_manifest(conn)
    private_write(ensure_private_external_path(args.out), (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode())
    print(json.dumps({"updates": len(manifest["updates"]), "manifest_sha256": manifest["manifest_sha256"], "out": args.out}))
    return 0


def read_full_db(conn: sqlite3.Connection) -> tuple[list[str], list[dict[str, Any]]]:
    info = conn.execute("PRAGMA table_info(company_directory)").fetchall()
    columns = [row["name"] for row in info]
    if set(columns) != set(FULL_COLUMNS) or len(columns) != len(FULL_COLUMNS):
        raise ValueError("live company_directory schema is not the complete 16-column apply contract")
    rows = [dict(row) for row in conn.execute("SELECT * FROM company_directory ORDER BY company_key").fetchall()]
    normalized = [{column: row[column] for column in FULL_COLUMNS} for row in rows]
    return columns, normalized


def verify_exported_manifest(conn_state: sqlite3.Connection, manifest: dict[str, Any], confirmed_sha: str | None) -> tuple[dict[str, dict[str, Any]], str]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("manifest_sha256"), str):
        raise ValueError("apply requires an immutable exported manifest with manifest_sha256")
    supplied_hash = manifest["manifest_sha256"]
    content = {key: value for key, value in manifest.items() if key != "manifest_sha256"}
    if sha256_value(content) != supplied_hash or supplied_hash != confirmed_sha:
        raise ValueError("manifest content hash does not match reviewed --confirm-manifest-sha")
    baseline = get_baseline(conn_state)
    baseline_hash = sha256_value(baseline)
    if manifest.get("baseline_sha256") != baseline_hash:
        raise ValueError("manifest full baseline hash differs from initialized snapshot")
    manifest_baseline = validate_full_baseline(manifest.get("baseline"))
    if sha256_value(manifest_baseline) != baseline_hash:
        raise ValueError("manifest embedded full baseline differs from initialized snapshot")
    baseline_by_key = {row["company_key"]: row for row in baseline}
    approved_rows = conn_state.execute("SELECT * FROM proposals WHERE approved=1 ORDER BY candidate_id").fetchall()
    approved_by_id = {row["candidate_id"]: row for row in approved_rows}
    updates: dict[str, dict[str, Any]] = {}
    manifest_candidate_ids: set[str] = set()
    if not isinstance(manifest.get("updates"), list):
        raise ValueError("manifest updates must be an array")
    for update in manifest["updates"]:
        key = update.get("company_key")
        if key not in baseline_by_key:
            raise ValueError("manifest references unknown company_key")
        fields = update.get("fields") or {}
        expected = update.get("expected") or {}
        evidence = update.get("evidence") or {}
        review = update.get("review") or {}
        if not isinstance(fields, dict) or set(fields) != set(expected) or set(fields) != set(evidence) or set(fields) != set(review):
            raise ValueError("manifest field, expected, evidence and review sets must match exactly")
        for field, new_value in fields.items():
            if field not in FIELDS:
                raise ValueError("manifest contains field outside seven-field allowlist")
            old_value = expected[field]
            if baseline_by_key[key].get(field) != old_value:
                raise ValueError(f"manifest expected-value conflict for {key}.{field}")
            review_info = review[field]
            candidate_id = review_info.get("candidate_id")
            candidate_sha = review_info.get("candidate_sha256")
            row = approved_by_id.get(candidate_id)
            if not row or row["company_key"] != key or row["field"] != field or row["reviewer"] != review_info.get("reviewer"):
                raise ValueError("manifest candidate is not the same separately approved proposal")
            if row["validation_status"] != "valid_pending_review" or candidate_hash(row) != candidate_sha:
                raise ValueError("approved candidate changed since exported review manifest")
            if json.loads(row["expected_json"]) != old_value or json.loads(row["new_json"]) != new_value:
                raise ValueError("manifest proposal values differ from approved candidate")
            if json.loads(row["evidence_json"]) != evidence[field] or sha256_value(evidence[field]) != row["evidence_sha256"]:
                raise ValueError("manifest evidence differs from approved candidate evidence")
            manifest_candidate_ids.add(candidate_id)
            if field in updates.setdefault(key, {}):
                raise ValueError(f"duplicate manifest field {key}.{field}")
            updates[key][field] = new_value
    if manifest_candidate_ids != set(approved_by_id):
        raise ValueError("current approved candidate set differs from immutable manifest")
    return updates, baseline_hash


def apply_approved(conn_state: sqlite3.Connection, database_path: str | Path, backup_dir: str | Path,
                   *, apply: bool = False, confirmed_sha: str | None = None,
                   manifest: dict[str, Any] | None = None, confirmed_manifest_sha: str | None = None) -> dict[str, Any]:
    baseline = get_baseline(conn_state)
    baseline_hash = sha256_value(baseline)
    proposals = conn_state.execute("SELECT * FROM proposals WHERE approved=1 ORDER BY company_key,field").fetchall()
    if not proposals:
        return {"mode": "apply" if apply else "dry_run", "updates": 0, "baseline_sha256": baseline_hash}
    manifest_updates: dict[str, dict[str, Any]] | None = None
    if manifest is not None:
        manifest_updates, verified_baseline_hash = verify_exported_manifest(conn_state, manifest, confirmed_manifest_sha)
        if verified_baseline_hash != baseline_hash:
            raise ValueError("manifest baseline mismatch")
    if not apply:
        return {"mode": "dry_run", "updates": len(proposals), "baseline_sha256": baseline_hash,
                "manifest_sha256": manifest.get("manifest_sha256") if manifest else None,
                "candidates": [row["candidate_id"] for row in proposals]}
    if manifest_updates is None:
        raise ValueError("--apply requires the exact reviewed --manifest and --confirm-manifest-sha")
    if confirmed_sha != baseline_hash:
        raise ValueError("--apply requires --confirm-baseline-sha matching the full initialized snapshot")
    uri = f"file:{Path(database_path).resolve().as_posix()}?mode=rw"
    live = sqlite3.connect(uri, uri=True, timeout=30, isolation_level=None)
    live.row_factory = sqlite3.Row
    try:
        live.execute("PRAGMA busy_timeout=30000")
        live.execute("BEGIN IMMEDIATE")
        _, current = read_full_db(live)
        if current != baseline:
            raise ValueError("live full-row snapshot differs from initialized baseline; refusing CAS apply")
        before = current
        updates = manifest_updates
        baseline_by_key = {row["company_key"]: row for row in baseline}
        backup_dir_path = ensure_private_external_path(backup_dir)
        private_directory(backup_dir_path)
        backup_path = backup_dir_path / f"company-directory-before-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{baseline_hash[:12]}.json"
        private_write(backup_path, (json.dumps({"baseline_sha256": baseline_hash, "rows": before}, ensure_ascii=False, indent=2) + "\n").encode())
        now = utc_now()
        for key, fields in updates.items():
            setters = [f'"{field}"=?' for field in fields] + ['"updated_at"=?']
            values = list(fields.values()) + [now, key]
            where = ["company_key=?"] + [f'"{field}" IS ?' for field in fields]
            values += [baseline_by_key[key][field] for field in fields]
            cursor = live.execute(f"UPDATE company_directory SET {', '.join(setters)} WHERE {' AND '.join(where)}", values)
            if cursor.rowcount != 1:
                raise ValueError(f"CAS update failed for {key}")
        _, after = read_full_db(live)
        if len(after) != len(before) or [row["company_key"] for row in after] != [row["company_key"] for row in before]:
            raise ValueError("non-target row invariant failed")
        for old, new in zip(before, after):
            key = old["company_key"]
            allowed_for_row = set(updates.get(key, {})) | ({"updated_at"} if key in updates else set())
            for column in FULL_COLUMNS:
                if column not in allowed_for_row and old[column] != new[column]:
                    raise ValueError(f"non-target field changed: {key}.{column}")
            for field, value in updates.get(key, {}).items():
                if new[field] != value:
                    raise ValueError(f"postcondition failed for {key}.{field}")
        live.commit()
        audit_payload = {"baseline_sha256": baseline_hash, "manifest_sha256": manifest["manifest_sha256"],
                         "before_image": str(backup_path), "companies": len(updates),
                         "fields": sum(len(values) for values in updates.values())}
        conn_state.execute("INSERT INTO audit(audit_id,action,subject,payload_json,created_at) VALUES(?,?,?,?,?)",
                           (secrets.token_hex(16), "apply_committed", manifest["manifest_sha256"], canonical_json(audit_payload), utc_now()))
        return {"mode": "apply", "updates": audit_payload["fields"], "companies": len(updates),
                "baseline_sha256": baseline_hash, "manifest_sha256": manifest["manifest_sha256"], "before_image": str(backup_path)}
    except Exception:
        live.rollback()
        raise
    finally:
        live.close()


def command_apply(args: argparse.Namespace) -> int:
    manifest = read_json(args.manifest) if args.manifest else None
    with open_state(args.state) as conn:
        result = apply_approved(conn, args.db, args.backup_dir, apply=args.apply, confirmed_sha=args.confirm_baseline_sha,
                                manifest=manifest, confirmed_manifest_sha=args.confirm_manifest_sha)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def command_corporate_fetch(args: argparse.Namespace) -> int:
    print(json.dumps(run_corporate_jobs(args.state, limit=args.limit, concurrency=args.concurrency, kill_switch=args.kill_switch, min_host_interval=args.min_host_interval), ensure_ascii=False))
    return 0


def command_benchmark(args: argparse.Namespace) -> int:
    print(json.dumps(benchmark_synthetic(args.jobs), ensure_ascii=False))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="initialize private state from a complete 16-column baseline")
    init.add_argument("--state", required=True); init.add_argument("--baseline", required=True); init.set_defaults(func=command_init)
    enqueue = sub.add_parser("enqueue", help="idempotently enqueue stable-key tasks")
    enqueue.add_argument("--state", required=True); enqueue.add_argument("--tasks"); enqueue.add_argument("--from-baseline", action="store_true"); enqueue.set_defaults(func=command_enqueue)
    claim = sub.add_parser("claim", help="lease a bounded set of eligible non-LinkedIn jobs")
    claim.add_argument("--state", required=True); claim.add_argument("--limit", type=int, default=20); claim.add_argument("--lease-seconds", type=int, default=600); claim.set_defaults(func=command_claim)
    record = sub.add_parser("record", help="checkpoint one leased job outcome")
    record.add_argument("--state", required=True); record.add_argument("--job-id", required=True); record.add_argument("--lease-token", required=True)
    record.add_argument("--status", choices=sorted(TASK_STATUSES - {"pending", "leased", "awaiting_import"}), required=True)
    record.add_argument("--result", required=True, help="JSON outcome object"); record.set_defaults(func=command_record)
    imp = sub.add_parser("import-packet", help="import primary evidence proposals; imported proposals remain unapproved")
    imp.add_argument("--state", required=True); imp.add_argument("--packet", required=True); imp.add_argument("--evidence-root")
    imp.add_argument("--destination-checks", help="private JSON destination-check capture paired with careers source-line evidence")
    imp.set_defaults(func=command_import)
    approve = sub.add_parser("approve", help="record a separate review against an immutable candidate hash")
    approve.add_argument("--state", required=True); approve.add_argument("--candidate-id", required=True); approve.add_argument("--reviewer", required=True)
    approve.add_argument("--candidate-sha256", required=True); approve.set_defaults(func=command_approve)
    approve_batch = sub.add_parser("approve-batch", help="atomically apply separate reviewer approval manifest")
    approve_batch.add_argument("--state", required=True); approve_batch.add_argument("--manifest", required=True); approve_batch.add_argument("--reviewer", required=True)
    approve_batch.set_defaults(func=command_approve_batch)
    reconcile = sub.add_parser("reconcile", help="verify exact expected task IDs against terminal persisted outcomes")
    reconcile.add_argument("--state", required=True); reconcile.add_argument("--tasks", required=True); reconcile.set_defaults(func=command_reconcile)
    report = sub.add_parser("report", help="private per-company/per-field coverage report")
    report.add_argument("--state", required=True); report.add_argument("--out"); report.set_defaults(func=command_report)
    export = sub.add_parser("export-approved", help="write immutable approved full-baseline patch manifest")
    export.add_argument("--state", required=True); export.add_argument("--out", required=True); export.set_defaults(func=command_export)
    apply = sub.add_parser("apply", help="dry-run approved patch; writes only with explicit --apply and matching baseline hash")
    apply.add_argument("--state", required=True); apply.add_argument("--db", required=True); apply.add_argument("--backup-dir", required=True)
    apply.add_argument("--manifest"); apply.add_argument("--apply", action="store_true"); apply.add_argument("--confirm-baseline-sha"); apply.add_argument("--confirm-manifest-sha"); apply.set_defaults(func=command_apply)
    fetch = sub.add_parser("corporate-fetch", help="disabled pending reviewed jittered per-host pacing")
    fetch.add_argument("--state", required=True); fetch.add_argument("--limit", type=int, default=20); fetch.add_argument("--concurrency", type=int, default=4)
    fetch.add_argument("--kill-switch"); fetch.add_argument("--min-host-interval", type=float, default=2.0); fetch.set_defaults(func=command_corporate_fetch)
    bench = sub.add_parser("benchmark", help="synthetic offline queue/cache benchmark; creates no research evidence")
    bench.add_argument("--jobs", type=int, default=30000); bench.set_defaults(func=command_benchmark)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "enqueue" and not args.from_baseline and not args.tasks:
        parser.error("enqueue requires --tasks or --from-baseline")
    try:
        return args.func(args)
    except Exception as error:
        print(f"b614-enrichment: {type(error).__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
