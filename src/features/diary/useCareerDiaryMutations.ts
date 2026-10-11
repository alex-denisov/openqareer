import { useCallback, useState } from 'react';
import type { CareerDiaryGoalInput, CareerDiaryGoalPatch, CareerDiaryGoalSummary, CareerDiaryMeasurementInput } from '../../../shared/careerDiary';
import {
  createCareerDiaryGoal,
  deleteCareerDiaryGoal,
  recordCareerDiaryMeasurement,
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
  const [measurementSaving, setMeasurementSaving] = useState(false);
  const { formGoal, selectedGoalId, reloadGoals, reloadOverview, reloadDetail, selectGoal } = options;

  const saveGoal = useCallback(async (input: CareerDiaryGoalInput | CareerDiaryGoalPatch) => {
    if (formGoal) await updateCareerDiaryGoal(formGoal.id, input as CareerDiaryGoalPatch);
    else {
      const created = await createCareerDiaryGoal(input as CareerDiaryGoalInput);
      selectGoal(created.id);
    }
    reloadGoals();
    reloadOverview();
  }, [formGoal, reloadGoals, reloadOverview, selectGoal]);

  const deleteGoal = useCallback(async () => {
    if (!formGoal) return;
    await deleteCareerDiaryGoal(formGoal.id);
    selectGoal(null);
    reloadGoals();
    reloadOverview();
  }, [formGoal, reloadGoals, reloadOverview, selectGoal]);

  const saveMeasurement = useCallback(async (input: CareerDiaryMeasurementInput) => {
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
  }, [reloadDetail, reloadGoals, reloadOverview, selectedGoalId]);

  return { measurementSaving, saveGoal, deleteGoal, saveMeasurement };
}
