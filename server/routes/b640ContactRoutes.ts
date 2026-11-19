import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  B640_CONTACT_LINKS,
  B640_CONTACT_PAGE_LIMIT_MAX,
  B640_CONTACT_SEARCH_MAX,
  B640_CONTACT_SORTS,
  B640_CONTACT_STATES,
  type B640ContactStatusResult,
} from '../../shared/b640Contacts';
import { SqliteContactStatusRepository } from '../data/sqliteContactStatusRepository';
import { buildB640ContactList, type B640ContactSource } from '../domain/b640Contacts';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { sessionCandidate } from './b640VacancyContext';
import { companyContext } from './candidateCompanyRoutes';
import {
  connectionRecords,
  connectionRepository,
  readConnectionMetadata,
  readImportReceipt,
  type ConnectionRepository,
} from './candidateConnectionRoutes';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

const BASE = '/api/v1/candidate/b640/contacts';
const many = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]), z.array(item).max(50));

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(B640_CONTACT_PAGE_LIMIT_MAX).default(B640_CONTACT_PAGE_LIMIT_MAX),
  search: z.string().max(B640_CONTACT_SEARCH_MAX).default(''),
  company: many(z.string().min(1).max(180)),
  link: many(z.enum(B640_CONTACT_LINKS)),
  status: many(z.enum(B640_CONTACT_STATES)),
  sort: z.enum(B640_CONTACT_SORTS).default('selection'),
});
const statusBodySchema = z.object({ state: z.enum(B640_CONTACT_STATES) }).strict();
const contactIdSchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/u);

function sources(repository: ConnectionRepository, candidateId: string) {
  const records = connectionRecords(repository, candidateId);
  const contacts = records.flatMap((record): B640ContactSource[] => {
    const meta = readConnectionMetadata(record);
    if (!meta) return [];
    return [
      {
        id: meta.contactId,
        fullName: record.fullName,
        roleTitle: record.roleTitle,
        companyName: record.companyName,
        source: meta.source,
        relationship: meta.relationship,
        workplaces: meta.workplaces,
        knowsRecruiterIds: meta.knowsRecruiterIds,
        updatedAt: record.updatedAt,
      },
    ];
  });
  return { contacts, receipt: readImportReceipt(records) };
}

function candidateWorkplaces(deps: RouteDeps, candidateId: string) {
  const experience = deps.candidateStore.getSnapshot(candidateId).resume?.draft.experience ?? [];
  return experience.flatMap((item) =>
    item.employer?.trim()
      ? [{ companyName: item.employer.trim(), startDate: item.startDate ?? null, endDate: item.current ? null : (item.endDate ?? null) }]
      : [],
  );
}

type Statuses = SqliteContactStatusRepository;

async function listContacts(deps: RouteDeps, statuses: Statuses, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const query = querySchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_query', 'Неверные параметры списка контактов.', false);
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return reply;
  const { contacts, receipt } = sources(repository, candidate.id);
  const selection = await companyContext(deps, candidate.id);
  const data = buildB640ContactList(
    {
      contacts,
      candidateWorkplaces: candidateWorkplaces(deps, candidate.id),
      statuses: statuses.list(candidate.id),
      selectionKeys: new Set(selection.vacancies.map((vacancy) => candidateCompanyKey(vacancy.companyName))),
      ...(receipt
        ? { linkedinImport: { state: 'imported' as const, importedAt: receipt.importedAt, importedCount: receipt.importedCount } }
        : {}),
    },
    query.data,
  );
  return { data, meta: { requestId: request.id, total: data.total, offset: data.offset, nextOffset: data.nextOffset } };
}

function putStatus(deps: RouteDeps, statuses: Statuses, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const contactId = contactIdSchema.safeParse((request.params as { contactId?: string }).contactId);
  const body = statusBodySchema.safeParse(request.body ?? {});
  if (!body.success) return sendError(reply, request, 400, 'invalid_body', 'Неверный статус контакта.', false);
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return reply;
  const known = contactId.success && sources(repository, candidate.id).contacts.some((contact) => contact.id === contactId.data);
  if (!contactId.success || !known) return sendError(reply, request, 404, 'contact_not_found', 'Контакт не найден.', false);
  const at = statuses.set(candidate.id, contactId.data, body.data.state, new Date().toISOString());
  const data: B640ContactStatusResult = { contactId: contactId.data, state: body.data.state, at };
  return { data, meta: { requestId: request.id } };
}

/** B697: список контактов с поиском, фильтрами, сортировкой и статусом «писали / ответили»; за флагом B640. */
export function registerB640ContactRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const statuses = new SqliteContactStatusRepository({ databasePath: deps.config.databasePath });
  app.addHook('onClose', async () => statuses.close());
  app.get(BASE, withDeps(deps, (d, request, reply) => listContacts(d, statuses, request, reply)));
  app.put(
    `${BASE}/:contactId/status`,
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, (d, request, reply) => putStatus(d, statuses, request, reply)),
  );
}
