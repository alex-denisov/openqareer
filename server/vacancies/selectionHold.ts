import { SELECTION_LIVENESS_TOP } from './selectionLiveness';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * B797, замер прода 25.11: из 71 сверенной строки hh сняты 24, и все они виделись в выдаче больше
 * двух дней назад; среди более свежих снятых не было (0 из 17). Такие строки ждут сверки до показа.
 */
export const HOLD_SEEN_BEFORE_MS = 2 * 24 * 60 * 60_000;
/** Пока сверенный верх короче, строки ниже него без сверки не поднимаются на его место. */
export const HOLD_VISIBLE_TOP = 40;
/** Меньше страницы строк не остаётся: тогда список показывается целиком. */
const HOLD_MIN_ROWS = 20;
const HH_CLUSTER_PREFIX = 'cluster-src-hh-search:';

/** Какие из записей ещё не сверены и ждут проверки. */
export type UncheckedReader = (ids: readonly string[]) => ReadonlySet<string>;

export interface HeldSelection {
  readonly rows: readonly MatchedVacancyItem[];
  /** Записи верха, которые ждут сверки: воркер читает их первыми. */
  readonly heldIds: readonly string[];
}

const recordId = (item: MatchedVacancyItem) => item.cluster.id.replace(/^cluster-/u, '');

function waitsForCheck(item: MatchedVacancyItem, nowMs: number): boolean {
  const { id, sources } = item.cluster;
  if (!id.startsWith(HH_CLUSTER_PREFIX) || sources.length !== 1) return false;
  const seen = Date.parse(sources[0]!.observedAt);
  return Number.isFinite(seen) && nowMs - seen > HOLD_SEEN_BEFORE_MS;
}

export function holdUncheckedRows(
  rows: readonly MatchedVacancyItem[],
  unchecked: UncheckedReader | undefined,
  nowMs: number = Date.now(),
): HeldSelection {
  if (!unchecked) return { rows, heldIds: [] };
  const idsOf = (part: readonly MatchedVacancyItem[]) =>
    part.filter((item) => waitsForCheck(item, nowMs)).map(recordId);
  const top = rows.slice(0, SELECTION_LIVENESS_TOP);
  const topIds = idsOf(top);
  if (topIds.length === 0) return { rows, heldIds: [] };
  const held = unchecked(topIds);
  if (held.size === 0) return { rows, heldIds: [] };
  const heldIds = topIds.filter((id) => held.has(id));
  const deep =
    top.length - heldIds.length < HOLD_VISIBLE_TOP
      ? unchecked(idsOf(rows.slice(SELECTION_LIVENESS_TOP)))
      : new Set<string>();
  const visible = rows.filter((item) => !held.has(recordId(item)) && !deep.has(recordId(item)));
  return { rows: visible.length < HOLD_MIN_ROWS ? rows : visible, heldIds };
}
