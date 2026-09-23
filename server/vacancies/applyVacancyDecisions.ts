import type { VacancyDecision } from '../../shared/vacancyDecision';
import { EXCLUDING_SKIP_REASONS } from '../../shared/vacancySkipReasons';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Решения кандидата действуют на подбор (B248): «Пропустить» с причиной
 * жёсткого несоответствия (не та роль, гео, компания, дубликат) выкидывает
 * запись из выдачи целиком, а мягкая причина (уровень, вилка, требование не
 * подтверждено, выглядит устаревшей) только опускает запись в конец списка —
 * кандидат мог ошибиться в собственной оценке, и запись остаётся на виду.
 * «Сохранить» ничего не переставляет, только помечает карточку.
 */
export function applyVacancyDecisions(
  items: readonly MatchedVacancyItem[],
  decisions: readonly VacancyDecision[],
): MatchedVacancyItem[] {
  const byCluster = new Map(decisions.map((decision) => [decision.clusterId, decision]));

  const kept: MatchedVacancyItem[] = [];
  const downgraded: MatchedVacancyItem[] = [];

  for (const item of items) {
    const decision = byCluster.get(item.cluster.id);
    if (!decision) {
      kept.push(item);
      continue;
    }

    if (decision.status === 'skipped' && decision.skipReasonId) {
      if (EXCLUDING_SKIP_REASONS.has(decision.skipReasonId)) {
        continue;
      }
      downgraded.push(withDecision(item, decision));
      continue;
    }

    kept.push(withDecision(item, decision));
  }

  return [...kept, ...downgraded];
}

function withDecision(item: MatchedVacancyItem, decision: VacancyDecision): MatchedVacancyItem {
  return {
    ...item,
    explanation: {
      ...item.explanation,
      candidateDecision:
        decision.status === 'saved'
          ? { status: 'saved' }
          : { status: 'skipped', skipReasonId: decision.skipReasonId ?? undefined },
    },
  };
}
