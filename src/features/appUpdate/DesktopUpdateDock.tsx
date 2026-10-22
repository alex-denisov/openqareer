import '../shell/career-shell.css';
import { AppUpdateContainer } from './AppUpdateContainer';
import { useDesktopUpdater } from './useDesktopUpdater';

/** B359: the live update banner, docked over every screen of the desktop app. */
export function DesktopUpdateDock() {
  const { status, actions } = useDesktopUpdater();
  if (status.state === 'idle' && status.modal === 'none') return null;
  return (
    <div className="career-token-scope career-app-update-dock">
      <AppUpdateContainer status={status} actions={actions} />
    </div>
  );
}
