import type {
  CareerDiaryAdaptationTask,
  CareerDiaryAdaptationView,
} from '../../../../shared/careerDiaryCards';
import {
  addCareerDiaryAdaptationTask,
  createCareerDiaryAdaptationPlanFromSteps,
  type CareerDiaryAdaptationPlan,
  type CareerDiaryWorkplaceWithPlanning,
} from '../../diary/careerDiaryPlanning';
import { stageForDate } from '../adaptation/adaptationModel';
import { shortDate } from './model';

/** Задачи плана адаптации, привязанные к цели, в порядке плана. */
export function goalTasks(
  view: CareerDiaryAdaptationView,
  goalId: string,
): readonly CareerDiaryAdaptationTask[] {
  return view.stages.flatMap((stage) => stage.tasks).filter((task) => task.goalId === goalId);
}

/** «до 14 янв». */
export const taskWhen = (task: CareerDiaryAdaptationTask): string =>
  `до ${shortDate(task.dueDate)}`;

export interface NewGoalTask {
  readonly title: string;
  readonly dueDate: string;
}

/**
 * План с новой задачей цели и её номер. Плана нет — пустой план места работы:
 * задачи шаблона сами не появляются, только то, что кандидат добавил.
 */
export function withGoalTask(
  workplace: CareerDiaryWorkplaceWithPlanning,
  input: NewGoalTask,
  createdAt: string,
  idFactory: () => string = () => crypto.randomUUID(),
): { readonly plan: CareerDiaryAdaptationPlan; readonly taskId: string } {
  const current =
    workplace.planning?.adaptationPlan ??
    createCareerDiaryAdaptationPlanFromSteps(workplace, [], createdAt, idFactory);
  const taskId = idFactory();
  const plan = addCareerDiaryAdaptationTask(
    current,
    {
      title: input.title,
      dueDate: input.dueDate,
      stage: stageForDate(workplace.startDate, input.dueDate),
      category: 'delivery',
    },
    () => taskId,
  );
  return { plan, taskId };
}
