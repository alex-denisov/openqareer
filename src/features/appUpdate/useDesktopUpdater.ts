import { useSyncExternalStore } from 'react';
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

/** B771: what one check found; `busy` — an update is already found, loading or waiting. */
export type CheckOutcome = 'latest' | 'available' | 'failed' | 'busy';

type Patch = (next: Partial<AppUpdateStatusData>, info?: Partial<AppUpdateReleaseInfo>) => void;

export interface DesktopUpdater {
  readonly getStatus: () => AppUpdateStatusData;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: () => () => void;
  readonly check: () => Promise<CheckOutcome>;
  /** B722: «Обновлять автоматически» — найденная версия скачивается сама и ждёт перезапуска. */
  readonly setAutoInstall: (enabled: boolean) => void;
  readonly actions: AppUpdateActions;
}

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
  return 'Загрузка прервалась. Работа продолжается на текущей версии, ничего не потеряно.';
}

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

/** B359: a background check shortly after launch, then every six hours; returns the stop. */
function scheduleChecks(check: () => Promise<unknown>): () => void {
  const first = window.setTimeout(() => void check(), UPDATE_CHECK_DELAY_MS);
  const repeat = window.setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(repeat);
  };
}

/** One updater per app window: the banner can unmount with its screen, the download goes on. */
export function createDesktopUpdater(): DesktopUpdater {
  let status = IDLE_UPDATER_STATUS;
  let autoInstall = false;
  const listeners = new Set<() => void>();
  const patch: Patch = (next, info) => {
    status = { ...status, ...next, info: { ...status.info, ...info } };
    for (const listener of listeners) listener();
  };

  const check = async (): Promise<CheckOutcome> => {
    if (status.state !== 'idle') return 'busy';
    try {
      const result = await checkForUpdate();
      if (result.status !== 'available') return 'latest';
      patch({ state: 'available', modal: 'none' }, {
        version: result.version,
        currentVersion: result.currentVersion,
        releaseDate: releaseDate(result.date),
        changelog: result.notes ? [{ tag: 'new', tagLabel: 'Новое', text: result.notes }] : [],
      });
      if (autoInstall) await install();
      return 'available';
    } catch {
      // Offline or the feed is unreachable: the background check stays quiet and
      // retries; a check the candidate started says so in place.
      return 'failed';
    }
  };

  const install = async () => {
    patch({ state: 'downloading', modal: 'none', errorMessage: undefined }, { progressPercent: 0, downloadedMb: 0 });
    try {
      await downloadAndInstall((progress) => patch({}, progressInfo(progress)));
      patch({ state: 'ready', modal: 'none' });
    } catch (error: unknown) {
      patch({ state: 'error', modal: 'none', errorMessage: errorText(error) });
    }
  };

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => scheduleChecks(check),
    check,
    setAutoInstall: (enabled) => {
      autoInstall = enabled;
    },
    actions: createActions(patch, install),
  };
}

export const desktopUpdater = createDesktopUpdater();

export function useDesktopUpdater(updater: DesktopUpdater = desktopUpdater) {
  const status = useSyncExternalStore(updater.subscribe, updater.getStatus, updater.getStatus);
  return { status, actions: updater.actions, check: updater.check };
}
