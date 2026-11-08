#!/usr/bin/env python3
"""Make prod company_directory equal to git (curated seed + HireHi shards).

Git is the source of truth for every field except linkedin_org_id, which the
server resolver (B621) may fill on prod: there git wins when it has a value,
prod's value is kept otherwise. Rows absent from git are deleted.

Rows stream as NDJSON over ssh stdin into node:sqlite on the host, in one
transaction. `--dry-run` prints the counts the change would produce and rolls back.

Usage: sync_to_prod.py [--host openqareer-de-1] [--dry-run]
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

REMOTE = r"""
const { DatabaseSync } = require('node:sqlite');
const rl = require('node:readline').createInterface({ input: process.stdin });
const rows = [];
rl.on('line', (l) => { if (l.trim()) rows.push(JSON.parse(l)); });
rl.on('close', () => {
  const db = new DatabaseSync(process.env.DB);
  db.exec('PRAGMA busy_timeout = 10000;');
  const cols = db.prepare('PRAGMA table_info(company_directory)').all().map((c) => c.name);
  if (!cols.includes('evidence')) db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  const before = db.prepare('SELECT count(*) n FROM company_directory').get().n;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TEMP TABLE git_keys (k TEXT PRIMARY KEY)');
    const key = db.prepare('INSERT OR IGNORE INTO git_keys VALUES (?)');
    const up = db.prepare(`INSERT INTO company_directory (company_key, company_name, website_url,
      careers_url, linkedin_url, linkedin_org_id, source_type, ats_provider, ats_slug, status, geo,
      industry, domain_group, notes, created_at, updated_at, evidence)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(company_key) DO UPDATE SET company_name=excluded.company_name,
      website_url=excluded.website_url, careers_url=excluded.careers_url,
      linkedin_url=excluded.linkedin_url,
      linkedin_org_id=COALESCE(excluded.linkedin_org_id, company_directory.linkedin_org_id),
      source_type=excluded.source_type, ats_provider=excluded.ats_provider,
      ats_slug=excluded.ats_slug, status=excluded.status, geo=excluded.geo,
      industry=excluded.industry, domain_group=excluded.domain_group, notes=excluded.notes,
      updated_at=excluded.updated_at, evidence=excluded.evidence`);
    for (const r of rows) {
      key.run(r.companyKey);
      up.run(r.companyKey, r.companyName, r.websiteUrl ?? null, r.careersUrl ?? null,
        r.linkedinUrl ?? null, r.linkedinOrgId ?? null, r.sourceType, r.atsProvider ?? null,
        r.atsSlug ?? null, r.status ?? 'active', r.geo ?? null, r.industry ?? null,
        r.domainGroup ?? null, r.notes ?? null, r.createdAt, r.updatedAt,
        r.evidence ? JSON.stringify(r.evidence) : null);
    }
    const del = db.prepare('DELETE FROM company_directory WHERE company_key NOT IN (SELECT k FROM git_keys)').run();
    const q = (sql) => db.prepare(sql).get().n;
    const stats = {
      before, git: rows.length, deleted: Number(del.changes),
      rows: q('SELECT count(*) n FROM company_directory'),
      withWebsite: q("SELECT count(*) n FROM company_directory WHERE coalesce(website_url,'')<>''"),
      withCareers: q("SELECT count(*) n FROM company_directory WHERE coalesce(careers_url,'')<>''"),
      withOwnCareers: q("SELECT count(*) n FROM company_directory WHERE careers_url NOT LIKE '%linkedin.com%'"),
      withAts: q("SELECT count(*) n FROM company_directory WHERE coalesce(ats_provider,'')<>''"),
      withLinkedinUrl: q("SELECT count(*) n FROM company_directory WHERE coalesce(linkedin_url,'')<>''"),
      withOrgId: q("SELECT count(*) n FROM company_directory WHERE coalesce(linkedin_org_id,'')<>''"),
    };
    db.exec(process.env.DRY === '1' ? 'ROLLBACK' : 'COMMIT');
    console.log(JSON.stringify({ dryRun: process.env.DRY === '1', ...stats }));
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('rolled back:', err.message);
    process.exit(1);
  }
});
"""


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
    args = ap.parse_args()
    rows = load_rows()
    payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows).encode()
    script = REMOTE.replace("'", "'\\''")
    cmd = ["ssh", args.host, f"DB={DB} DRY={'1' if args.dry_run else '0'} node -e '{script}'"]
    res = subprocess.run(cmd, input=payload, capture_output=True, timeout=900)
    sys.stdout.write(res.stdout.decode())
    sys.stderr.write(res.stderr.decode()[-2000:])
    return res.returncode


if __name__ == "__main__":
    sys.exit(main())
