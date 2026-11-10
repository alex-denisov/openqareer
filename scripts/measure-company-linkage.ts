// B643-1: one read-only measurement of how pool rows tie to directory companies.
// Never writes: the database is opened readOnly and only SELECTs run.
// Usage: tsx scripts/measure-company-linkage.ts <db path> [--sample 100]
import { DatabaseSync } from 'node:sqlite';
import { sourceKind } from '../server/vacancies/poolLiveness';
import {
  buildLinkageIndex,
  classifyCoverage,
  linkByEmployerName,
  linkEmployerSource,
  placementTypeOf,
  type DirectoryRow,
  type PlacementType,
} from '../server/companyDirectory/placement/placementLinkage';

const path = process.argv[2];
if (!path) throw new Error('Pass the database path explicitly');
const sampleArg = process.argv.indexOf('--sample');
const SAMPLE = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 100;

const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
const bump = (map: Map<string, number>, key: string, n: number): void => { map.set(key, (map.get(key) ?? 0) + n); };

try {
  const directory = db.prepare(`SELECT company_key AS companyKey, company_name AS companyName,
    website_url AS websiteUrl, ats_provider AS atsProvider, ats_slug AS atsSlug FROM company_directory`)
    .all() as unknown as DirectoryRow[];
  const names = new Map(directory.map((row) => [row.companyKey, row.companyName]));
  const index = buildLinkageIndex(directory);
  const typesOf = new Map<string, Set<PlacementType>>();
  const mark = (key: string, type: PlacementType): void => {
    const set = typesOf.get(key) ?? new Set<PlacementType>();
    typesOf.set(key, set.add(type));
  };

  const rows = new Map<string, number>();
  const sources = db.prepare(`SELECT source_id AS s, count(*) AS n FROM vacancy_pool_index WHERE expired=0 GROUP BY source_id`)
    .all() as unknown as { s: string; n: number }[];
  const unlinkedBoards: { s: string; n: number }[] = [];
  const nameSources: string[] = [];
  let live = 0;
  for (const { s, n } of sources) {
    live += n;
    const type = placementTypeOf(sourceKind(s));
    const link = linkEmployerSource(s, index);
    if (link) { bump(rows, `${type}:linked:${link.how}`, n); mark(link.companyKey, type); continue; }
    if (type === 'aggregator' || type === 'linkedin') { nameSources.push(s); continue; }
    bump(rows, `${type}:unlinked`, n); unlinkedBoards.push({ s, n });
  }

  const byName = db.prepare(`SELECT json_extract(c.cluster_json,'$.company') AS company, count(*) AS n
    FROM vacancy_pool_index i JOIN vacancy_cluster_input c ON c.id=i.id
    WHERE i.expired=0 AND i.source_id=? GROUP BY 1`);
  const samples: { name: string; directoryName: string; companyKey: string; source: string }[] = [];
  let linkedNames = 0;
  // Reservoir sample of distinct name pairs for the precision check.
  const keepSample = (pair: (typeof samples)[number], seen: number): void => {
    if (samples.length < SAMPLE) { samples.push(pair); return; }
    const j = Math.floor(Math.random() * seen);
    if (j < SAMPLE) samples[j] = pair;
  };
  for (const s of nameSources) {
    const type = placementTypeOf(sourceKind(s));
    for (const { company, n } of byName.all(s) as unknown as { company: string | null; n: number }[]) {
      const link = linkByEmployerName(company, index);
      bump(rows, `${type}:name:${link.status}`, n);
      if (link.status !== 'linked') continue;
      mark(link.companyKey, type);
      linkedNames += 1;
      keepSample({ name: company ?? '', directoryName: names.get(link.companyKey) ?? '', companyKey: link.companyKey, source: s }, linkedNames);
    }
  }

  const coverage = new Map<string, number>();
  for (const row of directory) bump(coverage, classifyCoverage(typesOf.get(row.companyKey) ?? new Set()), 1);
  const page = db.prepare('PRAGMA page_count').get() as { page_count: number };
  const size = db.prepare('PRAGMA page_size').get() as { page_size: number };

  process.stdout.write(JSON.stringify({
    measuredAt: new Date().toISOString(),
    live,
    directoryCompanies: directory.length,
    rows: Object.fromEntries([...rows].sort()),
    coverage: Object.fromEntries(coverage),
    topUnlinkedBoards: unlinkedBoards.sort((a, b) => b.n - a.n).slice(0, 20),
    dbBytes: page.page_count * size.page_size,
    precisionSample: samples,
  }, null, 1));
} finally {
  db.close();
}
