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

  it('the background refresh stops at the ceiling; new rows and opened cards never wait for a slot (04.11)', async () => {
    const states: Record<string, string> = { r1: 'refreshing', r2: 'refreshing', n1: 'not_requested' };
    const mechanics = {
      ...runtime(new Set()),
      view: vi.fn((input: { vacancyId: string }) => ({ state: states[input.vacancyId] })),
      fitJobHoldsKey: vi.fn(() => false),
    };
    const slot = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const deps = { vacancyMechanics: mechanics } as never;
    await requestFitForVacancyIds(deps, 'candidate', ['r1', 'r2', 'n1'], 0, {}, slot);
    expect(mechanics.enqueue.mock.calls.map(([input]) => input.vacancyId)).toEqual(['r1', 'n1']);
    expect(slot).toHaveBeenCalledTimes(2);
    mechanics.enqueue.mockClear();
    // A card the candidate opened passes no slot: no ceiling.
    await requestFitForVacancyIds(deps, 'candidate', ['r1', 'r2']);
    expect(mechanics.enqueue).toHaveBeenCalledTimes(2);
  });

  it('a refreshing row whose job holds the key spends no slot: no job would come of it (04.11)', async () => {
    const mechanics = {
      ...runtime(new Set()),
      view: vi.fn(() => ({ state: 'refreshing' })),
      fitJobHoldsKey: vi.fn((input: { vacancyId: string }) => input.vacancyId === 'held'),
    };
    const slot = vi.fn(() => true);
    await requestFitForVacancyIds({ vacancyMechanics: mechanics } as never, 'candidate', ['held', 'free'], 0, {}, slot);
    expect(slot).toHaveBeenCalledTimes(1);
    expect(mechanics.enqueue.mock.calls.map(([input]) => input.vacancyId)).toEqual(['free']);
  });

  it('a new row may spend a slot only if its finished job lost the result; a refreshing row has spent its own (04.11)', async () => {
    const states: Record<string, string> = { r1: 'refreshing', n1: 'not_requested' };
    const mechanics = {
      ...runtime(new Set()),
      view: vi.fn((input: { vacancyId: string }) => ({ state: states[input.vacancyId] })),
      fitJobHoldsKey: vi.fn(() => false),
    };
    const slot = vi.fn(() => true);
    await requestFitForVacancyIds({ vacancyMechanics: mechanics } as never, 'candidate', ['r1', 'n1'], 0, {}, slot);
    expect(mechanics.enqueue).toHaveBeenCalledWith({ vacancyId: 'r1' }, { backgroundRank: 0 });
    expect(mechanics.enqueue).toHaveBeenCalledWith({ vacancyId: 'n1' }, { backgroundRank: 1, reviveSlot: slot });
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
