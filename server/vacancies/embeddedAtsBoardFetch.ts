import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import {
  atsBoardEndpoint,
  atsBoardSourceId,
  normalizeAtsBoard,
  type AtsProvider,
} from './atsBoardAdapters';
import { withRequestTimeout } from './requestTimeout';

/**
 * B628: сайт компании со встроенной доской BambooHR, Teamtailor, Personio или
 * Pinpoint читается лентой этой доски и тем же разбором, что и сама доска.
 * Вакансии остаются вакансиями сайта: происхождение — источник сайта.
 */
const EMBEDDED_BOARD_TIMEOUT_MS = 45_000;
const XML_PROVIDERS = new Set<string>(['teamtailor', 'personio']);

export async function fetchEmbeddedAtsBoard(
  provider: AtsProvider,
  board: string,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const url = atsBoardEndpoint(provider, board);
  const payload = await withRequestTimeout(EMBEDDED_BOARD_TIMEOUT_MS, async (signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
    return XML_PROVIDERS.has(provider) ? res.text() : (res.json() as Promise<unknown>);
  });
  const vacancies = normalizeAtsBoard(atsBoardSourceId(provider, board), payload, {
    observedAt,
    sourceName: source.name.replace(/\s+Careers$/i, ''),
  });
  return vacancies.map((vacancy) => ({
    ...vacancy,
    provenance: { ...vacancy.provenance, sourceId: source.id },
  }));
}
