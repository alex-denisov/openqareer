import { describe, expect, it } from 'vitest';
import {
  selectSyntheticProviderRoutes,
  syntheticFallbackProviderIds,
} from './syntheticProviderRoutes';

describe('selectSyntheticProviderRoutes', () => {
  it('keeps the selected provider first and adds every configured eligible fallback once', () => {
    const routes = selectSyntheticProviderRoutes({
      selectedProvider: 'openrouter',
      selectedModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      credentials: {
        openrouter: 'openrouter-key-that-is-long-enough',
        nvidia: 'nvidia-key-that-is-long-enough',
        cerebras: 'cerebras-key-that-is-long-enough',
        pollinations: 'pollinations-key-that-is-long-enough',
      },
    });

    expect(routes.map((route) => route.provider)).toEqual([
      'openrouter',
      'cerebras',
      'nvidia',
    ]);
    expect(routes[0].model).toBe(
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    );
  });
});

/**
 * B183. Владелец: Gemini первым, пул `openrouter/free` — вторым. Порядок
 * остальных провайдеров задан реестром и поставил бы вторым `openai`, поэтому
 * второй приоритет должен называться явно, а не выводиться из порядка списка.
 */
describe('явный второй приоритет (B183)', () => {
  it('ставит названный запасной маршрут сразу после выбранного', () => {
    const routes = selectSyntheticProviderRoutes({
      selectedProvider: 'gemini',
      selectedModel: 'gemini-3.8-flash',
      fallbacks: [{ provider: 'openrouter', model: 'openrouter/free' }],
      credentials: {
        gemini: 'gemini-key-that-is-long-enough',
        openrouter: 'openrouter-key-that-is-long-enough',
        openai: 'openai-key-that-is-long-enough',
        cerebras: 'cerebras-key-that-is-long-enough',
      },
    });

    expect(routes.slice(0, 2)).toEqual([
      { provider: 'gemini', apiKey: 'gemini-key-that-is-long-enough', model: 'gemini-3.8-flash' },
      {
        provider: 'openrouter',
        apiKey: 'openrouter-key-that-is-long-enough',
        model: 'openrouter/free',
      },
    ]);
    expect(routes.filter((route) => route.provider === 'openrouter')).toHaveLength(1);
  });

  it('не выдумывает маршрут, если запасной провайдер не настроен', () => {
    const routes = selectSyntheticProviderRoutes({
      selectedProvider: 'gemini',
      selectedModel: 'gemini-3.8-flash',
      fallbacks: [{ provider: 'openrouter', model: 'openrouter/free' }],
      credentials: { gemini: 'gemini-key-that-is-long-enough' },
    });

    expect(routes.map((route) => route.provider)).toEqual(['gemini']);
  });

  it('отвергает запасную модель, не разрешённую реестром', () => {
    const routes = selectSyntheticProviderRoutes({
      selectedProvider: 'gemini',
      selectedModel: 'gemini-3.8-flash',
      fallbacks: [{ provider: 'openrouter', model: 'openrouter/auto' }],
      credentials: {
        gemini: 'gemini-key-that-is-long-enough',
        openrouter: 'openrouter-key-that-is-long-enough',
      },
    });

    expect(routes.map((route) => route.provider)).toEqual(['gemini']);
  });
});

/**
 * B183. `/api/v1/provider/status` перечислял запасные маршруты по порядку
 * каталога, а не по тому, в каком порядке их на самом деле пробует сервер:
 * после включения Gemini он показывал «openai, openrouter», хотя вторым идёт
 * openrouter. Отчёт должен считаться той же функцией, что и маршрутизация.
 */
describe('отчёт о запасных маршрутах (B183)', () => {
  it('перечисляет их в том же порядке, в каком сервер их пробует', () => {
    expect(
      syntheticFallbackProviderIds({
        selectedProvider: 'gemini',
        selectedModel: 'gemini-3.8-flash',
        fallbacks: [{ provider: 'openrouter', model: 'openrouter/free' }],
        credentials: {
          gemini: 'gemini-key-that-is-long-enough',
          openrouter: 'openrouter-key-that-is-long-enough',
          openai: 'openai-key-that-is-long-enough',
        },
      }),
    ).toEqual(['openrouter', 'openai']);
  });
});
