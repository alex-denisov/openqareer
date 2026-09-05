#!/usr/bin/env python3
"""B202 — поиск ATS-доски компании по её домену/имени. Одна попытка на провайдера."""
import json, re, sys, time, urllib.request, urllib.error

AGENT = "openqareer-source-probe/1.0 (+https://openqareer.com; ATS board discovery, one request per address)"

PROVIDERS = [
    ("greenhouse", "https://boards-api.greenhouse.io/v1/boards/{s}/jobs", lambda d: len(d.get("jobs") or [])),
    ("lever", "https://api.lever.co/v0/postings/{s}?mode=json", lambda d: len(d) if isinstance(d, list) else 0),
    ("ashby", "https://api.ashbyhq.com/posting-api/job-board/{s}", lambda d: len(d.get("jobs") or [])),
    ("workable", "https://apply.workable.com/api/v1/widget/accounts/{s}?details=true", lambda d: len(d.get("jobs") or [])),
    ("recruitee", "https://{s}.recruitee.com/api/offers/", lambda d: len(d.get("offers") or [])),
]

def slugs(company, careers_url):
    out = []
    if careers_url:
        m = re.search(r"([a-z0-9-]+)\.[a-z.]{2,}(?:/|$)", careers_url.lower().replace("https://", "").replace("http://", "").replace("www.", ""))
        if m and m.group(1) not in {"ycombinator", "linkedin", "notion", "google", "docs", "jobs", "careers", "boards", "apply"}:
            out.append(m.group(1))
    name = re.sub(r"[^a-z0-9]+", "", company.lower())
    if name and name not in out:
        out.append(name)
    return out[:2]

def probe(url, reader):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            body = res.read()
            try:
                return res.status, reader(json.loads(body)), len(body)
            except Exception:
                return res.status, None, len(body)
    except urllib.error.HTTPError as e:
        return e.code, None, 0
    except Exception as e:
        return type(e).__name__, None, 0

def main(companies_path, out_path):
    companies = json.load(open(companies_path))
    found = []
    for i, c in enumerate(companies):
        for s in slugs(c["company"], c.get("careersUrl") or ""):
            for provider, template, reader in PROVIDERS:
                code, count, size = probe(template.format(s=s), reader)
                if code == 200 and count:
                    found.append({"company": c["company"], "provider": provider, "board": s,
                                  "jobs": count, "bytes": size, "lists": c.get("lists"),
                                  "observedAt": time.strftime("%Y-%m-%d")})
                    print(f"FOUND {c['company']} | {provider} | {s} | {count} jobs | {size} b", flush=True)
                time.sleep(0.08)
        if i % 25 == 0:
            print(f"... {i}/{len(companies)} found={len(found)}", flush=True)
            json.dump(found, open(out_path, "w"), ensure_ascii=False, indent=1)
    json.dump(found, open(out_path, "w"), ensure_ascii=False, indent=1)
    print(f"DONE {len(found)} boards from {len(companies)} companies", flush=True)

main(sys.argv[1], sys.argv[2])
