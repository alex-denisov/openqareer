import { useState } from 'react';
import { ArrowSquareOut, LockKey, X } from '@phosphor-icons/react';
import type { ConnectionPlatform } from './platformLabels';
import './connector-session.css';

const ADDRESS: Readonly<Record<ConnectionPlatform, string>> = {
  linkedin: 'https://www.linkedin.com',
  hh: 'https://hh.ru',
};

interface ConnectorSessionToolbarProps {
  readonly platform: ConnectionPlatform;
  readonly onShow: () => Promise<boolean>;
  readonly onCancel: () => void;
}

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
    <div className="career-connector-toolbar" role="group" aria-label="Управление окном входа">
      <p className="career-connector-address" aria-label="Защищённый адрес входа">
        <LockKey size={18} weight="fill" aria-hidden="true" />
        <span>{ADDRESS[platform]}</span>
      </p>
      <div className="career-connector-toolbar-actions">
        <button type="button" className="career-quiet-button" onClick={() => void showWindow()}>
          <ArrowSquareOut size={18} aria-hidden="true" />
          <span>Показать окно входа</span>
        </button>
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          <X size={18} aria-hidden="true" />
          <span>Отмена</span>
        </button>
      </div>
      {showFailed ? (
        <p className="career-modal-error" role="status">
          Окно входа не найдено. Закройте этот экран и подключитесь снова.
        </p>
      ) : null}
    </div>
  );
}
