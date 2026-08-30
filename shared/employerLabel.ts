/**
 * A source that never named the employer leaves the field empty — the reader
 * gets that said out loud instead of a blank next to a middle dot (B164).
 */
export const EMPLOYER_NOT_NAMED = 'Работодатель не указан';

export function employerLabel(company: string | undefined): string {
  const value = company?.trim() ?? '';
  return value.length > 0 ? value : EMPLOYER_NOT_NAMED;
}
