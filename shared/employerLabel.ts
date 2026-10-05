/**
 * A source that never named the employer leaves the field empty — the reader
 * gets that said out loud instead of a blank next to a middle dot (B164).
 */
export const EMPLOYER_NOT_NAMED = 'Работодатель не указан';

export function employerLabel(company: string | undefined): string {
  const value = company?.trim() ?? '';
  return value.length > 0 ? value : EMPLOYER_NOT_NAMED;
}

const GENERIC_MARKERS = /\b(?:top-tier|institution|platform)\b/iu;

const GENERIC_WORDS = new Set([
  'enterprise',
  'public',
  'cloud',
  'corporate',
  'university',
  'financial',
  'institution',
  'platform',
  'iaas',
  'paas',
  'saas',
  'services',
  'solutions',
  'technologies',
  'technology',
  'global',
  'international',
  'leading',
  'top',
  'tier',
  'of',
  'a',
  'the',
  'in',
  'and',
  'for',
  'group',
  'system',
  'systems',
  'provider',
  'company',
  'consulting',
  'management',
  'development',
]);

/**
 * B375: нормализация работодателей.
 * Строка длиннее 60 символов, с обобщающими словами («Top-Tier», «Institution»,
 * «Platform» без имени собственного) или без заглавной буквы в названии —
 * не название компании.
 */
export function isNamedEmployer(raw?: string): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (!/\p{Lu}/u.test(trimmed)) return false;

  if (GENERIC_MARKERS.test(trimmed)) {
    const tokens = trimmed
      .toLowerCase()
      .replace(/[()[\]/\\,.:;!?"'-]/gu, ' ')
      .split(/\s+/u)
      .filter(Boolean);
    const hasProperNoun = tokens.some((w) => !GENERIC_WORDS.has(w));
    if (!hasProperNoun) {
      return false;
    }
  }

  return true;
}

export function partitionEmployers(employers: readonly (string | undefined)[]): {
  readonly validEmployers: readonly string[];
  readonly unidentifiedEmployers: readonly string[];
} {
  const valid = new Set<string>();
  const unidentified = new Set<string>();
  for (const emp of employers) {
    if (!emp) continue;
    const trimmed = emp.trim();
    if (!trimmed) continue;
    if (isNamedEmployer(trimmed)) {
      valid.add(trimmed);
    } else {
      unidentified.add(trimmed);
    }
  }
  return {
    validEmployers: [...valid],
    unidentifiedEmployers: [...unidentified],
  };
}

