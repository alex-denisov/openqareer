import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LINKEDIN_JOURNAL_PAGE_MAX } from '../../shared/b640LinkedinJournal';
import { DEFAULT_ACCOUNT_TIMEZONE, isValidTimezone } from '../../shared/timezoneUtils';
import { SqliteContactStatusRepository } from '../data/sqliteContactStatusRepository';
import { buildLinkedinJournal, type JournalReply } from '../domain/b640LinkedinJournal';
import { readJournalPublications } from '../linkedinQueue/linkedinJournalReader';
import { contactSources } from './b640ContactRoutes';
import { requireCabinetB640 } from './cabinetB640Flag';
import { connectionRepository } from './candidateConnectionRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

const URL = '/api/v1/candidate/b640/linkedin/journal';
const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(LINKEDIN_JOURNAL_PAGE_MAX).default(LINKEDIN_JOURNAL_PAGE_MAX),
});

interface Stores {
  readonly database: DatabaseSync;
  readonly statuses: SqliteContactStatusRepository;
}

/** «Ответил» — отметка кандидата у контакта; контакт без имени в импорте связей не показывается. */
function replies(deps: RouteDeps, stores: Stores, candidateId: string, request: FastifyRequest, reply: FastifyReply): JournalReply[] | null {
  const marked = [...stores.statuses.list(candidateId)].filter(([, status]) => status.state === 'replied');
  if (!marked.length) return [];
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return null;
  const names = new Map(contactSources(repository, candidateId).contacts.map((contact) => [contact.id, contact.fullName.trim()]));
  return marked.flatMap(([contactId, status]) => {
    const name = names.get(contactId);
    return name ? [{ contactId, name, at: status.at }] : [];
  });
}

function readJournal(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  if (!principal.candidate) return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  const query = querySchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_query', 'Проверьте параметры журнала.', false);
  const candidateId = principal.candidate.id;
  const replied = replies(deps, stores, candidateId, request, reply);
  if (!replied) return reply;
  const zone = deps.authService.getUser?.(principal.userId)?.timezone;
  const data = buildLinkedinJournal(
    {
      publications: readJournalPublications(stores.database, candidateId),
      replies: replied,
      timezone: isValidTimezone(zone) ? (zone as string) : DEFAULT_ACCOUNT_TIMEZONE,
      now: new Date(),
    },
    query.data,
  );
  return { data, meta: { requestId: request.id } };
}

/**
 * B696: журнал LinkedIn за флагом `cabinetB640` — собственные события платформы и отметки кандидата.
 * Только чтение нашего хранения: на LinkedIn ничего не уходит и оттуда ничего не читается.
 */
export function registerB640LinkedinJournalRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = deps.candidateActionRepository?.getDatabase();
  if (!database) return;
  const statuses = new SqliteContactStatusRepository({ databasePath: deps.config.databasePath });
  app.addHook('onClose', async () => statuses.close());
  app.get(
    URL,
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    withDeps(deps, (d, request, reply) => readJournal(d, { database, statuses }, request, reply)),
  );
}
