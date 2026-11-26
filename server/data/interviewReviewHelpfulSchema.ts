/**
 * B681: оценка кандидата «разбор помог» по вопросу тренировки. Новая таблица,
 * без изменения существующих: безопасно для окна выката 20 с (B230).
 */
export const MIGRATION_INTERVIEW_REVIEW_HELPFUL = `
CREATE TABLE IF NOT EXISTS candidate_interview_review_helpful (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, session_id, question_id)
) STRICT;
`;
