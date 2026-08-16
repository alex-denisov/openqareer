/**
 * Copies provider credentials from an external local environment file into the
 * owner-only OpenQareer secret file and fills in the values the server requires.
 *
 * The target is edited in place: existing lines are rewritten, new keys are
 * appended, and every comment, section header and unmanaged key is preserved.
 * A previous version rewrote the file from a fixed key list, which would now
 * silently drop the deploy, LinkedIn and hh.ru sections that live in the same
 * file.
 *
 * The target must be an absolute path outside the repository working tree:
 * a secret file inside the checkout is one careless `git add -f` away from a
 * committed credential (`DEPLOY.md` §7). The canonical target is
 * `~/.openqareer/openqareer.env`.
 *
 *   node scripts/sync-local-provider-secrets.mjs \
 *     --source <external.env> --target ~/.openqareer/openqareer.env
 */
import { randomBytes } from 'node:crypto';
import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const sourcePath = argument('--source');
const targetPath = argument('--target');
if (!targetPath.startsWith('/')) {
  throw new Error('--target must be an absolute path');
}
const resolvedTarget = resolve(targetPath);
const insideRepository = !relative(process.cwd(), resolvedTarget).startsWith(
  '..',
);
if (insideRepository) {
  throw new Error(
    'target must live outside the repository working tree; see DEPLOY.md §7',
  );
}
const sourceStats = await stat(sourcePath);
if (!sourceStats.isFile()) throw new Error('source must be a regular file');
if (dirname(resolve(sourcePath)) === dirname(resolvedTarget)) {
  throw new Error('source must be a separate external environment file');
}

const source = parseEnvironment(await readFile(sourcePath, 'utf8'));
const currentContents = await readFileIfPresent(resolvedTarget);
const current = parseEnvironment(currentContents ?? '');
const mapped = {
  OPENQAREER_OPENAI_API_KEY: source.OPENAI_API_KEY ?? '',
  OPENQAREER_OPENROUTER_API_KEY: source.OPENROUTER_API_KEY ?? '',
  OPENQAREER_ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY ?? '',
  OPENQAREER_GROQ_API_KEY: source.GROQ_AI_API_KEY ?? source.GROQ_API_KEY ?? '',
  OPENQAREER_CEREBRAS_API_KEY:
    source.CEREBRAS_AI_API_KEY ?? source.CEREBRAS_API_KEY ?? '',
  OPENQAREER_KILO_CODE_AI_API_KEY: source.KILO_CODE_AI_API_KEY ?? '',
  OPENQAREER_NVIDIA_NIM_API_KEY: source.NVIDIA_NIM_API_KEY ?? '',
  OPENQAREER_OPENCODE_ZEN_AI_API_KEY: source.OPENCODE_ZEN_AI_API_KEY ?? '',
  OPENQAREER_TOKENROUTER_API_KEY: source.TOKENROUTER_API_KEY ?? '',
  OPENQAREER_SAMBANOVA_CLOUD_API_KEY: source.SAMBANOVA_CLOUD_API_KEY ?? '',
  OPENQAREER_POLLINATIONS_AI_API_KEY: source.POLLINATIONS_AI_API_KEY ?? '',
  OPENQAREER_HUGGINGFACE_HUB_API_KEY: source.HUGGINGFACE_HUB_API_KEY ?? '',
};
const providerFields = Object.fromEntries(
  Object.keys(emptyProviderFields()).map((name) => [
    name,
    current[name] || mapped[name] || '',
  ]),
);
const next = {
  OPENQAREER_HOST: current.OPENQAREER_HOST ?? '127.0.0.1',
  OPENQAREER_PORT: current.OPENQAREER_PORT ?? '3210',
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

const serialized = mergeEnvironment(currentContents ?? '', next);
const temporaryPath = `${resolvedTarget}.tmp-${process.pid}`;
await writeFile(temporaryPath, serialized, { mode: 0o600, flag: 'wx' });
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, resolvedTarget);
await chmod(resolvedTarget, 0o600);

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

/**
 * Rewrites the managed keys in place and appends the ones the file does not
 * have yet, so comments and unmanaged sections survive untouched.
 */
function mergeEnvironment(contents, values) {
  const pending = new Set(Object.keys(values));
  const lines = contents.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      return line;
    }
    const name = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (!pending.has(name)) return line;
    pending.delete(name);
    return `${name}=${encodeEnvironmentValue(values[name])}`;
  });
  const appended = [...pending].map(
    (name) => `${name}=${encodeEnvironmentValue(values[name])}`,
  );
  const body = rewritten.join('\n').replace(/\n+$/u, '');
  if (appended.length === 0) return `${body}\n`;
  return `${body}\n\n# Added by scripts/sync-local-provider-secrets.mjs\n${appended.join('\n')}\n`;
}

async function readFileIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
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
  // `=` is safe unquoted for both `source` and systemd `EnvironmentFile`, and
  // base64 padding would otherwise re-quote an unchanged key on every run.
  if (/^[A-Za-z0-9_./:+=-]*$/.test(value)) return value;
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
    OPENQAREER_KILO_CODE_AI_API_KEY: '',
    OPENQAREER_NVIDIA_NIM_API_KEY: '',
    OPENQAREER_OPENCODE_ZEN_AI_API_KEY: '',
    OPENQAREER_TOKENROUTER_API_KEY: '',
    OPENQAREER_SAMBANOVA_CLOUD_API_KEY: '',
    OPENQAREER_POLLINATIONS_AI_API_KEY: '',
    OPENQAREER_HUGGINGFACE_HUB_API_KEY: '',
  };
}
