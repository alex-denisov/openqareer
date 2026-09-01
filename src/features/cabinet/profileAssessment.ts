import type { CandidateProfileView } from './profileView';

/**
 * Оценка профиля — только пересчитываемые проверки.
 *
 * Макет «Пульт» рисует кольцо «68 из 100» и четыре шкалы (ATS-читаемость,
 * конкретика, полнота, соответствие роли). Выдумать эти числа нельзя:
 * `DESIGN.md` запрещает показывать оценку без источника, выборки и даты — это
 * находка 8 аудита B178. Поэтому форма макета сохранена, а содержание —
 * счётное: кольцо равно доле пройденных проверок, каждая шкала называет свой
 * знаменатель, а профиль без данных не даёт ни одного числа.
 */
export const ASSESSMENT_METHOD_VERSION = 'profile-assessment-resume-v2';

export interface ProfileMeasure {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly total: number;
  /** Из чего сложено число: кандидат должен уметь его проверить. */
  readonly basis: string;
}

export interface ProfileScore {
  /** Доля пройденных проверок, 0..100. */
  readonly value: number;
  readonly checks: number;
  readonly total: number;
}

export interface ProfileAssessment {
  readonly methodVersion: typeof ASSESSMENT_METHOD_VERSION;
  readonly measures: readonly ProfileMeasure[];
  readonly score?: ProfileScore;
  readonly measuredAt?: string;
}

export interface ProfileAssessmentInput {
  readonly view: CandidateProfileView;
  readonly targetDirection: string;
}

export function assessProfile({
  view,
  targetDirection,
}: ProfileAssessmentInput): ProfileAssessment {
  const measures = [
    sectionsMeasure(view),
    ...measurableResultsMeasure(view),
    ...datedExperienceMeasure(view),
    ...targetRoleMeasure(view, targetDirection),
  ];

  if (isEmptyProfile(view)) {
    return { methodVersion: ASSESSMENT_METHOD_VERSION, measures: [] };
  }

  const checks = measures.reduce((sum, measure) => sum + measure.value, 0);
  const total = measures.reduce((sum, measure) => sum + measure.total, 0);

  return {
    methodVersion: ASSESSMENT_METHOD_VERSION,
    measures,
    score:
      total === 0
        ? undefined
        : { value: Math.round((checks / total) * 100), checks, total },
    measuredAt: view.updatedAt,
  };
}

function isEmptyProfile(view: CandidateProfileView): boolean {
  return (
    !view.about &&
    view.experience.length === 0 &&
    view.skills.length === 0 &&
    view.education.length === 0 &&
    view.languages.length === 0
  );
}

/** Разделы профиля — те, что кандидат заполняет о себе. */
function sectionsMeasure(view: CandidateProfileView): ProfileMeasure {
  const sections: Array<{ label: string; filled: boolean }> = [
    { label: 'о себе', filled: Boolean(view.about) },
    { label: 'опыт', filled: view.experience.length > 0 },
    { label: 'навыки', filled: view.skills.length > 0 },
    { label: 'образование', filled: view.education.length > 0 },
    { label: 'языки', filled: view.languages.length > 0 },
  ];
  const empty = sections.filter((section) => !section.filled);

  return {
    id: 'sections',
    label: 'Полнота профиля',
    value: sections.length - empty.length,
    total: sections.length,
    basis:
      empty.length === 0
        ? 'Все разделы профиля заполнены.'
        : `Пусто: ${empty.map((section) => section.label).join(', ')}.`,
  };
}

/** Результат без числа читается как обязанность, а не как достижение. */
function measurableResultsMeasure(view: CandidateProfileView): ProfileMeasure[] {
  const bullets = view.experience.reduce((sum, entry) => sum + entry.bullets.length, 0);
  if (bullets === 0) return [];
  const measurable = view.experience.reduce((sum, entry) => sum + entry.measurableBullets, 0);

  return [
    {
      id: 'measurable-results',
      label: 'Конкретика результатов',
      value: measurable,
      total: bullets,
      basis:
        measurable === bullets
          ? 'Каждый пункт опыта называет величину.'
          : 'Пункт без числа читается как обязанность, а не как достижение.',
    },
  ];
}

/** Место работы без дат не читается ни человеком, ни разбором вакансии. */
function datedExperienceMeasure(view: CandidateProfileView): ProfileMeasure[] {
  if (view.experience.length === 0) return [];
  const dated = view.experience.filter((entry) => entry.period !== '');

  return [
    {
      id: 'dated-experience',
      label: 'Опыт с датами',
      value: dated.length,
      total: view.experience.length,
      basis:
        dated.length === view.experience.length
          ? 'У каждого места работы есть период.'
          : 'Без периода место работы не складывается в стаж.',
    },
  ];
}

function targetRoleMeasure(
  view: CandidateProfileView,
  targetDirection: string,
): ProfileMeasure[] {
  const named = Boolean(view.targetRole?.trim() || targetDirection.trim());

  return [
    {
      id: 'target-role',
      label: 'Целевая роль',
      value: named ? 1 : 0,
      total: 1,
      basis: named
        ? 'Направление названо — рынок есть с чем сравнивать.'
        : 'Направление не названо, поэтому рынок не с чем сравнивать.',
    },
  ];
}
