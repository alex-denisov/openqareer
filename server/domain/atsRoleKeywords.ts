import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import { labelVacancyRequirement } from './vacancyRequirementLabel';
import type { VacancyRequirementsResult } from './vacancyRequirements';

/** Зрелые ATS-проверки сверяют резюме с 10–15 ключевыми словами. */
export const MAX_ROLE_KEYWORDS = 15;
/** Слово, встреченное у одной вакансии, — особенность работодателя, а не роли. */
export const MIN_KEYWORD_VACANCIES = 2;

export interface RoleKeywords {
  readonly keywords: readonly string[];
  /** Вакансий роли, у которых есть извлечённые требования. */
  readonly vacanciesCounted: number;
}

/** Короткие названия навыков из извлечённых требований одной вакансии. */
export function requirementLabels(result: VacancyRequirementsResult): string[] {
  const labels = result.requirements
    .map(labelVacancyRequirement)
    .flatMap((requirement) =>
      requirement.skill && requirement.label ? [requirement.label.trim()] : [],
    );
  return [...new Set(labels)];
}

function keyOf(canonical: string): string {
  return canonical.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/**
 * Частые требования роли: по вакансии каждое слово считается один раз, РУ и EN
 * синонимы сводятся к канону словаря. Остальное — нормализованная нижняя форма.
 */
export function topRoleKeywords(perVacancy: readonly (readonly string[])[]): RoleKeywords {
  const counts = new Map<string, { display: string; count: number }>();
  let vacanciesCounted = 0;
  for (const labels of perVacancy) {
    const seen = new Set<string>();
    for (const label of labels) {
      const display = canonicalizeSkill(label);
      const key = keyOf(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { display, count: 1 });
    }
    if (seen.size > 0) vacanciesCounted += 1;
  }
  const keywords = [...counts.values()]
    .filter((entry) => entry.count >= MIN_KEYWORD_VACANCIES)
    .sort((left, right) => right.count - left.count || left.display.localeCompare(right.display))
    .slice(0, MAX_ROLE_KEYWORDS)
    .map((entry) => entry.display);
  return { keywords, vacanciesCounted };
}
