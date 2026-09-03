import type { RoleObservation } from '../../shared/poolRoleHypotheses';
import {
  proposeRoles,
  type NamedRole,
  type ProposedRole,
} from '../../shared/roleProposals';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Роли считаются на сервере (B180, срез 1б).
 *
 * Замер на проде по `b9f5f41`: браузер прочитал 320 записей подбора, и
 * требования были ровно у нуля из них — `matchedVacancyPage.ts` намеренно
 * вырезает `skills` ради байтового бюджета маршрута (INC-029). Полный пул
 * живёт здесь; наружу уходит готовый ответ в несколько сотен байт вместо
 * мегабайта пула.
 */

/** Пул в том виде, в каком его читает расчёт ролей. */
function observations(
  matched: readonly MatchedVacancyItem[],
): RoleObservation[] {
  return matched.map((item) => ({
    canonicalTitle: item.cluster.canonicalTitle,
    firstObservedAt: item.cluster.firstObservedAt,
    skills: item.cluster.skills,
    sources: item.cluster.sources,
  }));
}

/**
 * Роль называет модель, пул подтверждает (B180, срез 1в).
 *
 * Прежний расчёт умел только группировать пул, и на 529 живых вакансиях не
 * набирал ни одной группы из восьми наблюдений — панель отказывала всегда.
 * Теперь имя приходит от модели, читающей факты кандидата, а пул приписывает
 * к нему доказательство или честное «пока не найдено».
 */
export function buildRoleProposals(input: {
  readonly matched: readonly MatchedVacancyItem[];
  readonly named: readonly NamedRole[];
  readonly candidateSkills: readonly string[];
}): ProposedRole[] {
  return proposeRoles({
    named: input.named,
    pool: observations(input.matched),
    candidateSkills: input.candidateSkills,
  });
}
