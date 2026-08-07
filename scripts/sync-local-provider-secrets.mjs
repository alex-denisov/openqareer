import { randomBytes } from 'node:crypto';
import {
  chmod,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sourcePath = argument('--source');
const targetPath = argument('--target');
const expectedTarget = resolve(process.cwd(), 'openqareer.env');
if (resolve(targetPath) !== expectedTarget) {
  throw new Error('target must be the repository root openqareer.env');
}
const sourceStats = await stat(sourcePath);
if (!sourceStats.isFile()) throw new Error('source must be a regular file');
if (dirname(resolve(sourcePath)) === dirname(expectedTarget)) {
  throw new Error('source must be an external local environment file');
}

const source = parseEnvironment(await readFile(sourcePath, 'utf8'));
const current = await readEnvironmentIfPresent(targetPath);
const mapped = {
  OPENQAREER_OPENAI_API_KEY: source.OPENAI_API_KEY ?? '',
  OPENQAREER_OPENROUTER_API_KEY: source.OPENROUTER_API_KEY ?? '',
  OPENQAREER_ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY ?? '',
};
const providerFields = Object.fromEntries(
  Object.keys(emptyProviderFields()).map((name) => [
    name,
    current[name] || mapped[name] || '',
  ]),
);
const next = {
  OPENQAREER_HOST: '127.0.0.1',
  OPENQAREER_PORT: '3210',
  ...current,
  ...providerFields,
  OPENQAREER_PREVIEW_API_TOKEN:
    current.OPENQAREER_PREVIEW_API_TOKEN ?? randomBytes(32).toString('base64url'),
  OPENQAREER_DATA_ENCRYPTION_KEY:
    current.OPENQAREER_DATA_ENCRYPTION_KEY ?? randomBytes(32).toString('base64'),
  OPENQAREER_DATABASE_PATH:
    current.OPENQAREER_DATABASE_PATH ?? 'data/openqareer.db',
  OPENQAREER_AI_MODEL: current.OPENQAREER_AI_MODEL ?? 'gpt-5.6-sol',
  OPENQAREER_PERSONAL_AI_PROVIDER:
    current.OPENQAREER_PERSONAL_AI_PROVIDER ?? 'openai',
  OPENQAREER_PERSONAL_AI_MODEL:
    current.OPENQAREER_PERSONAL_AI_MODEL ?? 'gpt-5.6-sol',
  OPENQAREER_SYNTHETIC_AI_PROVIDER:
    current.OPENQAREER_SYNTHETIC_AI_PROVIDER ?? 'openrouter',
  OPENQAREER_SYNTHETIC_AI_MODEL:
    current.OPENQAREER_SYNTHETIC_AI_MODEL ??
    'nvidia/nemotron-3-ultra-550b-a55b:free',
  OPENQAREER_LOG_LEVEL: current.OPENQAREER_LOG_LEVEL ?? 'info',
  OPENQAREER_ADMIN_USERNAME: current.OPENQAREER_ADMIN_USERNAME || 'admin',
  OPENQAREER_ADMIN_PASSWORD:
    current.OPENQAREER_ADMIN_PASSWORD || randomBytes(24).toString('base64url'),
  OPENQAREER_TEST_CANDIDATE_USERNAME:
    current.OPENQAREER_TEST_CANDIDATE_USERNAME || 'candidate-demo',
  OPENQAREER_TEST_CANDIDATE_PASSWORD:
    current.OPENQAREER_TEST_CANDIDATE_PASSWORD ||
    randomBytes(24).toString('base64url'),
};

const orderedNames = [
  'OPENQAREER_HOST',
  'OPENQAREER_PORT',
  'OPENQAREER_OPENAI_API_KEY',
  'OPENQAREER_ANTHROPIC_API_KEY',
  'OPENQAREER_FIREWORKS_API_KEY',
  'OPENQAREER_OPENROUTER_API_KEY',
  'OPENQAREER_GEMINI_API_KEY',
  'OPENQAREER_GROQ_API_KEY',
  'OPENQAREER_MISTRAL_API_KEY',
  'OPENQAREER_CEREBRAS_API_KEY',
  'OPENQAREER_COHERE_API_KEY',
  'OPENQAREER_YANDEX_API_KEY',
  'OPENQAREER_YANDEX_FOLDER_ID',
  'OPENQAREER_PREVIEW_API_TOKEN',
  'OPENQAREER_DATA_ENCRYPTION_KEY',
  'OPENQAREER_DATABASE_PATH',
  'OPENQAREER_AI_MODEL',
  'OPENQAREER_PERSONAL_AI_PROVIDER',
  'OPENQAREER_PERSONAL_AI_MODEL',
  'OPENQAREER_SYNTHETIC_AI_PROVIDER',
  'OPENQAREER_SYNTHETIC_AI_MODEL',
  'OPENQAREER_LOG_LEVEL',
  'OPENQAREER_ADMIN_USERNAME',
  'OPENQAREER_ADMIN_PASSWORD',
  'OPENQAREER_TEST_CANDIDATE_USERNAME',
  'OPENQAREER_TEST_CANDIDATE_PASSWORD',
];
const serialized = `${orderedNames
  .map((name) => `${name}=${encodeEnvironmentValue(next[name] ?? '')}`)
  .join('\n')}\n`;
const temporaryPath = `${targetPath}.tmp-${process.pid}`;
await writeFile(temporaryPath, serialized, { mode: 0o600, flag: 'wx' });
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, targetPath);
await chmod(targetPath, 0o600);

const copiedNames = Object.entries(mapped)
  .filter(([, value]) => Boolean(value))
  .map(([name]) => name);
process.stdout.write(
  `Local secret file updated; copied variables: ${copiedNames.join(', ') || 'none'}\n`,
);

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readEnvironmentIfPresent(path) {
  try {
    return parseEnvironment(await readFile(path, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function parseEnvironment(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const name = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1).trim();
        return [name, decodeEnvironmentValue(rawValue)];
      }),
  );
}

function decodeEnvironmentValue(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function encodeEnvironmentValue(value) {
  if (/^[A-Za-z0-9_./:+-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function emptyProviderFields() {
  return {
    OPENQAREER_OPENAI_API_KEY: '',
    OPENQAREER_ANTHROPIC_API_KEY: '',
    OPENQAREER_FIREWORKS_API_KEY: '',
    OPENQAREER_OPENROUTER_API_KEY: '',
    OPENQAREER_GEMINI_API_KEY: '',
    OPENQAREER_GROQ_API_KEY: '',
    OPENQAREER_MISTRAL_API_KEY: '',
    OPENQAREER_CEREBRAS_API_KEY: '',
    OPENQAREER_COHERE_API_KEY: '',
    OPENQAREER_YANDEX_API_KEY: '',
    OPENQAREER_YANDEX_FOLDER_ID: '',
  };
}
