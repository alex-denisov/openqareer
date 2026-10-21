import type {
  CandidateCompanyOpportunity,
  CandidateCompanySource,
} from '../../../shared/candidateCompany';
import type { ConnectionCirclePath, VacancyConnectionCircles } from './vacancyLetterApi';
import { pluralRu } from '../../../shared/pluralRu';

const CONTACT_IMPORT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function readableError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function isContactImportStale(importedAt: string | null, now = Date.now()): boolean {
  const timestamp = importedAt ? Date.parse(importedAt) : Number.NaN;
  return Number.isFinite(timestamp) && now - timestamp > CONTACT_IMPORT_MAX_AGE_MS;
}

export function companyContactSummary(company: CandidateCompanyOpportunity): string {
  return company.contactsCount === null || isContactImportStale(company.contactsImportedAt)
    ? 'Контакты в сети: неизвестно'
    : `${company.contactsCount} в сети`;
}

export function companyVacancySummary(company: CandidateCompanyOpportunity): string {
  return pluralRu(company.vacancyCount, ['вакансия', 'вакансии', 'вакансий']);
}

export function formatObservedDate(value: string | null): string {
  if (!value) return 'дата неизвестна';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'дата неизвестна'
    : new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(parsed);
}

function joinRu(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}

/** «данные с hh.ru и LinkedIn, 06.10.2026»: one mention per platform, dated by the latest one. */
export function companySourceSummary(sources: readonly CandidateCompanySource[]): string | null {
  const names = [...new Set(sources.map((source) => source.name.trim()).filter(Boolean))];
  if (names.length === 0) return null;
  const latest = sources
    .map((source) => Date.parse(source.observedAt))
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const date = Number.isFinite(latest)
    ? `, ${formatObservedDate(new Date(latest).toISOString())}`
    : '';
  return `данные с ${joinRu(names)}${date}`;
}

export interface CompanyPerson {
  readonly id: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly circle: 1 | 2;
  readonly relation: string;
  readonly source: string;
  readonly action: 'Написать знакомому' | 'Попросить представить';
  readonly vacancyId: string;
}

export interface CompanyPeople {
  readonly people: readonly CompanyPerson[];
  /** The vacancy a single «Холодный отклик» opens; null when no vacancy has a cold path. */
  readonly coldVacancyId: string | null;
}

function personSource(path: ConnectionCirclePath, importedAt: string | null): string {
  const date = importedAt ? `, ${formatObservedDate(importedAt)}` : '';
  if (path.circle === 2)
    return `общий контакт${importedAt ? `, импорт ${formatObservedDate(importedAt)}` : ''}`;
  if (path.source === 'linkedin_import') return `импорт контактов LinkedIn${date}`;
  if (path.source === 'work_history') return 'общее место работы в вашем резюме';
  return 'добавлено вами';
}

function personRelation(path: ConnectionCirclePath): string {
  if (path.circle === 2) {
    const via = path.path[1]?.fullName?.trim();
    return via ? `Знаком с вашим контактом ${via}` : 'Знаком с вашим контактом';
  }
  return path.evidence[0]?.trim() || 'В вашей сети';
}

function toCompanyPerson(
  path: ConnectionCirclePath,
  data: VacancyConnectionCircles,
): CompanyPerson | null {
  if (path.circle === 3) return null;
  return {
    id: path.recipient.id || path.id,
    fullName: path.recipient.fullName,
    roleTitle: path.recipient.roleTitle,
    circle: path.circle,
    relation: personRelation(path),
    source: personSource(path, data.linkedinImport.importedAt),
    action: path.circle === 1 ? 'Написать знакомому' : 'Попросить представить',
    vacancyId: data.vacancyId,
  };
}

/** B439: connection paths come per vacancy; the candidate needs one card per person. */
export function groupCompanyPeople(responses: readonly VacancyConnectionCircles[]): CompanyPeople {
  const byPerson = new Map<string, CompanyPerson>();
  let coldVacancyId: string | null = null;
  for (const data of responses) {
    for (const path of data.circles.flatMap((circle) => circle.paths)) {
      if (path.circle === 3) {
        coldVacancyId ??= data.vacancyId;
        continue;
      }
      const next = toCompanyPerson(path, data);
      const current = next ? byPerson.get(next.id) : undefined;
      if (next && (!current || next.circle < current.circle)) byPerson.set(next.id, next);
    }
  }
  const people = [...byPerson.values()].sort((a, b) => a.circle - b.circle);
  return { people, coldVacancyId };
}
