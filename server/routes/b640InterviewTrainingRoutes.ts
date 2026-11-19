import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  checkAnswerNumbers,
  scoreInterviewAnswerWithQuotes,
} from '../domain/interviewAnswerReview';
import type { InterviewQuestion, InterviewSession } from '../domain/interviewSimulator';
import { buildSystemDesignTask, type SystemDesignTask } from '../domain/systemDesignTask';
import type { CandidateIdentity } from '../data/candidateStore';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B681: тренировка нового кабинета — задача System Design под вакансию,
 * разбор ответа с цитатами и «разбор помог». Старые маршруты тренировки и
 * сохранённая оценка не меняются: разбор считается на чтении.
 */
const URL = '/api/v1/candidate/b640/interview-sessions';
const idSchema = z.string().trim().min(1).max(160);
const questionParamsSchema = z.object({
  id: idSchema,
  questionId: z.string().trim().min(1).max(80),
});
const reviewBodySchema = z.object({}).strict().nullish();
const helpfulBodySchema = z.object({ helpful: z.boolean() }).strict();

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

interface SessionContext {
  readonly candidate: CandidateIdentity;
  readonly session: InterviewSession;
}

function notFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(
    reply,
    request,
    404,
    'interview_session_not_found',
    'Тренировка не найдена.',
    false,
  );
}

function loadSession(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  id: unknown,
): SessionContext | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return null;
  const parsedId = idSchema.safeParse(id);
  const session = parsedId.success
    ? deps.candidateStore.interviewSimulatorRepo.get(candidate.id, parsedId.data)
    : null;
  if (!session) {
    notFound(request, reply);
    return null;
  }
  return { candidate, session };
}

function taskFor(
  deps: RouteDeps,
  candidateId: string,
  session: InterviewSession,
): SystemDesignTask {
  const application = session.applicationId
    ? deps.candidateStore.getApplication(candidateId, session.applicationId)
    : null;
  return buildSystemDesignTask({
    vacancyTitle: application?.vacancy?.title ?? session.vacancyTitle ?? session.roleTitle,
    company: application?.vacancy?.companyHidden ? undefined : application?.vacancy?.company,
    description: application?.vacancy?.description,
  });
}

/** Условие задачи без образца ответа: образец показывается в разборе, после ответа. */
const handleTask: Handler = async (deps, request, reply) => {
  const context = loadSession(deps, request, reply, (request.params as { id?: unknown }).id);
  if (!context) return reply;
  const { exampleAnswer: _example, ...task } = taskFor(deps, context.candidate.id, context.session);
  return { data: task, meta: { requestId: request.id } };
};

function answeredQuestion(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
):
  | (SessionContext & {
      question: InterviewQuestion & { answer: NonNullable<InterviewQuestion['answer']> };
    })
  | null {
  const params = questionParamsSchema.safeParse(request.params);
  const context = loadSession(deps, request, reply, params.success ? params.data.id : undefined);
  if (!context) return null;
  const question = params.success
    ? context.session.questions.find((item) => item.id === params.data.questionId)
    : undefined;
  if (!question) {
    sendError(reply, request, 404, 'interview_question_not_found', 'Вопрос не найден.', false);
    return null;
  }
  if (!question.answer) {
    sendError(
      reply,
      request,
      409,
      'interview_question_unanswered',
      'Сначала ответьте на вопрос.',
      false,
    );
    return null;
  }
  return { ...context, question: { ...question, answer: question.answer } };
}

const handleReview: Handler = async (deps, request, reply) => {
  const context = answeredQuestion(deps, request, reply);
  if (!context) return reply;
  if (!reviewBodySchema.safeParse(request.body).success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_interview_review',
      'Проверьте запрос разбора.',
      false,
    );
  }
  const { candidate, session, question } = context;
  const facts = deps.candidateStore.getSnapshot(candidate.id).memory;
  const helpful = deps.candidateStore.interviewSimulatorRepo.reviewHelpful.get({
    candidateId: candidate.id,
    sessionId: session.id,
    questionId: question.id,
  });
  return {
    data: {
      questionId: question.id,
      type: question.type,
      evaluation: scoreInterviewAnswerWithQuotes(question.answer.text, question.type),
      numbers: checkAnswerNumbers(question.answer.text, facts),
      exampleAnswer:
        question.type === 'system_design'
          ? taskFor(deps, candidate.id, session).exampleAnswer
          : null,
      helpful,
    },
    meta: { requestId: request.id },
  };
};

const handleHelpful: Handler = async (deps, request, reply) => {
  const context = answeredQuestion(deps, request, reply);
  if (!context) return reply;
  const body = helpfulBodySchema.safeParse(request.body);
  if (!body.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_interview_helpful',
      'Укажите, помог ли разбор.',
      false,
    );
  }
  const helpful = deps.candidateStore.interviewSimulatorRepo.reviewHelpful.set(
    {
      candidateId: context.candidate.id,
      sessionId: context.session.id,
      questionId: context.question.id,
    },
    body.data.helpful,
    new Date().toISOString(),
  );
  return { data: { helpful }, meta: { requestId: request.id } };
};

/** B681: маршруты тренировки кабинета B640; без флага отвечают 404. */
export function registerB640InterviewTrainingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(`${URL}/:id/system-design-task`, withDeps(deps, handleTask));
  // Без лимита частоты: маршруты только для вошедшего кандидата (правило владельца 23.10).
  app.post(`${URL}/:id/questions/:questionId/review`, withDeps(deps, handleReview));
  app.put(`${URL}/:id/questions/:questionId/helpful`, withDeps(deps, handleHelpful));
}
