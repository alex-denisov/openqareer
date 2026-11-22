import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { B640CompanyPeoplePage, B640CompanyPerson, B640PersonMessage } from '../../shared/b640Companies';
import type { B640Contact } from '../../shared/b640Contacts';
import { buildB640ContactList, type B640ContactSource } from '../domain/b640Contacts';
import {
  candidateCompanyKey,
  type ConnectionCirclePath,
  type ConnectionCircleResult,
} from '../domain/candidateCompanies';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readB640PoolRows } from './b640MatchedVacancyRoutes';
import { findCompanyRow } from './b640CompanyModel';
import { readB640ListContext, sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import { candidateWorkplaces, contactSources } from './b640ContactRoutes';
import { buildVacancyCircles, connectionRepository } from './candidateConnectionRoutes';
import { companyContext } from './candidateCompanyRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';

const peopleSchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(20).default(20),
});

/** Сколько вакансий компании просматривается ради людей: путь через знакомого общий для всех. */
const PEOPLE_VACANCY_LIMIT = 10;

const COMPANY_RECIPIENT = 'vacancy:';

const PLATFORM_MEMBER_EVIDENCE =
  'Знаком с участником платформы — тот согласен представлять кандидатов';

/** Prefix of a 1st-circle path whose recipient is the candidate's own contact, not a recruiter. */
const OWN_CONTACT_PATH = 'circle-1:contact:';

/** Who the draft goes to: the contact itself, the go-between of the 2nd circle, or the recruiter. */
function messageOf(path: ConnectionCirclePath, vacancyId: string): B640PersonMessage {
  const recruiter = { recruiterId: path.recipient.id, vacancyId };
  if (path.circle === 2) {
    const via = path.path.length > 2 ? path.path[1] : undefined;
    return via ? { kind: 'ask_introduction', target: { contactId: via.id } } : { kind: 'recruiter', target: recruiter };
  }
  if (path.circle === 1) {
    return path.id.startsWith(OWN_CONTACT_PATH)
      ? { kind: 'known_contact', target: { contactId: path.recipient.id } }
      : { kind: 'known_contact', target: recruiter };
  }
  return { kind: 'recruiter', target: recruiter };
}

/** Люди из кругов одной вакансии: пути с именами и участники платформы без имён. */
export function circlePeople(
  circles: readonly ConnectionCircleResult[],
  vacancy: { readonly id: string; readonly title: string },
): B640CompanyPerson[] {
  const vacancyId = vacancy.id;
  const people: B640CompanyPerson[] = [];
  for (const circle of circles) {
    // Холодный путь без рекрутера ведёт к самой компании, а не к человеку — в списке людей его нет.
    for (const path of circle.paths.filter(
      (candidatePath) => !candidatePath.recipient.id.startsWith(COMPANY_RECIPIENT),
    )) {
      people.push({
        id: path.id,
        circle: path.circle,
        name: path.recipient.fullName,
        roleTitle: path.recipient.roleTitle,
        evidence:
          path.circle === 3 ? `Рекрутер вакансии «${vacancy.title}»` : (path.evidence[0] ?? null),
        nextStep: path.nextStep,
        vacancyId,
        platformMember: false,
        message: messageOf(path, vacancyId),
      });
    }
    (circle.platformMembers?.members ?? []).forEach((_member, index) =>
      people.push({
        id: `platform:${vacancyId}:${index}`,
        circle: 2,
        name: null,
        roleTitle: null,
        evidence: PLATFORM_MEMBER_EVIDENCE,
        nextStep: 'ask_for_introduction',
        vacancyId,
        platformMember: true,
        message: null,
      }),
    );
  }
  return people;
}

/**
 * B698: черновик знакомому из карточки компании — про эту компанию: вакансия его строки (или первая
 * вакансия компании) и ещё одна. У рекрутёра вакансия уже есть, у компании без вакансий — ничего.
 */
export function withCompanyVacancies(
  people: readonly B640CompanyPerson[],
  vacancyIds: readonly string[],
): B640CompanyPerson[] {
  return people.map((person) => {
    const target = person.message?.target;
    if (!person.message || !target || !('contactId' in target)) return person;
    const first = person.vacancyId ?? vacancyIds[0];
    if (!first) return person;
    const also = vacancyIds.find((id) => id !== first);
    const withVacancies = { contactId: target.contactId, vacancyId: first, ...(also ? { alsoVacancyId: also } : {}) };
    return { ...person, message: { ...person.message, target: withVacancies } };
  });
}

/** Один человек — одна строка, в ближайшем круге; участники платформы — по одному на вакансию. */
export function mergePeople(people: readonly B640CompanyPerson[]): B640CompanyPerson[] {
  const best = new Map<string, B640CompanyPerson>();
  for (const person of people) {
    const key = person.platformMember
      ? person.id
      : `name:${(person.name ?? '').trim().toLocaleLowerCase('ru-RU')}`;
    const known = best.get(key);
    if (!known || person.circle < known.circle) best.set(key, person);
  }
  return [...best.values()].sort((a, b) => a.circle - b.circle);
}

/** Контакт из a02 — человек из списка кандидата, т. е. 1-й круг; 2-й — только путь через общего знакомого. */
const CONTACT_CIRCLE: Readonly<Record<B640Contact['link'], 1 | 2>> = { direct: 1, intro: 2, none: 1 };
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' });

/** Строка «как связаны» у контакта без пояснения — его источник, как в макете v10b: «импорт контактов LinkedIn, 10.11». */
export function contactSourceNote(source: Pick<B640ContactSource, 'source' | 'updatedAt'>): string {
  if (source.source === 'manual') return 'добавлено вами';
  const at = new Date(source.updatedAt);
  return Number.isNaN(at.getTime()) ? 'импорт контактов LinkedIn' : `импорт контактов LinkedIn, ${DAY_MONTH.format(at)}`;
}

/**
 * B645 v10b: люди компании из тех же контактов, что в «Контактах» (a02), с тем же сопоставлением
 * компании по `candidateCompanyKey`. У компании без вакансий в подборке они — единственный источник.
 */
export function contactPeople(
  contacts: readonly B640Contact[],
  companyKey: string,
  vacancyId: string | null,
): B640CompanyPerson[] {
  return contacts
    .filter((contact) => contact.companyName && candidateCompanyKey(contact.companyName) === companyKey)
    .map((contact) => ({
      id: `contact:${contact.id}`,
      circle: CONTACT_CIRCLE[contact.link],
      name: contact.fullName,
      roleTitle: contact.roleTitle || null,
      evidence: contact.linkNote,
      nextStep: contact.link === 'intro' ? 'ask_for_introduction' : 'write_known_contact',
      vacancyId,
      platformMember: false,
      message: {
        kind: contact.link === 'intro' ? 'ask_introduction' : 'known_contact',
        target: { contactId: contact.id },
      },
    }));
}

/** Все контакты кандидата одной страницей — тот же разбор, что у списка a02. */
function candidateContacts(
  deps: RouteDeps,
  repository: NonNullable<ReturnType<typeof connectionRepository>>,
  candidateId: string,
): readonly B640Contact[] {
  const { contacts } = contactSources(repository, candidateId);
  const input = {
    contacts,
    candidateWorkplaces: candidateWorkplaces(deps, candidateId),
    statuses: new Map(),
    selectionKeys: new Set<string>(),
  };
  const query = { offset: 0, limit: contacts.length, search: '', company: [], link: [], status: [], sort: 'name' } as const;
  const notes = new Map(contacts.map((source) => [source.id, contactSourceNote(source)]));
  return buildB640ContactList(input, query).items.map((contact) =>
    contact.linkNote ? contact : { ...contact, linkNote: notes.get(contact.id) ?? null },
  );
}

function companyVacancies(
  pool: readonly MatchedVacancyItem[],
  companyKey: string,
): MatchedVacancyItem[] {
  return pool.filter((item) => candidateCompanyKey(item.cluster.canonicalCompany) === companyKey);
}

export function companyMissing(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const message = 'Компания не найдена в текущей подборке.';
  return sendError(reply, request, 404, 'company_not_in_selection', message, false);
}

async function companyPeople(
  deps: RouteDeps,
  repository: NonNullable<ReturnType<typeof connectionRepository>>,
  candidateId: string,
  companyKey: string,
  request: FastifyRequest,
): Promise<B640CompanyPerson[]> {
  const context = readB640ListContext(deps, candidateId);
  const pool = (await readB640PoolRows(deps, request, candidateId, context, {})) ?? [];
  const circlesOf = (item: MatchedVacancyItem) =>
    buildVacancyCircles(deps, repository, candidateId, item, request.log).circles;
  const vacancies = companyVacancies(pool, companyKey).slice(0, PEOPLE_VACANCY_LIMIT);
  const fromCircles = vacancies.flatMap((item) =>
    circlePeople(circlesOf(item), { id: item.cluster.id, title: item.cluster.canonicalTitle }),
  );
  const fromContacts = contactPeople(
    candidateContacts(deps, repository, candidateId),
    companyKey,
    vacancies[0]?.cluster.id ?? null,
  );
  const ids = vacancies.map((item) => item.cluster.id);
  return withCompanyVacancies(mergePeople([...fromCircles, ...fromContacts]), ids);
}

async function getPeople(backgroundDeps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, backgroundDeps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const parsed = peopleSchema.safeParse(request.query);
  if (!parsed.success) {
    const message = 'Проверьте параметры списка людей.';
    return sendError(reply, request, 400, 'invalid_people_query', message, false);
  }
  const repository = connectionRepository(backgroundDeps, request, reply);
  if (!repository) return undefined;
  const deps = withRequestScopedCandidateReads(backgroundDeps);
  const companyId = (request.params as { companyId: string }).companyId;
  const row = findCompanyRow((await companyContext(deps, candidate.id)).rows, companyId);
  if (!row) return companyMissing(request, reply);
  const people = await companyPeople(deps, repository, candidate.id, row.key, request);
  const { offset, limit } = parsed.data;
  const items = people.slice(offset, offset + limit);
  const nextOffset = offset + items.length < people.length ? offset + items.length : null;
  const data: B640CompanyPeoplePage = { items, total: people.length, offset, nextOffset };
  return { data, meta: { requestId: request.id } };
}

/** B677: люди компании одним запросом, порциями по 20. */
export function registerB640CompanyPeopleRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/b640/companies/:companyId/people',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, getPeople),
  );
}
