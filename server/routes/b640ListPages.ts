import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

const PAGES_TTL_MS = 10 * 60_000;
const MAX_ORDERS = 200;

type Rows = readonly MatchedVacancyItem[];
type FitView = MatchedVacancyItem['explanation']['fitView'];

interface OrderedRow {
  readonly id: string;
  readonly fitView: FitView;
}

/** Строка с тем разбором, по которому она встала на место. */
function placed(row: MatchedVacancyItem, fitView: FitView): MatchedVacancyItem {
  if (row.explanation.fitView === fitView) return row;
  const { fitView: _later, ...explanation } = row.explanation;
  return { ...row, explanation: fitView ? { ...explanation, fitView } : explanation };
}

/**
 * B789: «Показать ещё» читает тот порядок, с которого началась первая порция. Процент, досчитанный
 * между порциями, иначе двигал бы строки: повтор на одной порции, пропуск на другой.
 */
export function createListPages(now: () => number = Date.now) {
  const orders = new Map<string, { readonly at: number; readonly rows: readonly OrderedRow[] }>();

  function remember(key: string, rows: Rows): void {
    orders.delete(key);
    orders.set(key, {
      at: now(),
      rows: rows.map((row) => ({ id: row.cluster.id, fitView: row.explanation.fitView })),
    });
    const oldest = orders.size > MAX_ORDERS ? orders.keys().next().value : undefined;
    if (oldest !== undefined) orders.delete(oldest);
  }

  /** Первая порция запоминает порядок, следующие берут его; новые строки ждут новой первой. */
  return function inPageOrder(key: string, rows: Rows, offset: number): Rows {
    const known = orders.get(key);
    if (offset === 0 || !known || now() - known.at >= PAGES_TTL_MS) {
      remember(key, rows);
      return rows;
    }
    const current = new Map(rows.map((row) => [row.cluster.id, row]));
    return known.rows.flatMap(({ id, fitView }) => {
      const row = current.get(id);
      return row ? [placed(row, fitView)] : [];
    });
  };
}
