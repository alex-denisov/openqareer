import { useEffect, useState } from 'react';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';
import { SegControl } from '../kit/SegControl';
import { useToast } from '../kit/Toast';
import { buildNodePath, type B640Node } from '../routes';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { createGoalCard, listGoalCards, patchGoal, patchGoalDetails } from './diaryApi';
import {
  cardInput,
  draftOf,
  emptyDraft,
  parseNumber,
  parseTarget,
  validate,
  type GoalDraft,
  type GoalErrors,
} from './goalForm';
import { HORIZONS, SETTERS } from './goalsModel';
import { IndicatorFields } from './IndicatorFields';
import { today } from './model';
import { DateInput } from '../kit/DateInput';
import { RetryButton } from './parts';
import './diary.css';

/** Правка: название, горизонт, срок, кто поставил и значения показателей, что уже есть. */
async function saveEdit(card: CareerDiaryGoalCard, draft: GoalDraft): Promise<void> {
  await patchGoal(card.id, {
    title: draft.title.trim(),
    horizon: draft.horizon,
    dueDate: draft.dueDate,
  });
  if (draft.setBy !== card.details.setBy) await patchGoalDetails(card.id, { setBy: draft.setBy });
  const ownIndicator = card.indicators.length === 0;
  await Promise.all(
    draft.indicators
      .filter((item) => item.id !== null)
      .map((item) =>
        patchGoal(item.id!, {
          ...(ownIndicator ? {} : { title: item.title.trim() }),
          baselineValue: parseNumber(item.now),
          targetValue: parseTarget(item.target),
        }),
      ),
  );
}

function useSave(card: CareerDiaryGoalCard | null) {
  const { navigate } = useShell();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errors, setErrors] = useState<GoalErrors>({});
  async function save(draft: GoalDraft) {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const goalId = card
        ? (await saveEdit(card, draft), card.id)
        : (await createGoalCard(cardInput(draft, today()))).id;
      toast.show({ text: card ? 'Цель сохранена' : 'Цель добавлена' });
      navigate(buildNodePath('d02a', { goalId }));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return { busy, failed, errors, save };
}

function FieldError({ text }: { readonly text?: string }) {
  if (!text) return null;
  return (
    <p className="va-err" role="alert">
      {text}
    </p>
  );
}

interface SegFieldProps<T extends string> {
  readonly label: string;
  readonly name: string;
  readonly className?: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}

/** Переключатель с видимой подписью над ним, как у полей. */
function SegField<T extends string>({ label, className, ...seg }: SegFieldProps<T>) {
  return (
    <div className={className ? `gb-f ${className}` : 'gb-f'}>
      <span className="gb-l" aria-hidden="true">
        {label}
      </span>
      <SegControl label={label} variant="sec-seg" {...seg} />
    </div>
  );
}

interface MainFieldsProps {
  readonly draft: GoalDraft;
  readonly errors: GoalErrors;
  readonly change: (patch: Partial<GoalDraft>) => void;
}

/** Название, горизонт, срок и кто поставил. */
function MainFields({ draft, errors, change }: MainFieldsProps) {
  return (
    <>
      <div className="gb-f gb-name">
        <label htmlFor="gb-n">Название</label>
        <input
          id="gb-n"
          type="text"
          maxLength={240}
          value={draft.title}
          placeholder="Например: сократить время ревью кода"
          onChange={(event) => change({ title: event.target.value })}
        />
        <FieldError text={errors.title} />
      </div>
      <SegField
        label="Горизонт"
        name="gb-hz"
        value={draft.horizon}
        options={HORIZONS}
        onChange={(horizon) => change({ horizon })}
      />
      <div className="gb-row">
        <div className="gb-f gb-date">
          <label htmlFor="gb-d">Срок</label>
          <DateInput
            id="gb-d"
            value={draft.dueDate}
            error={errors.dueDate}
            onChange={(dueDate) => change({ dueDate })}
          />
        </div>
        <SegField
          label="Кто поставил"
          name="gb-who"
          className="gb-who"
          value={draft.setBy}
          options={SETTERS}
          onChange={(setBy) => change({ setBy })}
        />
      </div>
    </>
  );
}

function GoalForm({ card }: { readonly card: CareerDiaryGoalCard | null }) {
  const [draft, setDraft] = useState<GoalDraft>(() => (card ? draftOf(card) : emptyDraft()));
  const { busy, failed, errors, save } = useSave(card);
  const change = (patch: Partial<GoalDraft>) => setDraft((previous) => ({ ...previous, ...patch }));
  return (
    <form className="gb-form" onSubmit={(event) => (event.preventDefault(), void save(draft))}>
      <MainFields draft={draft} errors={errors} change={change} />
      <IndicatorFields
        draft={draft}
        editing={card !== null}
        error={errors.indicators}
        onChange={change}
      />
      {failed ? (
        <StatusLine state="err" text="Цель не сохранилась" action={<RetryButton submit />} />
      ) : null}
      <ActionDock
        kind="commit"
        primary={
          <Button variant="primary" icon="check" type="submit" busy={busy}>
            Сохранить цель
          </Button>
        }
      />
    </form>
  );
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly card: CareerDiaryGoalCard | null };

function useEditedCard(goalId: string | null): Loaded {
  const [loaded, setLoaded] = useState<Loaded>(
    goalId ? { state: 'loading' } : { state: 'ready', card: null },
  );
  useEffect(() => {
    if (!goalId) return undefined;
    let active = true;
    listGoalCards().then(
      (data) =>
        active &&
        setLoaded({
          state: 'ready',
          card: [...data.items, ...data.archived].find((item) => item.id === goalId) ?? null,
        }),
      () => active && setLoaded({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [goalId]);
  return loaded;
}

/** Экран d02b «Новая цель»; с `?goal=` — правка этой цели. */
export function GoalFormScreen({ node }: { readonly node: B640Node }) {
  const { search } = useShell();
  const goalId = new URLSearchParams(search).get('goal');
  const loaded = useEditedCard(goalId);
  const editing = loaded.state === 'ready' && loaded.card !== null;
  // Как у макета d02b (`data-mtight`).
  useScreenChrome({
    ...(editing ? { title: 'Изменить цель' } : {}),
    rootData: { mtight: '1' },
  });
  return (
    <div className="page gb-page" data-b640-node={node.code} data-b640-section={node.section}>
      <h2 className="lead-title" id="gb-title">
        {editing ? 'Изменить цель' : 'Новая цель'}
      </h2>
      {loaded.state === 'loading' ? <StatusLine state="wait" text="Загружаем цель" /> : null}
      {loaded.state === 'error' ? <StatusLine state="err" text="Цель не загрузилась" /> : null}
      {loaded.state === 'ready' ? <GoalForm card={loaded.card} /> : null}
    </div>
  );
}
