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
    ).toEqual({ observedAt: '2026-10-21T09:00:00.000Z', sources: ['hh', 'linkedin'] });
  });

  it('пустая выборка — без даты и без площадок', () => {
    expect(summarizeRoleSample([])).toEqual({ observedAt: null, sources: [] });
  });
});
