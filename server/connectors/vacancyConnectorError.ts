export class VacancyConnectorError extends Error {
  constructor(
    message: string,
    readonly retryAfterAt?: string,
  ) {
    super(message);
    this.name = 'VacancyConnectorError';
  }
}

export function parseRetryAfter(
  value: string | null,
  now: string,
): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds >= 0) {
    return new Date(new Date(now).getTime() + seconds * 1_000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
