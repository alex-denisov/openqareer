/**
 * B643-12 — dry run, read-only. Which NEW cross-source merges would appear if
 * the deduplicator grouped by `company_key` instead of company-name similarity?
 *
 * Today (`vacancyDeduplicator.isDuplicatePrepared`) two rows are one vacancy if
 * fingerprint / url / ATS link / text key are equal, or if the company passes
 * (cleaned name equal, contained, or token Jaccard >= 0.75) AND the title passes
 * (role-title token Jaccard >= 0.45, or one normalized title contains the other).
 * Location is not part of the rule. Here the company part is replaced by
 * `company_key` equality; the title part is kept as is.
 *
 * company_key of a row: `company_placement.source_id` (employer boards/sites),
 * else `vacancy_company.vacancy_id` (aggregators). Today's cluster of a row:
 * `vacancy_cluster_keys(kind='member')` by id / url / externalId / sourceUrl.
 *
 * Usage: node dry-run-company-key-merges.js <db> <out.md> [seed]
 * Opens the DB with `readOnly: true`; raw SQL only, no store constructors.
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import {
  isDuplicatePrepared,
  prepareVacancy,
  type PreparedVacancy,
} from '../server/vacancies/vacancyDeduplicator';
import type { UnifiedVacancy } from '../server/domain/unifiedVacancy';

const CHUNK = 5000;
const SAMPLE_SIZE = 100;
const TITLE_JACCARD = 0.45;

interface Row {
  readonly id: string;
  readonly sourceId: string;
  readonly company: string;
  readonly title: string;
  readonly location: string;
  readonly url: string;
  readonly how: string;
  readonly cluster: string | null;
  readonly prepared: PreparedVacancy;
}

interface Pair {
  readonly key: string;
  readonly a: Row;
  readonly b: Row;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function titlePasses(a: PreparedVacancy, b: PreparedVacancy): boolean {
  if (jaccard(a.roleTitleTokens, b.roleTitleTokens) >= TITLE_JACCARD) return true;
  if (!a.normalizedTitle || !b.normalizedTitle) return false;
  return a.normalizedTitle.includes(b.normalizedTitle) || b.normalizedTitle.includes(a.normalizedTitle);
}

function loadPlacementKeys(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT source_id, company_key FROM company_placement
        WHERE source_id IS NOT NULL AND company_key IS NOT NULL`,
    )
    .all() as Array<{ source_id: string; company_key: string }>;
  return new Map(rows.map((r) => [r.source_id, r.company_key]));
}

function makeClusterLookup(db: DatabaseSync): (keys: string[]) => string | null {
  const stmt = db.prepare(
    `SELECT cluster_id FROM vacancy_cluster_keys WHERE kind = 'member' AND key = ? LIMIT 1`,
  );
  return (keys) => {
    for (const key of keys) {
      const hit = stmt.get(key) as { cluster_id: string } | undefined;
      if (hit) return hit.cluster_id;
    }
    return null;
  };
}

function memberKeys(id: string, v: UnifiedVacancy): string[] {
  const keys = new Set<string>([id]);
  if (v.url) keys.add(v.url);
  if (v.provenance?.externalId) keys.add(v.provenance.externalId);
  if (v.provenance?.sourceUrl) keys.add(v.provenance.sourceUrl);
  return Array.from(keys);
}

interface IndexRow {
  id: string; source_id: string; cluster_json: string;
  vc_key: string | null; match_how: string | null;
}

function toRow(r: IndexRow, v: UnifiedVacancy, how: string, cluster: string | null): Row {
  return {
    id: r.id, sourceId: r.source_id, company: v.company ?? '', title: v.title ?? '',
    location: v.location ?? '', url: v.url ?? '', how, cluster, prepared: prepareVacancy(v),
  };
}

function loadRows(db: DatabaseSync, placement: Map<string, string>) {
  const page = db.prepare(
    `SELECT i.id, i.source_id, c.cluster_json, vc.company_key AS vc_key, vc.match_how
       FROM vacancy_pool_index i
       JOIN vacancy_cluster_input c ON c.id = i.id
       LEFT JOIN vacancy_company vc ON vc.vacancy_id = i.id
      WHERE i.id > ? AND i.expired = 0 AND i.is_active = 1
      ORDER BY i.id LIMIT ?`,
  );
  const clusterOf = makeClusterLookup(db);
  const byCompany = new Map<string, Row[]>();
  const stats = { live: 0, linked: 0, viaPlacement: 0, unclustered: 0, badJson: 0 };
  let cursor = '';
  for (;;) {
    const rows = page.all(cursor, CHUNK) as unknown as IndexRow[];
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    for (const r of rows) {
      stats.live += 1;
      const placementKey = placement.get(r.source_id);
      const key = placementKey ?? r.vc_key;
      if (!key) continue;
      let v: UnifiedVacancy;
      try {
        v = JSON.parse(r.cluster_json) as UnifiedVacancy;
      } catch {
        stats.badJson += 1;
        continue;
      }
      stats.linked += 1;
      if (placementKey) stats.viaPlacement += 1;
      const cluster = clusterOf(memberKeys(r.id, v));
      if (!cluster) stats.unclustered += 1;
      const row = toRow(r, v, placementKey ? 'placement' : (r.match_how ?? '?'), cluster);
      const list = byCompany.get(key);
      if (list) list.push(row);
      else byCompany.set(key, [row]);
    }
  }
  return { byCompany, stats };
}

function scanPairs(byCompany: Map<string, Row[]>, seed: number) {
  const rand = mulberry32(seed);
  const sample: Pair[] = [];
  const totals = {
    pairs: 0, nameRuleFails: 0, pairwiseDupButSplit: 0, singleWord: 0, singleWordNew: 0,
    companies: 0,
  };
  const clusters = new Set<string>();
  const unclusteredRows = new Set<string>();
  const record = (pair: Pair): void => {
    const { a, b } = pair;
    totals.pairs += 1;
    const single = a.how === 'exact_name_single_word' || b.how === 'exact_name_single_word';
    if (single) totals.singleWord += 1;
    for (const r of [a, b]) {
      if (r.cluster) clusters.add(r.cluster);
      else unclusteredRows.add(r.id);
    }
    if (isDuplicatePrepared(a.prepared, b.prepared)) {
      totals.pairwiseDupButSplit += 1;
      return;
    }
    totals.nameRuleFails += 1;
    if (single) totals.singleWordNew += 1;
    if (sample.length < SAMPLE_SIZE) sample.push(pair);
    else {
      const slot = Math.floor(rand() * totals.nameRuleFails);
      if (slot < SAMPLE_SIZE) sample[slot] = pair;
    }
  };
  for (const [key, rows] of byCompany) {
    if (rows.length < 2) continue;
    if (new Set(rows.map((r) => r.sourceId)).size < 2) continue;
    let companyHit = false;
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i]!;
      for (let j = i + 1; j < rows.length; j += 1) {
        const b = rows[j]!;
        if (a.sourceId === b.sourceId) continue;
        if (a.cluster && a.cluster === b.cluster) continue;
        if (!titlePasses(a.prepared, b.prepared)) continue;
        companyHit = true;
        record({ key, a, b });
      }
    }
    if (companyHit) totals.companies += 1;
  }
  return { totals, clustersAffected: clusters.size, unclusteredRows: unclusteredRows.size, sample };
}

function cell(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function side(r: Row): string {
  return [r.sourceId, cell(r.company, 50), cell(r.title), cell(r.location, 50), cell(r.url, 120)]
    .join(' · ');
}

function main(): void {
  const [dbPath, outPath, seedArg] = process.argv.slice(2);
  if (!dbPath || !outPath) throw new Error('usage: <db> <out.md> [seed]');
  const seed = Number(seedArg ?? 643012);
  const started = Date.now();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const placement = loadPlacementKeys(db);
  const { byCompany, stats } = loadRows(db, placement);
  const scan = scanPairs(byCompany, seed);
  const names = db.prepare('SELECT company_name FROM company_directory WHERE company_key = ?');
  const directoryNames = new Map(
    scan.sample.map((p) => [
      p.key,
      (names.get(p.key) as { company_name: string } | undefined)?.company_name ?? '?',
    ]),
  );
  db.close();
  const nameOf = (k: string) => directoryNames.get(k) ?? '?';
  const t = scan.totals;
  const lines = [
    `# B643-12 dry run: company_key merges (${new Date().toISOString().slice(0, 10)})`,
    '',
    `Live rows (expired=0, is_active=1): ${stats.live}; with company_key: ${stats.linked} ` +
      `(via placement ${stats.viaPlacement}, via vacancy_company ${stats.linked - stats.viaPlacement}); ` +
      `linked rows without a cluster today: ${stats.unclustered}; bad JSON: ${stats.badJson}.`,
    `Placements with source_id: ${placement.size}; company keys with linked rows: ${byCompany.size}.`,
    '',
    `- Pairs, different sources, not in one cluster today, same company_key, title rule passes: **${t.pairs}**`,
    `- of them the name rule fails today (proposed NEW merges): **${t.nameRuleFails}**`,
    `- of them the pairwise rule already passes but clusters are split: ${t.pairwiseDupButSplit}`,
    `- pairs with a single-word link (A or B): ${t.singleWord}; among new merges: ${t.singleWordNew}`,
    `- clusters affected: ${scan.clustersAffected}; plus unclustered rows: ${scan.unclusteredRows}; companies: ${t.companies}`,
    `- Sample: ${scan.sample.length} of the NEW merges, reservoir seed ${seed}. Runtime ${Math.round((Date.now() - started) / 1000)} s.`,
    '',
    '| # | company_key (directory name) | A: source · company · title · location · url | B: source · company · title · location · url | link how (A,B) | Верно? |',
    '|---|---|---|---|---|---|',
    ...scan.sample.map(
      (p, i) =>
        `| ${i + 1} | ${p.key} (${cell(nameOf(p.key), 40)}) | ${side(p.a)} | ${side(p.b)} | ${p.a.how}, ${p.b.how} |  |`,
    ),
    '',
  ];
  writeFileSync(outPath, lines.join('\n'));
  process.stdout.write(`${lines.slice(0, 11).join('\n')}\n`);
}

main();
