import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { toStoredHhSample } from './storedHhVacancySample';

function vacancy(overrides: Partial<UnifiedVacancy> & { observedAt?: string }): UnifiedVacancy {
  const { observedAt = '2026-10-28T09:00:00.000Z', ...rest } = overrides;
  return {
    id: 'src-hh-search:101',
    fingerprint: 'fp-101',
    title: 'Технический директор',
    company: 'Synthetic Company',
    location: 'Москва',
    description: 'Synthetic description',
    requiredSkills: [],
    url: 'https://hh.ru/vacancy/101',
    provenance: {
      sourceType: 'html_scraper',
      sourceId: 'src-hh-search',
      sourceUrl: 'https://hh.ru/vacancy/101',
      observedAt,
    },
    publishedAt: '2026-10-27T10:00:00.000Z',
    status: 'active',
    ...rest,
  } as UnifiedVacancy;
}

describe('toStoredHhSample (29.10)', () => {
  it('dates the sample by the latest observation and keeps only hh vacancy links', () => {
    const sample = toStoredHhSample('cto', [
      vacancy({ observedAt: '2026-10-27T09:00:00.000Z' }),
      vacancy({
        id: 'src-hh-search:102',
        url: 'https://hh.ru/vacancy/102',
        observedAt: '2026-10-28T11:00:00.000Z',
      }),
      vacancy({ id: 'src-hh-search:bad', url: 'https://example.test/vacancy/1' }),
    ]);

    expect(sample.fetchedAt).toBe('2026-10-28T11:00:00.000Z');
    expect(sample.items.map((item) => item.id)).toEqual(['101', '102']);
    expect(sample.source).toBe('hh');
  });

  it('does not pass on a private employer name or an empty place', () => {
    const [item] = toStoredHhSample('cto', [
      vacancy({ company: 'Private Person', employerIsPerson: true, location: ' ' }),
    ]).items;

    expect(item).toMatchObject({ company: 'Компания не указана', location: 'Место не указано' });
  });

  it('dates an empty sample by now', () => {
    expect(toStoredHhSample('cto', [], () => '2026-10-29T10:00:00.000Z')).toMatchObject({
      found: 0,
      items: [],
      fetchedAt: '2026-10-29T10:00:00.000Z',
    });
  });
});
