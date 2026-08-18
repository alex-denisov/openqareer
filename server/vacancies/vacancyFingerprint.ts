import { createHash } from 'node:crypto';

export function normalizeTextForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calculateVacancyFingerprint(input: {
  title: string;
  company: string;
  description: string;
  location?: string;
  salaryFrom?: number;
  salaryTo?: number;
  currency?: string;
}): string {
  const normTitle = normalizeTextForComparison(input.title);
  const normCompany = normalizeTextForComparison(input.company);
  const normDesc = normalizeTextForComparison(input.description).slice(0, 1000);
  const normLoc = normalizeTextForComparison(input.location ?? '');
  const salaryPart = `${input.salaryFrom ?? ''}-${input.salaryTo ?? ''}-${input.currency ?? ''}`;

  const payload = `${normTitle}|${normCompany}|${normLoc}|${salaryPart}|${normDesc}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
