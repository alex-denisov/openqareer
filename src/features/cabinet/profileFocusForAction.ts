import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import type { ProfileFocusRequest } from '../resume/profileMobileNavigation';

/** Куда ведёт решение дня на «Профиле»: явный фокус решения или первое замечание проверки. */
export function profileFocusForAction(
  action: ReasonedCareerAction,
): ProfileFocusRequest | undefined {
  if (action.profileFocus) return action.profileFocus;
  const findingId = action.findingIds[0];
  if (!findingId) return undefined;
  return { section: findingId.startsWith('ats-layout-') ? 'ats' : 'review', findingId };
}
