import { performance } from 'node:perf_hooks';
import { parseVacancy } from '../server/vacancies/sqliteVacancyPoolStore';
import { VacancyMatchReader } from '../server/vacancies/vacancyMatchReader';
import { buildSemanticMatchQuery } from '../server/vacancies/semanticMatchQuery';
import { DEFAULT_MATCH_CANDIDATE_LIMIT, freshnessWindow } from '../server/vacancies/vacancyPoolQuery';
import type { MatchedVacancyItem } from '../server/vacancies/multiSourceVacancyEngine';
import type { CandidateMatchProfile } from '../server/vacancies/vacancyMatcher';
import { matchCandidateWithVacancy } from '../server/vacancies/vacancyMatcher';
import { clusterVacancies } from '../server/vacancies/vacancyDeduplicator';
import { compareMatchedVacancies } from '../shared/vacancyMatchOrder';
import { applyVacancyDecisions } from '../server/vacancies/applyVacancyDecisions';
import { markGeography } from '../server/vacancies/vacancyGeography';
import { buildMatchedVacancyPage } from '../server/vacancies/matchedVacancyPage';
import { addStoredVacancyLevels } from '../server/vacancies/storedVacancyLevels';
import { countMatchedVacanciesByRole } from '../server/vacancies/vacancyRoleCounts';
import { candidateRoleFunctionCodes } from '../server/vacancies/titleParse/candidateRoleFunctions';
import { LEVEL_RANK, type SeniorityLevel } from '../server/vacancies/levelMatcher';
import type { FunctionCode } from '../shared/roleTaxonomy';
import { rulesParse } from '../server/vacancies/titleParse/rulesParse';

interface Timings {
  readonly queryBuildMs: number;
  readonly sqliteAndReaderMs: number;
  readonly clusterJsonParseMs: number;
  readonly clusterMatchAndSortMs: number;
  readonly roleGeographyAndDecisionsMs: number;
  readonly roleCountsMs: number;
  readonly pageBuildMs: number;
  readonly levelEnrichmentMs: number;
  readonly totalMs: number;
}

interface ProfileCase {
  readonly label: string;
  readonly roles: readonly string[];
  readonly level: SeniorityLevel;
}

const PROFILES: readonly ProfileCase[] = [
  { label: 'engineering-executive', roles: ['CTO', 'VP of Engineering'], level: 'c-level' },
  { label: 'operations-executive', roles: ['COO'], level: 'c-level' },
];

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

interface CandidateQueryMeasurement {
  readonly rows: Array<{ payload: string }>;
  readonly vacancies: NonNullable<ReturnType<typeof parseVacancy>>[];
  readonly sqliteAndReaderMs: number;
  readonly clusterJsonParseMs: number;
}

async function queryCandidates(
  reader: VacancyMatchReader,
  query: ReturnType<typeof buildSemanticMatchQuery>,
): Promise<CandidateQueryMeasurement> {
  const sqlStart = performance.now();
  const rows = await reader.read(query.sql, query.params);
  const sqliteAndReaderMs = performance.now() - sqlStart;
  const parseStart = performance.now();
  const vacancies = rows.flatMap((row) => {
    const parsed = parseVacancy(row.payload);
    return parsed ? [parsed] : [];
  });
  return { rows, vacancies, sqliteAndReaderMs, clusterJsonParseMs: performance.now() - parseStart };
}

function rankCandidates(
  profile: CandidateMatchProfile,
  vacancies: CandidateQueryMeasurement['vacancies'],
): { items: MatchedVacancyItem[]; elapsedMs: number } {
  const started = performance.now();
  const clusters = clusterVacancies(vacancies).filter((cluster) => cluster.status === 'active');
  const items = clusters
    .map((cluster) => ({ cluster, explanation: matchCandidateWithVacancy(profile, cluster) }))
    .sort(compareMatchedVacancies);
  return { items, elapsedMs: performance.now() - started };
}

function finishCandidates(
  matched: readonly MatchedVacancyItem[],
): { items: MatchedVacancyItem[]; elapsedMs: number; countMs: number } {
  const started = performance.now();
  const roleFiltered = markGeography(
    matched.filter((item) => item.explanation.roleMatch !== 'none'),
    [],
  );
  const items = applyVacancyDecisions(roleFiltered, []);
  const elapsedMs = performance.now() - started;
  const countStarted = performance.now();
  countMatchedVacanciesByRole(matched, ['CTO', 'VP of Engineering']);
  return { items, elapsedMs, countMs: performance.now() - countStarted };
}

function buildPage(items: readonly MatchedVacancyItem[], level: SeniorityLevel) {
  const started = performance.now();
  const page = buildMatchedVacancyPage([...items], 0);
  const pageBuildMs = performance.now() - started;
  const enrichmentStarted = performance.now();
  const enriched = addStoredVacancyLevels(page.items, level, () => undefined);
  return { page, enriched, pageBuildMs, levelEnrichmentMs: performance.now() - enrichmentStarted };
}

function buildQuery(profile: ProfileCase) {
  const started = performance.now();
  const query = buildSemanticMatchQuery({
    functionCodes: candidateRoleFunctionCodes(profile.roles),
    levelRank: LEVEL_RANK[profile.level],
    window: freshnessWindow(Date.now()),
    preferRemote: true,
    limit: DEFAULT_MATCH_CANDIDATE_LIMIT,
  });
  return { query, elapsedMs: performance.now() - started };
}

function matchProfile(profile: ProfileCase, roleCodes: readonly FunctionCode[]): CandidateMatchProfile {
  return {
    candidateId: `c43-${profile.label}`,
    targetRoles: [...profile.roles],
    targetLevel: profile.level,
    confirmedSkills: [],
    confirmedFacts: [],
    preferredRemote: true,
    semanticRoleFunctions: roleCodes,
  };
}

function summaryFor(
  attempt: number,
  queryResult: CandidateQueryMeasurement,
  finished: ReturnType<typeof finishCandidates>,
  page: ReturnType<typeof buildPage>,
  roleCodes: readonly FunctionCode[],
): Record<string, unknown> {
  const top20 = finished.items.slice(0, 20).map((item) => item.cluster.canonicalTitle);
  const parsedRoles = queryResult.vacancies.map((vacancy) => rulesParse(vacancy.title));
  const commercialRolesNotRequested = parsedRoles.filter((parsed) =>
    (['sales', 'marketing'] as const).some(
      (code) => parsed.functions.includes(code) && !roleCodes.includes(code),
    ),
  ).length;
  return {
    attempt,
    sqlRows: queryResult.rows.length,
    validVacancies: queryResult.vacancies.length,
    matchedAfterRoleFilter: finished.items.length,
    totalFromPage: page.page.total,
    pageItems: page.page.items.length,
    enrichedItems: page.enriched.length,
    suspiciousTitles: top20.filter((title) => /sales|marketing|c\+\+/iu.test(title)).length,
    salesTitles: top20.filter((title) => /sales/iu.test(title)).length,
    marketingTitles: top20.filter((title) => /marketing/iu.test(title)).length,
    cPlusPlusTitles: top20.filter((title) => /c\+\+/iu.test(title)).length,
    marketingOperationsTitles: top20.filter(
      (title) => /marketing|creative/iu.test(title) && /operations/iu.test(title),
    ).length,
    requestedFunctionByRules: parsedRoles.filter((parsed) =>
      parsed.functions.some((code) => roleCodes.includes(code)),
    ).length,
    commercialRolesNotRequested,
    noRuleFunction: parsedRoles.filter((parsed) => parsed.functions.length === 0).length,
  };
}

async function measure(
  databasePath: string,
  profile: ProfileCase,
  attempt: number,
): Promise<{ timings: Timings; summary: Record<string, unknown> }> {
  const reader = new VacancyMatchReader(databasePath, 60_000, 1);
  const started = performance.now();
  const roleCodes = candidateRoleFunctionCodes(profile.roles);
  const { query, elapsedMs: queryBuildMs } = buildQuery(profile);
  try {
    const queryResult = await queryCandidates(reader, query);
    const ranked = rankCandidates(matchProfile(profile, roleCodes), queryResult.vacancies);
    const finished = finishCandidates(ranked.items);
    const pageResult = buildPage(finished.items, profile.level);
    return {
      timings: {
        queryBuildMs,
        sqliteAndReaderMs: queryResult.sqliteAndReaderMs,
        clusterJsonParseMs: queryResult.clusterJsonParseMs,
        clusterMatchAndSortMs: ranked.elapsedMs,
        roleGeographyAndDecisionsMs: finished.elapsedMs,
        roleCountsMs: finished.countMs,
        pageBuildMs: pageResult.pageBuildMs,
        levelEnrichmentMs: pageResult.levelEnrichmentMs,
        totalMs: performance.now() - started,
      },
      summary: summaryFor(attempt, queryResult, finished, pageResult, roleCodes),
    };
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  const databasePath = process.argv[2];
  if (!databasePath) throw new Error('usage: npx tsx scripts/bench-c43-semantic-match.ts <sanitized-database>');
  for (const profile of PROFILES) {
    const runs = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      runs.push(await measure(databasePath, profile, attempt));
    }
    const keys = Object.keys(runs[0].timings) as Array<keyof Timings>;
    const cold = runs[0].timings;
    const warm = Object.fromEntries(
      keys.map((key) => [key, median(runs.slice(1).map((run) => run.timings[key]))]),
    );
    console.log(JSON.stringify({
      profile: profile.label,
      roleCodes: candidateRoleFunctionCodes(profile.roles) as FunctionCode[],
      candidateLimit: DEFAULT_MATCH_CANDIDATE_LIMIT,
      cold,
      warmMedian: warm,
      coldSummary: runs[0].summary,
      warmSummaries: runs.slice(1).map((run) => run.summary),
    }));
  }
}

await main();
