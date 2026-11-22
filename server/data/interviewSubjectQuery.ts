import type { DatabaseSync } from 'node:sqlite';
import type { CandidateInterviewSubject } from './candidateStore';

function parseInterviewSnapshot(raw: string | null) {
  if (!raw) return {};
  try {
    const snap = JSON.parse(raw) as { title?: string; company?: string };
    return { vacancyTitle: snap.title, vacancyCompany: snap.company };
  } catch {
    return {};
  }
}

/** Интервью кандидата с откликом и вакансией: для тренажёра и разбора (B251). */
export function queryInterviewSubject(
  database: DatabaseSync,
  candidateId: string,
  interviewId: string,
): CandidateInterviewSubject | null {
  const row = database
    .prepare(
      `SELECT i.id, i.application_id, i.round, i.scheduled_at,
              a.stage, a.vacancy_snapshot, a.cluster_id
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
        vacancy_snapshot: string | null;
        cluster_id: string | null;
      }
    | undefined;
  if (!row) return null;
  const { vacancyTitle, vacancyCompany } = parseInterviewSnapshot(row.vacancy_snapshot);
  return {
    id: row.id,
    applicationId: row.application_id,
    round: row.round,
    scheduledAt: row.scheduled_at,
    stage: row.stage,
    vacancyTitle,
    vacancyCompany,
  };
}
