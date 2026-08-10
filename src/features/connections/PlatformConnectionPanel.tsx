import { PLATFORM_LABELS, type ConnectionPlatform } from './connectionResult';

interface PlatformConnectionPanelProps {
  platform: ConnectionPlatform;
  busy?: boolean;
  onConnect?: () => void;
}

/**
 * The consent copy states what the connection actually reads. LinkedIn
 * self-service access returns lite identity only, so this panel must never
 * imply a career-history import or an identity check.
 */
export function PlatformConnectionPanel({
  platform,
  busy = false,
  onConnect,
}: PlatformConnectionPanelProps) {
  const label = PLATFORM_LABELS[platform];
  return (
    <div className="career-connection-panel">
      <p>{capabilityCopy(platform)}</p>
      <button
        className="career-quiet-button"
        type="button"
        disabled={busy}
        onClick={onConnect}
      >
        {busy ? 'Готовим подключение…' : `Подключить ${label}`}
      </button>
      <small>
        Вы подтверждаете доступ на стороне {label} и можете отключить его в любой
        момент. Ничего не читается до вашего согласия.
      </small>
    </div>
  );
}

function capabilityCopy(platform: ConnectionPlatform): string {
  return platform === 'linkedin'
    ? 'Официальный вход LinkedIn отдаёт только базовые поля профиля: он не переносит карьерную историю и не подтверждает личность. Опыт по-прежнему берётся из вашего экспорта LinkedIn или PDF.'
    : 'Официальный доступ hh.ru читает ваш профиль и резюме. Мы не выполняем действий от вашего имени: ни откликов, ни правок резюме.';
}
