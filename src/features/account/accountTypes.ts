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
  readonly kind: 'desktop' | 'globe';
  readonly name: string;
  readonly details: string;
  readonly current: boolean;
}

export interface AccountConnection {
  readonly id: 'linkedin' | 'hh' | 'others' | 'email' | 'calendar' | 'telegram';
  readonly name: string;
  readonly details: string;
  readonly status: 'ok' | 'warn' | 'dim';
  readonly statusLabel: string;
  readonly manageable?: boolean;
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
}

export interface AccountAppSettings {
  readonly version: string;
  readonly checkDate: string;
  readonly autoUpdate: boolean;
  readonly menuBar: boolean;
  readonly launchAtLogin: boolean;
}

export interface AccountPaymentItem {
  readonly date: string;
  readonly title: string;
  readonly amount: string;
  readonly method: string;
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
