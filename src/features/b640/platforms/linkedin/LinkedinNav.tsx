import { Link } from '../../kit';
import { buildNodePath } from '../../routes';

interface NavProps {
  readonly node: 'a03' | 'a03p' | 'a03b' | 'a05';
}

function current(active: boolean): { 'aria-current'?: 'page' } {
  return active ? { 'aria-current': 'page' } : {};
}

/** «Профиль / Публикации» и, внутри публикаций, фильтр «Все / Посты / Комментарии». */
export function LinkedinNav({ node }: NavProps) {
  const inPublications = node !== 'a03';
  return (
    <>
      <nav className="li-seg col-wide" aria-label="LinkedIn">
        <Link to={buildNodePath('a03')} {...current(!inPublications)}>Профиль</Link>
        <Link to={buildNodePath('a03p')} {...current(inPublications)}>Публикации</Link>
      </nav>
      {inPublications ? (
        <nav className="chips lk-chips li-pub-chips col-wide" aria-label="Публикации: тип">
          <Link className="chip" to={buildNodePath('a03p')} {...current(node === 'a03p')}>Все</Link>
          <Link className="chip" to={buildNodePath('a03b')} {...current(node === 'a03b')}>Посты</Link>
          <Link className="chip" to={buildNodePath('a05')} {...current(node === 'a05')}>Комментарии</Link>
        </nav>
      ) : null}
    </>
  );
}
