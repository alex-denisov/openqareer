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
import { getGoalExamples, getRoleTitleRu, type GoalExample } from './goalHintsApi';
import { useRoleTitle } from './roleTitle';
import { GoalItem } from './GoalItem';
import { GoalsMeeting } from './GoalsMeeting';
import { HORIZONS, archiveNote, goalsLead, quarterLabel } from './goalsModel';
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

/** Примеры без привязки к профессии: пока нет роли или примеров под неё. */
const GOAL_EXAMPLES: readonly GoalExample[] = [
  { title: 'Выполнить план квартала', measure: '% от плана' },
  { title: 'Закрыть вакансии в команду', measure: 'закрыто по плану найма' },
  { title: 'Сократить срок ключевого процесса', measure: 'дней от начала до результата' },
];

/** B744: примеры под роль кандидата (d02c); `null` — их нет, остаются общие. */
function useRoleExamples(role: string | null | undefined): readonly GoalExample[] | null {
  const [examples, setExamples] = useState<readonly GoalExample[] | null>(null);
  useEffect(() => {
    if (!role) return undefined;
    let active = true;
    getGoalExamples(role).then(
      (items) => active && setExamples(items),
      () => active && setExamples(null),
    );
    return () => {
      active = false;
    };
  }, [role]);
  return role ? examples : null;
}

/** Название роли в тексте экрана по-русски; модели уходит роль как есть. */
function useRoleLabel(role: string | null | undefined): string | null | undefined {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!role) return undefined;
    let active = true;
    getRoleTitleRu(role).then(
      (titleRu) => active && setLabel(titleRu),
      () => active && setLabel(null),
    );
    return () => {
      active = false;
    };
  }, [role]);
  return role ? (label ?? role) : role;
}

/** Пусто (d02c): вопрос о целях в роли кандидата и пример. */
function NoGoals() {
  const role = useRoleTitle();
  const forRole = useRoleExamples(role);
  const label = useRoleLabel(role);
  const examples = forRole ?? GOAL_EXAMPLES;
  return (
    <section className="lead" aria-labelledby="gc-t">
      <div className="lead-head">
        <h2 className="lead-title gc-title" id="gc-t">
          {label
            ? `Какие цели в роли «${label}» в первом квартале?`
            : 'Какие у вас цели на этот квартал?'}
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
      <div className="ghost" aria-label={forRole ? 'Пример целей для роли' : 'Пример целей'}>
        <p className="ghost-cap">{forRole && label ? `Пример для роли «${label}»` : 'Пример'}</p>
        {examples.map((example) => (
          <p className="gc-ex" key={example.title}>
            <strong>{example.title}</strong>
            <span className="row-sub"> · {example.measure}</span>
          </p>
        ))}
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
            <InfoTip label="Почему в архиве" text={archiveNote(card.details.archive, today())} />
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
      {empty ? null : (
        <div className="col">
          <GoalsMeeting />
        </div>
      )}
    </div>
  );
}
