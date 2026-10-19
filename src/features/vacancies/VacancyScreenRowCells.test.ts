import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancyLevelLabel } from './VacancyScreenRowCells';

function item(title: string, vacancyLevel?: MatchedVacancyItem['explanation']['vacancyLevel']) {
  return {
    cluster: { canonicalTitle: title },
    explanation: { levelMatch: vacancyLevel ? 'match' : 'unknown', vacancyLevel },
  } as unknown as MatchedVacancyItem;
}

describe('vacancyLevelLabel', () => {
  it('names the level the server compared, so «совпадает» never sits next to «Не указан»', () => {
    expect(vacancyLevelLabel(item('Chief of Staff', 'c-level'))).toBe('C-level');
  });

  it('falls back to the title for an old server', () => {
    expect(vacancyLevelLabel(item('Head of Platform'))).toBe('Head');
    expect(vacancyLevelLabel(item('Chief of Staff'))).toBe('Не указан');
  });
});
