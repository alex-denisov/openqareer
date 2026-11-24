import { createHash } from 'node:crypto';
import type { QuestionnaireAnswer, QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';

const MAX_SKILLS = 6;
/** Длиннее — уже фраза требования, а не навык. */
const MAX_SKILL_LENGTH = 40;
const MONTHS_IN_YEAR = 12;
const YES_NO = ['Да', 'Нет'] as const;

function keyed(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value.trim().toLocaleLowerCase()).digest('hex');
  return `${prefix}-${digest.slice(0, 16)}`;
}

const skillQuestionId = (skill: string): string => keyed('std-years', skill);

/** Страна вакансии — только когда место записано через запятую. */
function countryOf(location: string | undefined): string | null {
  const parts = (location ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? (parts.at(-1) ?? null) : null;
}

const text = (id: string, label: string): QuestionnaireQuestion => ({
  id,
  text: label,
  required: true,
  kind: 'text',
});
const choice = (id: string, label: string): QuestionnaireQuestion => ({
  ...text(id, label),
  kind: 'choice',
  options: YES_NO,
});

function uniqueSkills(skills: readonly string[]): readonly string[] {
  const names = skills.map((skill) => skill.trim()).filter((skill) => skill && skill.length <= MAX_SKILL_LENGTH);
  const seen = new Set<string>();
  return names
    .filter((skill) => {
      const key = skill.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SKILLS);
}

/** Типовые вопросы формы, которую заранее прочитать нельзя: контакты, опыт, право на работу. */
export function standardQuestions(vacancy: {
  readonly vacancyId: string;
  readonly skills: readonly string[];
  readonly location?: string;
}): readonly QuestionnaireQuestion[] {
  const country = countryOf(vacancy.location);
  // Без страны ответ относится только к этой вакансии.
  const scope = country ?? vacancy.vacancyId;
  return [
    text('std-name', 'Полное имя'),
    text('std-email', 'Электронная почта'),
    text('std-phone', 'Телефон'),
    text('std-city', 'Город'),
    ...uniqueSkills(vacancy.skills).map((skill) =>
      text(skillQuestionId(skill), `Сколько лет опыта: ${skill}?`),
    ),
    choice(
      keyed('std-right', scope),
      country ? `Есть право на работу: ${country}?` : 'Есть право на работу в стране вакансии?',
    ),
    choice(
      keyed('std-visa', scope),
      country ? `Нужна рабочая виза: ${country}?` : 'Нужна рабочая виза в стране вакансии?',
    ),
    text('std-salary', 'Ожидаемая зарплата'),
    text('std-start', 'Когда можете выйти на работу?'),
  ];
}

export interface WorkplaceSkills {
  readonly startDate?: string;
  readonly endDate?: string;
  readonly current: boolean;
  readonly skills?: readonly string[];
}

/** Месяцы от нулевого года; дата без месяца не годится: год опыта пришлось бы додумать. */
function monthIndex(date: string | undefined): number | null {
  const match = /^(\d{4})-(\d{2})/u.exec(date ?? '');
  return match ? Number(match[1]) * MONTHS_IN_YEAR + Number(match[2]) - 1 : null;
}

function yearsOf(skill: string, places: readonly WorkplaceSkills[], now: Date): number {
  const wanted = skill.trim().toLocaleLowerCase();
  const today = now.getUTCFullYear() * MONTHS_IN_YEAR + now.getUTCMonth();
  const months = new Set<number>();
  for (const place of places) {
    if (!place.skills?.some((item) => item.trim().toLocaleLowerCase() === wanted)) continue;
    const start = monthIndex(place.startDate);
    const end = place.current ? today : monthIndex(place.endDate);
    if (start === null || end === null) continue;
    for (let month = start; month <= end; month += 1) months.add(month);
  }
  return Math.floor(months.size / MONTHS_IN_YEAR);
}

/** Годы опыта — только по местам работы, где кандидат сам записал этот навык. */
export function skillYearAnswers(
  skills: readonly string[],
  places: readonly WorkplaceSkills[],
  now: Date,
): readonly QuestionnaireAnswer[] {
  return uniqueSkills(skills).flatMap((skill) => {
    const years = yearsOf(skill, places, now);
    return years > 0 ? [{ questionId: skillQuestionId(skill), text: String(years) }] : [];
  });
}

/**
 * Что уже известно по типовым вопросам: прошлый ответ кандидата на тот же вопрос, затем годы опыта.
 * Один раз отвеченное у другой вакансии второй раз не спрашивается.
 */
export function knownAnswers(
  questions: readonly QuestionnaireQuestion[],
  previous: readonly QuestionnaireAnswer[],
  years: readonly QuestionnaireAnswer[],
): readonly QuestionnaireAnswer[] {
  const byId = new Map([...years, ...previous.filter((item) => item.text)].map((item) => [item.questionId, item]));
  return questions.flatMap(({ id }) => {
    const answer = id.startsWith('std-') ? byId.get(id) : undefined;
    return answer ? [answer] : [];
  });
}
