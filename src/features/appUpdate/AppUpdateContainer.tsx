import { AppUpdateBanner } from './AppUpdateBanner';
import { AppUpdateModals } from './AppUpdateModals';
import type { AppUpdateActions, AppUpdateStatusData } from './appUpdateTypes';

if (typeof document !== 'undefined') {
  void import('./appUpdate.css');
}

export interface AppUpdateContainerProps {
  readonly status: AppUpdateStatusData;
  readonly actions: AppUpdateActions;
}

export function AppUpdateContainer({ status, actions }: AppUpdateContainerProps) {
  return (
    <div className="career-app-update-container">
      <AppUpdateBanner state={status.state} info={status.info} actions={actions} />
      <AppUpdateModals
        modal={status.modal}
        info={status.info}
        actions={actions}
        errorMessage={status.errorMessage}
      />
    </div>
  );
}
