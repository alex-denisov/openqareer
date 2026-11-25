import type { DatabaseSync } from 'node:sqlite';

/**
 * B798: звезда «Сохранить» и черновик отклика живут в одной стадии `saved`. Чья она, говорит
 * последнее событие этой стадии: `candidate` — звезда кандидата, `system` — черновик, который
 * завело «Откликнуться» или одобренное письмо. Колонка не нужна: `applications` не меняется (B230).
 */
export type SavedMark = 'candidate' | 'system';

interface MarkEvent {
  readonly kind: string;
  readonly toStage: string | null;
  readonly provenance: string;
}

/** Событий стадии `saved` нет у старых записей: звезда остаётся как была. */
export function isStarred(stage: string, mark: string | undefined): boolean {
  return stage === 'saved' && mark !== 'system';
}

export function savedMark(
  database: DatabaseSync,
  candidateId: string,
  applicationId: string,
): string | undefined {
  const row = database
    .prepare(
      `SELECT provenance FROM application_events
        WHERE candidate_id = ? AND application_id = ? AND kind = 'stage' AND to_stage = 'saved'
        ORDER BY rowid DESC LIMIT 1`,
    )
    .get(candidateId, applicationId) as { provenance: string } | undefined;
  return row?.provenance;
}

/** Возврат в `saved` (из архива, из отклика) звезду сам не ставит: она та же, что была. */
export function markAfterReturn(mark: string | undefined): SavedMark {
  return mark === undefined || mark === 'system' ? 'system' : 'candidate';
}

export function markOfEvents(events: readonly MarkEvent[]): string | undefined {
  return events.filter((event) => event.kind === 'stage' && event.toStage === 'saved').at(-1)
    ?.provenance;
}
