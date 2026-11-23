import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleSkillAssessmentCurrent } from './roleSkillAssessmentApi';
import {
  COUNTING_ATTEMPTS,
  COUNTING_INTERVAL_MS,
  readUntilCounted,
} from './roleSkillAssessmentCounting';

const counting: RoleSkillAssessmentCurrent = { state: 'counting' };
const ready = { state: 'role_not_selected' } as RoleSkillAssessmentCurrent;

afterEach(() => vi.useRealTimers());

describe('readUntilCounted: «Считаем вакансии роли…» спрашивает сам (B770)', () => {
  it('пока считаем — показывает это на месте и спрашивает снова через 3 с', async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockResolvedValueOnce(counting)
      .mockResolvedValueOnce(counting)
      .mockResolvedValue(ready);
    const shown: RoleSkillAssessmentCurrent[] = [];
    const done = readUntilCounted(read, (current) => shown.push(current));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(shown).toEqual([counting]);
    await vi.advanceTimersByTimeAsync(COUNTING_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(COUNTING_INTERVAL_MS);
    await expect(done).resolves.toBe(ready);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('после 10 ответов «считаем» — обычная ошибка, дальше не спрашивает', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(counting);
    const done = readUntilCounted(read, () => undefined);
    const failed = expect(done).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(COUNTING_INTERVAL_MS * (COUNTING_ATTEMPTS + 2));
    await failed;
    expect(read).toHaveBeenCalledTimes(COUNTING_ATTEMPTS);
  });

  it('ответ без «считаем» отдаётся сразу', async () => {
    const read = vi.fn().mockResolvedValue(ready);
    const shown: unknown[] = [];
    await expect(readUntilCounted(read, (current) => shown.push(current))).resolves.toBe(ready);
    expect(shown).toEqual([]);
  });
});
