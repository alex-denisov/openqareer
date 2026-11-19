import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { sealedPrefix, sealedSlice } from './b640SealedAnswer';
import type { SealedMatchedList } from './sealedMatchedList';

const row = (id: string) => ({ cluster: { id } }) as unknown as MatchedVacancyItem;
const page = (offset: number, ids: string[]) => ({ offset, nextOffset: null, items: ids.map(row) });

function sealed(pages: SealedMatchedList['pages'], total: number): SealedMatchedList {
  return {
    version: 1,
    choice: 'c',
    total,
    pageOffsets: pages.map(({ offset }) => offset),
    pages,
    facets: {} as SealedMatchedList['facets'],
    campaignWithHypotheses: {} as SealedMatchedList['campaignWithHypotheses'],
  };
}

const ids = (rows: readonly MatchedVacancyItem[] | undefined) => rows?.map((item) => item.cluster.id);

describe('B702: страница нового маршрута из запечатанного списка', () => {
  it('склеивает страницы подряд и останавливается на разрыве', () => {
    expect(ids(sealedPrefix(sealed([page(3, ['d']), page(0, ['a', 'b', 'c'])], 9)))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(sealedPrefix(sealed([page(0, ['a']), page(5, ['f'])], 9)))).toEqual(['a']);
  });

  it('отдаёт страницу, только если строки её покрывают', () => {
    const list = sealed([page(0, ['a', 'b']), page(2, ['c', 'd'])], 10);
    expect(ids(sealedSlice(list, 0, 3)?.rows)).toEqual(['a', 'b', 'c']);
    expect(sealedSlice(list, 0, 3)?.total).toBe(10);
    expect(sealedSlice(list, 2, 5)).toBeUndefined();
    expect(sealedSlice(list, 10, 5)).toBeUndefined();
  });

  it('короткий список отдаётся целиком, даже если лимит больше', () => {
    const list = sealed([page(0, ['a', 'b', 'c'])], 3);
    expect(ids(sealedSlice(list, 0, 20)?.rows)).toEqual(['a', 'b', 'c']);
    expect(ids(sealedSlice(list, 2, 20)?.rows)).toEqual(['c']);
  });
});
