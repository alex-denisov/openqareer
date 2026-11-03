import type { ComponentProps } from 'react';
import { ResponsesBoard } from '../applications/ResponsesBoard';
import type { useApplications } from '../applications/useApplications';
import type { ProfileTab } from '../resume/profileTabs';
import type { NavigationOptions } from '../shell/pathIndicator';
import type { CareerCabinetView } from './cabinetViews';

interface CabinetResponsesProps {
  readonly tracker: ReturnType<typeof useApplications>;
  readonly navigationOptions?: NavigationOptions;
  readonly onNavigate: (view: CareerCabinetView, options?: NavigationOptions) => void;
  readonly onProfileTabChange: (tab: ProfileTab) => void;
  readonly onOpenAutomation?: () => void;
  readonly onOpenExpert?: ComponentProps<typeof ResponsesBoard>['onOpenExpert'];
}

/** «Отклики» in the cabinet; «Исправить резюме и повторить» lands on the profile's resume tab. */
export function CabinetResponses(props: CabinetResponsesProps) {
  const { navigationOptions, onNavigate, onProfileTabChange } = props;
  return (
    <ResponsesBoard
      state={props.tracker}
      onOpenVacancies={() => onNavigate('opportunities')}
      onOpenCompanyVacancies={(companyName) => onNavigate('opportunities', { companyName })}
      onOpenAutomation={props.onOpenAutomation}
      initialStageFilter={navigationOptions?.stage}
      initialArchiveOpen={navigationOptions?.openArchive}
      initialApplicationId={navigationOptions?.applicationId}
      onOpenExpert={props.onOpenExpert}
      onOpenResume={() => {
        onProfileTabChange('resume');
        onNavigate('profile');
      }}
    />
  );
}
