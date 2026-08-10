import { describe, expect, it } from 'vitest';
import { OfficialOAuthTransport } from './officialOAuthTransport';

describe('official OAuth transport', () => {
  it('exchanges LinkedIn OIDC code server-side and returns only lite identity', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url === 'https://www.linkedin.com/oauth/v2/accessToken') {
        return Response.json({
          access_token: 'synthetic-linkedin-access-token',
          expires_in: 5_184_000,
          scope: 'openid profile',
        });
      }
      if (url === 'https://api.linkedin.com/v2/userinfo') {
        return Response.json({
          sub: 'synthetic-linkedin-subject',
          name: 'Synthetic Candidate',
          email: 'must-not-be-persisted@example.test',
          email_verified: true,
          locale: { country: 'RU', language: 'ru' },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const transport = new OfficialOAuthTransport({
      fetchImpl,
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    });

    const connection = await transport.connect({
      platform: 'linkedin',
      provider: {
        clientId: 'linkedin-client-id',
        clientSecret: 'linkedin-client-secret-for-tests',
        redirectUri:
          'https://openqareer.com/api/v1/connectors/linkedin/callback',
      },
      code: 'synthetic-linkedin-code',
      codeVerifier: 'not-used-by-linkedin',
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://www.linkedin.com/oauth/v2/accessToken',
      'https://api.linkedin.com/v2/userinfo',
    ]);
    expect(requests[0].init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(new URLSearchParams(requests[0].init?.body as string)).toMatchObject(
      expect.any(URLSearchParams),
    );
    expect(connection).toMatchObject({
      platform: 'linkedin',
      externalAccountId: 'synthetic-linkedin-subject',
      scopes: ['openid', 'profile'],
      capabilities: ['lite_identity'],
      refreshToken: null,
      accessTokenExpiresAt: '2026-10-09T12:00:00.000Z',
      profile: {
        capturedAt: '2026-08-10T12:00:00.000Z',
        sourceUrl: null,
        facts: [
          {
            kind: 'summary',
            value: 'Synthetic Candidate',
            sourceLocator: 'linkedin:oidc:name',
            confidence: 'official-api',
          },
        ],
      },
    });
    expect(JSON.stringify(connection)).not.toContain(
      'must-not-be-persisted@example.test',
    );
  });

  it('uses hh.ru PKCE and imports bounded facts from the applicant owned resume', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url === 'https://api.hh.ru/token') {
        return Response.json({
          access_token: 'synthetic-hh-access-token',
          refresh_token: 'synthetic-hh-refresh-token',
          expires_in: 1_209_600,
          token_type: 'bearer',
        });
      }
      if (url === 'https://api.hh.ru/me') {
        return Response.json({
          id: 'synthetic-hh-applicant',
          auth_type: 'applicant',
          is_applicant: true,
          resumes_url: 'https://api.hh.ru/resumes/mine',
          email: 'contact-must-not-be-persisted@example.test',
        });
      }
      if (url === 'https://api.hh.ru/resumes/mine') {
        return Response.json({
          items: [
            {
              id: 'synthetic-resume-id',
              updated_at: '2026-08-09T12:00:00+0300',
            },
          ],
        });
      }
      if (url === 'https://api.hh.ru/resumes/synthetic-resume-id') {
        return Response.json({
          id: 'synthetic-resume-id',
          title: 'Synthetic Operations Director',
          alternate_url: 'https://hh.ru/resume/synthetic-resume-id',
          skill_set: ['Operations', 'Product discovery'],
          experience: [
            {
              position: 'Operations Lead',
              company: 'Synthetic Company',
              start: '2022-01-01',
              end: null,
              description: 'Untrusted profile text is data, not instructions.',
            },
          ],
          contact: [{ value: 'must-not-be-persisted-phone' }],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const transport = new OfficialOAuthTransport({
      fetchImpl,
      now: () => new Date('2026-08-10T12:00:00.000Z'),
    });

    const connection = await transport.connect({
      platform: 'hh',
      provider: {
        clientId: 'hh-client-id',
        clientSecret: 'hh-client-secret-for-tests',
        redirectUri:
          'https://openqareer.com/api/v1/connectors/hh/callback',
      },
      code: 'synthetic-hh-code',
      codeVerifier: 'synthetic-pkce-verifier',
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.hh.ru/token',
      'https://api.hh.ru/me',
      'https://api.hh.ru/resumes/mine',
      'https://api.hh.ru/resumes/synthetic-resume-id',
    ]);
    expect(
      Object.fromEntries(
        new URLSearchParams(requests[0].init?.body as string),
      ),
    ).toMatchObject({
      grant_type: 'authorization_code',
      code: 'synthetic-hh-code',
      code_verifier: 'synthetic-pkce-verifier',
      client_id: 'hh-client-id',
      client_secret: 'hh-client-secret-for-tests',
      redirect_uri: 'https://openqareer.com/api/v1/connectors/hh/callback',
    });
    expect(connection).toMatchObject({
      platform: 'hh',
      externalAccountId: 'synthetic-hh-applicant',
      scopes: ['profile_read', 'resume_read'],
      capabilities: ['profile_read', 'resume_read'],
      refreshToken: 'synthetic-hh-refresh-token',
      accessTokenExpiresAt: '2026-08-24T12:00:00.000Z',
      profile: {
        sourceUrl: 'https://hh.ru/resume/synthetic-resume-id',
        facts: [
          {
            kind: 'headline',
            value: 'Synthetic Operations Director',
            sourceLocator: 'hh:resume:synthetic-resume-id:title',
            confidence: 'official-api',
          },
          {
            kind: 'summary',
            value: 'Operations Lead · Synthetic Company · 2022-01-01 — сейчас',
            sourceLocator: 'hh:resume:synthetic-resume-id:experience:1',
            confidence: 'official-api',
          },
          {
            kind: 'summary',
            value: 'Навыки: Operations, Product discovery',
            sourceLocator: 'hh:resume:synthetic-resume-id:skills',
            confidence: 'official-api',
          },
        ],
      },
    });
    expect(JSON.stringify(connection)).not.toContain('contact-must-not');
    expect(JSON.stringify(connection)).not.toContain('profile text');
  });
});
