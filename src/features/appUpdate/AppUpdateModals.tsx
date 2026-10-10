import { ArrowClockwise, DownloadSimple, WarningCircle, X } from '@phosphor-icons/react';
import type { AppUpdateActions, AppUpdateModalType, AppUpdateReleaseInfo } from './appUpdateTypes';

interface ModalProps {
  readonly modal: AppUpdateModalType;
  readonly info: AppUpdateReleaseInfo;
  readonly actions: AppUpdateActions;
  readonly errorMessage?: string;
}

function ModalHeader({ title, onClose }: { readonly title: string; readonly onClose: () => void }) {
  return (
    <div className="career-app-update-modal-header">
      <h3 className="career-app-update-modal-title">{title}</h3>
      <button
        type="button"
        className="career-quiet-button"
        aria-label="Закрыть"
        onClick={onClose}
        data-testid="app-update-modal-close-btn"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function WhatsNewModalContent({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  return (
    <>
      <ModalHeader title={`Что нового в ${info.version}`} onClose={actions.onCloseModal} />
      <div className="career-app-update-modal-body">
        <p className="career-text-muted">
          Размер загрузки {info.downloadSizeMb} МБ. Обновление подписано и проверяется перед установкой. Данные, вход и черновики остаются на месте.
        </p>
        <ul className="career-app-update-log">
          {info.changelog.map((item, idx) => (
            <li key={idx}>
              <span className={`career-app-update-tag is-${item.tag}`}>{item.tagLabel}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        <p className="career-text-muted">
          Версия {info.version}, выпуск {info.releaseDate}. Текущая: {info.currentVersion}.
        </p>
      </div>
      <div className="career-app-update-modal-footer">
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          data-testid="app-update-modal-later-btn"
          onClick={actions.onPostpone}
        >
          Позже
        </button>
        <button
          type="button"
          className="career-primary-button career-btn-sm"
          data-testid="app-update-modal-install-btn"
          onClick={actions.onInstall}
        >
          <DownloadSimple size={16} aria-hidden="true" />
          <span>Установить</span>
        </button>
      </div>
    </>
  );
}

function DownloadingModalContent({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  const percent = info.progressPercent ?? 64;
  const downloaded = info.downloadedMb ?? 24;
  return (
    <>
      <ModalHeader title={`Загружаем версию ${info.version}`} onClose={actions.onCloseModal} />
      <div className="career-app-update-modal-body">
        <div className="career-app-update-progress-row" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <strong>{percent} %</strong>
          <div className="career-app-update-progress-bar">
            <div className="career-app-update-progress-fill" data-percent={percent} />
          </div>
          <span className="career-text-muted">{downloaded} из {info.downloadSizeMb} МБ</span>
        </div>
        <p className="career-text-muted">Можно продолжать работать: установка начнётся только после вашего перезапуска.</p>
      </div>
      <div className="career-app-update-modal-footer">
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          data-testid="app-update-cancel-download-btn"
          onClick={actions.onCancelDownload}
        >
          Отменить загрузку
        </button>
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          data-testid="app-update-minimize-btn"
          onClick={actions.onCloseModal}
        >
          Свернуть
        </button>
      </div>
    </>
  );
}

function ErrorModalContent({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  return (
    <>
      <ModalHeader title="Не удалось загрузить обновление" onClose={actions.onCloseModal} />
      <div className="career-app-update-modal-body">
        <div className="career-app-update-note is-error">
          <WarningCircle size={20} aria-hidden="true" />
          <span>
            Загрузка прервалась: нет связи с сервером обновлений. Работа продолжается на версии {info.currentVersion}, ничего не потеряно.
          </span>
        </div>
        <p className="career-text-muted">Повторная попытка пройдёт автоматически через 10 минут.</p>
      </div>
      <div className="career-app-update-modal-footer">
        <button
          type="button"
          className="career-secondary-button career-btn-sm"
          data-testid="app-update-error-later-btn"
          onClick={actions.onPostpone}
        >
          Позже
        </button>
        <button
          type="button"
          className="career-primary-button career-btn-sm"
          data-testid="app-update-retry-btn"
          onClick={actions.onRetryNow}
        >
          <ArrowClockwise size={16} aria-hidden="true" />
          <span>Повторить сейчас</span>
        </button>
      </div>
    </>
  );
}

function RequiredModalContent({ info, actions }: { readonly info: AppUpdateReleaseInfo; readonly actions: AppUpdateActions }) {
  return (
    <>
      <ModalHeader title="Нужно обновить приложение" onClose={actions.onCloseModal} />
      <div className="career-app-update-modal-body">
        <div className="career-app-update-note">
          <WarningCircle size={20} aria-hidden="true" />
          <span>
            Версия {info.currentVersion} больше не совместима с сервером: она не сможет показать подборку и отклики. Данные в безопасности, обновление занимает около минуты.
          </span>
        </div>
        <ul className="career-app-update-log">
          <li>
            <span className="career-app-update-tag is-required">Нужно</span>
            <span>Обновление до {info.version}, {info.downloadSizeMb} МБ.</span>
          </li>
        </ul>
      </div>
      <div className="career-app-update-modal-footer">
        <button
          type="button"
          className="career-primary-button career-btn-sm"
          data-testid="app-update-force-restart-btn"
          onClick={actions.onForceRestart}
        >
          <DownloadSimple size={16} aria-hidden="true" />
          <span>Обновить и перезапустить</span>
        </button>
      </div>
    </>
  );
}

export function AppUpdateModals({ modal, info, actions }: ModalProps) {
  if (modal === 'none') return null;

  return (
    <div className="career-app-update-modal-backdrop" role="dialog" aria-modal="true">
      <div className="career-app-update-modal-card">
        {modal === 'whats_new' && <WhatsNewModalContent info={info} actions={actions} />}
        {modal === 'downloading' && <DownloadingModalContent info={info} actions={actions} />}
        {modal === 'error' && <ErrorModalContent info={info} actions={actions} />}
        {modal === 'required' && <RequiredModalContent info={info} actions={actions} />}
      </div>
    </div>
  );
}
