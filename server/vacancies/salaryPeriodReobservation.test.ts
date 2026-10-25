import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { VacancySalary } from '../domain/unifiedVacancy';
import { normalizeJsonSource } from './jsonSourceAdapters';
import { normalizeAtsBoard } from './atsBoardAdapters';
import { clusterProjectionOf } from './vacancyPoolQuery';
import { createClusterFromVacancy, mergeVacancyIntoCluster } from './vacancyDeduplicator';
import { clusterBatchByKeys } from './keyedClusterer';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const tuple: VacancySalary = { from: 90000, to: 120000, currency: 'EUR' };
function observed(value = 'annual') {
  return normalizeJsonSource(
    'src-himalayas-api',
    {
      jobs: [
        {
          guid: 'salary-reobservation',
          title: 'Frontend Developer',
          companyName: 'Example',
          description: 'Build software.',
          applicationLink: 'https://example.test/job',
          minSalary: tuple.from,
          maxSalary: tuple.to,
          currency: tuple.currency,
          salaryPeriod: value,
          pubDate: Date.parse('2026-10-25T00:00:00Z') / 1000,
        },
      ],
    },
    { observedAt: '2026-10-25T14:24:00Z' },
  )[0]!;
}
function explicit(value = 'annual') {
  return observed(value).salary!;
}

it.each(['hourly', 'monthly', 'annual'])(
  'enriches a same-member identical salary tuple from explicit %s',
  (value) => {
    const incoming = observed(value);
    const cluster = createClusterFromVacancy({ ...incoming, salary: { ...tuple } });
    mergeVacancyIntoCluster(cluster, incoming);
    expect(cluster.salary).toBe(incoming.salary);
    expect(cluster.salary?.periodEvidence).toEqual({ field: 'himalayas.salaryPeriod', value });
    expect(cluster.vacanciesCount).toBe(1);
    expect(cluster.sources).toHaveLength(1);
  },
);

it.each([undefined, false, true])(
  'preserves identical tax basis %j during period enrichment',
  (gross) => {
    const incoming = observed();
    incoming.salary = { ...incoming.salary, gross };
    const cluster = createClusterFromVacancy({ ...incoming, salary: { ...tuple, gross } });
    mergeVacancyIntoCluster(cluster, incoming);
    expect(cluster.salary).toBe(incoming.salary);
  },
);

it('validates Lever evidence by its own provider contract during re-observation', () => {
  const [incoming] = normalizeAtsBoard(
    'ats-lever-example',
    [
      {
        id: 'same-member',
        text: 'Frontend Developer',
        hostedUrl: 'https://jobs.lever.co/example/same-member',
        salaryRange: {
          min: tuple.from,
          max: tuple.to,
          currency: tuple.currency,
          interval: 'per-year-salary',
        },
      },
    ],
    { observedAt: '2026-10-25T14:24:00Z', sourceName: 'Example' },
  );
  const cluster = createClusterFromVacancy({ ...incoming!, salary: { ...tuple } });
  mergeVacancyIntoCluster(cluster, incoming!);
  expect(cluster.salary).toBe(incoming!.salary);
  expect(cluster.salary?.periodEvidence).toEqual({
    field: 'lever.salaryRange.interval',
    value: 'per-year-salary',
  });
});

const rejected: {
  name: string;
  current?: VacancySalary;
  incoming?: unknown;
  newMember?: boolean;
}[] = [
  { name: 'different lower bound', incoming: { ...explicit(), from: 80000 } },
  { name: 'different upper bound', incoming: { ...explicit(), to: 130000 } },
  { name: 'different currency', incoming: { ...explicit(), currency: 'USD' } },
  { name: 'unknown tax is not net', incoming: { ...explicit(), gross: false } },
  { name: 'unknown tax is not gross', incoming: { ...explicit(), gross: true } },
  {
    name: 'gross is not net',
    current: { ...tuple, gross: true },
    incoming: { ...explicit(), gross: false },
  },
  {
    name: 'unknown provider field',
    incoming: { ...explicit(), periodEvidence: { field: 'untrusted.period', value: 'annual' } },
  },
  {
    name: 'unknown provider value',
    incoming: {
      ...explicit(),
      periodEvidence: { field: 'himalayas.salaryPeriod', value: 'yearly' },
    },
  },
  {
    name: 'foreign provider literal',
    incoming: {
      ...explicit(),
      periodEvidence: { field: 'himalayas.salaryPeriod', value: 'per-year-salary' },
    },
  },
  { name: 'period disagrees with evidence', incoming: { ...explicit(), period: 'month' } },
  { name: 'missing incoming evidence', incoming: { ...tuple, period: 'year' } },
  { name: 'known current period', current: explicit('monthly') },
  {
    name: 'known current Lever period',
    current: {
      ...tuple,
      period: 'year',
      periodEvidence: { field: 'lever.salaryRange.interval', value: 'per-year-salary' },
    },
  },
  { name: 'known current period with same value', current: explicit() },
  { name: 'new source membership', newMember: true },
];

it.each(rejected)(
  'preserves the whole existing salary for $name',
  ({ current, incoming, newMember }) => {
    const vacancy = observed();
    // External JSON may violate TypeScript's field/value union; the runtime boundary must reject it.
    if (incoming) vacancy.salary = JSON.parse(JSON.stringify(incoming)) as VacancySalary;
    if (newMember) vacancy.provenance = { ...vacancy.provenance, sourceId: 'src-other-source' };
    const oldSalary = current ?? { ...tuple };
    const original = observed();
    const cluster = createClusterFromVacancy({ ...original, salary: oldSalary });
    mergeVacancyIntoCluster(cluster, vacancy);
    expect(cluster.salary).toBe(oldSalary);
  },
);

it('roundtrips period enrichment through the real keyed-cluster caller after reopening the store', () => {
  const directory = mkdtempSync(join(tmpdir(), 'salary-period-reobservation-'));
  const path = join(directory, 'pool.db');
  let pool = new SqliteVacancyPoolStore({ databasePath: path });
  try {
    const incoming = observed();
    const old = { ...incoming, salary: { ...tuple } };
    pool.mergeSourceSlice('src-himalayas-api', [old]);
    expect(clusterBatchByKeys(pool, [clusterProjectionOf(old)])).toMatchObject({ created: 1 });
    const id = `cluster-${incoming.id}`;
    expect(pool.getCluster(id)?.salary?.period).toBeUndefined();
    pool.close();
    pool = new SqliteVacancyPoolStore({ databasePath: path });
    pool.mergeSourceSlice('src-himalayas-api', [incoming]);
    const persisted = pool.getVacancy(incoming.id)!;
    expect(clusterBatchByKeys(pool, [clusterProjectionOf(persisted)])).toMatchObject({
      updated: 1,
      created: 0,
    });
    pool.close();
    pool = new SqliteVacancyPoolStore({ databasePath: path });
    expect(pool.getCluster(id)?.salary).toEqual(incoming.salary);
    expect(pool.getCluster(id)?.vacanciesCount).toBe(1);
  } finally {
    pool.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
