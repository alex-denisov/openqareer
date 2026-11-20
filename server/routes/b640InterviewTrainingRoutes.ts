import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  checkAnswerNumbers,
  scoreInterviewAnswerWithQuotes,
} from '../domain/interviewAnswerReview';
import type { InterviewQuestion, InterviewSession } from '../domain/interviewSimulator';
import { buildSystemDesignTask, type SystemDesignTask } from '../domain/systemDesignTask';
import { extractSystemDesignSchema, type SystemDesignSchema } from '../domain/systemDesignSchema';
import { linkReviewToSchema } from '../domain/systemDesignSchemaReview';
import { correctedSchema, schemaPutBodySchema } from './b640InterviewSchemaBody';
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

type AnsweredContext = SessionContext & {
  question: InterviewQuestion & { answer: NonNullable<InterviewQuestion['answer']> };
};

interface SchemaView {
  readonly schema: SystemDesignSchema | null;
  readonly source: 'answer' | 'corrected';
}

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
): AnsweredContext | null {
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
  const schema = question.type === 'system_design' ? schemaView(deps, context) : null;
  const evaluation = scoreInterviewAnswerWithQuotes(question.answer.text, question.type);
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
      evaluation: schema ? linkReviewToSchema(evaluation, schema.schema) : evaluation,
      numbers: checkAnswerNumbers(question.answer.text, facts),
      exampleAnswer:
        question.type === 'system_design'
          ? taskFor(deps, candidate.id, session).exampleAnswer
          : null,
      helpful,
      schema,
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

function schemaKey(context: AnsweredContext) {
  return {
    candidateId: context.candidate.id,
    sessionId: context.session.id,
    questionId: context.question.id,
  };
}

/** B647: исправленная кандидатом схема или построенная из ответа; null — ответ слишком короткий. */
function schemaView(deps: RouteDeps, context: AnsweredContext): SchemaView {
  const stored = deps.candidateStore.interviewSimulatorRepo.designSchemas.get(schemaKey(context));
  return stored
    ? { schema: stored, source: 'corrected' }
    : { schema: extractSystemDesignSchema(context.question.answer.text), source: 'answer' };
}

function systemDesignQuestion(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): AnsweredContext | null {
  const context = answeredQuestion(deps, request, reply);
  if (context && context.question.type !== 'system_design') {
    sendError(
      reply,
      request,
      409,
      'interview_question_not_system_design',
      'Схема есть только у задачи System Design.',
      false,
    );
    return null;
  }
  return context;
}

const handleSchema: Handler = async (deps, request, reply) => {
  const context = systemDesignQuestion(deps, request, reply);
  if (!context) return reply;
  return { data: schemaView(deps, context), meta: { requestId: request.id } };
};

const SCHEMA_ERRORS: Readonly<Record<string, readonly [number, string]>> = {
  missing: [409, 'Схемы по ответу нет: ответ слишком короткий.'],
  too_many_links: [422, 'В схеме слишком много связей.'],
};

const handleSchemaPut: Handler = async (deps, request, reply) => {
  const context = systemDesignQuestion(deps, request, reply);
  if (!context) return reply;
  const body = schemaPutBodySchema.safeParse(request.body);
  if (!body.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_interview_schema',
      'Проверьте правку схемы.',
      false,
    );
  }
  const result = correctedSchema(body.data, schemaView(deps, context).schema);
  if (!result.ok) {
    const [status, message] = SCHEMA_ERRORS[result.error] ?? [422, 'Правка не подходит к схеме.'];
    return sendError(reply, request, status, `interview_schema_${result.error}`, message, false);
  }
  const schema = deps.candidateStore.interviewSimulatorRepo.designSchemas.set(
    schemaKey(context),
    result.schema,
    new Date().toISOString(),
  );
  return { data: { schema, source: 'corrected' }, meta: { requestId: request.id } };
};

/** B681: маршруты тренировки кабинета B640; без флага отвечают 404. */
export function registerB640InterviewTrainingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(`${URL}/:id/system-design-task`, withDeps(deps, handleTask));
  // Без лимита частоты: маршруты только для вошедшего кандидата (правило владельца 23.10).
  app.post(`${URL}/:id/questions/:questionId/review`, withDeps(deps, handleReview));
  app.put(`${URL}/:id/questions/:questionId/helpful`, withDeps(deps, handleHelpful));
  // B647: схема System Design из ответа и «Исправить схему».
  app.get(`${URL}/:id/questions/:questionId/schema`, withDeps(deps, handleSchema));
  app.put(`${URL}/:id/questions/:questionId/schema`, withDeps(deps, handleSchemaPut));
}
