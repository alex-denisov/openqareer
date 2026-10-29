import { companyMatchName } from '../vacancies/vacancyDeduplicator';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RecruiterContact, RecruiterSourceReceipt } from '../../shared/recruiterContact';
import {
  buildConnectionCircles,
  candidateCompanyKey,
  type CandidateConnectionContact,
  type ConnectionCirclePerson,
  type ConnectionCircleWorkplace,
} from '../domain/candidateCompanies';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { finishMatchedVacancies } from './matchedVacancyRoutes';
import { readCampaign } from './campaignContext';
import { readMatchProfile, readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { readTargetLevel } from './vacancyRoleContext';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { CandidateSnapshot } from '../data/candidateStore';

const CONNECTION_SCOPE_ID = '__b448_candidate_connections__';
const CONNECTION_IMPORT_RECEIPT_ID = '__b448_linkedin_import_receipt__';
// A whole LinkedIn network: run 9 read 1 888 connections, and circles need
// every contact with a company (B448). 2 000 contacts are ~600 KB, inside
// the import route's 1 MB body limit.
const MAX_CONNECTION_CONTACTS = 2_500;
const MAX_IMPORTED_CONNECTIONS = 2_000;

const workplaceSchema = z
  .object({
    companyName: z.string().trim().min(1).max(180),
    startDate: z.string().trim().max(40).nullable().optional(),
    endDate: z.string().trim().max(40).nullable().optional(),
  })
  .strict();

const linkedinUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine(isLinkedInProfileUrl, 'linkedin_profile_url_required');
const connectionContactSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    companyName: z.string().trim().min(1).max(180),
    roleTitle: z.string().trim().max(160).default(''),
    linkedinUrl: linkedinUrlSchema.nullable().optional(),
    relationship: z.string().trim().min(1).max(180),
    strength: z.enum(['strong', 'weak', 'unknown']).default('unknown'),
    workplaces: z.array(workplaceSchema).max(10).default([]),
    knowsRecruiterIds: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  })
  .strict();

const importedContactSchema = z
  .object({
    externalId: z.string().trim().min(1).max(200).optional(),
    fullName: z.string().trim().min(1).max(120),
    // 29.10: most LinkedIn headlines name no company; such a person is still
    // in the network and only stays out of the per-company counts.
    companyName: z.string().trim().max(180).default(''),
    roleTitle: z.string().trim().max(160).default(''),
    linkedinUrl: linkedinUrlSchema.nullable().optional(),
    relationship: z.string().trim().max(180).default('Контакт из импортированного списка LinkedIn'),
    strength: z.enum(['strong', 'weak', 'unknown']).default('unknown'),
    workplaces: z.array(workplaceSchema).max(10).default([]),
    knowsRecruiterIds: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  })
  .strict();

const importConnectionsSchema = z
  .object({
    contacts: z.array(importedContactSchema).max(MAX_IMPORTED_CONNECTIONS),
  })
  .strict();
const contactListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
const contactIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/u)
  .refine((id) => id !== CONNECTION_IMPORT_RECEIPT_ID, 'connection_contact_id_reserved');
const connectionMetadataSchema = z
  .object({
    contactId: z.string().trim().min(1).max(120),
    source: z.enum(['manual', 'linkedin_import']),
    relationship: z.string().trim().min(1).max(180),
    strength: z.enum(['strong', 'weak', 'unknown']),
    workplaces: z.array(workplaceSchema).max(10),
    knowsRecruiterIds: z.array(z.string().trim().min(1).max(120)).max(50),
  })
  .strict();
const importReceiptSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    importedAt: z.string().datetime({ offset: true }),
    importedCount: z.number().int().min(0).max(MAX_IMPORTED_CONNECTIONS),
  })
  .strict();
const storedReceiptSchema = z
  .object({
    connection: connectionMetadataSchema.optional(),
    connectionImport: importReceiptSchema.optional(),
  })
  .passthrough();

type ConnectionContactInput = z.infer<typeof connectionContactSchema>;
type ImportedContactInput = z.infer<typeof importedContactSchema>;
type ConnectionSource = 'manual' | 'linkedin_import';
type ConnectionMetadata = z.infer<typeof connectionMetadataSchema>;
type ImportReceipt = z.infer<typeof importReceiptSchema>;
type ConnectionRepository = NonNullable<RouteDeps['recruiterContactsRepo']>;

interface ConnectionContactView extends ConnectionMetadata {
  readonly id: string;
  readonly fullName: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly linkedinUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function registerCandidateConnectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/connection-contacts', withDeps(deps, handleListConnectionContacts));
  app.put(
    '/api/v1/candidate/connection-contacts/linkedin-import',
    { bodyLimit: 1_048_576, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    withDeps(deps, handleImportLinkedInContacts),
  );
  app.put(
    '/api/v1/candidate/connection-contacts/:contactId',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handlePutManualConnection),
  );
  app.delete(
    '/api/v1/candidate/connection-contacts/:contactId',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleDeleteManualConnection),
  );
  app.get(
    '/api/v1/candidate/vacancies/:vacancyId/connection-circles',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleGetConnectionCircles),
  );
}

async function handleListConnectionContacts(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = connectionCandidate(deps, request, reply, false);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  const query = contactListQuerySchema.parse(request.query ?? {});
  const records = connectionRecords(repository, candidate.id);
  const contacts = records.flatMap((record) => toConnectionContactView(record) ?? []);
  const items = contacts.slice(query.offset, query.offset + query.limit);
  return {
    data: {
      items,
      total: contacts.length,
      offset: query.offset,
      limit: query.limit,
      nextOffset:
        query.offset + items.length < contacts.length ? query.offset + items.length : null,
      linkedinImport: linkedinImportState(records),
    },
    meta: {
      requestId: request.id,
      total: contacts.length,
      offset: query.offset,
      nextOffset:
        query.offset + items.length < contacts.length ? query.offset + items.length : null,
    },
  };
}

async function handlePutManualConnection(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = connectionCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  const contactId = contactIdSchema.parse((request.params as { contactId: string }).contactId);
  const input = connectionContactSchema.parse(request.body);
  return upsertManualConnection(repository, candidate.id, contactId, input, request, reply);
}

function upsertManualConnection(
  repository: ConnectionRepository,
  candidateId: string,
  contactId: string,
  input: ConnectionContactInput,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const records = connectionRecords(repository, candidateId);
  const existing = records.find(
    (record) => readConnectionMetadata(record)?.contactId === contactId,
  );
  const conflict = manualConnectionConflict(existing, request, reply);
  if (conflict) return conflict;
  const current = existing ? toConnectionContactView(existing) : null;
  if (current && sameManualContact(current, input)) {
    return { data: current, meta: { requestId: request.id } };
  }
  if (!existing && connectionContactCount(records) >= MAX_CONNECTION_CONTACTS) {
    return sendError(
      reply,
      request,
      409,
      'connection_contact_limit_reached',
      'Достигнут предел сохранённых контактов.',
      false,
    );
  }
  const now = new Date().toISOString();
  const updated = toStoredConnectionContact(
    candidateId,
    contactId,
    input,
    'manual',
    now,
    existing?.createdAt,
  );
  const retained = records.filter(
    (record) => readConnectionMetadata(record)?.contactId !== contactId,
  );
  saveConnectionRecords(repository, candidateId, [...retained, updated]);
  reply.code(existing ? 200 : 201);
  return { data: toConnectionContactView(updated), meta: { requestId: request.id } };
}

function manualConnectionConflict(
  existing: RecruiterContact | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!existing || existing.sourceType === 'candidate_manual_connection') return null;
  return sendError(
    reply,
    request,
    409,
    'connection_contact_read_only',
    'Импортированный контакт нельзя редактировать отдельно.',
    false,
  );
}

async function handleDeleteManualConnection(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = connectionCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  const contactId = contactIdSchema.parse((request.params as { contactId: string }).contactId);
  const records = connectionRecords(repository, candidate.id);
  const target = records.find((record) => readConnectionMetadata(record)?.contactId === contactId);
  if (target && target.sourceType !== 'candidate_manual_connection') {
    return sendError(
      reply,
      request,
      409,
      'connection_contact_read_only',
      'Импортированный контакт удаляется повторным импортом списка.',
      false,
    );
  }
  if (target)
    saveConnectionRecords(
      repository,
      candidate.id,
      records.filter((record) => readConnectionMetadata(record)?.contactId !== contactId),
    );
  return reply.code(204).send();
}

async function handleImportLinkedInContacts(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = connectionCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  const { contacts } = importConnectionsSchema.parse(request.body);
  const records = connectionRecords(repository, candidate.id);
  const manual = records.filter((record) => record.sourceType === 'candidate_manual_connection');
  if (manual.length + contacts.length > MAX_CONNECTION_CONTACTS) {
    return sendError(
      reply,
      request,
      409,
      'connection_contact_limit_reached',
      'Импорт превысит предел сохранённых контактов.',
      false,
    );
  }
  return persistLinkedInImport(repository, candidate.id, manual, records, contacts, request, reply);
}

function persistLinkedInImport(
  repository: ConnectionRepository,
  candidateId: string,
  manual: readonly RecruiterContact[],
  existing: readonly RecruiterContact[],
  contacts: readonly ImportedContactInput[],
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const unique = uniqueImportedContacts(contacts);
  if (manual.length + unique.length > MAX_CONNECTION_CONTACTS) {
    return sendError(
      reply,
      request,
      409,
      'connection_contact_limit_reached',
      'Импорт превысит предел сохранённых контактов.',
      false,
    );
  }
  const digest = digestImport(unique);
  const previous = readImportReceipt(existing);
  if (previous?.digest === digest) return connectionImportResponse(request, previous);
  const receipt = { digest, importedAt: new Date().toISOString(), importedCount: unique.length };
  storeImportedConnections(repository, candidateId, manual, unique, receipt);
  return connectionImportResponse(request, receipt);
}

function storeImportedConnections(
  repository: ConnectionRepository,
  candidateId: string,
  manual: readonly RecruiterContact[],
  contacts: readonly ImportedContactInput[],
  receipt: ImportReceipt,
): void {
  const usedIds = new Set(
    manual.flatMap((record) => readConnectionMetadata(record)?.contactId ?? []),
  );
  const imported = contacts.map((contact) =>
    toStoredConnectionContact(
      candidateId,
      allocateImportedContactId(contact, usedIds),
      toConnectionContactInput(contact),
      'linkedin_import',
      receipt.importedAt,
    ),
  );
  const storedReceipt = toStoredImportReceipt(candidateId, receipt);
  saveConnectionRecords(repository, candidateId, [...manual, ...imported, storedReceipt]);
}

function connectionImportResponse(request: FastifyRequest, receipt: ImportReceipt) {
  return {
    data: {
      state: 'imported',
      importedAt: receipt.importedAt,
      importedCount: receipt.importedCount,
    },
    meta: { requestId: request.id },
  };
}

async function handleGetConnectionCircles(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = connectionCandidate(deps, request, reply, false);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  const vacancyId = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .parse((request.params as { vacancyId: string }).vacancyId);
  const matched =
    (await readCandidateMatchedVacancies(deps, candidate.id)).find(
      (item) => item.cluster.id === vacancyId,
    ) ?? wantedPoolVacancy(deps, candidate.id, vacancyId);
  if (!matched)
    return sendError(
      reply,
      request,
      404,
      'vacancy_not_in_candidate_selection',
      'Вакансия не найдена в текущей подборке.',
      false,
    );
  return connectionCirclesResponse(deps, repository, candidate.id, matched, request);
}

/**
 * The company screen lists a wanted company's vacancies from the pool when none is in the
 * selection; their circles are read under the wanted name so people land on that company.
 */
function wantedPoolVacancy(
  deps: RouteDeps,
  candidateId: string,
  vacancyId: string,
): MatchedVacancyItem | undefined {
  const engine = deps.multiSourceEngine as Partial<
    Pick<RouteDeps['multiSourceEngine'], 'getStoredCluster'>
  >;
  const cluster = engine.getStoredCluster?.(vacancyId);
  if (!cluster || cluster.status !== 'active') return undefined;
  const name = companyMatchName(cluster.canonicalCompany);
  const want = (deps.candidateCompanyWantsRepo?.list(candidateId) ?? []).find(
    (item) => companyMatchName(item.companyName) === name,
  );
  if (!name || !want) return undefined;
  return {
    cluster: { ...cluster, canonicalCompany: want.companyName },
  } as unknown as MatchedVacancyItem;
}

async function connectionCirclesResponse(
  deps: RouteDeps,
  repository: ConnectionRepository,
  candidateId: string,
  matched: MatchedVacancyItem,
  request: FastifyRequest,
) {
  const stored = connectionRecords(repository, candidateId);
  const importReceipt = readImportReceipt(stored);
  const contacts = stored.flatMap((record) => toDomainConnection(record) ?? []);
  const recruiters = repository
    .getContactsByVacancyId(candidateId, matched.cluster.id)
    .map(toConnectionRecruiter);
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const candidateName = snapshot.resume?.draft.candidate.fullName?.trim() || 'Кандидат';
  const built = buildConnectionCircles({
    candidate: { id: candidateId, fullName: candidateName },
    vacancy: {
      id: matched.cluster.id,
      companyName: matched.cluster.canonicalCompany,
      title: matched.cluster.canonicalTitle,
    },
    candidateWorkplaces: resumeWorkplaces(snapshot),
    recruiters,
    contacts,
    linkedinContactsImported: importReceipt !== null,
  });
  return {
    data: {
      vacancyId: matched.cluster.id,
      companyKey: candidateCompanyKey(matched.cluster.canonicalCompany),
      companyName: matched.cluster.canonicalCompany,
      vacancyTitle: matched.cluster.canonicalTitle,
      circles: built.circles,
      linkedinImport: importReceipt
        ? {
            state: 'imported',
            importedAt: importReceipt.importedAt,
            importedCount: importReceipt.importedCount,
          }
        : { state: 'unknown', importedAt: null, importedCount: null },
    },
    meta: { requestId: request.id },
  };
}

async function readCandidateMatchedVacancies(
  deps: RouteDeps,
  candidateId: string,
): Promise<MatchedVacancyItem[]> {
  const { confirmedSkills } = readMatchProfile(deps.candidateStore, candidateId);
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const roles = [...campaign.roles.value];
  if (confirmedSkills.length === 0 && roles.length === 0) return [];
  const level = readTargetLevel(deps.candidateStore, candidateId, roles);
  const snapshot = await readMatchedSnapshot(
    deps.multiSourceEngine,
    candidateId,
    confirmedSkills,
    roles,
    level,
  );
  return finishMatchedVacancies(snapshot, roles, campaign, deps.candidateStore, candidateId);
}

function resumeWorkplaces(snapshot: CandidateSnapshot): ConnectionCircleWorkplace[] {
  return (
    snapshot.resume?.draft.experience.flatMap((item) =>
      item.employer?.trim()
        ? [
            {
              companyName: item.employer.trim(),
              startDate: item.startDate ?? null,
              endDate: item.current ? null : (item.endDate ?? null),
            },
          ]
        : [],
    ) ?? []
  );
}

function toConnectionRecruiter(contact: RecruiterContact): ConnectionCirclePerson {
  const metadata = readConnectionMetadata(contact);
  return {
    id: contact.id,
    fullName: contact.fullName,
    roleTitle: contact.roleTitle,
    companyName: contact.companyName,
    linkedinUrl: contact.linkedinUrl,
    workplaces: metadata?.workplaces ?? [],
  };
}

function toDomainConnection(contact: RecruiterContact): CandidateConnectionContact | null {
  const metadata = readConnectionMetadata(contact);
  if (
    !metadata ||
    (contact.sourceType !== 'candidate_manual_connection' &&
      contact.sourceType !== 'candidate_linkedin_connection')
  )
    return null;
  return {
    id: metadata.contactId,
    fullName: contact.fullName,
    roleTitle: contact.roleTitle,
    companyName: contact.companyName,
    linkedinUrl: contact.linkedinUrl,
    source: metadata.source,
    relationship: metadata.relationship,
    strength: metadata.strength,
    workplaces: metadata.workplaces,
    knowsRecruiterIds: metadata.knowsRecruiterIds,
  };
}

function connectionRecords(
  repository: ConnectionRepository,
  candidateId: string,
): RecruiterContact[] {
  return repository.getContactsByVacancyId(candidateId, CONNECTION_SCOPE_ID);
}

function saveConnectionRecords(
  repository: ConnectionRepository,
  candidateId: string,
  records: RecruiterContact[],
): void {
  repository.saveContacts(candidateId, CONNECTION_SCOPE_ID, records);
}

function connectionStorageId(candidateId: string, contactId: string): string {
  const scopedId = createHash('sha256')
    .update(candidateId + '\u0000' + contactId)
    .digest('hex');
  return 'b448-' + scopedId;
}

function toConnectionContactView(contact: RecruiterContact): ConnectionContactView | null {
  const metadata = readConnectionMetadata(contact);
  if (!metadata) return null;
  return {
    id: metadata.contactId,
    fullName: contact.fullName,
    companyName: contact.companyName,
    roleTitle: contact.roleTitle,
    linkedinUrl: contact.linkedinUrl,
    ...metadata,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
  };
}

function readConnectionMetadata(contact: RecruiterContact): ConnectionMetadata | null {
  return storedReceiptSchema.safeParse(contact.sourceReceipt).data?.connection ?? null;
}

function readImportReceipt(records: readonly RecruiterContact[]): ImportReceipt | null {
  const receipt = records.find(
    (record) => record.sourceType === 'candidate_connection_import_receipt',
  );
  return receipt
    ? (storedReceiptSchema.safeParse(receipt.sourceReceipt).data?.connectionImport ?? null)
    : null;
}

function linkedinImportState(records: readonly RecruiterContact[]) {
  const receipt = readImportReceipt(records);
  return receipt
    ? {
        state: 'imported' as const,
        importedAt: receipt.importedAt,
        importedCount: receipt.importedCount,
      }
    : { state: 'unknown' as const, importedAt: null, importedCount: null };
}

function connectionContactCount(records: readonly RecruiterContact[]): number {
  return records.filter((record) => readConnectionMetadata(record) !== null).length;
}

function toStoredConnectionContact(
  candidateId: string,
  contactId: string,
  input: ConnectionContactInput,
  source: ConnectionSource,
  now: string,
  createdAt = now,
): RecruiterContact {
  const connection: ConnectionMetadata = {
    contactId,
    source,
    relationship: input.relationship,
    strength: input.strength,
    workplaces: input.workplaces,
    knowsRecruiterIds: input.knowsRecruiterIds,
  };
  const sourceReceipt = {
    receiptId: 'b448-connection:' + connectionStorageId(candidateId, source + ':' + contactId),
    source: source === 'manual' ? 'candidate-entered' : 'user-provided-linkedin-export',
    method: source === 'manual' ? 'manual-entry' : 'linkedin-export',
    observedAt: now,
    confidence: 1,
    connection,
  } as RecruiterSourceReceipt & { connection: ConnectionMetadata };
  return {
    id: connectionStorageId(candidateId, source + ':' + contactId),
    vacancyId: CONNECTION_SCOPE_ID,
    companyName: input.companyName,
    fullName: input.fullName,
    roleTitle: input.roleTitle,
    email: null,
    emailStatus: 'unverified',
    phone: null,
    telegram: null,
    whatsapp: null,
    linkedinUrl: input.linkedinUrl ?? null,
    githubUrl: null,
    twitterUrl: null,
    sourceType:
      source === 'manual' ? 'candidate_manual_connection' : 'candidate_linkedin_connection',
    confidence: 1,
    sourceReceipt,
    createdAt,
    updatedAt: now,
  };
}

function toStoredImportReceipt(candidateId: string, input: ImportReceipt): RecruiterContact {
  const sourceReceipt = {
    receiptId: 'b448-linkedin-import',
    source: 'user-provided-linkedin-export',
    method: 'candidate-import',
    observedAt: input.importedAt,
    confidence: 1,
    connectionImport: input,
  } as RecruiterSourceReceipt & { connectionImport: ImportReceipt };
  return {
    id: connectionStorageId(candidateId, CONNECTION_IMPORT_RECEIPT_ID),
    vacancyId: CONNECTION_SCOPE_ID,
    companyName: '',
    fullName: 'Import receipt',
    roleTitle: '',
    email: null,
    emailStatus: 'unverified',
    phone: null,
    telegram: null,
    whatsapp: null,
    linkedinUrl: null,
    githubUrl: null,
    twitterUrl: null,
    sourceType: 'candidate_connection_import_receipt',
    confidence: 1,
    sourceReceipt,
    createdAt: input.importedAt,
    updatedAt: input.importedAt,
  };
}

function toConnectionContactInput(contact: ImportedContactInput): ConnectionContactInput {
  return {
    fullName: contact.fullName,
    companyName: contact.companyName,
    roleTitle: contact.roleTitle,
    linkedinUrl: contact.linkedinUrl,
    relationship: contact.relationship,
    strength: contact.strength,
    workplaces: contact.workplaces,
    knowsRecruiterIds: contact.knowsRecruiterIds,
  };
}

function importedContactId(contact: ImportedContactInput): string {
  const identity =
    contact.externalId ??
    contact.linkedinUrl ??
    [contact.fullName, contact.companyName, contact.roleTitle].join('\u0000');
  return (
    'linkedin-' +
    createHash('sha256')
      .update(identity.normalize('NFKC').toLocaleLowerCase('und'))
      .digest('hex')
      .slice(0, 32)
  );
}

function allocateImportedContactId(contact: ImportedContactInput, usedIds: Set<string>): string {
  const base = importedContactId(contact);
  let id = base;
  for (let suffix = 1; usedIds.has(id); suffix += 1) id = base + '-' + suffix;
  usedIds.add(id);
  return id;
}

function uniqueImportedContacts(contacts: readonly ImportedContactInput[]): ImportedContactInput[] {
  const unique = new Map<string, ImportedContactInput>();
  for (const contact of contacts) unique.set(importedContactId(contact), contact);
  return Array.from(unique.values());
}

function digestImport(contacts: readonly ImportedContactInput[]): string {
  return createHash('sha256').update(stableJson(contacts)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stableJson(record[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

function sameManualContact(current: ConnectionContactView, input: ConnectionContactInput): boolean {
  return (
    stableJson({
      fullName: current.fullName,
      companyName: current.companyName,
      roleTitle: current.roleTitle,
      linkedinUrl: current.linkedinUrl,
      relationship: current.relationship,
      strength: current.strength,
      workplaces: current.workplaces,
      knowsRecruiterIds: current.knowsRecruiterIds,
    }) === stableJson(input)
  );
}

function connectionCandidate(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  mutate: boolean,
) {
  if (mutate && !hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function connectionRepository(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): ConnectionRepository | null {
  if (deps.recruiterContactsRepo) return deps.recruiterContactsRepo;
  sendError(
    reply,
    request,
    503,
    'connection_storage_unavailable',
    'Список контактов временно недоступен.',
    true,
  );
  return null;
}

function isLinkedInProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLocaleLowerCase('und')) &&
      /^\/in\//u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * B439: contacts in the candidate's network per company key. Null until a LinkedIn
 * contact import exists, so the company list never shows an invented zero.
 */
export function readCandidateNetworkContactCounts(
  repository: ConnectionRepository | undefined,
  candidateId: string,
  companyKeys: Iterable<string>,
): ReadonlyMap<string, { readonly count: number; readonly importedAt: string }> | null {
  if (!repository) return null;
  const records = connectionRecords(repository, candidateId);
  const receipt = readImportReceipt(records);
  if (!receipt) return null;
  const counts = new Map<string, number>();
  for (const contact of records.flatMap((record) => toDomainConnection(record) ?? [])) {
    const name = contact.companyName?.trim();
    if (!name) continue;
    const key = candidateCompanyKey(name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(
    [...companyKeys].map((key) => [
      key,
      { count: counts.get(key) ?? 0, importedAt: receipt.importedAt },
    ]),
  );
}
