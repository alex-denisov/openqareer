#!/usr/bin/env python3
"""HireHi companies -> directory rows with evidence (B620).

Per company:
  1. HireHi company page: official site (Organization JSON-LD), description and
     the titles of its open vacancies (ItemList).
  2. First HireHi vacancy page: country / city of the vacancy -> geo.
  3. No site from HireHi: search hh.ru vacancies by the company name and take
     the employer whose vacancy titles coincide with the HireHi titles (identity
     by matching vacancies, never by the name alone); its hh.ru employer page
     gives the site, industry and address.
  4. resolve.resolve() with that site as a trusted hint: careers, ATS, LinkedIn.

Only company attributes are read; no vacancies are stored. HireHi and hh.ru each
have their own paced lane; 429 pauses the lane. Output is appended JSONL,
rerunning skips finished companies.

Usage: enrich_hirehi.py IN.jsonl OUT.jsonl [--cache DIR] [--workers N]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import html as htmllib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import resolve as R  # noqa: E402

BOT_UA = "openqareer-company-directory/1.0 (+https://openqareer.com)"
HH_UA = R.UA
STATE_RE = re.compile(r'id="HH-Lux-InitialState"[^>]*>([\s\S]*?)</template>')


class Lane:
    """One request at a time per site, at most one per `interval`; 429 pauses."""

    def __init__(self, interval: float):
        self.interval = interval
        self.lock = threading.Lock()
        self.last = 0.0
        self.paused_until = 0.0

    def get(self, url: str, ua: str, limit: int) -> str:
        for attempt in range(6):
            with self.lock:
                now = time.time()
                wait = max(self.interval - (now - self.last), self.paused_until - now)
                if wait > 0:
                    time.sleep(wait)
                self.last = time.time()
            try:
                req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "ru,en;q=0.8"})
                with urllib.request.urlopen(req, timeout=R.TIMEOUT, context=R._ssl) as resp:
                    return resp.read(limit).decode("utf-8", errors="replace")
            except urllib.error.HTTPError as err:
                if err.code == 404:
                    return ""
                if err.code not in (429, 503):
                    raise
                with self.lock:
                    self.paused_until = time.time() + 30 * (attempt + 1)
        raise RuntimeError(f"rate limited: {url}")


HIREHI = Lane(0.4)
HH = Lane(0.6)


def cached(f: R.Fetcher, key: str, fn):
    path = f._path(key)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    value = fn()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False)
    os.replace(tmp, path)
    return value


def ld_blocks(page: str) -> list[dict]:
    out = []
    for raw in re.findall(r'<script[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>', page):
        try:
            out.append(json.loads(raw))
        except ValueError:
            continue
    return out


def hirehi_company(f: R.Fetcher, slug: str) -> dict:
    def load():
        page = HIREHI.get(f"https://hirehi.ru/companies/{slug}", BOT_UA, 150_000)
        org, titles, urls = {}, [], []
        for b in ld_blocks(page):
            if b.get("@type") == "Organization":
                org = b
            if b.get("@type") == "ItemList":
                for it in b.get("itemListElement", []):
                    titles.append(it.get("name") or "")
                    urls.append(it.get("url") or "")
        return {"site": org.get("url"), "desc": org.get("description"), "titles": titles[:40], "urls": urls[:3]}
    return cached(f, "hirehi-company3:" + slug, load)


def hirehi_vacancy_place(f: R.Fetcher, url: str) -> dict:
    def load():
        page = HIREHI.get(url, BOT_UA, 200_000)
        for b in ld_blocks(page):
            if b.get("@type") == "JobPosting":
                locs = b.get("jobLocation") or {}
                locs = locs if isinstance(locs, list) else [locs]
                addr = (locs[0].get("address") if locs else {}) or {}
                remote = b.get("jobLocationType") == "TELECOMMUTE"
                return {"country": addr.get("addressCountry"), "city": addr.get("addressLocality"), "remote": remote}
        return {}
    return cached(f, "hirehi-vacancy3:" + url, load)


def hh_state(url: str) -> dict:
    page = HH.get(url, HH_UA, 3_000_000)
    m = STATE_RE.search(page)
    if not m:
        raise RuntimeError(f"hh state unreadable: {url}")
    return json.loads(htmllib.unescape(m.group(1)))


def norm_title(t: str) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", " ", (t or "").lower()).strip()


def close(a: str, b: str) -> bool:
    """Same title, or the same words up to one extra/missing word (grade, team)."""
    if a == b:
        return True
    x, y = set(a.split()), set(b.split())
    return len(x) >= 2 and len(y) >= 2 and len(x & y) >= max(len(x), len(y)) - 1


def hh_employer_by_vacancies(f: R.Fetcher, name: str, titles: list[str]) -> dict | None:
    """Employer whose hh.ru vacancies share titles with the HireHi ones."""
    want = {norm_title(t) for t in titles if t}

    def load():
        q = urllib.parse.quote_plus(name)
        st = hh_state(f"https://hh.ru/search/vacancy?text={q}&area=113&items_on_page=100")
        found = {}
        for v in st.get("vacancySearchResult", {}).get("vacancies", []):
            c = v.get("company") or {}
            if c.get("id"):
                e = found.setdefault(str(c["id"]), {"name": c.get("name"), "titles": []})
                e["titles"].append(v.get("name") or "")
        return found
    found = cached(f, "hh-search3:" + name, load)
    best = None
    for emp_id, e in found.items():
        theirs = {norm_title(t) for t in e["titles"]}
        hits = sorted(w for w in want if any(close(w, t) for t in theirs))
        if hits and (best is None or len(hits) > len(best[2])):
            best = (emp_id, e["name"], hits)
    if not best:
        return None
    need = 1 if len(want) <= 2 else 2
    if len(best[2]) < need:
        return None
    emp_id, emp_name, hits = best

    def load_emp():
        st = hh_state(f"https://hh.ru/employer/{emp_id}")
        e = st.get("employerInfo") or {}
        site = (e.get("site") or {}).get("href") if isinstance(e.get("site"), dict) else None
        return {"site": site, "address": e.get("address"), "country": e.get("employerCountryCode"),
                "industries": [i.get("trl") for i in e.get("industries") or [] if i.get("trl")]}
    emp = cached(f, f"hh-employer3:{emp_id}", load_emp)
    return {"id": emp_id, "name": emp_name, "hits": hits[:3], **emp}


COUNTRY_RU = {"Russia": "Russia", "Россия": "Russia", "Belarus": "Belarus", "Беларусь": "Belarus",
              "Kazakhstan": "Kazakhstan", "Казахстан": "Kazakhstan", "Uzbekistan": "Uzbekistan",
              "Узбекистан": "Uzbekistan", "Armenia": "Armenia", "Армения": "Armenia",
              "Georgia": "Georgia", "Грузия": "Georgia", "Serbia": "Serbia", "Сербия": "Serbia",
              "Cyprus": "Cyprus", "Кипр": "Cyprus", "UAE": "UAE", "ОАЭ": "UAE"}
CC = {"RU": "Russia", "BY": "Belarus", "KZ": "Kazakhstan", "UZ": "Uzbekistan", "AM": "Armenia",
      "GE": "Georgia", "AZ": "Azerbaijan", "KG": "Kyrgyzstan"}


def enrich(f: R.Fetcher, row: dict) -> dict:
    slug = row["hints"]["hirehiSlug"]
    hc = hirehi_company(f, slug)
    hints = dict(row["hints"])
    extra_ev: dict = {}
    hh = None
    if hc.get("site") and "hirehi.ru" not in hc["site"]:
        hints.update(website=hc["site"], websiteSource="hirehi.ru")
    elif hc.get("titles"):
        try:
            hh = hh_employer_by_vacancies(f, row["companyName"], hc["titles"])
        except Exception as err:  # hh unreachable is a reason, not a crash
            extra_ev["hh"] = {"value": None, "how": f"hh.ru lookup failed: {str(err)[:120]}"}
        if hh:
            extra_ev["hh"] = {"value": hh["id"], "how": f"hh.ru employer «{hh['name']}»: same vacancies {hh['hits']}"}
            if hh.get("site"):
                hints.update(website=hh["site"], websiteSource=f"hh.ru employer {hh['id']} (vacancies match)")
        elif "hh" not in extra_ev:
            extra_ev["hh"] = {"value": None, "how": "no hh.ru employer with the same vacancy titles"}
    row = {**row, "hints": hints, "notes": hc.get("desc") if hc.get("desc") and "открытых ваканс" not in hc["desc"] else None}
    out = R.resolve(f, row)
    ev = {**out["evidence"], **extra_ev}
    if not out.get("websiteUrl"):
        why = "HireHi page has no site" + ("; " + extra_ev["hh"]["how"] if extra_ev.get("hh") else "; HireHi lists no vacancies")
        ev["websiteUrl"] = {"value": None, "how": f"not found: {why}"}
    # geo: country of the HireHi vacancy, else the hh.ru employer address
    place = hirehi_vacancy_place(f, hc["urls"][0]) if hc.get("urls") else {}
    country = COUNTRY_RU.get(place.get("country") or "", place.get("country"))
    if country:
        geo = country + ("; Remote" if place.get("remote") else "")
        out["geo"] = geo
        ev["geo"] = {"value": geo, "how": f"HireHi vacancy {hc['urls'][0]}: {place.get('country')}, {place.get('city')}"}
    elif hh and CC.get(hh.get("country") or ""):
        out["geo"] = CC[hh["country"]]
        ev["geo"] = {"value": out["geo"], "how": f"hh.ru employer {hh['id']} address {hh.get('address')}"}
    elif not out.get("geo"):
        ev["geo"] = {"value": None, "how": "not found: no vacancy location on HireHi"}
    if hh and hh.get("industries") and not ev.get("industry", {}).get("value"):
        out["industry"] = hh["industries"][0]
        ev["industry"] = {"value": out["industry"], "how": f"hh.ru employer {hh['id']} industry"}
    out["evidence"] = ev
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/oq-company-directory"))
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()
    rows = [json.loads(l) for l in open(args.inp, encoding="utf-8") if l.strip()]
    done = set()
    if os.path.exists(args.out):
        done = {json.loads(l)["companyKey"] for l in open(args.out, encoding="utf-8") if l.strip()}
    todo = [r for r in rows if r["companyKey"] not in done]
    print(f"{len(rows)} rows, {len(done)} done, {len(todo)} to go", file=sys.stderr, flush=True)
    f = R.Fetcher(args.cache)
    n = 0
    lock = threading.Lock()
    with open(args.out, "a", encoding="utf-8") as out, cf.ThreadPoolExecutor(args.workers) as pool:
        futs = {pool.submit(enrich, f, r): r for r in todo}
        for fut in cf.as_completed(futs):
            r = futs[fut]
            try:
                res = fut.result()
            except Exception as err:  # retried on the next run
                print(f"ERR {r['companyKey']}: {err!r}", file=sys.stderr, flush=True)
                continue
            with lock:
                out.write(json.dumps(res, ensure_ascii=False) + "\n")
                out.flush()
                n += 1
                if n % 100 == 0:
                    print(f"{n}/{len(todo)}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
