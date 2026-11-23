import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import {
  goalByline,
  indicatorView,
  indicatorsOf,
  quarterLine,
  quarterTargetText,
  riskTag,
  staleFlag,
} from './goalsModel';

export interface GoalItemProps {
  readonly card: CareerDiaryGoalCard;
  readonly now: string;
  /** Вкладка «Квартал»: у годовой цели — цель этого квартала вместо годовой. */
  readonly quarterView?: boolean;
}

/** Цель в списке (`li.dn-goal`): заголовок, метка, показатели и пометка о старом замере. */
export function GoalItem({ card, now, quarterView = false }: GoalItemProps) {
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
      <IndicatorList card={card} now={now} quarterView={quarterView} />
      {quarters ? <p className="row-sub">{quarters}</p> : null}
      <GoalFlags card={card} stale={stale} />
    </li>
  );
}

/** Показатели цели; на «Квартале» у годовой цели с одним показателем — цель этого квартала. */
function IndicatorList({ card, now, quarterView = false }: GoalItemProps) {
  const indicators = indicatorsOf(card);
  const quarterTarget =
    quarterView && indicators.length === 1 ? quarterTargetText(card, now) : null;
  return (
    <ul className="dn-inds">
      {indicators.map((goal) => {
        const view = indicatorView(goal);
        const target = view.target && quarterTarget ? quarterTarget : view.target;
        // B686: у цели из KPI единственный показатель назван как сама цель — второй раз не пишем.
        const repeat = indicators.length === 1 && goal.title.trim() === card.title.trim();
        return (
          <li className="dn-ind" key={view.id}>
            <span>{repeat ? null : view.title}</span>
            <span className="num">
              <strong>{view.value}</strong>
              {target ? ` ${target}` : null}
            </span>
            <span className="row-sub">{view.sub}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** «Достигнута → Перенести» и «Последний замер … · Внести». */
function GoalFlags({
  card,
  stale,
}: {
  readonly card: CareerDiaryGoalCard;
  readonly stale: string | null;
}) {
  return (
    <>
      {card.risk.status === 'achieved' ? (
        <p className="dn-flag is-done">
          <Icon name="trophy" />
          {'Достигнута → в Итоги и в профиль'}
          <Link className="btn is-quiet is-sm" to={buildNodePath('d04')}>
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
    </>
  );
}
