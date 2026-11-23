import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from './poolVacancyCluster';
import { createClusterFromVacancy } from './vacancyDeduplicator';

function vacancy(id: string, title: string, salary: UnifiedVacancy['salary']): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title,
    company: 'Arootah',
    description: 'Описание',
    requiredSkills: [],
    url: `https://jobs.example/${id}`,
    provenance: {
      sourceType: 'direct',
      sourceId: 'ats-lever-arootah',
      sourceUrl: '',
      observedAt: '',
    },
    publishedAt: '2026-11-22T00:00:00.000Z',
    status: 'active',
    ...(salary ? { salary } : {}),
  };
}

const OWN = vacancy('ats-lever-arootah:8faace0f', 'Fractional Chief AI Officer', {
  from: 275,
  to: 425,
  currency: 'USD',
  period: 'hour',
});
const FOUNDER = vacancy('src-himalayas-api:cao', 'Fractional Chief Administrative Officer', {
  from: 200,
  to: 300,
  currency: 'USD',
  period: 'hour',
});
// Сохранённый кластер склеен вокруг другой вакансии; строка подборки — его участник.
const MERGED: VacancyCluster = { ...createClusterFromVacancy(FOUNDER), vacanciesCount: 15 };

function engine(active: Record<string, VacancyCluster>, records: readonly UnifiedVacancy[]) {
  return {
    getActiveCluster: (id: string) => active[id],
    getVacancy: (id: string) => records.find((record) => record.id === id),
  };
}

describe('resolveRowVacancyCluster: карточка читает ту же вакансию, что строка подборки (B765, B645 23.11)', () => {
  it('строка-участник склеенного кластера — своя запись, а не основатель', () => {
    const rowId = `cluster-${OWN.id}`;
    const cluster = resolveRowVacancyCluster(engine({ [rowId]: MERGED }, [OWN, FOUNDER]), rowId);
    expect(cluster?.id).toBe(rowId);
    expect(cluster?.canonicalTitle).toBe('Fractional Chief AI Officer');
    expect(cluster?.salary).toMatchObject({ from: 275, to: 425, period: 'hour' });
  });

  it('свой сохранённый кластер и снятая запись — как прежде', () => {
    const own = createClusterFromVacancy(OWN);
    expect(resolveRowVacancyCluster(engine({ [own.id]: own }, []), own.id)).toBe(own);
    const gone = { ...OWN, status: 'archived' as const };
    expect(resolveRowVacancyCluster(engine({ [own.id]: MERGED }, [gone]), own.id)).toBe(MERGED);
    expect(resolveRowVacancyCluster(engine({}, []), own.id)).toBeUndefined();
  });
});
