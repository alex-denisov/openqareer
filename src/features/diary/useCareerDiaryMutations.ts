import { useCallback, useState } from 'react';
import type {
  CareerDiaryGoal,
  CareerDiaryGoalInput,
  CareerDiaryGoalPatch,
  CareerDiaryGoalSummary,
  CareerDiaryMeasurementInput,
} from '../../../shared/careerDiary';
import {
  createCareerDiaryGoal,
  deleteCareerDiaryGoal,
  recordCareerDiaryMeasurement,
  splitCareerDiaryGoal,
  updateCareerDiaryGoal,
} from './careerDiaryApi';

interface CareerDiaryMutationsOptions {
  readonly formGoal: CareerDiaryGoalSummary | null | undefined;
  readonly selectedGoalId: string | null;
  readonly reloadGoals: () => void;
  readonly reloadOverview: () => void;
  readonly reloadDetail: () => void;
  readonly selectGoal: (goalId: string | null) => void;
}

export function useCareerDiaryMutations(options: CareerDiaryMutationsOptions) {
  const goals = useCareerDiaryGoalMutations(options);
  const measurement = useCareerDiaryMeasurementMutation(options);
  return { ...goals, ...measurement };
}

function useCareerDiaryGoalMutations(options: CareerDiaryMutationsOptions) {
  const { formGoal, selectedGoalId, reloadGoals, reloadOverview, reloadDetail, selectGoal } =
    options;

  const saveGoal = useCallback(
    async (input: CareerDiaryGoalInput | CareerDiaryGoalPatch) => {
      if (formGoal) {
        await updateCareerDiaryGoal(formGoal.id, input as CareerDiaryGoalPatch);
        reloadDetail();
      } else {
        const created = await createCareerDiaryGoal(input as CareerDiaryGoalInput);
        selectGoal(created.id);
      }
      reloadGoals();
      reloadOverview();
    },
    [formGoal, reloadDetail, reloadGoals, reloadOverview, selectGoal],
  );

  const deleteGoal = useCallback(async () => {
    if (!formGoal) return;
    await deleteCareerDiaryGoal(formGoal.id);
    selectGoal(null);
    reloadGoals();
    reloadOverview();
  }, [formGoal, reloadGoals, reloadOverview, selectGoal]);

  const splitGoal = useCallback(
    async (children: readonly CareerDiaryGoalInput[]): Promise<CareerDiaryGoal[]> => {
      if (!selectedGoalId) throw new Error('Цель недоступна.');
      const splitChildren = await splitCareerDiaryGoal(selectedGoalId, children);
      reloadGoals();
      reloadOverview();
      return splitChildren;
    },
    [reloadGoals, reloadOverview, selectedGoalId],
  );

  return { saveGoal, deleteGoal, splitGoal };
}

function useCareerDiaryMeasurementMutation(options: CareerDiaryMutationsOptions) {
  const { selectedGoalId, reloadDetail, reloadGoals, reloadOverview } = options;
  const [measurementSaving, setMeasurementSaving] = useState(false);
  const saveMeasurement = useCallback(
    async (input: CareerDiaryMeasurementInput) => {
      if (!selectedGoalId) return;
      setMeasurementSaving(true);
      try {
        await recordCareerDiaryMeasurement(selectedGoalId, input);
        reloadDetail();
        reloadGoals();
        reloadOverview();
      } finally {
        setMeasurementSaving(false);
      }
    },
    [reloadDetail, reloadGoals, reloadOverview, selectedGoalId],
  );
  return { measurementSaving, saveMeasurement };
}
