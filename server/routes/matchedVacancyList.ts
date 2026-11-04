import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { FastifyRequest } from 'fastify';
import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import type { MatchedVacancyFacets } from '../../shared/matchedVacancyFacets';
import { vacancyFitPercent } from '../../shared/vacancyFitPercent';
import { filterVacanciesByDecisionProfile } from '../../shared/workPreferences';
import type { CurrencyRates } from '../../shared/currencyRates';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import { getCurrencyRates } from '../currency/cbrRates';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import type { CampaignResolution } from '../vacancies/campaign';
import { withinCareerGeography } from '../vacancies/careerGeography';
import { matchedCatalogSummary, type CatalogTotals } from '../vacancies/matchedCatalogSummary';
import {
  matchedVacancyFacetSteps,
  type MatchedVacancySourceDefinition,
} from '../vacancies/matchedVacancyFacets';
import {
  matchedVacancyFilterSteps,
  type MatchedVacancyFilters,
} from '../vacancies/matchedVacancyFilters';
import { matchedPagePlanSteps } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { maskPrivateEmployers } from '../vacancies/privateEmployerMask';
import type { SeniorityLevel } from '../vacancies/levelMatcher';
import { dropOutsideLevelGate } from '../vacancies/storedVacancyLevels';
import { campaignLevelWindow } from '../vacancies/titleParse/candidateRoleFunctions';
import { normalizeTitleKey } from '../vacancies/titleParse/normalizeTitleKey';
import { dropForeignRemote, markGeography } from '../vacancies/vacancyGeography';
import { matchedRoleCountSteps } from '../vacancies/vacancyRoleCounts';
import { runStepsYielding, type Steps } from '../vacancies/yieldingSteps';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import type { MatchedOrder } from './matchedVacancyFit';
import { createStaleListCache, type StaleListAddress, type StaleListServed } from './staleListCache';

type CandidateStore = RouteDeps['candidateStore'];
type DecisionProfile = ReturnType<CandidateStore['decisionProfileRepo']['get']>;

const FINISH_ROWS_PER_STEP = 25;

export interface MatchedRowLimits {
  readonly profile: DecisionProfile;
  readonly decisions: ReturnType<CandidateStore['listVacancyDecisions']>;
  /** Курс ЦБ для порога зарплаты: без него иностранная сумма подборку не режет. */
  readonly rates?: CurrencyRates;
}

/** Row by row except the order; the steps below rely on that when they finish the rows in pieces. */
export function finishMatchedRows(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: readonly string[],
  campaign: CampaignResolution,
  limits: MatchedRowLimits,
): MatchedVacancyItem[] {
  const remoteFiltered = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
  const career = campaign.careerGeography;
  // CPO 26.10: подборка идёт по городам и форматам «Карьеры», если они заданы.
  const geographyAndRemote = career
    ? remoteFiltered.filter((item) => withinCareerGeography(item, career))
    : remoteFiltered;
  const marked = markGeography(
    targetRoles.length > 0
      ? geographyAndRemote.filter((item) => item.explanation.roleMatch !== 'none')
      : geographyAndRemote,
    listRegions(campaign),
  );
  // Подборка по «Карьере»: удалёнка из другой страны — вне условий кандидата.
  const roleFiltered = career ? dropForeignRemote(marked) : marked;
  // B384: жёсткие ограничения профиля — теми же функциями, что на клиенте; O(размер подборки).
  const withinProfile = filterVacanciesByDecisionProfile(
    roleFiltered,
    limits.profile,
    limits.rates,
  );
  return maskPrivateEmployers(applyVacancyDecisions(withinProfile, limits.decisions));
}

function listRegions(campaign: CampaignResolution): CandidateRegion[] {
  return [
    ...(campaign.regions.value as CandidateRegion[]),
    ...((campaign.suggestedRegions ?? []) as CandidateRegion[]),
  ];
}

export function* finishMatchedRowSteps(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: readonly string[],
  campaign: CampaignResolution,
  limits: MatchedRowLimits,
): Steps<MatchedVacancyItem[]> {
  const finished: MatchedVacancyItem[] = [];
  for (let start = 0; start < snapshot.length; start += FINISH_ROWS_PER_STEP) {
    const rows = snapshot.slice(start, start + FINISH_ROWS_PER_STEP);
    finished.push(...finishMatchedRows(rows, targetRoles, campaign, limits));
    yield;
  }
  return listRegions(campaign).length > 0 ? finished.sort(compareMatchedVacancies) : finished;
}

export interface MatchedList {
  readonly filtered: readonly MatchedVacancyItem[];
  readonly pageOffsets: readonly number[];
  readonly facets: MatchedVacancyFacets & {
    catalogSummary?: ReturnType<typeof matchedCatalogSummary>;
  };
  readonly campaignWithHypotheses: ReturnType<typeof readCampaign>;
  readonly prepareMs: number;
  readonly prepareRows: number;
  readonly listMs: number;
}

export interface MatchedListInput {
  readonly snapshot: readonly MatchedVacancyItem[];
  readonly targetRoles: string[];
  readonly confirmedSkills: readonly string[];
  readonly targetLevel: SeniorityLevel | undefined;
  readonly geography: unknown;
  readonly campaign: CampaignResolution;
  readonly candidateStore: CandidateStore;
  readonly candidateId: string;
  readonly titleParseStore: RouteDeps['titleParseStore'];
  readonly filters: MatchedVacancyFilters;
  readonly sourceRegistry: readonly MatchedVacancySourceDefinition[];
  readonly order: MatchedOrder;
  readonly catalogTotals?: () => CatalogTotals | undefined;
}

/**
 * PRB-040: каждая страница дочитывания пересчитывала подборку целиком — ~230 мс event loop на
 * четыре записи, сотни страниц на чтение. Посчитанная подборка живёт одно окно; страница — срез.
 *
 * PRB-041: past the window the old list answers and a new one is built behind it. The age limit
 * bounds that: order and totals may lag up to 5 minutes (the floor between rebuilds of a stale
 * snapshot, #393), the percent and state of a shown row are read fresh on every page, and a rebuild
 * that keeps failing cannot pin an old list. A reader back after a longer pause waits for a new one.
 */
const MATCHED_LIST_WINDOW_MS = 60_000;
const MATCHED_LIST_MAX_AGE_MS = 5 * 60_000;
const matchedListCache = createStaleListCache<MatchedList>({
  windowMs: MATCHED_LIST_WINDOW_MS,
  maxAgeMs: MATCHED_LIST_MAX_AGE_MS,
});
const snapshotIds = new WeakMap<readonly MatchedVacancyItem[], number>();
let nextSnapshotId = 0;

function snapshotId(snapshot: readonly MatchedVacancyItem[]): number {
  const known = snapshotIds.get(snapshot);
  if (known !== undefined) return known;
  nextSnapshotId += 1;
  snapshotIds.set(snapshot, nextSnapshotId);
  return nextSnapshotId;
}

/** `choice` holds all the candidate decides: what the pool or the sweep did goes to `data`. */
function matchedListAddress(input: MatchedListInput): StaleListAddress {
  const { campaign, candidateStore, candidateId, filters, order } = input;
  const choice = createHash('sha256')
    .update(
      JSON.stringify([
        { ...filters, offset: 0 },
        order.cacheKey,
        order.fitStamp,
        input.targetRoles,
        input.confirmedSkills,
        input.targetLevel ?? null,
        input.geography ?? null,
        campaign.regions.value,
        campaign.suggestedRegions ?? [],
        campaign.remoteOnly,
        campaign.careerGeography ?? null,
        candidateStore.decisionProfileRepo.get(candidateId) ?? null,
        candidateStore.listVacancyDecisions(candidateId),
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return { candidateId, choice, data: `${snapshotId(input.snapshot)}|${order.dataKey}` };
}

function hypothesisRows(input: MatchedListInput): readonly MatchedVacancyItem[] {
  return input.campaign.remoteOnly
    ? input.snapshot.filter((item) => item.cluster.isRemote)
    : input.snapshot;
}

function roleLevelCount(rows: readonly MatchedVacancyItem[], roles: readonly string[]): number {
  if (roles.length === 0) return rows.length;
  return rows.filter((item) => item.explanation.roleMatch !== 'none').length;
}

function readRowLimits(candidateStore: CandidateStore, candidateId: string): MatchedRowLimits {
  return {
    profile: candidateStore.decisionProfileRepo.get(candidateId),
    decisions: candidateStore.listVacancyDecisions(candidateId),
    rates: getCurrencyRates(),
  };
}

function* levelGateSteps(
  finished: readonly MatchedVacancyItem[],
  input: MatchedListInput,
): Steps<MatchedVacancyItem[]> {
  const window = campaignLevelWindow(input.targetRoles, input.targetLevel);
  const kept: MatchedVacancyItem[] = [];
  for (let start = 0; start < finished.length; start += FINISH_ROWS_PER_STEP) {
    const rows = finished.slice(start, start + FINISH_ROWS_PER_STEP);
    kept.push(
      ...dropOutsideLevelGate(rows, window, input.targetLevel, (key) =>
        input.titleParseStore.getByKey(key),
      ),
    );
    yield;
  }
  return kept;
}

function* matchedListSteps(input: MatchedListInput) {
  const { campaign, candidateStore, candidateId, filters, targetRoles, snapshot } = input;
  const limits = readRowLimits(candidateStore, candidateId);
  yield;
  const finished = yield* finishMatchedRowSteps(snapshot, targetRoles, campaign, limits);
  const matched = input.order(yield* levelGateSteps(finished, input));
  yield;
  const hypotheses = hypothesisRows(input);
  const counts = yield* matchedRoleCountSteps(hypotheses, targetRoles);
  const readLevel = (item: MatchedVacancyItem) =>
    input.titleParseStore.getByKey(normalizeTitleKey(item.cluster.canonicalTitle))?.levelRank;
  const facets = yield* matchedVacancyFacetSteps(
    matched,
    targetRoles,
    readLevel,
    input.sourceRegistry,
  );
  const filtered = yield* matchedVacancyFilterSteps(
    matched,
    filters,
    targetRoles,
    readLevel,
    input.sourceRegistry.map(({ id }) => id),
  );
  const catalogSummary = matchedCatalogSummary(
    input.catalogTotals?.(),
    roleLevelCount(hypotheses, targetRoles),
    {
      selectionTotal: filtered.length,
      fitCounted: filtered.filter((item) => vacancyFitPercent(item.explanation.fitView) !== null)
        .length,
    },
  );
  yield;
  const pageOffsets = yield* matchedPagePlanSteps(filtered);
  const campaignWithHypotheses = readCampaign(candidateStore, candidateId, counts);
  return {
    filtered,
    pageOffsets,
    facets: catalogSummary ? { ...facets, catalogSummary } : facets,
    campaignWithHypotheses,
  };
}

const roundMs = (ms: number): number => Number(ms.toFixed(2));

async function buildMatchedList(input: MatchedListInput): Promise<MatchedList> {
  await yieldToEventLoop();
  const startedAt = performance.now();
  const prepareRows = await input.order.prepare(input.snapshot);
  const listStartedAt = performance.now();
  const list = await runStepsYielding(matchedListSteps(input));
  return {
    ...list,
    prepareMs: roundMs(listStartedAt - startedAt),
    prepareRows,
    listMs: roundMs(performance.now() - listStartedAt),
  };
}

/** The list for this read. A rebuild outlives the request that started it, hence its own log. */
export async function readMatchedList(
  input: MatchedListInput,
  log: FastifyRequest['log'],
): Promise<{ readonly list: MatchedList; readonly served: StaleListServed }> {
  const { value, served } = await matchedListCache.read(
    matchedListAddress(input),
    () => buildMatchedList(input),
    {
      continuing: input.filters.offset > 0,
      onRebuilt: ({ prepareMs, prepareRows, listMs, filtered }) =>
        log.info({ prepareMs, prepareRows, listMs, rows: filtered.length }, 'matched-list-rebuilt'),
      onRebuildFailed: (error) =>
        log.warn(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'matched-list-rebuild-failed',
        ),
    },
  );
  return { list: value, served };
}
