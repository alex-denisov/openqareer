import type { CandidateCompanyOpportunity } from '../../../shared/candidateCompany';
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
