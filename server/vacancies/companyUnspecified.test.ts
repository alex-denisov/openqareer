import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { clusterVacancies, isDuplicateVacancy } from './vacancyDeduplicator';

function tg(id: string, title: string, company: string, priorityHigh = false): UnifiedVacancy {
  const url = `https://t.me/channel/${id}`;
  return {
    id,
    fingerprint: `fp-${id}`,
    title,
    company,
    description: `Пост ${id}: ${title}, удалённо.`,
    requiredSkills: [],
    isRemote: true,
    url,
    provenance: {
      sourceType: priorityHigh ? 'hh' : 'telegram',
      sourceId: priorityHigh ? 'src-hh-search' : 'src-tg-channel',
      sourceUrl: url,
      observedAt: '2026-11-22T21:00:00.000Z',
    },
    publishedAt: '2026-11-22T20:00:00.000Z',
    status: 'active',
  };
}

describe('B756: «компания не указана»', () => {
  it('кластер без работодателя — пустая строка и признак companyUnspecified', () => {
    const [cluster] = clusterVacancies([tg('1', 'Технический директор', '')]);
    expect(cluster!.canonicalCompany).toBe('');
    expect(cluster!.companyUnspecified).toBe(true);
  });

  it('у кластера с работодателем признака нет', () => {
    const [cluster] = clusterVacancies([tg('1', 'Технический директор', 'Медиагруппа РИМ')]);
    expect(cluster!.companyUnspecified).toBeUndefined();
  });

  it('пустая компания не склеивает разные вакансии с похожим названием', () => {
    const a = tg('1', 'Product manager', '');
    const b = tg('2', 'Product manager', '');
    expect(isDuplicateVacancy(a, b)).toBe(false);
    expect(clusterVacancies([a, b])).toHaveLength(2);
  });

  it('источник выше по приоритету с компанией снимает признак', () => {
    const empty = tg('1', 'Product manager', '');
    const named = { ...tg('2', 'Product manager', 'Acme'), url: empty.url };
    const [cluster] = clusterVacancies([
      empty,
      {
        ...named,
        provenance: { ...named.provenance, sourceType: 'hh' as const, sourceId: 'src-hh-search' },
      },
    ]);
    expect(cluster!.canonicalCompany).toBe('Acme');
    expect(cluster!.companyUnspecified).toBeUndefined();
  });
});
