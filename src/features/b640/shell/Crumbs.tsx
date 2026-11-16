import { Icon } from '../kit/Icon';
import { Link } from './Link';
import { backLabel } from './navigation';

export interface Crumb {
  readonly label: string;
  /** У последнего звена адреса нет: это текущий экран. */
  readonly path: string | null;
}

function ContextTrail({
  first,
  contextSlot,
}: {
  readonly first: Crumb;
  readonly contextSlot: (slot: HTMLElement | null) => void;
}) {
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

function BackTrail({ previous }: { readonly previous: Crumb }) {
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
  if (contextSlot) return <ContextTrail first={trail[0]} contextSlot={contextSlot} />;
  if (trail.length === 2) return <BackTrail previous={trail[0]} />;
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
