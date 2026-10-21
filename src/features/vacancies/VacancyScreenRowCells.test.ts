import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import { vacancyLevelLabel, vacancyRowStatus } from './VacancyScreenRowCells';

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

describe('vacancyRowStatus (B446-g4, 390)', () => {
  const make = (explanation: Partial<MatchedVacancyItem['explanation']>) =>
    ({ cluster: { canonicalTitle: 'Head' }, explanation }) as unknown as MatchedVacancyItem;

  it('derives the row status from the same match marks as the 1440 columns', () => {
    expect(vacancyRowStatus(make({ levelMatch: 'match', outsideGeography: false }))).toEqual({
      tone: 'ok',
      label: 'Подходит',
    });
    expect(vacancyRowStatus(make({ levelMatch: 'match', outsideGeography: true }))).toEqual({
      tone: 'warn',
      label: 'Другой город',
    });
    expect(vacancyRowStatus(make({ levelMatch: 'above', outsideGeography: false }))).toEqual({
      tone: 'warn',
      label: 'Другой уровень',
    });
    expect(vacancyRowStatus(make({ levelMatch: 'unknown', outsideGeography: false }))).toEqual({
      tone: 'unknown',
      label: 'Уровень не указан',
    });
  });
});
