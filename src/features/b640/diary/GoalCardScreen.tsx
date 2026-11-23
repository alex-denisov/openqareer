import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryGoalSummary } from '../../../../shared/careerDiary';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { StatusLine } from '../kit/ResultLine';
import type { B640Node } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import { listGoalCards } from './diaryApi';
import { GoalEntries } from './GoalEntries';
import { GoalHistory } from './GoalHistory';
import { GoalMenu } from './GoalMenu';
import { SETTERS, indicatorsOf, longDate, riskTag, valueWithTarget } from './goalsModel';
import { GoalTasks } from './GoalTasks';
import { MeasureDialog } from './MeasureDialog';
import { today } from './model';
import { RetryButton } from './parts';
import './diary.css';

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'missing' }
  | { readonly state: 'ready'; readonly card: CareerDiaryGoalCard };

function useGoalCard(goalId: string, version: number): readonly [Loaded, () => void] {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    listGoalCards().then(
      (data) => {
        if (!active) return;
        const card = [...data.items, ...data.archived].find((item) => item.id === goalId);
        setLoaded(card ? { state: 'ready', card } : { state: 'missing' });
      },
      () =>
        active &&
        setLoaded((previous) => (previous.state === 'ready' ? previous : { state: 'error' })),
    );
    return () => {
      active = false;
    };
  }, [goalId, attempt, version]);
  return [loaded, useCallback(() => setAttempt((value) => value + 1), [])];
}

/** Без замеров состояние — исходное значение, как строка «старт» в истории. */
function stateNumber(goal: CareerDiaryGoalSummary): string {
  const current = goal.latestMeasurement?.value ?? goal.baselineValue;
  if (current === null) return 'не внесено';
  return valueWithTarget(goal, current);
}

function GoalHead({
  card,
  onChanged,
}: {
  readonly card: CareerDiaryGoalCard;
  readonly onChanged: () => void;
}) {
  const who = SETTERS.find((setter) => setter.value === card.details.setBy)?.label ?? 'Вы';
  return (
    <div className="gt-head">
      <div className="gt-title">
        <h2 className="gt-h" id="ga-t">
          {card.title}
        </h2>
        <GoalMenu card={card} onChanged={onChanged} />
      </div>
      <p className="gt-sub">{`${who} · до ${longDate(card.dueDate, today())}`}</p>
    </div>
  );
}

interface GoalStateProps {
  readonly card: CareerDiaryGoalCard;
  readonly goal: CareerDiaryGoalSummary;
  readonly onMeasure: () => void;
}

function GoalState({ card, goal, onMeasure }: GoalStateProps) {
  const tag = riskTag(card.risk.status);
  return (
    <div className="gt-state">
      <span className="gt-num num">{stateNumber(goal)}</span>
      <span className="gt-tag">
        <span className={tag.className}>{tag.text}</span>
        {card.risk.explanation ? (
          <InfoTip
            label={card.risk.status === 'at_risk' ? 'Почему отстаёт' : 'Как считается'}
            text={card.risk.explanation}
          />
        ) : null}
      </span>
      {card.details.archive ? null : (
        <button className="btn is-primary" type="button" onClick={onMeasure}>
          <Icon name="plus" />
          Внести замер
        </button>
      )}
    </div>
  );
}

interface NearsProps {
  readonly goals: readonly CareerDiaryGoalSummary[];
  readonly selected: string;
  readonly onSelect: (goalId: string) => void;
}

/** Другие показатели цели: нажатие показывает их состояние и замеры. */
function Nears({ goals, selected, onSelect }: NearsProps) {
  const others = goals.filter((goal) => goal.id !== selected);
  if (others.length === 0) return null;
  return (
    <section className="gt-sec" aria-labelledby="ga-p">
      <h3 className="gt-sec-h" id="ga-p">
        Показатели рядом
      </h3>
      <ul className="gt-nears">
        {others.map((goal) => (
          <li key={goal.id}>
            <button className="gt-near" type="button" onClick={() => onSelect(goal.id)}>
              <span>{goal.title}</span>
              <Icon name="right" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface GoalCardViewProps {
  readonly card: CareerDiaryGoalCard;
  readonly version: number;
  readonly onChanged: () => void;
}

function GoalCardView({ card, version, onChanged }: GoalCardViewProps) {
  const goals = indicatorsOf(card);
  const [selected, setSelected] = useState(goals[0]!.id);
  const [measuring, setMeasuring] = useState(false);
  const goal = goals.find((item) => item.id === selected) ?? goals[0]!;
  useScreenChrome({ crumb: card.title });
  const saved = () => {
    setMeasuring(false);
    onChanged();
  };
  return (
    <>
      <div className="col">
        <GoalHead card={card} onChanged={onChanged} />
        <GoalState card={card} goal={goal} onMeasure={() => setMeasuring(true)} />
        <GoalHistory goal={goal} version={version} />
        <GoalTasks goalId={card.id} />
        <GoalEntries goal={card} />
      </div>
      <div className="col">
        <Nears goals={goals} selected={goal.id} onSelect={setSelected} />
      </div>
      <MeasureDialog
        goal={measuring ? goal : null}
        onClose={() => setMeasuring(false)}
        onSaved={saved}
      />
    </>
  );
}

/** Экран d02a «Цель»: состояние, замеры, записи по цели и другие показатели. */
export function GoalCardScreen({
  node,
  goalId,
}: {
  readonly node: B640Node;
  readonly goalId: string;
}) {
  const [version, setVersion] = useState(0);
  const [loaded, retry] = useGoalCard(goalId, version);
  const changed = useCallback(() => setVersion((value) => value + 1), []);
  return (
    <div className="page two gt-page" data-b640-node={node.code} data-b640-section={node.section}>
      {loaded.state === 'ready' ? (
        <GoalCardView card={loaded.card} version={version} onChanged={changed} />
      ) : (
        <div className="col">
          {loaded.state === 'loading' ? <StatusLine state="wait" text="Загружаем цель" /> : null}
          {loaded.state === 'error' ? (
            <StatusLine
              state="err"
              text="Цель не загрузилась"
              action={<RetryButton onClick={retry} />}
            />
          ) : null}
          {loaded.state === 'missing' ? (
            <p className="vl-empty">Такой цели нет: возможно, её удалили.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
