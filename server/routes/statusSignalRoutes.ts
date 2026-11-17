import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_CANDIDATE_STATUS } from '../../shared/candidateStatus';
import { ROLE_TAXONOMY } from '../../shared/roleTaxonomy';
import { STATUS_SIGNAL_ANSWERS, STATUS_SIGNAL_KINDS } from '../../shared/statusSignal';
import { DEFAULT_ACCOUNT_TIMEZONE, isValidTimezone } from '../../shared/timezoneUtils';
import type { SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import { SqliteStatusSignalRepository } from '../candidate/sqliteStatusSignalRepository';
import {
  answerStatusSignal,
  readStatusSignal,
  SignalNotActiveError,
  SignalUndoUnavailableError,
  undoStatusSignalAnswer,
  type StatusSignalDeps,
  type StatusSignalSources,
} from '../candidate/statusSignalService';
import type { ApplicationView } from '../domain/applicationDerivedFields';
import type { SignalApplication } from '../domain/statusSignals';
import { candidateRoleFunctionCodes } from '../vacancies/titleParse/candidateRoleFunctions';
import { rulesParse } from '../vacancies/titleParse/rulesParse';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { targetRolesOf } from './roleSkillDemandRoutes';

/**
 * B691: сигналы «Сегодня» для кабинета B640. Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие.
 * Сигнал считается на запросе кандидата; фоновых задач нет.
 */
export type StatusSignalRouteDeps = RouteDeps & {
  readonly statusRepository: Pick<SqliteCandidateStatusRepository, 'current'>;
  /** Отклики, отправленные автооткликом: их сигнал не считает своими. */
  readonly autoAppliedApplicationIds?: (candidateId: string) => ReadonlySet<string>;
  readonly statusSignalRepository?: SqliteStatusSignalRepository;
};

type BoundDeps = RouteDeps & { readonly signals: StatusSignalDeps };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const SKIP_REASON_ROLE_FAMILY = 'role-family';
const DAY_MS = 86_400_000;
/** Самое длинное окно расчёта — 37 дней (неделя и месяц до неё); старше отклики не нужны. */
const SIGNAL_LOOKBACK_DAYS = 40;
/** Потолок работы на один запрос: разбор названия идёт по каждому отклику. */
const MAX_SIGNAL_APPLICATIONS = 500;
const FUNCTION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ROLE_TAXONOMY.map((entry) => [entry.code, entry.labelRu]),
);

const answerSchema = z
  .object({ kind: z.enum(STATUS_SIGNAL_KINDS), answer: z.enum(STATUS_SIGNAL_ANSWERS) })
  .strict();

function functionCodeOf(title: string | undefined): string | null {
  if (!title?.trim()) return null;
  const [code] = rulesParse(title).functions;
  return code && code !== 'other' ? code : null;
}

/** Отклик отправляли: вакансия не просто сохранена и не убрана в архив без отклика. */
function wasApplied(view: ApplicationView): boolean {
  if (view.stage === 'saved') return false;
  return view.stage !== 'archived' || (view.reachedStages?.includes('applied') ?? false);
}

function latestTouch(view: ApplicationView): number {
  return Math.max(
    ...[view.createdAt, view.stageChangedAt, view.appliedAt].map((value) =>
      typeof value === 'string' ? Date.parse(value) || 0 : 0,
    ),
  );
}

/** Отклик или сохранённая вакансия в виде довода для расчёта сигнала. */
export function signalApplicationOf(
  view: ApplicationView,
  autoApplied: ReadonlySet<string>,
): SignalApplication {
  return {
    id: view.id,
    vacancyKey: view.clusterId ?? view.id,
    functionCode: functionCodeOf(view.vacancy?.title),
    stage: view.stage,
    createdAt: view.createdAt,
    appliedAt: wasApplied(view) ? (view.appliedAt ?? null) : null,
    stageChangedAt: view.stageChangedAt,
    automatic: autoApplied.has(view.id),
  };
}

function sourcesOf(deps: StatusSignalRouteDeps): StatusSignalSources {
  return {
    applications: (candidateId) => {
      const autoApplied = deps.autoAppliedApplicationIds?.(candidateId) ?? new Set<string>();
      const since = Date.now() - SIGNAL_LOOKBACK_DAYS * DAY_MS;
      return deps.candidateStore
        .listApplications(candidateId)
        .filter((view) => latestTouch(view) >= since)
        .sort((a, b) => latestTouch(b) - latestTouch(a))
        .slice(0, MAX_SIGNAL_APPLICATIONS)
        .map((view) => signalApplicationOf(view, autoApplied));
    },
    roleFamilySkips: (candidateId) =>
      deps.candidateStore
        .listVacancySkips(candidateId)
        .filter((skip) => skip.reasonId === SKIP_REASON_ROLE_FAMILY)
        .map((skip) => skip.createdAt),
    targetFunctions: (candidateId) => candidateRoleFunctionCodes(targetRolesOf(deps, candidateId)),
    functionLabels: FUNCTION_LABELS,
  };
}

interface Signed {
  readonly candidateId: string;
  readonly timezone: string;
}

function signedIn(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): Signed | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  const timezone = deps.authService.getUser?.(principal.userId)?.timezone;
  return {
    candidateId: principal.candidate.id,
    timezone: timezone && isValidTimezone(timezone) ? timezone : DEFAULT_ACCOUNT_TIMEZONE,
  };
}

const getSignal: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  const state = readStatusSignal(deps.signals, signed.candidateId, new Date(), signed.timezone);
  return { data: state, meta: { requestId: request.id } };
};

const answerSignal: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  const parsed = answerSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_status_signal_answer',
      'Выберите один из ответов: «Верно», «Нет» или «Не сейчас».',
      false,
    );
  }
  try {
    const state = answerStatusSignal(deps.signals, {
      candidateId: signed.candidateId,
      kind: parsed.data.kind,
      answer: parsed.data.answer,
      now: new Date(),
      timezone: signed.timezone,
    });
    return { data: state, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof SignalNotActiveError) {
      return sendError(reply, request, 409, 'status_signal_not_active', error.message, false);
    }
    throw error;
  }
};

const undoAnswer: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  try {
    const state = undoStatusSignalAnswer(
      deps.signals,
      signed.candidateId,
      new Date(),
      signed.timezone,
    );
    return { data: state, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof SignalUndoUnavailableError) {
      return sendError(reply, request, 409, 'status_signal_undo_unavailable', error.message, false);
    }
    throw error;
  }
};

export function registerStatusSignalRoutes(
  app: FastifyInstance,
  deps: StatusSignalRouteDeps,
): void {
  const answers =
    deps.statusSignalRepository ??
    new SqliteStatusSignalRepository({ databasePath: deps.config.databasePath });
  if (!deps.statusSignalRepository) app.addHook('onClose', async () => answers.close());
  const bound: BoundDeps = {
    ...deps,
    signals: {
      answers,
      currentStatus: (candidateId) => {
        const current = deps.statusRepository.current(candidateId);
        return {
          status: current?.status ?? DEFAULT_CANDIDATE_STATUS,
          since: current?.createdAt ?? null,
        };
      },
      sources: sourcesOf(deps),
    },
  };
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const read = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  app.get('/api/v1/candidate/status/signal', read, withDeps(bound, getSignal));
  app.post('/api/v1/candidate/status/signal/answer', write, withDeps(bound, answerSignal));
  app.post('/api/v1/candidate/status/signal/answer/undo', write, withDeps(bound, undoAnswer));
}
