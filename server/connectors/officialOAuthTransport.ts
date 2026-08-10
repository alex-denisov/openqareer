import { z } from 'zod';
import type { OAuthConnectionInput } from '../data/candidateStore';
import type { OAuthTransport } from './oauthConnector';
import { OAuthConnectorError } from './oauthConnector';

const MAX_RESPONSE_BYTES = 512 * 1_024;
const REQUEST_TIMEOUT_MS = 15_000;

const linkedInTokenSchema = z.object({
  access_token: z.string().min(20).max(16_384),
  expires_in: z.number().int().positive().max(366 * 24 * 60 * 60),
  scope: z.string().max(2_048).optional(),
});

const linkedInUserInfoSchema = z.object({
  sub: z.string().min(1).max(1_024),
  name: z.string().min(1).max(500).optional(),
  given_name: z.string().min(1).max(250).optional(),
  family_name: z.string().min(1).max(250).optional(),
});

const hhTokenSchema = z.object({
  access_token: z.string().min(20).max(16_384),
  refresh_token: z.string().min(20).max(16_384).nullable().optional(),
  expires_in: z.number().int().positive().max(366 * 24 * 60 * 60),
});

const hhMeSchema = z.object({
  id: z.string().min(1).max(1_024),
  auth_type: z.string().max(100).nullable().optional(),
  is_applicant: z.boolean(),
  resumes_url: z.string().url().max(2_048),
});

const hhResumeListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(256),
        updated_at: z.string().max(100).optional(),
      }),
    )
    .max(50),
});

const hhResumeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/u).max(256),
  title: z.string().max(500).nullable().optional(),
  alternate_url: z.string().url().max(2_048).nullable().optional(),
  experience: z
    .array(
      z.object({
        position: z.string().max(500),
        company: z.string().max(500).nullable().optional(),
        start: z.string().max(50).optional(),
        end: z.string().max(50).nullable().optional(),
      }),
    )
    .max(50)
    .default([]),
  skill_set: z.array(z.string().max(200)).max(100).nullable().optional(),
});

export class OfficialOAuthTransport implements OAuthTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
  } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async connect(
    input: Parameters<OAuthTransport['connect']>[0],
  ): Promise<OAuthConnectionInput> {
    return input.platform === 'linkedin'
      ? this.connectLinkedIn(input)
      : this.connectHh(input);
  }

  private async connectLinkedIn(
    input: Parameters<OAuthTransport['connect']>[0],
  ): Promise<OAuthConnectionInput> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.provider.clientId,
      client_secret: input.provider.clientSecret,
      redirect_uri: input.provider.redirectUri,
    });
    const token = await requestJson(
      this.fetchImpl,
      'https://www.linkedin.com/oauth/v2/accessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      linkedInTokenSchema,
      'provider_oauth_failed',
    );
    const profile = await requestJson(
      this.fetchImpl,
      'https://api.linkedin.com/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
      linkedInUserInfoSchema,
      'provider_profile_unavailable',
    );
    const capturedAt = this.now();
    const displayName =
      profile.name?.trim() ||
      [profile.given_name, profile.family_name].filter(Boolean).join(' ').trim();
    return {
      platform: 'linkedin',
      externalAccountId: profile.sub,
      scopes: normalizeScopes(token.scope ?? 'openid profile'),
      capabilities: ['lite_identity'],
      accessToken: token.access_token,
      refreshToken: null,
      accessTokenExpiresAt: new Date(
        capturedAt.getTime() + token.expires_in * 1_000,
      ).toISOString(),
      profile: {
        capturedAt: capturedAt.toISOString(),
        sourceUrl: null,
        facts: displayName
          ? [
              {
                kind: 'summary',
                value: displayName,
                sourceLocator: 'linkedin:oidc:name',
                confidence: 'official-api',
              },
            ]
          : [],
      },
    };
  }

  private async connectHh(
    input: Parameters<OAuthTransport['connect']>[0],
  ): Promise<OAuthConnectionInput> {
    const token = await requestJson(
      this.fetchImpl,
      'https://api.hh.ru/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          code_verifier: input.codeVerifier,
          client_id: input.provider.clientId,
          client_secret: input.provider.clientSecret,
          redirect_uri: input.provider.redirectUri,
        }).toString(),
      },
      hhTokenSchema,
      'provider_oauth_failed',
    );
    const apiHeaders = {
      Authorization: `Bearer ${token.access_token}`,
      'User-Agent': 'OpenQareer/1.0 (https://openqareer.com)',
    };
    const me = await requestJson(
      this.fetchImpl,
      'https://api.hh.ru/me',
      { headers: apiHeaders },
      hhMeSchema,
      'provider_profile_unavailable',
    );
    if (
      !me.is_applicant ||
      me.auth_type === 'employer' ||
      me.resumes_url !== 'https://api.hh.ru/resumes/mine'
    ) {
      throw new OAuthConnectorError(
        'provider_profile_unavailable',
        502,
        false,
      );
    }
    const resumeList = await requestJson(
      this.fetchImpl,
      'https://api.hh.ru/resumes/mine',
      { headers: apiHeaders },
      hhResumeListSchema,
      'provider_profile_unavailable',
    );
    const resumeReference = resumeList.items[0];
    const resume = resumeReference
      ? await requestJson(
          this.fetchImpl,
          `https://api.hh.ru/resumes/${encodeURIComponent(resumeReference.id)}`,
          { headers: apiHeaders },
          hhResumeSchema,
          'provider_profile_unavailable',
        )
      : null;
    const capturedAt = this.now();
    return {
      platform: 'hh',
      externalAccountId: me.id,
      scopes: ['profile_read', 'resume_read'],
      capabilities: ['profile_read', 'resume_read'],
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      accessTokenExpiresAt: new Date(
        capturedAt.getTime() + token.expires_in * 1_000,
      ).toISOString(),
      profile: {
        capturedAt: capturedAt.toISOString(),
        sourceUrl: resume ? allowedHhResumeUrl(resume.alternate_url) : null,
        facts: resume ? hhResumeFacts(resume) : [],
      },
    };
  }
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  errorCode: 'provider_oauth_failed' | 'provider_profile_unavailable',
): Promise<T> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new OAuthConnectorError(errorCode, 502, response.status >= 500);
    }
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new OAuthConnectorError(errorCode, 502, false);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new OAuthConnectorError(errorCode, 502, false);
    }
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof OAuthConnectorError) throw error;
    throw new OAuthConnectorError(errorCode, 502, true);
  }
}

function normalizeScopes(value: string): string[] {
  return [...new Set(value.split(/[ ,]+/u).filter((scope) => /^[a-z_]+$/u.test(scope)))]
    .slice(0, 20)
    .sort();
}

function allowedHhResumeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      (host === 'hh.ru' || host.endsWith('.hh.ru')) &&
      /^\/resume\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function hhResumeFacts(
  resume: z.infer<typeof hhResumeSchema>,
): OAuthConnectionInput['profile']['facts'] {
  const facts: OAuthConnectionInput['profile']['facts'] = [];
  const title = resume.title?.trim();
  if (title) {
    facts.push({
      kind: 'headline',
      value: title,
      sourceLocator: `hh:resume:${resume.id}:title`,
      confidence: 'official-api',
    });
  }
  resume.experience.slice(0, 20).forEach((experience, index) => {
    const parts = [
      experience.position.trim(),
      experience.company?.trim(),
      experience.start
        ? `${experience.start} — ${experience.end ?? 'сейчас'}`
        : undefined,
    ].filter((part): part is string => Boolean(part));
    if (!parts.length) return;
    facts.push({
      kind: 'summary',
      value: parts.join(' · ').slice(0, 1_500),
      sourceLocator: `hh:resume:${resume.id}:experience:${index + 1}`,
      confidence: 'official-api',
    });
  });
  const skills = resume.skill_set
    ?.map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 30);
  if (skills?.length) {
    facts.push({
      kind: 'summary',
      value: `Навыки: ${skills.join(', ')}`.slice(0, 1_500),
      sourceLocator: `hh:resume:${resume.id}:skills`,
      confidence: 'official-api',
    });
  }
  return facts;
}
