import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { AccountSnapshot, AuthUser, CandidateConnection } from '../coach/coachApi';
import type { PendingAccountEmailChange } from './accountEmailChangeApi';
import type {
  AccountAppSettings,
  AccountConsent,
  AccountDevice,
  AccountSectionId,
  MobileAccountViewId,
} from './accountTypes';

export interface CareerAccountViewActions {
  readonly saveDisplayName: (displayName: string) => Promise<void>;
  readonly requestEmailChange: (
    email: string,
    currentPassword: string,
  ) => Promise<PendingAccountEmailChange | null>;
  readonly verifyEmailChange: (code: string) => Promise<void>;
  readonly saveTimezone: (timezone: string | null) => Promise<void>;
  readonly changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  readonly terminateSession: (sessionId: string) => Promise<void>;
  readonly terminateOtherSessions: () => Promise<void>;
  readonly exportData: () => Promise<void>;
  readonly deleteAccount: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export interface CareerAccountViewProps {
  readonly user: AuthUser;
  readonly account?: AccountSnapshot;
  readonly connections?: readonly CandidateConnection[];
  readonly onConnectionsChange?: (connections: CandidateConnection[]) => void;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly pendingEmailChange: PendingAccountEmailChange | null;
  readonly initialSection: AccountSectionId;
  readonly initialMobileView?: MobileAccountViewId;
  readonly isDesktopApp: boolean;
  readonly isMobile: boolean;
  readonly onClose: () => void;
  readonly onDataChanged?: () => void;
  readonly onOpenTariffs?: () => void;
  readonly actions: CareerAccountViewActions;
}

export type AccountDialogState =
  | { readonly type: 'terminate-session'; readonly device: AccountDevice }
  | { readonly type: 'terminate-others' }
  | { readonly type: 'consent'; readonly consent: AccountConsent }
  | { readonly type: 'delete-account' }
  | { readonly type: 'sign-out' }
  | { readonly type: 'edit-name' }
  | { readonly type: 'edit-email' }
  | { readonly type: 'change-password' }
  | { readonly type: 'edit-timezone' }
  | null;

export interface AccountTab {
  readonly id: AccountSectionId;
  readonly label: string;
}

export interface AccountViewModel {
  readonly props: CareerAccountViewProps;
  readonly appTabAvailable: boolean;
  readonly section: AccountSectionId;
  readonly mobileView: MobileAccountViewId;
  readonly tabs: readonly AccountTab[];
  readonly displayName: string | null;
  readonly email: string | null;
  readonly devices: readonly AccountDevice[];
  readonly connectionCount: string | null;
  readonly appSettings: AccountAppSettings;
  readonly notificationsContent: ReactNode;
  readonly connectionsContent: ReactNode;
  readonly consents: readonly AccountConsent[];
  readonly consentLoading: boolean;
  readonly consentBusyId: string | null;
  readonly consentStatus: string | null;
  readonly dialog: AccountDialogState;
  readonly dialogError?: string;
  readonly tabsRef: RefObject<HTMLDivElement>;
  readonly onCloseDialog: () => void;
  readonly onOpenDialog: (dialog: Exclude<AccountDialogState, null>) => void;
  readonly onSelectSection: (section: AccountSectionId) => void;
  readonly onGoView: (view: MobileAccountViewId) => void;
  readonly onTabKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  readonly onToggleConsent: (consent: AccountConsent) => void;
  readonly onConfirmConsent: (consent: AccountConsent) => Promise<void>;
  readonly onError: (message?: string) => void;
}
