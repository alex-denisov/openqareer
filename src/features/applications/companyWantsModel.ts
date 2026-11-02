import type {
  CandidateCompanyOpportunity,
  CandidateCompanyWantSelectionItem,
  CandidateCompanyWantStage,
} from '../../../shared/candidateCompany';
import { triggerFileDownload } from '../resume/resumeExport';
import { COMPANY_WANT_BULK_LIMIT } from './companyWantsApi';

export const WANT_STAGE_LABELS: Readonly<Record<CandidateCompanyWantStage, string>> = {
  want: 'Хочу',
  path: 'Ищу путь',
  waiting: 'Жду вакансию',
};

export function toSelectionItem(
  company: CandidateCompanyOpportunity,
): CandidateCompanyWantSelectionItem {
  return {
    key: company.key,
    name: company.name,
    industry: company.industry,
    stage: company.wantStage ?? 'want',
    vacancyCount: company.vacancyCount,
    contactsCount: company.contactsCount,
    nextStep: company.nextStep?.text ?? null,
  };
}

/** The saved next step wins; otherwise the stage suggests one honestly. */
export function nextStepText(company: CandidateCompanyOpportunity): string {
  if (company.nextStep?.text) return company.nextStep.text;
  if (company.recruiterSearchStatus === 'queued' || company.recruiterSearchStatus === 'running') {
    return 'Ищем путь к рекрутеру';
  }
  if (company.hasRecruiter) return 'Написать рекрутеру';
  if (company.wantStage === 'waiting') return 'Оповестим о вакансии';
  return 'Найти путь к рекрутеру';
}

/** Splits pasted text or a .txt/.csv file into unique company names (first CSV column). */
export function parseCompanyNames(text: string): string[] {
  const names = text
    .split(/\r?\n/u)
    .map((line) => (line.split(/[;,\t]/u)[0] ?? '').replace(/^"|"$/gu, '').trim())
    .filter((name) => name.length > 0 && name.length <= 300);
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exceedsBulkLimit(count: number): boolean {
  return count > COMPANY_WANT_BULK_LIMIT;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return /[";\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

export function companyWantsCsv(items: readonly CandidateCompanyWantSelectionItem[]): string {
  const header = ['Компания', 'Отрасль', 'Статус', 'Вакансий', 'Контактов', 'Следующий шаг'];
  const rows = items.map((item) =>
    [
      item.name,
      item.industry,
      WANT_STAGE_LABELS[item.stage],
      item.vacancyCount,
      item.contactsCount,
      item.nextStep,
    ]
      .map(csvCell)
      .join(';'),
  );
  return `\uFEFF${[header.join(';'), ...rows].join('\n')}\n`;
}

export function downloadCompanyWantsCsv(
  items: readonly CandidateCompanyWantSelectionItem[],
): Promise<string | null> {
  return triggerFileDownload(
    'hochu-v-kompaniyu.csv',
    companyWantsCsv(items),
    'text/csv;charset=utf-8',
  );
}
