import type { RouteDeps } from './deps';
import { readCampaign } from './campaignContext';
import { withWantedCompanyOrder } from './matchedVacancyFit';
import { engineListReads, warmMatchedListCache } from './matchedVacancyList';
import { readSortedFilters } from './matchedVacancySort';
import { readTargetLevel } from './vacancyRoleContext';
import { matchGeographyOf } from '../vacancies/matchGeography';
import { readMatchedSnapshot, readMatchProfile } from '../vacancies/matchedPoolContext';
import { cachedMatchedSourceRegistry } from '../vacancies/matchedSourceRegistryCache';
import { backgroundStep } from '../observability/backgroundSteps';

interface WarmLog {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

const warnThrough = (log: WarmLog | undefined) => ({
  warn: (details: Record<string, unknown>, message: string) => log?.error(details, message),
});

/**
 * The read of a candidate opening the cabinet, without a request: no filters and the saved sort.
 * It has to land on the address that read looks for (`matchedListWarm.test.ts` holds that).
 */
export async function warmMatchedList(
  deps: RouteDeps,
  candidateId: string,
  log: WarmLog | undefined,
  query: unknown = {},
): Promise<void> {
  const { candidateStore, multiSourceEngine: engine, titleParseStore } = deps;
  const warmStartedAt = performance.now();
  await backgroundStep('list:fit-ids', async () => deps.vacancyMechanics?.warmCachedVacancyIds?.(candidateId));
  const warmFitIdsMs = Math.round(performance.now() - warmStartedAt);
  const { filters, sort, confirmedSkills, campaign, targetRoles, targetLevel, geography } = await backgroundStep('list:profile', async () => {
    const read = readCampaign(candidateStore, candidateId);
    const roles = [...read.roles.value];
    return {
      ...readSortedFilters(deps, candidateId, query),
      confirmedSkills: readMatchProfile(candidateStore, candidateId).confirmedSkills,
      campaign: read,
      targetRoles: roles,
      targetLevel: readTargetLevel(candidateStore, candidateId, roles),
      geography: matchGeographyOf(read.careerGeography),
    };
  });
  const snapshot = await backgroundStep('list:snapshot', () =>
    readMatchedSnapshot(engine, candidateId, confirmedSkills, targetRoles, targetLevel, geography));
  const orderLog = warnThrough(log);
  const input = {
    snapshot,
    targetRoles,
    confirmedSkills,
    targetLevel,
    geography,
    campaign,
    candidateStore,
    candidateId,
    titleParseStore,
    filters,
    sourceRegistry: cachedMatchedSourceRegistry(engine).registry,
    order: withWantedCompanyOrder(deps, candidateId, sort, orderLog, 'background', targetRoles),
    ...engineListReads(engine),
  };
  const list = await backgroundStep('list:build', () => warmMatchedListCache(input, log));
  if (!list) return;
  requestHeldCheck(engine, list.heldIds, log);
  const { prepareMs, prepareRows, listMs, phasesMs, filtered } = list;
  log?.info(
    { warmFitIdsMs, prepareMs, prepareRows, listMs, phasesMs, rows: filtered.length },
    'matched-list-warmed',
  );
}

/** B797: фоновая сборка ставит скрытые строки в сверку до того, как кандидат откроет список. */
function requestHeldCheck(
  engine: RouteDeps['multiSourceEngine'],
  heldIds: readonly string[],
  log: WarmLog | undefined,
): void {
  if (heldIds.length === 0) return;
  try {
    engine.requestSelectionLiveness?.(heldIds);
  } catch (error: unknown) {
    // База занята: строки поставит следующая сборка или чтение списка.
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    log?.error({ errorName }, 'selection-liveness-request-failed');
  }
}

const rebuildingBehindSealed = new Set<string>();

/**
 * PRB-055: a reader answered from the stored list still needs the real one, for the filters they
 * read with. One build per candidate however many pages they open meanwhile.
 */
export function rebuildBehindSealedList(
  deps: RouteDeps,
  candidateId: string,
  query: unknown,
  log: WarmLog,
): void {
  if (rebuildingBehindSealed.has(candidateId)) return;
  rebuildingBehindSealed.add(candidateId);
  void warmMatchedList(deps, candidateId, log, query)
    .catch((error: unknown) =>
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'matched-list-rebuild-failed',
      ),
    )
    .finally(() => rebuildingBehindSealed.delete(candidateId));
}
