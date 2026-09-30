import { useEffect } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import {
  inspectSessionPage,
  type ManagedSessionKey,
  type SessionInspectionResult,
} from '../connections/connectorSession';
import { sessionWaitingStage, type SessionWaitingStage } from '../connections/sessionWaitingStage';
import { completeAdminLinkedinLogin } from './linkedinPoolApi';

export type ActiveLinkedinLogin = {
  accountId: string;
  sessionKey: ManagedSessionKey;
  handle: string;
};

const ADMIN_WAITING_COPY: Record<SessionWaitingStage, string> = {
  loading: 'Загружаем страницу LinkedIn…',
  login: 'Введите логин и пароль в открытом окне LinkedIn.',
  otp: 'Введите код 2FA в открытом окне LinkedIn.',
  captcha: 'Пройдите CAPTCHA в открытом окне LinkedIn.',
  unrecognised: 'Вход ещё не подтверждён. Откройте свой профиль в окне LinkedIn.',
};

/** The admin closed the LinkedIn window: not a failure, just the end of this check (B325). */
export function isClosedSessionWindow(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.includes('session_window_missing');
}

const TRANSFER_FAILURE_COPY: Record<string, string> = {
  managed_session_window_missing: 'Окно LinkedIn закрыто — откройте его снова и повторите перенос.',
  linkedin_session_cookie_required: 'В окне нет действующего входа LinkedIn (cookie li_at). Войдите заново и повторите.',
  linkedin_session_cookie_read_failed: 'Приложение не смогло прочитать cookies окна LinkedIn. Повторите перенос.',
  linkedin_session_cookie_count_invalid: 'В профиле LinkedIn слишком много cookies. Очистите локальный профиль и войдите заново.',
};

/** Names the real reason a transfer failed instead of a generic line (B325). */
export function transferFailureCopy(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : String(reason);
  return TRANSFER_FAILURE_COPY[code] ?? `Не удалось сохранить сессию на сервере (${code.slice(0, 80)}).`;
}

export function isSafeAdminLinkedinSessionPage(page: SessionInspectionResult): boolean {
  try {
    const url = new URL(page.url);
    const host = url.hostname.toLowerCase();
    return (
      page.ready &&
      page.signedInApplicant &&
      Boolean(page.accountMarker?.trim()) &&
      url.protocol === 'https:' &&
      (host === 'linkedin.com' ||
        host.endsWith('.linkedin.com') ||
        host === 'linkedin.cn' ||
        host.endsWith('.linkedin.cn')) &&
      !page.login &&
      !page.otp &&
      !page.captcha
    );
  } catch {
    return false;
  }
}

// eslint-disable-next-line max-lines-per-function -- owns the complete admin login and retry lifecycle
export function useAdminLinkedinLoginPolling(
  activeLogin: ActiveLinkedinLogin | undefined,
  refresh: () => void,
  setActiveLogin: (value: ActiveLinkedinLogin | undefined) => void,
  setNotice: (value: string | undefined) => void,
  setError: (value: string | undefined) => void,
  setVerifiedSessionAccountId: (value: string | undefined) => void,
  setVerifiedSessionMarker: (value: string | undefined) => void,
): void {
  // eslint-disable-next-line max-lines-per-function -- this effect owns one bounded admin session lifecycle
  useEffect(() => {
    if (!activeLogin) return;
    let cancelled = false;
    let finished = false;
    let inspectionFailures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = async (accountMarker?: string | null) => {
      const account = await completeAdminLinkedinLogin(activeLogin.accountId, activeLogin.handle, {
        state: 'ready',
        ...(accountMarker ? { accountMarker } : {}),
      });
      if (cancelled) return;
      setVerifiedSessionAccountId(activeLogin.accountId);
      setVerifiedSessionMarker(accountMarker ?? undefined);
      finished = true;
      setError(undefined);
      setNotice(`Вход подтверждён для ${account.emailLogin}. Проверьте профиль перед переносом сессии.`);
      refresh();
    };

    const poll = async () => {
      if (cancelled || finished) return;
      let page: SessionInspectionResult;
      try {
        page = await inspectSessionPage('linkedin', activeLogin.sessionKey);
      } catch (reason: unknown) {
        if (cancelled) return;
        if (isClosedSessionWindow(reason)) {
          finished = true;
          setActiveLogin(undefined);
          setError(undefined);
          setNotice('Окно LinkedIn закрыто до подтверждения входа. Нажмите «Проверить в приложении» ещё раз.');
          refresh();
          return;
        }
        inspectionFailures += 1;
        if (inspectionFailures < 12) {
          setNotice('Окно LinkedIn загружается. Повторяем проверку сессии…');
          timer = setTimeout(() => void poll(), 1_000);
          return;
        }
        finished = true;
        setActiveLogin(undefined);
        setError(
          apiErrorMessage(
            reason,
            'Не удалось проверить окно LinkedIn. Оно осталось открытым; повторите проверку в админке.',
          ),
        );
        refresh();
        return;
      }
      if (cancelled || finished) return;
      inspectionFailures = 0;
      if (isSafeAdminLinkedinSessionPage(page)) {
        try {
          await finish(page.accountMarker);
        } catch (reason: unknown) {
          finished = true;
          setActiveLogin(undefined);
          setError(apiErrorMessage(reason, 'Сервер не подтвердил сессию. Повторите вход.'));
          refresh();
        }
        return;
      }
      setNotice(ADMIN_WAITING_COPY[sessionWaitingStage(page)]);
      timer = setTimeout(() => void poll(), 1_000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    activeLogin,
    refresh,
    setActiveLogin,
    setError,
    setNotice,
    setVerifiedSessionAccountId,
    setVerifiedSessionMarker,
  ]);
}
