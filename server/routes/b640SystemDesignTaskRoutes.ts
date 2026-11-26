import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildSystemDesignTask, type SystemDesignTask } from '../domain/systemDesignTask';
import {
  buildSystemDesignTaskWriter,
  type SystemDesignTaskWriter,
} from '../providers/systemDesignTaskModel';
import { sessionCandidate } from './b640VacancyContext';
import { trainingCase } from '../domain/trainingCase';
import { taskInputFor } from './b640SystemDesignTaskSource';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B750: задача System Design по отклику (I3a). Первое открытие пишет задачу моделью по
 * вакансии, при отказе модели — шаблоном по области вакансии или семье роли; задача
 * сохраняется с откликом, и следующие открытия, тренировка и разбор видят ту же.
 * POST, а не GET: первое открытие пишет в базу.
 */
export type SystemDesignTaskRouteDeps = RouteDeps & {
  readonly systemDesignTasks?: SystemDesignTaskWriter;
};

const URL = '/api/v1/candidate/b640/interview-tasks';
const bodySchema = z.object({ applicationId: z.string().trim().min(1).max(160) }).strict();

const withoutExample = ({ exampleAnswer: _example, ...task }: SystemDesignTask) => task;

/** На задачу уже ответили: разбор судит ответ по ней, поэтому она остаётся. */
function hasAnswer(
  deps: RouteDeps,
  key: { readonly candidateId: string; readonly applicationId: string },
): boolean {
  const session = deps.candidateStore.interviewSimulatorRepo.getCurrent(key.candidateId);
  return Boolean(
    session?.applicationId === key.applicationId &&
    session.questions.some(({ type, answer }) => type === 'system_design' && answer),
  );
}

export function registerB640SystemDesignTaskRoutes(
  app: FastifyInstance,
  deps: SystemDesignTaskRouteDeps,
): void {
  const writer =
    deps.systemDesignTasks ??
    buildSystemDesignTaskWriter({ providerCredentials: deps.config.providerCredentials });

  // Без лимита частоты: только для вошедшего кандидата (правило владельца 23.10).
  app.post(
    URL,
    withDeps(deps, async (bound, request, reply) => {
      const principal = requireCabinetB640(request, reply, bound);
      if (!principal) return reply;
      const candidate = sessionCandidate(request, reply, principal.candidate);
      if (!candidate) return reply;
      const body = bodySchema.safeParse(request.body);
      if (!body.success) {
        return sendError(reply, request, 400, 'invalid_interview_task', 'Проверьте запрос.', false);
      }
      const application = bound.candidateStore.getApplication(
        candidate.id,
        body.data.applicationId,
      );
      if (!application) {
        return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
      }
      const tasks = bound.candidateStore.interviewSimulatorRepo.designTasks;
      const key = { candidateId: candidate.id, applicationId: application.id };
      const stored = tasks.get(key);
      const input = taskInputFor(bound, application);
      const fits = stored && (stored.caseKind ?? 'system') === trainingCase(input);
      if (stored && (fits || hasAnswer(bound, key)))
        return { data: withoutExample(stored), meta: { requestId: request.id } };
      const written = (await writer?.write(input)) ?? buildSystemDesignTask(input);
      const kept = stored
        ? tasks.replace(key, stored, written)
        : tasks.keep(key, written, new Date().toISOString());
      return { data: withoutExample(kept), meta: { requestId: request.id } };
    }),
  );
}
