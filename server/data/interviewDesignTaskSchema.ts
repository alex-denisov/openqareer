/**
 * B750: задача System Design, показанная кандидату по отклику: одна на кандидата и отклик,
 * чтобы при повторном открытии и в разборе была та же. Только новая таблица (CREATE IF NOT
 * EXISTS): безопасно для окна выката. Тело запечатано, как тренировка: в нём компания отклика.
 */
export const MIGRATION_INTERVIEW_DESIGN_TASK = `
CREATE TABLE IF NOT EXISTS candidate_interview_design_tasks (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL,
  body_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, application_id)
) STRICT;
`;

export function interviewDesignTaskAssociatedData(
  candidateId: string,
  applicationId: string,
): string {
  return `candidate:${candidateId}:interview-design-task:${applicationId}`;
}
