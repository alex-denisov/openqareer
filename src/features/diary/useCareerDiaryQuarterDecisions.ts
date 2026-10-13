import { useCallback, useState } from 'react';
import { apiErrorMessage } from '../coach/apiClient';
import { updateCareerDiaryGoal } from './careerDiaryApi';
import { careerDiaryQuarter, type CareerDiaryGoalWithQuarterDecision } from './careerDiaryPlanning';

export function useCareerDiaryQuarterDecisions(
  goals: readonly CareerDiaryGoalWithQuarterDecision[],
  asOf: string | null,
  reloadGoals: () => void,
  reloadOverview: () => void,
) {
  const [savingGoalId, setSavingGoalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveDecision = useCallback(async (
    goalId: string,
    decision: 'keep' | 'move',
  ): Promise<void> => {
    const goal = goals.find((item) => item.id === goalId);
    if (!goal || !asOf) return;
    const quarter = careerDiaryQuarter(asOf);
    setSavingGoalId(goalId);
    setError(null);
    try {
      await updateCareerDiaryGoal(goalId, {
        quarterDecision: { quarterId: quarter.id, decision, decidedAt: asOf },
        ...(decision === 'move' ? { horizon: 'next_quarter', dueDate: quarter.nextEndDate } : {}),
      });
      reloadGoals();
      reloadOverview();
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить решение по цели.'));
    } finally {
      setSavingGoalId(null);
    }
  }, [asOf, goals, reloadGoals, reloadOverview]);

  return { savingGoalId, error, saveDecision };
}
