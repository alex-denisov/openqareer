import { describe, expect, it } from 'vitest';
import {
  assertOpenRouterModelForPersonalData,
  isFreeOpenRouterModel,
  openRouterRouting,
} from './openRouterPrivacy';

describe('OpenRouter и данные кандидатов (28.10)', () => {
  it('запрещает провайдерам сохранять и учиться на запросе', () => {
    expect(openRouterRouting({ personal: true })).toEqual({
      provider: { data_collection: 'deny' },
    });
    expect(openRouterRouting({ personal: true, requireParameters: true })).toEqual({
      provider: { data_collection: 'deny', require_parameters: true },
    });
    expect(openRouterRouting({ personal: false })).toEqual({});
    expect(openRouterRouting({ personal: false, requireParameters: true })).toEqual({
      provider: { require_parameters: true },
    });
  });

  it('узнаёт бесплатные модели и пулы', () => {
    expect(isFreeOpenRouterModel('nvidia/nemotron-3-ultra-550b-a55b:free')).toBe(true);
    expect(isFreeOpenRouterModel('openrouter/free')).toBe(true);
    expect(isFreeOpenRouterModel('openrouter/auto')).toBe(true);
    expect(isFreeOpenRouterModel('deepseek/deepseek-v4.1-flash')).toBe(false);
  });

  it('не пускает персональные данные в бесплатную модель', () => {
    expect(() => assertOpenRouterModelForPersonalData('openrouter/free')).toThrow(
      /free OpenRouter model/u,
    );
    expect(() => assertOpenRouterModelForPersonalData('z-ai/glm-5.3-flash')).not.toThrow();
  });
});
