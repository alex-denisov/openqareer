import { isTauriEnvironment } from './appUpdateBridge';
import { AppUpdateBanner } from './AppUpdateBanner';
import { AppUpdateModals } from './AppUpdateModals';
import { useDesktopUpdater } from './useDesktopUpdater';

if (typeof document !== 'undefined') {
  void import('./appUpdate.css');
}

/** B359, mockup 16: the update strip at the top of «Сегодня»; the download runs inside it. */
export function DesktopUpdateStrip() {
  const { status, actions } = useDesktopUpdater();
  if (!isTauriEnvironment() || status.state === 'idle') return null;
  return (
    <>
      <AppUpdateBanner state={status.state} info={status.info} actions={actions} errorMessage={status.errorMessage} />
      {status.modal === 'whats_new' ? (
        <AppUpdateModals modal="whats_new" info={status.info} actions={actions} />
      ) : null}
    </>
  );
}
