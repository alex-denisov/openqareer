import { pluralRu } from '../../../../shared/pluralRu';
import { displayYear } from '../../resume/experienceDate';
import type {
  ResumeDraft,
  ResumeExperienceInput,
  ResumeLanguageInput,
  ResumeStudioView,
} from '../../resume/resumeTypes';
import { buildNodePath } from '../routes';
import { languageNameRu } from '../../../../shared/languageNames';

/** Текст факта по его id: результаты места работы хранятся ссылками на факты. */
export function statementsOf(view: ResumeStudioView): ReadonlyMap<string, string> {
  return new Map(
    (view.projection?.evidenceSnapshot ?? []).map((item) => [item.memoryId, item.statement]),
  );
}

function yearsRange(start: string | undefined, end: string | undefined, current: boolean): string {
  const from = displayYear(start);
  const to = current ? 'сейчас' : displayYear(end);
  if (from && to && from !== to) return `${from} — ${to}`;
  return from || to;
}

/** «2021 — сейчас», «2018 — 2021»; один год — без тире. */
export function periodLabel(entry: ResumeExperienceInput): string {
  return yearsRange(entry.startDate, entry.endDate, entry.current);
}

export function teamLabel(teamSize: number | undefined): string | null {
  return teamSize && teamSize > 0 ? pluralRu(teamSize, ['человек', 'человека', 'человек']) : null;
}

export interface JobRow {
  readonly id: string;
  readonly title: string;
  readonly employer: string;
  readonly period: string;
  readonly team: string | null;
  readonly results: readonly string[];
  readonly stack: string;
  readonly editPath: string;
}

export function jobRow(
  entry: ResumeExperienceInput,
  statements: ReadonlyMap<string, string>,
): JobRow {
  return {
    id: entry.id,
    title: entry.title?.trim() || 'Должность не указана',
    employer: entry.employer?.trim() ?? '',
    period: periodLabel(entry),
    team: teamLabel(entry.teamSize),
    results: entry.bulletMemoryIds.flatMap((id) => {
      const text = statements.get(id)?.trim();
      return text ? [text] : [];
    }),
    stack: (entry.skills ?? []).join(', '),
    editPath: buildNodePath('p07', { entryId: entry.id }),
  };
}

/** «12 лет · 5 мест»: стаж от первого года начала до последнего года работы. */
export function experienceSummary(experience: readonly ResumeExperienceInput[], now: Date): string {
  if (experience.length === 0) return '';
  const places = pluralRu(experience.length, ['место', 'места', 'мест']);
  const starts = experience.map((entry) => Number(displayYear(entry.startDate))).filter(Boolean);
  const ends = experience
    .map((entry) => (entry.current ? now.getFullYear() : Number(displayYear(entry.endDate))))
    .filter(Boolean);
  const years = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;
  return years > 0 ? `${pluralRu(years, ['год', 'года', 'лет'])} · ${places}` : places;
}

/** Строка под именем: «Руководитель группы разработки · Москва». */
export function headLine(draft: ResumeDraft): string {
  return [draft.candidate.headline, draft.candidate.contact?.location]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ');
}

export interface RecordRow {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
}

function record(
  id: string,
  title: string | undefined,
  parts: readonly (string | undefined)[],
): RecordRow[] {
  const name = title?.trim();
  if (!name) return [];
  const sub = parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' · ');
  return [{ id, title: name, sub }];
}

export interface RecordRows {
  readonly education: readonly RecordRow[];
  readonly courses: readonly RecordRow[];
  readonly projects: readonly RecordRow[];
  readonly recommendations: readonly RecordRow[];
}

/** Разделы-списки профиля: заголовок записи и одна строка подписи. */
export function recordRows(draft: ResumeDraft): RecordRows {
  return {
    education: draft.education.flatMap((item) =>
      record(item.id, item.institution, [
        item.qualification,
        yearsRange(item.startDate, item.endDate, false),
      ]),
    ),
    courses: [
      ...(draft.courses ?? []).flatMap((item) =>
        record(item.id, item.name, [
          item.provider ?? item.institution,
          item.year ? String(item.year) : undefined,
        ]),
      ),
      ...(draft.certifications ?? []).flatMap((item) =>
        record(item.id, item.name, [item.issuer, displayYear(item.issuedAt)]),
      ),
    ],
    projects: (draft.projects ?? []).flatMap((item) =>
      record(item.id, item.name, [
        item.employer,
        yearsRange(item.startDate, item.endDate, item.current ?? false),
      ]),
    ),
    recommendations: (draft.recommendations ?? []).flatMap((item) => {
      const who = [item.recommender ?? item.author, item.role ?? item.position, item.organization]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(', ');
      return record(item.id, who, [item.text ? `«${item.text.trim()}»` : undefined]);
    }),
  };
}

const CEFR_STEPS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export interface LanguageRow {
  readonly id: string;
  readonly name: string;
  readonly level: string | null;
  /** Сколько из шести делений шкалы закрашено. */
  readonly filled: number;
}

export function languageRow(language: ResumeLanguageInput): LanguageRow | null {
  const name = language.name?.trim() ? languageNameRu(language.name) : '';
  if (!name) return null;
  const step = language.cefr ? CEFR_STEPS.indexOf(language.cefr) + 1 : 0;
  return { id: language.id, name, level: language.cefr ?? null, filled: step };
}

export const LANGUAGE_SCALE_STEPS = CEFR_STEPS.length;

/** Длинный список: первые записи на виду, остальные — под «Ещё N». */
export function splitVisible<T>(items: readonly T[], visible: number): { shown: T[]; rest: T[] } {
  return { shown: items.slice(0, visible), rest: items.slice(visible) };
}
