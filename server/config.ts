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

declare const __OPENQAREER_RELEASE__: string;

const supportedModels = ['gpt-5.6', 'gpt-5.6-sol'] as const;

const configSchema = z.object({
  OPENQAREER_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  OPENQAREER_PORT: z.coerce.number().int().min(1).max(65_535).default(3_210),
  OPENQAREER_OPENAI_API_KEY: z.string().min(20).optional(),
  OPENQAREER_OPENROUTER_API_KEY: z.string().min(20).optional(),
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
  OPENQAREER_AI_MODEL: z.enum(supportedModels).default('gpt-5.6-sol'),
  OPENQAREER_PERSONAL_AI_PROVIDER: z.enum(PROVIDER_IDS).default('openai'),
  OPENQAREER_PERSONAL_AI_MODEL: z.string().min(1).optional(),
  OPENQAREER_SYNTHETIC_AI_PROVIDER: z
    .enum(PROVIDER_IDS)
    .default('openrouter'),
  OPENQAREER_SYNTHETIC_AI_MODEL: z.string().min(1).optional(),
  OPENQAREER_STATIC_ROOT: z.string().min(1).optional(),
  OPENQAREER_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info'])
    .default('info'),
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
});

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  openAIKey?: string;
  openRouterKey?: string;
  previewToken: string;
  dataEncryptionKey: Buffer;
  databasePath: string;
  model: string;
  personalProvider?: ProviderId;
  syntheticProvider?: ProviderId;
  syntheticModel?: string;
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
    typeof __OPENQAREER_RELEASE__ === 'undefined'
      ? 'local'
      : __OPENQAREER_RELEASE__;
  const secureCookies = environment.NODE_ENV === 'production';
  const seedAccounts = [
    seedAccount(
      parsed.OPENQAREER_ADMIN_USERNAME,
      parsed.OPENQAREER_ADMIN_PASSWORD,
      'admin',
    ),
    seedAccount(
      parsed.OPENQAREER_TEST_CANDIDATE_USERNAME,
      parsed.OPENQAREER_TEST_CANDIDATE_PASSWORD,
      'candidate',
    ),
  ].filter((account) => account !== null);
  if (
    new Set(seedAccounts.map((account) => account.username.toLowerCase()))
      .size !== seedAccounts.length
  ) {
    throw new Error('seed account usernames must be unique');
  }

  return {
    host: parsed.OPENQAREER_HOST,
    port: parsed.OPENQAREER_PORT,
    openAIKey: parsed.OPENQAREER_OPENAI_API_KEY,
    openRouterKey: parsed.OPENQAREER_OPENROUTER_API_KEY,
    previewToken: parsed.OPENQAREER_PREVIEW_API_TOKEN,
    dataEncryptionKey: parsed.OPENQAREER_DATA_ENCRYPTION_KEY,
    databasePath: parsed.OPENQAREER_DATABASE_PATH,
    model: personalRoute.model,
    personalProvider: personalRoute.provider,
    syntheticProvider: syntheticRoute.provider,
    syntheticModel: syntheticRoute.model,
    providerCredentials,
    yandexFolderId: environment.OPENQAREER_YANDEX_FOLDER_ID?.trim(),
    staticRoot:
      parsed.OPENQAREER_STATIC_ROOT ??
      dirname(fileURLToPath(moduleUrl)),
    release: builtRelease,
    logLevel: parsed.OPENQAREER_LOG_LEVEL,
    secureCookies,
    allowedOrigins: secureCookies
      ? ['https://openqareer.com']
      : ['http://127.0.0.1:3000', 'http://localhost:3000'],
    seedAccounts,
    providerCatalogStatus: getProviderCatalogStatus(environment),
  };
}

function readProviderCredentials(
  environment: NodeJS.ProcessEnv,
): Partial<Record<ProviderId, string>> {
  return Object.fromEntries(
    PROVIDER_IDS.flatMap((provider) => {
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
