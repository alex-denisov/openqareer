import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { WithoutTextQueue } from './withoutTextQueue';

const row = (id: string) => ({ id }) as UnifiedVacancy;

function setup(initial: readonly string[]) {
  let rows = [...initial];
  let scans = 0;
  const queue = new WithoutTextQueue({
    load: (_source, limit, exclude) => {
      scans += 1;
      return rows
        .filter((id) => !exclude.includes(id))
        .slice(0, limit)
        .map(row);
    },
    reload: (_source, ids) => ids.filter((id) => rows.includes(id)).map(row),
  });
  const take = (limit: number, exclude: readonly string[] = []) =>
    queue.take('s', limit, exclude).map((vacancy) => vacancy.id);
  return {
    take,
    scans: () => scans,
    drop: (...ids: string[]) => (rows = rows.filter((id) => !ids.includes(id))),
  };
}

describe('очередь дочитки площадки (B761)', () => {
  it('обходит площадку один раз на сотню записей', () => {
    const { take, scans, drop } = setup(['a', 'b', 'c', 'd', 'e']);
    expect(take(2)).toEqual(['a', 'b']);
    drop('a', 'b');
    expect(take(2)).toEqual(['c', 'd']);
    drop('c', 'd');
    expect(take(2)).toEqual(['e']);
    expect(scans()).toBe(1);
    drop('e');
    expect(take(2)).toEqual([]);
    expect(scans()).toBe(2);
  });

  it('не отдаёт снятую, дочитанную и исчерпавшую попытки запись', () => {
    const { take, drop } = setup(['a', 'b', 'c', 'd', 'e']);
    take(1);
    drop('b', 'c');
    expect(take(2, ['d'])).toEqual(['e']);
  });

  it('неудачная запись возвращается на следующем обходе', () => {
    const { take } = setup(['a', 'b']);
    expect(take(2)).toEqual(['a', 'b']);
    expect(take(2)).toEqual(['a', 'b']);
  });
});
