/** Keeps the path and query of a logged URL, with token-like parameters censored. */
export function redactRequestUrlForLogs(value: unknown): string {
  if (typeof value !== 'string') return '[REDACTED]';
  try {
    const url = new URL(value, 'http://localhost');
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (
        ['token', 'code', 'secret', 'password'].includes(normalized) ||
        normalized.endsWith('_token')
      ) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '[REDACTED]';
  }
}
