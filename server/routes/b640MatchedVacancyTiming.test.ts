import { afterEach, describe, expect, it } from 'vitest';
import { createB640Harness, poolItem } from '../testHelpers/b640VacancyHarness';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe('b640-matched-timing: шаги списка b640 в журнале (B770)', () => {
  it('собранный список пишет шаги и фазы, следующий из кэша — без фаз', async () => {
    const logLines: string[] = [];
    const harness = await createB640Harness({
      pool: () => [poolItem({ id: 'cluster-1', title: 'Инженер данных', company: 'Альфа' })],
      logLines,
    });
    closers.push(harness.close);
    const url = '/api/v1/candidate/b640/matched-vacancies';
    expect((await harness.get(url, 'flagged.test')).statusCode).toBe(200);
    expect((await harness.get(url, 'flagged.test')).statusCode).toBe(200);

    const timings = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === 'b640-matched-timing');
    expect(timings).toHaveLength(2);
    expect(timings[0]).toMatchObject({
      served: 'built',
      setupMs: expect.any(Number),
      snapshotMs: expect.any(Number),
      listReadMs: expect.any(Number),
      orderMs: expect.any(Number),
      phasesMs: expect.objectContaining({
        finish: expect.any(Number),
        filters: expect.any(Number),
      }),
    });
    expect(timings[1]).toMatchObject({ served: 'fresh' });
    expect(timings[1]).not.toHaveProperty('phasesMs');
  });
});
