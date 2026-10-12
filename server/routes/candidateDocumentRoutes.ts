import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CandidateDocumentRetentionError } from '../data/sqliteCandidateStore';
import { buildDocumentTextPage } from '../data/documentTextPage';
import {
  CandidateDocumentValidationError,
  CandidateDocumentVersionError,
} from '../data/sqliteDocumentRepository';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  encodeHeaderFileName,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import {
  candidateDocumentSchema,
  documentPartSchema,
  documentRetentionSchema,
  documentTextQuerySchema,
} from './schemas';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const handleDocumentPart: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, uploadStaging } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = documentPartSchema.parse(request.body);
  try {
    const state = uploadStaging.accept(candidate.id, body);
    return { data: state, meta: { requestId: request.id } };
  } catch (error) {
    return sendError(
      reply,
      request,
      400,
      'document_upload_part_rejected',
      error instanceof Error ? error.message : 'Часть файла не принята.',
      false,
    );
  }
};

const handleSaveDocument: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, uploadStaging } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = candidateDocumentSchema.parse(request.body);
  const contentBase64 = body.uploadId
    ? uploadStaging.take(candidate.id, body.uploadId)
    : body.contentBase64;
  if (!contentBase64) {
    return sendError(
      reply,
      request,
      409,
      'document_upload_incomplete',
      'Загрузка не собрана: часть файла не дошла. Повторите отправку.',
      true,
    );
  }
  try {
    const stored = candidateStore.saveDocument(candidate.id, { ...body, contentBase64 });
    return reply.code(stored.created ? 201 : 200).send({
      data: stored,
      meta: { requestId: request.id },
    });
  } catch (error) {
    if (error instanceof CandidateDocumentValidationError) {
      return sendError(
        reply,
        request,
        400,
        'document_invalid',
        'Файл не прошёл проверку формата или размера.',
        false,
      );
    }
    if (error instanceof CandidateDocumentVersionError) {
      return sendError(
        reply,
        request,
        409,
        'document_version_conflict',
        'Предыдущая версия документа недоступна.',
        false,
      );
    }
    throw error;
  }
};

function loadCandidateDocument(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return null;
  const documentId = z
    .string()
    .uuid()
    .parse((request.params as { documentId: string }).documentId);
  const document = candidateStore.getDocument(candidate.id, documentId);
  if (!document) {
    sendError(reply, request, 404, 'document_not_found', 'Документ не найден.', false);
    return null;
  }
  return document;
}

const handleGetDocument: Handler = async (deps, request, _reply) => {
  const document = loadCandidateDocument(deps, request, _reply);
  if (!document) return undefined;
  // Целиком запись до клиента не доезжает: маршрут рвал ответ на 20 469 байтах
  // и обрывал `extractedText` на середине строки (INC-034). Карточка везёт
  // поля документа и длину текста; байты файла отдаёт `/download`, а текст —
  // своя страница.
  const { contentBase64, extractedText, ...card } = document;
  return {
    data: { ...card, textLength: extractedText?.length ?? 0 },
    meta: { requestId: request.id },
  };
};

const handleGetDocumentText: Handler = async (deps, request, reply) => {
  const document = loadCandidateDocument(deps, request, reply);
  if (!document) return undefined;
  const { offset } = documentTextQuerySchema.parse(request.query ?? {});
  // Reserve the exact worst-case JSON envelope, including request id and offsets.
  const text = document.extractedText ?? '';
  const envelopeBytes =
    Buffer.byteLength(
      JSON.stringify({
        data: { text: '' },
        meta: { requestId: request.id, offset, nextOffset: text.length, length: text.length },
      }),
      'utf8',
    ) + 4; // null may be wider than a short numeric nextOffset
  const page = buildDocumentTextPage(text, offset, 12_288 - envelopeBytes);
  return {
    data: { text: page.text },
    meta: {
      requestId: request.id,
      offset: page.offset,
      nextOffset: page.nextOffset,
      length: page.length,
    },
  };
};

const handleDownloadDocument: Handler = async (deps, request, reply) => {
  const document = loadCandidateDocument(deps, request, reply);
  if (!document) return undefined;
  reply.header('Cache-Control', 'private, no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header(
    'Content-Disposition',
    `attachment; filename="openqareer-document"; filename*=UTF-8''${encodeHeaderFileName(document.fileName)}`,
  );
  return reply.type(document.mimeType).send(Buffer.from(document.contentBase64, 'base64'));
};

const handleSetRetention: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const documentId = z
    .string()
    .uuid()
    .parse((request.params as { documentId: string }).documentId);
  const body = documentRetentionSchema.parse(request.body);
  try {
    const document = candidateStore.setDocumentRetention(
      candidate.id,
      documentId,
      body.retentionUntil,
      new Date().toISOString(),
    );
    if (!document) {
      return sendError(reply, request, 404, 'document_not_found', 'Документ не найден.', false);
    }
    return { data: document, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof CandidateDocumentRetentionError) {
      return sendError(
        reply,
        request,
        422,
        'document_retention_invalid',
        'Срок хранения должен быть в будущем и не дальше десяти лет.',
        false,
      );
    }
    throw error;
  }
};

const handleDeleteDocument: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const documentId = z
    .string()
    .uuid()
    .parse((request.params as { documentId: string }).documentId);
  if (!candidateStore.deleteDocument(candidate.id, documentId)) {
    return sendError(reply, request, 404, 'document_not_found', 'Документ не найден.', false);
  }
  return reply.code(204).send();
};

export function registerCandidateDocumentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/documents/parts',
    {
      bodyLimit: 64 * 1_024,
      config: { rateLimit: { max: 2_000, timeWindow: '1 hour' } },
    },
    withDeps(deps, handleDocumentPart),
  );
  app.post(
    '/api/v1/candidate/documents',
    {
      bodyLimit: 8 * 1_024 * 1_024,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    withDeps(deps, handleSaveDocument),
  );
  app.get('/api/v1/candidate/documents/:documentId', withDeps(deps, handleGetDocument));
  app.get('/api/v1/candidate/documents/:documentId/text', withDeps(deps, handleGetDocumentText));
  app.get(
    '/api/v1/candidate/documents/:documentId/download',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    withDeps(deps, handleDownloadDocument),
  );
  app.patch(
    '/api/v1/candidate/documents/:documentId/retention',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleSetRetention),
  );
  app.delete('/api/v1/candidate/documents/:documentId', withDeps(deps, handleDeleteDocument));
}
