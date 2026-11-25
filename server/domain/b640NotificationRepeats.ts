import type { NotificationEventKind } from '../data/notificationPolicy';
import type { B640NotificationSource } from './b640Notifications';
import { digestDay } from './roleVacancyDigest';
import { ROLE_DIGEST_SOURCE_TYPE, unionDigestMarks } from './roleDigestMarks';

/** События без своего предмета в заголовке: за день одна строка, как в макете n01b. */
const ONE_PER_DAY: ReadonlySet<NotificationEventKind> = new Set([
  'new_vacancies_by_role',
  'footprint_findings',
  'consultant_edits',
]);

export interface CollapsedRow {
  readonly row: B640NotificationSource;
  /** Непрочитанные записи, свёрнутые в эту строку: читаются вместе с ней. */
  readonly mergedUnreadIds: readonly string[];
}

function merge(kept: CollapsedRow, older: B640NotificationSource): CollapsedRow {
  const { row } = kept;
  const bothDigests =
    row.sourceType === ROLE_DIGEST_SOURCE_TYPE && older.sourceType === ROLE_DIGEST_SOURCE_TYPE;
  const olderDigestOnly =
    row.sourceType !== ROLE_DIGEST_SOURCE_TYPE && older.sourceType === ROLE_DIGEST_SOURCE_TYPE;
  const source = olderDigestOnly
    ? { sourceType: older.sourceType, sourceId: older.sourceId }
    : bothDigests
      ? { sourceId: unionDigestMarks(row.sourceId, older.sourceId) }
      : {};
  const olderUnread = older.readAt === null;
  return {
    // Новая строка прочитана, свёрнутая нет — строка остаётся непрочитанной.
    row: { ...row, ...source, readAt: olderUnread ? null : row.readAt },
    mergedUnreadIds: olderUnread ? [...kept.mergedUnreadIds, older.id] : kept.mergedUnreadIds,
  };
}

/**
 * Повторы за день (B801 С1): до B671 каждый набор вакансий писал свою строку без числа, а
 * находки и правки пишутся на каждую проверку и ответ. Строки — новые первыми.
 */
export function collapseDailyRepeats(rows: readonly B640NotificationSource[]): CollapsedRow[] {
  const kept = new Map<string, CollapsedRow>();
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    const daily = ONE_PER_DAY.has(row.kind) && !Number.isNaN(createdAt.getTime());
    const key = daily ? `${row.kind}:${digestDay(createdAt)}` : row.id;
    const current = kept.get(key);
    kept.set(key, current ? merge(current, row) : { row, mergedUnreadIds: [] });
  }
  return [...kept.values()];
}
