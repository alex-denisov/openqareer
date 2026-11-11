// B643: dry run of the careers prune rule. Never writes: the database is
// opened readOnly and only SELECTs run. Prints how many careers pages the rule
// would drop, by reason, how many it holds back, and up to 10 samples.
// Usage: tsx scripts/measure-careers-prune.ts <db path> [--now 2026-11-12T00:00:00Z]
import { DatabaseSync } from 'node:sqlite';
import { careersDropReason, careersUrlSetAt, type SourceStateRow } from '../server/companyDirectory/siteDiscovery/careersPrune';

const SITE_PREFIX = 'src-company-site-';
const SAMPLES = 10;

const path = process.argv[2];
if (!path) throw new Error('Pass the database path explicitly');
const nowArg = process.argv.indexOf('--now');
const nowMs = nowArg > 0 ? Date.parse(process.argv[nowArg + 1] ?? '') : Date.now();
if (Number.isNaN(nowMs)) throw new Error('--now must be an ISO date');

const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });

function parseEvidence(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const bucketOf = (reason: string): string => {
  const cause = /last error (.+)$/.exec(reason)?.[1];
  return cause ? `error: ${cause}` : 'empty 14+ days';
};

try {
  const rows = db.prepare(`SELECT source_id AS sourceId, last_status AS lastStatus, last_error_message AS lastErrorMessage,
      items_found_total AS itemsFoundTotal, observations FROM vacancy_source_state
    WHERE source_id > ? AND source_id < 'src-company-site.' ORDER BY source_id`)
    .all(SITE_PREFIX) as unknown as Omit<SourceStateRow, 'careersUrlSetAt'>[];
  const careersOf = db.prepare('SELECT careers_url AS url, evidence FROM company_directory WHERE company_key = ?');
  const counts = new Map<string, number>();
  const bump = (key: string): void => { counts.set(key, (counts.get(key) ?? 0) + 1); };
  const samples: { companyKey: string; url: string; reason: string }[] = [];

  for (const row of rows) {
    if (!careersDropReason({ ...row, careersUrlSetAt: 0 }, nowMs)) {
      bump('kept: rule does not apply');
      continue;
    }
    const companyKey = row.sourceId.slice(SITE_PREFIX.length);
    const current = careersOf.get(companyKey) as { url: string | null; evidence: string | null } | undefined;
    if (!current?.url) {
      bump('kept: careers_url already empty');
      continue;
    }
    const setAt = careersUrlSetAt(parseEvidence(current.evidence));
    if (setAt === null) {
      bump('held: URL set time unknown');
      continue;
    }
    const reason = careersDropReason({ ...row, careersUrlSetAt: setAt }, nowMs);
    if (!reason) {
      bump('held: readings predate the URL');
      continue;
    }
    bump(`drop ${bucketOf(reason)}`);
    if (samples.length < SAMPLES) samples.push({ companyKey, url: current.url, reason });
  }

  const drops = [...counts].filter(([key]) => key.startsWith('drop')).reduce((sum, [, n]) => sum + n, 0);
  console.log(JSON.stringify({ at: new Date(nowMs).toISOString(), sources: rows.length, wouldDrop: drops,
    byReason: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])), samples }, null, 2));
} finally {
  db.close();
}
