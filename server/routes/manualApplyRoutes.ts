import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MANUAL_APPLY_REASONS,
  manualApplyHost,
  manualApplyUrl,
  type ManualApplyItem,
  type ManualApplyReason,
} from '../../shared/manualApply';
import { preferredApplySource } from '../../shared/hhVacancySource';
import {
  SqliteManualApplyRepository,
  type StoredManualApply,
} from '../candidate/sqliteManualApplyRepository';
import { candidateFlagLookup } from '../candidate/hhRaiseQueue';
import { SqliteQuestionnaireRepository } from '../candidate/sqliteQuestionnaireRepository';
import { knownAnswers, skillYearAnswers, standardQuestions } from '../domain/manualApplyQuestions';
import {
  letterFactSource,
  letterFreshness,
  type LetterFactSource,
} from '../domain/letterFreshness';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import { snapshotWithDescription } from './applicationVacancyText';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { latestLetterApproval } from './letterApprovalRead';
import { letterVacancyTexts } from './letterDraftRoutes';
import { appliesOnHh } from '../vacancies/applyOnHh';
import { prepareVacancyLang } from './resumeDefaultLang';
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
  request: Pick<FastifyRequest, 'log'>,
  candidateId: string,
  vacancyId: string,
) => Promise<{ readonly text: string; readonly pitch: unknown } | null>;

type Bound = ResumeEditDeps & {
  readonly queue: SqliteManualApplyRepository;
  readonly hh: SqliteHhSessionRepository;
  readonly forms: SqliteQuestionnaireRepository;
  readonly writeLetter: QueuedLetterWriter;
  readonly inFlight: Map<string, Promise<void>>;
  /** B649: фоновая задача кандидата без флага нового кабинета не берёт. */
  readonly isFlagged: (candidateId: string) => boolean;
};
/** Фону нужен только журнал запроса. */
type LogContext = Pick<FastifyRequest, 'log'>;
type Handler = (deps: Bound, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const BASE = '/api/v1/candidate/manual-applications';
const VACANCY_ID_MAX_LENGTH = 200;
/** Сбой письма повторяется сам, но не бесконечно: модель не зовётся на каждое открытие. */
const MAX_ATTEMPTS = 3;
const MAX_OPEN = 200;
/** Прерванный сбор (перезапуск сервера) продолжает фоновый такт. */
const TICK_MS = 60_000;
const STALE_MS = 5 * 60_000;
const TICK_LIMIT = 10;

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

/** `requireCabinetB640` отклоняет и изменяющий запрос с чужого origin. */
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

const flightKey = (candidateId: string, vacancyId: string): string =>
  `${candidateId}\n${vacancyId}`;

/** Вопросы формы: прочитанные у площадки или типовые, с уже известными ответами. */
async function prepareQuestions(
  deps: Bound,
  candidateId: string,
  item: StoredManualApply,
): Promise<void> {
  const { vacancyId } = item;
  // Анкету hh.ru присылает приложение; прочитанную раньше не трогаем.
  if (deps.forms.get(candidateId, vacancyId) || item.host === 'hh.ru') return;
  const source = await poolReader(deps)(vacancyId);
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  const skills = cluster?.skills ?? [];
  const questions =
    source?.questions ??
    standardQuestions({ vacancyId, skills, location: cluster?.canonicalLocation });
  if (deps.forms.get(candidateId, vacancyId)) return;
  deps.forms.saveQuestions(candidateId, vacancyId, {
    questions,
    formUrl: manualApplyUrl(item.url),
    readAt: new Date().toISOString(),
  });
  const places = deps.candidateStore.getSnapshot(candidateId).resume?.draft.experience ?? [];
  const previous = deps.forms.exportAll(candidateId).flatMap((form) => form.answers);
  const answers = knownAnswers(questions, previous, skillYearAnswers(skills, places, new Date()));
  if (answers.length > 0) deps.forms.saveAnswers(candidateId, vacancyId, answers);
}

/** Резюме под вакансию заранее; не собралось — письмо и ответы всё равно готовятся. */
async function prepareResume(
  deps: Bound,
  request: LogContext,
  candidateId: string,
  vacancyId: string,
): Promise<void> {
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster || appliesOnHh(deps, candidateId, vacancyId, cluster)) return;
  try {
    const choices = await prepareVacancyLang(deps, candidateId, cluster);
    prepareLetterResume(deps, candidateId, cluster, choices);
  } catch (error) {
    request.log.warn({ err: error, vacancyId }, 'manual-apply-resume-failed');
  }
}

function factSource(deps: RouteDeps, candidateId: string): LetterFactSource {
  return letterFactSource(deps.candidateStore.getSnapshot(candidateId));
}

const pitchProfileSchema = z.object({ profileHash: z.string() });

/** Профиль, по которому собрано письмо очереди. */
function pitchProfile(pitch: unknown): string | null {
  return pitchProfileSchema.safeParse(pitch).data?.profileHash ?? null;
}

/** Письмо отклика; текст с опровергнутым числом профиля не отдаём. */
function currentLetter(
  deps: Bound,
  candidateId: string,
  item: StoredManualApply,
  source: LetterFactSource,
): string | null {
  const approved = latestLetterApproval(deps, candidateId, item.vacancyId, source);
  if (approved) return approved.factsChanged ? null : approved.body;
  if (!item.letter) return null;
  const profileHash = pitchProfile(item.pitch);
  const mark = profileHash ? { profileHash, ownNumbers: [] } : null;
  const texts = letterVacancyTexts(deps, item.vacancyId);
  return letterFreshness(source, item.letter, texts, mark).factsChanged ? null : item.letter;
}

async function prepare(
  deps: Bound,
  request: LogContext,
  candidateId: string,
  item: StoredManualApply,
): Promise<void> {
  const { vacancyId } = item;
  await prepareQuestions(deps, candidateId, item);
  await prepareResume(deps, request, candidateId, vacancyId);
  const source = factSource(deps, candidateId);
  if (!item.letter && !latestLetterApproval(deps, candidateId, vacancyId, source)) {
    const letter = await deps.writeLetter(deps, request, candidateId, vacancyId);
    if (!letter) throw new Error('manual_apply_letter_failed');
    deps.queue.saveLetter(candidateId, vacancyId, letter.text, letter.pitch);
  }
  deps.queue.markPrepared(candidateId, vacancyId);
}

/** Попытки кончились: единица квоты возвращается ровно один раз. */
function giveUp(deps: Bound, candidateId: string, vacancyId: string): void {
  const left = deps.queue.get(candidateId, vacancyId);
  if (!left || left.attempts !== MAX_ATTEMPTS) return;
  if (!deps.queue.claimAttempt(candidateId, left, new Date().toISOString())) return;
  if (!left.letter) releaseTariffQuota(deps, candidateId, 'applications', vacancyId);
}

/** Один сбор на отклик: параллельные запросы присоединяются к идущему. */
function startPreparing(
  deps: Bound,
  request: LogContext,
  candidateId: string,
  item: StoredManualApply,
): void {
  const { vacancyId } = item;
  const key = flightKey(candidateId, vacancyId);
  if (item.prepared || item.attempts >= MAX_ATTEMPTS || deps.inFlight.has(key)) return;
  if (!deps.queue.claimAttempt(candidateId, item, new Date().toISOString())) return;
  const job = prepare(deps, request, candidateId, item)
    .catch((error: unknown) => {
      request.log.warn({ err: error, vacancyId }, 'manual-apply-prepare-failed');
      giveUp(deps, candidateId, vacancyId);
    })
    .finally(() => deps.inFlight.delete(key));
  deps.inFlight.set(key, job);
}

/** Фоновый такт: сбор, прерванный перезапуском, продолжается без участия кандидата. */
export function resumeStalled(deps: Bound, request: LogContext, now: number): void {
  const before = new Date(now - STALE_MS).toISOString();
  const stale = deps.queue.listStale(before, MAX_ATTEMPTS, TICK_LIMIT, deps.isFlagged);
  for (const { candidateId, item } of stale) {
    if (deps.inFlight.has(flightKey(candidateId, item.vacancyId))) continue;
    if (item.attempts >= MAX_ATTEMPTS) giveUp(deps, candidateId, item.vacancyId);
    else startPreparing(deps, request, candidateId, item);
  }
}

function startTick(app: FastifyInstance, deps: Bound): void {
  const timer = setInterval(() => {
    try {
      resumeStalled(deps, app, Date.now());
    } catch (error) {
      app.log.warn({ err: error }, 'manual-apply-tick-failed');
    }
  }, TICK_MS);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

function toItem(
  deps: Bound,
  who: Who,
  item: StoredManualApply,
  source = factSource(deps, who.candidateId),
): ManualApplyItem {
  const { vacancyId, applicationId, title, company, url, reason, host, createdAt } = item;
  const preparing = !item.prepared && item.attempts <= MAX_ATTEMPTS;
  const stored = deps.forms.get(who.candidateId, vacancyId);
  const missingAnswers = stored
    ? questionnaireView(deps, { ...who, vacancyId }, stored, { state: 'ready', formUrl: null })
        .missingRequired
    : 0;
  const letter = currentLetter(deps, who.candidateId, item, source);
  const ready = missingAnswers > 0 ? 'needs_answer' : 'ready';
  // Вопросы видны сразу, как прочитаны: кандидат отвечает, пока остальное собирается.
  const state = preparing && missingAnswers === 0 ? 'preparing' : ready;
  return {
    vacancyId,
    applicationId,
    title,
    company,
    url: manualApplyUrl(url),
    reason,
    host,
    state,
    preparing,
    missingAnswers,
    letter,
    createdAt,
  };
}

const listQueue: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const open = deps.queue.listOpen(who.candidateId);
  const source = factSource(deps, who.candidateId);
  return {
    data: open.map((item) => toItem(deps, who, item, source)),
    meta: { requestId: request.id },
  };
};

const notFound = (request: FastifyRequest, reply: FastifyReply) =>
  sendError(reply, request, 404, 'manual_application_not_found', 'Отклик не найден.', false);

function openItem(
  deps: Bound,
  request: FastifyRequest,
  candidateId: string,
): StoredManualApply | null {
  const item = deps.queue.get(candidateId, (request.params as { id: string }).id);
  return item?.status === 'open' ? item : null;
}

const readItem: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const item = openItem(deps, request, who.candidateId);
  if (!item) return notFound(request, reply);
  return { data: toItem(deps, who, item), meta: { requestId: request.id } };
};

function vacancyFacts(
  cluster: VacancyCluster,
  reason: ManualApplyReason,
  host: string | undefined,
) {
  const route = preferredApplySource(cluster);
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
    url: manualApplyUrl(route.url) ?? '',
    source: route.source ?? cluster.sources[0]?.sourceType ?? '',
    reason,
    host: host?.toLowerCase() || manualApplyHost(route.url),
  };
}

/** Карточка отклика; после «Не откликаюсь» — возвращённая из архива. */
function savedApplication(
  deps: Bound,
  candidateId: string,
  vacancyId: string,
  facts: ReturnType<typeof vacancyFacts>,
  known: StoredManualApply | null,
) {
  const application = deps.candidateStore.createApplication(candidateId, {
    clusterId: vacancyId,
    stage: 'saved',
    draft: true,
    manualVacancy: snapshotWithDescription(deps.multiSourceEngine, vacancyId, {
      title: facts.title,
      company: facts.company,
      url: facts.url,
      source: facts.source,
    }),
  });
  // «Не откликаюсь» положил отклик в архив; снова нажали «Откликнуться» — он возвращается.
  return application.stage === 'archived' && known?.status === 'skipped'
    ? deps.candidateStore.restoreApplication(candidateId, application.id, application.version)
    : application;
}

const enqueue: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const parsed = enqueueSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_manual_application',
      'Проверьте вакансию.',
      false,
    );
  }
  if (deps.hh.vacancyInProgress(who.candidateId, parsed.data.vacancyId, new Date())) {
    return sendError(
      reply,
      request,
      409,
      'hh_apply_in_progress',
      'Отклик уже отправляется через hh.ru.',
      false,
    );
  }
  return enqueueVacancy(deps, request, reply, who, parsed.data);
};

async function enqueueVacancy(
  deps: Bound,
  request: FastifyRequest,
  reply: FastifyReply,
  who: Who,
  { vacancyId, reason, host }: z.infer<typeof enqueueSchema>,
) {
  const { candidateId } = who;
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster)
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const known = deps.queue.get(candidateId, vacancyId);
  const facts = vacancyFacts(cluster, reason, host);
  if (known?.status !== 'open' && deps.queue.listOpen(candidateId).length >= MAX_OPEN) {
    return sendError(
      reply,
      request,
      409,
      'manual_queue_full',
      'Сначала отправьте отклики из очереди.',
      false,
    );
  }
  const application = savedApplication(deps, candidateId, vacancyId, facts, known);
  if (application.stage !== 'saved') {
    return sendError(reply, request, 409, 'already_applied', 'Отклик уже отправлен.', false);
  }
  if (
    !known?.prepared &&
    !requireTariffQuota(deps, request, reply, candidateId, 'applications', vacancyId)
  ) {
    return reply;
  }
  // Прежние попытки кончились и единица квоты возвращена: эта постановка даёт новые.
  if (known && known.attempts > MAX_ATTEMPTS) deps.queue.resetAttempts(candidateId, vacancyId);
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
}

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
    hh: new SqliteHhSessionRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: key,
    }),
    queue: new SqliteManualApplyRepository(database, key),
    forms: new SqliteQuestionnaireRepository(database, key),
    writeLetter,
    inFlight: new Map(),
    isFlagged: (candidateId) => candidateFlagLookup(database, deps.config)(candidateId),
  };
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  startTick(app, bound);
  app.get(BASE, withDeps(bound, listQueue));
  app.post(BASE, write, withDeps(bound, enqueue));
  app.get(`${BASE}/:id`, withDeps(bound, readItem));
  app.post(`${BASE}/:id/sent`, write, withDeps(bound, markSent));
  app.post(`${BASE}/:id/skip`, write, withDeps(bound, skip));
  app.addHook('onClose', async () => {
    await Promise.allSettled(bound.inFlight.values());
    bound.hh.close();
  });
  return {
    async preparedPitch(candidateId, vacancyId) {
      await bound.inFlight.get(flightKey(candidateId, vacancyId));
      const pitch = bound.queue.get(candidateId, vacancyId)?.pitch ?? null;
      // Профиль изменился: письмо собирается заново, иначе «Пересобрать» вернула бы прежнее.
      return pitchProfile(pitch) === factSource(bound, candidateId).profileHash ? pitch : null;
    },
  };
}
