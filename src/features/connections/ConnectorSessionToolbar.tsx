import { useState } from 'react';
import { ArrowSquareOut, SpinnerGap, X } from '@phosphor-icons/react';
import type { ConnectionPlatform } from './platformLabels';
import './connector-session.css';

interface ConnectorSessionToolbarProps {
  readonly platform: ConnectionPlatform;
  readonly onShow: () => Promise<boolean>;
  readonly onCancel: () => void;
}

/**
 * Mockup 12 (B464): the platform page lives in its own native window; here the
 * candidate sees only that we are waiting for the sign-in, with «Показать окно»
 * and «Отмена». No address line, nothing drawn over the platform's page.
 */
export function ConnectorSessionToolbar({
  platform,
  onShow,
  onCancel,
}: ConnectorSessionToolbarProps) {
  const [showFailed, setShowFailed] = useState(false);

  async function showWindow() {
    const shown = await onShow().catch(() => false);
    setShowFailed(!shown);
  }

  return (
    <div
      className="career-connector-toolbar"
      role="group"
      aria-label="Окно входа"
      data-platform={platform}
    >
      <p className="career-connector-hint">
        Войдите в открывшемся окне. Пароль вводится на странице площадки, мы его не видим.
      </p>
      <div className="career-connector-toolbar-actions">
        <span className="career-connector-waiting-label" role="status">
          <SpinnerGap size={16} className="spin" aria-hidden="true" />
          Ждём вход
        </span>
        <button type="button" className="career-quiet-button" onClick={() => void showWindow()}>
          <ArrowSquareOut size={18} aria-hidden="true" />
          <span>Показать окно</span>
        </button>
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          <X size={18} aria-hidden="true" />
          <span>Отмена</span>
        </button>
      </div>
      {showFailed ? (
        <p className="career-modal-error" role="status">
          Окно входа не найдено. Нажмите «Отмена» и подключитесь снова.
        </p>
      ) : null}
    </div>
  );
}
