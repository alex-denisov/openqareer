import { describe, expect, it, vi } from 'vitest';
import { collectMatchedPool, withDeadline } from './vacancyRead';

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

/**
 * Пул приходит страницами (INC-029). Сбор обязан дойти до конца, остановиться
 * на честном месте, если страница не пришла, и не крутиться бесконечно.
 */
describe('collectMatchedPool', () => {
  const page = (offset: number, size: number, total: number) => {
    const count = Math.max(0, Math.min(size, total - offset));
    return {
      items: Array.from({ length: count }, (_, index) => `item-${offset + index}`),
      total,
      nextOffset: offset + count < total ? offset + count : null,
    };
  };

  it('склеивает страницы до конца пула', async () => {
    const result = await collectMatchedPool<string>(async (offset) => page(offset, 20, 50));
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(50);
    expect(result.complete).toBe(true);
  });

  it('сохраняет прочитанное, если следующая страница не пришла', async () => {
    const result = await collectMatchedPool<string>(async (offset) => {
      if (offset > 0) throw new Error('network');
      return page(0, 20, 50);
    });
    expect(result.items).toHaveLength(20);
    expect(result.total).toBe(50);
    expect(result.complete).toBe(false);
  });

  it('первая непрочитанная страница — это отказ, а не пустой пул', async () => {
    await expect(
      collectMatchedPool<string>(async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
  });

  it('отдаёт каждую страницу сразу, а не в конце чтения', async () => {
    // 524 записи приходят полусотней страниц: экран, который ждёт последнюю,
    // двенадцать секунд показывает «Читаем пул…» вместо вакансий.
    const seen: number[] = [];
    await collectMatchedPool<string>(
      async (offset) => page(offset, 20, 60),
      60,
      (items) => seen.push(items.length),
    );
    expect(seen).toEqual([20, 20, 20]);
  });

  it('не читает больше отведённого числа страниц', async () => {
    let calls = 0;
    const result = await collectMatchedPool<string>(async (offset) => {
      calls += 1;
      return page(offset, 10, 10_000);
    }, 5);
    expect(calls).toBe(5);
    expect(result.items).toHaveLength(50);
    expect(result.complete).toBe(false);
  });
});
