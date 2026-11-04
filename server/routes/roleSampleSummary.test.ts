import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { summarizeRoleSample } from './roleSampleSummary';

function item(lastSeenAt: string, sourceTypes: readonly string[]): MatchedVacancyItem {
  return {
    cluster: { lastSeenAt, sources: sourceTypes.map((sourceType) => ({ sourceType })) },
  } as unknown as MatchedVacancyItem;
}

describe('summarizeRoleSample (B445)', () => {
  it('берёт последнюю дату выборки и площадки из самих вакансий', () => {
    expect(
      summarizeRoleSample([
        item('2026-10-20T08:00:00.000Z', ['hh', 'linkedin']),
        item('2026-10-21T09:00:00.000Z', ['hh']),
      ]),
    ).toEqual({
      observedAt: '2026-10-21T09:00:00.000Z',
      sources: ['hh', 'linkedin'],
      sourceNames: ['hh.ru', 'linkedin'],
    });
  });

  it('пустая выборка — без даты и без площадок', () => {
    expect(summarizeRoleSample([])).toEqual({ observedAt: null, sources: [], sourceNames: [] });
  });

  it('называет площадку по имени: тип json_api площадку не называет', () => {
    const named = {
      cluster: {
        lastSeenAt: '2026-11-04T00:00:00.000Z',
        sources: [
          { sourceType: 'json_api', sourceName: 'hh.ru (страница поиска)' },
          { sourceType: 'json_api', sourceName: 'LinkedIn' },
        ],
      },
    } as unknown as MatchedVacancyItem;
    expect(summarizeRoleSample([named]).sourceNames).toEqual(['hh.ru', 'LinkedIn']);
  });
});
