#!/usr/bin/env python3
"""Make prod company_directory equal to git (curated seed + HireHi shards).

Git is the source of truth for every field except linkedin_org_id, which the
server resolver (B621) may fill on prod: there git wins when it has a value,
prod's value is kept otherwise. Rows absent from git are kept (B628: imports
and discoveries live on prod); --prune deletes only those without evidence.

Rows stream as NDJSON over ssh stdin into node:sqlite on the host, in one
transaction. `--dry-run` prints the counts the change would produce and rolls back.

Usage: sync_to_prod.py [--host openqareer-de-1] [--dry-run] [--prune]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SEED = os.path.join(ROOT, "server", "data", "companyDirectorySeed.json")
SHARDS = os.path.join(ROOT, "data", "company-directory", "hirehi")
DB = "/var/lib/openqareer/openqareer.db"

REMOTE = open(os.path.join(os.path.dirname(__file__), "sync_remote.cjs"), encoding="utf-8").read()


def load_rows() -> list[dict]:
    rows = json.load(open(SEED, encoding="utf-8"))
    for path in sorted(glob.glob(os.path.join(SHARDS, "*.ndjson"))):
        with open(path, encoding="utf-8") as fh:
            rows += [json.loads(l) for l in fh if l.strip()]
    keys = [r["companyKey"] for r in rows]
    if len(keys) != len(set(keys)):
        raise SystemExit("duplicate companyKey across seed and shards")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="openqareer-de-1")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--prune", action="store_true", help="delete rows absent from git that have no evidence")
    args = ap.parse_args()
    rows = load_rows()
    payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows).encode()
    script = REMOTE.replace("'", "'\\''")
    cmd = ["ssh", args.host, f"DB={DB} DRY={'1' if args.dry_run else '0'} PRUNE={'1' if args.prune else '0'} node -e '{script}'"]
    res = subprocess.run(cmd, input=payload, capture_output=True, timeout=900)
    sys.stdout.write(res.stdout.decode())
    sys.stderr.write(res.stderr.decode()[-2000:])
    return res.returncode


if __name__ == "__main__":
    sys.exit(main())
