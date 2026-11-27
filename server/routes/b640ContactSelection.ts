import { candidateCompanyKey } from '../domain/candidateCompanies';

/**
 * B645 a02: «Сначала: компании подборки» must not hold the list hostage. A cold match
 * recompute took 12–25 s and answered 503 vacancy_match_busy, so the list waits this long
 * and then goes out ordered by company and role; the recompute keeps warming in the background.
 */
export const SELECTION_WAIT_MS = 1_500;

export async function selectionKeysWithin(
  companyNames: Promise<readonly string[]>,
  waitMs: number = SELECTION_WAIT_MS,
): Promise<ReadonlySet<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<readonly string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), waitMs);
  });
  // A late rejection after the timeout must not surface as an unhandled one.
  const settled = companyNames.catch(() => [] as readonly string[]);
  try {
    const names = await Promise.race([settled, timeout]);
    return new Set(names.map(candidateCompanyKey));
  } finally {
    clearTimeout(timer);
  }
}
