import { Icon } from '../kit/Icon';
import { B640_HOME_PATH, type B640Nav } from '../routes';
import { BrandMark } from './BrandMark';
import { Link } from './Link';
import { RAIL_ACCOUNT, RAIL_ITEMS, type NavItem } from './navigation';

function RailLink({ item, active, className }: { item: NavItem; active: boolean; className: string }) {
  return (
    <Link
      className={className}
      to={item.path}
      aria-label={item.ariaLabel}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

/** Рейл 1440 и 1176: знак, шесть разделов, «Аккаунт» у нижнего края окна. */
export function Rail({ active }: { readonly active: B640Nav | null }) {
  return (
    <nav className="rail" aria-label="Разделы">
      <div className="rail-top">
        <Link className="brand" to={B640_HOME_PATH} aria-label="openqareer, Сегодня">
          <BrandMark />
        </Link>
        {RAIL_ITEMS.map((item) => (
          <RailLink key={item.id} item={item} active={item.id === active} className="nav" />
        ))}
      </div>
      <div className="rail-bottom">
        <RailLink item={RAIL_ACCOUNT} active={active === 'settings'} className="nav rail-end" />
      </div>
    </nav>
  );
}
