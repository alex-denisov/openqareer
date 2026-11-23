import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  INCOME_MAX_RUBLES,
  readProfileIncome,
  saveProfileIncome,
  type ProfileIncomeDeps,
} from '../candidate/profileIncomeService';
import {
  LinkedinPhotoMissingError,
  ProfileMissingError,
  removeProfilePhoto,
  setProfilePhoto,
  takeLinkedinPhoto,
  type ProfilePhotoDeps,
} from '../candidate/profilePhotoService';
import { SqliteResumePhotoRepository } from '../candidate/sqliteResumePhotoRepository';
import { SqliteCandidateIncomeRepository } from '../candidate/sqliteCandidateIncomeRepository';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { SqliteCandidateMediaRepository } from '../data/sqliteCandidateMediaRepository';
import { PHOTO_MAX_BYTES, ProfilePhotoError } from '../domain/profilePhoto';
import {
  ProfileChangeConflictError,
  ProfileChangeNotFoundError,
  ProfileChangeNotRevertedError,
  reapplyProfileChange,
} from '../orchestration/profileHistory';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B666 и B673: своё фото профиля, нынешний доход и ожидания, повторное
 * применение отменённой правки. Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие.
 */
type BoundDeps = RouteDeps & {
  readonly photo: ProfilePhotoDeps;
  readonly income: ProfileIncomeDeps;
  readonly resumePhoto: SqliteResumePhotoRepository;
};
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** base64 длиннее исходника на треть; запас — на обёртку JSON. */
const PHOTO_BODY_LIMIT = Math.ceil(PHOTO_MAX_BYTES * 1.4) + 1_024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

const photoSchema = z.object({ contentBase64: z.string().min(1).max(PHOTO_BODY_LIMIT) }).strict();
const amountSchema = z.number().int().min(1).max(INCOME_MAX_RUBLES).nullable();
const incomeSchema = z.object({ current: amountSchema, expected: amountSchema }).strict();
const resumePhotoSchema = z.object({ inResume: z.boolean() }).strict();
const changeParams = z.object({ changeId: z.string().trim().min(1).max(120) });

function candidateIdOf(
  deps: BoundDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

/**
 * Разбор фото идёт в общем потоке сервера, а общий лимит запросов вошедших не
 * касается, поэтому загрузки считаем по кандидату: не больше десяти в час.
 */
const UPLOADS_PER_HOUR = 10;
const HOUR_MS = 3_600_000;
const MAX_TRACKED_CANDIDATES = 10_000;
const uploadTimes = new Map<string, number[]>();

function uploadAllowed(candidateId: string, now: number): boolean {
  const recent = (uploadTimes.get(candidateId) ?? []).filter((at) => now - at < HOUR_MS);
  if (recent.length >= UPLOADS_PER_HOUR) {
    uploadTimes.set(candidateId, recent);
    return false;
  }
  if (!uploadTimes.has(candidateId) && uploadTimes.size >= MAX_TRACKED_CANDIDATES) {
    uploadTimes.clear();
  }
  uploadTimes.set(candidateId, [...recent, now]);
  return true;
}

/** Только для тестов: счётчик загрузок живёт в памяти процесса. */
export function resetPhotoUploadCounter(): void {
  uploadTimes.clear();
}

/** Байты файла из тела запроса; `null` — это не base64. Имя и тип от клиента не принимаем. */
function fileBytes(body: unknown): Buffer | null {
  const parsed = photoSchema.safeParse(body ?? {});
  if (!parsed.success) return null;
  const text = parsed.data.contentBase64;
  if (text.length % 4 !== 0 || !BASE64.test(text)) return null;
  return Buffer.from(text, 'base64');
}

const putPhoto: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  if (!uploadAllowed(candidateId, Date.now())) {
    return sendError(
      reply,
      request,
      429,
      'photo_rate_limited',
      'Слишком много загрузок фото. Попробуйте через час.',
      true,
    );
  }
  const file = fileBytes(request.body);
  if (!file) {
    return sendError(
      reply,
      request,
      400,
      'photo_format',
      new ProfilePhotoError('photo_format').message,
      false,
    );
  }
  try {
    const result = setProfilePhoto(deps.photo, candidateId, file, new Date());
    return { data: result, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof ProfilePhotoError) {
      const status = error.code === 'photo_too_large' ? 413 : 400;
      return sendError(reply, request, status, error.code, error.message, false);
    }
    if (error instanceof ProfileMissingError) {
      return sendError(reply, request, 409, 'profile_missing', error.message, false);
    }
    throw error;
  }
};

const deletePhoto: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  const result = removeProfilePhoto(deps.photo, candidateId, new Date());
  return { data: result, meta: { requestId: request.id } };
};

const takeLinkedin: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  try {
    const result = takeLinkedinPhoto(deps.photo, candidateId, new Date());
    return { data: result, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof LinkedinPhotoMissingError) {
      return sendError(reply, request, 409, 'linkedin_photo_missing', error.message, false);
    }
    throw error;
  }
};

const getResumePhoto: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  reply.header('Cache-Control', 'no-store');
  const inResume = deps.resumePhoto.inResume(candidateId);
  return { data: { inResume }, meta: { requestId: request.id } };
};

const putResumePhoto: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = resumePhotoSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_resume_photo', 'Не удалось сохранить.', false);
  }
  const now = new Date().toISOString();
  const inResume = deps.resumePhoto.setInResume(candidateId, parsed.data.inResume, now);
  return { data: { inResume }, meta: { requestId: request.id } };
};

const getIncome: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  reply.header('Cache-Control', 'no-store');
  return { data: readProfileIncome(deps.income, candidateId), meta: { requestId: request.id } };
};

const putIncome: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = incomeSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_income',
      'Укажите сумму в рублях целым числом.',
      false,
    );
  }
  reply.header('Cache-Control', 'no-store');
  const stored = saveProfileIncome(deps.income, candidateId, parsed.data, new Date());
  return { data: stored, meta: { requestId: request.id } };
};

const reapplyChange: Handler = async (deps, request, reply) => {
  const candidateId = candidateIdOf(deps, request, reply);
  if (!candidateId) return reply;
  const params = changeParams.safeParse(request.params);
  if (!params.success) {
    return sendError(
      reply,
      request,
      404,
      'profile_change_not_found',
      new ProfileChangeNotFoundError().message,
      false,
    );
  }
  try {
    reapplyProfileChange(deps.candidateStore, candidateId, params.data.changeId);
  } catch (error) {
    if (error instanceof ProfileChangeNotFoundError) {
      return sendError(reply, request, 404, 'profile_change_not_found', error.message, false);
    }
    if (error instanceof ProfileChangeNotRevertedError) {
      return sendError(reply, request, 409, 'profile_change_not_reverted', error.message, false);
    }
    if (error instanceof ProfileChangeConflictError) {
      return sendError(
        reply,
        request,
        409,
        'profile_change_conflict',
        'С тех пор это место изменилось. Вернуть правку нельзя.',
        false,
      );
    }
    throw error;
  }
  return { data: { reapplied: true }, meta: { requestId: request.id } };
};

export function registerProfileB640Routes(app: FastifyInstance, deps: RouteDeps): void {
  const database = new DatabaseSync(deps.config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applySqliteBusyTimeout(database);
  const media = new SqliteCandidateMediaRepository(
    database,
    new SealedText(deps.config.dataEncryptionKey),
  );
  const income = new SqliteCandidateIncomeRepository(database, deps.config.dataEncryptionKey);
  app.addHook('onClose', async () => database.close());
  const bound: BoundDeps = {
    ...deps,
    photo: { media, store: deps.candidateStore },
    income: { income, changeLog: deps.candidateStore.profileChangeLog },
    resumePhoto: new SqliteResumePhotoRepository(database),
  };
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const upload = {
    bodyLimit: PHOTO_BODY_LIMIT,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  };
  app.put('/api/v1/candidate/profile/photo', upload, withDeps(bound, putPhoto));
  app.delete('/api/v1/candidate/profile/photo', write, withDeps(bound, deletePhoto));
  app.post('/api/v1/candidate/profile/photo/linkedin', write, withDeps(bound, takeLinkedin));
  app.get('/api/v1/candidate/profile/photo/resume', withDeps(bound, getResumePhoto));
  app.put('/api/v1/candidate/profile/photo/resume', write, withDeps(bound, putResumePhoto));
  app.get('/api/v1/candidate/profile/income', withDeps(bound, getIncome));
  app.put('/api/v1/candidate/profile/income', write, withDeps(bound, putIncome));
  app.post(
    '/api/v1/candidate/profile/history/:changeId/reapply',
    write,
    withDeps(bound, reapplyChange),
  );
}
