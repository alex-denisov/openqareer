import type { CandidateMemory } from '../coach/coachApi';

/**
 * Оценка досье — только пересчитываемые меры.
 *
 * Макет «Пульт» рисует кольцо «68 из 100» и четыре шкалы (ATS-читаемость,
 * конкретика, полнота, соответствие роли). Ни одну из них продукт сегодня не
 * измеряет, а `DESIGN.md` запрещает показывать оценку без источника, выборки и
 * даты — это находка 8 аудита B178, тот же класс, что проценты соответствия у
 * вакансий. Поэтому здесь считается только то, что лежит в досье кандидата:
 * сколько разделов заполнено подтверждёнными фактами, сколько результатов
 * несут число, сколько фактов ждут подтверждения и названа ли целевая роль.
 *
 * Каждая мера несёт свою опору (`basis`) и общий знаменатель, чтобы кандидат
 * видел, из чего сложено число. Пустое досье не даёт ни одной меры — пустой
 * прогресс-бар был бы такой же выдумкой, как «68 из 100».
 */
export const ASSESSMENT_METHOD_VERSION = 'profile-assessment-dossier-v1';

/** Разделы, из которых состоит карьерная часть досье. */
const CONTENT_DOMAINS: ReadonlyArray<{
  domain: CandidateMemory['domain'];
  label: string;
}> = [
  { domain: 'responsibility', label: 'Ответственность' },
  { domain: 'outcome', label: 'Результаты' },
  { domain: 'skill', label: 'Навыки' },
  { domain: 'role-evidence', label: 'Опора под роль' },
];

export interface ProfileMeasure {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly total: number;
  /** Из чего сложено число: кандидат должен уметь его проверить. */
  readonly basis: string;
}

export interface ProfileAssessment {
  readonly methodVersion: typeof ASSESSMENT_METHOD_VERSION;
  readonly measures: readonly ProfileMeasure[];
  /** Когда досье менялось в последний раз; неизвестно — значит не печатаем. */
  readonly measuredAt?: string;
}

export interface ProfileAssessmentInput {
  readonly memory: readonly CandidateMemory[];
  readonly targetDirection: string;
}

/** Число в тексте — единственное доказательство, что результат измерим. */
const CARRIES_A_NUMBER = /\d/u;

export function assessProfile({
  memory,
  targetDirection,
}: ProfileAssessmentInput): ProfileAssessment {
  const facts = memory.filter((item) => item.kind === 'fact');
  if (facts.length === 0) {
    return { methodVersion: ASSESSMENT_METHOD_VERSION, measures: [] };
  }

  const confirmed = facts.filter(
    (item) => item.status === 'confirmed' || item.status === 'corrected',
  );

  return {
    methodVersion: ASSESSMENT_METHOD_VERSION,
    measures: [
      sectionsMeasure(confirmed),
      ...outcomeMeasure(confirmed),
      confirmedMeasure(facts, confirmed),
      ...targetRoleMeasure(targetDirection),
    ],
    measuredAt: lastChangedAt(facts),
  };
}

/** Раздел заполнен, только если в нём лежит подтверждённый факт. */
function sectionsMeasure(confirmed: readonly CandidateMemory[]): ProfileMeasure {
  const empty = CONTENT_DOMAINS.filter(
    ({ domain }) => !confirmed.some((item) => item.domain === domain),
  );

  return {
    id: 'sections',
    label: 'Разделы досье',
    value: CONTENT_DOMAINS.length - empty.length,
    total: CONTENT_DOMAINS.length,
    basis:
      empty.length === 0
        ? 'Все разделы держат хотя бы один подтверждённый факт.'
        : `Пусто: ${empty
            .map(({ label }) => label.toLocaleLowerCase('ru-RU'))
            .join(', ')}. Раздел считается заполненным по подтверждённому факту.`,
  };
}

/** Результат без числа читается как обязанность, а не как достижение. */
function outcomeMeasure(
  confirmed: readonly CandidateMemory[],
): ProfileMeasure[] {
  const outcomes = confirmed.filter((item) => item.domain === 'outcome');
  if (outcomes.length === 0) return [];

  const measurable = outcomes.filter((item) =>
    CARRIES_A_NUMBER.test(item.statement),
  );

  return [
    {
      id: 'measurable-results',
      label: 'Результаты с числом',
      value: measurable.length,
      total: outcomes.length,
      basis:
        measurable.length === outcomes.length
          ? 'Каждый подтверждённый результат называет величину.'
          : 'Результат без числа читается как обязанность, а не как достижение.',
    },
  ];
}

function confirmedMeasure(
  facts: readonly CandidateMemory[],
  confirmed: readonly CandidateMemory[],
): ProfileMeasure {
  const pending = facts.filter((item) => item.status === 'proposed').length;
  return {
    id: 'confirmed-facts',
    label: 'Подтверждено фактов',
    value: confirmed.length,
    total: facts.length,
    basis:
      pending > 0
        ? `${pending} ждут вашего подтверждения — до него они не попадают ни в резюме, ни в оценку.`
        : 'Все факты досье подтверждены вами.',
  };
}

/** Без названного направления рынок не с чем сравнивать. */
function targetRoleMeasure(targetDirection: string): ProfileMeasure[] {
  if (targetDirection.trim()) return [];
  return [
    {
      id: 'target-role',
      label: 'Целевая роль',
      value: 0,
      total: 1,
      basis:
        'Направление не названо, поэтому рынок не с чем сравнивать. Назовите его в «Карьере».',
    },
  ];
}

/**
 * Дата пересчёта — последнее изменение досье, а не момент отрисовки: экран не
 * имеет права выдавать открытие страницы за свежий замер.
 */
function lastChangedAt(facts: readonly CandidateMemory[]): string | undefined {
  const stamps = facts
    .map((item) => item.updatedAt ?? item.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return stamps.at(-1);
}
