/** Сколько вопросов сервер кладёт в одну тренировку мок-интервью. */
export const INTERVIEW_QUESTION_COUNT = 5;

/** Минут на вопрос: ответ, разбор и время подумать. */
const MINUTES_PER_QUESTION = 2.5;

export type InterviewPlanQuestionType = 'behavioral' | 'system_design';

/** Сколько вопросов каждого типа даст план: типы чередуются по порядку, как в `buildInterviewQuestionPlan`. */
export function countPlannedQuestionTypes(
  questionTypes: readonly InterviewPlanQuestionType[],
  total: number = INTERVIEW_QUESTION_COUNT,
): Readonly<Record<InterviewPlanQuestionType, number>> {
  const types = questionTypes.length ? questionTypes : (['behavioral'] as const);
  return Array.from({ length: total }, (_, index) => types[index % types.length]).reduce(
    (counts, type) => ({ ...counts, [type]: counts[type] + 1 }),
    { behavioral: 0, system_design: 0 },
  );
}

/** Длительность тренировки, округлённая вверх до 5 минут. */
export function estimateInterviewMinutes(total: number = INTERVIEW_QUESTION_COUNT): number {
  return Math.ceil((total * MINUTES_PER_QUESTION) / 5) * 5;
}
