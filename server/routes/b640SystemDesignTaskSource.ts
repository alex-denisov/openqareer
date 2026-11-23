import type { ApplicationView } from '../domain/applicationDerivedFields';
import type { InterviewSession } from '../domain/interviewSimulator';
import { buildSystemDesignTask, type SystemDesignTask } from '../domain/systemDesignTask';
import type { SystemDesignModelInput } from '../domain/systemDesignTaskModel';
import { vacancyDescriptionHash } from '../domain/vacancyRequirements';
import type { RouteDeps } from './deps';
import { readVacancyFitTarget } from './vacancyFitContext';

/**
 * B750: вход задачи System Design по отклику. Текст — полный из пула, пока вакансия в нём,
 * иначе сохранённый в отклике (B635); требования — уже извлечённые из этого текста (B510),
 * без новой постановки в очередь и без модели.
 */
export function taskInputFor(
  deps: RouteDeps,
  application: ApplicationView,
): SystemDesignModelInput {
  const vacancy = application.vacancy;
  const company = vacancy?.companyHidden ? undefined : vacancy?.company;
  const base = {
    vacancyTitle: vacancy?.title?.trim() || 'роль отклика',
    ...(company ? { company } : {}),
  };
  const target = application.clusterId
    ? readVacancyFitTarget(deps, application.clusterId)
    : undefined;
  const description = target?.description.trim() || vacancy?.description?.trim() || '';
  if (!description) return base;
  const extracted = target
    ? deps.vacancyMechanics?.requirements.getLatestOrLegacy(
        target.vacancyId,
        vacancyDescriptionHash(target.description),
      )
    : null;
  const requirements = extracted?.requirements.map((requirement) => requirement.text) ?? [];
  return { ...base, description, ...(requirements.length ? { requirements } : {}) };
}

/**
 * Задача тренировки: показанная по отклику (B750), иначе шаблон по снимку отклика. Только
 * чтение: модель зовёт и задачу записывает один POST interview-tasks.
 */
export function storedOrRuleTask(
  deps: RouteDeps,
  candidateId: string,
  session: InterviewSession,
): SystemDesignTask {
  const application = session.applicationId
    ? deps.candidateStore.getApplication(candidateId, session.applicationId)
    : null;
  const stored = application
    ? deps.candidateStore.interviewSimulatorRepo.designTasks.get({
        candidateId,
        applicationId: application.id,
      })
    : null;
  if (stored) return stored;
  return buildSystemDesignTask({
    vacancyTitle: application?.vacancy?.title ?? session.vacancyTitle ?? session.roleTitle,
    company: application?.vacancy?.companyHidden ? undefined : application?.vacancy?.company,
    description: application?.vacancy?.description,
  });
}
