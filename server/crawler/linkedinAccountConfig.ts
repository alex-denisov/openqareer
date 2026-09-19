/**
 * Resolves the configured LinkedIn account pool without reading credential
 * values into logs or source-controlled state. Explicit IDs win; otherwise a
 * `LINKEDIN_01_LOGIN` style block declares the matching `account-1` profile.
 */
export function configuredLinkedinAccountIds(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const explicit = (environment.LINKEDIN_ACCOUNT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  return Object.keys(environment)
    .map((key) => /^LINKEDIN_(\d{2})_LOGIN$/.exec(key))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .filter((match) => Boolean(environment[`LINKEDIN_${match[1]}_LOGIN`]?.trim()))
    .map((match) => `account-${Number(match[1])}`)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function linkedinCredentialBlock(
  accountId: string,
  environment: NodeJS.ProcessEnv = process.env,
): {
  login?: string;
  password?: string;
  twoFactorKey?: string;
  emailLogin?: string;
  emailPassword?: string;
  profileUrl?: string;
} {
  const match = /^account-(\d+)$/.exec(accountId);
  if (!match) return {};
  const suffix = String(Number(match[1])).padStart(2, '0');
  return {
    login: environment[`LINKEDIN_${suffix}_LOGIN`]?.trim() || undefined,
    password: environment[`LINKEDIN_${suffix}_PASSWORD`] || undefined,
    twoFactorKey: environment[`LINKEDIN_${suffix}_2FA_KEY`]?.trim() || undefined,
    emailLogin: environment[`LINKEDIN_${suffix}_EMAIL_LOGIN`]?.trim() || undefined,
    emailPassword: environment[`LINKEDIN_${suffix}_EMAIL_PASSWORD`] || undefined,
    profileUrl: environment[`LINKEDIN_${suffix}_PROFILE_URL`]?.trim() || undefined,
  };
}
