import type { SkipReasonId } from '../../shared/skipReasons';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Решение кандидата по вакансии до отклика: «Сохранить» (этап `saved` трекера
 * B251) или «Пропустить с причиной» (`vacancy_skips`). Хранение — модель B251,
 * здесь только чистое применение к готовому подбору, после кэша.
 */
export type VacancyDecision =
  | { readonly clusterId: string; readonly status: 'saved' }
  | { readonly clusterId: string; readonly status: 'skipped'; readonly skipReasonId: SkipReasonId };

/**
 * «Пропустить» скрывает эту вакансию при любой причине; понижение похожих —
 * отдельно, в фоне (B247). «Сохранить» ничего не переставляет, только помечает.
 */
export function applyVacancyDecisions(
  items: readonly MatchedVacancyItem[],
  decisions: readonly VacancyDecision[],
): MatchedVacancyItem[] {
  const byCluster = new Map(decisions.map((decision) => [decision.clusterId, decision]));
  return items.flatMap((item) => {
    const decision = byCluster.get(item.cluster.id);
    if (!decision) return [item];
    if (decision.status === 'skipped') return [];
    return [
      {
        ...item,
        explanation: { ...item.explanation, candidateDecision: { status: 'saved' as const } },
      },
    ];
  });
}
