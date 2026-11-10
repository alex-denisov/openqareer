/* Runs on the prod host: reads NDJSON rows on stdin, upserts company_directory (B628). */
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
    // B628: строки, которых нет в git (импорты и находки прямо на проде), не
    // удаляются. С --prune удаляются только строки без evidence.
    const del = process.env.PRUNE === '1'
      ? db.prepare("DELETE FROM company_directory WHERE company_key NOT IN (SELECT k FROM git_keys) AND coalesce(evidence, '') IN ('', 'null', '{}')").run()
      : { changes: 0 };
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
