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

// B351: an observation with a proven period replaces the whole unevidenced salary,
// whatever its tuple or membership — a newer published range, a repost or another
// source of the same cluster. Nothing is assembled across observations.
const replacing: { name: string; incoming: VacancySalary; newMember?: boolean }[] = [
  { name: 'different lower bound', incoming: { ...explicit(), from: 80000 } },
  { name: 'different upper bound', incoming: { ...explicit(), to: 130000 } },
  { name: 'different currency', incoming: { ...explicit(), currency: 'USD' } },
  { name: 'different tax basis', incoming: { ...explicit(), gross: false } },
  { name: 'new source membership', incoming: explicit(), newMember: true },
];

it.each(replacing)('takes the whole evidenced salary for $name', ({ incoming, newMember }) => {
  const vacancy = observed();
  vacancy.salary = incoming;
  if (newMember) vacancy.provenance = { ...vacancy.provenance, sourceId: 'src-other-source' };
  const cluster = createClusterFromVacancy({ ...observed(), salary: { ...tuple } });
  mergeVacancyIntoCluster(cluster, vacancy);
  expect(cluster.salary).toBe(incoming);
});

it('keeps an evidenced salary when a later observation only closes the range', () => {
  const evidenced: VacancySalary = { ...explicit(), to: undefined };
  const cluster = createClusterFromVacancy({ ...observed(), salary: evidenced });
  mergeVacancyIntoCluster(cluster, { ...observed(), salary: { ...tuple } });
  expect(cluster.salary).toBe(evidenced);
});

it('does not trade a closed unevidenced range for an open evidenced one', () => {
  const closed = { ...tuple };
  const cluster = createClusterFromVacancy({ ...observed(), salary: closed });
  mergeVacancyIntoCluster(cluster, { ...observed(), salary: { ...explicit(), to: undefined } });
  expect(cluster.salary).toBe(closed);
});

const rejected: {
  name: string;
  current?: VacancySalary;
  incoming?: unknown;
}[] = [
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
  {
    name: 'known current period against a different evidenced range',
    current: explicit('monthly'),
    incoming: { ...explicit(), from: 80000 },
  },
];

it.each(rejected)('preserves the whole existing salary for $name', ({ current, incoming }) => {
  const vacancy = observed();
  // External JSON may violate TypeScript's field/value union; the runtime boundary must reject it.
  if (incoming) vacancy.salary = JSON.parse(JSON.stringify(incoming)) as VacancySalary;
  const oldSalary = current ?? { ...tuple };
  const original = observed();
  const cluster = createClusterFromVacancy({ ...original, salary: oldSalary });
  mergeVacancyIntoCluster(cluster, vacancy);
  expect(cluster.salary).toBe(oldSalary);
});

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
