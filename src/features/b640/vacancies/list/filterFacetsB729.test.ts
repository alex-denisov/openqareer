import { describe, expect, it } from 'vitest';
import type { MatchedVacancyFacets } from '../../../../../shared/matchedVacancyFacets';
import { dateFacet, filteredFacetsOf } from '../../../../../shared/listFilterFacets';
import { makeItem } from './fixtures';
import { buildOptions } from './filterOptions';

/**
 * B729: пока пул дочитывается (14–37 с на проде), числа «Даты», «Формата» и «Локаций» берутся
 * из ответа сервера по всей выдаче; дочитали — клиент считает сам, и числа те же.
 */
const NOW = new Date('2026-11-20T12:00:00');
const DAY = 86_400_000;
const PLACES = ['Москва', 'Санкт-Петербург', 'Берлин', 'Дубай'];

function pool(size: number, step: number) {
  return Array.from({ length: size }, (_, index) =>
    makeItem({
      id: `r${index}`,
      location: PLACES[index % PLACES.length],
      remote: index % 4 === 0,
      observedAt: new Date(NOW.getTime() - index * step * DAY).toISOString(),
    }),
  );
}

function serverFacets(items: ReturnType<typeof pool>): MatchedVacancyFacets {
  const { observed, ...counts } = filteredFacetsOf(items);
  const today = new Date(NOW);
  today.setHours(0, 0, 0, 0);
  return {
    total: items.length,
    regions: [],
    remote: 0,
    levels: [],
    roles: [],
    sources: [],
    filtered: { ...counts, dates: dateFacet(observed, today.getTime()) },
  };
}

const numbers = (options: readonly { id: string; count?: number }[]) =>
  Object.fromEntries(options.map(({ id, count }) => [id, count]));

describe('B729: числа фильтров по серверу, пока пул читается', () => {
  // «COO» — 266 строк за 30 дней, «без роли» — 897 строк за полгода.
  it.each([
    ['COO', pool(266, 0.1)],
    ['без роли', pool(897, 0.2)],
  ])('%s: число сервера = число клиента после дочитывания', (_, items) => {
    const facets = serverFacets(items);
    const loading = buildOptions(items.slice(0, 40), facets, NOW, false);
    const loaded = buildOptions(items, facets, NOW, true);
    expect(numbers(loading.dates)).toEqual(numbers(loaded.dates));
    expect(numbers(loading.formats)).toEqual(numbers(loaded.formats));
    expect(numbers(loading.locations)).toEqual(numbers(loaded.locations));
    expect(loaded.dates.find(({ id }) => id === '30')?.count).toBeGreaterThan(0);
  });

  it('без чисел сервера (старый ответ) — пока читается, чисел нет', () => {
    const items = pool(30, 1);
    const options = buildOptions(items.slice(0, 5), undefined, NOW, false);
    expect(options.dates.every((option) => option.count === undefined)).toBe(true);
    expect(options.locations.every((option) => option.count === undefined)).toBe(true);
    expect(options.locations.length).toBeGreaterThan(0);
  });

  it('значения «Локаций» — вся выдача, даже не загруженные места', () => {
    const items = pool(40, 1);
    const options = buildOptions(items.slice(0, 1), serverFacets(items), NOW, false);
    expect(options.locations.map(({ id }) => id).sort()).toEqual(['Удалённо', ...PLACES].sort());
  });
});
