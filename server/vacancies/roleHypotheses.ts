import {
  poolRoleHypotheses,
  type PoolRoleHypothesis,
} from '../../shared/poolRoleHypotheses';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Гипотезы роли считаются на сервере (B180, срез 1б).
 *
 * Замер на проде по `b9f5f41`: браузер прочитал 320 записей подбора, и
 * требования были ровно у нуля из них — `matchedVacancyPage.ts` намеренно
 * вырезает `skills` ради байтового бюджета маршрута (INC-029). Обе экспертные
 * записки строят гипотезу роли на пересечении требований, поэтому считать её в
 * браузере было не из чего. Полный пул живёт здесь; наружу уходит готовый
 * ответ — до трёх ролей в несколько сотен байт вместо мегабайта пула.
 */
export function buildRoleHypotheses(input: {
  readonly matched: readonly MatchedVacancyItem[];
  readonly candidateRole: string;
  readonly candidateSkills: readonly string[];
}): PoolRoleHypothesis[] {
  return poolRoleHypotheses({
    pool: input.matched.map((item) => ({
      canonicalTitle: item.cluster.canonicalTitle,
      firstObservedAt: item.cluster.firstObservedAt,
      skills: item.cluster.skills,
      sources: item.cluster.sources,
    })),
    candidateRole: input.candidateRole,
    candidateSkills: input.candidateSkills,
  });
}
