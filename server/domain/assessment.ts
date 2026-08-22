import { z } from 'zod';

const WORK_DIMENSIONS = [
  'ambiguity',
  'evidence',
  'collaboration',
  'persuasion',
  'planning',
  'detail',
  'leadership',
  'craft',
] as const;

const rating = z.number().int().min(1).max(5);

export const workPreferenceSubmissionSchema = z.object({
  ambiguity: rating,
  evidence: rating,
  collaboration: rating,
  persuasion: rating,
  planning: rating,
  detail: rating,
  leadership: rating,
  craft: rating,
});

export const productCaseSubmissionSchema = z.object({
  firstMove: z.enum([
    'segment-funnel-and-interviews',
    'review-funnel-only',
    'ship-largest-client-request',
  ]),
  priorityRule: z.enum([
    'reversible-test-biggest-uncertainty',
    'revenue-weighted-request',
    'loudest-stakeholder',
  ]),
  successMeasure: z.enum([
    'activation-by-segment-with-guardrail',
    'delivery-date',
    'features-shipped',
  ]),
  rationale: z.string().trim().max(2_000),
});

export type WorkPreferenceSubmission = z.infer<
  typeof workPreferenceSubmissionSchema
>;
export type ProductCaseSubmission = z.infer<
  typeof productCaseSubmissionSchema
>;

export type AssessmentId = 'work-preferences-v1' | 'product-case-v1';

type WorkDimension = (typeof WORK_DIMENSIONS)[number];

const FAMILY_WEIGHTS = {
  'product-discovery': {
    ambiguity: 2,
    evidence: 2,
    collaboration: 1,
    persuasion: 1,
    planning: 1,
    detail: 0,
    leadership: 0,
    craft: 1,
  },
  'operations-program': {
    ambiguity: 0,
    evidence: 1,
    collaboration: 1,
    persuasion: 0,
    planning: 2,
    detail: 2,
    leadership: 1,
    craft: 1,
  },
  'commercial-customer': {
    ambiguity: 1,
    evidence: 0,
    collaboration: 2,
    persuasion: 2,
    planning: 1,
    detail: 0,
    leadership: 1,
    craft: 0,
  },
  'specialist-analysis': {
    ambiguity: 0,
    evidence: 2,
    collaboration: 0,
    persuasion: 0,
    planning: 1,
    detail: 2,
    leadership: 0,
    craft: 2,
  },
} as const satisfies Record<string, Record<WorkDimension, number>>;

export interface WorkPreferenceResult {
  kind: 'work-preferences';
  version: 1;
  roleFamilies: Array<{
    id: keyof typeof FAMILY_WEIGHTS;
    signalStrength: number;
    contributions: Array<{
      dimension: WorkDimension;
      answer: number;
      weight: number;
      contribution: number;
    }>;
  }>;
  caveat: string;
}

export function evaluateWorkPreferences(
  input: WorkPreferenceSubmission,
): WorkPreferenceResult {
  const roleFamilies = Object.entries(FAMILY_WEIGHTS)
    .map(([id, weights]) => {
      const contributions = WORK_DIMENSIONS.filter(
        (dimension) => weights[dimension] > 0,
      ).map((dimension) => ({
        dimension,
        answer: input[dimension],
        weight: weights[dimension],
        contribution: (input[dimension] - 1) * weights[dimension],
      }));
      const maximum = contributions.reduce(
        (total, contribution) => total + 4 * contribution.weight,
        0,
      );
      const observed = contributions.reduce(
        (total, contribution) => total + contribution.contribution,
        0,
      );
      return {
        id: id as keyof typeof FAMILY_WEIGHTS,
        signalStrength: Math.round((observed / maximum) * 100),
        contributions,
      };
    })
    .sort(
      (left, right) =>
        right.signalStrength - left.signalStrength ||
        left.id.localeCompare(right.id),
    );
  return {
    kind: 'work-preferences',
    version: 1,
    roleFamilies,
    caveat:
      'Это самоотчёт о предпочитаемом способе работы, а не тест личности, способностей или гарантия соответствия роли.',
  };
}

const PRODUCT_CASE_RUBRIC = {
  firstMove: {
    criterion: 'problem-framing',
    options: {
      'segment-funnel-and-interviews': 2,
      'review-funnel-only': 1,
      'ship-largest-client-request': 0,
    },
    demonstrated:
      'Сначала локализует проблему по сегментам и соединяет данные с разговорами.',
    question:
      'Как отделить симптом от причины до того, как команда начнёт разработку?',
  },
  priorityRule: {
    criterion: 'evidence-prioritisation',
    options: {
      'reversible-test-biggest-uncertainty': 2,
      'revenue-weighted-request': 1,
      'loudest-stakeholder': 0,
    },
    demonstrated:
      'Снижает главную неопределённость обратимым тестом до крупной ставки.',
    question:
      'Как сравнить срочность запроса с ценностью снятой неопределённости?',
  },
  successMeasure: {
    criterion: 'outcome-measurement',
    options: {
      'activation-by-segment-with-guardrail': 2,
      'delivery-date': 1,
      'features-shipped': 0,
    },
    demonstrated:
      'Измеряет изменение поведения по сегментам и удерживает защитную метрику.',
    question:
      'Какая метрика покажет изменение поведения, а не только факт выпуска?',
  },
} as const;

export interface ProductCaseResult {
  kind: 'product-case';
  version: 1;
  rubric: Array<{
    criterion:
      | 'problem-framing'
      | 'evidence-prioritisation'
      | 'outcome-measurement';
    selectedOption: string;
    points: number;
    maxPoints: 2;
  }>;
  demonstratedSignals: string[];
  openQuestions: string[];
  rationale: string;
  summary: string;
  caveat: string;
}

export type AssessmentSubmission =
  | WorkPreferenceSubmission
  | ProductCaseSubmission;

export type AssessmentResult = WorkPreferenceResult | ProductCaseResult;

export function evaluateProductCase(
  input: ProductCaseSubmission,
): ProductCaseResult {
  const entries = (
    Object.keys(PRODUCT_CASE_RUBRIC) as Array<
      keyof typeof PRODUCT_CASE_RUBRIC
    >
  ).map((key) => {
    const definition = PRODUCT_CASE_RUBRIC[key];
    const selectedOption = input[key];
    const points = definition.options[
      selectedOption as keyof typeof definition.options
    ] as number;
    return {
      criterion: definition.criterion,
      selectedOption,
      points,
      maxPoints: 2 as const,
      demonstrated: definition.demonstrated,
      question: definition.question,
    };
  });
  const demonstratedSignals = entries
    .filter((entry) => entry.points === entry.maxPoints)
    .map((entry) => entry.demonstrated);
  const openQuestions = entries
    .filter((entry) => entry.points < entry.maxPoints)
    .map((entry) => entry.question);
  return {
    kind: 'product-case',
    version: 1,
    rubric: entries.map(
      ({ criterion, selectedOption, points, maxPoints }) => ({
        criterion,
        selectedOption,
        points,
        maxPoints,
      }),
    ),
    demonstratedSignals,
    openQuestions,
    rationale: input.rationale,
    summary:
      demonstratedSignals.length === 0
        ? 'Этот короткий кейс пока не показал три проверяемых продуктовых сигнала; открытые вопросы подскажут, что проверить следующим.'
        : `Кейс показал ${demonstratedSignals.length} из 3 проверяемых продуктовых сигналов; это материал для следующего интервью, а не вывод о соответствии роли.`,
    caveat:
      'Один короткий кейс не измеряет весь профессиональный уровень и не предсказывает решение работодателя.',
  };
}
