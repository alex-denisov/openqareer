import type { InterviewQuestionView, InterviewSessionView } from './interviewSimulatorApi';

/**
 * Что запускает кнопка рекомендации в итоге (макет 14):
 * story — редактор STAR-историй;
 * profile — раздел «Профиль», где лежат подтверждённые факты;
 * restart — тренажёр заново.
 */
export type RecommendationAction = 'story' | 'profile' | 'restart';

export interface InterviewRecommendation {
  readonly text: string;
  readonly action: RecommendationAction;
}

const MAX_RECOMMENDATIONS = 3;

/** До трёх незакрытых критериев из сохранённых ответов, каждый с действием, которое реально доступно. */
export function deriveRecommendationActions(
  session: Pick<InterviewSessionView, 'questions'>,
): InterviewRecommendation[] {
  const result: InterviewRecommendation[] = [];
  const seen = new Set<string>();
  for (const question of session.questions) {
    for (const [key, criterion] of Object.entries(question.answer?.evaluation.criteria ?? {})) {
      const text = criterion.reason.trim();
      if (criterion.points === 2 || !text || seen.has(text)) continue;
      seen.add(text);
      result.push({ text, action: actionFor(question, key) });
      if (result.length === MAX_RECOMMENDATIONS) return result;
    }
  }
  return result;
}

/** Цифры результата без истории берутся из подтверждённых фактов профиля; остальное в STAR правится в редакторе. */
function actionFor(question: InterviewQuestionView, criterion: string): RecommendationAction {
  if (question.type !== 'behavioral') return 'restart';
  return criterion === 'result' && !question.storyId ? 'profile' : 'story';
}
