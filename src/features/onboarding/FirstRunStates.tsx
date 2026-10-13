import type { ReactElement } from 'react';
import { ArrowsClockwise, CircleNotch, Info, SignIn, WarningCircle } from '@phosphor-icons/react';

export function FirstRunSkeleton(): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-skeleton">
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--career-color-sub, #475569)' }}>
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
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--career-color-sub, #475569)' }}>
          <CircleNotch size={20} className="career-spin" />
          <span>Читаем LinkedIn: раздел 2 из 5</span>
        </div>
        <p style={{ fontSize: 'var(--career-text-xs, 12px)', color: 'var(--career-color-muted, #94a3b8)', marginTop: '8px' }}>
          Подпись называет субъект и шаг, а не «Собираем».
        </p>
      </div>
    </div>
  );
}

export function FirstRunErrorState({ onRetry }: { readonly onRetry?: () => void }): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-error-state">
      <div style={{ padding: '32px', maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--career-color-danger-surface, #fef2f2)',
            color: 'var(--career-color-danger, #b91c1c)',
            padding: '12px 16px',
            borderRadius: 'var(--career-radius-card, 12px)',
            marginBottom: '16px',
            fontSize: 'var(--career-text-sm, 14px)',
          }}
        >
          <WarningCircle size={20} />
          <span>Не удалось войти: сервер не ответил. Данные не потеряны.</span>
        </div>
        <button
          type="button"
          className="first-run-btn-primary"
          onClick={onRetry}
          data-testid="error-retry-btn"
        >
          <ArrowsClockwise size={16} />
          Повторить
        </button>
      </div>
    </div>
  );
}

export function FirstRunSessionExpired({ onSignIn }: { readonly onSignIn?: () => void }): ReactElement {
  return (
    <div className="first-run-screen" data-testid="first-run-session-expired">
      <div style={{ padding: '32px', maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--career-color-surface-subtle, #f1f5f9)',
            color: 'var(--career-color-text, #0f172a)',
            padding: '12px 16px',
            borderRadius: 'var(--career-radius-card, 12px)',
            marginBottom: '16px',
            fontSize: 'var(--career-text-sm, 14px)',
          }}
        >
          <Info size={20} />
          <span>Вход устарел. Войдите снова, один раз для всего приложения.</span>
        </div>
        <button
          type="button"
          className="first-run-btn-primary"
          onClick={onSignIn}
          data-testid="session-signin-btn"
        >
          <SignIn size={16} />
          Войти
        </button>
      </div>
    </div>
  );
}

export function FirstRunEmptySources({ onConsultant }: { readonly onConsultant?: () => void }): ReactElement {
  return (
    <div style={{ padding: '16px', background: 'var(--career-color-surface-subtle, #f8fafc)', borderRadius: '12px' }} data-testid="first-run-empty-sources">
      <p style={{ margin: '0 0 12px', fontSize: 'var(--career-text-sm, 13px)' }}>
        Источник не выбран. Можно рассказать консультанту, профиль соберётся из ответов.
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

export function FirstRunPartialSourceBanner(): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 14px',
        background: 'var(--career-color-primary-surface, #f0f9ff)',
        color: 'var(--career-color-primary, #0369a1)',
        borderRadius: '10px',
        fontSize: 'var(--career-text-xs, 12px)',
        marginBottom: '12px',
      }}
      data-testid="first-run-partial-banner"
    >
      <Info size={16} />
      <span>LinkedIn подключён, hh.ru нет: доступно после подключения hh.ru.</span>
    </div>
  );
}
