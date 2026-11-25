import { CITY_NAMES } from '../../../../shared/locationGazetteer';
import type { CandidateMemory } from '../../coach/coachApi';
import { experienceConfirmation } from '../../resume/ExperienceConfirmation';
import { monthInputValue } from '../../resume/experienceDate';
import type { ResumeDraft, ResumeExperienceInput, WorkplaceType } from '../../resume/resumeTypes';
import { buildNodePath } from '../routes';
import { periodLabel, teamLabel } from './profileModel';

export interface ExperienceForm {
  readonly employer: string;
  readonly title: string;
  /** Месяц начала `ГГГГ-ММ`; пусто — не указан. */
  readonly start: string;
  readonly end: string;
  readonly current: boolean;
  readonly city: string;
  readonly workplaceType: WorkplaceType | null;
  readonly teamSize: string;
  readonly skills: readonly string[];
  /** «Что делали»; `null` — запись есть, но её текст не прочитан: поле не показываем. */
  readonly description: string | null;
  readonly results: readonly ResultRow[];
  /** Записи, убранные из «Результатов»: место работы на них больше не ссылается. */
  readonly removed: readonly string[];
}

/** Строка «Результаты»: запись профиля или новая, ещё не сохранённая. */
export interface ResultRow {
  readonly key: string;
  readonly memoryId: string | null;
  readonly text: string;
}

export const RESULT_MAX_LENGTH = 1_000;

export type ExperienceFormErrors = Partial<
  Record<'employer' | 'title' | 'period' | 'city' | 'teamSize', string>
>;

export const TEXT_MAX_LENGTH = 200;
const MAX_TEAM_SIZE = 100_000;
const MAX_SUGGESTIONS = 8;
const CITIES: readonly string[] = [...new Set(Object.values(CITY_NAMES))].sort((a, b) =>
  a.localeCompare(b, 'ru'),
);
const CITY_KEYS = new Set(CITIES.map((city) => city.toLocaleLowerCase('ru')));

export function formOf(
  entry: ResumeExperienceInput,
  statements: ReadonlyMap<string, string> = new Map(),
): ExperienceForm {
  const { descriptionMemoryId } = entry;
  return {
    employer: entry.employer ?? '',
    title: entry.title ?? '',
    start: monthInputValue(entry.startDate),
    end: monthInputValue(entry.endDate),
    current: entry.current,
    city: entry.location ?? '',
    workplaceType: entry.workplaceType ?? null,
    teamSize: entry.teamSize ? String(entry.teamSize) : '',
    skills: entry.skills ?? [],
    description: descriptionMemoryId ? (statements.get(descriptionMemoryId) ?? null) : '',
    results: entry.bulletMemoryIds.flatMap((id) => {
      const text = statements.get(id);
      return text === undefined ? [] : [{ key: id, memoryId: id, text }];
    }),
    removed: [],
  };
}

const MONTH_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** «2018-03» → «Март 2018». */
export function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/u.test(month)) return '';
  const text = MONTH_FORMAT.format(new Date(`${month}-01T00:00:00Z`)).replace(/\s*г\.$/u, '');
  return text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);
}

/** Города справочника по началу названия. */
export function citySuggestions(query: string): string[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  if (!needle) return [];
  return CITIES.filter((city) => city.toLocaleLowerCase('ru').startsWith(needle)).slice(
    0,
    MAX_SUGGESTIONS,
  );
}

function cityError(form: ExperienceForm, original: ResumeExperienceInput): string | undefined {
  const city = form.city.trim();
  // Прежнее значение не трогаем: его могли принести импортом в другом виде.
  if (!city || city === (original.location ?? '').trim()) return undefined;
  return CITY_KEYS.has(city.toLocaleLowerCase('ru'))
    ? undefined
    : 'Нет в справочнике — выберите из списка';
}

function periodError(form: ExperienceForm, original: ResumeExperienceInput): string | undefined {
  // Начало, записанное словами («весна 2020»), остаётся как есть: требовать месяц незачем.
  const worded = Boolean(original.startDate?.trim()) && !monthInputValue(original.startDate);
  if (!form.start && !worded) return 'Укажите начало';
  return !form.current && form.end && form.end < form.start ? 'Окончание раньше начала' : undefined;
}

function teamError(form: ExperienceForm): string | undefined {
  const text = form.teamSize.trim();
  if (!text) return undefined;
  return /^\d+$/u.test(text) && Number(text) <= MAX_TEAM_SIZE ? undefined : 'Только число';
}

export function validateForm(
  form: ExperienceForm,
  original: ResumeExperienceInput,
): ExperienceFormErrors {
  const errors: ExperienceFormErrors = {
    employer: form.employer.trim() ? undefined : 'Укажите компанию',
    title: form.title.trim() ? undefined : 'Укажите должность',
    period: periodError(form, original),
    city: cityError(form, original),
    teamSize: teamError(form),
  };
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
}

/** Дата из формы; если кандидат её не менял, остаётся прежнее написание («2020», «весна 2020»). */
function keptDate(original: string | undefined, month: string): string | undefined {
  return month === monthInputValue(original) ? original : month || undefined;
}

function patched(entry: ResumeExperienceInput, form: ExperienceForm): ResumeExperienceInput {
  const {
    employer: _employer,
    title: _title,
    startDate: _start,
    endDate: _end,
    location: _location,
    workplaceType: _type,
    teamSize: _team,
    skills: _skills,
    employerRealName,
    employerNameMemoryId,
    employerMaskKept,
    ...rest
  } = entry;
  const employer = form.employer.trim();
  // Сведения о настоящем названии относятся к прежнему имени компании.
  const sameEmployer = employer === (entry.employer ?? '').trim();
  const masked = { employerRealName, employerNameMemoryId, employerMaskKept };
  const start = keptDate(entry.startDate, form.start);
  const end = form.current ? undefined : keptDate(entry.endDate, form.end);
  const city = form.city.trim();
  const team = form.teamSize.trim();
  const next = {
    ...rest,
    ...(sameEmployer ? masked : {}),
    title: form.title.trim(),
    employer,
    startDate: start,
    endDate: end,
    current: form.current,
    location: city || undefined,
    workplaceType: form.workplaceType ?? undefined,
    teamSize: team ? Number(team) : undefined,
    skills: form.skills.length > 0 ? [...form.skills] : undefined,
    bulletMemoryIds: rest.bulletMemoryIds.filter((id) => !form.removed.includes(id)),
  };
  return Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined),
  ) as unknown as ResumeExperienceInput;
}

/** Новый черновик, где запись возвращена к прежнему виду: «Отменить» после сохранения. */
export function restoreEntry(draft: ResumeDraft, original: ResumeExperienceInput): ResumeDraft {
  return {
    ...draft,
    experience: draft.experience.map((entry) => (entry.id === original.id ? original : entry)),
  };
}

/** Новый черновик с правкой одной записи; остальные записи те же объекты. */
export function applyForm(draft: ResumeDraft, entryId: string, form: ExperienceForm): ResumeDraft {
  return {
    ...draft,
    experience: draft.experience.map((entry) =>
      entry.id === entryId ? patched(entry, form) : entry,
    ),
  };
}

/** Новый черновик, где «Что делали» места — эта запись; без записи черновик прежний. */
export function withDescription(
  draft: ResumeDraft,
  entryId: string,
  descriptionMemoryId: string | null,
): ResumeDraft {
  if (!descriptionMemoryId) return draft;
  return {
    ...draft,
    experience: draft.experience.map((entry) =>
      entry.id === entryId ? { ...entry, descriptionMemoryId } : entry,
    ),
  };
}

export interface ReviewRow {
  readonly id: string;
  readonly title: string;
  readonly employer: string;
  readonly period: string;
  readonly team: string | null;
  /** Кандидат уже подтвердил запись. */
  readonly confirmed: boolean;
  readonly editPath: string;
}

/** «Так мы прочитали ваш профиль»: места работы с отметкой подтверждения. */
export function reviewRows(draft: ResumeDraft, memory: readonly CandidateMemory[]): ReviewRow[] {
  return draft.experience.map((entry) => ({
    id: entry.id,
    title: entry.title?.trim() || 'Должность не указана',
    employer: entry.employer?.trim() ?? '',
    period: periodLabel(entry),
    team: teamLabel(entry.teamSize),
    confirmed: experienceConfirmation(entry, memory).confirmed,
    editPath: buildNodePath('p07', { entryId: entry.id }),
  }));
}
