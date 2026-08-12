import { describe, expect, it } from 'vitest';
import { selectSyntheticProviderRoutes } from './syntheticProviderRoutes';

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
