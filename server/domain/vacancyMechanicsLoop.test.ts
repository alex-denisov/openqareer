import { describe, expect, it } from 'vitest';
import { runVacancyMechanicsStep } from './vacancyMechanicsLoop';

function busyError() {
  return Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
}

describe('runVacancyMechanicsStep', () => {
  it('waits out a database held by another writer instead of crashing the worker', async () => {
    const waits: number[] = [];
    const result = await runVacancyMechanicsStep(
      async () => {
        throw busyError();
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    expect(result).toBe('busy');
    expect(waits).toEqual([5_000]);
  });

  it('idles a second when the queue is empty and keeps going when a job ran', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    expect(await runVacancyMechanicsStep(async () => true, sleep)).toBe('processed');
    expect(await runVacancyMechanicsStep(async () => false, sleep)).toBe('idle');
    expect(waits).toEqual([1_000]);
  });

  it('rethrows anything that is not a busy database', async () => {
    await expect(
      runVacancyMechanicsStep(
        async () => {
          throw new Error('boom');
        },
        async () => undefined,
      ),
    ).rejects.toThrow('boom');
  });
});
