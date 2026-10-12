import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CandidateAutomationDispatch } from '../candidate/candidateAutomationDispatch';
import {
  validateCandidateAutomationSchedule,
  type CandidateAutomationSchedule,
} from '../candidate/candidateAutomationScheduler';
import type { SqliteCandidateAutomationRepository } from '../candidate/sqliteCandidateAutomationRepository';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';

type ScheduleDeps = RouteDeps & {
  readonly automationRepository: SqliteCandidateAutomationRepository;
};
type Candidate = ReturnType<typeof authenticateCandidate>;

const windowSchema = z
  .object({
    start: z.string().regex(/^\d{2}:\d{2}$/u),
    end: z.string().regex(/^\d{2}:\d{2}$/u),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  })
  .strict();
const scheduleSchema = z
  .object({
    timezone: z.string().trim().min(1).max(64),
    dailyLimits: z
      .object({ hh: z.number().int().min(1).max(100), linkedin: z.number().int().min(1).max(100) })
      .strict(),
    minPauseMinutes: z.number().int().min(1).max(60),
    maxPauseMinutes: z.number().int().min(1).max(60),
    sendWindows: z.object({ hh: windowSchema, linkedin: windowSchema }).strict(),
    quietWindows: z.array(windowSchema).max(8),
    excludedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)).max(100),
    breakAfterSent: z.number().int().min(1).max(20),
    breakMinutes: z.number().int().min(30).max(240),
    stopAfterErrors: z.literal(1),
  })
  .strict();
const journalQuerySchema = z
  .object({
    result: z.enum(['delivered', 'error', 'removed']).optional(),
    platform: z.enum(['hh', 'linkedin']).optional(),
    periodDays: z.coerce.number().int().min(1).max(30).default(30),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export function registerCandidateAutomationScheduleRoutes(
  app: FastifyInstance,
  deps: ScheduleDeps,
): void {
  app.get('/api/v1/candidate/automation/schedule', async (request, reply) =>
    getSchedule(deps, request, reply),
  );
  app.put('/api/v1/candidate/automation/schedule', async (request, reply) =>
    saveSchedule(deps, request, reply),
  );
  app.post('/api/v1/candidate/automation/emergency-pause', async (request, reply) =>
    emergencyPause(deps, request, reply),
  );
  app.post(
    '/api/v1/candidate/automation/dispatch',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => dispatchDueItem(deps, request, reply),
  );
  app.get('/api/v1/candidate/automation/journal', async (request, reply) =>
    getJournal(deps, request, reply),
  );
  app.get(
    '/api/v1/candidate/automation/journal/export',
    {
      config: { rateLimit: { max: 4, timeWindow: '1 minute' } },
    },
    async (request, reply) => exportJournal(deps, request, reply),
  );
}

async function getSchedule(
  deps: ScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const runtime = deps.automationRepository.schedulerRepository.getRuntime(candidate.id);
  return reply.send({
    data: {
      schedule: deps.automationRepository.schedulerRepository.getSchedule(candidate.id),
      runtime,
      stateLabel: stateLabel(runtime.status, runtime.lastFailureCode),
    },
  });
}

async function saveSchedule(
  deps: ScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = scheduleSchema.safeParse(request.body);
  if (
    !parsed.success ||
    !validateCandidateAutomationSchedule(parsed.data as CandidateAutomationSchedule).valid
  ) {
    return sendError(
      reply,
      request,
      400,
      'invalid_automation_schedule',
      'Проверьте лимиты, паузы и окна отправки.',
      false,
    );
  }
  const now = new Date().toISOString();
  const schedule = deps.automationRepository.schedulerRepository.saveSchedule(
    candidate.id,
    parsed.data as CandidateAutomationSchedule,
    now,
  );
  const runtime = deps.automationRepository.schedulerRepository.getRuntime(candidate.id);
  if (!runtime.emergencyPaused) {
    deps.automationRepository.schedulerRepository.setRuntime(
      candidate.id,
      {
        nextSendAt: now,
        pauseUntil: null,
        status: 'ready',
        consecutiveErrors: 0,
        lastFailureCode: null,
      },
      now,
    );
  }
  return reply.send({
    data: {
      schedule,
      runtime: deps.automationRepository.schedulerRepository.getRuntime(candidate.id),
    },
  });
}

async function emergencyPause(
  deps: ScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const now = new Date().toISOString();
  const runtime = deps.automationRepository.schedulerRepository.setEmergencyPause(
    candidate.id,
    true,
    now,
  );
  deps.candidateActionRepository?.setKillSwitch(`candidate:${candidate.id}`, true, 'manual_pause');
  return reply.send({ data: { runtime, stateLabel: 'Пауза' } });
}

async function dispatchDueItem(
  deps: ScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  if (!deps.candidateActionExecutor) {
    return sendError(
      reply,
      request,
      503,
      'runner_not_connected',
      'Исполнитель доступен только на устройстве кандидата.',
      false,
    );
  }
  try {
    const dispatch = new CandidateAutomationDispatch({
      repository: deps.automationRepository,
      executor: deps.candidateActionExecutor,
    });
    return reply.send({ data: await dispatch.runCandidate(candidate.id) });
  } catch (error: unknown) {
    request.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'candidate-automation-dispatch-failed',
    );
    return sendError(
      reply,
      request,
      500,
      'automation_dispatch_failed',
      'Не удалось обработать расписание.',
      false,
    );
  }
}

async function getJournal(
  deps: ScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = journalQuerySchema.safeParse(request.query);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_automation_journal_filter',
      'Проверьте фильтры журнала.',
      false,
    );
  const { result, platform, periodDays, limit, offset } = parsed.data;
  const repository = deps.automationRepository.schedulerRepository;
  const now = new Date().toISOString();
  const entries = repository.listJournal(candidate.id, {
    result,
    platform,
    periodDays,
    limit,
    offset,
    now,
  });
  return reply.send({
    data: { entries, periodDays, counts: repository.journalCounts(candidate.id, now) },
  });
}

async function exportJournal(
  deps: ScheduleDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const entries = deps.automationRepository.schedulerRepository.listJournal(candidate.id, {
    periodDays: 30,
    limit: 5_000,
  });
  const csv = [
    'Время,Компания,Канал,Результат,Квитанция,Код ошибки',
    ...entries.map((entry) =>
      [
        entry.occurredAt,
        entry.company,
        channelLabel(entry.platform),
        resultLabel(entry.result),
        entry.receiptId ?? '',
        entry.failureCode ?? '',
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', 'attachment; filename="automation-journal.csv"')
    .send(`\uFEFF${csv}`);
}

function authenticate(deps: ScheduleDeps, request: FastifyRequest, reply: FastifyReply): Candidate {
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function stateLabel(status: string, failureCode: string | null): string {
  if (failureCode === 'actions_on_behalf_consent_required') {
    return 'Требуется согласие на действия от вашего имени';
  }
  if (failureCode === 'automation_consent_required') return 'Требуется согласие на автоотклики';
  if (failureCode === 'approval_no_longer_current') return 'Требуется новое одобрение';
  if (status === 'daily_limit_reached') return 'Лимит дня достигнут';
  if (status === 'linkedin_not_connected') return 'LinkedIn не подключён';
  if (status === 'paused') return 'Пауза';
  if (status === 'error') return 'Ошибка отправки';
  return status === 'prepared' ? 'Подготовлено' : 'По расписанию';
}

function channelLabel(platform: string): string {
  return platform === 'hh' ? 'hh.ru' : 'LinkedIn';
}
function resultLabel(result: string): string {
  if (result === 'delivered') return 'Доставлено';
  if (result === 'removed') return 'Снято вами';
  return 'Ошибка';
}

function csvCell(value: string): string {
  const first = value.trimStart()[0];
  const safe = first && ['=', '+', '-', '@'].includes(first) ? `'${value}` : value;
  return `"${safe.replace(/"/gu, '""')}"`;
}
