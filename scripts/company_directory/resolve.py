#!/usr/bin/env python3
"""Resolve company directory rows with evidence (B619/B620).

Input: JSONL of candidate rows (camelCase directory fields plus `hints`:
{"website": url-from-source, "careers": url-from-source, "source": name}).
Output: JSONL of resolved rows, appended; rows already in the output are
skipped, so the run is resumable. Every field decision is recorded in
`evidence` ({field: {"value", "how"}}) and a missing value carries a reason.

Identity rule: a website is trusted when the source gave it, or when the page
names the company; ATS boards, LinkedIn pages and careers pages are trusted
only when linked from the official domain (or, for Greenhouse, when the
board's job links point to that domain). A name match alone never confirms.

Usage: resolve.py IN.jsonl OUT.jsonl [--cache DIR] [--workers N]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import html as htmllib
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
MAX_BYTES = 400_000
MAX_JSON_BYTES = 30_000_000
TIMEOUT = 15

AGGREGATOR_HOSTS = {
    "jobs.dou.ua", "dou.ua", "linkedin.com", "builtin.com", "hh.ru", "hh.kz",
    "glassdoor.com", "indeed.com", "wellfound.com", "angel.co", "crunchbase.com",
    "hirehi.ru", "idagent.pro", "habr.com", "career.habr.com", "getmatch.ru",
    "djinni.co", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "t.me", "vk.com", "youtube.com", "github.com", "medium.com", "google.com",
    "apple.com/app", "play.google.com", "apps.apple.com", "wikipedia.org",
    "superjob.ru", "rabota.ru", "zarplata.ru", "trudvsem.ru", "remotive.com",
    "weworkremotely.com", "himalayas.app", "otta.com", "welcometothejungle.com",
}
PARKING_HOSTS = {
    "hugedomains.com", "sedo.com", "dan.com", "afternic.com", "godaddy.com",
    "expireddomains.com", "expireddomains.net", "parkingcrew.net", "bodis.com",
    "undeveloped.com", "sav.com", "namecheap.com", "reg.ru", "atom.com",
}
ATS_HOSTS = (
    "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
    "recruitee.com", "bamboohr.com", "personio.de", "personio.com", "breezy.hr",
    "teamtailor.com", "comeet.com", "comeet.co", "pinpointhq.com", "huntflow.io",
    "myworkdayjobs.com", "jobvite.com", "icims.com", "rippling.com", "dover.com",
    # vendor marketing sites that agents used as fake board URLs (greenhouse.com/<slug>)
    "greenhouse.com", "ashby.com", "lever.com", "bamboohr.com", "recruitee.com",
)
TWO_LEVEL_TLDS = {"co.uk", "com.au", "co.il", "com.br", "co.jp", "com.cy", "com.ua",
                  "co.kr", "com.tr", "com.mx", "co.in", "org.uk", "com.sg", "msk.ru",
                  "spb.ru", "com.ru", "co.za", "com.cn", "com.hk"}
CAREER_WORDS = re.compile(
    r"(?:^|[/_.-])(careers?|jobs?|vacanc\w*|join-us|joinus|join-our-team|hiring|"
    r"work-with-us|work-at|vakansii|karera|rabota|вакансии|карьера)(?:$|[/_.?-])", re.I)

ATS_PATTERNS = [
    ("greenhouse", re.compile(r"(?:job-)?boards(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_-]+)")),
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v1/boards/([A-Za-z0-9_-]+)")),
    ("lever", re.compile(r"jobs\.(?:eu\.)?lever\.co/([A-Za-z0-9._-]+)")),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9._%-]+)")),
    ("workable", re.compile(r"apply\.workable\.com/([A-Za-z0-9_-]+)")),
    ("smartrecruiters", re.compile(r"(?:jobs|careers)\.smartrecruiters\.com/([A-Za-z0-9_-]+)")),
    ("recruitee", re.compile(r"//([A-Za-z0-9_-]+)\.recruitee\.com")),
    ("bamboohr", re.compile(r"//([A-Za-z0-9_-]+)\.bamboohr\.com")),
    ("personio", re.compile(r"//([A-Za-z0-9_-]+)\.jobs\.personio\.(?:de|com)")),
    ("breezy", re.compile(r"//([A-Za-z0-9_-]+)\.breezy\.hr")),
    ("teamtailor", re.compile(r"//([A-Za-z0-9_-]+)\.teamtailor\.com")),
    ("comeet", re.compile(r"comeet\.com/jobs/([A-Za-z0-9_-]+/[A-Za-z0-9.]+)")),
    ("pinpoint", re.compile(r"//([A-Za-z0-9_-]+)\.pinpointhq\.com")),
]
ATS_SKIP_SLUGS = {"embed", "api", "v1", "www", "jobs", "careers", "app", "static", "assets", "js"}
LINKEDIN_RE = re.compile(r"linkedin\.com/company/([A-Za-z0-9_%.\-]+)", re.I)
HREF_RE = re.compile(r"""href\s*=\s*["']([^"'#<>\s]+)""", re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)

_ssl = ssl.create_default_context()


class Fetcher:
    """HTTP GET with an on-disk cache keyed by URL (resumable runs)."""

    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self._host_locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _path(self, url: str) -> str:
        h = hashlib.sha1(url.encode()).hexdigest()
        return os.path.join(self.cache_dir, h[:2], h + ".json")

    def get(self, url: str, accept_json: bool = False) -> dict:
        # API answers are read whole (boards can be MBs); keyed apart from old truncated entries
        path = self._path(("json-full:" if accept_json else "") + url)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    return json.load(fh)
            except (OSError, ValueError):
                pass
        result = self._fetch(url, accept_json)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{threading.get_ident()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False)
        os.replace(tmp, path)
        return result

    def _fetch(self, url: str, accept_json: bool) -> dict:
        headers = {"User-Agent": UA, "Accept-Language": "en,ru;q=0.8",
                   "Accept": "application/json" if accept_json else "text/html,*/*"}
        for ctx in (_ssl,):
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
                    body = resp.read(MAX_JSON_BYTES if accept_json else MAX_BYTES)
                    charset = resp.headers.get_content_charset() or "utf-8"
                    return {"status": resp.status, "url": resp.geturl(),
                            "text": body.decode(charset, errors="replace")}
            except urllib.error.HTTPError as err:
                return {"status": err.code, "url": url, "text": ""}
            except ssl.SSLError:
                continue
            except Exception as err:  # network errors are data here, recorded per URL
                if "CERTIFICATE" in str(err).upper() and ctx is _ssl:
                    continue
                return {"status": 0, "url": url, "text": "", "error": str(err)[:200]}
        return {"status": 0, "url": url, "text": "", "error": "ssl"}


# ---------- URL helpers ----------

def host_of(url: str | None) -> str:
    if not url:
        return ""
    try:
        h = urllib.parse.urlparse(url if "//" in url else "https://" + url).hostname or ""
    except ValueError:
        return ""
    return h.lower().removeprefix("www.")


def reg_domain(host: str) -> str:
    parts = host.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in TWO_LEVEL_TLDS:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def in_set(host: str, hosts: set[str]) -> bool:
    return any(host == h or host.endswith("." + h) for h in hosts)


def is_ats_host(host: str) -> bool:
    return any(host == h or host.endswith("." + h) for h in ATS_HOSTS)


def bad_website(url: str | None) -> str | None:
    h = host_of(url)
    if not h:
        return "empty"
    if in_set(h, AGGREGATOR_HOSTS):
        return f"aggregator host {h}"
    if in_set(h, PARKING_HOSTS):
        return f"parked domain {h}"
    if is_ats_host(h):
        return f"ATS host {h}"
    return None


def norm_tokens(name: str) -> list[str]:
    s = re.sub(r"\(.*?\)", " ", name.lower())
    s = re.sub(r"[^0-9a-zа-яё]+", " ", s)
    stop = {"inc", "llc", "ltd", "group", "the", "company", "co", "gmbh", "ооо", "ао",
            "пао", "group", "technologies", "technology", "tech", "labs", "lab", "ai",
            "studio", "studios", "games", "software", "io", "app", "corp", "holding"}
    toks = [t for t in s.split() if t not in stop and len(t) >= 2]
    return toks or [t for t in s.split() if t]


def name_on_page(name: str, page: dict, host: str) -> bool:
    toks = norm_tokens(name)
    if not toks:
        return False
    text = (page.get("text") or "")[:200_000].lower()
    title = " ".join(TITLE_RE.findall(page.get("text") or "")).lower()
    label = reg_domain(host).split(".")[0].replace("-", "")
    joined = "".join(toks)
    if joined and (joined in label or label in joined) and len(label) >= 3:
        return toks[0] in text or joined in text.replace(" ", "")
    return toks[0] in title or (len(toks[0]) >= 4 and text.count(toks[0]) >= 3)


def page_links(page: dict) -> list[str]:
    base = page.get("url") or ""
    out = []
    for raw in HREF_RE.findall(page.get("text") or ""):
        href = htmllib.unescape(raw)
        if href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        out.append(urllib.parse.urljoin(base, href))
    # inline URLs (SPA bundles, JSON) count too
    out += re.findall(r"https?://[A-Za-z0-9.\-]+\.[a-z]{2,}/[^\s\"'<>\\)]*", page.get("text") or "")
    return out


def ats_from_url(url: str) -> tuple[str, str] | None:
    for provider, rx in ATS_PATTERNS:
        m = rx.search(url)
        if m:
            slug = urllib.parse.unquote(m.group(1)).strip("/").split("?")[0]
            if slug.lower() not in ATS_SKIP_SLUGS:
                return provider, slug
    return None


def linkedin_slug(url: str | None) -> str | None:
    if not url:
        return None
    m = LINKEDIN_RE.search(url)
    if not m:
        return None
    slug = urllib.parse.unquote(m.group(1)).strip(".").lower()
    return None if slug in {"jobs", "company", "linkedin"} else slug


def linkedin_jobs_url(slug: str) -> str:
    return f"https://www.linkedin.com/company/{slug}/jobs/"


# ---------- ATS ----------

def board_url(provider: str, slug: str) -> str:
    return {
        "greenhouse": f"https://job-boards.greenhouse.io/{slug}",
        "lever": f"https://jobs.lever.co/{slug}",
        "ashby": f"https://jobs.ashbyhq.com/{slug}",
        "workable": f"https://apply.workable.com/{slug}/",
        "smartrecruiters": f"https://jobs.smartrecruiters.com/{slug}",
        "recruitee": f"https://{slug}.recruitee.com/",
        "bamboohr": f"https://{slug}.bamboohr.com/careers",
        "personio": f"https://{slug}.jobs.personio.de/",
        "breezy": f"https://{slug}.breezy.hr/",
        "teamtailor": f"https://{slug}.teamtailor.com/jobs",
        "comeet": f"https://www.comeet.com/jobs/{slug}",
        "pinpoint": f"https://{slug}.pinpointhq.com/",
    }[provider]


def check_ats(f: Fetcher, provider: str, slug: str) -> dict:
    """Return {"ok", "jobs", "name", "domains"} from the board's public API."""
    api = {
        "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
        "lever": f"https://api.lever.co/v0/postings/{slug}?mode=json",
        "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{slug}",
        "workable": f"https://apply.workable.com/api/v1/widget/accounts/{slug}",
        "smartrecruiters": f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=5",
        "recruitee": f"https://{slug}.recruitee.com/api/offers/",
        "bamboohr": f"https://{slug}.bamboohr.com/careers/list",
    }.get(provider)
    if not api:
        page = f.get(board_url(provider, slug))
        return {"ok": page["status"] == 200 and slug.lower() in (page.get("url") or "").lower(),
                "jobs": None, "name": None, "domains": []}
    resp = f.get(api, accept_json=True)
    if resp["status"] != 200:
        return {"ok": False, "jobs": 0, "name": None, "domains": [], "status": resp["status"]}
    try:
        data = json.loads(resp["text"])
    except ValueError:
        return {"ok": False, "jobs": 0, "name": None, "domains": [], "status": "not json"}
    jobs, name, urls = [], None, []
    if provider == "greenhouse":
        jobs = data.get("jobs", [])
        urls = [j.get("absolute_url", "") for j in jobs]
        name = (jobs[0].get("company_name") if jobs else None)
    elif provider == "lever":
        jobs = data if isinstance(data, list) else []
    elif provider == "ashby":
        jobs = data.get("jobs", [])
    elif provider == "workable":
        jobs, name = data.get("jobs", []), data.get("name")
        urls = [data.get("url") or ""]
    elif provider == "smartrecruiters":
        jobs = data.get("content", [])
        name = jobs[0].get("company", {}).get("name") if jobs else None
    elif provider == "recruitee":
        jobs = data.get("offers", [])
        urls = [j.get("careers_url", "") for j in jobs[:5]]
        name = jobs[0].get("company_name") if jobs else None
    elif provider == "bamboohr":
        jobs = data.get("result", [])
    domains = sorted({reg_domain(host_of(u)) for u in urls if u and not is_ats_host(host_of(u))})
    return {"ok": True, "jobs": len(jobs), "name": name, "domains": domains}


# ---------- LinkedIn org id (guest jobs search, no accounts) ----------

_li_lock = threading.Lock()
_li_last = [0.0]


def check_org_id(f: Fetcher, org_id: str) -> dict:
    url = ("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
           f"?f_C={org_id}&start=0")
    cached = os.path.exists(f._path(url))
    if not cached:
        with _li_lock:
            wait = 2.5 - (time.time() - _li_last[0])
            if wait > 0:
                time.sleep(wait)
            _li_last[0] = time.time()
    resp = f.get(url)
    slugs = [s.lower() for s in re.findall(r"linkedin\.com/company/([A-Za-z0-9_%.\-]+)", resp.get("text") or "")]
    counts: dict[str, int] = {}
    for s in slugs:
        counts[s] = counts.get(s, 0) + 1
    top = max(counts, key=counts.get) if counts else None
    return {"status": resp["status"], "slug": top, "cards": len(slugs)}


# ---------- resolution ----------

BLOCKED = {202, 403, 429, 503, 999}


def try_website(f: Fetcher, url: str, name: str, trusted: bool) -> tuple[dict | None, str, bool]:
    """Return (page, why, disproved). `disproved` means the URL is known wrong."""
    why = bad_website(url)
    if why:
        return None, why, True
    page = f.get(url if "//" in url else "https://" + url)
    err = page.get("error", "")
    if page["status"] != 200:
        dead = page["status"] in (404, 410) or "nodename nor servname" in err or "Name or service" in err
        return None, f"HTTP {page['status']} {err}".strip(), dead
    why = bad_website(page["url"])
    if why:
        return None, f"redirects to {why}", True
    final = host_of(page["url"])
    if not trusted and not name_on_page(name, page, final):
        thin = len(re.sub(r"<[^>]+>", " ", page.get("text") or "")) < 4000
        return None, f"page on {final} does not name the company" + (" (thin/JS page)" if thin else ""), not thin
    return page, "ok", False


def hirehi_org(f: Fetcher, slug: str) -> dict:
    """Official site and description from the HireHi company page JSON-LD."""
    url = f"https://hirehi.ru/companies/{slug}"
    path = f._path("hirehi-org2:" + url)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    org = {"site": None, "desc": None}
    try:
        head = _hirehi_get(url)
        m = re.search(r'"@type":\s*"Organization"(.{0,3000}?)</script>', head, re.S)
        if m:
            body = m.group(1)
            u = re.search(r'"url":\s*"([^"]+)"', body)
            d = re.search(r'"description":\s*"((?:[^"\\]|\\.)*)"', body)
            org = {"site": u.group(1) if u else None, "desc": d.group(1) if d else None}
    except Exception as err:  # not cached: the next run retries this slug
        return {"site": None, "desc": None, "error": str(err)[:200]}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(org, fh, ensure_ascii=False)
    return org


_hh_lock = threading.Lock()
_hh_last = [0.0]
HIREHI_UA = "openqareer-company-directory/1.0 (+https://openqareer.com)"
HIREHI_INTERVAL = 0.35  # HireHi answers 429 above ~3 requests/s


def _hirehi_get(url: str) -> str:
    for attempt in range(6):
        with _hh_lock:
            wait = HIREHI_INTERVAL - (time.time() - _hh_last[0])
            if wait > 0:
                time.sleep(wait)
            _hh_last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": HIREHI_UA, "Range": "bytes=0-60000"})
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=_ssl) as resp:
                return resp.read(60_000).decode("utf-8", errors="replace")
        except urllib.error.HTTPError as err:
            if err.code != 429:
                raise
            time.sleep(20 * (attempt + 1))
    raise RuntimeError("HireHi kept answering 429")


def hirehi_website(f: Fetcher, slug: str) -> str | None:
    return hirehi_org(f, slug).get("site")


TLD_GEO = {"ru": "Russia", "xn--p1ai": "Russia", "by": "Belarus", "kz": "Kazakhstan", "uz": "Uzbekistan",
           "am": "Armenia", "ge": "Georgia", "kg": "Kyrgyzstan", "az": "Azerbaijan", "rs": "Serbia",
           "cy": "Cyprus", "ae": "UAE", "tj": "Tajikistan", "md": "Moldova", "ua": "Ukraine"}


def fill_profile(f: Fetcher, row: dict, out: dict, ev: dict) -> None:
    """geo / industry / domain group for rows that came without them (HireHi)."""
    from classify import classify  # local module next to this script

    slug = (row.get("hints") or {}).get("hirehiSlug")
    org = hirehi_org(f, slug) if slug else {}
    if org.get("desc") and not out.get("notes"):
        out["notes"] = org["desc"]
    if not out.get("industry") or not out.get("domainGroup"):
        desc = org.get("desc") or ""
        c = classify(desc) if desc and "открытых ваканс" not in desc else None
        if c:
            out["domainGroup"], out["industry"] = out.get("domainGroup") or c[0], out.get("industry") or c[1]
            how = f"keywords in HireHi description: {', '.join(c[2])}"
            ev["domainGroup"] = {"value": out["domainGroup"], "how": how}
            ev["industry"] = {"value": out["industry"], "how": how}
    if not out.get("geo") and out.get("websiteUrl"):
        tld = host_of(out["websiteUrl"]).rsplit(".", 1)[-1]
        if tld in TLD_GEO:
            out["geo"] = TLD_GEO[tld]
            ev["geo"] = {"value": out["geo"], "how": f"national domain .{tld} of the official site"}


def dou_site(f: Fetcher, url: str) -> str | None:
    m = re.search(r"jobs\.dou\.ua/companies/([A-Za-z0-9_-]+)", url or "")
    if not m:
        return None
    page = f.get(f"https://jobs.dou.ua/companies/{m.group(1)}/")
    sm = re.search(r'<div class="site">\s*<a href="([^"]+)"', page.get("text") or "")
    return sm.group(1) if sm else None


def collect_from_pages(pages: list[dict], official: str) -> dict:
    ats, li, careers = [], [], []
    for page in pages:
        for link in page_links(page):
            h = host_of(link)
            a = ats_from_url(link)
            if a:
                ats.append(a)
            s = linkedin_slug(link) if "linkedin.com" in h else None
            if s:
                li.append(s)
            path = urllib.parse.urlparse(link).path
            if re.search(r"\.(js|css|png|jpe?g|svg|gif|webp|json|xml|pdf|ico|woff2?)$", path, re.I):
                continue
            if reg_domain(h) == official and CAREER_WORDS.search(path):
                careers.append(link.split("#")[0])
    return {"ats": ats, "li": li, "careers": careers}


def most_common(items):
    counts: dict = {}
    for i in items:
        counts[i] = counts.get(i, 0) + 1
    return max(counts, key=counts.get) if counts else None


def resolve(f: Fetcher, row: dict) -> dict:
    name = row["companyName"]
    hints = row.get("hints") or {}
    ev: dict = {}
    out = {k: v for k, v in row.items() if k != "hints"}

    # 1. official website: source hint > existing > DOU card > careers-host
    page, website = None, None
    tried = []
    cands = []
    if hints.get("hirehiSlug") and not hints.get("website"):
        site = hirehi_website(f, hints["hirehiSlug"])
        if site and "hirehi.ru" not in site:
            hints = {**hints, "website": site, "source": hints.get("source") or "hirehi.ru"}
            if hints["source"] != "hirehi.ru":
                hints["websiteSource"] = "hirehi.ru"
    if hints.get("website"):
        cands.append((hints["website"], True, f"source {hints.get('websiteSource') or hints.get('source')}"))
    if row.get("websiteUrl"):
        cands.append((row["websiteUrl"], False, "existing row, checked by page"))
    for u in (row.get("websiteUrl"), row.get("careersUrl")):
        site = dou_site(f, u or "")
        if site:
            cands.append((site, True, "DOU company card"))
    if hints.get("careers") and not bad_website(hints["careers"]):
        c = hints["careers"]
        cands.append((f"https://{host_of(c)}/", False, f"host of source careers ({hints.get('source')})"))
    if row.get("careersUrl") and not bad_website(row["careersUrl"]):
        cands.append((f"https://{host_of(row['careersUrl'])}/", False, "host of existing careers"))
    keep_unconfirmed = None
    for url, trusted, how in cands:
        page, why, disproved = try_website(f, url, name, trusted)
        tried.append(f"{url}: {why}")
        if not page and not disproved and keep_unconfirmed is None:
            keep_unconfirmed = (url, why, how)
        if page:
            h = host_of(page["url"])
            website = f"https://{h if h.count('.') > 1 or not page['url'] else 'www.' + h}/"
            website = f"https://{urllib.parse.urlparse(page['url']).hostname}/"
            sub = host_of(website).split(".")[0]
            if re.match(r"^(careers?|jobs?|join|work|hiring|people|team)$", sub):
                website = f"https://{reg_domain(host_of(website))}/"
            ev["websiteUrl"] = {"value": website, "how": how}
            break
    if not website and keep_unconfirmed:
        url, why, how = keep_unconfirmed
        website = f"https://{urllib.parse.urlparse(url if '//' in url else 'https://' + url).hostname}/"
        ev["websiteUrl"] = {"value": website, "how": f"{how}; unconfirmed: {why}", "confirmed": False}
    elif not website:
        ev["websiteUrl"] = {"value": None, "how": "not found: " + "; ".join(tried)[:400]}
    out["websiteUrl"] = website
    official = reg_domain(host_of(website)) if website else None

    # 2. crawl the official site: homepage + careers pages
    pages = [page] if page else []
    found = {"ats": [], "li": [], "careers": []}
    if official:
        found = collect_from_pages(pages, official)
        extra = []
        for u in (hints.get("careers"), row.get("careersUrl")):
            if u and reg_domain(host_of(u)) == official:
                extra.append(u)
        extra += found["careers"][:3]
        extra += [f"https://{host_of(website)}/{p}" for p in ("careers", "jobs")]
        seen = set()
        careers_ok = []
        for u in extra:
            if u in seen or len(seen) >= 6:
                continue
            seen.add(u)
            p = f.get(u)
            if p["status"] == 200 and not re.search(r"/(404|not-found)\b", p.get("url") or ""):
                fh = host_of(p["url"])
                if reg_domain(fh) == official or is_ats_host(fh):
                    careers_ok.append(p["url"])
                    pages.append(p)
                    if is_ats_host(fh):
                        a = ats_from_url(p["url"])
                        if a:
                            found["ats"].append(a)
        more = collect_from_pages(pages[1:], official)
        found["ats"] += more["ats"]
        found["li"] += more["li"]
        found["careers_ok"] = careers_ok

    # 3. ATS: linked from the official site, or existing board whose jobs point to the domain
    ats = None
    hint_ats = ats_from_url(hints.get("careers") or "")
    if hint_ats:
        chk = check_ats(f, *hint_ats)
        if chk["ok"]:
            ats = hint_ats
            ev["ats"] = {"value": f"{hint_ats[0]}:{hint_ats[1]}", "how": f"source {hints.get('source')} careers link; API ok, {chk['jobs']} jobs"}
    site_ats = None if ats else most_common(found["ats"])
    if site_ats:
        chk = check_ats(f, *site_ats)
        if chk["ok"]:
            ats = site_ats
            ev["ats"] = {"value": f"{site_ats[0]}:{site_ats[1]}", "how": f"linked from {official}; API ok, {chk['jobs']} jobs"}
    if not ats and row.get("atsProvider") and row.get("atsSlug"):
        cand = (row["atsProvider"], row["atsSlug"])
        chk = check_ats(f, *cand)
        if chk["ok"] and official and official in chk["domains"]:
            ats = cand
            ev["ats"] = {"value": f"{cand[0]}:{cand[1]}", "how": f"board job links point to {official}"}
        elif not chk["ok"]:
            ev["ats"] = {"value": None, "how": f"dropped {cand[0]}:{cand[1]}: board API HTTP {chk.get('status')}"}
        elif chk["domains"] and official and official not in chk["domains"]:
            ev["ats"] = {"value": None, "how": f"dropped {cand[0]}:{cand[1]}: board jobs point to {chk['domains']}, not {official}"}
        elif site_ats and site_ats != cand:
            ev["ats"] = {"value": None, "how": f"dropped {cand[0]}:{cand[1]}: site links {site_ats[0]}:{site_ats[1]}"}
        else:
            ats = cand
            ev["ats"] = {"value": f"{cand[0]}:{cand[1]}", "confirmed": False,
                         "how": f"unconfirmed: board API ok ({chk['jobs']} jobs, name={chk['name']}), not linked from the site"}
    if not ats and "ats" not in ev:
        ev["ats"] = {"value": None, "how": "no ATS board linked from the official site"}
    out["atsProvider"], out["atsSlug"] = (ats if ats else (None, None))

    # 4. careers
    careers, how = None, None
    if ats:
        careers, how = board_url(*ats), "ATS board"
    elif found.get("careers_ok"):
        careers, how = found["careers_ok"][0], f"careers page on {official}"
    elif hints.get("careers") and not in_set(host_of(hints["careers"]), PARKING_HOSTS):
        p = f.get(hints["careers"])
        if p["status"] in (200, 999, 403) or "linkedin.com" in hints["careers"]:
            careers, how = hints["careers"], f"source {hints.get('source')}"
    old_c = row.get("careersUrl")
    if not careers and old_c and official and reg_domain(host_of(old_c)) == official:
        p = f.get(old_c)
        if p["status"] not in (404, 410, 0):
            careers, how = old_c, f"existing row on {official}, HTTP {p['status']}"
    if not careers and old_c and not official and not bad_website(old_c):
        p = f.get(old_c)
        if p["status"] in BLOCKED:
            careers, how = old_c, f"existing row, unconfirmed: HTTP {p['status']}"
    out["careersUrl"] = careers
    ev["careersUrl"] = {"value": careers, "how": how or "not found: no careers page on the official domain"}

    # 5. LinkedIn
    site_li = most_common(found["li"])
    old_li = linkedin_slug(row.get("linkedinUrl"))
    m = re.match(r"^([a-z0-9])-(.+)$", old_li or "")
    if m and (row.get("notes") or "").startswith("Imported from ID Agent") and \
            norm_tokens(name) and norm_tokens(name)[0].startswith(m.group(1)) and \
            not norm_tokens(name)[0].startswith(m.group(1) + m.group(1)):
        old_li = m.group(2)  # idagent letter-index prefix ("A AgileEngine" -> a-agileengine)
    hint_li = linkedin_slug(hints.get("careers"))
    if site_li:
        li, how = site_li, f"linked from {official}"
    elif hint_li:
        li, how = hint_li, f"source {hints.get('source')}"
    elif old_li:
        li, how = old_li, "existing row; not linked from the official site (unconfirmed)"
    else:
        li, how = None, "not found"
    out["linkedinUrl"] = linkedin_jobs_url(li) if li else None
    ev["linkedinUrl"] = {"value": out["linkedinUrl"], "how": how}

    # 6. org id: confirm the existing one against the guest jobs feed
    org = row.get("linkedinOrgId")
    if org:
        chk = check_org_id(f, org)
        if chk["slug"] and li and chk["slug"] == li:
            ev["linkedinOrgId"] = {"value": org, "how": f"guest feed f_C={org} lists {li}"}
        elif chk["slug"] and li and chk["slug"] != li:
            # the jobs feed names the page that owns this id; its vanity slug wins
            ev["linkedinOrgId"] = {"value": org, "how": f"guest feed f_C={org} lists {chk['slug']}"}
            out["linkedinUrl"] = linkedin_jobs_url(chk["slug"])
            ev["linkedinUrl"] = {"value": out["linkedinUrl"],
                                 "how": f"vanity of org {org} from the guest jobs feed (was {li}: {ev['linkedinUrl']['how']})"}
        elif chk["slug"] and not li:
            ev["linkedinOrgId"] = {"value": org, "how": f"guest feed f_C={org} lists {chk['slug']}"}
            out["linkedinUrl"] = linkedin_jobs_url(chk["slug"])
            ev["linkedinUrl"] = {"value": out["linkedinUrl"], "how": f"vanity of org {org} from the guest jobs feed"}
        else:
            ev["linkedinOrgId"] = {"value": org, "how": f"kept: guest feed HTTP {chk['status']}, no open jobs to confirm"}
    else:
        ev["linkedinOrgId"] = {"value": None, "how": "not resolved yet (B621 resolver)"}

    if not out.get("careersUrl") and out.get("linkedinUrl"):
        out["careersUrl"] = out["linkedinUrl"]
        ev["careersUrl"] = {"value": out["careersUrl"], "how": "fallback to LinkedIn jobs page: " + ev["careersUrl"]["how"]}
    careers = out.get("careersUrl")
    out["sourceType"] = "ats_direct" if ats else ("corporate_portal" if careers and "linkedin.com" not in careers else "linkedin_guest")
    fill_profile(f, row, out, ev)
    for k in ("geo", "industry", "domainGroup"):
        if not out.get(k) and k not in ev:
            ev[k] = {"value": None, "how": "not found: source gives no value and no rule matched"}
    out["evidence"] = ev
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/oq-company-directory"))
    ap.add_argument("--workers", type=int, default=24)
    args = ap.parse_args()
    rows = [json.loads(l) for l in open(args.inp, encoding="utf-8") if l.strip()]
    done = set()
    if os.path.exists(args.out):
        done = {json.loads(l)["companyKey"] for l in open(args.out, encoding="utf-8") if l.strip()}
    todo = [r for r in rows if r["companyKey"] not in done]
    print(f"{len(rows)} rows, {len(done)} done, {len(todo)} to go", file=sys.stderr, flush=True)
    f = Fetcher(args.cache)
    lock = threading.Lock()
    n = 0
    with open(args.out, "a", encoding="utf-8") as out, cf.ThreadPoolExecutor(args.workers) as pool:
        futs = {pool.submit(resolve, f, r): r for r in todo}
        for fut in cf.as_completed(futs):
            r = futs[fut]
            try:
                res = fut.result()
            except Exception as err:  # keep the batch going; the row is retried next run
                print(f"ERR {r['companyKey']}: {err!r}", file=sys.stderr, flush=True)
                continue
            with lock:
                out.write(json.dumps(res, ensure_ascii=False) + "\n")
                out.flush()
                n += 1
                if n % 50 == 0:
                    print(f"{n}/{len(todo)}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
