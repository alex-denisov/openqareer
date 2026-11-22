import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { recordingRuntimeFor } from '../recordings/recordingRuntime';
import { recordingTokenMatches } from '../recordings/recordingToken';

export const MAX_SEGMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['audio/mp4', 'audio/aac', 'audio/m4a']);

const intField = (max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(max));

const segmentFields = z.object({
  track: z.enum(['mic', 'system']),
  segment: intField(2_000),
  startedAt: z.string().max(40).datetime({ offset: true }),
  durationMs: intField(3_600_000),
});

interface ParsedUpload {
  readonly fields: Record<string, string>;
  readonly file: { readonly data: Buffer; readonly mimetype: string } | null;
}

async function readUpload(request: FastifyRequest): Promise<ParsedUpload> {
  const fields: Record<string, string> = {};
  let file: ParsedUpload['file'] = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      file = { data: await part.toBuffer(), mimetype: part.mimetype };
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, file };
}

function invalid(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return sendError(
    reply,
    request,
    400,
    'invalid_segment',
    'Сегмент записи не принят: проверьте поля и файл.',
    false,
  );
}

/** Сколько памяти занять под тело: объявленная длина, но не больше потолка сегмента. */
function reservedBytes(request: FastifyRequest): number {
  const declared = Number(request.headers['content-length']);
  return Number.isFinite(declared) && declared > 0
    ? Math.min(declared, MAX_SEGMENT_BYTES)
    : MAX_SEGMENT_BYTES;
}

/** Сегмент не записан: повтор того же (track, segment) позже пройдёт как новый. */
function busy(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  reply.header('Retry-After', '60');
  return sendError(reply, request, 503, 'recording_busy', 'Расшифровка занята, повторите.', true);
}

function uploadFailure(reply: FastifyReply, request: FastifyRequest, error: unknown): FastifyReply {
  const code = (error as { code?: string }).code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return sendError(reply, request, 413, 'segment_too_large', 'Сегмент больше 25 МБ.', false);
  }
  if (typeof code === 'string' && code.startsWith('FST_')) return invalid(reply, request);
  throw error;
}

async function handleSegment(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const recordingId = (request.params as { recordingId: string }).recordingId;
  const { repository, service } = recordingRuntimeFor(deps, request.log);
  const recording = repository.getById(recordingId);
  const presented = request.headers['x-recording-token'];
  if (
    !recording ||
    !recordingTokenMatches(recording, typeof presented === 'string' ? presented : undefined)
  ) {
    return sendError(
      reply,
      request,
      401,
      'recording_token_invalid',
      'Ключ записи недействителен.',
      false,
    );
  }
  if (!request.isMultipart()) return invalid(reply, request);
  // Память бронируется до чтения тела: без места — 503 сразу, тело не буферизуется.
  const release = service.reserve(reservedBytes(request));
  if (!release) return busy(reply, request);
  let upload: ParsedUpload;
  try {
    upload = await readUpload(request);
  } catch (error) {
    return uploadFailure(reply, request, error);
  } finally {
    release();
  }
  const fields = segmentFields.safeParse(upload.fields);
  if (!fields.success || !upload.file || !ALLOWED_TYPES.has(upload.file.mimetype)) {
    return invalid(reply, request);
  }
  const { track, segment, startedAt, durationMs } = fields.data;
  const isNew = repository.insertSegmentIfNew({
    recordingId,
    track,
    segment,
    startedAt,
    durationMs,
  });
  if (isNew) service.enqueue({ recordingId, track, segment, audio: upload.file.data });
  return reply.code(202).send({
    data: { recordingId, track, segment, status: 'accepted' },
    meta: { requestId: request.id },
  });
}

/** Приём сегмента по ключу записи, без сессии; multipart подключён только в этой области. */
export function registerRecordingSegmentRoute(app: FastifyInstance, deps: RouteDeps): void {
  void app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: MAX_SEGMENT_BYTES, files: 1, fields: 10 },
    });
    scope.post(
      '/api/v1/candidate/recordings/:recordingId/segments',
      {
        bodyLimit: MAX_SEGMENT_BYTES + 1024 * 1024,
        config: { rateLimit: { max: 600, timeWindow: '1 hour' } },
      },
      withDeps(deps, handleSegment),
    );
  });
}
