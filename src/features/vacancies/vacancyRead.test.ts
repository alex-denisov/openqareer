import { describe, expect, it, vi } from 'vitest';
import { withDeadline } from './vacancyRead';

/**
 * Прод отдал заголовки `200` и не отдал тело: экран висел на «Читаем пул…»
 * дольше трёх минут. Ожидание обязано кончаться.
 */
describe('withDeadline', () => {
  it('прерывает чтение, которое не ответило в срок', async () => {
    vi.useFakeTimers();
    const started = withDeadline(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      50,
    );
    const settled = expect(started).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(60);
    await settled;
    vi.useRealTimers();
  });

  it('не трогает ответ, пришедший вовремя', async () => {
    await expect(withDeadline(async () => 'ok', 1_000)).resolves.toBe('ok');
  });
});
