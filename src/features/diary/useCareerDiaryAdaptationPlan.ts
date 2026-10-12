import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryWorkplace } from '../../../shared/careerDiary';
import { apiErrorMessage } from '../coach/apiClient';
import { getCareerDiaryWorkplace, updateCareerDiaryWorkplace } from './careerDiaryApi';
import {
  addCareerDiaryAdaptationTask,
  canLaunchCareerDiaryAdaptationPlan,
  closeCareerDiaryAdaptationPlan,
  createCareerDiaryAdaptationPlan,
  careerDiaryAdaptationPhase,
  setCareerDiaryAdaptationTaskCompleted,
  type CareerDiaryAdaptationPlan,
  type CareerDiaryNewAdaptationTask,
  type CareerDiaryWorkplaceWithPlanning,
} from './careerDiaryPlanning';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

function useCareerDiaryWorkplace(
  enabled: boolean,
  primaryWorkplace: CareerDiaryWorkplace | null,
  asOf: string | null,
) {
  const [workplace, setWorkplace] = useState<CareerDiaryWorkplaceWithPlanning | null>(null);
  const [state, setState] = useState<CareerDiaryLoadState>('ready');
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!primaryWorkplace || !asOf) {
      setWorkplace(null);
      setState('ready');
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setState('loading');
    setError(null);
    void getCareerDiaryWorkplace(primaryWorkplace.id, controller.signal)
      .then((loaded) => {
        setWorkplace(loaded);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(apiErrorMessage(reason, 'Не удалось загрузить план адаптации.'));
        setState('error');
      });
    return () => controller.abort();
  }, [asOf, enabled, primaryWorkplace?.id, primaryWorkplace?.updatedAt, revision]);

  return { workplace, setWorkplace, state, error, reload };
}

function useCareerDiaryPlanMutations(
  workplace: CareerDiaryWorkplaceWithPlanning | null,
  setWorkplace: (workplace: CareerDiaryWorkplaceWithPlanning) => void,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savePlan = useCallback(async (nextPlan: CareerDiaryAdaptationPlan): Promise<boolean> => {
    if (!workplace || workplace.status === 'archived') {
      setError('Архивное место работы доступно только для чтения.');
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCareerDiaryWorkplace(workplace.id, {
        planning: { adaptationPlan: nextPlan },
      });
      setWorkplace(updated);
      return true;
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить план адаптации.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [setWorkplace, workplace]);

  return { saving, error, setError, savePlan };
}

function useCareerDiaryPlanActions(
  workplace: CareerDiaryWorkplaceWithPlanning | null,
  asOf: string | null,
  savePlan: (plan: CareerDiaryAdaptationPlan) => Promise<boolean>,
  reportError: (error: string | null) => void,
) {
  const plan = workplace?.planning?.adaptationPlan ?? null;
  const canEdit = Boolean(workplace?.status === 'active' && plan?.status === 'active');
  const canLaunch = Boolean(
    workplace && asOf && !plan && canLaunchCareerDiaryAdaptationPlan(workplace, asOf),
  );

  const launch = useCallback(async (): Promise<boolean> => {
    if (!workplace || !asOf || !canLaunch) return false;
    return savePlan(createCareerDiaryAdaptationPlan(workplace, `${asOf}T12:00:00.000Z`));
  }, [asOf, canLaunch, savePlan, workplace]);

  const setTaskCompleted = useCallback(async (taskId: string, completed: boolean): Promise<boolean> => {
    if (!plan || !canEdit) return false;
    return savePlan(setCareerDiaryAdaptationTaskCompleted(plan, taskId, completed));
  }, [canEdit, plan, savePlan]);

  const addTask = useCallback(async (input: CareerDiaryNewAdaptationTask): Promise<boolean> => {
    if (!plan || !canEdit) return false;
    try {
      return await savePlan(addCareerDiaryAdaptationTask(plan, input));
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : 'Проверьте данные задачи.');
      return false;
    }
  }, [canEdit, plan, reportError, savePlan]);

  const closePlan = useCallback(async (): Promise<boolean> => {
    if (!plan || !canEdit || !asOf) return false;
    return savePlan(closeCareerDiaryAdaptationPlan(plan, `${asOf}T12:00:00.000Z`));
  }, [asOf, canEdit, plan, savePlan]);

  return { plan, canEdit, canLaunch, launch, setTaskCompleted, addTask, closePlan };
}

export function useCareerDiaryAdaptationPlan(
  enabled: boolean,
  primaryWorkplace: CareerDiaryWorkplace | null,
  asOf: string | null,
) {
  const data = useCareerDiaryWorkplace(enabled, primaryWorkplace, asOf);
  const mutations = useCareerDiaryPlanMutations(data.workplace, data.setWorkplace);
  const actions = useCareerDiaryPlanActions(data.workplace, asOf, mutations.savePlan, mutations.setError);
  const phase = data.workplace && asOf
    ? careerDiaryAdaptationPhase(data.workplace, asOf)
    : null;

  return {
    workplace: data.workplace,
    plan: actions.plan,
    state: data.state,
    error: mutations.error ?? data.error,
    saving: mutations.saving,
    phase,
    canLaunch: actions.canLaunch,
    canEdit: actions.canEdit,
    reload: data.reload,
    launch: actions.launch,
    setTaskCompleted: actions.setTaskCompleted,
    addTask: actions.addTask,
    closePlan: actions.closePlan,
  };
}
