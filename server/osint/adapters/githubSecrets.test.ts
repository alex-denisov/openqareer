import { describe, expect, it } from 'vitest';
import { FootprintSourceError } from './footprintAdapter';
import { GithubSecretsAdapter } from './githubSecrets';

interface MockFetchOptions {
  readonly repos?: Array<{
    readonly name: string;
    readonly default_branch?: string;
    readonly html_url?: string;
    readonly owner?: { readonly login: string };
  }>;
  readonly tree?: Array<{ readonly path: string; readonly type: string; readonly size?: number }>;
  readonly files?: Record<string, string>;
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly bodyText?: string;
}

function createMockFetch(options: MockFetchOptions): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = String(input);

    if (options.status && options.status >= 400) {
      const headers = new Headers(options.headers ?? {});
      return new Response(options.bodyText ?? 'Error', {
        status: options.status,
        headers,
      });
    }

    if (url.includes('/users/') && url.includes('/repos')) {
      const repos = options.repos ?? [
        {
          name: 'demo-repo',
          default_branch: 'main',
          html_url: 'https://github.com/octocat/demo-repo',
          owner: { login: 'octocat' },
        },
      ];
      return new Response(JSON.stringify(repos), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('/git/trees/')) {
      const tree = options.tree ?? [];
      return new Response(JSON.stringify({ tree }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('raw.githubusercontent.com')) {
      for (const [filePath, content] of Object.entries(options.files ?? {})) {
        if (url.endsWith(`/${filePath}`)) {
          return new Response(content, { status: 200 });
        }
      }
      return new Response('Not found', { status: 404 });
    }

    return new Response('{}', { status: 200 });
  };
}

describe('githubSecretsAdapter', () => {
  it('detects AWS, GitHub, API key, Slack, and private key secrets without leaking values', async () => {
    // Поддельные токены склеены из частей: целиком они блокируются защитой пушей GitHub
    const rawAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const rawGhp = ['ghp', '_1234567890abcdefghijklmnopqrstuvwxyz'].join('');
    const rawSk = ['sk', '-live_1234567890abcdefghijklmnopqr'].join('');
    const rawSlack = ['xo', 'xb-123456789012-345678901234-abcdefghijklmnopqrstuvwx'].join('');
    const rawPrivKey = '-----BEGIN RSA PRIVATE KEY-----';

    const fileContent = [
      `AWS_ACCESS_KEY_ID=${rawAws}`,
      `GITHUB_TOKEN=${rawGhp}`,
      `OPENAI_API_KEY=${rawSk}`,
      `SLACK_BOT_TOKEN=${rawSlack}`,
      `${rawPrivKey}`,
      'MIIEowIBAAKCAQEA0',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    const mockFetch = createMockFetch({
      tree: [{ path: 'server/config.ts', type: 'blob', size: 500 }],
      files: { 'server/config.ts': fileContent },
    });

    const adapter = new GithubSecretsAdapter(mockFetch);
    const findings = await adapter.run({ username: 'octocat' });

    expect(findings.length).toBe(5);

    const secretValues = [rawAws, rawGhp, rawSk, rawSlack, rawPrivKey];
    for (const finding of findings) {
      expect(finding.kind).toBe('secret');
      expect(finding.match).toBe('likely_self');
      expect(finding.url).toContain('https://github.com/octocat/demo-repo/blob/main/server/config.ts#L');

      for (const secret of secretValues) {
        expect(finding.detail).not.toContain(secret);
        expect(finding.title).not.toContain(secret);
      }
    }

    expect(findings.some((f) => f.title.includes('ключ AWS'))).toBe(true);
    expect(findings.some((f) => f.title.includes('токен GitHub'))).toBe(true);
    expect(findings.some((f) => f.title.includes('секретный ключ API (sk-*)'))).toBe(true);
    expect(findings.some((f) => f.title.includes('токен Slack'))).toBe(true);
    expect(findings.some((f) => f.title.includes('приватный криптографический ключ'))).toBe(true);
  });

  it('detects internal corporate domain references', async () => {
    const fileContent = [
      'const internalApi = "https://auth-service.prod.corp/api/v1";',
      'const clusterDb = "http://postgres-main.internal:5432";',
      'const devHost = "https://k8s-node.cluster.local/status";',
    ].join('\n');

    const mockFetch = createMockFetch({
      tree: [{ path: 'src/endpoints.json', type: 'blob', size: 300 }],
      files: { 'src/endpoints.json': fileContent },
    });

    const adapter = new GithubSecretsAdapter(mockFetch);
    const findings = await adapter.run({ username: 'octocat' });

    expect(findings.length).toBe(3);
    for (const finding of findings) {
      expect(finding.title).toContain('внутренний корпоративный домен');
      expect(finding.detail).toContain('Риск: высокий.');
    }
  });

  it('detects root .env files as critical findings without leaking their content', async () => {
    const envContent = 'DATABASE_URL=postgres://user:super_secret_password@db:5432/main';
    const mockFetch = createMockFetch({
      tree: [
        { path: '.env', type: 'blob', size: 100 },
        { path: '.env.production', type: 'blob', size: 120 },
      ],
      files: {
        '.env': envContent,
        '.env.production': envContent,
      },
    });

    const adapter = new GithubSecretsAdapter(mockFetch);
    const findings = await adapter.run({ username: 'octocat' });

    const envFindings = findings.filter((f) => f.title.includes('Обнаружен файл переменных окружения'));
    expect(envFindings.length).toBe(2);

    for (const finding of envFindings) {
      expect(finding.detail).toContain('Риск: критический.');
      expect(finding.detail).not.toContain('super_secret_password');
      expect(finding.title).not.toContain('super_secret_password');
    }
  });

  it('handles rate limits (403 with x-ratelimit-remaining: 0) and throws FootprintSourceError', async () => {
    const mockFetch = createMockFetch({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      bodyText: 'API rate limit exceeded',
    });

    const adapter = new GithubSecretsAdapter(mockFetch);
    await expect(adapter.run({ username: 'octocat' })).rejects.toThrow(
      'лимит GitHub, повторите через час',
    );

    try {
      await adapter.run({ username: 'octocat' });
    } catch (err) {
      expect(err).toBeInstanceOf(FootprintSourceError);
      const sourceErr = err as FootprintSourceError;
      expect(sourceErr.source).toBe('github');
      expect(sourceErr.retryable).toBe(true);
    }
  });

  it('handles HTTP 429 status and throws rate limit error', async () => {
    const mockFetch = createMockFetch({
      status: 429,
      bodyText: 'Too Many Requests',
    });

    const adapter = new GithubSecretsAdapter(mockFetch);
    await expect(adapter.run({ username: 'octocat' })).rejects.toThrow(
      'лимит GitHub, повторите через час',
    );
  });

  it('returns empty array when username is empty string', async () => {
    const adapter = new GithubSecretsAdapter();
    const findings = await adapter.run({ username: '   ' });
    expect(findings).toEqual([]);
  });

  it('honors abort signal', async () => {
    const mockFetch = createMockFetch({
      tree: [{ path: 'server/app.ts', type: 'blob', size: 200 }],
      files: { 'server/app.ts': 'console.log("hello");' },
    });

    const adapter = new GithubSecretsAdapter(mockFetch);
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.run({ username: 'octocat' }, controller.signal)).rejects.toThrow(
      'Операция отменена',
    );
  });
});
