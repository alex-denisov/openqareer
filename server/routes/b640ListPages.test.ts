import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { createListPages } from './b640ListPages';

const rows = (...ids: string[]) =>
  ids.map((id) => ({ cluster: { id } }) as unknown as MatchedVacancyItem);
const idsOf = (list: readonly MatchedVacancyItem[]) => list.map((row) => row.cluster.id);

describe('порции одной подборки (B789)', () => {
  it('следующая порция держит порядок первой; снятые выпадают, новые в конце', () => {
    const pages = createListPages();
    pages('k', rows('a', 'b', 'c', 'd'), 0);
    expect(idsOf(pages('k', rows('d', 'x', 'a', 'c'), 2))).toEqual(['a', 'c', 'd', 'x']);
    expect(idsOf(pages('k', rows('d', 'a'), 0))).toEqual(['d', 'a']);
    expect(idsOf(pages('other', rows('d', 'a'), 2))).toEqual(['d', 'a']);
  });

  it('через 10 минут порядок читается заново', () => {
    let at = 0;
    const pages = createListPages(() => at);
    pages('k', rows('a', 'b'), 0);
    at = 10 * 60_000;
    expect(idsOf(pages('k', rows('b', 'a'), 20))).toEqual(['b', 'a']);
  });
});
