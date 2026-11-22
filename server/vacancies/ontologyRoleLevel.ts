import { ontology } from '../../shared/roleOntology';
import { LEVEL_RANK, type SeniorityLevel } from './levelMatcher';

const normalize = (value: string): string => value.trim().toLowerCase();

function isSeniorityLevel(value: string | undefined): value is SeniorityLevel {
  return value !== undefined && value in LEVEL_RANK;
}

/**
 * Уровень, который несёт само название роли по онтологии (B741): «Продакт-
 * менеджер» — IC, даже если кампания кандидата ищет VP. У роли с несколькими
 * уровнями берётся нижний: название без слова уровня означает базовую ступень.
 * Если название совпало с ролями разного уровня — уровня нет.
 */
export function ontologyRoleLevel(title: string): SeniorityLevel | undefined {
  const key = normalize(title);
  if (!key) return undefined;
  const levels = new Set(
    ontology.roles
      .filter((role) =>
        [role.titleEn, role.titleRu, ...role.variants.en, ...role.variants.ru].some(
          (name) => normalize(name) === key,
        ),
      )
      .map((role) => role.levels[0]),
  );
  if (levels.size !== 1) return undefined;
  const [level] = levels;
  return isSeniorityLevel(level) ? level : undefined;
}
