// Port of freehire internal/dict/classify classify.go matchCategory, category only
// (MIT, Copyright (c) 2026 freehire contributors). See NOTICE in the repo root.
//
// Not ported (B646-2): the French, Polish, Croatian/Serbian and Slovenian fallback steps
// that close freehire's chain. A title only they would resolve stays "" here — it is
// neither an IT function nor confirmed non-IT, so it keeps its current handling.
import type { FunctionCode } from '../../../../shared/roleTaxonomy';
import { CATEGORY_NONE } from './aliasEntry';
import { unchefFrench } from './frenchChef';
import { matchHeads, matchPortugueseCategory, matchSpanishCategory } from './languageFallbacks';
import { CATEGORY_TABLE, DANISH_TABLE, DUTCH_TABLE, GERMAN_TABLE } from './tables';
import { matchOrdered } from './wordMatch';

/** classify.go backEndShiftPatterns: "back end" beside a day/night/shift word is a shift. */
const BACK_END_SHIFT_PATTERNS: readonly RegExp[] = [
  /\bback[\s-]?end[\s,()-]*(?:days?|nights?|shift|relief)\b/gu,
  /\b(?:days?|nights?|cww)[\s,()-]*back[\s-]?end\b/gu,
];

/** nontech.go ptGenderSuffix: Brazilian-Portuguese inclusive gender parentheticals. */
const PT_GENDER_SUFFIX = /\((?:a|o|as|os|a\/o)\)/gu;

function cutBackEndShifts(lower: string): string {
  return BACK_END_SHIFT_PATTERNS.reduce((text, pattern) => text.replace(pattern, ' '), lower);
}

function matchFallbacks(lower: string): string {
  for (const table of [GERMAN_TABLE, DUTCH_TABLE, DANISH_TABLE]) {
    const head = matchHeads(lower, table);
    if (head) return head;
  }
  return matchSpanishCategory(lower) || matchPortugueseCategory(lower);
}

/** freehire category of a job title, or "" when nothing resolves (it never guesses). */
export function freehireCategory(title: string): string {
  const lower = unchefFrench(title.toLowerCase().replace(PT_GENDER_SUFFIX, ''));
  const category = matchOrdered(cutBackEndShifts(lower), CATEGORY_TABLE) || matchFallbacks(lower);
  return category === CATEGORY_NONE ? '' : category;
}

/**
 * freehire IT categories → our function codes. ML/AI goes to `ai-ml` and the
 * infrastructure crafts to `it-ops`, as in shared/roleTaxonomy anchors
 * ('machine learning engineer', 'devops', 'network engineer', 'it support').
 */
const IT_FUNCTION: Readonly<Record<string, FunctionCode>> = {
  software_engineering: 'eng',
  frontend: 'eng',
  backend: 'eng',
  fullstack: 'eng',
  mobile: 'eng',
  embedded: 'eng',
  blockchain: 'eng',
  architecture: 'eng',
  developer_relations: 'eng',
  ai_engineering: 'ai-ml',
  ml_ai: 'ai-ml',
  data_engineering: 'data',
  data_science: 'data',
  data_analytics: 'data',
  security: 'security',
  qa: 'qa',
  product: 'product',
  design: 'design',
  devops: 'it-ops',
  sre: 'it-ops',
  it_support: 'it-ops',
  network_engineering: 'it-ops',
};

/** freehire vocab.NonTechCategories: back-office and non-software crafts. */
const NON_TECH_CATEGORIES: ReadonlySet<string> = new Set([
  'marketing',
  'sales',
  'support',
  'recruiting',
  'hr',
  'finance',
  'legal',
  'operations',
  'customer_success',
  'engineering_design',
  'industrial_engineering',
  'occupational_safety',
  'healthcare',
  'skilled_trades',
  'retail',
  'hospitality',
  'logistics',
  'education',
  'personal_services',
  'administration',
  'social_services',
  'science',
  'manufacturing',
  'public_safety',
]);

export function freehireItFunctionOf(category: string): FunctionCode | null {
  return IT_FUNCTION[category] ?? null;
}

export function isNonTechCategory(category: string): boolean {
  return NON_TECH_CATEGORIES.has(category);
}

export function freehireItFunction(title: string): FunctionCode | null {
  return freehireItFunctionOf(freehireCategory(title));
}

/**
 * The title names a non-IT role by freehire's dictionary. Adjacent categories
 * (hardware, creative, project_management, business_analysis, solutions_engineering,
 * technical_writing) and unresolved titles are not confirmed.
 */
export function isConfirmedNonItTitle(title: string): boolean {
  return isNonTechCategory(freehireCategory(title));
}
