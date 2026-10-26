import type { CoachTurnInput } from '../domain/coach';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';

type CareerContext = NonNullable<CoachTurnInput['careerContext']>;

/**
 * Что сейчас стоит на «Карьере»: роли подбора и условия поиска. Без этого
 * консультант не мог предложить убрать роль или поднять зарплатный порог —
 * он не знал, что там записано (замечание владельца 26.10).
 */
export function buildCoachCareerContext(
  deps: Pick<RouteDeps, 'candidateStore'>,
  candidateId: string,
): CareerContext {
  const roles = [...readCampaign(deps.candidateStore, candidateId).roles.value];
  const profile = deps.candidateStore.decisionProfileRepo?.get(candidateId) ?? null;
  const workFormats = new Set(profile?.workFormats ?? []);
  const formats: CareerContext['formats'] = [
    ...(workFormats.has('office') ? (['office'] as const) : []),
    ...(workFormats.has('home_market') ? (['hybrid'] as const) : []),
    ...(workFormats.has('remote_home') || workFormats.has('remote_abroad')
      ? (['remote'] as const)
      : []),
  ];
  return {
    roles: roles.slice(0, 20),
    locations: [...(profile?.searchLocations ?? [])].slice(0, 20),
    salaryFloorRubles: profile?.salaryFloor ?? null,
    formats,
    relocation: workFormats.has('relocation'),
  };
}
