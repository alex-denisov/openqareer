import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GOAL_SETTERS, type CareerDiaryGoalCardInput } from '../../shared/careerDiaryCards';
import {
  KPI_FILE_MAX_BYTES,
  KPI_PHOTO_MIME_TYPES,
  KPI_ROWS_MAX,
  KPI_TABLE_MIME_TYPES,
  KPI_TEXT_MAX,
  kpiWeightSum,
  type CareerDiaryKpiAcceptRow,
  type CareerDiaryKpiSourceKind,
} from '../../shared/careerDiaryKpi';
import { CareerDiaryIdempotencyConflictError } from '../data/sqliteCareerDiaryRepository';
import type { SqliteKpiImportRepository } from '../data/sqliteKpiImportRepository';
import { groundKpiRows } from '../domain/kpiImport';
import { tableToText } from '../domain/kpiTable';
import type { KpiExtractInput } from '../providers/kpiExtractor';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B686: загрузка KPI → черновик на проверку → цели дневника. Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие. Исходник хранится
 * запечатанным и стирается по запросу; прежние маршруты дневника не меняются.
 */
export type KpiRouteDeps = RouteDeps & {
  readonly kpiImports: () => SqliteKpiImportRepository;
  readonly createCard: (candidate: string, input: CareerDiaryGoalCardInput, key: string) => string;
};
type Handler = (
  deps: KpiRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

const BASE = '/api/v1/candidate/career-diary/kpi-imports';
/** Разборов за сутки у одного кандидата: каждый — вызов модели. */
const IMPORTS_PER_DAY = 30;
const BODY_LIMIT = Math.ceil((KPI_FILE_MAX_BYTES * 4) / 3) + 64 * 1024;
const idSchema = z.string().uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  });
const fileSchema = z
  .object({
    kind: z.enum(['table', 'photo']),
    name: z.string().trim().min(1).max(200),
    mimeType: z.string().min(1).max(120),
    data: z.string().min(1).max(BODY_LIMIT),
  })
  .strict();
const importSchema = z.union([
  z.object({ kind: z.literal('text'), text: z.string().trim().min(1).max(KPI_TEXT_MAX) }).strict(),
  fileSchema,
]);
const acceptRowSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    unit: z.string().trim().max(80),
    targetValue: z.union([z.number().finite(), z.string().trim().min(1).max(120)]),
    dueDate: dateSchema,
    horizon: z.enum(['quarter', 'next_quarter', 'year']),
    weight: z.number().min(0).max(100).nullable(),
    setBy: z.enum(GOAL_SETTERS),
  })
  .strict();
const acceptSchema = z.object({ rows: z.array(acceptRowSchema).min(1).max(KPI_ROWS_MAX) }).strict();

const today = (): string => new Date().toISOString().slice(0, 10);

function invalid(reply: FastifyReply, request: FastifyRequest) {
  return sendError(
    reply,
    request,
    400,
    'invalid_kpi_import',
    'Проверьте загруженные данные.',
    false,
  );
}

function candidateId(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const SIGNATURES: Readonly<Record<string, (bytes: Uint8Array) => boolean>> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
};

interface Prepared {
  readonly kind: CareerDiaryKpiSourceKind;
  readonly name: string | null;
  readonly mimeType: string;
  readonly content: string;
  readonly extract: Omit<KpiExtractInput, 'today'>;
}

/** Текст для модели и исходник для хранения; `null` — файл не того вида или не читается. */
function prepare(input: z.infer<typeof importSchema>): Prepared | null {
  if (input.kind === 'text') {
    return {
      kind: 'text',
      name: null,
      mimeType: 'text/plain',
      content: input.text,
      extract: { text: input.text },
    };
  }
  const bytes = Uint8Array.from(Buffer.from(input.data, 'base64'));
  if (bytes.length === 0 || bytes.length > KPI_FILE_MAX_BYTES) return null;
  const base = {
    kind: input.kind,
    name: input.name,
    mimeType: input.mimeType,
    content: input.data,
  };
  if (input.kind === 'table') {
    if (!(KPI_TABLE_MIME_TYPES as readonly string[]).includes(input.mimeType)) return null;
    const text = tableToText(bytes, input.mimeType);
    return text ? { ...base, extract: { text } } : null;
  }
  const signature = SIGNATURES[input.mimeType];
  if (!(KPI_PHOTO_MIME_TYPES as readonly string[]).includes(input.mimeType) || !signature?.(bytes))
    return null;
  return { ...base, extract: { text: '', image: { mimeType: input.mimeType, data: bytes } } };
}

const fail = (
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  text: string,
  retry = false,
) => sendError(reply, request, status, code, text, retry);

/** Проверки до вызова модели; `null` — ответ с отказом уже отправлен. */
function admitImport(
  deps: KpiRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: string,
): Prepared | null {
  const parsed = importSchema.safeParse(request.body);
  if (!parsed.success) {
    invalid(reply, request);
    return null;
  }
  const prepared = prepare(parsed.data);
  if (!prepared) {
    fail(reply, request, 422, 'kpi_source_unreadable', 'Не получилось прочитать файл.');
    return null;
  }
  const since = new Date(Date.now() - 86_400_000).toISOString();
  if (!deps.kpiImports().takeAttempt(candidate, since, IMPORTS_PER_DAY)) {
    fail(
      reply,
      request,
      429,
      'kpi_import_daily_limit',
      'На сегодня разборов достаточно, продолжите завтра.',
    );
    return null;
  }
  return prepared;
}

const createImport: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const prepared = admitImport(deps, request, reply, candidate);
  if (!prepared) return undefined;
  const answer = deps.kpiExtractor
    ? await deps.kpiExtractor.extract({ ...prepared.extract, today: today() })
    : null;
  if (!answer)
    return fail(reply, request, 502, 'kpi_import_failed', 'Не получилось разобрать KPI.', true);
  const source = prepared.kind === 'photo' ? answer.sourceText : prepared.extract.text;
  const rows = groundKpiRows(answer.rows, source);
  if (rows.length === 0)
    return fail(reply, request, 422, 'kpi_rows_not_found', 'Не нашли показатели.');
  const created = deps.kpiImports().create(candidate, prepared.kind, prepared, rows);
  return reply.code(201).send({ data: created, meta: { requestId: request.id } });
};

function loadImport(
  deps: KpiRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: string,
) {
  const id = idSchema.safeParse((request.params as { id?: unknown }).id);
  const found = id.success ? deps.kpiImports().get(candidate, id.data) : null;
  if (!found) sendError(reply, request, 404, 'kpi_import_not_found', 'Загрузка не найдена.', false);
  return found;
}

const getImport: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const found = loadImport(deps, request, reply, candidate);
  return found ? { data: found, meta: { requestId: request.id } } : undefined;
};

function cardInput(row: CareerDiaryKpiAcceptRow): CareerDiaryGoalCardInput {
  const start = today();
  return {
    title: row.title,
    horizon: row.horizon,
    startDate: start < row.dueDate ? start : row.dueDate,
    dueDate: row.dueDate,
    setBy: row.setBy,
    weight: row.weight,
    indicators: [
      { title: row.title, unit: row.unit, baselineValue: null, targetValue: row.targetValue },
    ],
  };
}

const acceptImport: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const found = loadImport(deps, request, reply, candidate);
  if (!found) return undefined;
  if (found.acceptedGoalIds.length > 0) {
    return { data: { goalIds: found.acceptedGoalIds }, meta: { requestId: request.id } };
  }
  const parsed = acceptSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const sum = kpiWeightSum(parsed.data.rows);
  if (sum !== null && Math.abs(sum - 100) > 0.5) {
    return sendError(
      reply,
      request,
      422,
      'kpi_weight_sum',
      `Вес в сумме — ${sum} %, нужно 100 %.`,
      false,
    );
  }
  let goalIds: string[];
  try {
    goalIds = parsed.data.rows.map((row, index) =>
      deps.createCard(candidate, cardInput(row), kpiGoalId(found.id, index)),
    );
  } catch (error) {
    if (!(error instanceof CareerDiaryIdempotencyConflictError)) throw error;
    return fail(reply, request, 409, 'kpi_import_accepting', 'Показатели уже принимаются.');
  }
  deps.kpiImports().markAccepted(candidate, found.id, goalIds);
  return reply.code(201).send({ data: { goalIds }, meta: { requestId: request.id } });
};

/**
 * id цели из строки KPI: один и тот же на повторное «Принять» (идемпотентность) и в виде uuid,
 * который ждут маршруты замеров и удаления. Прежний `kpi:<импорт>:<n>` они отклоняли (прод 22.11).
 */
function kpiGoalId(importId: string, index: number): string {
  const hex = createHash('sha256').update(`kpi:${importId}:${index}`).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const deleteSource: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const found = loadImport(deps, request, reply, candidate);
  if (!found) return undefined;
  deps.kpiImports().deleteSource(candidate, found.id);
  return { data: deps.kpiImports().get(candidate, found.id), meta: { requestId: request.id } };
};

export function registerCareerDiaryKpiRoutes(app: FastifyInstance, deps: KpiRouteDeps): void {
  const read = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  const upload = {
    bodyLimit: BODY_LIMIT,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  };
  app.post(BASE, upload, withDeps(deps, createImport));
  app.get(`${BASE}/:id`, read, withDeps(deps, getImport));
  app.post(`${BASE}/:id/accept`, write, withDeps(deps, acceptImport));
  app.delete(`${BASE}/:id/source`, write, withDeps(deps, deleteSource));
}
