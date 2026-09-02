import { describe, expect, it } from 'vitest';
import { queueFallbackDescriptors, selectProviderQueue } from './providerQueue';

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
