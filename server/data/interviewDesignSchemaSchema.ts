/**
 * B647: исправленная кандидатом схема System Design по вопросу тренировки.
 * Только новая таблица (CREATE IF NOT EXISTS): безопасно для окна выката 20 с.
 * Тело схемы хранится запечатанным, как тренировка: в нём цитаты из ответа.
 */
export const MIGRATION_INTERVIEW_DESIGN_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_interview_design_schemas (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  body_cipher TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, session_id, question_id)
) STRICT;
`;

export function interviewDesignSchemaAssociatedData(
  candidateId: string,
  sessionId: string,
  questionId: string,
): string {
  return `candidate:${candidateId}:interview-design-schema:${sessionId}:${questionId}`;
}
