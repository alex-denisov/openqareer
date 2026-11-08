/**
 * B621: локальная проверка резолвера на снимке реестра (JSON из read-only
 * SELECT). Пишет только в локальную SQLite-копию, прод не трогает.
 * npx tsx scripts/b621_resolve_linkedin_org_local.ts <registry.json> <local.db> [minGapMs]
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { COMPANY_DIRECTORY_MIGRATION } from '../server/data/companyDirectorySchema';
import { createGuestFetch } from '../server/companyDirectory/linkedinOrg/guestFetch';
import { LinkedinOrgRunner } from '../server/companyDirectory/linkedinOrg/linkedinOrgRunner';
import { LinkedinOrgStore } from '../server/companyDirectory/linkedinOrg/linkedinOrgStore';

const [registryPath, dbPath, gap] = process.argv.slice(2);
if (!registryPath || !dbPath) throw new Error('usage: <registry.json> <local.db> [minGapMs]');
const db = new DatabaseSync(dbPath);
db.exec(COMPANY_DIRECTORY_MIGRATION);
const count = (db.prepare('SELECT COUNT(*) AS n FROM company_directory').get() as { n: number }).n;
if (count === 0) {
  const rows = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<string, unknown>[];
  const cols = Object.keys(rows[0]!);
  const insert = db.prepare(
    `INSERT INTO company_directory (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  );
  for (const row of rows) insert.run(...cols.map((c) => row[c] as string | null));
}
const log = {
  info: (d: Record<string, unknown>, m: string) => process.stdout.write(`${JSON.stringify({ m, ...d })}\n`),
  warn: (d: Record<string, unknown>, m: string) => process.stdout.write(`${JSON.stringify({ m, ...d })}\n`),
};
const store = new LinkedinOrgStore(db);
const runner = new LinkedinOrgRunner({ store, fetchPage: createGuestFetch(), log, minGapMs: Number(gap ?? 8000) });
for (;;) {
  const result = await runner.step();
  if (result.kind === 'idle') break;
  if (result.kind === 'cooldown') {
    log.warn({ until: result.until.toISOString() }, 'cooldown-wait');
    await new Promise((r) => setTimeout(r, Math.max(1000, result.until.getTime() - Date.now())));
    continue;
  }
  log.info({ key: result.companyKey, ...result.outcome }, 'row');
}
log.info(store.counts(), 'final');
