import type { RouteDeps } from './deps';
import { readCampaign } from './campaignContext';
import { withWantedCompanyOrder } from './matchedVacancyFit';
import { warmMatchedListCache } from './matchedVacancyList';
import { readSortedFilters } from './matchedVacancySort';
import { readTargetLevel } from './vacancyRoleContext';
import { matchGeographyOf } from '../vacancies/matchGeography';
import { readMatchedSnapshot, readMatchProfile } from '../vacancies/matchedPoolContext';
import { matchedVacancySourceRegistry } from '../vacancies/matchedVacancyFacets';

interface WarmLog {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * The read of a candidate opening the cabinet, without a request: no filters and the saved sort.
 * It has to land on the address that read looks for (`matchedListWarm.test.ts` holds that).
 */
export async function warmMatchedList(
  deps: RouteDeps,
  candidateId: string,
  log: WarmLog | undefined,
): Promise<void> {
  const { candidateStore, multiSourceEngine: engine, titleParseStore } = deps;
  const warmStartedAt = performance.now();
  await deps.vacancyMechanics?.warmCachedVacancyIds?.(candidateId);
  const warmFitIdsMs = Math.round(performance.now() - warmStartedAt);
  const { filters, sort } = readSortedFilters(deps, candidateId, {});
  const { confirmedSkills } = readMatchProfile(candidateStore, candidateId);
  const campaign = readCampaign(candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  const targetLevel = readTargetLevel(candidateStore, candidateId, targetRoles);
  const geography = matchGeographyOf(campaign.careerGeography);
  const snapshot = await readMatchedSnapshot(
    engine,
    candidateId,
    confirmedSkills,
    targetRoles,
    targetLevel,
    geography,
  );
  const orderLog = {
    warn: (details: Record<string, unknown>, message: string) => log?.error(details, message),
  };
  const list = await warmMatchedListCache({
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
    sourceRegistry: matchedVacancySourceRegistry(engine.getSources?.() ?? []),
    order: withWantedCompanyOrder(deps, candidateId, sort, orderLog, 'background'),
    ...(typeof engine.getCatalogTotals === 'function'
      ? { catalogTotals: () => engine.getCatalogTotals!() }
      : {}),
  });
  if (!list) return;
  const { prepareMs, prepareRows, listMs, filtered } = list;
  log?.info(
    { warmFitIdsMs, prepareMs, prepareRows, listMs, rows: filtered.length },
    'matched-list-warmed',
  );
}
