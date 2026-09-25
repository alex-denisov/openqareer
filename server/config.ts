import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  allowedModels,
  getProviderCatalogStatus,
  modelRegistry,
  PROVIDER_IDS,
  type ProviderCatalogStatus,
  type ProviderId,
} from './providers/modelRegistry';
import {
  readCloudflareGatewayConfig,
  type CloudflareGatewayConfig,
} from './providers/cloudflareAiGateway';
import type { ProviderQueueEntry } from './providers/providerQueue';

declare const __OPENQAREER_RELEASE__: string;

const supportedModels = ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-luna'] as const;

const configSchema = z.object({
  OPENQAREER_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  OPENQAREER_PORT: z.coerce.number().int().min(1).max(65_535).default(3_210),
  OPENQAREER_OPENAI_API_KEY: z.string().min(20).optional(),
  OPENQAREER_OPENROUTER_API_KEY: z.string().min(20).optional(),
  // Empty placeholders in the env file mean «not configured yet» (B266).
  OPENQAREER_TELEGRAM_BOT_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/u).optional(),
  ),
  OPENQAREER_TELEGRAM_OWNER_CHAT_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^-?\d{3,20}$/u).optional(),
  ),
  OPENQAREER_PREVIEW_API_TOKEN: z.string().min(32),
  OPENQAREER_DATA_ENCRYPTION_KEY: z.string().transform((value, context) => {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32) {
      context.addIssue({
        code: 'custom',
        message: 'data encryption key must decode to 32 bytes',
      });
      return z.NEVER;
    }
    return decoded;
  }),
  OPENQAREER_DATABASE_PATH: z.string().min(1).default('data/openqareer.db'),
  OPENQAREER_LINKEDIN_RUNTIME_ROOT: blankAsUnset(z.string().min(1).max(1_024)),
  OPENQAREER_AI_MODEL: z.enum(supportedModels).default('gpt-5.6-sol'),
  OPENQAREER_PERSONAL_AI_PROVIDER: z.enum(PROVIDER_IDS).default('openai'),
  OPENQAREER_PERSONAL_AI_MODEL: z.string().min(1).optional(),
  OPENQAREER_SYNTHETIC_AI_PROVIDER: z.enum(PROVIDER_IDS).default('openrouter'),
  OPENQAREER_SYNTHETIC_AI_MODEL: z.string().min(1).optional(),
  OPENQAREER_SYNTHETIC_AI_FALLBACK: blankAsUnset(z.string().min(1).max(512)),
  OPENQAREER_PERSONAL_AI_FALLBACK: blankAsUnset(z.string().min(1).max(512)),
  OPENQAREER_STATIC_ROOT: z.string().min(1).optional(),
  OPENQAREER_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info']).default('info'),
  OPENQAREER_ADMIN_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/)
    .optional(),
  OPENQAREER_ADMIN_PASSWORD: z.string().min(16).max(256).optional(),
  OPENQAREER_TEST_CANDIDATE_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/)
    .optional(),
  OPENQAREER_TEST_CANDIDATE_PASSWORD: z.string().min(16).max(256).optional(),
  OPENQAREER_RESEND_API_KEY: blankAsUnset(z.string().min(10).max(2_048)),
  OPENQAREER_ACCOUNT_EMAIL_FROM: blankAsUnset(z.string().min(3).max(320)),
  OPENQAREER_PUBLIC_URL: blankAsUnset(z.string().url().max(2_048)),
  OPENQAREER_DESKTOP_TUNNEL_SERVER: blankAsUnset(
    z
      .string()
      .min(1)
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/),
  ),
  OPENQAREER_DESKTOP_TUNNEL_PORT: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().min(1).max(65_535).optional(),
  ),
  OPENQAREER_DESKTOP_TUNNEL_SSH_USER: blankAsUnset(z.string().regex(/^[a-z_][a-z0-9_-]{2,31}$/)),
  OPENQAREER_DESKTOP_TUNNEL_SSH_PRIVATE_KEY_BASE64: blankAsUnset(
    z
      .string()
      .min(80)
      .max(16_384)
      .regex(/^[A-Za-z0-9+/=]+$/),
  ),
  OPENQAREER_DESKTOP_TUNNEL_SSH_HOST_KEY_BASE64: blankAsUnset(
    z
      .string()
      .min(40)
      .max(4_096)
      .regex(/^[A-Za-z0-9+/=]+$/),
  ),
  OPENQAREER_DESKTOP_TUNNEL_PROXY_USERNAME: blankAsUnset(
    z.string().regex(/^[A-Za-z0-9_-]{12,64}$/),
  ),
  OPENQAREER_DESKTOP_TUNNEL_PROXY_PASSWORD: blankAsUnset(z.string().min(32).max(128)),
});

/**
 * A blank entry in `.env` means the operator has not configured this value.
 * Treating it as unset keeps the all-or-none provider rule honest instead of
 * failing startup on a template line.
 */
function blankAsUnset(schema: z.ZodString) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  openAIKey?: string;
  openRouterKey?: string;
  /** B266: owner alerts (plan requests). Both unset → alerts are silently off. */
  telegramBotToken?: string;
  telegramOwnerChatId?: string;
  previewToken: string;
  dataEncryptionKey: Buffer;
  databasePath: string;
  /** Encrypted browser runtime root; must be outside the repository in production. */
  linkedinRuntimeRoot?: string;
  model: string;
  personalProvider?: ProviderId;
  syntheticProvider?: ProviderId;
  syntheticModel?: string;
  /** Названные владельцем запасные ступени очереди по порядку (B183). */
  syntheticFallbacks?: readonly ProviderQueueEntry[];
  personalFallbacks?: readonly ProviderQueueEntry[];
  providerCredentials?: Partial<Record<ProviderId, string>>;
  yandexFolderId?: string;
  staticRoot: string;
  release: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info';
  secureCookies: boolean;
  allowedOrigins: string[];
  seedAccounts: Array<{
    username: string;
    password: string;
    role: 'candidate' | 'admin';
  }>;
  providerCatalogStatus?: ProviderCatalogStatus[];
  /** Тоннель Cloudflare для Gemini (B183). */
  cloudflareGateway?: CloudflareGatewayConfig;
  accountEmail?: {
    apiKey: string;
    from: string;
    publicBaseUrl: string;
  };
  desktopTunnel?: DesktopTunnelConfig;
}

interface DesktopTunnelConfig {
  remoteServer: string;
  remotePort: number;
  sshUser: string;
  sshPrivateKeyBase64: string;
  sshHostKeyBase64: string;
  proxyUsername: string;
  proxyPassword: string;
  localSocksPort: number;
  localHttpPort: number;
}

export function readServerConfig(
  environment: NodeJS.ProcessEnv,
  moduleUrl: string = import.meta.url,
): ServerConfig {
  const parsed = configSchema.parse(environment);
  const providerCredentials = readProviderCredentials(environment);
  const personalRoute = resolveProviderRoute({
    provider: parsed.OPENQAREER_PERSONAL_AI_PROVIDER,
    requestedModel:
      parsed.OPENQAREER_PERSONAL_AI_MODEL ??
      (parsed.OPENQAREER_PERSONAL_AI_PROVIDER === 'openai'
        ? parsed.OPENQAREER_AI_MODEL
        : undefined),
    providerCredentials,
  });
  const syntheticRoute = resolveProviderRoute({
    provider: parsed.OPENQAREER_SYNTHETIC_AI_PROVIDER,
    requestedModel:
      parsed.OPENQAREER_SYNTHETIC_AI_MODEL ??
      (parsed.OPENQAREER_SYNTHETIC_AI_PROVIDER === 'openrouter'
        ? 'nvidia/nemotron-3-ultra-550b-a55b:free'
        : undefined),
    providerCredentials,
  });
  const builtRelease =
    typeof __OPENQAREER_RELEASE__ === 'undefined' ? 'local' : __OPENQAREER_RELEASE__;
  const secureCookies = environment.NODE_ENV === 'production';
  const seedAccounts = [
    seedAccount(parsed.OPENQAREER_ADMIN_USERNAME, parsed.OPENQAREER_ADMIN_PASSWORD, 'admin'),
    seedAccount(
      parsed.OPENQAREER_TEST_CANDIDATE_USERNAME,
      parsed.OPENQAREER_TEST_CANDIDATE_PASSWORD,
      'candidate',
    ),
  ].filter((account) => account !== null);
  if (
    new Set(seedAccounts.map((account) => account.username.toLowerCase())).size !==
    seedAccounts.length
  ) {
    throw new Error('seed account usernames must be unique');
  }
  const resendApiKey = parsed.OPENQAREER_RESEND_API_KEY;
  const accountEmailValues = [
    resendApiKey,
    parsed.OPENQAREER_ACCOUNT_EMAIL_FROM,
    parsed.OPENQAREER_PUBLIC_URL,
  ];
  const accountEmail = accountEmailValues.every((value) => value === undefined)
    ? undefined
    : accountEmailValues.every((value) => value !== undefined)
      ? {
          apiKey: resendApiKey!,
          from: parsed.OPENQAREER_ACCOUNT_EMAIL_FROM!,
          publicBaseUrl: parsed.OPENQAREER_PUBLIC_URL!,
        }
      : (() => {
          throw new Error('complete account email configuration is required');
        })();
  const desktopTunnelValues = [
    parsed.OPENQAREER_DESKTOP_TUNNEL_SERVER,
    parsed.OPENQAREER_DESKTOP_TUNNEL_PORT,
    parsed.OPENQAREER_DESKTOP_TUNNEL_SSH_USER,
    parsed.OPENQAREER_DESKTOP_TUNNEL_SSH_PRIVATE_KEY_BASE64,
    parsed.OPENQAREER_DESKTOP_TUNNEL_SSH_HOST_KEY_BASE64,
    parsed.OPENQAREER_DESKTOP_TUNNEL_PROXY_USERNAME,
    parsed.OPENQAREER_DESKTOP_TUNNEL_PROXY_PASSWORD,
  ];
  const desktopTunnel = desktopTunnelValues.every((value) => value === undefined)
    ? undefined
    : desktopTunnelValues.every((value) => value !== undefined)
      ? {
          remoteServer: parsed.OPENQAREER_DESKTOP_TUNNEL_SERVER!,
          remotePort: parsed.OPENQAREER_DESKTOP_TUNNEL_PORT!,
          sshUser: parsed.OPENQAREER_DESKTOP_TUNNEL_SSH_USER!,
          sshPrivateKeyBase64: parsed.OPENQAREER_DESKTOP_TUNNEL_SSH_PRIVATE_KEY_BASE64!,
          sshHostKeyBase64: parsed.OPENQAREER_DESKTOP_TUNNEL_SSH_HOST_KEY_BASE64!,
          proxyUsername: parsed.OPENQAREER_DESKTOP_TUNNEL_PROXY_USERNAME!,
          proxyPassword: parsed.OPENQAREER_DESKTOP_TUNNEL_PROXY_PASSWORD!,
          localSocksPort: 10_885,
          localHttpPort: 10_886,
        }
      : (() => {
          throw new Error('complete desktop tunnel configuration is required');
        })();

  return {
    host: parsed.OPENQAREER_HOST,
    port: parsed.OPENQAREER_PORT,
    openAIKey: parsed.OPENQAREER_OPENAI_API_KEY,
    openRouterKey: parsed.OPENQAREER_OPENROUTER_API_KEY,
    telegramBotToken: parsed.OPENQAREER_TELEGRAM_BOT_TOKEN,
    telegramOwnerChatId: parsed.OPENQAREER_TELEGRAM_OWNER_CHAT_ID,
    previewToken: parsed.OPENQAREER_PREVIEW_API_TOKEN,
    dataEncryptionKey: parsed.OPENQAREER_DATA_ENCRYPTION_KEY,
    databasePath: parsed.OPENQAREER_DATABASE_PATH,
    linkedinRuntimeRoot: parsed.OPENQAREER_LINKEDIN_RUNTIME_ROOT,
    model: personalRoute.model,
    personalProvider: personalRoute.provider,
    syntheticProvider: syntheticRoute.provider,
    syntheticModel: syntheticRoute.model,
    syntheticFallbacks: parseProviderQueue(parsed.OPENQAREER_SYNTHETIC_AI_FALLBACK),
    personalFallbacks: parseProviderQueue(parsed.OPENQAREER_PERSONAL_AI_FALLBACK),
    providerCredentials,
    yandexFolderId: environment.OPENQAREER_YANDEX_FOLDER_ID?.trim(),
    staticRoot: parsed.OPENQAREER_STATIC_ROOT ?? dirname(fileURLToPath(moduleUrl)),
    release: builtRelease,
    logLevel: parsed.OPENQAREER_LOG_LEVEL,
    secureCookies,
    allowedOrigins: secureCookies
      ? [
          'https://openqareer.com',
          'tauri://localhost',
          'http://tauri.localhost',
          'https://tauri.localhost',
        ]
      : [
          'http://127.0.0.1:3000',
          'http://localhost:3000',
          'http://127.0.0.1:1420',
          'http://localhost:1420',
          'tauri://localhost',
          'http://tauri.localhost',
          'https://tauri.localhost',
        ],
    seedAccounts,
    providerCatalogStatus: getProviderCatalogStatus(environment),
    cloudflareGateway: readCloudflareGatewayConfig(environment),
    accountEmail,
    desktopTunnel,
  };
}

/**
 * `provider:model` через запятую, по порядку приоритета. Идентификаторы
 * моделей сами содержат `:` (`nvidia/nemotron-…:free`), поэтому делим по
 * **первому** двоеточию. Нераспознанный провайдер — ошибка запуска, а не молча
 * пропущенная ступень: владелец должен узнать об опечатке сразу.
 *
 * Одного провайдера можно назвать дважды с разными моделями: очередь состоит
 * из моделей (B183).
 */
export function parseProviderQueue(
  value: string | undefined,
): readonly ProviderQueueEntry[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separator = entry.indexOf(':');
      const provider = (separator === -1 ? entry : entry.slice(0, separator)).trim();
      const model = separator === -1 ? undefined : entry.slice(separator + 1).trim();
      if (!(PROVIDER_IDS as readonly string[]).includes(provider)) {
        throw new Error(`unknown synthetic fallback provider ${provider}`);
      }
      return { provider: provider as ProviderId, ...(model ? { model } : {}) };
    });
}

function readProviderCredentials(
  environment: NodeJS.ProcessEnv,
): Partial<Record<ProviderId, string>> {
  const gateway = readCloudflareGatewayConfig(environment);
  return Object.fromEntries(
    PROVIDER_IDS.flatMap((provider) => {
      // Решение владельца 2026-09-02: Gemini ходит только через тоннель
      // Cloudflare. Без тоннеля ключ есть, а маршрута нет — честнее считать
      // провайдера ненастроенным, чем настроенным и молча неработающим.
      if (provider === 'gemini' && !gateway) return [];
      const credentialName = modelRegistry[provider].credentialEnvironment[0];
      const credential = environment[credentialName]?.trim();
      return credential ? [[provider, credential]] : [];
    }),
  );
}

function resolveProviderRoute(input: {
  provider: ProviderId;
  requestedModel?: string;
  providerCredentials: Partial<Record<ProviderId, string>>;
}): { provider: ProviderId; model: string } {
  const credential = input.providerCredentials[input.provider];
  if (!credential || credential.length < 20) {
    throw new Error(`credential is required for provider ${input.provider}`);
  }
  const eligibleModels = allowedModels(input.provider);
  const model = input.requestedModel ?? eligibleModels[0]?.id;
  if (!model || !eligibleModels.some((item) => item.id === model)) {
    throw new Error(`model is not allowed for provider ${input.provider}`);
  }
  return { provider: input.provider, model };
}

function seedAccount(
  username: string | undefined,
  password: string | undefined,
  role: 'candidate' | 'admin',
): {
  username: string;
  password: string;
  role: 'candidate' | 'admin';
} | null {
  if (username === undefined && password === undefined) {
    return null;
  }
  if (!username || !password) {
    throw new Error(`both ${role} seed credentials are required`);
  }
  return { username, password, role };
}
