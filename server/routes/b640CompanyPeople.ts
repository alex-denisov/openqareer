import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { B640CompanyPeoplePage, B640CompanyPerson } from '../../shared/b640Companies';
import { candidateCompanyKey, type ConnectionCircleResult } from '../domain/candidateCompanies';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readB640PoolRows } from './b640MatchedVacancyRoutes';
import { findCompanyRow } from './b640CompanyModel';
import { readB640ListContext, sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
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
      }),
    );
  }
  return people;
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
  return mergePeople(
    companyVacancies(pool, companyKey)
      .slice(0, PEOPLE_VACANCY_LIMIT)
      .flatMap((item) =>
        circlePeople(circlesOf(item), { id: item.cluster.id, title: item.cluster.canonicalTitle }),
      ),
  );
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
