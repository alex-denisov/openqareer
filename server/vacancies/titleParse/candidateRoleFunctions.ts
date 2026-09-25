import type { FunctionCode } from '../../../shared/roleTaxonomy';
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
