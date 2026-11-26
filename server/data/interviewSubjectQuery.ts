import type { DatabaseSync } from 'node:sqlite';
import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';
import type { CandidateInterviewSubject } from './candidateStore';

/** Вакансия отклика из общего чтения (`vacancy_cipher` расшифровывает репозиторий откликов). */
export type ReadApplicationVacancy = (
  candidateId: string,
  applicationId: string,
) => VacancyApplicationSnapshot | null;

/**
 * Интервью кандидата с откликом и вакансией: для тренажёра и разбора (B251).
 * B746: вакансия хранится зашифрованной, сырым SQL её не прочитать — берём через общее чтение.
 */
export function queryInterviewSubject(
  database: DatabaseSync,
  candidateId: string,
  interviewId: string,
  readVacancy: ReadApplicationVacancy,
): CandidateInterviewSubject | null {
  const row = database
    .prepare(
      `SELECT i.id, i.application_id, i.round, i.scheduled_at, a.stage
       FROM application_interviews i
       JOIN applications a ON a.id = i.application_id
       WHERE i.id = ? AND a.candidate_id = ?`,
    )
    .get(interviewId, candidateId) as
    | {
        id: string;
        application_id: string;
        round: number;
        scheduled_at: string | null;
        stage: string;
      }
    | undefined;
  if (!row) return null;
  const vacancy = readVacancy(candidateId, row.application_id);
  return {
    id: row.id,
    applicationId: row.application_id,
    round: row.round,
    scheduledAt: row.scheduled_at,
    stage: row.stage,
    ...(vacancy?.title ? { vacancyTitle: vacancy.title } : {}),
    ...(vacancy?.company ? { vacancyCompany: vacancy.company } : {}),
  };
}
