import { describe, expect, it } from 'vitest';
import {
  namedQueueDepth,
  queueFallbackDescriptors,
  selectProviderQueue,
} from './providerQueue';
import { LAST_PROVIDER_STAGE_TIMEOUT_MS, queueStageTimeoutMs } from './stageTimeout';

const credentials = {
  gemini: 'gemini-key-that-is-long-enough',
  openrouter: 'openrouter-key-that-is-long-enough',
  openai: 'openai-key-that-is-long-enough',
  cerebras: 'cerebras-key-that-is-long-enough',
};

/**
 * Владелец 2026-09-02: «поставь первым gemini-3.8-flash, вторым
 * nvidia/nemotron-3-ultra, а openrouter/free третьим… чтобы не падал весь пул,
 * а лишь очередь переходила к другой модели с тем же запросом».
 *
 * Обе модели OpenRouter живут за одним провайдером, поэтому очередь обязана
 * состоять из моделей, а не из провайдеров.
 */
describe('очередь моделей (B183)', () => {
  const head = { provider: 'gemini', model: 'gemini-3.8-flash' } as const;
  const fallbacks = [
    { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    { provider: 'openrouter', model: 'openrouter/free' },
  ] as const;

  it('держит названный порядок, включая двух разных моделей одного провайдера', () => {
    expect(
      selectProviderQueue({ head, fallbacks, credentials }).slice(0, 3),
    ).toEqual([
      { provider: 'gemini', apiKey: credentials.gemini, model: 'gemini-3.8-flash' },
      {
        provider: 'openrouter',
        apiKey: credentials.openrouter,
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      },
      { provider: 'openrouter', apiKey: credentials.openrouter, model: 'openrouter/free' },
    ]);
  });

  it('дальше идут остальные настроенные провайдеры — очередь не обрывается', () => {
    const queue = selectProviderQueue({ head, fallbacks, credentials });
    expect(queue.length).toBeGreaterThan(3);
    expect(queue.slice(3).map((route) => route.provider)).toContain('openai');
  });

  it('не повторяет одну и ту же модель дважды', () => {
    const queue = selectProviderQueue({
      head,
      fallbacks: [{ provider: 'gemini', model: 'gemini-3.8-flash' }, ...fallbacks],
      credentials,
    });
    const keys = queue.map((route) => `${route.provider}:${route.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ненастроенный провайдер выпадает из очереди, а не ломает её', () => {
    expect(
      selectProviderQueue({
        head,
        fallbacks,
        credentials: { gemini: credentials.gemini },
      }).map((route) => route.provider),
    ).toEqual(['gemini']);
  });

  it('модель вне реестра выбрасывает свою ступень, а не подставляет другую', () => {
    const queue = selectProviderQueue({
      head,
      fallbacks: [{ provider: 'openrouter', model: 'openrouter/auto' }],
      credentials,
    });
    expect(queue.map((route) => route.model)).not.toContain('openrouter/auto');
    expect(queue[0].model).toBe('gemini-3.8-flash');
  });

  it('отчёт о ступенях совпадает с очередью и называет модель, а не только провайдера', () => {
    expect(queueFallbackDescriptors({ head, fallbacks, credentials }).slice(0, 2)).toEqual([
      { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
      { provider: 'openrouter', model: 'openrouter/free' },
    ]);
  });
});

/**
 * B183. На проде очередь владельца из четырёх ступеней обрывалась на третьей:
 * потолок попыток стоял жёсткой тройкой, и последняя ступень — единственная
 * платная и надёжная — не пробовалась вовсе. Названное владельцем должно быть
 * испробовано целиком.
 */
describe('глубина очереди (B183)', () => {
  it('покрывает все названные ступени, а не первые три', () => {
    expect(
      namedQueueDepth({
        head: { provider: 'gemini', model: 'gemini-3.8-flash' },
        fallbacks: [
          { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
          { provider: 'openrouter', model: 'openrouter/free' },
          { provider: 'openai', model: 'gpt-5.6-luna' },
        ],
      }),
      // Четыре названных ступени плюс одна про запас: раньше жёсткая тройка
      // не давала дойти до последней, единственной надёжной.
    ).toBeGreaterThanOrEqual(4);
  });

  it('без названных запасных ступеней всё равно оставляет место одному запасу', () => {
    expect(namedQueueDepth({ head: { provider: 'openai' } })).toBeGreaterThan(1);
  });
});

/**
 * Решение владельца 28.10 («Да, убрать»): из очереди консультанта убраны три
 * бесплатные ступени — за две недели ни одного завершённого хода, только
 * `provider_unavailable`, а Gemini отвечает 402. Очереди ролей и писем не трогаются.
 */
describe('исключённые ступени очереди консультанта (28.10)', () => {
  const prodCredentials = {
    openrouter: 'openrouter-key-that-is-long-enough',
    gemini: 'gemini-key-that-is-long-enough',
    nvidia: 'nvidia-key-that-is-long-enough',
    openai: 'openai-key-that-is-long-enough',
  };
  const head = { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' } as const;
  const fallbacks = [
    { provider: 'openrouter', model: 'openrouter/free' },
    { provider: 'gemini', model: 'gemini-3.6-flash' },
    { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
    { provider: 'openai', model: 'gpt-5.6-luna' },
  ] as const;
  const excluded = [
    { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    { provider: 'openrouter', model: 'openrouter/free' },
    { provider: 'gemini' },
  ] as const;

  it('оставляет NVIDIA → OpenAI и не возвращает исключённого провайдера хвостом очереди', () => {
    const routes = selectProviderQueue({ head, fallbacks, credentials: prodCredentials, excluded });
    expect(routes.map((route) => `${route.provider}:${route.model}`)).toEqual([
      'nvidia:nvidia/nemotron-3-ultra-550b-a55b',
      'openai:gpt-5.6-luna',
    ]);
    // OpenAI остаётся последней ступенью и получает её потолок.
    expect(queueStageTimeoutMs(routes.length - 1, routes.length)).toBe(
      LAST_PROVIDER_STAGE_TIMEOUT_MS,
    );
  });

  it('без исключений очередь прежняя', () => {
    const routes = selectProviderQueue({ head, fallbacks, credentials: prodCredentials });
    expect(routes.map((route) => route.model)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'openrouter/free',
      'gemini-3.6-flash',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'gpt-5.6-luna',
    ]);
  });
});
