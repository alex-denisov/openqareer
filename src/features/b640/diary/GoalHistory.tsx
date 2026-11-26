import { useEffect, useState } from 'react';
import type {
  CareerDiaryGoalSummary,
  CareerDiaryMeasurement,
} from '../../../../shared/careerDiary';
import { Icon } from '../kit/Icon';
import { StatusLine } from '../kit/ResultLine';
import { listMeasurements } from './diaryApi';
import { longDate, valueWithTarget } from './goalsModel';
import { shortDate, today } from './model';

type Rows =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly items: readonly CareerDiaryMeasurement[] };

function useHistory(goalId: string, version: number): Rows {
  const [rows, setRows] = useState<Rows>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    listMeasurements(goalId).then(
      (page) => active && setRows({ state: 'ready', items: page.items }),
      () => active && setRows({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [goalId, version]);
  return rows;
}

function ofTarget(goal: CareerDiaryGoalSummary, value: CareerDiaryMeasurement['value']): string {
  return valueWithTarget(goal, value);
}

interface HistoryRow {
  readonly key: string;
  readonly at: string;
  readonly value: CareerDiaryMeasurement['value'];
  readonly source: string;
  readonly note: string;
}

/** Как в d02a: сверху «старт» (исходное значение цели), ниже замеры от старых к новым. */
function historyRows(
  goal: CareerDiaryGoalSummary,
  items: readonly CareerDiaryMeasurement[],
): readonly HistoryRow[] {
  const measured = [...items].reverse().map((row) => ({
    key: row.id,
    at: row.measuredAt,
    value: row.value,
    source: 'вы',
    note: row.note ?? '',
  }));
  if (goal.baselineValue === null) return measured;
  const start = {
    key: 'start',
    at: goal.startDate,
    value: goal.baselineValue,
    source: 'старт',
    note: '',
  };
  return [start, ...measured];
}

/** «Замеры · N»: свёрнутая история замеров показателя (`details.gt-hist`). */
export function GoalHistory({
  goal,
  version,
}: {
  readonly goal: CareerDiaryGoalSummary;
  readonly version: number;
}) {
  const rows = useHistory(goal.id, version);
  const now = today();
  if (rows.state === 'loading') return <StatusLine state="wait" text="Загружаем замеры" />;
  if (rows.state === 'error') return <StatusLine state="err" text="Замеры не загрузились" />;
  const history = historyRows(goal, rows.items);
  const latest = history.at(-1);
  return (
    <details className="gt-hist">
      <summary>
        <span className="gt-hist-l">{`Замеры · ${history.length}`}</span>
        {latest ? (
          <span className="gt-hist-v num">{`${shortDate(latest.at.slice(0, 10))} · ${ofTarget(goal, latest.value)}`}</span>
        ) : null}
        <Icon name="down" />
      </summary>
      <table className="dn-tbl">
        <caption className="vh">История замеров</caption>
        <thead>
          <tr>
            <th scope="col">Дата</th>
            <th scope="col">Значение</th>
            <th scope="col">Источник</th>
            <th scope="col">Комментарий</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.key}>
              <td data-l="Дата" className="num">
                {longDate(row.at, now)}
              </td>
              <td data-l="Значение" className="num">
                {ofTarget(goal, row.value)}
              </td>
              <td data-l="Источник">{row.source}</td>
              <td data-l="Комментарий">{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
