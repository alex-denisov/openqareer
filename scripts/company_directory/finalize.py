#!/usr/bin/env python3
"""Turn resolver output into directory records (B619/B620).

- drops helper fields (hints, idagentDesc, hirehiVacancies stays as evidence)
- applies source values (Veselova sheet geo / industry / domain group) over agent ones
- applies the owner's exclusions
- merges duplicates: same official registrable domain and same normalized name
- writes JSON (curated seed) or NDJSON shards (bulk HireHi)

Usage:
  finalize.py OUT.jsonl --seed server/data/companyDirectorySeed.json [--veselova ves.xlsx]
  finalize.py OUT.jsonl --shards data/company-directory/hirehi --exclude-seed server/data/companyDirectorySeed.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from resolve import host_of, reg_domain  # noqa: E402

# owner decisions 2026-11-05 (verbatim names); matched on normalized name or key
EXCLUDED = {"nda", "foundation", "human", "ace", "aijobsfoorilla", "трудвсем", "trudvsem"}
FIELDS = ["companyKey", "companyName", "websiteUrl", "careersUrl", "linkedinUrl", "linkedinOrgId",
          "sourceType", "atsProvider", "atsSlug", "status", "geo", "industry", "domainGroup", "notes",
          "createdAt", "updatedAt", "evidence"]
NOW = "2026-11-09T00:00:00Z"


def nk(s: str) -> str:
    return re.sub(r"[^0-9a-zа-яё]", "", re.sub(r"\(.*?\)", "", (s or "").lower()))


def excluded(r: dict) -> bool:
    return nk(r["companyName"]) in EXCLUDED or nk(r["companyKey"]) in EXCLUDED


def veselova(path: str) -> dict:
    import openpyxl

    ws = openpyxl.load_workbook(path).active
    out = {}
    for row in ws.iter_rows(min_row=3, values_only=True):
        if row[1]:
            out[nk(str(row[1]))] = {"domainGroup": row[2], "industry": row[3], "geo": row[5],
                                    "notes": row[11]}
    return out


def clean(r: dict, ves: dict) -> dict:
    ev = dict(r.get("evidence") or {})
    out = {k: r.get(k) for k in FIELDS}
    if (out["notes"] or "").startswith("Imported from ID Agent") and r.get("idagentDesc"):
        out["notes"] = r["idagentDesc"]
    v = ves.get(nk(r["companyName"]))
    if v:
        for k in ("domainGroup", "industry", "geo"):
            if v[k]:
                out[k] = v[k]
                ev[k] = {"value": v[k], "how": "Veselova sheet"}
        if v["notes"] and not out["notes"]:
            out["notes"] = v["notes"]
    if r.get("hirehiVacancies") is not None:
        ev["hirehi"] = {"value": (r.get("hints") or {}).get("hirehiSlug", r["companyKey"]), "how": f"{r['hirehiVacancies']} vacancies on hirehi.ru"}
    for k in ("geo", "industry", "domainGroup"):
        if out.get(k) and k not in ev:
            ev[k] = {"value": out[k], "how": "existing row (agent import), not re-checked"}
    out["evidence"] = ev
    out["status"] = out.get("status") or "active"
    out["updatedAt"] = NOW
    out["createdAt"] = out.get("createdAt") or NOW
    return out


def score(r: dict) -> int:
    e = r["evidence"]
    return sum([bool(r["linkedinOrgId"]) * 4, bool(r["atsProvider"]) * 2, bool(r["careersUrl"]),
                e.get("websiteUrl", {}).get("confirmed", True) is not False, -len(r["companyKey"]) // 20])


def same_company(a: str, b: str) -> bool:
    x, y = nk(a), nk(b)
    return bool(x) and bool(y) and (x.startswith(y) or y.startswith(x))


def dedup(rows: list[dict]) -> tuple[list[dict], list[tuple[str, str]]]:
    """Merge rows with one official domain and compatible names; flag clashes."""
    by_domain: dict[str, list[dict]] = {}
    solo: list[list[dict]] = []
    for r in rows:
        if r["websiteUrl"]:
            by_domain.setdefault(reg_domain(host_of(r["websiteUrl"])), []).append(r)
        else:
            solo.append([r])
    groups: list[list[dict]] = list(solo)
    for dom, items in by_domain.items():
        clusters: list[list[dict]] = []
        for r in items:
            for c in clusters:
                if same_company(c[0]["companyName"], r["companyName"]):
                    c.append(r)
                    break
            else:
                clusters.append([r])
        if len(clusters) > 1:  # different names on one domain: same-name clash
            for c in clusters:
                for r in c:
                    if not str(r["evidence"].get("websiteUrl", {}).get("how", "")).startswith(("source", "DOU")):
                        others = [o[0]["companyName"] for o in clusters if o is not c]
                        unset(r, dom, f"domain {dom} also claimed by {others}; identity ambiguous")
        groups += clusters
    out, merged = [], []
    for grp in groups:
        grp.sort(key=score, reverse=True)
        keep = dict(grp[0])
        keep["companyKey"] = min((g["companyKey"] for g in grp), key=lambda k: (len(k), k))
        for other in grp[1:]:
            for k in FIELDS:
                if not keep.get(k) and other.get(k):
                    keep[k] = other[k]
        gone = [o["companyKey"] for o in grp if o["companyKey"] != keep["companyKey"]]
        merged += [(g, keep["companyKey"]) for g in gone]
        if gone:
            keep["evidence"] = {**keep["evidence"],
                                "mergedFrom": {"value": gone, "how": "same official domain and name"}}
        out.append(keep)
    return out, merged


def unset(r: dict, dom: str, why: str) -> None:
    ev = dict(r["evidence"])
    r["websiteUrl"] = None
    ev["websiteUrl"] = {"value": None, "how": f"not found: {why}"}
    if r["careersUrl"] and reg_domain(host_of(r["careersUrl"])) == dom:
        r["careersUrl"] = None
        ev["careersUrl"] = {"value": None, "how": f"not found: {why}"}
    if str(ev.get("linkedinUrl", {}).get("how", "")).startswith("linked from"):
        r["linkedinUrl"] = None
        ev["linkedinUrl"] = {"value": None, "how": f"not found: {why}"}
    r["evidence"] = ev


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("resolved")
    ap.add_argument("--seed")
    ap.add_argument("--shards")
    ap.add_argument("--veselova")
    ap.add_argument("--exclude-seed")
    args = ap.parse_args()
    ves = veselova(args.veselova) if args.veselova else {}
    rows = [json.loads(l) for l in open(args.resolved, encoding="utf-8") if l.strip()]
    dropped = [r["companyKey"] for r in rows if excluded(r)]
    rows = [clean(r, ves) for r in rows if not excluded(r)]
    if args.exclude_seed:
        seed = json.load(open(args.exclude_seed, encoding="utf-8"))
        domains = {reg_domain(host_of(s["websiteUrl"])) for s in seed if s.get("websiteUrl")}
        keys = {s["companyKey"] for s in seed}
        before = len(rows)
        rows = [r for r in rows if r["companyKey"] not in keys
                and not (r["websiteUrl"] and reg_domain(host_of(r["websiteUrl"])) in domains)]
        print(f"dropped {before - len(rows)} already in the curated seed (key or domain)", file=sys.stderr)
    rows, merged = dedup(rows)
    rows.sort(key=lambda r: r["companyKey"])
    print(f"excluded {dropped}; merged {merged}; {len(rows)} rows", file=sys.stderr)
    if args.seed:
        with open(args.seed, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    if args.shards:
        os.makedirs(args.shards, exist_ok=True)
        shards: dict[str, list[dict]] = {}
        for r in rows:
            c = r["companyKey"][0].lower()
            shards.setdefault(c if c.isascii() and c.isalpha() else "_", []).append(r)
        for name, items in shards.items():
            with open(os.path.join(args.shards, f"{name}.ndjson"), "w", encoding="utf-8") as fh:
                for r in items:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
