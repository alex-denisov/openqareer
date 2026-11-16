import { Icon } from '../kit/Icon';
import type { B640Nav } from '../routes';
import { Link } from './Link';
import { CONSULTANT_PATH, NOTIFICATIONS_PATH, TARIFFS_PATH } from './navigation';

export interface TopbarProps {
  readonly title: string;
  readonly active: B640Nav | null;
  readonly bellCount: number;
  readonly bellCritical: boolean;
  readonly coachDot: boolean;
  /** Вложенный экран: на 390 слева «Назад» вместо колокольчика. */
  readonly back: { readonly path: string; readonly label: string } | null;
}

function Bell({ className, active, count, critical }: {
  className: string;
  active: boolean;
  count: number;
  critical: boolean;
}) {
  const label = `Уведомления${count ? `, новых: ${count}` : ''}${critical ? ', есть важное' : ''}`;
  return (
    <Link
      className={className}
      to={NOTIFICATIONS_PATH}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name="bell" />
      {count ? (
        <span className={critical ? 'dot num is-crit' : 'dot num'} aria-hidden="true">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Верхняя полоса. 1440 и 1176: заголовок, колокольчик, «Консультант», «Тарифы».
 * 390: «колокольчик или Назад · раздел · консультант», размеры по `--career-ios-*`.
 */
export function Topbar({ title, active, bellCount, bellCritical, coachDot, back }: TopbarProps) {
  const bellActive = active === 'bell';
  return (
    <header className="topbar">
      <div className="mob-left">
        {back ? (
          <Link className="mob-back" to={back.path} aria-label={back.label} title={back.label}>
            <Icon name="back" />
          </Link>
        ) : (
          <Bell
            className="icon-btn bell mob-bell"
            active={bellActive}
            count={bellCount}
            critical={bellCritical}
          />
        )}
      </div>
      <h1>{title}</h1>
      <div className="top-actions">
        <Bell className="icon-btn bell" active={bellActive} count={bellCount} critical={bellCritical} />
        <Link className="btn is-quiet btn-panel" to={CONSULTANT_PATH}>
          <Icon name="chat" />
          Консультант
        </Link>
        <Link
          className="btn is-quiet is-sm"
          to={TARIFFS_PATH}
          aria-current={active === 'tariffs' ? 'page' : undefined}
        >
          <Icon name="wallet" />
          Тарифы
        </Link>
      </div>
      <Link
        className="mob-coach"
        to={CONSULTANT_PATH}
        aria-label={coachDot ? 'Консультант: открыть. Есть предложение' : 'Консультант: открыть'}
      >
        <Icon name="chat" />
        {coachDot ? <span className="mob-coach-dot" aria-hidden="true" /> : null}
      </Link>
    </header>
  );
}
