import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

declare const __OPENQAREER_RELEASE__: string;

const supportedModels = ['gpt-5.6', 'gpt-5.6-sol'] as const;

const configSchema = z.object({
  OPENQAREER_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  OPENQAREER_PORT: z.coerce.number().int().min(1).max(65_535).default(3_210),
  OPENQAREER_OPENAI_API_KEY: z.string().min(20),
  OPENQAREER_OPENROUTER_API_KEY: z.string().min(20),
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
  OPENQAREER_STATIC_ROOT: z.string().min(1).optional(),
  OPENQAREER_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info'])
    .default('info'),
});

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  openAIKey: string;
  openRouterKey: string;
  previewToken: string;
  dataEncryptionKey: Buffer;
  databasePath: string;
  model: (typeof supportedModels)[number];
  staticRoot: string;
  release: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info';
}

export function readServerConfig(
  environment: NodeJS.ProcessEnv,
  moduleUrl: string = import.meta.url,
): ServerConfig {
  const parsed = configSchema.parse(environment);
  const builtRelease =
    typeof __OPENQAREER_RELEASE__ === 'undefined'
      ? 'local'
      : __OPENQAREER_RELEASE__;

  return {
    host: parsed.OPENQAREER_HOST,
    port: parsed.OPENQAREER_PORT,
    openAIKey: parsed.OPENQAREER_OPENAI_API_KEY,
    openRouterKey: parsed.OPENQAREER_OPENROUTER_API_KEY,
    previewToken: parsed.OPENQAREER_PREVIEW_API_TOKEN,
    dataEncryptionKey: parsed.OPENQAREER_DATA_ENCRYPTION_KEY,
    databasePath: parsed.OPENQAREER_DATABASE_PATH,
    model: parsed.OPENQAREER_AI_MODEL,
    staticRoot:
      parsed.OPENQAREER_STATIC_ROOT ??
      dirname(fileURLToPath(moduleUrl)),
    release: builtRelease,
    logLevel: parsed.OPENQAREER_LOG_LEVEL,
  };
}
