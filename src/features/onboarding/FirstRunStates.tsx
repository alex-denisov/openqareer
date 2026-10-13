import type { ReactElement } from 'react';
import { ArrowsClockwise, CircleNotch, Info, SignIn, WarningCircle } from '@phosphor-icons/react';

export function FirstRunSkeleton(): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-skeleton">
      <div className="first-run-state-container">
        <div className="first-run-state-status">
          <CircleNotch size={20} className="career-spin" />
          <span>Проверяем вход и читаем ваш профиль</span>
        </div>
      </div>
    </div>
  );
}

export function FirstRunStaleLoading(): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-stale-loading">
      <div className="first-run-state-container">
        <div className="first-run-state-status">
          <CircleNotch size={20} className="career-spin" />
          <span>Подготавливаем данные профиля</span>
        </div>
        <p className="first-run-state-caption">Этот шаг может занять больше времени.</p>
      </div>
    </div>
  );
}

export function FirstRunErrorState({ onRetry }: { readonly onRetry?: () => void }): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-error-state">
      <div className="first-run-state-container is-error">
        <div className="first-run-state-message is-error" role="alert">
          <WarningCircle size={20} />
          <span>Не удалось войти: сервер не ответил. Данные не потеряны.</span>
        </div>
        {onRetry ? (
          <button
            type="button"
            className="first-run-btn-primary"
            onClick={onRetry}
            data-testid="error-retry-btn"
          >
            <ArrowsClockwise size={16} />
            Повторить
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function FirstRunSessionExpired({
  onSignIn,
}: {
  readonly onSignIn?: () => void;
}): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-session-expired">
      <div className="first-run-state-container is-error">
        <div className="first-run-state-message">
          <Info size={20} />
          <span>Вход устарел. Войдите снова, один раз для всего приложения.</span>
        </div>
        {onSignIn ? (
          <button
            type="button"
            className="first-run-btn-primary"
            onClick={onSignIn}
            data-testid="session-signin-btn"
          >
            <SignIn size={16} />
            Войти
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function FirstRunEmptySources({
  onConsultant,
}: {
  readonly onConsultant: () => void;
}): ReactElement {
  return (
    <div className="first-run-empty-sources" data-testid="first-run-empty-sources">
      <p>
        Источник не выбран. Можно продолжить с указанной целью и контекстом, а файл или подключение
        добавить позже.
      </p>
      <button
        type="button"
        className="first-run-btn-primary"
        onClick={onConsultant}
        data-testid="empty-consultant-btn"
      >
        Рассказать консультанту
      </button>
    </div>
  );
}
