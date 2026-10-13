export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'restarting'
  | 'updated'
  | 'offline'
  | 'busy_sending'
  | 'error'
  | 'required';

export type AppUpdateModalType = 'none' | 'whats_new' | 'downloading' | 'error' | 'required';

export interface ChangelogItem {
  readonly tag: 'fixed' | 'new' | 'improved' | 'required';
  readonly tagLabel: string;
  readonly text: string;
}

export interface AppUpdateReleaseInfo {
  readonly version: string;
  readonly currentVersion: string;
  readonly releaseDate: string;
  readonly downloadSizeMb: number;
  readonly downloadedMb?: number;
  readonly progressPercent?: number;
  readonly autoUpdateEnabled: boolean;
  readonly isMandatory?: boolean;
  readonly changelog: readonly ChangelogItem[];
}

export interface AppUpdateStatusData {
  readonly state: AppUpdateState;
  readonly modal: AppUpdateModalType;
  readonly info: AppUpdateReleaseInfo;
  readonly errorMessage?: string;
}

export interface AppUpdateActions {
  readonly onInstall: () => void;
  readonly onEnableAutoUpdate: () => void;
  readonly onWhatsNew: () => void;
  readonly onPostpone: () => void;
  readonly onRestart: () => void;
  readonly onNextLaunch: () => void;
  readonly onCancelDownload: () => void;
  readonly onRetryNow: () => void;
  readonly onForceRestart: () => void;
  readonly onCloseModal: () => void;
  readonly onDismissBanner: () => void;
}
