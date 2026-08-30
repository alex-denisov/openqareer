/**
 * B164 live gate — contacts every enabled source and reports what actually
 * came back. Not part of `npm test`: it depends on the open internet, and a
 * network failure must not be reported as a code failure.
 *
 * Usage: npx tsx scripts/verify-vacancy-sources.ts [query]
 */
import { buildMultiSourceFetcher } from '../server/vacancies/multiSourceFetcher';
import { searchRemotiveVacancies } from '../server/connectors/remotiveVacancySearch';
import { DEFAULT_VACANCY_SOURCES } from '../server/vacancies/defaultVacancySources';
import type { UnifiedVacancy } from '../server/domain/unifiedVacancy';

const query = process.argv[2];

const unavailable = async () => {
  throw new Error('vacancy_source_transport_unavailable');
};
// hh.ru's official search stays unavailable on purpose (INC-022); Remotive is
// contacted for real, because it is one of the registered sources.
const fetcher = buildMultiSourceFetcher(unavailable, searchRemotiveVacancies);

interface Row {
  id: string;
  market: string;
  accessClass: string;
  type: string;
  ok: boolean;
  count: number;
  ms: number;
  linkOk?: number | string;
  message?: string;
}

async function checkLink(vacancy: UnifiedVacancy | undefined): Promise<number | string> {
  if (!vacancy) return 'no-item';
  try {
    const response = await fetch(vacancy.url, {
      method: 'GET',
      redirect: 'follow',
      // Boards answer a bare agent with 403/460 anti-bot pages, which says
      // nothing about whether the vacancy exists.
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20_000),
    });
    return response.status;
  } catch (reason) {
    return String(reason).slice(0, 40);
  }
}

const rows: Row[] = [];
for (const source of DEFAULT_VACANCY_SOURCES.filter((entry) => entry.enabled)) {
  // A source that only answers a query is checked with one; without a query it
  // is not contacted at all, which is what the scheduler does too.
  const sourceQuery = source.requiresQuery ? (query ?? 'developer') : query;
  const started = Date.now();
  try {
    const vacancies = await fetcher(source, sourceQuery ? { query: sourceQuery } : undefined);
    rows.push({
      id: source.id,
      market: source.market,
      accessClass: source.accessClass,
      type: source.type,
      ok: true,
      count: vacancies.length,
      ms: Date.now() - started,
      linkOk: await checkLink(vacancies[0]),
    });
  } catch (reason) {
    rows.push({
      id: source.id,
      market: source.market,
      accessClass: source.accessClass,
      type: source.type,
      ok: false,
      count: 0,
      ms: Date.now() - started,
      message: reason instanceof Error ? reason.message : String(reason),
    });
  }
}

const empty = rows.filter((row) => row.ok && row.count === 0).map((row) => row.id);
const failed = rows.filter((row) => !row.ok).map((row) => row.id);
// Only «gone» counts as a dead link. Boards answer an unfamiliar client with
// 403/460 anti-bot pages, which says nothing about whether the vacancy exists.
const deadLinks = rows.filter((row) => row.linkOk === 404 || row.linkOk === 410);

process.stdout.write(
  `${JSON.stringify(
    {
      status: failed.length === 0 && empty.length === 0 && deadLinks.length === 0 ? 'pass' : 'fail',
      totalVacancies: rows.reduce((sum, row) => sum + row.count, 0),
      failed,
      empty,
      deadLinks: deadLinks.map((row) => `${row.id}:${row.linkOk}`),
      rows,
    },
    null,
    2,
  )}\n`,
);
process.exit(failed.length === 0 && empty.length === 0 && deadLinks.length === 0 ? 0 : 1);
