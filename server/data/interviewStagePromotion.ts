import type { DatabaseSync } from 'node:sqlite';
import type { ApplicationStage } from '../../shared/applicationStage';

/**
 * Интервью, которое само перевело отклик в «Интервью», помнит, откуда перевело. Удалили это
 * интервью по ошибке — отклик возвращается на прежний этап, а событие перехода стирается, чтобы
 * «интервью» не оставалось в пройденных этапах и воронке. Только новая таблица (applicationTrackerSchema:
 * без ALTER на проде).
 */
export const INTERVIEW_STAGE_PROMOTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS application_interview_stage_promotions (
  interview_id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  from_stage_changed_at TEXT NOT NULL
) STRICT;
`;

interface PromotionRow {
  readonly event_id: string;
  readonly from_stage: ApplicationStage;
  readonly from_stage_changed_at: string;
}

export interface StagePromotionInput {
  readonly applicationId: string;
  readonly interviewId: string;
  readonly fromStage: ApplicationStage;
  readonly fromStageChangedAt: string;
}

export class InterviewStagePromotions {
  constructor(private readonly database: DatabaseSync) {
    database.exec(INTERVIEW_STAGE_PROMOTION_SCHEMA);
  }

  /** Вызывать сразу после перехода в «Интервью»: событие перехода — последнее у отклика. */
  record(input: StagePromotionInput): void {
    const eventId = this.latestStageEvent(input.applicationId);
    if (!eventId) return;
    this.database
      .prepare(
        `INSERT OR REPLACE INTO application_interview_stage_promotions
           (interview_id, application_id, event_id, from_stage, from_stage_changed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.interviewId, input.applicationId, eventId, input.fromStage, input.fromStageChangedAt);
  }

  /**
   * После удаления интервью: вернуть этап, если отклик всё ещё в «Интервью» только из-за него —
   * других интервью нет, и после перехода кандидат этап не менял.
   */
  undo(applicationId: string, interviewId: string, now: string): boolean {
    const row = this.database
      .prepare(
        `SELECT event_id, from_stage, from_stage_changed_at
           FROM application_interview_stage_promotions WHERE interview_id = ?`,
      )
      .get(interviewId) as PromotionRow | undefined;
    if (!row) return false;
    this.database
      .prepare('DELETE FROM application_interview_stage_promotions WHERE interview_id = ?')
      .run(interviewId);
    if (!this.stillOnlyBecauseOf(applicationId, row.event_id)) return false;
    this.database
      .prepare(
        `UPDATE applications SET stage = ?, stage_changed_at = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND stage = 'interview'`,
      )
      .run(row.from_stage, row.from_stage_changed_at, now, applicationId);
    this.database.prepare('DELETE FROM application_events WHERE id = ?').run(row.event_id);
    return true;
  }

  private stillOnlyBecauseOf(applicationId: string, eventId: string): boolean {
    const others = this.database
      .prepare('SELECT COUNT(*) AS n FROM application_interviews WHERE application_id = ?')
      .get(applicationId) as { n: number };
    return others.n === 0 && this.latestStageEvent(applicationId) === eventId;
  }

  private latestStageEvent(applicationId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT id FROM application_events
          WHERE application_id = ? AND kind = 'stage'
          ORDER BY rowid DESC LIMIT 1`,
      )
      .get(applicationId) as { id: string } | undefined;
    return row?.id ?? null;
  }
}
