import type { CandidateSnapshot } from '../coach/coachApi';

/**
 * Профиль кандидата собирается из разобранного резюме.
 *
 * Резюме владельца разбиралось полностью — места работы с датами, пункты,
 * образование, навыки, языки, — а «Главная» показывала плоский список записей
 * памяти и очередь подтверждения; на экране от резюме не оставалось ничего
 * (B179). Разобранное резюме — это то, что кандидат сам о себе сообщил, и
 * отдельного подтверждения, чтобы попасть в его собственный профиль, оно не
 * требует. Проверка формулировок остаётся работой консультанта, а не воротами
 * на вход.
 */

export interface ProfileExperienceEntry {
  readonly id: string;
  readonly title?: string;
  readonly employer?: string;
  readonly period: string;
  readonly duration: string;
  readonly current: boolean;
  readonly bullets: readonly string[];
  /** Сколько пунктов называют величину: результат без числа — обязанность. */
  readonly measurableBullets: number;
}

export interface ProfileEducationEntry {
  readonly id: string;
  readonly institution?: string;
  readonly qualification?: string;
  readonly period: string;
}

export interface CandidateProfileView {
  readonly fullName?: string;
  readonly targetRole?: string;
  readonly location?: string;
  readonly about?: string;
  readonly experience: readonly ProfileExperienceEntry[];
  /** Суммарный стаж по датам мест работы; пусто — если дат нет. */
  readonly totalExperience?: string;
  readonly skills: readonly string[];
  readonly education: readonly ProfileEducationEntry[];
  readonly languages: readonly string[];
  readonly updatedAt?: string;
}

const EMPTY_VIEW: CandidateProfileView = {
  experience: [],
  skills: [],
  education: [],
  languages: [],
};

/** Число в пункте — единственное доказательство, что результат измерим. */
const CARRIES_A_NUMBER = /\d/u;

const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

export function buildProfileView(snapshot?: CandidateSnapshot): CandidateProfileView {
  const draft = snapshot?.resume?.draft;
  if (!draft) return EMPTY_VIEW;

  const statements = new Map(
    (snapshot?.memory ?? []).map((record) => [record.id, record.statement]),
  );

  const experience = draft.experience.map((entry) => {
    const bullets = entry.bulletMemoryIds
      .map((id) => statements.get(id))
      .filter((statement): statement is string => Boolean(statement));

    return {
      id: entry.id,
      title: entry.title,
      employer: entry.employer,
      period: periodLabel(entry.startDate, entry.endDate, entry.current),
      duration: durationLabel(entry.startDate, entry.endDate, entry.current),
      current: entry.current,
      bullets,
      measurableBullets: bullets.filter((bullet) => CARRIES_A_NUMBER.test(bullet)).length,
    } satisfies ProfileExperienceEntry;
  });

  return {
    fullName: draft.candidate?.fullName,
    targetRole: draft.targetRole,
    location: draft.candidate?.contact?.location,
    about: draft.candidate?.about,
    experience,
    totalExperience: totalExperienceLabel(experience),
    skills: (draft.skills ?? []).map((skill) => skill.name).filter(Boolean),
    education: draft.education.map((entry) => ({
      id: entry.id,
      institution: entry.institution,
      qualification: entry.qualification,
      period: periodLabel(entry.startDate, entry.endDate, false),
    })),
    languages: (draft.languages ?? [])
      .map((language) => language.name)
      .filter((name): name is string => Boolean(name)),
    updatedAt: snapshot?.resume?.updatedAt,
  };
}

/** «апрель 2023 — октябрь 2025»; год без месяца печатается годом. */
function periodLabel(start?: string, end?: string, current = false): string {
  const from = monthLabel(start);
  const to = current ? 'наст. время' : monthLabel(end);
  if (!from && !to) return '';
  if (!to) return from;
  if (!from) return to;
  return `${from} — ${to}`;
}

function monthLabel(value?: string): string {
  if (!value) return '';
  const match = /^(\d{4})(?:-(\d{2}))?/u.exec(value.trim());
  if (!match) return value.trim();
  const [, year, month] = match;
  if (!month) return year;
  const index = Number(month) - 1;
  return index >= 0 && index < MONTHS.length ? `${MONTHS[index]} ${year}` : year;
}

function durationLabel(start?: string, end?: string, current = false): string {
  const months = monthSpan(start, current ? nowMonth() : end);
  return months === undefined ? '' : humanMonths(months);
}

function monthSpan(start?: string, end?: string): number | undefined {
  const from = parseMonth(start);
  const to = parseMonth(end);
  if (from === undefined || to === undefined) return undefined;
  return Math.max(0, to - from + 1);
}

function parseMonth(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(?:-(\d{2}))?/u.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * 12 + (match[2] ? Number(match[2]) - 1 : 0);
}

function nowMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function humanMonths(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} г.`);
  if (rest > 0) parts.push(`${rest} мес.`);
  return parts.join(' ') || 'меньше месяца';
}

function totalExperienceLabel(
  experience: readonly ProfileExperienceEntry[],
): string | undefined {
  const known = experience.filter((entry) => entry.duration !== '');
  if (known.length === 0) return undefined;
  return `${known.length} ${placesNoun(known.length)}`;
}

function placesNoun(count: number): string {
  const tail = count % 10;
  const teen = count % 100;
  if (teen >= 11 && teen <= 14) return 'мест';
  if (tail === 1) return 'место';
  if (tail >= 2 && tail <= 4) return 'места';
  return 'мест';
}
