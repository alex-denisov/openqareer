import { useCallback, useMemo, useState } from 'react';
import { INITIAL_UPDATE_STATUS } from './appUpdateModel';
import type {
  AppUpdateActions,
  AppUpdateModalType,
  AppUpdateReleaseInfo,
  AppUpdateState,
  AppUpdateStatusData,
} from './appUpdateTypes';

function createUpdateActions(
  setStatus: React.Dispatch<React.SetStateAction<AppUpdateStatusData>>,
  closeModal: () => void,
): AppUpdateActions {
  return {
    onInstall: () => setStatus((prev) => ({ ...prev, state: 'downloading', modal: 'downloading' })),
    onEnableAutoUpdate: () => setStatus((prev) => ({
      ...prev,
      info: { ...prev.info, autoUpdateEnabled: true },
    })),
    onWhatsNew: () => setStatus((prev) => ({ ...prev, modal: 'whats_new' })),
    onPostpone: closeModal,
    onRestart: () => setStatus((prev) => ({ ...prev, state: 'updated', modal: 'none' })),
    onNextLaunch: () => setStatus((prev) => ({ ...prev, state: 'idle', modal: 'none' })),
    onCancelDownload: () => setStatus((prev) => ({ ...prev, state: 'available', modal: 'none' })),
    onRetryNow: () => setStatus((prev) => ({ ...prev, state: 'downloading', modal: 'downloading' })),
    onForceRestart: () => setStatus((prev) => ({ ...prev, state: 'updated', modal: 'none' })),
    onCloseModal: closeModal,
    onDismissBanner: () => setStatus((prev) => ({ ...prev, state: 'idle' })),
  };
}

export function useAppUpdate(initialStatus?: Partial<AppUpdateStatusData>) {
  const [status, setStatus] = useState<AppUpdateStatusData>(() => ({
    ...INITIAL_UPDATE_STATUS,
    ...initialStatus,
    info: {
      ...INITIAL_UPDATE_STATUS.info,
      ...(initialStatus?.info ?? {}),
    },
  }));

  const setState = useCallback((nextState: AppUpdateState) => {
    setStatus((prev) => ({ ...prev, state: nextState }));
  }, []);

  const openModal = useCallback((modal: AppUpdateModalType) => {
    setStatus((prev) => ({ ...prev, modal }));
  }, []);

  const closeModal = useCallback(() => {
    setStatus((prev) => ({ ...prev, modal: 'none' }));
  }, []);

  const updateInfo = useCallback((patch: Partial<AppUpdateReleaseInfo>) => {
    setStatus((prev) => ({ ...prev, info: { ...prev.info, ...patch } }));
  }, []);

  const actions = useMemo(
    () => createUpdateActions(setStatus, closeModal),
    [closeModal],
  );

  return {
    status,
    setState,
    openModal,
    closeModal,
    updateInfo,
    actions,
  };
}

