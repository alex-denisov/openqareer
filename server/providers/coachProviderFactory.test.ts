import { describe, expect, it } from 'vitest';
import { buildCoachProvider } from './coachProviderFactory';
import { allowedModels, PROVIDER_IDS } from './modelRegistry';

describe('coach provider factory', () => {
  it('constructs every connector that has a cutoff-safe model', () => {
    for (const provider of PROVIDER_IDS.filter((id) => allowedModels(id).length > 0)) {
      expect(
        buildCoachProvider({
          provider,
          apiKey: 'test-key-that-is-never-sent',
        }),
      ).toBeDefined();
    }
  });

  it('fails closed when a provider exposes only a rolling model alias', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'yandex',
        apiKey: 'test-key-that-is-never-sent',
        folderId: 'test-folder',
      }),
    ).toThrow('model is not allowed for provider yandex');
  });

  it('rejects a model newer than the release cutoff', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'gemini',
        apiKey: 'test-key-that-is-never-sent',
        model: 'gemini-3.6-flash',
      }),
    ).toThrow('model is not allowed for provider gemini');
  });
});
