import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { clusterBatchByKeys, detachVacanciesByKeys } from './keyedClusterer';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { clusterVacancies } from './vacancyDeduplicator';

/**
 * B230, golden-тест: сведение партиями через `loadClustersByKeys` даёт те же
 * кластеры, что полная пересборка `clusterVacancies` — на фикстуре ~2 000
 * записей с дублями по отпечатку, ссылке, ATS-ссылке и токенам
 * «работодатель × название». Сравниваются разбиения (какие записи вместе),
 * а не id кластеров.
 */
const COMPANIES = [
  'Yandex',
  'Ozon Tech',
  'Tinkoff',
  'Avito',
  'VK',
  'Sber',
  'Kaspersky',
  'Wildberries',
];
const TITLES = [
  'Senior Frontend Engineer',
  'Backend Developer (Go)',
  'Data Scientist',
  'QA Automation Engineer',
  'DevOps Engineer',
  'Product Manager',
  'iOS Developer',
  'Android Developer',
];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fixture(): UnifiedVacancy[] {
  const random = seeded(230);
  const records: UnifiedVacancy[] = [];
  let serial = 0;
  const make = (
    over: Partial<UnifiedVacancy> & { sourceId: string; company: string; title: string },
  ) => {
    serial += 1;
    const id = `${over.sourceId}:${serial}`;
    const url = over.url ?? `https://${over.sourceId}.example/jobs/${serial}`;
    const vacancy: UnifiedVacancy = {
      id,
      fingerprint: over.fingerprint ?? `fp-${serial}`,
      title: over.title,
      company: over.company,
      description: over.description ?? `Role ${over.title} at ${over.company}`,
      requiredSkills: ['TypeScript'],
      url,
      provenance: {
        sourceType: 'json_api',
        sourceId: over.sourceId,
        sourceUrl: url,
        observedAt: new Date(Date.UTC(2026, 8, 1 + (serial % 20))).toISOString(),
      },
      publishedAt: new Date(Date.UTC(2026, 8, 1 + (serial % 20))).toISOString(),
      status: 'active',
    };
    records.push(vacancy);
    return vacancy;
  };
  for (let job = 0; job < 800; job += 1) {
    const company = COMPANIES[job % COMPANIES.length]!;
    const title = TITLES[Math.floor(random() * TITLES.length)]!;
    const distinctTitle = `${title} ${job}`;
    const origin = make({ sourceId: 'src-a', company, title: distinctTitle });
    const kind = job % 5;
    if (kind === 0) {
      // Тот же отпечаток на другой площадке.
      make({ sourceId: 'src-b', company, title: distinctTitle, fingerprint: origin.fingerprint });
    } else if (kind === 1) {
      // Та же ссылка с хвостом запроса.
      make({
        sourceId: 'src-c',
        company,
        title: `${distinctTitle} (remote)`,
        url: `${origin.url}?utm=1`,
      });
    } else if (kind === 2) {
      // Одна ATS-ссылка в описании двух объявлений.
      const ats = `https://boards.greenhouse.io/${company.toLowerCase().replace(/\s+/g, '')}/jobs/${job}`;
      records.pop();
      make({ sourceId: 'src-a', company, title: distinctTitle, description: `Apply: ${ats}` });
      make({
        sourceId: 'src-d',
        company: `${company} LLC`,
        title: 'Open position',
        description: ats,
      });
    } else if (kind === 3) {
      // Общие токены работодателя и названия, разные ссылки.
      make({ sourceId: 'src-e', company: `${company} LLC`, title: distinctTitle });
      make({ sourceId: 'src-f', company, title: `${distinctTitle} — ${company}` });
    }
    // kind 4: одиночная запись, шум.
    if (random() < 0.5)
      make({ sourceId: 'src-g', company: `Other ${job}`, title: `Unique role ${job}` });
  }
  return records;
}

function partition(clusters: readonly VacancyCluster[]): string[] {
  return clusters
    .map((cluster) =>
      cluster.sources
        .map((source) => source.sourceUrl)
        .sort()
        .join('|'),
    )
    .sort();
}

describe('keyed clustering golden (B230)', () => {
  it('batches through loadClustersByKeys produce the same partition as a full rebuild', () => {
    const records = fixture();
    expect(records.length).toBeGreaterThan(1500);
    const full = clusterVacancies(records);

    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    const batchSize = 150;
    let created = 0;
    let updated = 0;
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const result = clusterBatchByKeys(store, records.slice(offset, offset + batchSize));
      created += result.created;
      updated += result.updated;
    }
    const keyed = store.loadClusters();

    expect(keyed.length).toBe(full.length);
    expect(partition(keyed)).toEqual(partition(full));
    expect(created).toBe(full.length);
    expect(updated).toBeGreaterThan(0);
    // Каждый кластер нашёл себя по ключам, а не только по основателю.
    expect(store.countClusters()).toBe(full.length);
    store.close();
  });

  it('re-observing the same records adds no clusters and no memberships', () => {
    const records = fixture().slice(0, 600);
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    clusterBatchByKeys(store, records);
    const before = store.loadClusters();
    clusterBatchByKeys(store, records);
    const after = store.loadClusters();
    expect(partition(after)).toEqual(partition(before));
    expect(after.map((c) => c.vacanciesCount).sort()).toEqual(
      before.map((c) => c.vacanciesCount).sort(),
    );
    store.close();
  });

  it('detaching a record removes it from its cluster and deletes a cluster left empty', () => {
    const records = fixture().slice(0, 300);
    const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
    clusterBatchByKeys(store, records);
    const clusters = store.loadClusters();
    const shared = clusters.find((c) => c.vacanciesCount >= 2)!;
    const single = clusters.find((c) => c.vacanciesCount === 1)!;
    const sharedMember = records.find((r) => r.url === shared.sources[0]!.sourceUrl)!;
    const singleMember = records.find((r) => r.url === single.sources[0]!.sourceUrl)!;

    const result = detachVacanciesByKeys(store, [sharedMember, singleMember]);

    expect(result).toEqual({ updated: 1, deleted: 1 });
    expect(store.getCluster(single.id)).toBeUndefined();
    const remaining = store.getCluster(shared.id)!;
    expect(remaining.vacanciesCount).toBe(shared.vacanciesCount - 1);
    expect(remaining.sources.some((s) => s.sourceUrl === sharedMember.url)).toBe(false);
    // Снятая запись больше не находит кластер по ключу члена.
    expect(
      store.loadClustersByKeys([
        { direct: [{ kind: 'member', key: sharedMember.url }], companyTokens: [], titleTokens: [] },
      ]),
    ).toEqual([]);
    store.close();
  });
});
