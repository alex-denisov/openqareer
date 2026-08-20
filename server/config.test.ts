import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config';

const validEnvironment = {
  OPENQAREER_OPENAI_API_KEY: 'test-api-key-that-is-long-enough',
  OPENQAREER_OPENROUTER_API_KEY: 'test-openrouter-key-that-is-long-enough',
  OPENQAREER_PREVIEW_API_TOKEN: 'test-preview-token-that-is-at-least-thirty-two-characters',
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
          OPENQAREER_OPENAI_API_KEY: validEnvironment.OPENQAREER_OPENAI_API_KEY,
        },
        import.meta.url,
      ),
    ).toThrow();
  });

  it('enables secure production cookies and only explicit seed accounts', () => {
    const config = readServerConfig(
      {
        ...validEnvironment,
        NODE_ENV: 'production',
        OPENQAREER_ADMIN_USERNAME: 'admin.test',
        OPENQAREER_ADMIN_PASSWORD: 'admin-password-for-tests',
        OPENQAREER_TEST_CANDIDATE_USERNAME: 'candidate.test',
        OPENQAREER_TEST_CANDIDATE_PASSWORD: 'candidate-password-for-tests',
      },
      import.meta.url,
    );
    expect(config).toMatchObject({
      secureCookies: true,
      allowedOrigins: expect.arrayContaining(['https://openqareer.com', 'tauri://localhost']),
      seedAccounts: [
        { username: 'admin.test', role: 'admin' },
        { username: 'candidate.test', role: 'candidate' },
      ],
    });

    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_ADMIN_USERNAME: 'admin-without-password',
        },
        import.meta.url,
      ),
    ).toThrow();
  });

  it('selects another configured provider only with an allowed fixed model', () => {
    const config = readServerConfig(
      {
        ...validEnvironment,
        OPENQAREER_PERSONAL_AI_PROVIDER: 'anthropic',
        OPENQAREER_PERSONAL_AI_MODEL: 'claude-fable-5',
        OPENQAREER_ANTHROPIC_API_KEY: 'test-anthropic-key-that-is-long-enough',
      },
      import.meta.url,
    );
    expect(config).toMatchObject({
      personalProvider: 'anthropic',
      model: 'claude-fable-5',
      syntheticProvider: 'openrouter',
    });

    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_PERSONAL_AI_PROVIDER: 'gemini',
          OPENQAREER_PERSONAL_AI_MODEL: 'gemini-3.6-flash',
          OPENQAREER_GEMINI_API_KEY: 'test-gemini-key-that-is-long-enough',
        },
        import.meta.url,
      ),
    ).toThrow('model is not allowed for provider gemini');
  });

  it('enables OAuth providers only from complete server-side configuration', () => {
    expect(readServerConfig(validEnvironment, import.meta.url)).toMatchObject({
      oauthProviders: {},
    });

    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_HH_CLIENT_ID: 'hh-client-id',
        },
        import.meta.url,
      ),
    ).toThrow('complete OAuth configuration is required for hh');

    expect(
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_HH_CLIENT_ID: 'hh-client-id',
          OPENQAREER_HH_CLIENT_SECRET: 'hh-client-secret-for-tests',
          OPENQAREER_HH_REDIRECT_URI: 'https://openqareer.com/api/v1/connectors/hh/callback',
        },
        import.meta.url,
      ).oauthProviders.hh,
    ).toEqual({
      clientId: 'hh-client-id',
      clientSecret: 'hh-client-secret-for-tests',
      redirectUri: 'https://openqareer.com/api/v1/connectors/hh/callback',
    });
  });

  it('treats a blank OAuth entry as an unconfigured provider', () => {
    expect(
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_LINKEDIN_CLIENT_ID: '',
          OPENQAREER_LINKEDIN_CLIENT_SECRET: '',
          OPENQAREER_LINKEDIN_REDIRECT_URI: '',
        },
        import.meta.url,
      ),
    ).toMatchObject({ oauthProviders: {} });
  });

  it('enables account email only from a complete Resend configuration', () => {
    expect(
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_RESEND_API_KEY: 're_openqareer_key_that_is_long_enough',
          OPENQAREER_ACCOUNT_EMAIL_FROM: 'openqareer <noreply@openqareer.com>',
          OPENQAREER_PUBLIC_URL: 'https://openqareer.com',
        },
        import.meta.url,
      ).accountEmail,
    ).toEqual({
      apiKey: 're_openqareer_key_that_is_long_enough',
      from: 'openqareer <noreply@openqareer.com>',
      publicBaseUrl: 'https://openqareer.com',
    });

    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_RESEND_API_KEY: 're_openqareer_key_that_is_long_enough',
        },
        import.meta.url,
      ),
    ).toThrow('complete account email configuration is required');
  });

  it('never reuses an unscoped Resend credential for account email', () => {
    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          RESEND_API_KEY: 're_other_product_key_that_is_long_enough',
          OPENQAREER_ACCOUNT_EMAIL_FROM: 'openqareer <noreply@openqareer.com>',
          OPENQAREER_PUBLIC_URL: 'https://openqareer.com',
        },
        import.meta.url,
      ),
    ).toThrow('complete account email configuration is required');
  });

  it('publishes desktop tunnel credentials only from a complete server-side set', () => {
    expect(readServerConfig(validEnvironment, import.meta.url).desktopTunnel).toBeUndefined();

    expect(() =>
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_DESKTOP_TUNNEL_SERVER: 'openqareer.com',
        },
        import.meta.url,
      ),
    ).toThrow('complete desktop tunnel configuration is required');

    expect(
      readServerConfig(
        {
          ...validEnvironment,
          OPENQAREER_DESKTOP_TUNNEL_SERVER: 'openqareer.com',
          OPENQAREER_DESKTOP_TUNNEL_PORT: '443',
          OPENQAREER_DESKTOP_TUNNEL_SSH_USER: 'openqareer-tunnel',
          OPENQAREER_DESKTOP_TUNNEL_SSH_PRIVATE_KEY_BASE64: Buffer.from(
            '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
          ).toString('base64'),
          OPENQAREER_DESKTOP_TUNNEL_SSH_HOST_KEY_BASE64: Buffer.from(
            'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticHostKeyForTests',
          ).toString('base64'),
          OPENQAREER_DESKTOP_TUNNEL_PROXY_USERNAME: 'synthetic_user',
          OPENQAREER_DESKTOP_TUNNEL_PROXY_PASSWORD: 'synthetic-password-that-is-long-enough',
        },
        import.meta.url,
      ).desktopTunnel,
    ).toEqual({
      remoteServer: 'openqareer.com',
      remotePort: 443,
      sshUser: 'openqareer-tunnel',
      sshPrivateKeyBase64: Buffer.from(
        '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
      ).toString('base64'),
      sshHostKeyBase64: Buffer.from(
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticHostKeyForTests',
      ).toString('base64'),
      proxyUsername: 'synthetic_user',
      proxyPassword: 'synthetic-password-that-is-long-enough',
      localSocksPort: 10885,
      localHttpPort: 10886,
    });
  });
});
