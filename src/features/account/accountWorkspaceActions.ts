import {
  changePassword,
  deleteCandidateAccount,
  exportCandidateData,
  logout,
  revokeAccountSession,
  revokeOtherSessions,
  updateAccountProfile,
  type AccountSnapshot,
  type AuthUser,
} from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { clearOutreachStore } from '../outreach/outreachTrackingStore';
import { triggerFileDownload } from '../resume/resumeExport';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { requestAccountEmailChange, verifyAccountEmailChange } from './accountEmailChangeApi';
import type { PendingAccountEmailChange } from './accountEmailChangeApi';
import type { CareerAccountViewActions } from './accountViewTypes';

type RunAction = <T>(operation: () => Promise<T>) => Promise<T>;

export interface AccountWorkspaceActionContext {
  readonly runAction: RunAction;
  readonly user: AuthUser;
  readonly applyIdentity: (user: AuthUser) => void;
  readonly refreshAccount: () => Promise<AccountSnapshot>;
  readonly setAccount: (account: AccountSnapshot) => void;
  readonly setPendingEmailChange: (pending: PendingAccountEmailChange | null) => void;
  readonly setNotice: (notice?: string) => void;
  readonly setError: (error?: string) => void;
  readonly setLoading: (loading: boolean) => void;
  readonly onIdentityChange: (user: AuthUser | null) => void;
  readonly onClose: () => void;
}

export function createAccountWorkspaceActions(
  context: AccountWorkspaceActionContext,
): CareerAccountViewActions {
  return {
    ...profileActions(context),
    ...emailActions(context),
    ...sessionActions(context),
    ...dataActions(context),
  };
}

function profileActions(context: AccountWorkspaceActionContext) {
  return {
    async saveDisplayName(displayName: string) {
      const account = await context.runAction(() => updateAccountProfile({ displayName }));
      context.setAccount(account);
      context.applyIdentity({ ...context.user, displayName: account.displayName });
      context.setNotice('Имя сохранено.');
    },
    async saveTimezone(timezone: string | null) {
      context.setAccount(await context.runAction(() => updateAccountProfile({ timezone })));
      context.setNotice('Часовой пояс сохранён.');
    },
    async changePassword(input: { currentPassword: string; newPassword: string }) {
      context.applyIdentity(await context.runAction(() => changePassword(input)));
      context.setNotice('Пароль изменён. Остальные сессии завершены.');
    },
  };
}

function emailActions(context: AccountWorkspaceActionContext) {
  return {
    async requestEmailChange(email: string, currentPassword: string) {
      const result = await context.runAction(() => requestAccountEmailChange({ email, currentPassword }));
      if (result.status === 'pending') {
        const pending = {
          email: result.email,
          expiresAt: result.expiresAt,
          resendAfterSeconds: result.resendAfterSeconds,
        };
        context.setPendingEmailChange(pending);
        context.setNotice(`Код отправлен на ${result.email}.`);
        return pending;
      }
      const { status: _status, ...user } = result;
      context.applyIdentity(user);
      await context.refreshAccount();
      context.setPendingEmailChange(null);
      context.setNotice('Адрес электронной почты изменён.');
      return null;
    },
    async verifyEmailChange(code: string) {
      context.applyIdentity(await context.runAction(() => verifyAccountEmailChange(code)));
      await context.refreshAccount();
      context.setNotice('Новый адрес подтверждён.');
    },
  };
}

function sessionActions(context: AccountWorkspaceActionContext) {
  return {
    async terminateSession(sessionId: string) {
      await context.runAction(() => revokeAccountSession(sessionId));
      await context.refreshAccount();
      context.setNotice('Сессия завершена.');
    },
    async terminateOtherSessions() {
      const revoked = await context.runAction(() => revokeOtherSessions());
      await context.refreshAccount();
      context.setNotice(`Завершено сессий: ${revoked}. Текущая сессия сохранена.`);
    },
  };
}

function dataActions(context: AccountWorkspaceActionContext) {
  return {
    async exportData() {
      const data = await context.runAction(() => exportCandidateData());
      const path = await triggerFileDownload(
        'openqareer-candidate-export.json',
        JSON.stringify(data, null, 2),
        'application/json;charset=utf-8',
      );
      if (path) context.setNotice(`Сохранено: ${path}`);
      else if (!isTauriEnvironment()) context.setNotice('Экспорт загружен в браузере.');
    },
    async deleteAccount() {
      await context.runAction(() => deleteCandidateAccount());
      closeAccountSession(context);
    },
    async signOut() {
      await context.runAction(() => logout());
      closeAccountSession(context);
    },
    async refresh() {
      await refreshAccountWithStatus(context);
    },
  };
}

function closeAccountSession(context: AccountWorkspaceActionContext) {
  clearOutreachStore(context.user.candidateId ?? undefined);
  context.onIdentityChange(null);
  context.onClose();
}

async function refreshAccountWithStatus(context: AccountWorkspaceActionContext) {
  context.setLoading(true);
  context.setError(undefined);
  try {
    await context.refreshAccount();
  } catch (reason) {
    context.setError(apiErrorMessage(reason, 'Не удалось загрузить настройки аккаунта.'));
  } finally {
    context.setLoading(false);
  }
}
