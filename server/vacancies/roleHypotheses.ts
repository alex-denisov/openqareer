import type { RoleObservation } from '../../shared/poolRoleHypotheses';
import type { WorkPreferenceResult } from '../../shared/workPreferences';
import { careerRoleKey, sameCareerRole } from './careerRoleKey';
import {
  confirmRoleObservations,
  proposeRoles,
  type NamedRole,
  type ProposedRole,
  type RoleConfirmation,
} from '../../shared/roleProposals';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { getCurrencyRates } from '../currency/cbrRates';
import { monthlyRubSalary } from './roleWageSalary';

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
function observations(matched: readonly MatchedVacancyItem[]): RoleObservation[] {
  const rates = getCurrencyRates();
  return matched.map((item) => ({
    canonicalTitle: item.cluster.canonicalTitle,
    firstObservedAt: item.cluster.firstObservedAt,
    skills: item.cluster.skills,
    sources: item.cluster.sources,
    salary: item.cluster.salary ? monthlyRubSalary(item.cluster.salary, rates) : undefined,
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
  /** Ответы на задания меняют порядок ролей, но не состав (B180, срез 3). */
  readonly preferences?: WorkPreferenceResult;
}): ProposedRole[] {
  return proposeRoles({
    named: input.named,
    pool: observations(input.matched),
    candidateSkills: input.candidateSkills,
    roleKey: careerRoleKey,
    ...(input.preferences ? { preferences: input.preferences } : {}),
  });
}

/**
 * Что пул говорит о названии, которое кандидат назвал сам (B180, срез 2).
 *
 * Считается по тому же пулу и тем же способом, что и подтверждение
 * предложенной роли: своя роль не получает ни поблажки, ни наказания.
 */
export function confirmChosenTitle(input: {
  readonly matched: readonly MatchedVacancyItem[];
  readonly title: string;
  readonly candidateSkills: readonly string[];
}): RoleConfirmation {
  // Тот же признак, что у фильтра «Роли» и счёта кампании: вакансия подобрана
  // по функции и уровню ролей кандидата и относится к этой роли (26.10).
  const ofRole = input.matched.filter(
    (item) =>
      item.explanation?.roleMatch !== 'none' &&
      sameCareerRole(item.cluster.canonicalTitle, input.title),
  );
  return confirmRoleObservations({
    title: input.title,
    observations: observations(ofRole),
    candidateSkills: input.candidateSkills,
  });
}
