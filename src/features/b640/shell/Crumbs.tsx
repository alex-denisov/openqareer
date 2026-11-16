import { Icon } from '../kit/Icon';
import { Link } from './Link';
import { backLabel } from './navigation';

export interface Crumb {
  readonly label: string;
  /** У последнего звена адреса нет: это текущий экран. */
  readonly path: string | null;
}

/**
 * Путь вложенного экрана на 1440 и 1176. Три звена и больше — крошки,
 * два — ссылка «Назад к …». На 390 пути нет: «Назад» стоит в шапке.
 */
export function Crumbs({
  trail,
  contextSlot,
}: {
  readonly trail: readonly Crumb[];
  /** Шапка контекста встаёт в путь вместо средних звеньев. */
  readonly contextSlot?: (slot: HTMLElement | null) => void;
}) {
  if (trail.length < 2) return null;
  if (contextSlot) {
    const [first] = trail;
    return (
      <nav className="crumbs only-desk has-ctx" aria-label="Путь">
        <ol>
          <li>
            {first.path ? <Link to={first.path}>{first.label}</Link> : <span>{first.label}</span>}
            <Icon name="right" />
          </li>
          <li ref={contextSlot} />
        </ol>
      </nav>
    );
  }
  if (trail.length === 2) {
    const [previous] = trail;
    if (!previous.path) return null;
    return (
      <nav className="crumbs only-desk" aria-label="Путь">
        <Link className="crumb-back" to={previous.path}>
          <Icon name="back" />
          {backLabel(previous.label)}
        </Link>
      </nav>
    );
  }
  return (
    <nav className="crumbs only-desk" aria-label="Путь">
      <ol>
        {trail.map((crumb, index) => (
          <li key={`${index}-${crumb.label}`}>
            {crumb.path && index < trail.length - 1 ? (
              <>
                <Link to={crumb.path}>{crumb.label}</Link>
                <Icon name="right" />
              </>
            ) : (
              <span aria-current="page">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
