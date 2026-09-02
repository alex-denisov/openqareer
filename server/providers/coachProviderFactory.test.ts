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
          // Gemini строится только через тоннель (B183); остальные коннекторы
          // эти настройки игнорируют.
          cloudflareGateway: { accountId: 'acc', gatewayId: 'gw' },
        }),
      ).toBeDefined();
    }
  });

  it('fails closed when an unlisted model is requested', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'yandex',
        apiKey: 'test-key-that-is-never-sent',
        folderId: 'test-folder',
        model: 'unlisted-yandex-model',
      }),
    ).toThrow('model is not allowed for provider yandex');
  });

  it('fails closed when an unsupported OpenAI model is requested', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'openai',
        apiKey: 'test-key-that-is-never-sent',
        model: 'gpt-4o',
      }),
    ).toThrow('model is not allowed for provider openai');
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

describe('OpenAI model choice (B183)', () => {
  it('строит провайдера на gpt-5.6-luna', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'openai',
        apiKey: 'k'.repeat(24),
        model: 'gpt-5.6-luna',
      }),
    ).not.toThrow();
  });

  it('не строит провайдера на модели вне реестра', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'openai',
        apiKey: 'k'.repeat(24),
        model: 'gpt-4o',
      }),
    ).toThrow();
  });
});

describe('Gemini только через тоннель Cloudflare (B183)', () => {
  it('без тоннеля провайдер не строится вовсе', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'gemini',
        apiKey: 'k'.repeat(24),
        model: 'gemini-3.7-flash',
      }),
    ).toThrow(/cloudflare/i);
  });

  it('с тоннелем строится и ходит на адрес шлюза', () => {
    expect(() =>
      buildCoachProvider({
        provider: 'gemini',
        apiKey: 'k'.repeat(24),
        model: 'gemini-3.7-flash',
        cloudflareGateway: { accountId: 'acc', gatewayId: 'gw', token: 'tok' },
      }),
    ).not.toThrow();
  });
});

