import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MANUAL_APPLY_REASONS,
  manualApplyHost,
  type ManualApplyItem,
  type ManualApplyReason,
} from '../../shared/manualApply';
import { preferredApplySource } from '../../shared/hhVacancySource';
import { SqliteManualApplyRepository, type StoredManualApply } from '../candidate/sqliteManualApplyRepository';
import { SqliteQuestionnaireRepository } from '../candidate/sqliteQuestionnaireRepository';
import { knownAnswers, skillYearAnswers, standardQuestions } from '../domain/manualApplyQuestions';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import { snapshotWithDescription } from './applicationVacancyText';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { latestLetterApproval } from './letterApprovalRead';
import { prepareLetterResume } from './letterApprovalResume';
import { poolReader, questionnaireView, type Signed } from './questionnaireRoutes';
import type { ResumeEditDeps } from './resumeEditRoutes';
import { releaseTariffQuota, requireTariffQuota } from './tariffQuotaGuard';

/**
 * B787: очередь «отправить вручную». Письмо, резюме и ответы собираются в фоне при постановке;
 * на площадку от имени кандидата ничего не отправляется.
 */
export interface ManualApplyService {
  /** Собранное для очереди письмо; если оно собирается — дождаться. `null` — его там нет. */
  preparedPitch(candidateId: string, vacancyId: string): Promise<unknown>;
}

export type QueuedLetterWriter = (
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  vacancyId: string,
) => Promise<{ readonly text: string; readonly pitch: unknown } | null>;

type Bound = ResumeEditDeps & {
  readonly queue: SqliteManualApplyRepository;
  readonly forms: SqliteQuestionnaireRepository;
  readonly writeLetter: QueuedLetterWriter;
  readonly inFlight: Map<string, Promise<void>>;
};
type Handler = (deps: Bound, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const BASE = '/api/v1/candidate/manual-applications';
const VACANCY_ID_MAX_LENGTH = 200;
/** Сбой письма повторяется сам, но не бесконечно: модель не зовётся на каждое открытие. */
const MAX_ATTEMPTS = 3;
const MAX_OPEN = 200;

const enqueueSchema = z
  .object({
    vacancyId: z.string().trim().min(1).max(VACANCY_ID_MAX_LENGTH),
    reason: z.enum(MANUAL_APPLY_REASONS),
    host: z
      .string()
      .trim()
      .max(253)
      .regex(/^[a-z0-9.-]+$/iu)
      .optional(),
  })
  .strict();

type Who = Omit<Signed, 'vacancyId'>;

function signed(deps: Bound, request: FastifyRequest, reply: FastifyReply): Who | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return {
    candidateId: principal.candidate.id,
    accountEmail: principal.emailVerified === false ? null : principal.email,
  };
}

const flightKey = (candidateId: string, vacancyId: string): string => `${candidateId}\n${vacancyId}`;

/** Вопросы формы: прочитанные у площадки или типовые, с уже известными ответами. */
async function prepareQuestions(deps: Bound, candidateId: string, item: StoredManualApply): Promise<void> {
  const { vacancyId } = item;
  // Анкету hh.ru присылает приложение; прочитанную раньше не трогаем.
  if (deps.forms.get(candidateId, vacancyId) || item.host === 'hh.ru') return;
  const source = await poolReader(deps)(vacancyId);
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  const skills = cluster?.skills ?? [];
  const questions =
    source?.questions ?? standardQuestions({ vacancyId, skills, location: cluster?.canonicalLocation });
  if (deps.forms.get(candidateId, vacancyId)) return;
  deps.forms.saveQuestions(candidateId, vacancyId, {
    questions,
    formUrl: item.url,
    readAt: new Date().toISOString(),
  });
  const places = deps.candidateStore.getSnapshot(candidateId).resume?.draft.experience ?? [];
  const previous = deps.forms.exportAll(candidateId).flatMap((form) => form.answers);
  const answers = knownAnswers(questions, previous, skillYearAnswers(skills, places, new Date()));
  if (answers.length > 0) deps.forms.saveAnswers(candidateId, vacancyId, answers);
}

/** Резюме под вакансию заранее; не собралось — письмо и ответы всё равно готовятся. */
function prepareResume(deps: Bound, request: FastifyRequest, candidateId: string, vacancyId: string): void {
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster) return;
  try {
    prepareLetterResume(deps, candidateId, cluster, deps.resumeEdits.read(candidateId, cluster.id));
  } catch (error) {
    request.log.warn({ err: error, vacancyId }, 'manual-apply-resume-failed');
  }
}

async function prepare(deps: Bound, request: FastifyRequest, candidateId: string, vacancyId: string) {
  const item = deps.queue.get(candidateId, vacancyId);
  if (!item) return;
  deps.queue.startAttempt(candidateId, vacancyId);
  await prepareQuestions(deps, candidateId, item);
  prepareResume(deps, request, candidateId, vacancyId);
  if (!item.letter && !latestLetterApproval(deps, candidateId, vacancyId)) {
    const letter = await deps.writeLetter(deps, request, candidateId, vacancyId);
    if (!letter) throw new Error('manual_apply_letter_failed');
    deps.queue.saveLetter(candidateId, vacancyId, letter.text, letter.pitch);
  }
  deps.queue.markPrepared(candidateId, vacancyId);
}

/** Один сбор на отклик: параллельные запросы присоединяются к идущему. */
function startPreparing(deps: Bound, request: FastifyRequest, candidateId: string, item: StoredManualApply): void {
  const { vacancyId } = item;
  const key = flightKey(candidateId, vacancyId);
  if (item.prepared || item.attempts >= MAX_ATTEMPTS || deps.inFlight.has(key)) return;
  const job = prepare(deps, request, candidateId, vacancyId)
    .catch((error: unknown) => {
      request.log.warn({ err: error, vacancyId }, 'manual-apply-prepare-failed');
      const left = deps.queue.get(candidateId, vacancyId);
      // Письма не будет: единица квоты возвращается, как при отказе на экране письма.
      if (left && !left.letter && left.attempts >= MAX_ATTEMPTS) {
        releaseTariffQuota(deps, candidateId, 'applications', vacancyId);
      }
    })
    .finally(() => deps.inFlight.delete(key));
  deps.inFlight.set(key, job);
}

function toItem(deps: Bound, who: Who, item: StoredManualApply): ManualApplyItem {
  const { vacancyId, applicationId, title, company, url, reason, host, createdAt } = item;
  const preparing = !item.prepared && item.attempts < MAX_ATTEMPTS;
  const stored = deps.forms.get(who.candidateId, vacancyId);
  const missingAnswers = stored
    ? questionnaireView(deps, { ...who, vacancyId }, stored, { state: 'ready', formUrl: null }).missingRequired
    : 0;
  const letter = latestLetterApproval(deps, who.candidateId, vacancyId)?.body ?? item.letter;
  const ready = missingAnswers > 0 ? 'needs_answer' : 'ready';
  // Вопросы видны сразу, как прочитаны: кандидат отвечает, пока остальное собирается.
  const state = preparing && missingAnswers === 0 ? 'preparing' : ready;
  return { vacancyId, applicationId, title, company, url, reason, host, state, missingAnswers, letter, createdAt };
}

const listQueue: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const open = deps.queue.listOpen(who.candidateId);
  // После перезапуска сервера незаконченный сбор продолжается сам.
  for (const item of open) startPreparing(deps, request, who.candidateId, item);
  return { data: open.map((item) => toItem(deps, who, item)), meta: { requestId: request.id } };
};

const notFound = (request: FastifyRequest, reply: FastifyReply) =>
  sendError(reply, request, 404, 'manual_application_not_found', 'Отклик не найден.', false);

function openItem(deps: Bound, request: FastifyRequest, candidateId: string): StoredManualApply | null {
  const item = deps.queue.get(candidateId, (request.params as { id: string }).id);
  return item?.status === 'open' ? item : null;
}

const readItem: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const item = openItem(deps, request, who.candidateId);
  if (!item) return notFound(request, reply);
  startPreparing(deps, request, who.candidateId, item);
  return { data: toItem(deps, who, item), meta: { requestId: request.id } };
};

function vacancyFacts(cluster: VacancyCluster, reason: ManualApplyReason, host: string | undefined) {
  const route = preferredApplySource(cluster);
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
    url: route.url,
    source: route.source ?? cluster.sources[0]?.sourceType ?? '',
    reason,
    host: host?.toLowerCase() || manualApplyHost(route.url),
  };
}

const enqueue: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const parsed = enqueueSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_manual_application', 'Проверьте вакансию.', false);
  }
  const { vacancyId, reason, host } = parsed.data;
  const { candidateId } = who;
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const known = deps.queue.get(candidateId, vacancyId);
  const facts = vacancyFacts(cluster, reason, host);
  if (known?.status !== 'open' && deps.queue.listOpen(candidateId).length >= MAX_OPEN) {
    return sendError(reply, request, 409, 'manual_queue_full', 'Сначала отправьте отклики из очереди.', false);
  }
  const application = deps.candidateStore.createApplication(candidateId, {
    clusterId: vacancyId,
    stage: 'saved',
    manualVacancy: snapshotWithDescription(deps.multiSourceEngine, vacancyId, {
      title: facts.title,
      company: facts.company,
      url: facts.url,
      source: facts.source,
    }),
  });
  if (application.stage !== 'saved') {
    return sendError(reply, request, 409, 'already_applied', 'Отклик уже отправлен.', false);
  }
  if (!known?.prepared && !requireTariffQuota(deps, request, reply, candidateId, 'applications', vacancyId)) {
    return reply;
  }
  const item = deps.queue.enqueue(candidateId, vacancyId, {
    ...facts,
    applicationId: application.id,
    at: new Date().toISOString(),
  });
  startPreparing(deps, request, candidateId, item);
  return reply.code(known ? 200 : 201).send({
    data: toItem(deps, who, item),
    meta: { requestId: request.id },
  });
};

const markSent: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const { candidateId } = who;
  const item = openItem(deps, request, candidateId);
  if (!item) return notFound(request, reply);
  const { vacancyId, title, company, url, source } = item;
  const vacancy = { title, company, url, source };
  deps.candidateStore.recordVacancyApplication(candidateId, {
    clusterId: vacancyId,
    status: 'applied',
    vacancy: snapshotWithDescription(deps.multiSourceEngine, vacancyId, vacancy) ?? vacancy,
  });
  const at = new Date().toISOString();
  deps.forms.markSubmitted(candidateId, vacancyId, at);
  deps.queue.close(candidateId, vacancyId, 'sent', at);
  return { data: { applicationId: item.applicationId }, meta: { requestId: request.id } };
};

const skip: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const item = openItem(deps, request, who.candidateId);
  if (!item) return notFound(request, reply);
  const application = deps.candidateStore.getApplication(who.candidateId, item.applicationId);
  if (application?.stage === 'saved') {
    deps.candidateStore.patchApplication(who.candidateId, application.id, {
      expectedVersion: application.version,
      stage: 'archived',
    });
  }
  deps.queue.close(who.candidateId, item.vacancyId, 'skipped', new Date().toISOString());
  return { data: { applicationId: item.applicationId }, meta: { requestId: request.id } };
};

export function registerManualApplyRoutes(
  app: FastifyInstance,
  deps: ResumeEditDeps,
  database: DatabaseSync,
  writeLetter: QueuedLetterWriter,
): ManualApplyService {
  const key = deps.config.dataEncryptionKey;
  const bound: Bound = {
    ...deps,
    queue: new SqliteManualApplyRepository(database, key),
    forms: new SqliteQuestionnaireRepository(database, key),
    writeLetter,
    inFlight: new Map(),
  };
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  app.get(BASE, withDeps(bound, listQueue));
  app.post(BASE, write, withDeps(bound, enqueue));
  app.get(`${BASE}/:id`, withDeps(bound, readItem));
  app.post(`${BASE}/:id/sent`, write, withDeps(bound, markSent));
  app.post(`${BASE}/:id/skip`, write, withDeps(bound, skip));
  app.addHook('onClose', async () => void (await Promise.allSettled(bound.inFlight.values())));
  return {
    async preparedPitch(candidateId, vacancyId) {
      await bound.inFlight.get(flightKey(candidateId, vacancyId));
      return bound.queue.get(candidateId, vacancyId)?.pitch ?? null;
    },
  };
}
