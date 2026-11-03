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
  /** Подстрока пункта (макет 14 `res`): к какому ответу он относится и насколько закрыт. */
  readonly detail: string;
  readonly action: RecommendationAction;
}

const MAX_RECOMMENDATIONS = 3;
const MAX_PROMPT_CHARS = 60;

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
      const action = actionFor(question, key);
      result.push({ text, detail: detailFor(question, criterion.points, action), action });
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

/** Только сохранённые данные ответа: история или вопрос, степень закрытия, факты профиля. */
function detailFor(
  question: InterviewQuestionView,
  points: 0 | 1 | 2,
  action: RecommendationAction,
): string {
  const source = question.storyTitle
    ? `История «${question.storyTitle}»`
    : `Вопрос «${shortPrompt(question.prompt)}»`;
  const state = points === 1 ? 'критерий закрыт частично' : 'критерий не закрыт';
  const facts = question.sourceFactIds.length;
  return action === 'profile' && facts > 0
    ? `${source}: ${state}, фактов профиля к вопросу: ${facts}`
    : `${source}: ${state}`;
}

function shortPrompt(prompt: string): string {
  const text = prompt.trim();
  if (text.length <= MAX_PROMPT_CHARS) return text;
  const cut = text.slice(0, MAX_PROMPT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
