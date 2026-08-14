import { describe, expect, it } from 'vitest';
import {
  MODEL_RELEASE_CUTOFF,
  PROVIDER_IDS,
  getProviderCatalogStatus,
  isModelAllowed,
  isMutableModelAlias,
  modelRegistry,
} from './modelRegistry';

describe('LLM provider and model registry', () => {
  it('covers every provider connector available in eTerapy', () => {
    expect(PROVIDER_IDS).toEqual([
      'openai',
      'anthropic',
      'fireworks',
      'openrouter',
      'gemini',
      'groq',
      'mistral',
      'cerebras',
      'cohere',
      'yandex',
      'kilocode',
      'nvidia',
      'opencode_zen',
      'tokenrouter',
      'sambanova',
      'pollinations',
      'huggingface',
    ]);
    expect(Object.keys(modelRegistry)).toEqual(PROVIDER_IDS);
  });

  it('allows only pinned models released by the June 2026 cutoff', () => {
    for (const provider of PROVIDER_IDS) {
      for (const model of modelRegistry[provider].models) {
        expect(isModelAllowed(model)).toBe(
          model.pinned &&
            model.releaseDate !== null &&
            model.releaseDate <= MODEL_RELEASE_CUTOFF &&
            !isMutableModelAlias(model.id),
        );
      }
    }

    expect(
      isModelAllowed({
        id: 'gemini-3.6-flash',
        releaseDate: '2026-07-21',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: true,
      }),
    ).toBe(false);
    expect(
      isModelAllowed({
        id: 'some-model-latest',
        releaseDate: '2026-05-01',
        pinned: false,
        lifecycle: 'production',
        structuredOutput: true,
      }),
    ).toBe(false);
  });

  it.each([
    'openrouter/free',
    'openrouter/auto',
    'yandexgpt/latest',
    'yandexgpt',
    'yandexgpt-lite/latest',
    'yandexgpt-32k',
    'openai',
    'mistral',
    'claude-hybrid',
  ])('rejects mutable routing alias %s even when metadata claims it is pinned', (id) => {
    expect(
      isModelAllowed({
        id,
        releaseDate: '2024-01-01',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: false,
      }),
    ).toBe(false);
  });

  it('reports only configured state and never credential values', () => {
    const environment = {
      OPENQAREER_OPENAI_API_KEY: 'secret-openai-value',
      OPENQAREER_ANTHROPIC_API_KEY: '',
      OPENQAREER_YANDEX_API_KEY: 'secret-yandex-value',
      OPENQAREER_YANDEX_FOLDER_ID: '',
    };
    const status = getProviderCatalogStatus(environment);
    const serialized = JSON.stringify(status);

    expect(status.find((item) => item.id === 'openai')).toMatchObject({
      configured: true,
      eligible: true,
    });
    expect(status.find((item) => item.id === 'anthropic')).toMatchObject({
      configured: false,
      eligible: true,
    });
    expect(status.find((item) => item.id === 'yandex')).toMatchObject({
      configured: false,
      eligible: false,
      reason: 'no-cutoff-safe-model',
    });
    expect(serialized).not.toContain('secret-openai-value');
    expect(serialized).not.toContain('secret-yandex-value');

    const fullyConfiguredEnv = {
      OPENQAREER_OPENAI_API_KEY: 'secret-openai-value',
      OPENQAREER_YANDEX_API_KEY: 'secret-yandex-value',
      OPENQAREER_YANDEX_FOLDER_ID: 'secret-yandex-folder',
    };
    const readyStatus = getProviderCatalogStatus(fullyConfiguredEnv);
    expect(readyStatus.find((item) => item.id === 'yandex')).toMatchObject({
      configured: true,
      eligible: false,
      reason: 'no-cutoff-safe-model',
    });
  });
});
