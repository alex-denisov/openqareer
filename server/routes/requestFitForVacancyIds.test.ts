import { describe, expect, it, vi } from 'vitest';

vi.mock('./vacancyFitContext', () => ({
  readVacancyFitTarget: (_deps: unknown, id: string) => ({ id }),
  createVacancyFitContextReader: () => (target: { id: string }) => ({ vacancyId: target.id }),
}));

const { requestFitForVacancyIds } = await import('./matchedVacancyFit');

function runtime(counted: ReadonlySet<string>) {
  return {
    hasCurrentResult: vi.fn((input: { vacancyId: string }) => counted.has(input.vacancyId)),
    view: vi.fn(() => ({ state: 'not_requested' })),
    enqueue: vi.fn(),
  };
}

describe('fit queue for a selection chunk (prod 02.11: 100–450 ms per chunk on the event loop)', () => {
  it('the background sweep skips counted rows without opening their result', async () => {
    const mechanics = runtime(new Set(['a', 'b']));
    await requestFitForVacancyIds({ vacancyMechanics: mechanics } as never, 'candidate', ['a', 'b', 'c'], 40);
    expect(mechanics.view).toHaveBeenCalledTimes(1);
    expect(mechanics.enqueue).toHaveBeenCalledTimes(1);
    expect(mechanics.enqueue).toHaveBeenCalledWith({ vacancyId: 'c' }, { backgroundRank: 42 });
  });

  it('rows on screen still read the full view, so a broken stored result is queued again', async () => {
    const mechanics = runtime(new Set(['a']));
    await requestFitForVacancyIds({ vacancyMechanics: mechanics } as never, 'candidate', ['a']);
    expect(mechanics.hasCurrentResult).not.toHaveBeenCalled();
    expect(mechanics.view).toHaveBeenCalledTimes(1);
  });

  it('lets queued requests run between rows once a slice is spent (PRB-041: up to 1 s per chunk)', async () => {
    const order: string[] = [];
    const mechanics = {
      ...runtime(new Set()),
      enqueue: vi.fn((input: { vacancyId: string }) => order.push(`enqueue:${input.vacancyId}`)),
    };
    const clock = [0, 0, 20];
    const now = () => clock.shift() ?? 20;
    setImmediate(() => order.push('turn'));

    await requestFitForVacancyIds(
      { vacancyMechanics: mechanics } as never,
      'candidate',
      ['a', 'b'],
      undefined,
      { sliceMs: 10, now },
    );

    expect(order).toEqual(['enqueue:a', 'turn', 'enqueue:b']);
  });
});
