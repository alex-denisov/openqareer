import { ArrowClockwise, Check, DownloadSimple, Info, Sparkle } from '@phosphor-icons/react';
import type { AppUpdateActions, AppUpdateReleaseInfo, AppUpdateState } from './appUpdateTypes';

interface BannerProps {
  readonly state: AppUpdateState;
  readonly info: AppUpdateReleaseInfo;
  readonly actions: AppUpdateActions;
  readonly errorMessage?: string;
}

function AvailableBannerActions({ actions }: { readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-actions">
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        data-testid="app-update-whats-new-btn"
        onClick={actions.onWhatsNew}
      >
        Что нового
      </button>
      <button
        type="button"
        className="career-btn is-sm is-primary"
        data-testid="app-update-install-btn"
        onClick={actions.onInstall}
      >
        <DownloadSimple size={16} aria-hidden="true" />
        <span>Установить</span>
      </button>
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        data-testid="app-update-later-btn"
        onClick={actions.onPostpone}
      >
        Позже
      </button>
    </div>
  );
}

function ReadyBannerActions({ actions }: { readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-actions">
      <button
        type="button"
        className="career-btn is-sm is-primary"
        data-testid="app-update-restart-btn"
        onClick={actions.onRestart}
      >
        <ArrowClockwise size={16} aria-hidden="true" />
        <span>Перезапустить</span>
      </button>
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        data-testid="app-update-next-launch-btn"
        onClick={actions.onNextLaunch}
      >
        При следующем запуске
      </button>
    </div>
  );
}

function UpdatedBannerActions({ actions }: { readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-actions">
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        data-testid="app-update-whats-new-btn"
        onClick={actions.onWhatsNew}
      >
        Что нового
      </button>
      <button
        type="button"
        className="career-btn is-sm is-ghost"
        data-testid="app-update-close-btn"
        onClick={actions.onDismissBanner}
      >
        Закрыть
      </button>
    </div>
  );
}

function BannerInfoNotice({ state, version }: { readonly state: AppUpdateState; readonly version: string }) {
  if (state === 'offline') {
    return (
      <div className="career-app-update-note" role="status">
        <Info size={16} aria-hidden="true" />
        <span>Не удалось проверить обновления: нет связи. Проверим снова при подключении, работа не прерывается.</span>
      </div>
    );
  }
  if (state === 'busy_sending') {
    return (
      <div className="career-app-update-note" role="status">
        <Info size={16} aria-hidden="true" />
        <span>Перезапуск отложен: сейчас отправляется отклик на hh.ru. Предложим перезапуститься, когда он завершится.</span>
      </div>
    );
  }
  if (state === 'idle') {
    return (
      <div className="career-app-update-note is-ok" role="status">
        <Check size={16} aria-hidden="true" />
        <span>Установлена последняя версия {version}, проверено сегодня в 09:12.</span>
      </div>
    );
  }
  return null;
}

function AvailableBanner({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-banner" role="status">
      <div className="career-app-update-ico">
        <DownloadSimple size={18} aria-hidden="true" />
      </div>
      <div className="career-app-update-text">
        <strong>Доступна версия {info.version}</strong>
        <p>Установится после перезапуска. Черновики и вход сохранятся.</p>
      </div>
      <AvailableBannerActions actions={actions} />
    </div>
  );
}

/** B359: the download runs inside the banner, no dialog; the size is the archive's megabytes. */
function DownloadingBanner({ info }: { readonly info: AppUpdateReleaseInfo }) {
  const percent = info.progressPercent ?? 0;
  const size = info.downloadSizeMb > 0 ? `, ${info.downloadSizeMb} МБ` : '';
  return (
    <div className="career-app-update-banner" role="status" data-testid="app-update-downloading">
      <div className="career-app-update-ico">
        <DownloadSimple size={18} aria-hidden="true" />
      </div>
      <div className="career-app-update-text">
        <strong>Загружаем версию {info.version}{size}</strong>
        <p>Можно продолжать работать: установка начнётся только после вашего перезапуска.</p>
      </div>
      <div className="career-app-update-progress-row">
        <progress
          className="career-app-update-progress"
          max={100}
          value={percent}
          aria-label={`Загрузка обновления: ${percent} %`}
        />
        <strong className="career-app-update-percent">{percent} %</strong>
      </div>
    </div>
  );
}

function ErrorBanner({ message, actions }: { readonly message?: string; readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-banner is-error" role="alert">
      <div className="career-app-update-ico">
        <Info size={18} aria-hidden="true" />
      </div>
      <div className="career-app-update-text">
        <strong>Не удалось загрузить обновление</strong>
        <p>{message ?? 'Работа продолжается на текущей версии, ничего не потеряно.'}</p>
      </div>
      <div className="career-app-update-actions">
        <button type="button" className="career-btn is-sm is-ghost" onClick={actions.onPostpone}>
          Позже
        </button>
        <button
          type="button"
          className="career-btn is-sm is-primary"
          data-testid="app-update-retry-btn"
          onClick={actions.onRetryNow}
        >
          Повторить сейчас
        </button>
      </div>
    </div>
  );
}

function ReadyBanner({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-banner" role="status">
      <div className="career-app-update-ico">
        <Sparkle size={18} aria-hidden="true" />
      </div>
      <div className="career-app-update-text">
        <strong>Версия {info.version} загружена</strong>
        <p>Перезапуск займёт около 10 секунд. Незавершённые ответы сохранены.</p>
      </div>
      <ReadyBannerActions actions={actions} />
    </div>
  );
}

function UpdatedBanner({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  return (
    <div className="career-app-update-banner is-ok" role="status">
      <div className="career-app-update-ico">
        <Check size={18} aria-hidden="true" />
      </div>
      <div className="career-app-update-text">
        <strong>Обновлено до {info.version}</strong>
        <p>Работа продолжена с места, где вы остановились.</p>
      </div>
      <UpdatedBannerActions actions={actions} />
    </div>
  );
}

export function AppUpdateBanner({ state, info, actions, errorMessage }: BannerProps) {
  if (state === 'offline' || state === 'busy_sending' || state === 'idle') {
    return <BannerInfoNotice state={state} version={info.version} />;
  }
  if (state === 'available') return <AvailableBanner info={info} actions={actions} />;
  if (state === 'downloading') return <DownloadingBanner info={info} />;
  if (state === 'error') return <ErrorBanner message={errorMessage} actions={actions} />;
  if (state === 'ready') return <ReadyBanner info={info} actions={actions} />;
  if (state === 'updated') return <UpdatedBanner info={info} actions={actions} />;
  return null;
}
