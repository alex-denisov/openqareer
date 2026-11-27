import { pressApply } from '../../apply/applyIntent';
import { useId, useState } from 'react';
import { Icon, Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { AppliedLink } from './AppliedLink';
import type { ApplyWay, ComposeAction, WayAction as WayActionModel } from './waysModel';

export interface WaysBlockProps {
  readonly ways: readonly ApplyWay[];
  readonly vacancyId: string;
  /** Отклик по вакансии уже отправлен: письмо открывает его. */
  readonly responseId?: string | undefined;
  /** «Написать <имя>»: карточка переходит в шаг «Отклик» с черновиком (a02d). */
  readonly onCompose: (action: ComposeAction) => void;
}

interface WayActionProps {
  readonly way: ApplyWay;
  readonly action: WayActionModel;
  readonly vacancyId: string;
  /** Отклик по вакансии уже отправлен: письмо открывает его. */
  readonly responseId?: string | undefined;
  readonly onCompose: (action: ComposeAction) => void;
}

function WayAction({ way, action, vacancyId, responseId, onCompose }: WayActionProps) {
  const icon = <Icon name={way.icon} />;
  if (action.kind === 'compose') {
    return (
      <button className="btn" type="button" onClick={() => onCompose(action)}>
        {icon}
        {action.label}
      </button>
    );
  }
  if (action.kind === 'external') {
    return (
      <a className="btn" href={action.url} target="_blank" rel="noopener noreferrer">
        {icon}
        {action.label}
      </a>
    );
  }
  if (responseId) return <AppliedLink responseId={responseId} className="btn" />;
  return (
    <Link className="btn" to={buildNodePath('o02', { responseId: vacancyId })} onClick={() => pressApply(vacancyId)}>
      {icon}
      {action.label}
    </Link>
  );
}

interface WayItemProps {
  readonly way: ApplyWay;
  readonly vacancyId: string;
  /** Отклик по вакансии уже отправлен: письмо открывает его. */
  readonly responseId?: string | undefined;
  readonly group: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly onCompose: (action: ComposeAction) => void;
}

function WayItem({ way, vacancyId, responseId, group, checked, onSelect, onCompose }: WayItemProps) {
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
      {way.action ? (
        <div className="ha-go">
          <WayAction way={way} action={way.action} vacancyId={vacancyId} responseId={responseId} onCompose={onCompose} />
        </div>
      ) : null}
    </li>
  );
}

/** «Как откликнуться»: только способы, известные по вакансии; выбран первый (рекомендуемый). */
export function WaysBlock({ ways, vacancyId, responseId, onCompose }: WaysBlockProps) {
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
                responseId={responseId}
                group={group}
                checked={current === way.id}
                onSelect={() => setSelected(way.id)}
                onCompose={onCompose}
              />
            ))}
          </ul>
        </div>
      </section>
    </section>
  );
}
