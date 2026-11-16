import { describe, expect, it } from 'vitest';
import { makeItem } from './fixtures';
import { footOf, nextSort, sortItems, visibleSlice } from './sortModel';

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
