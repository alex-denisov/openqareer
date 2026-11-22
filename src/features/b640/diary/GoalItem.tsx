import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import {
  goalByline,
  indicatorView,
  indicatorsOf,
  quarterLine,
  riskTag,
  staleFlag,
} from './goalsModel';

export interface GoalItemProps {
  readonly card: CareerDiaryGoalCard;
  readonly now: string;
}

/** Цель в списке (`li.dn-goal`): заголовок, метка, показатели и пометка о старом замере. */
export function GoalItem({ card, now }: GoalItemProps) {
  const tag = riskTag(card.risk.status);
  const stale = staleFlag(card, now);
  const quarters = quarterLine(card.details.quarterTargets, card.unit);
  return (
    <li className="dn-goal">
      <div className="dn-goal-h">
        <Link className="dn-goal-t" to={buildNodePath('d02a', { goalId: card.id })}>
          {card.title}
        </Link>
        <span className={tag.className}>{tag.text}</span>
      </div>
      <div className="row-sub">{goalByline(card, now)}</div>
      <ul className="dn-inds">
        {indicatorsOf(card).map((goal) => {
          const view = indicatorView(goal);
          return (
            <li className="dn-ind" key={view.id}>
              <span>{view.title}</span>
              <span className="num">
                <strong>{view.value}</strong>
                {view.target ? ` ${view.target}` : null}
              </span>
              <span className="row-sub">{view.sub}</span>
            </li>
          );
        })}
      </ul>
      {quarters ? <p className="row-sub">{quarters}</p> : null}
      {card.risk.status === 'achieved' ? (
        <p className="dn-flag is-done">
          <Icon name="trophy" />
          {'Достигнута → в Итоги и в профиль · '}
          <Link className="row-act" to={buildNodePath('d04')}>
            Перенести
          </Link>
        </p>
      ) : null}
      {stale ? (
        <p className="dn-flag">
          <Icon name="warn" />
          {`${stale} · `}
          <Link className="row-act" to={buildNodePath('d00d')}>
            Внести
          </Link>
        </p>
      ) : null}
    </li>
  );
}
