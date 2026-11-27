import { DEFAULT_CANDIDATE_ACTION_LIMITS } from '../../shared/candidateActionPolicy';
import type { HhResumeSnapshot } from '../../shared/hhCandidateSession';
import { HH_ATTEMPT_STALE_MS, type HhAttemptRow } from '../candidate/sqliteHhSessionRepository';

/**
 * B704: можно ли начать отклик через hh.ru от имени кандидата. Предел — тот же, что у
 * откликов в сессии кандидата (15 за сутки); в него входит каждая попытка, и неудачная тоже:
 * площадка видит каждое действие.
 */
export type HhApplyRefusal =
  | 'hh_resumes_not_read'
  | 'hh_resume_not_in_session'
  | 'hh_copy_not_ready'
  | 'hh_apply_in_progress'
  | 'hh_already_applied'
  | 'hh_daily_limit_reached'
  | 'hh_cooldown';

/** После проверки «вы не робот» или неподтверждённого отклика площадка получает паузу. */
export const HH_COOLDOWN_MS = 60 * 60 * 1000;
const COOLDOWN_FAILURES: ReadonlySet<string> = new Set(['captcha', 'no_confirmation']);

function coolingDown(recent: readonly HhAttemptRow[], now: Date): boolean {
  return recent.some(
    (attempt) =>
      attempt.failureCode !== null &&
      COOLDOWN_FAILURES.has(attempt.failureCode) &&
      now.getTime() - Date.parse(attempt.finishedAt ?? attempt.startedAt) < HH_COOLDOWN_MS,
  );
}

export interface HhApplyGateInput {
  readonly snapshot: HhResumeSnapshot | null;
  readonly resumeId: string;
  readonly recent: readonly HhAttemptRow[];
  readonly forVacancy: readonly HhAttemptRow[];
  readonly now: Date;
}

export type HhApplyGateResult =
  | { readonly ok: true; readonly remainingToday: number }
  | { readonly ok: false; readonly refusal: HhApplyRefusal };

function inProgress(attempt: HhAttemptRow, now: Date): boolean {
  return attempt.outcome === null && now.getTime() - Date.parse(attempt.startedAt) < HH_ATTEMPT_STALE_MS;
}

export function hhApplyGate(input: HhApplyGateInput): HhApplyGateResult {
  if (!input.snapshot) return { ok: false, refusal: 'hh_resumes_not_read' };
  if (!input.snapshot.resumes.some((resume) => resume.id === input.resumeId)) {
    return { ok: false, refusal: 'hh_resume_not_in_session' };
  }
  // B787: копия под вакансию без правок или с видимостью «всем» работодателю не уходит.
  const copies = Object.values(input.snapshot.copies ?? {});
  if (copies.some((copy) => copy.copyId === input.resumeId && copy.stage !== 'ready')) {
    return { ok: false, refusal: 'hh_copy_not_ready' };
  }
  if (input.forVacancy.some((attempt) => inProgress(attempt, input.now))) {
    return { ok: false, refusal: 'hh_apply_in_progress' };
  }
  // hh.ru сам показал прежний отклик: повтор только тратит попытку.
  if (input.forVacancy.some((attempt) => attempt.failureCode === 'already_applied')) {
    return { ok: false, refusal: 'hh_already_applied' };
  }
  // Анкета после отклика тоже значит, что отклик на hh.ru ушёл.
  if (input.forVacancy.some((attempt) => attempt.outcome === 'sent' || attempt.outcome === 'questionnaire')) {
    return { ok: false, refusal: 'hh_already_applied' };
  }
  if (coolingDown(input.recent, input.now)) return { ok: false, refusal: 'hh_cooldown' };
  const limit = DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhAppliesPerDay;
  if (input.recent.length >= limit) return { ok: false, refusal: 'hh_daily_limit_reached' };
  return { ok: true, remainingToday: limit - input.recent.length - 1 };
}
