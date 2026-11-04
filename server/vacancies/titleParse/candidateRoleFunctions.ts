import type { FunctionCode } from '../../../shared/roleTaxonomy';
import { LEVEL_RANK, type SeniorityLevel } from '../levelMatcher';
import { rulesParse } from './rulesParse';

/**
 * Роли кампании → коды функций для смыслового подбора (B267 S3, план §5 п.1).
 * Роль, которую правила не узнали (пусто) или свели к общему `other`, в поиск
 * не идёт — общий якорь дал бы такую же широкую и случайную выдачу, какую
 * смысловой подбор должен убрать.
 */
export function candidateRoleFunctionCodes(targetRoles: readonly string[]): FunctionCode[] {
  const codes = new Set<FunctionCode>();
  for (const role of targetRoles) {
    if (!role.trim()) continue;
    for (const code of rulesParse(role).functions) {
      if (code !== 'other') codes.add(code);
    }
  }
  return [...codes];
}

/**
 * Нижняя граница уровня подбора: ступень ниже целевой, но не выше самой
 * младшей роли кампании. «Head of AI» в кампании C-level — роль уровня Head,
 * и окно ±1 от C-level её отсекало (аудит 01.11). `null` — уровень неизвестен.
 */
export function campaignLevelFloor(
  targetRoles: readonly string[],
  targetLevel: SeniorityLevel | undefined,
): number | null {
  if (!targetLevel) return null;
  const roleRanks = targetRoles
    .map((role) => rulesParse(role).levelRank)
    .filter((rank): rank is number => rank !== null);
  return Math.min(LEVEL_RANK[targetLevel] - 1, ...roleRanks);
}

/**
 * Тот же порог, но своя ступень у каждой функции. «AI Consultant» без указания
 * уровня имеет ранг 0, и общий порог открывал младшие вакансии всем функциям
 * кандидата: у VP с девятью ролями 26 тыс. строк вместо 2 тыс., и окно чтения
 * забивала удалёнка младших уровней (04.11, из 184 вакансий роли оставалось 33).
 */
export function campaignFunctionLevelFloors(
  targetRoles: readonly string[],
  targetLevel: SeniorityLevel | undefined,
): Partial<Record<FunctionCode, number>> {
  if (!targetLevel) return {};
  const floors: Partial<Record<FunctionCode, number>> = {};
  for (const role of targetRoles) {
    const { functions, levelRank } = rulesParse(role);
    for (const code of functions) {
      floors[code] = Math.min(
        floors[code] ?? LEVEL_RANK[targetLevel] - 1,
        levelRank ?? LEVEL_RANK[targetLevel] - 1,
      );
    }
  }
  return floors;
}
