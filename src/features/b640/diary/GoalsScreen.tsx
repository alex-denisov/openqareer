import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryHorizon } from '../../../../shared/careerDiary';
import type {
  CareerDiaryGoalCard,
  CareerDiaryGoalCards,
} from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { listGoalCards } from './diaryApi';
import { GoalItem } from './GoalItem';
import { HORIZONS, goalsLead, quarterLabel } from './goalsModel';
import { today } from './model';
import { RetryButton } from './parts';
import './diary.css';

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly data: CareerDiaryGoalCards };

function useGoalCards(): readonly [Loaded, () => void] {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    listGoalCards().then(
      (data) => active && setLoaded({ state: 'ready', data }),
      () => active && setLoaded({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  return [loaded, useCallback(() => setAttempt((value) => value + 1), [])];
}

const SOURCE_TEXT =
  'Значения вносите вы: в итоге недели или в карточке цели; рядом — дата замера. ' +
  '«Отстаёт» — если по последнему замеру цель не успевает к сроку при равномерном темпе.';

function AddActions() {
  return (
    <div className="actions">
      <Link className="btn" to={buildNodePath('d02b')}>
        <Icon name="plus" />
        Добавить цель
      </Link>
      <Link className="btn" to={buildNodePath('d02k')}>
        <Icon name="upload" />
        Загрузить KPI
      </Link>
    </div>
  );
}

/** Пусто (d02c): вопрос о целях и пример для роли. */
function NoGoals() {
  return (
    <section className="lead" aria-labelledby="gc-t">
      <div className="lead-head">
        <h2 className="lead-title gc-title" id="gc-t">
          Какие у вас цели на этот квартал?
        </h2>
        <InfoTip
          label="Пояснение"
          text="Цели обычно ставит руководитель. Спросите на первой встрече, как будет измеряться успех к 90-му дню."
        />
      </div>
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('d02b')}>
          <Icon name="plus" />
          Добавить цель
        </Link>
        <Link className="btn" to={buildNodePath('d02k')}>
          <Icon name="upload" />
          Загрузить KPI
        </Link>
      </div>
      <div className="ghost" aria-label="Пример целей">
        <p className="ghost-cap">Пример</p>
        <p className="gc-ex">
          <strong>Выпускать релиз за неделю</strong>
          <span className="row-sub"> · срок релиза в днях</span>
        </p>
        <p className="gc-ex">
          <strong>Закрыть вакансии в команду</strong>
          <span className="row-sub"> · закрыто по плану найма</span>
        </p>
        <p className="gc-ex">
          <strong>Выполнять план выручки отдела</strong>
          <span className="row-sub"> · выручка за квартал</span>
        </p>
      </div>
    </section>
  );
}

function Archive({ cards }: { readonly cards: readonly CareerDiaryGoalCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="mod" aria-labelledby="kp-arch">
      <div className="eyebrow">
        <Icon name="minus" />
        {`Архив · ${cards.length}`}
      </div>
      {cards.map((card, index) => (
        <h3 className="mod-title" id={index === 0 ? 'kp-arch' : undefined} key={card.id}>
          <Link to={buildNodePath('d02a', { goalId: card.id })}>{card.title}</Link>
          {card.details.archive ? (
            <InfoTip label="Почему в архиве" text={card.details.archive.reason} />
          ) : null}
        </h3>
      ))}
    </section>
  );
}

interface HorizonSegProps {
  readonly value: CareerDiaryHorizon;
  readonly onChange: (value: CareerDiaryHorizon) => void;
}

function HorizonSeg({ value, onChange }: HorizonSegProps) {
  return (
    <div className="seg dn-seg" role="group" aria-label="Горизонт целей">
      {HORIZONS.map((option) => (
        <button
          key={option.value}
          className="seg-i"
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GoalsLead({ data }: { readonly data: CareerDiaryGoalCards }) {
  const now = today();
  const [horizon, setHorizon] = useState<CareerDiaryHorizon>('quarter');
  const lead = goalsLead(data.items);
  const shown = data.items.filter((card) => card.horizon === horizon);
  return (
    <section className="lead" aria-labelledby="kp-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="kp-title">
          {lead.title}
        </h2>
        <InfoTip label="Откуда цифры" text={SOURCE_TEXT} />
      </div>
      <p className="lead-sub">{quarterLabel(now)}</p>
      {lead.focus ? (
        <div className="actions">
          <Link className="btn is-primary" to={buildNodePath('d02a', { goalId: lead.focus.id })}>
            <Icon name="target" />
            Разобрать
          </Link>
        </div>
      ) : null}
      <HorizonSeg value={horizon} onChange={setHorizon} />
      {shown.length > 0 ? (
        <ul className="dn-goals">
          {shown.map((card) => (
            <GoalItem key={card.id} card={card} now={now} />
          ))}
        </ul>
      ) : (
        <p className="vl-empty">На этот срок целей нет.</p>
      )}
      <AddActions />
    </section>
  );
}

/** Экран d02 «Цели и показатели»: цели по горизонтам, показатели, архив; пусто — d02c. */
export function GoalsScreen({ node }: { readonly node: B640Node }) {
  const [loaded, retry] = useGoalCards();
  const empty =
    loaded.state === 'ready' && loaded.data.items.length === 0 && loaded.data.archived.length === 0;
  return (
    <div
      className={empty ? 'page' : 'page two'}
      data-b640-node={node.code}
      data-b640-section={node.section}
    >
      <div className="col">
        {loaded.state === 'loading' ? <StatusLine state="wait" text="Загружаем цели" /> : null}
        {loaded.state === 'error' ? (
          <StatusLine
            state="err"
            text="Цели не загрузились"
            action={<RetryButton onClick={retry} />}
          />
        ) : null}
        {empty ? <NoGoals /> : null}
        {loaded.state === 'ready' && !empty ? (
          <>
            <GoalsLead data={loaded.data} />
            <Archive cards={loaded.data.archived} />
          </>
        ) : null}
      </div>
    </div>
  );
}
