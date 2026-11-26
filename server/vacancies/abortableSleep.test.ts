import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableSleep } from './abortableSleep';

afterEach(() => vi.useRealTimers());

describe('пауза обхода, прерываемая остановкой (B759)', () => {
  it('без отмены ждёт полный срок', async () => {
    vi.useFakeTimers();
    let done = false;
    void abortableSleep(1_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('отмена заканчивает паузу сразу', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let done = false;
    void abortableSleep(60_000, controller.signal).then(() => (done = true));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('уже отменённый сигнал — пауза не начинается', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(60_000, controller.signal)).resolves.toBeUndefined();
  });
});
