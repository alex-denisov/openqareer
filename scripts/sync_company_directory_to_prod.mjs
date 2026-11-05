import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const seedPath = join(__dirname, '../server/data/companyDirectorySeed.json');
const seedData = JSON.parse(readFileSync(seedPath, 'utf8'));

console.log(`Loaded ${seedData.length} records from local seed file.`);

const remoteScript = `
import { DatabaseSync } from "node:sqlite";

const companies = ${JSON.stringify(seedData)};
const db = new DatabaseSync("/var/lib/openqareer/openqareer.db");

db.exec("PRAGMA busy_timeout = 5000;");

const upsertStmt = db.prepare(\`
  INSERT INTO company_directory (
    company_key, company_name, website_url, careers_url, linkedin_url,
    linkedin_org_id, source_type, ats_provider, ats_slug, status,
    geo, industry, domain_group, notes, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(company_key) DO UPDATE SET
    company_name = excluded.company_name,
    website_url = COALESCE(excluded.website_url, company_directory.website_url),
    careers_url = COALESCE(excluded.careers_url, company_directory.careers_url),
    linkedin_url = COALESCE(excluded.linkedin_url, company_directory.linkedin_url),
    linkedin_org_id = COALESCE(excluded.linkedin_org_id, company_directory.linkedin_org_id),
    source_type = excluded.source_type,
    ats_provider = COALESCE(excluded.ats_provider, company_directory.ats_provider),
    ats_slug = COALESCE(excluded.ats_slug, company_directory.ats_slug),
    status = excluded.status,
    geo = COALESCE(excluded.geo, company_directory.geo),
    industry = COALESCE(excluded.industry, company_directory.industry),
    domain_group = COALESCE(excluded.domain_group, company_directory.domain_group),
    notes = COALESCE(excluded.notes, company_directory.notes),
    updated_at = excluded.updated_at;
\`);

console.log("Starting SQLite transaction on /var/lib/openqareer/openqareer.db...");
db.exec("BEGIN TRANSACTION;");
try {
  for (const c of companies) {
    upsertStmt.run(
      c.companyKey,
      c.companyName,
      c.websiteUrl ?? null,
      c.careersUrl ?? null,
      c.linkedinUrl ?? null,
      c.linkedinOrgId ?? null,
      c.sourceType,
      c.atsProvider ?? null,
      c.atsSlug ?? null,
      c.status ?? 'active',
      c.geo ?? null,
      c.industry ?? null,
      c.domainGroup ?? null,
      c.notes ?? null,
      c.createdAt ?? new Date().toISOString(),
      c.updatedAt ?? new Date().toISOString()
    );
  }
  db.exec("COMMIT;");
  console.log("Transaction committed successfully.");
} catch (err) {
  db.exec("ROLLBACK;");
  console.error("Transaction rolled back due to error:", err);
  process.exit(1);
}

// Validation probes
const count = db.prepare("SELECT count(*) as cnt FROM company_directory").get().cnt;
const missingGeo = db.prepare("SELECT count(*) as cnt FROM company_directory WHERE geo IS NULL OR trim(geo) = ''").get().cnt;
const missingWebsite = db.prepare("SELECT count(*) as cnt FROM company_directory WHERE website_url IS NULL OR trim(website_url) = ''").get().cnt;
const missingCareers = db.prepare("SELECT count(*) as cnt FROM company_directory WHERE careers_url IS NULL OR trim(careers_url) = ''").get().cnt;
const missingLinkedin = db.prepare("SELECT count(*) as cnt FROM company_directory WHERE linkedin_url IS NULL OR trim(linkedin_url) = ''").get().cnt;
const keywordsInUrls = db.prepare("SELECT count(*) as cnt FROM company_directory WHERE linkedin_url LIKE '%keywords=%' OR careers_url LIKE '%keywords=%'").get().cnt;

console.log(JSON.stringify({
  totalCount: count,
  missingGeo,
  missingWebsite,
  missingCareers,
  missingLinkedin,
  keywordsInUrls
}, null, 2));
`;

const ssh = spawn('ssh', ['openqareer-de-1', 'sudo node --no-warnings --input-type=module'], {
  stdio: ['pipe', 'inherit', 'inherit']
});

ssh.stdin.write(remoteScript);
ssh.stdin.end();

ssh.on('close', (code) => {
  console.log(`SSH process finished with exit code ${code}`);
  process.exit(code);
});
