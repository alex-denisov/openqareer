import { z } from 'zod';

/**
 * Квиз по навыку профиля (блок A, пакет 3): вопросы генерирует модель по
 * названию навыка и уровню, правильные ответы остаются на сервере (B6).
 * Формат по совету консультанта 29.10: 8 вопросов, порог 80 %.
 */

export const GENERATED_QUIZ_QUESTION_COUNT = 8;
export const GENERATED_QUIZ_PASSING_PERCENT = 80;
export const GENERATED_QUIZ_DAILY_ATTEMPTS = 2;
/** Источник статуса в профиле: «Подтверждён · квиз openqareer, 29.10». */
export const GENERATED_QUIZ_SOURCE = 'квиз openqareer';

export const SKILL_QUIZ_LEVELS = ['junior', 'middle', 'senior'] as const;
export type SkillQuizLevel = (typeof SKILL_QUIZ_LEVELS)[number];

const OPTION_COUNT = 4;

const modelQuestionSchema = z.object({
  question: z.string().trim().min(5).max(600),
  options: z
    .array(z.string().trim().min(1).max(300))
    .length(OPTION_COUNT)
    .refine((options) => new Set(options.map((o) => o.toLowerCase())).size === OPTION_COUNT),
  correctOptionIndex: z
    .number()
    .int()
    .min(0)
    .max(OPTION_COUNT - 1),
  explanation: z.string().trim().min(1).max(800),
});

const modelAnswerSchema = z.object({
  questions: z.array(modelQuestionSchema).length(GENERATED_QUIZ_QUESTION_COUNT),
});

export interface GeneratedQuestion extends z.infer<typeof modelQuestionSchema> {
  readonly id: string;
}

export interface ClientQuestion {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
}

export interface GeneratedQuizResult {
  readonly scorePercent: number;
  readonly correctAnswersCount: number;
  readonly totalQuestions: number;
  readonly passed: boolean;
  readonly status: 'подтверждён' | 'не подтверждён';
  readonly source: string;
  readonly verifiedAt: string;
  readonly review: readonly {
    readonly questionId: string;
    readonly question: string;
    readonly selectedOptionIndex: number;
    readonly correctOptionIndex: number;
    readonly isCorrect: boolean;
    readonly explanation: string;
  }[];
}

/** Ответ модели годится, только если в нём ровно 8 вопросов по 4 разных варианта. */
export function parseGeneratedQuestions(answer: unknown): GeneratedQuestion[] | null {
  const parsed = modelAnswerSchema.safeParse(answer);
  if (!parsed.success) return null;
  return parsed.data.questions.map((question, index) => ({ ...question, id: `q${index + 1}` }));
}

/** Что уходит в браузер: формулировки и варианты, без ответа и разбора. */
export function clientQuestions(questions: readonly GeneratedQuestion[]): ClientQuestion[] {
  return questions.map(({ id, question, options }) => ({ id, question, options: [...options] }));
}

export function evaluateGeneratedQuiz(
  questions: readonly GeneratedQuestion[],
  answers: Readonly<Record<string, number>>,
  verifiedAt: string,
): GeneratedQuizResult {
  const review = questions.map((question) => {
    const selected = answers[question.id] ?? -1;
    return {
      questionId: question.id,
      question: question.question,
      selectedOptionIndex: selected,
      correctOptionIndex: question.correctOptionIndex,
      isCorrect: selected === question.correctOptionIndex,
      explanation: question.explanation,
    };
  });
  const correctAnswersCount = review.filter((item) => item.isCorrect).length;
  const scorePercent = Math.round((correctAnswersCount / questions.length) * 100);
  const passed = scorePercent >= GENERATED_QUIZ_PASSING_PERCENT;
  return {
    scorePercent,
    correctAnswersCount,
    totalQuestions: questions.length,
    passed,
    status: passed ? 'подтверждён' : 'не подтверждён',
    source: GENERATED_QUIZ_SOURCE,
    verifiedAt,
    review,
  };
}
