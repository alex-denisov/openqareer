import { createSign } from 'node:crypto';
import { z } from 'zod';

/**
 * Gemini на Vertex AI (решение владельца 2026-09-25: `gemini-3.8-flash`,
 * бонусные кредиты Vertex). Ключ AI Studio за шлюзом исчерпал предоплату
 * (402), а Vertex ходит под сервисным аккаунтом: токен OAuth выпускается по
 * подписанному JWT и живёт час.
 *
 * Ключ сервисного аккаунта лежит в окружении одной строкой base64
 * (`OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64`) — в коде и базе его нет.
 */

export const DEFAULT_VERTEX_MODEL = 'gemini-3.8-flash';
/** Модель доступна только на глобальном адресе (замер 25.09: регионы — 404). */
export const DEFAULT_VERTEX_LOCATION = 'global';

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

export interface VertexConfig {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
  readonly model: string;
  readonly location: string;
}

export function readVertexConfig(
  environment: Record<string, string | undefined>,
): VertexConfig | undefined {
  const encoded = environment.OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64?.trim();
  if (!encoded) return undefined;
  const parsed = serviceAccountSchema.safeParse(
    safeJson(Buffer.from(encoded, 'base64').toString('utf8')),
  );
  if (!parsed.success) {
    throw new Error('OPENQAREER_VERTEX_SERVICE_ACCOUNT_B64 is not a service account key');
  }
  return {
    projectId: parsed.data.project_id,
    clientEmail: parsed.data.client_email,
    privateKey: parsed.data.private_key,
    model: environment.OPENQAREER_VERTEX_MODEL?.trim() || DEFAULT_VERTEX_MODEL,
    location: environment.OPENQAREER_VERTEX_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Базовый адрес издателя: к нему добавляется `/models/<id>:generateContent`. */
export function vertexPublisherBaseUrl(config: VertexConfig): string {
  const host =
    config.location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${config.location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.projectId}/locations/${config.location}/publishers/google`;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_LIFETIME_S = 3600;
/** Токен обновляется за пять минут до конца, чтобы не отдать протухший. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function signedAssertion(config: VertexConfig, nowS: number): string {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: TOKEN_URL,
      iat: nowS,
      exp: nowS + TOKEN_LIFETIME_S,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(config.privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

/** Выпускает и кеширует токен доступа; параллельные вызовы ждут один запрос. */
export class VertexTokenProvider {
  private cached?: { token: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(
    private readonly config: VertexConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return this.cached.token;
    }
    this.pending ??= this.issue().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async issue(): Promise<string> {
    const assertion = signedAssertion(this.config, Math.floor(this.now() / 1000));
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !body.access_token) {
      throw new Error(`vertex token request failed with status ${response.status}`);
    }
    const lifetimeMs = (body.expires_in ?? TOKEN_LIFETIME_S) * 1000;
    this.cached = { token: body.access_token, expiresAt: this.now() + lifetimeMs };
    return body.access_token;
  }
}
