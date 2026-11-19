import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { diaryWeekStart, type CareerDiaryWeekDraft } from '../../../../shared/careerDiaryEntries';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';
import { useToast } from '../kit/Toast';
import { buildNodePath, type B640Node } from '../routes';
import { useShell } from '../shell/ShellContext';
import { getWeek, listGoalCards, recordMeasurement, saveWeek } from './diaryApi';
import { shortDate, today, weekEnd, weekNumber, weekRangeLong } from './model';
import {
  changedMeters,
  initialForm,
  meterFields,
  summaryInput,
  weekFromSearch,
  type WeekForm,
} from './weekModel';
import { useDiaryContext } from './useDiaryContext';
import { RetryButton } from './parts';
import { WeekAchieved } from './WeekAchieved';
import { BlockersStep, MetersStep, PlanStep } from './WeekSteps';
import './diary.css';

interface WeekData {
  readonly draft: CareerDiaryWeekDraft;
  readonly cards: readonly CareerDiaryGoalCard[];
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly data: WeekData };

function useWeekData(weekStart: string): readonly [Loaded, () => void] {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded({ state: 'loading' });
    Promise.all([
      getWeek(weekStart),
      listGoalCards().then(
        (cards) => cards.items,
        () => [],
      ),
    ]).then(
      ([draft, cards]) => active && setLoaded({ state: 'ready', data: { draft, cards } }),
      () => active && setLoaded({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [weekStart, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return [loaded, retry];
}

/** Экран d00d «Итог недели»: замеры, что получилось, что мешает, план на неделю. */
export function WeekScreen({ node }: { readonly node: B640Node }) {
  const { search } = useShell();
  const day = today();
  const weekStart = weekFromSearch(search, diaryWeekStart(day) ?? day);
  const [loaded, retry] = useWeekData(weekStart);
  const number = weekNumber(weekStart, useDiaryContext().origin);
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="lead" aria-labelledby="wk-t">
          <h2 className="lead-title is-long" id="wk-t">
            Итог недели
          </h2>
          <p className="lead-sub">{`${number ? `Неделя ${number}` : 'Неделя'} · ${weekRangeLong(weekStart)}`}</p>
          {loaded.state === 'loading' ? <StatusLine state="wait" text="Собираем неделю" /> : null}
          {loaded.state === 'error' ? (
            <StatusLine
              state="err"
              text="Неделя не загрузилась"
              action={<RetryButton onClick={retry} />}
            />
          ) : null}
          {loaded.state === 'ready' ? <WeekFormView key={weekStart} data={loaded.data} /> : null}
        </section>
      </div>
    </div>
  );
}

function measuredOn(weekStart: string): string {
  const day = today();
  const end = weekEnd(weekStart);
  return day < end ? day : end;
}

function useWeekSave(data: WeekData) {
  const { navigate } = useShell();
  const toast = useToast();
  const [initial] = useState(() => initialForm(data.draft, data.cards));
  const [form, setForm] = useState<WeekForm>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = (patch: Partial<WeekForm>) => setForm((previous) => ({ ...previous, ...patch }));

  async function save() {
    const { weekStart } = data.draft;
    setBusy(true);
    setFailed(false);
    try {
      const day = measuredOn(weekStart);
      await Promise.all(
        changedMeters(form, initial).map((meter) =>
          recordMeasurement(meter.goalId, { value: meter.value, measuredAt: day }),
        ),
      );
      await saveWeek(weekStart, summaryInput(form));
      toast.show({ text: 'Итог недели сохранён' });
      navigate(buildNodePath('d00'));
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return { form, change, busy, failed, save };
}

function WeekFormView({ data }: { readonly data: WeekData }) {
  const { form, change, busy, failed, save } = useWeekSave(data);
  const { draft, cards } = data;
  return (
    <>
      <ol className="dn-flow">
        <MetersStep form={form} change={change} meters={meterFields(cards, draft.weekStart)} />
        <WeekAchieved
          entries={draft.entries}
          form={form}
          onChange={change}
          dateOf={(date) => ` · ${shortDate(date)}`}
        />
        <BlockersStep form={form} change={change} />
        <PlanStep form={form} change={change} draft={draft} />
      </ol>
      {failed ? (
        <StatusLine
          state="err"
          text="Итог не сохранился"
          action={<RetryButton onClick={() => void save()} />}
        />
      ) : null}
      <ActionDock
        kind="commit"
        primary={
          <Button variant="primary" icon="check" busy={busy} onClick={() => void save()}>
            Сохранить итог
          </Button>
        }
      />
    </>
  );
}
