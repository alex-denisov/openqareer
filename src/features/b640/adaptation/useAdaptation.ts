import { useCallback, useEffect, useState } from 'react';
import type { CareerDiaryAdaptationView } from '../../../../shared/careerDiaryCards';
import type { CareerDiaryPeopleMap } from '../../../../shared/careerDiaryPeople';
import {
  addCareerDiaryAdaptationTask,
  createCareerDiaryAdaptationPlan,
  setCareerDiaryAdaptationTaskCompleted,
  type CareerDiaryAdaptationPlan,
  type CareerDiaryNewAdaptationTask,
  type CareerDiaryWorkplaceWithPlanning,
} from '../../diary/careerDiaryPlanning';
import {
  getAdaptation,
  getOverview,
  getPeople,
  getWorkplace,
  patchAdaptation,
  savePlan,
  type AdaptationPatch,
} from './adaptationApi';

export interface AdaptationData {
  readonly workplace: CareerDiaryWorkplaceWithPlanning;
  readonly view: CareerDiaryAdaptationView;
  /** Карта людей; `null` — не загрузилась, шаг показывается без счёта. */
  readonly people: CareerDiaryPeopleMap | null;
}

export type AdaptationState =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'empty' }
  | ({ readonly state: 'ready' } & AdaptationData);

async function load(): Promise<AdaptationState> {
  const overview = await getOverview();
  const primary = overview.primaryWorkplace;
  if (!primary) return { state: 'empty' };
  const [workplace, view, people] = await Promise.all([
    getWorkplace(primary.id),
    getAdaptation(primary.id),
    getPeople(primary.id).catch(() => null),
  ]);
  return { state: 'ready', workplace, view, people };
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** План адаптации основного места работы и действия над ним. */
export function useAdaptation() {
  const [data, setData] = useState<AdaptationState>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    load().then(
      (next) => active && setData(next),
      () => active && setData({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setData({ state: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  /** Пишет план и перечитывает вид; ошибку отдаёт вызвавшему для строки на месте. */
  const write = useCallback(
    async (change: (plan: CareerDiaryAdaptationPlan | null) => CareerDiaryAdaptationPlan | null) => {
      if (data.state !== 'ready') return;
      const plan = data.workplace.planning?.adaptationPlan ?? null;
      const next = change(plan);
      if (!next) return;
      const workplace = await savePlan(data.workplace.id, next);
      const view = await getAdaptation(workplace.id);
      setData({ ...data, workplace, view });
    },
    [data],
  );

  const toggleTask = (taskId: string, completed: boolean) =>
    write((plan) => (plan ? setCareerDiaryAdaptationTaskCompleted(plan, taskId, completed) : plan));
  const addTask = (input: CareerDiaryNewAdaptationTask) =>
    write((plan) => (plan ? addCareerDiaryAdaptationTask(plan, input) : plan));
  const startPlan = () =>
    write((plan) =>
      plan ?? (data.state === 'ready' ? createCareerDiaryAdaptationPlan(data.workplace, `${today()}T12:00:00.000Z`) : plan),
    );
  const patchDetails = async (patch: AdaptationPatch) => {
    if (data.state !== 'ready') return;
    const view = await patchAdaptation(data.workplace.id, patch);
    setData({ ...data, view });
  };
  return { data, reload, toggleTask, addTask, startPlan, patchDetails };
}
