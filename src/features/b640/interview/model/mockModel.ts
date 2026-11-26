import type { InterviewEvaluation } from '../../../interview/interviewSimulatorApi';

export type SessionChoice = 'start' | 'resume' | 'other';

export interface CriterionRow {
  readonly key: string;
  readonly title: string;
  readonly sub: string;
  readonly tag: 'есть' | 'уточнить' | 'добавить';
  readonly ok: boolean;
}

const CRITERION_TITLE: Readonly<Record<string, string>> = {
  situation: 'Ситуация и ваша роль',
  task: 'Задача',
  action: 'Что сделали вы',
  result: 'Результат назван',
  requirements: 'Требования уточнены',
  architecture: 'Части системы',
  tradeoffs: 'Выбор объяснён',
  operations: 'Работа под нагрузкой и сбои',
};

const TAG_BY_POINTS = ['добавить', 'уточнить', 'есть'] as const;

/**
 * Незаконченная тренировка этого отклика продолжается; чужую сначала надо закончить. Задача
 * System Design (i03) по этому же отклику — тоже чужая: её вопрос не для пробного интервью.
 */
export function sessionChoice(
  current: {
    readonly status: string;
    readonly applicationId: string | null;
    readonly questionTypes: readonly string[];
  } | null,
  responseId: string,
): SessionChoice {
  if (!current || current.status === 'completed') return 'start';
  const own = current.applicationId === responseId && current.questionTypes.includes('behavioral');
  return own ? 'resume' : 'other';
}

export function criteriaRows(evaluation: InterviewEvaluation): readonly CriterionRow[] {
  return Object.entries(evaluation.criteria).map(([key, value]) => ({
    key,
    title: CRITERION_TITLE[key] ?? key,
    sub: value.reason,
    tag: TAG_BY_POINTS[value.points],
    ok: value.points === 2,
  }));
}

export function mockEyebrow(
  company: string | null | undefined,
  index: number,
  total: number,
): string {
  return ['Пробное интервью', company, `вопрос ${index + 1} из ${total}`]
    .filter(Boolean)
    .join(' · ');
}
