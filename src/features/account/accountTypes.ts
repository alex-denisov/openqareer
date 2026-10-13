export type AccountSectionId =
  | 'prof'
  | 'conn'
  | 'notif'
  | 'cons'
  | 'app'
  | 'pay';

export type AccountSection =
  | 'security'
  | 'connections'
  | 'notif'
  | 'data'
  | 'app'
  | 'pay';

export interface AccountDevice {
  readonly id: string;
  readonly kind: 'desktop' | 'globe' | 'device';
  readonly name: string;
  readonly details: string;
  readonly current: boolean;
}

export interface AccountNotificationEvent {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly iconName: string;
  readonly timing: string;
  readonly reason: string;
  readonly app: boolean;
  readonly telegram: boolean;
  readonly email: boolean;
  readonly mandatory?: boolean;
  readonly mandatoryNote?: string;
}

export interface AccountConsent {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly description: string;
  readonly date: string;
  readonly consequences: string;
  readonly capability?: 'profile_activity' | 'digital_footprint' | 'actions_on_behalf';
  readonly status?: 'granted' | 'not-granted' | 'unknown';
  readonly grantable?: boolean;
  readonly revokeable?: boolean;
}

export interface AccountAppSettings {
  readonly version: string;
  readonly commitSha?: string;
  readonly freshnessLine?: string;
  readonly autoUpdate: boolean | null;
  readonly menuBar: boolean | null;
  readonly launchAtLogin: boolean | null;
}

export type MobileAccountViewId =
  | 'home'
  | 'prof'
  | 'dev'
  | 'conn'
  | 'li'
  | 'hh'
  | 'notif'
  | 'cons'
  | 'pay'
  | `ev${number}`;
