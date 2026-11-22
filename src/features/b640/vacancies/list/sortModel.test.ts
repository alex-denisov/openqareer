import { describe, expect, it } from 'vitest';
import { makeItem } from './fixtures';
import {
  DEFAULT_LIST_SORT,
  footOf,
  nextSort,
  serverFoot,
  serverSortApplies,
  sortItems,
  visibleSlice,
} from './sortModel';

const items = [
  makeItem({ id: 'a', title: 'Бета', percent: 50 }),
  makeItem({ id: 'b', title: 'Альфа', percent: 90 }),
  makeItem({ id: 'c', title: 'Гамма' }),
];
const ids = (list: readonly { cluster: { id: string } }[]) => list.map((item) => item.cluster.id);

describe('сортировка по столбцу', () => {
  it('без выбора — порядок сервера, исходный массив не меняется', () => {
    expect(ids(sortItems(items, null))).toEqual(['a', 'b', 'c']);
  });

  it('по названию возрастающе', () => {
    expect(ids(sortItems(items, { key: 'role', dir: 'asc' }))).toEqual(['b', 'a', 'c']);
    expect(ids(items)).toEqual(['a', 'b', 'c']);
  });

  it('строки без процента внизу в обе стороны', () => {
    expect(ids(sortItems(items, { key: 'fit', dir: 'desc' }))).toEqual(['b', 'a', 'c']);
    expect(ids(sortItems(items, { key: 'fit', dir: 'asc' }))).toEqual(['a', 'b', 'c']);
  });

  it('первое нажатие — естественное направление, второе — обратное', () => {
    expect(nextSort(null, 'role')).toEqual({ key: 'role', dir: 'asc' });
    expect(nextSort(null, 'fit')).toEqual({ key: 'fit', dir: 'desc' });
    expect(nextSort({ key: 'fit', dir: 'desc' }, 'fit')).toEqual({ key: 'fit', dir: 'asc' });
  });
});

describe('порции по 20', () => {
  it('подвал считает остаток и шаг', () => {
    expect(footOf(214, 20)).toEqual({ step: 20, left: 194 });
    expect(footOf(25, 20)).toEqual({ step: 5, left: 5 });
    expect(footOf(20, 20)).toBeNull();
  });

  it('срез не мутирует', () => {
    const all = Array.from({ length: 30 }, (_, i) => i);
    expect(visibleSlice(all, 20)).toHaveLength(20);
    expect(all).toHaveLength(30);
  });
});

describe('подвал серверного режима', () => {
  it('без клиентских фильтров — число осталось от выдачи сервера', () => {
    expect(serverFoot({ narrowed: false, hasMore: true, serverTotal: 90, loaded: 20 })).toEqual({
      total: 90,
      shown: 20,
      countKnown: true,
    });
  });

  it('с клиентскими фильтрами число не пишем и не занижаем заголовок', () => {
    expect(serverFoot({ narrowed: true, hasMore: true, serverTotal: 90, loaded: 20 })).toEqual({
      total: null,
      shown: 20,
      countKnown: false,
    });
  });

  it('всё прочитано — подвала нет, число известно', () => {
    expect(serverFoot({ narrowed: true, hasMore: false, serverTotal: 90, loaded: 31 })).toEqual({
      total: 31,
      shown: 31,
      countKnown: true,
    });
  });
});

describe('порядок подборки по умолчанию (s07)', () => {
  it('«Дата», сначала новые; повторное нажатие — старые сначала', () => {
    expect(DEFAULT_LIST_SORT).toEqual({ key: 'date', dir: 'desc' });
    expect(nextSort(DEFAULT_LIST_SORT, 'date')).toEqual({ key: 'date', dir: 'asc' });
    expect(nextSort(DEFAULT_LIST_SORT, 'fit')).toEqual({ key: 'fit', dir: 'desc' });
  });

  it('сервер сортирует только непрочитанную до конца подборку, и не раньше первой порции пула', () => {
    expect(serverSortApplies({ complete: false, loading: false, failed: false })).toBe(true);
    expect(serverSortApplies({ complete: false, loading: true, failed: false })).toBe(false);
    expect(serverSortApplies({ complete: true, loading: false, failed: false })).toBe(false);
    expect(serverSortApplies({ complete: false, loading: false, failed: true })).toBe(false);
  });
});
