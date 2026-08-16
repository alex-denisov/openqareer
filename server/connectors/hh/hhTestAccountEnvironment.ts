/**
 * Resolves the hh.ru test-account credentials for the B120/B123 live gate.
 *
 * Values are read from the process environment first and from the owner-only
 * local secret file (`server/localEnvironmentFile.ts`, mode 0600, outside the
 * working tree) only as a fallback, so a CI or systemd unit can supply them
 * without a file. Nothing here logs, returns or formats a credential value —
 * callers only ever learn whether the pair is present.
 */
const USERNAME_KEY = 'OPENQAREER_HH_TEST_USERNAME';
const PASSWORD_KEY = 'OPENQAREER_HH_TEST_PASSWORD';
/**
 * Owner-declared resume id of the test account. Not a secret — it is the
 * identity anchor that turns "some signed-in applicant" into "this account",
 * because the live hh.ru surface prints no account email.
 */
const RESUME_ID_KEY = 'OPENQAREER_HH_TEST_RESUME_ID';

export interface HhTestAccountEnvironment {
  readonly OPENQAREER_HH_TEST_USERNAME: string | undefined;
  readonly OPENQAREER_HH_TEST_PASSWORD: string | undefined;
  readonly OPENQAREER_HH_TEST_RESUME_ID: string | undefined;
}

/** Parses `KEY=value` lines; ignores comments, blanks and malformed lines. */
export function parseEnvironmentFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) continue;
    parsed[key] = stripQuotes(line.slice(separator + 1).trim());
  }
  return parsed;
}

export function resolveHhTestAccountEnvironment(
  processEnvironment: NodeJS.ProcessEnv,
  fileContents: string | null,
): HhTestAccountEnvironment {
  const fromFile = fileContents ? parseEnvironmentFile(fileContents) : {};
  return {
    [USERNAME_KEY]:
      processEnvironment[USERNAME_KEY] || fromFile[USERNAME_KEY] || undefined,
    [PASSWORD_KEY]:
      processEnvironment[PASSWORD_KEY] || fromFile[PASSWORD_KEY] || undefined,
    [RESUME_ID_KEY]:
      processEnvironment[RESUME_ID_KEY] || fromFile[RESUME_ID_KEY] || undefined,
  };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
