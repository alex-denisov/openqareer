import { describe, expect, it, vi } from 'vitest';
import { MATCHED_POOL_READ_WIDTH, collectMatchedPool, withDeadline } from './vacancyRead';

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

/**
 * Шестьдесят страниц — шестьдесят кругов по каналу подряд, 73 секунды на вход
 * и шестьдесят шансов словить обрыв INC-036 (PRB-023). Названные сервером
 * смещения читаются волнами, а не по одному.
 */
describe('collectMatchedPool со списком смещений (B211)', () => {
  const PAGE = 4;
  const TOTAL = 52;
  const offsets = Array.from({ length: Math.ceil(TOTAL / PAGE) }, (_, i) => i * PAGE);

  function planned(offset: number) {
    const count = Math.max(0, Math.min(PAGE, TOTAL - offset));
    return {
      items: Array.from({ length: count }, (_, index) => `item-${offset + index}`),
      total: TOTAL,
      nextOffset: offset + count < TOTAL ? offset + count : null,
      ...(offset === 0 ? { pageOffsets: offsets } : {}),
    };
  }

  it('держит в полёте не больше пяти запросов и читает пул целиком по порядку', async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await collectMatchedPool<string>(async (offset) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return planned(offset);
    });
    expect(peak).toBeLessThanOrEqual(MATCHED_POOL_READ_WIDTH);
    expect(peak).toBeGreaterThan(1);
    expect(result.items).toEqual(Array.from({ length: TOTAL }, (_, i) => `item-${i}`));
    expect(result.complete).toBe(true);
    expect(result.total).toBe(TOTAL);
  });

  it('не ждёт ответа, чтобы попросить следующую страницу', async () => {
    // Прежнее чтение узнавало смещение только из предыдущего ответа: 13 страниц
    // = 13 кругов по каналу подряд. Со списком смещений следующие пять уходят,
    // не дожидаясь ни одного из них.
    const pending: Array<() => void> = [];
    const asked: number[] = [];
    const read = collectMatchedPool<string>(
      (offset) =>
        new Promise((resolve) => {
          asked.push(offset);
          if (offset === 0) {
            resolve(planned(0));
            return;
          }
          pending.push(() => resolve(planned(offset)));
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toHaveLength(1 + MATCHED_POOL_READ_WIDTH);
    while (pending.length > 0) {
      pending.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await read;
    expect(asked).toHaveLength(offsets.length);
  });

  it('отказ одной страницы не отменяет остальных и не выдаётся за полный пул', async () => {
    const broken = offsets[3];
    const result = await collectMatchedPool<string>(async (offset) => {
      if (offset === broken) throw new Error('network');
      return planned(offset);
    });
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(TOTAL - PAGE);
    expect(result.items).not.toContain(`item-${broken}`);
    // Прочитанное после провалившейся страницы не теряется.
    expect(result.items).toContain(`item-${TOTAL - 1}`);
  });

  it('соблюдает потолок страниц и в параллельном чтении', async () => {
    let calls = 0;
    const result = await collectMatchedPool<string>(async (offset) => {
      calls += 1;
      return planned(offset);
    }, 5);
    expect(calls).toBe(5);
    expect(result.items).toHaveLength(5 * PAGE);
    expect(result.complete).toBe(false);
  });
});
