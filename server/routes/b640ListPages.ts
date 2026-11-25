import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

const PAGES_TTL_MS = 10 * 60_000;
const MAX_ORDERS = 200;

type Rows = readonly MatchedVacancyItem[];

/**
 * B789: «Показать ещё» читает тот порядок, с которого началась первая порция. Процент, досчитанный
 * между порциями, иначе двигал бы строки: повтор на одной порции, пропуск на другой.
 */
export function createListPages(now: () => number = Date.now) {
  const orders = new Map<string, { readonly at: number; readonly ids: readonly string[] }>();

  function remember(key: string, rows: Rows): void {
    orders.delete(key);
    orders.set(key, { at: now(), ids: rows.map((row) => row.cluster.id) });
    const oldest = orders.size > MAX_ORDERS ? orders.keys().next().value : undefined;
    if (oldest !== undefined) orders.delete(oldest);
  }

  /** Первая порция запоминает порядок, следующие берут его; новые строки встают в конец. */
  return function inPageOrder(key: string, rows: Rows, offset: number): Rows {
    const known = orders.get(key);
    if (offset === 0 || !known || now() - known.at >= PAGES_TTL_MS) {
      remember(key, rows);
      return rows;
    }
    const left = new Map(rows.map((row) => [row.cluster.id, row]));
    const kept = known.ids.flatMap((id) => {
      const row = left.get(id);
      left.delete(id);
      return row ? [row] : [];
    });
    return [...kept, ...left.values()];
  };
}
