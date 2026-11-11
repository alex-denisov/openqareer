// B643-8: read-only dry run of the aggregator row → company rule on prod.
// Never writes: the database is opened readOnly and only SELECTs run.
// Usage: tsx scripts/measure-aggregator-linkage.ts <db path> [--sample 100]
import { DatabaseSync } from 'node:sqlite';
import { buildLinkageIndex, type DirectoryRow } from '../server/companyDirectory/placement/placementLinkage';
import { linkAggregatorRow } from '../server/companyDirectory/placement/aggregatorLinkage';

const path = process.argv[2];
if (!path) throw new Error('Pass the database path explicitly');
const sampleArg = process.argv.indexOf('--sample');
const SAMPLE = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 100;
const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });

interface Pair { how: string; name: string; directoryName: string; companyKey: string; website: string | null; source: string; rows: number }

try {
  const directory = db.prepare(`SELECT company_key AS companyKey, company_name AS companyName,
    website_url AS websiteUrl, ats_provider AS atsProvider, ats_slug AS atsSlug FROM company_directory`)
    .all() as unknown as DirectoryRow[];
  const byKey = new Map(directory.map((row) => [row.companyKey, row]));
  const index = buildLinkageIndex(directory);
  const groups = db.prepare(`SELECT i.source_id AS s, json_extract(c.cluster_json,'$.company') AS company,
      json_extract(c.cluster_json,'$.employerIsPerson') AS person, count(*) AS n
    FROM vacancy_pool_index i JOIN vacancy_cluster_input c ON c.id=i.id
    WHERE i.expired=0 GROUP BY 1,2,3`).iterate() as Iterable<{ s: string; company: string | null; person: number | null; n: number }>;
  const rows: Record<string, number> = {};
  const names: Record<string, number> = {};
  const topLinked = new Map<string, number>();
  const pairs = new Map<string, Pair>();
  let live = 0;
  for (const g of groups) {
    live += g.n;
    const link = linkAggregatorRow({ sourceId: g.s, company: g.company, employerIsPerson: g.person === 1 }, index, (k) => byKey.get(k)?.companyName);
    const status = link.status === 'linked' ? link.how : link.reason;
    rows[status] = (rows[status] ?? 0) + g.n;
    names[status] = (names[status] ?? 0) + 1;
    if (link.status !== 'linked') continue;
    topLinked.set(link.companyKey, (topLinked.get(link.companyKey) ?? 0) + g.n);
    const pairKey = `${g.company}→${link.companyKey}`;
    const dir = byKey.get(link.companyKey);
    const seen = pairs.get(pairKey);
    pairs.set(pairKey, { name: g.company ?? '', directoryName: dir?.companyName ?? '', companyKey: link.companyKey, website: dir?.websiteUrl ?? null, how: link.how, source: g.s, rows: (seen?.rows ?? 0) + g.n });
  }
  const all = [...pairs.values()];
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j]!, all[i]!]; }
  console.log(JSON.stringify({
    live, rows, groups: names, distinctPairs: pairs.size,
    top: [...topLinked].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => [k, byKey.get(k)?.companyName, n]),
    sample: all.slice(0, SAMPLE),
  }));
} finally {
  db.close();
}
