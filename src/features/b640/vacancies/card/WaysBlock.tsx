import { useId, useState } from 'react';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import type { ApplyWay } from './waysModel';

export interface WaysBlockProps {
  readonly ways: readonly ApplyWay[];
  readonly vacancyId: string;
}

interface WayActionProps {
  readonly way: ApplyWay;
  readonly vacancyId: string;
  readonly composeOpen: boolean;
  readonly onCompose: () => void;
}

function WayAction({ way, vacancyId, composeOpen, onCompose }: WayActionProps) {
  const icon = <Icon name={way.icon} />;
  if (way.action.kind === 'compose') {
    return (
      <button className="btn" type="button" aria-expanded={composeOpen} onClick={onCompose}>
        {icon}
        {way.action.label}
      </button>
    );
  }
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

interface WayItemProps {
  readonly way: ApplyWay;
  readonly vacancyId: string;
  readonly group: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
}

function WayItem({ way, vacancyId, group, checked, onSelect }: WayItemProps) {
  const [composeOpen, setComposeOpen] = useState(false);
  return (
    <li className={way.recommended ? 'ha-item is-next' : 'ha-item'}>
      <label className="ha-opt">
        <input type="radio" name={group} value={way.id} checked={checked} onChange={onSelect} />
        <span className="ha-body">
          <span className="ha-th">
            <span className="ha-t">{way.title}</span>
            {way.recommended ? <span className="tag ok ha-rec-tag">Рекомендуем</span> : null}
          </span>
          {way.sub ? <small className="ha-sub">{way.sub}</small> : null}
        </span>
      </label>
      <div className="ha-go">
        <WayAction
          way={way}
          vacancyId={vacancyId}
          composeOpen={composeOpen}
          onCompose={() => setComposeOpen((value) => !value)}
        />
      </div>
      {/*
        Слот черновика (a02d): при composeOpen у способа «friend» здесь раскрывается встроенная
        панель MessageDraft из src/features/b640/messages/ (ветка claude/b698-contact-message-ui).
        Панель встраивает координатор после слияния веток; здесь её не пишем.
      */}
    </li>
  );
}

/** «Как откликнуться»: только способы, известные по вакансии; выбран первый (рекомендуемый). */
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
              <WayItem
                key={way.id}
                way={way}
                vacancyId={vacancyId}
                group={group}
                checked={current === way.id}
                onSelect={() => setSelected(way.id)}
              />
            ))}
          </ul>
        </div>
      </section>
    </section>
  );
}
