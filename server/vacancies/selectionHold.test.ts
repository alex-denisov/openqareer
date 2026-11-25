import { describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { holdFilteredRows, holdUncheckedRows } from './selectionHold';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 86_400_000;
function row(id: string, daysAgo: number, sources = 1): MatchedVacancyItem {
  const observedAt = new Date(NOW - daysAgo * DAY).toISOString();
  return {
    cluster: { id: `cluster-${id}`, sources: Array.from({ length: sources }, () => ({ observedAt })) },
  } as unknown as MatchedVacancyItem;
}
const hh = (n: number) => `src-hh-search:${n}`;
const fresh = (count: number) => Array.from({ length: count }, (_, n) => row(hh(9_000 + n), 1));
const old = (count: number, from = 0) =>
  Array.from({ length: count }, (_, n) => row(hh(from + n), 10));
const all = (ids: readonly string[]) => new Set(ids);

describe('B797: строки hh ждут сверки до показа', () => {
  it('прячет давно виденные несверенные, остальные показывает в том же порядке', () => {
    const rows = [row(hh(1), 10), ...fresh(50), row('x:1', 10), row(hh(2), 10, 2)];
    const held = holdUncheckedRows(rows, all, NOW);
    expect(held.heldIds).toEqual([hh(1)]);
    expect(held.rows).toEqual(rows.slice(1));
  });
  it('сверенная строка показывается', () => {
    const rows = [row(hh(1), 10), ...fresh(50)];
    expect(holdUncheckedRows(rows, () => new Set(), NOW).rows).toBe(rows);
  });
  it('пока верх не сверен, строки ниже него на его место не поднимаются', () => {
    const rows = [...fresh(30), ...old(170), ...old(100, 500)];
    const held = holdUncheckedRows(rows, all, NOW);
    expect(held.rows).toEqual(rows.slice(0, 30));
    expect(held.heldIds).toHaveLength(170);
  });
  it('верх почти сверен — нижние строки на месте', () => {
    const rows = [...fresh(199), ...old(1), ...old(100, 500)];
    expect(holdUncheckedRows(rows, all, NOW).rows).toHaveLength(299);
  });
  it('меньше страницы не оставляет: список целиком, строки всё равно в сверку', () => {
    const rows = [...fresh(5), ...old(50)];
    const held = holdUncheckedRows(rows, all, NOW);
    expect(held.rows).toBe(rows);
    expect(held.heldIds).toHaveLength(50);
  });
  it('числа фильтров считаются по тем же строкам, что показаны', () => {
    const pool = [...old(10), ...fresh(60)];
    const all60 = holdFilteredRows(pool, pool, all, NOW);
    expect(all60.pool).toEqual(all60.rows);
    expect(all60.rows).toHaveLength(60);
    const filtered = pool.slice(5, 40);
    const part = holdFilteredRows(pool, filtered, all, NOW);
    expect(part.rows).toHaveLength(30);
    expect(part.pool.filter((item) => filtered.includes(item))).toEqual(part.rows);
    const few = pool.slice(0, 12);
    const short = holdFilteredRows(pool, few, all, NOW);
    expect(short.rows).toBe(few);
    expect(short.pool.filter((item) => few.includes(item))).toEqual(few);
  });
});
