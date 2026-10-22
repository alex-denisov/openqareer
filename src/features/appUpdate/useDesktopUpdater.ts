import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SignatureVerificationError,
  checkForUpdate,
  downloadAndInstall,
  relaunch,
  type UpdateProgress,
} from './appUpdateBridge';
import type { AppUpdateActions, AppUpdateReleaseInfo, AppUpdateStatusData } from './appUpdateTypes';

/** B359: a background check shortly after launch, then every six hours. */
export const UPDATE_CHECK_DELAY_MS = 15_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MEGABYTE = 1024 * 1024;

const EMPTY_INFO: AppUpdateReleaseInfo = {
  version: '',
  currentVersion: '',
  releaseDate: '',
  downloadSizeMb: 0,
  autoUpdateEnabled: false,
  changelog: [],
};

export const IDLE_UPDATER_STATUS: AppUpdateStatusData = { state: 'idle', modal: 'none', info: EMPTY_INFO };

function releaseDate(date?: string): string {
  const parsed = date ? new Date(date.replace(' ', 'T').replace(/ \+00:00:00$/u, 'Z')) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function progressInfo(progress: UpdateProgress): Partial<AppUpdateReleaseInfo> {
  return {
    progressPercent: progress.progressPercent,
    downloadedMb: Math.round(progress.downloadedBytes / MEGABYTE),
    ...(progress.totalBytes ? { downloadSizeMb: Math.round(progress.totalBytes / MEGABYTE) } : {}),
  };
}

function errorText(error: unknown): string {
  if (error instanceof SignatureVerificationError) return error.message;
  return 'Не удалось загрузить обновление. Проверьте соединение и повторите.';
}

type Patch = (next: Partial<AppUpdateStatusData>, info?: Partial<AppUpdateReleaseInfo>) => void;

function createActions(patch: Patch, install: () => Promise<void>): AppUpdateActions {
  const close = () => patch({ modal: 'none' });
  const dismiss = () => patch({ state: 'idle', modal: 'none' });
  const restart = () => {
    patch({ state: 'restarting', modal: 'none' });
    void relaunch();
  };
  return {
    onInstall: () => void install(),
    onEnableAutoUpdate: () => patch({}, { autoUpdateEnabled: true }),
    onWhatsNew: () => patch({ modal: 'whats_new' }),
    onPostpone: dismiss,
    onRestart: restart,
    onNextLaunch: dismiss,
    onCancelDownload: close,
    onRetryNow: () => void install(),
    onForceRestart: restart,
    onCloseModal: close,
    onDismissBanner: dismiss,
  };
}

/** Drives the update banner from the real Tauri updater; the web build stays idle. */
export function useDesktopUpdater() {
  const [status, setStatus] = useState<AppUpdateStatusData>(IDLE_UPDATER_STATUS);
  const patch = useCallback<Patch>((next, info) => {
    setStatus((prev) => ({ ...prev, ...next, info: { ...prev.info, ...info } }));
  }, []);

  const check = useCallback(async () => {
    try {
      const result = await checkForUpdate();
      if (result.status !== 'available') return;
      patch({ state: 'available', modal: 'none' }, {
        version: result.version,
        currentVersion: result.currentVersion,
        releaseDate: releaseDate(result.date),
        changelog: result.notes ? [{ tag: 'new', tagLabel: 'Новое', text: result.notes }] : [],
      });
    } catch {
      // Offline or the manifest is unreachable: stay quiet, the next check retries.
    }
  }, [patch]);

  const install = useCallback(async () => {
    patch({ state: 'downloading', modal: 'downloading', errorMessage: undefined }, { progressPercent: 0, downloadedMb: 0 });
    try {
      await downloadAndInstall((progress) => patch({}, progressInfo(progress)));
      patch({ state: 'ready', modal: 'none' });
    } catch (error: unknown) {
      patch({ state: 'error', modal: 'error', errorMessage: errorText(error) });
    }
  }, [patch]);

  useEffect(() => {
    const first = window.setTimeout(() => void check(), UPDATE_CHECK_DELAY_MS);
    const repeat = window.setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(repeat);
    };
  }, [check]);

  const actions = useMemo(() => createActions(patch, install), [install, patch]);

  return { status, actions, check };
}
