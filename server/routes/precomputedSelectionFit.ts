import { vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { createSelectionFitSweep, selectionFitLimit, selectionStamp } from './fitSelectionSweep';
import { candidatePlan } from './helpers';
import { requestFitForVacancyIds } from './matchedVacancyFit';
import { finishMatchedVacancies } from './matchedVacancyRoutes';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

/** Its own window: a precompute pass must not stop the sweep a list read started. */
const precomputeSweep = createSelectionFitSweep();
const skipText = () => undefined;

/**
 * 02.11 (prod 4c43fb31): only a list read queued fits. #297 changed every fit input, the 447
 * queued jobs failed `profile_changed`, and with nobody on the list for hours no fit was claimed
 * while rows stayed «пересчитывается». The background precompute now queues the campaign's
 * selection the same way; `requestFitForVacancyIds` skips rows already counted or queued.
 */
export function queuePrecomputedSelectionFit(
  deps: RouteDeps,
  candidateId: string,
  snapshot: readonly MatchedVacancyItem[],
): Promise<void> {
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const ids = finishMatchedVacancies(
    snapshot,
    [...campaign.roles.value],
    campaign,
    deps.candidateStore,
    candidateId,
  )
    .slice(0, selectionFitLimit(candidatePlan(deps, candidateId)))
    .map((item) => item.cluster.id);
  const stamp = vacancyFitProfileStamp(
    deps.candidateStore.getSnapshot(candidateId),
    deps.candidateStore.getCandidateWorkspace(candidateId),
  );
  return precomputeSweep(
    candidateId,
    ids,
    skipText,
    // 04.11: a new algorithm version turns every counted row into `refreshing`; the background pass
    // requeues at most the day's ceiling of them, and of rows whose finished job lost its result to new
    // requirements. Other counting rows and opened cards have no ceiling.
    (chunk, rank) =>
      requestFitForVacancyIds(deps, candidateId, chunk, rank, {}, () => deps.vacancyMechanics?.takeFitRefreshSlot() ?? true),
    `${stamp}|${selectionStamp(ids)}`,
  );
}
