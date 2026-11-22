import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  B640_CONTACT_MESSAGE_EDIT_MAX,
  B640_CONTACT_MESSAGE_KINDS,
  B640_CONTACT_MESSAGE_LIST_MAX,
  type B640ContactMessage,
  type B640ContactMessageApproval,
  type B640ContactMessageSent,
  type B640SentContactMessage,
} from '../../shared/b640ContactMessage';
import { SqliteContactMessageRepository, type StoredContactMessage } from '../data/sqliteContactMessageRepository';
import { SqliteContactStatusRepository } from '../data/sqliteContactStatusRepository';
import { linkedinOpenUrl } from '../domain/b640ContactMessage';
import { sessionCandidate } from './b640VacancyContext';
import { writeContactMessageText, type MessageRecipient } from './b640ContactMessageText';
import { requireCabinetB640 } from './cabinetB640Flag';
import { connectionRecords, connectionRepository, readConnectionMetadata } from './candidateConnectionRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { requireTariffQuota } from './tariffQuotaGuard';

const BASE = '/api/v1/candidate/b640/contact-messages';
const idSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/u);
/** Id кластера вакансии: у источников с префиксом есть двоеточие (`cluster-src-hh-search:137412812`). */
const vacancyIdSchema = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9_:.-]+$/u);
const createSchema = z
  .object({
    contactId: idSchema.optional(),
    recruiterId: idSchema.optional(),
    vacancyId: vacancyIdSchema.optional(),
    kind: z.enum(B640_CONTACT_MESSAGE_KINDS),
  })
  .strict()
  .refine((body) => (body.contactId === undefined) !== (body.recruiterId === undefined));
const editSchema = z.object({ text: z.string().trim().min(1).max(B640_CONTACT_MESSAGE_EDIT_MAX) }).strict();
const listSchema = z.object({ contactId: idSchema });
const sentSchema = z.object({ vacancyId: vacancyIdSchema });

interface Stores {
  readonly messages: SqliteContactMessageRepository;
  readonly statuses: SqliteContactStatusRepository;
}

const shown = (message: StoredContactMessage): B640ContactMessage => ({
  id: message.id,
  kind: message.kind,
  text: message.text,
  recipient: { name: message.recipientName, linkedinUrl: message.recipientUrl },
  createdAt: message.createdAt,
});

function session(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  return principal ? sessionCandidate(request, reply, principal.candidate) : null;
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  return sendError(reply, request, 404, 'message_not_found', 'Сообщение не найдено.', false);
}

function findRecipient(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  body: z.infer<typeof createSchema>,
): MessageRecipient | null {
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return null;
  if (body.contactId) {
    const record = connectionRecords(repository, candidateId).find(
      (item) => readConnectionMetadata(item)?.contactId === body.contactId,
    );
    const meta = record && readConnectionMetadata(record);
    return record && meta
      ? { contactId: meta.contactId, recruiterId: null, name: record.fullName, company: record.companyName,
          linkedinUrl: record.linkedinUrl, relationship: meta.relationship }
      : notFoundRecipient(request, reply);
  }
  const record = body.vacancyId
    ? repository.getContactsByVacancyId(candidateId, body.vacancyId).find((item) => item.id === body.recruiterId)
    : undefined;
  return record
    ? { contactId: null, recruiterId: record.id, name: record.fullName, company: record.companyName,
        linkedinUrl: record.linkedinUrl, relationship: null }
    : notFoundRecipient(request, reply);
}

function notFoundRecipient(request: FastifyRequest, reply: FastifyReply): null {
  sendError(reply, request, 404, 'recipient_not_found', 'Получатель не найден.', false);
  return null;
}

async function createMessage(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const body = createSchema.safeParse(request.body ?? {});
  if (!body.success) return sendError(reply, request, 400, 'invalid_body', 'Неверные параметры сообщения.', false);
  const recipient = findRecipient(deps, request, reply, candidate.id, body.data);
  if (!recipient) return reply;
  const unit = body.data.vacancyId ?? `contact-message:${recipient.contactId ?? recipient.recruiterId}`;
  if (!requireTariffQuota(deps, request, reply, candidate.id, 'applications', unit)) return reply;
  const text = await writeContactMessageText(deps, request, {
    candidateId: candidate.id,
    kind: body.data.kind,
    recipient,
    vacancyId: body.data.vacancyId ?? null,
  });
  const stored = stores.messages.create({
    id: randomUUID(),
    candidateId: candidate.id,
    contactId: recipient.contactId,
    recruiterId: recipient.recruiterId,
    vacancyId: body.data.vacancyId ?? null,
    kind: body.data.kind,
    text,
    recipientName: recipient.name,
    recipientUrl: recipient.linkedinUrl,
    createdAt: new Date().toISOString(),
  });
  return reply.code(201).send({ data: shown(stored), meta: { requestId: request.id } });
}

function editMessage(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const id = idSchema.safeParse((request.params as { id?: string }).id);
  const body = editSchema.safeParse(request.body ?? {});
  if (!body.success) return sendError(reply, request, 400, 'invalid_body', 'Текст сообщения пуст или слишком длинный.', false);
  const current = id.success ? stores.messages.get(candidate.id, id.data) : null;
  if (!id.success || !current) return notFound(request, reply);
  if (!stores.messages.updateText(candidate.id, current.id, body.data.text)) {
    return sendError(reply, request, 409, 'message_already_sent', 'Сообщение уже отмечено отправленным.', false);
  }
  return { data: shown({ ...current, text: body.data.text }), meta: { requestId: request.id } };
}

function approveMessage(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const id = idSchema.safeParse((request.params as { id?: string }).id);
  const current = id.success ? stores.messages.get(candidate.id, id.data) : null;
  if (!id.success || !current) return notFound(request, reply);
  const now = new Date().toISOString();
  if (!stores.messages.approve(candidate.id, current.id, now)) {
    return sendError(reply, request, 409, 'message_already_sent', 'Сообщение уже отмечено отправленным.', false);
  }
  const data: B640ContactMessageApproval = {
    ...shown(current),
    state: 'approved',
    approvedAt: now,
    openUrl: linkedinOpenUrl(current.recipientUrl),
  };
  return { data, meta: { requestId: request.id } };
}

function sentMessage(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const id = idSchema.safeParse((request.params as { id?: string }).id);
  const current = id.success ? stores.messages.get(candidate.id, id.data) : null;
  if (!id.success || !current) return notFound(request, reply);
  const now = new Date().toISOString();
  if (!stores.messages.markSent(candidate.id, current.id, now)) {
    return sendError(reply, request, 409, 'message_not_approved', 'Сначала одобрите сообщение.', false);
  }
  if (current.contactId) stores.statuses.set(candidate.id, current.contactId, 'written', now);
  recordApplicationNote(deps, request, candidate.id, current, now);
  const data: B640ContactMessageSent = { ...shown(current), state: 'sent', sentAt: now };
  return { data, meta: { requestId: request.id } };
}

/** Событие в отклике существующим методом трекера; сбой не отменяет отметку «Отправил». */
function recordApplicationNote(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  message: StoredContactMessage,
  now: string,
): void {
  if (!message.vacancyId) return;
  try {
    const application = deps.candidateStore.listApplications(candidateId).find((item) => item.clusterId === message.vacancyId);
    if (!application) return;
    deps.candidateStore.recordApplicationEvent(candidateId, application.id, {
      kind: 'follow_up_sent',
      occurredAt: now,
      note: `Написал(а) в LinkedIn: ${message.recipientName}`,
    });
  } catch (error) {
    request.log.warn({ err: error }, 'contact-message-application-event-failed');
  }
}

function listMessages(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const query = listSchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_query', 'Нужен контакт.', false);
  const items = stores.messages
    .listForContact(candidate.id, query.data.contactId, B640_CONTACT_MESSAGE_LIST_MAX)
    .map(shown);
  return { data: { items }, meta: { requestId: request.id } };
}

function listSent(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const query = sentSchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_query', 'Нужна вакансия.', false);
  const items: B640SentContactMessage[] = stores.messages
    .listSentForVacancy(candidate.id, query.data.vacancyId, B640_CONTACT_MESSAGE_LIST_MAX)
    .flatMap((message) =>
      message.sentAt
        ? [{ id: message.id, kind: message.kind, recipientName: message.recipientName, sentAt: message.sentAt }]
        : [],
    );
  return { data: { items }, meta: { requestId: request.id } };
}

/** B698: сообщение знакомому или рекрутёру — подготовка, правка, одобрение, отметка «Отправил»; за флагом B640. */
export function registerB640ContactMessageRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const stores: Stores = {
    messages: new SqliteContactMessageRepository({ databasePath: deps.config.databasePath }),
    statuses: new SqliteContactStatusRepository({ databasePath: deps.config.databasePath }),
  };
  app.addHook('onClose', async () => {
    stores.messages.close();
    stores.statuses.close();
  });
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 hour' } } });
  app.post(BASE, limit(120), withDeps(deps, (d, request, reply) => createMessage(d, stores, request, reply)));
  app.get(BASE, limit(600), withDeps(deps, (d, request, reply) => listMessages(d, stores, request, reply)));
  app.get(`${BASE}/sent`, limit(600), withDeps(deps, (d, request, reply) => listSent(d, stores, request, reply)));
  app.put(`${BASE}/:id`, limit(600), withDeps(deps, (d, request, reply) => editMessage(d, stores, request, reply)));
  app.post(`${BASE}/:id/approve`, limit(600), withDeps(deps, (d, request, reply) => approveMessage(d, stores, request, reply)));
  app.post(`${BASE}/:id/sent`, limit(600), withDeps(deps, (d, request, reply) => sentMessage(d, stores, request, reply)));
}
