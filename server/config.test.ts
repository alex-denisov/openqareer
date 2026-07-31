import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config';

const validEnvironment = {
  OPENQAREER_OPENAI_API_KEY: 'test-api-key-that-is-long-enough',
  OPENQAREER_OPENROUTER_API_KEY:
    'test-openrouter-key-that-is-long-enough',
  OPENQAREER_PREVIEW_API_TOKEN:
    'test-preview-token-that-is-at-least-thirty-two-characters',
  OPENQAREER_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
};

describe('server configuration', () => {
  it('binds only to localhost and enforces the model quality floor', () => {
    expect(readServerConfig(validEnvironment, import.meta.url)).toMatchObject({
      host: '127.0.0.1',
      port: 3210,
      model: 'gpt-5.6-sol',
      release: 'local',
      databasePath: 'data/openqareer.db',
    });

    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_HOST: '0.0.0.0',
        },
        import.meta.url,
      ),
    ).toThrow();
    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_AI_MODEL: 'gpt-5-mini',
        },
        import.meta.url,
      ),
    ).toThrow();
  });

  it('fails fast when either server-side secret is absent', () => {
    expect(() =>
      readServerConfig(
        {
          OPENQAREER_OPENAI_API_KEY:
            validEnvironment.OPENQAREER_OPENAI_API_KEY,
        },
        import.meta.url,
      ),
    ).toThrow();
  });
});
