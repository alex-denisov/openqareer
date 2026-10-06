import React, { useEffect, useRef, useState } from 'react';
import '../site/landing.css';
import './auth.css';
import { CoachApiError, type AuthUser } from '../coach/coachApi';
import {
  changeUnverifiedEmail,
  resendEmailVerification,
  verifyEmailCode,
} from '../coach/emailVerificationApi';
import { AuthCardHeader, AuthInputField } from './AuthPages';
import type { AuthPageProps } from './AuthPages';

interface EmailVerificationPageProps extends AuthPageProps {
  session?: AuthUser | null;
}

interface VerificationState {
  code: string;
  newEmail: string;
  currentPassword: string;
  changingAddress: boolean;
  busy: boolean;
  error?: string;
  codeError?: string;
  notice?: string;
  resendAfterSeconds: number;
}

function useEmailVerificationController({
  session,
  onNavigate,
  onSessionChange,
  nextPath,
}: EmailVerificationPageProps) {
  const [state, setState] = useState<VerificationState>({
    code: '',
    newEmail: session?.email ?? '',
    currentPassword: '',
    changingAddress: false,
    busy: false,
    resendAfterSeconds: session?.emailVerificationResendAfterSeconds ?? 0,
  });
  const codeInput = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<VerificationState>) =>
    setState((current) => ({ ...current, ...patch }));

  useEffect(() => {
    update({
      newEmail: session?.email ?? '',
      resendAfterSeconds: session?.emailVerificationResendAfterSeconds ?? 0,
    });
  }, [session?.email, session?.emailVerificationResendAfterSeconds]);

  useEffect(() => {
    if (state.codeError && !state.changingAddress) codeInput.current?.focus();
  }, [state.codeError, state.changingAddress]);

  useEffect(() => {
    if (state.resendAfterSeconds <= 0) return undefined;
    const timer = window.setTimeout(
      () => setState((current) => ({
        ...current,
        resendAfterSeconds: Math.max(0, current.resendAfterSeconds - 1),
      })),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [state.resendAfterSeconds]);

  return { session, onNavigate, onSessionChange, nextPath, state, setState, update, codeInput };
}

type VerificationController = ReturnType<typeof useEmailVerificationController>;
type AuthenticatedController = VerificationController & { session: AuthUser };

function handleCodeSubmit(event: React.FormEvent<HTMLFormElement>, controller: VerificationController) {
  event.preventDefault();
  if (!/^\d{6}$/u.test(controller.state.code)) {
    controller.update({ codeError: 'Введите 6 цифр из письма.' });
    return;
  }
  void submitCode(controller);
}

async function submitCode(controller: VerificationController): Promise<void> {
  controller.update({ busy: true, error: undefined, codeError: undefined });
  try {
    const verified = await verifyEmailCode(controller.state.code);
    controller.onSessionChange?.(verified);
    controller.onNavigate(controller.nextPath ?? '/app');
  } catch (reason) {
    controller.update({
      codeError: reason instanceof CoachApiError
        ? reason.message
        : 'Не удалось проверить код. Попробуйте ещё раз.',
    });
  } finally {
    controller.update({ busy: false });
  }
}

async function resendCode(controller: VerificationController): Promise<void> {
  controller.update({ busy: true, error: undefined, codeError: undefined, notice: undefined });
  try {
    const updated = await resendEmailVerification();
    controller.onSessionChange?.(updated);
    controller.update({
      resendAfterSeconds: updated.emailVerificationResendAfterSeconds ?? 60,
      notice: updated.emailVerificationEmailSent
        ? 'Новый код отправлен на ' + (updated.email ?? 'указанный адрес') + '.'
        : 'Не удалось отправить код. Попробуйте отправить его ещё раз.',
    });
  } catch (reason) {
    controller.update({
      error: reason instanceof CoachApiError
        ? reason.message
        : 'Не удалось отправить код. Попробуйте позже.',
    });
  } finally {
    controller.update({ busy: false });
  }
}

function handleAddressSubmit(
  event: React.FormEvent<HTMLFormElement>,
  controller: VerificationController,
) {
  event.preventDefault();
  void saveAddress(controller);
}

async function saveAddress(controller: VerificationController): Promise<void> {
  controller.update({ busy: true, error: undefined, notice: undefined });
  try {
    const updated = await changeUnverifiedEmail({
      email: controller.state.newEmail.trim(),
      currentPassword: controller.state.currentPassword,
    });
    controller.onSessionChange?.(updated);
    controller.update({
      changingAddress: false,
      currentPassword: '',
      code: '',
      resendAfterSeconds: updated.emailVerificationResendAfterSeconds ?? 0,
      notice: updated.emailVerificationEmailSent
        ? 'Код отправлен на ' + (updated.email ?? controller.state.newEmail.trim()) + '.'
        : 'Не удалось отправить код. Нажмите «Отправить ещё раз».',
    });
  } catch (reason) {
    controller.update({
      error: reason instanceof CoachApiError
        ? reason.message
        : 'Не удалось изменить адрес. Проверьте данные.',
    });
  } finally {
    controller.update({ busy: false });
  }
}

function VerificationMessages({ controller }: { controller: AuthenticatedController }) {
  const { state, session } = controller;
  return (
    <>
      {session.emailVerificationEmailSent === false && !state.changingAddress ? (
        <p className="auth-form-error" role="status">
          Не удалось отправить код. Попробуйте отправить его ещё раз.
        </p>
      ) : null}
      {state.notice ? <p className="auth-notice" role="status">{state.notice}</p> : null}
      {state.error ? <p className="auth-form-error" role="alert">{state.error}</p> : null}
    </>
  );
}

function ChangeAddressForm({ controller }: { controller: AuthenticatedController }) {
  const { state, update } = controller;
  return (
    <form className="auth-form" onSubmit={(event) => handleAddressSubmit(event, controller)}>
      <AuthInputField
        id="verification-new-email"
        name="email"
        label="Новый email"
        type="email"
        autoComplete="email"
        value={state.newEmail}
        onChange={(newEmail) => update({ newEmail })}
        disabled={state.busy}
        required
      />
      <AuthInputField
        id="verification-current-password"
        name="currentPassword"
        label="Текущий пароль"
        type="password"
        autoComplete="current-password"
        value={state.currentPassword}
        onChange={(currentPassword) => update({ currentPassword })}
        disabled={state.busy}
        required
      />
      <button className="site-btn is-primary auth-submit-btn" type="submit" disabled={state.busy}>
        {state.busy ? 'Сохраняем…' : 'Сохранить адрес'}
      </button>
      <button
        className="auth-field-action"
        type="button"
        disabled={state.busy}
        onClick={() => update({ changingAddress: false, error: undefined })}
      >
        Вернуться к коду
      </button>
    </form>
  );
}

function CodeEntry({ controller }: { controller: AuthenticatedController }) {
  const { state } = controller;
  return (
    <div className="auth-field">
      <label htmlFor="verification-code">Код из письма</label>
      <input
        ref={controller.codeInput}
        id="verification-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={state.code}
        onChange={(event) => controller.update({
          code: event.target.value.replace(/\D/gu, '').slice(0, 6),
        })}
        aria-invalid={Boolean(state.codeError)}
        aria-describedby={state.codeError ? 'verification-code-error' : undefined}
        disabled={state.busy}
        required
      />
      {state.codeError ? (
        <p className="auth-field-error" id="verification-code-error" role="alert">
          {state.codeError}
        </p>
      ) : null}
    </div>
  );
}

function VerificationActions({ controller }: { controller: AuthenticatedController }) {
  const { state, update } = controller;
  return (
    <div className="auth-links">
      <button
        type="button"
        disabled={state.busy || state.resendAfterSeconds > 0}
        onClick={() => void resendCode(controller)}
      >
        Отправить ещё раз
      </button>
      {state.resendAfterSeconds > 0 ? (
        <p role="status">Повторная отправка доступна через {state.resendAfterSeconds} с.</p>
      ) : null}
      <button
        type="button"
        disabled={state.busy}
        onClick={() => update({
          changingAddress: true,
          error: undefined,
          newEmail: controller.session?.email ?? '',
        })}
      >
        Изменить адрес
      </button>
    </div>
  );
}

function VerificationCodeForm({ controller }: { controller: AuthenticatedController }) {
  const { state } = controller;
  return (
    <form className="auth-form" onSubmit={(event) => handleCodeSubmit(event, controller)}>
      <CodeEntry controller={controller} />
      <button
        className="site-btn is-primary auth-submit-btn"
        type="submit"
        disabled={state.busy || state.code.length !== 6}
        aria-busy={state.busy}
      >
        {state.busy ? 'Проверяем…' : 'Подтвердить адрес'}
      </button>
      <VerificationActions controller={controller} />
    </form>
  );
}

function VerificationPanel({ controller }: { controller: AuthenticatedController }) {
  const { session, state } = controller;
  const changingAddress = state.changingAddress;
  return (
    <section className="auth-card" aria-labelledby="verification-title">
      <AuthCardHeader
        title={changingAddress ? 'Изменить адрес' : 'Введите код из письма'}
        titleId="verification-title"
        subtitle={changingAddress
          ? 'Укажите новый адрес и текущий пароль.'
          : 'Мы отправили код на ' + (session.email ?? 'ваш адрес') + '. Он действует 15 минут.'}
        onNavigate={controller.onNavigate}
      />
      <VerificationMessages controller={controller} />
      {changingAddress
        ? <ChangeAddressForm controller={controller} />
        : <VerificationCodeForm controller={controller} />}
    </section>
  );
}

function LoadingSessionCard() {
  return (
    <section className="auth-card" aria-label="Проверка сессии" aria-busy="true">
      <p role="status">Проверяем аккаунт…</p>
    </section>
  );
}

function SignedOutCard({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="auth-card" aria-labelledby="verification-title">
      <h1 id="verification-title">Сначала войдите в аккаунт</h1>
      <p>После входа мы проверим адрес электронной почты.</p>
      <button className="site-btn is-primary auth-submit-btn" type="button" onClick={() => onNavigate('/login')}>
        Войти
      </button>
    </section>
  );
}

export function EmailVerificationPage(props: EmailVerificationPageProps) {
  const controller = useEmailVerificationController(props);
  if (props.session === undefined) {
    return <div className="auth-page-container"><LoadingSessionCard /></div>;
  }
  if (!props.session) {
    return <div className="auth-page-container"><SignedOutCard onNavigate={props.onNavigate} /></div>;
  }
  const authenticatedController = { ...controller, session: props.session };
  return (
    <div className="auth-page-container">
      <VerificationPanel controller={authenticatedController} />
    </div>
  );
}
