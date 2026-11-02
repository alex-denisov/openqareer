import type { ComponentProps } from 'react';
import type { PathDestination } from '../shell/pathIndicator';
import type { VacancyLetterScreen } from './VacancyLetterScreen';

/** What the host screen lends the letter: responses, the resume (lives in Profile) and the consultant. */
export function letterHostProps(input: {
  readonly onOpenResponses?: () => void;
  readonly onOpenExpert?: ComponentProps<typeof VacancyLetterScreen>['onOpenExpert'];
  readonly pathIndicator?: { readonly onNavigate: (destination: PathDestination) => void };
}) {
  const navigate = input.pathIndicator?.onNavigate;
  return {
    onOpenResponses: input.onOpenResponses,
    onOpenExpert: input.onOpenExpert,
    onOpenResume: navigate ? () => navigate('profile') : undefined,
  };
}
