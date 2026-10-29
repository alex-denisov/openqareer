import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { connectionCandidate, findCandidateVacancy } from './candidateConnectionRoutes';
import { memberSharesContacts } from './networkIndexFeed';
import type { ReferralRequest } from '../data/sqliteReferralRequestRepository';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { memberPeopleAt, platformReferralFor, readReferralProfile } from './referralRequestFeed';

/** B561 slice 3: candidate B asks for a referral; member U1 sees it and answers. */
const vacancyIdSchema = z.string().trim().min(1).max(200);
const requestIdSchema = z.string().uuid();
const answerSchema = z.object({ decision: z.enum(['accept', 'decline']) }).strict();

export function registerReferralRequestRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/vacancies/:vacancyId/referral-requests',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleAskReferral),
  );
  app.get(
    '/api/v1/candidate/referral-requests/incoming',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleListIncoming),
  );
  app.post(
    '/api/v1/candidate/referral-requests/:requestId/answer',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleAnswer),
  );
}

function referralStorage(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (deps.referralRequestRepo && deps.networkIndexRepo) return deps.referralRequestRepo;
  sendError(
    reply,
    request,
    503,
    'referral_unavailable',
    'Запросы рекомендаций временно недоступны.',
    true,
  );
  return null;
}

async function handleAskReferral(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = connectionCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const repository = referralStorage(deps, request, reply);
  if (!repository) return undefined;
  const vacancyId = vacancyIdSchema.parse((request.params as { vacancyId: string }).vacancyId);
  const vacancy = await findCandidateVacancy(deps, candidate.id, vacancyId);
  if (!vacancy) {
    return sendError(
      reply,
      request,
      404,
      'vacancy_not_in_candidate_selection',
      'Вакансия не найдена в текущей подборке.',
      false,
    );
  }
  return sendReferralAsk(deps, request, reply, candidate.id, vacancy);
}

/** Asks the members with a path; 409 when there are none or nothing could be sent. */
function sendReferralAsk(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  vacancy: MatchedVacancyItem,
) {
  const companyName = vacancy.cluster.canonicalCompany.trim();
  const companyKey = candidateCompanyKey(companyName);
  const members = deps.networkIndexRepo!.membersWithPathsInto(companyKey, candidateId, (memberId) =>
    memberSharesContacts(deps, memberId),
  );
  if (members.length === 0) {
    return sendError(
      reply,
      request,
      409,
      'no_platform_paths',
      'Путей через участников платформы в эту компанию нет.',
      false,
    );
  }
  deps.referralRequestRepo!.request(
    candidateId,
    members,
    { companyKey, companyName, vacancyTitle: vacancy.cluster.canonicalTitle },
    new Date().toISOString(),
  );
  const { status } = platformReferralFor(deps, candidateId, companyName);
  if (status === 'none') {
    // Nothing was sent (caps or earlier declines): say so instead of «отправлено».
    return sendError(
      reply,
      request,
      409,
      'referral_not_sent',
      'Сейчас запрос отправить нельзя: участники не принимают новые запросы.',
      false,
    );
  }
  return { data: { status }, meta: { requestId: request.id } };
}

async function handleListIncoming(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = connectionCandidate(deps, request, reply, false);
  if (!candidate) return undefined;
  const repository = referralStorage(deps, request, reply);
  if (!repository) return undefined;
  const items = memberSharesContacts(deps, candidate.id)
    ? incomingItems(deps, candidate.id, repository.listIncoming(candidate.id))
    : [];
  return { data: { items }, meta: { requestId: request.id } };
}

function incomingItems(deps: RouteDeps, memberId: string, requests: readonly ReferralRequest[]) {
  // One read of the member's contacts per company, however many ask about it.
  const contactsByCompany = new Map<string, Array<{ fullName: string; roleTitle: string }>>();
  const contactsAt = (companyKey: string) => {
    const known = contactsByCompany.get(companyKey);
    if (known) return known;
    const people = memberPeopleAt(deps, memberId, companyKey).map((person) => ({
      fullName: person.fullName,
      roleTitle: person.roleTitle,
    }));
    contactsByCompany.set(companyKey, people);
    return people;
  };
  return requests.map((item) => {
    const requester = readReferralProfile(deps, item.requesterId);
    return {
      id: item.id,
      status: item.status,
      companyName: item.companyName,
      vacancyTitle: item.vacancyTitle,
      createdAt: item.createdAt,
      requester: {
        ...requester,
        linkedinUrl: item.status === 'accepted' ? requester.linkedinUrl : null,
      },
      contacts: contactsAt(item.companyKey),
    };
  });
}

async function handleAnswer(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = connectionCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const repository = referralStorage(deps, request, reply);
  if (!repository) return undefined;
  const requestId = requestIdSchema.safeParse((request.params as { requestId: string }).requestId);
  const body = answerSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_request',
      'Нужно решение: принять или отказаться.',
      false,
    );
  }
  const decision = body.data.decision === 'accept' ? 'accepted' : 'declined';
  const shares = memberSharesContacts(deps, candidate.id);
  const answered =
    requestId.success &&
    shares &&
    repository.answer(requestId.data, candidate.id, decision, new Date().toISOString());
  if (!answered) {
    return sendError(
      reply,
      request,
      404,
      'referral_request_not_found',
      'Запрос не найден или уже обработан.',
      false,
    );
  }
  return { data: { status: decision }, meta: { requestId: request.id } };
}
