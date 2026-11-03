import { describe, expect, it, vi } from 'vitest';

vi.mock('./vacancyFitContext', () => ({
  readVacancyFitTarget: (_deps: unknown, id: string) => ({ id }),
  createVacancyFitContextReader: () => (target: { id: string }) => ({ vacancyId: target.id }),
}));

const { requestFitForShownPage } = await import('./matchedVacancyFit');

function item(id: string, state: string) {
  return { cluster: { id }, explanation: { fitView: { state } } } as never;
}

describe('fit queue for the shown page (PRB-041: a 100-row page queued every row in one piece, 1.3–6 s)', () => {
  it('queues each row still awaiting a percent once', async () => {
    const enqueue = vi.fn();

    await requestFitForShownPage({ vacancyMechanics: { enqueue } } as never, 'candidate', [
      item('a', 'not_requested'),
      item('b', 'ready'),
      item('c', 'failed'),
    ]);

    expect(enqueue.mock.calls).toEqual([[{ vacancyId: 'a' }], [{ vacancyId: 'c' }]]);
  });

  it('lets queued requests run between rows once a slice is spent', async () => {
    const order: string[] = [];
    const enqueue = vi.fn((input: { vacancyId: string }) =>
      order.push(`enqueue:${input.vacancyId}`),
    );
    const clock = [0, 0, 20];
    const now = () => clock.shift() ?? 20;
    setImmediate(() => order.push('turn'));

    await requestFitForShownPage(
      { vacancyMechanics: { enqueue } } as never,
      'candidate',
      [item('a', 'not_requested'), item('b', 'not_requested')],
      { sliceMs: 10, now },
    );

    expect(order).toEqual(['enqueue:a', 'turn', 'enqueue:b']);
  });
});
