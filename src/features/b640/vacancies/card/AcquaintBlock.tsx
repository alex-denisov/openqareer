import { buildNodePath } from '../../routes';
import { Link } from '../../kit';
import type { Acquaintance } from './acquaintances';
import { Fold } from './Fold';

export interface AcquaintBlockProps {
  readonly people: readonly Acquaintance[];
}

/** «Знакомые в компании · N». Никого нет — блока нет. */
export function AcquaintBlock({ people }: AcquaintBlockProps) {
  if (people.length === 0) return null;
  return (
    <Fold title={`Знакомые в компании · ${people.length}`}>
      <section className="acq" aria-label="Знакомые в компании">
        <ul className="rows">
          {people.map((person) => (
            <li className="row" key={person.key}>
              <div>
                <div className="row-title">{person.name}</div>
                <div className="row-sub">{person.sub}</div>
              </div>
            </li>
          ))}
        </ul>
        <Link className="row-act" to={buildNodePath('p11')}>
          Все связи
        </Link>
      </section>
    </Fold>
  );
}
