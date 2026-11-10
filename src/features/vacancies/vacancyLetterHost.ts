import type { ComponentProps } from 'react';
import type { PathDestination } from '../shell/pathIndicator';
import type { VacancyLetterScreen } from './VacancyLetterScreen';
import type { VacancyApplications } from './useVacancyApplications';

/**
 * What the host screen lends the letter: responses, the resume (lives in Profile), the consultant
 * and the response marks — the letter offers «Отметить отправленным» after approval (B629, B631).
 */
export function letterHostProps(input: {
  readonly applications?: VacancyApplications;
  readonly onOpenResponses?: () => void;
  readonly onOpenExpert?: ComponentProps<typeof VacancyLetterScreen>['onOpenExpert'];
  readonly pathIndicator?: { readonly onNavigate: (destination: PathDestination) => void };
}) {
  const navigate = input.pathIndicator?.onNavigate;
  return {
    applications: input.applications,
    onOpenResponses: input.onOpenResponses,
    onOpenExpert: input.onOpenExpert,
    onOpenResume: navigate ? () => navigate('profile') : undefined,
  };
}
