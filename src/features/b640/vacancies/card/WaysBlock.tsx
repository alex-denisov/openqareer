import { useId, useState } from 'react';
import { Icon, Link, type IconName } from '../../kit';
import { buildNodePath } from '../../routes';
import type { ApplyWay } from './waysModel';

export interface WaysBlockProps {
  readonly ways: readonly ApplyWay[];
  readonly vacancyId: string;
}

const WAY_ICONS: Readonly<Record<ApplyWay['id'], IconName>> = {
  hh: 'responses',
  site: 'out',
  direct: 'send',
};

function WayAction({ way, vacancyId }: { readonly way: ApplyWay; readonly vacancyId: string }) {
  const icon = <Icon name={WAY_ICONS[way.id]} />;
  if (way.action.kind === 'external') {
    return (
      <a className="btn" href={way.action.url} target="_blank" rel="noopener noreferrer">
        {icon}
        {way.action.label}
      </a>
    );
  }
  return (
    <Link className="btn" to={buildNodePath('o02', { responseId: vacancyId })}>
      {icon}
      {way.action.label}
    </Link>
  );
}

/** «Как откликнуться»: только способы, известные по вакансии; выбран первый. */
export function WaysBlock({ ways, vacancyId }: WaysBlockProps) {
  const headId = useId();
  const group = useId();
  const [selected, setSelected] = useState<ApplyWay['id']>();
  if (ways.length === 0) return null;
  const current = selected ?? ways[0]!.id;
  return (
    <section className="mod" aria-label="Как откликнуться">
      <section className="ha" aria-labelledby={headId}>
        <h4 className="ha-h" id={headId}>
          Как откликнуться
        </h4>
        <div role="group" aria-labelledby={headId}>
          <ul className="ha-list">
            {ways.map((way) => (
              <li className="ha-item" key={way.id}>
                {/* Подпись способа лежит во вложенных span, как в макете. */}
                {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                <label className="ha-opt">
                  <input
                    type="radio"
                    name={group}
                    value={way.id}
                    checked={current === way.id}
                    onChange={() => setSelected(way.id)}
                  />
                  <span className="ha-body">
                    <span className="ha-th">
                      <span className="ha-t">{way.title}</span>
                    </span>
                  </span>
                </label>
                <div className="ha-go">
                  <WayAction way={way} vacancyId={vacancyId} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </section>
  );
}
