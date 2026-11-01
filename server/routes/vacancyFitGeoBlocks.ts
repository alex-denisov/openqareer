import type { VacancyFitView } from '../../shared/vacancyFit';
import { parseVacancyLocation } from '../../shared/locationTree';
import { geoConditionBlocks, type GeoConditionContext } from '../domain/vacancyGeoConditions';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import type { readVacancyFitTarget } from './vacancyFitContext';

type FitTarget = NonNullable<ReturnType<typeof readVacancyFitTarget>>;

/** Campaign cities, remote from home, and where the candidate lives (02.11 audit). */
function geoContext(deps: RouteDeps, candidateId: string): GeoConditionContext | null {
  const geography = readCampaign(deps.candidateStore, candidateId).careerGeography;
  if (!geography) return null;
  const location =
    deps.candidateStore.getSnapshot(candidateId)?.resume?.draft.candidate.contact?.location;
  const home = location ? parseVacancyLocation({ location })?.country : undefined;
  const remoteFromRussia = geography.remote && geography.regions.includes('ru');
  return {
    places: geography.places,
    countries: [...(remoteFromRussia ? ['Россия'] : []), ...(home ? [home] : [])],
    ...(location ? { candidateLocation: location } : {}),
  };
}

/**
 * A counted row whose vacancy states an onsite city or a country-only remote the candidate fails
 * gets «Не подходит по условиям»; the percent stays skill coverage, the order puts it last.
 */
export function createGeoBlocker(
  deps: RouteDeps,
  candidateId: string,
): (target: FitTarget, view: VacancyFitView) => VacancyFitView {
  const geo = geoContext(deps, candidateId);
  return (target, view) => {
    if (!geo || !view.result) return view;
    const blocks = geoConditionBlocks(target, geo);
    if (!blocks.length) return view;
    const known = view.result.conditionBlocks ?? [];
    return { ...view, result: { ...view.result, conditionBlocks: [...known, ...blocks] } };
  };
}
