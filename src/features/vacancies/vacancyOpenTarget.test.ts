import { describe, expect, it } from 'vitest';
import { openTargetLabel } from './vacancyOpenTarget';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

function source(
  sourceId: string,
  sourceName: string,
): MatchedVacancyItem['cluster']['sources'][number] {
  return {
    sourceType: 'json_api',
    sourceId,
    sourceName,
    sourceUrl: 'https://example.test',
    observedAt: '2026-09-21T00:00:00.000Z',
  } as MatchedVacancyItem['cluster']['sources'][number];
}

describe('openTargetLabel (B236)', () => {
  it('называет площадку без уточнения в скобках', () => {
    // На проде метка «hh.ru (страница поиска)» превышала лимит, и каждая
    // вакансия hh.ru получала «Открыть на сайте» (приёмка в .app, 2026-09-21).
    expect(openTargetLabel([source('hh', 'hh.ru (страница поиска)')])).toBe('hh.ru');
  });

  it('оставляет короткое имя и прячет длинное за «сайте»', () => {
    expect(openTargetLabel([source('himalayas', 'Himalayas')])).toBe('Himalayas');
    expect(openTargetLabel([source('x', 'Очень длинное имя площадки')])).toBe('сайте');
  });
});
