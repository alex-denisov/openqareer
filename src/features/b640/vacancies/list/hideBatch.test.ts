import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hideVacancy } from '../skipApi';
import { makeItem } from './fixtures';
import { hideInBatches } from './hideBatch';

vi.mock('../skipApi', () => ({ hideVacancy: vi.fn() }));
const hide = vi.mocked(hideVacancy);

const entry = (id: string, reason: 'role-family' | 'comp-below' = 'role-family') => ({
  id,
  item: makeItem({ id }),
  reason,
});

beforeEach(() => {
  hide.mockReset();
});

describe('серия скрытий', () => {
  it('скрывает каждую вакансию с её причиной', async () => {
    hide.mockResolvedValue(undefined);
    const result = await hideInBatches([entry('a'), entry('b', 'comp-below')]);
    expect(hide.mock.calls).toEqual([
      ['a', 'role-family'],
      ['b', 'comp-below'],
    ]);
    expect(result.done.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result.failed).toEqual([]);
  });

  it('сбой одной не мешает остальным', async () => {
    hide.mockImplementation(async (id) => {
      if (id === 'b') throw new Error('сеть');
    });
    const result = await hideInBatches([entry('a'), entry('b'), entry('c')]);
    expect(result.done.map((row) => row.id)).toEqual(['a', 'c']);
    expect(result.failed).toEqual(['b']);
  });

  it('длинную серию режет на пачки', async () => {
    let running = 0;
    let peak = 0;
    hide.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    });
    const entries = Array.from({ length: 23 }, (_, i) => entry(`c${i}`));
    const result = await hideInBatches(entries);
    expect(result.done).toHaveLength(23);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
