import { requirementLabels, topRoleKeywords, type RoleKeywords } from '../domain/atsRoleKeywords';
import { sameCareerRole } from '../vacancies/careerRoleKey';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { RouteDeps } from './deps';

/** Чтений кэша на одну роль: кэш читается по индексу, пул целиком не трогаем. */
export const MAX_ROLE_LOOKUPS = 300;
/** Через столько чтений отдаём цикл событий другим запросам. */
const YIELD_EVERY = 25;

const EMPTY: RoleKeywords = { keywords: [], vacanciesCounted: 0 };

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Ключевые слова роли из извлечённых требований её вакансий (кэш
 * `vacancy_requirements_cache`). Вакансии роли выбираются тем же признаком, что
 * и счёт роли в `confirmChosenTitle`. Подбор уже в памяти, SQLite читается
 * по одной вакансии с отдачей цикла событий.
 */
export async function readRoleKeywords(
  deps: RouteDeps,
  matched: readonly MatchedVacancyItem[],
  roleTitle: string,
): Promise<RoleKeywords> {
  const requirements = deps.vacancyMechanics?.requirements;
  if (!requirements) return EMPTY;
  const ids = matched
    .filter(
      (item) =>
        item.explanation?.roleMatch !== 'none' &&
        sameCareerRole(item.cluster.canonicalTitle, roleTitle),
    )
    .slice(0, MAX_ROLE_LOOKUPS)
    .map((item) => item.cluster.id);
  const perVacancy: string[][] = [];
  for (const [index, id] of ids.entries()) {
    if (index > 0 && index % YIELD_EVERY === 0) await yieldToLoop();
    const cached = requirements.getLatestOrLegacy(id);
    if (cached) perVacancy.push(requirementLabels(cached));
  }
  return topRoleKeywords(perVacancy);
}

/** Требования одной сохранённой вакансии из кэша; `null` — их ещё не извлекли. */
export function readVacancyKeywords(deps: RouteDeps, vacancyId: string): string[] | null {
  const cached = deps.vacancyMechanics?.requirements.getLatestOrLegacy(vacancyId);
  return cached ? requirementLabels(cached) : null;
}
