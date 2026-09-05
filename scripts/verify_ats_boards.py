#!/usr/bin/env python3
"""B202 — подтверждение, что найденная доска принадлежит именно этой компании."""
import json, re, sys, urllib.request, urllib.error, time

AGENT = "openqareer-source-probe/1.0 (+https://openqareer.com; ATS board ownership check)"

def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception as e:
        return type(e).__name__, b""

def published_name(provider, board):
    if provider == "greenhouse":
        c, b = get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs")
        if c == 200:
            d = json.loads(b)
            names = {j.get("company_name") for j in d.get("jobs", []) if j.get("company_name")}
            return next(iter(names)) if names else None
    if provider == "workable":
        c, b = get(f"https://apply.workable.com/api/v1/widget/accounts/{board}?details=true")
        if c == 200:
            return json.loads(b).get("name")
    if provider == "recruitee":
        c, b = get(f"https://{board}.recruitee.com/api/offers/")
        if c == 200:
            names = {o.get("company_name") for o in json.loads(b).get("offers", []) if o.get("company_name")}
            return next(iter(names)) if names else None
    if provider in ("lever", "ashby"):
        host = f"https://jobs.lever.co/{board}" if provider == "lever" else f"https://jobs.ashbyhq.com/{board}"
        c, b = get(host)
        if c == 200:
            m = re.search(rb"<title[^>]*>(.*?)</title>", b, re.S | re.I)
            if m:
                return m.group(1).decode("utf-8", "replace").strip()[:120]
    return None

def norm(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())

out = []
boards = json.load(open(sys.argv[1]))
for i, b in enumerate(boards):
    name = published_name(b["provider"], b["board"])
    a, c = norm(b["company"]), norm(name)
    match = bool(c) and (a in c or c in a or a[:6] == c[:6])
    out.append({**b, "publishedName": name, "ownershipConfirmed": match})
    print(f"{'OK ' if match else 'CHECK'} {b['company']} | {b['provider']}:{b['board']} | {name}", flush=True)
    time.sleep(0.1)
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
print("confirmed", sum(1 for x in out if x["ownershipConfirmed"]), "of", len(out))
