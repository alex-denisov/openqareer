import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  QUESTIONNAIRE_ANSWER_MAX_LENGTH,
  QUESTIONNAIRE_MAX_QUESTIONS,
  type ApplicationQuestionnaire,
  type QuestionnaireQuestion,
} from '../../shared/applicationQuestionnaire';
import {
  SqliteQuestionnaireRepository,
  type StoredQuestionnaire,
} from '../candidate/sqliteQuestionnaireRepository';
import { buildQuestionnaire, cleanAnswers } from '../domain/applicationQuestionnaire';
import { greenhouseJobRef, readGreenhouseQuestions } from '../vacancies/greenhouseQuestions';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B641: анкета работодателя для нового кабинета. Маршруты начинаются с `requireCabinetB640`:
 * без флага отвечают как несуществующий адрес и ничего не пишут. Вопросы читаются только из
 * открытого источника площадки; на площадку от имени кандидата ничего не отправляется.
 */
export interface QuestionnaireSource {
  readonly questions: readonly QuestionnaireQuestion[] | null;
  readonly formUrl: string | null;
}
export type QuestionnaireReader = (vacancyId: string) => Promise<QuestionnaireSource | null>;

export type QuestionnaireRouteDeps = RouteDeps & {
  readonly questionnaireRepository?: SqliteQuestionnaireRepository;
  /** Откуда читать вопросы; по умолчанию — запись подбора и открытый API Greenhouse. */
  readonly questionnaireReader?: QuestionnaireReader;
};

type BoundDeps = RouteDeps & {
  readonly forms: SqliteQuestionnaireRepository;
  readonly reader: QuestionnaireReader;
};
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const VACANCY_ID_MAX_LENGTH = 200;
/** Через сутки вопросы читаются заново; анкета с ответами кандидата не перечитывается. */
const QUESTIONS_TTL_MS = 24 * 60 * 60 * 1000;

function fresh(stored: StoredQuestionnaire, now: number): boolean {
  if (stored.answers.length > 0 || stored.submittedAt) return true;
  return now - new Date(stored.readAt).getTime() < QUESTIONS_TTL_MS;
}
const answersSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: z.string().min(1).max(100),
            text: z.string().max(QUESTIONNAIRE_ANSWER_MAX_LENGTH),
          })
          .strict(),
      )
      .max(QUESTIONNAIRE_MAX_QUESTIONS),
  })
  .strict();

const FORM_URL_MAX_LENGTH = 2048;

/** Ссылка на страницу анкеты: только https, без логина в адресе и разумной длины. */
function safeUrl(url: string | undefined): string | null {
  if (!url || url.length > FORM_URL_MAX_LENGTH) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Вопросы по записи подбора: читаем заранее только у Greenhouse. */
function poolReader(deps: RouteDeps): QuestionnaireReader {
  return async (vacancyId) => {
    const vacancy = deps.multiSourceEngine.getVacancy?.(vacancyId.replace(/^cluster-/u, ''));
    if (!vacancy) return null;
    const ref = greenhouseJobRef(vacancy);
    const formUrl = safeUrl(vacancy.url);
    return ref ? { questions: await readGreenhouseQuestions(ref), formUrl } : { questions: null, formUrl };
  };
}

interface Signed {
  readonly candidateId: string;
  readonly vacancyId: string;
}

function signed(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): Signed | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  const vacancyId = (request.params as { id: string }).id;
  if (!vacancyId || vacancyId.length > VACANCY_ID_MAX_LENGTH) {
    sendError(reply, request, 400, 'invalid_vacancy_id', 'Проверьте вакансию.', false);
    return null;
  }
  return { candidateId: principal.candidate.id, vacancyId };
}

function view(
  deps: BoundDeps,
  who: Signed,
  stored: StoredQuestionnaire | null,
  fallback: { readonly state: ApplicationQuestionnaire['state']; readonly formUrl: string | null },
): ApplicationQuestionnaire {
  return buildQuestionnaire({
    vacancyId: who.vacancyId,
    state: stored ? 'ready' : fallback.state,
    formUrl: stored?.formUrl ?? fallback.formUrl,
    questions: stored?.questions ?? [],
    answers: stored?.answers ?? [],
    profile: deps.candidateStore.decisionProfileRepo.get(who.candidateId),
    readAt: stored?.readAt ?? null,
    submittedAt: stored?.submittedAt ?? null,
  });
}

const getQuestionnaire: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const known = deps.forms.get(who.candidateId, who.vacancyId);
  if (known && fresh(known, Date.now())) {
    return { data: view(deps, who, known, { state: 'ready', formUrl: null }), meta: { requestId: request.id } };
  }
  const source = await deps.reader(who.vacancyId);
  // Пустой список тоже запоминаем: вакансию без анкеты не читаем у площадки при каждом заходе.
  if (source?.questions) {
    deps.forms.saveQuestions(who.candidateId, who.vacancyId, {
      questions: source.questions,
      formUrl: source.formUrl,
      readAt: new Date().toISOString(),
    });
  }
  const stored = deps.forms.get(who.candidateId, who.vacancyId);
  // Вопросы не отдаются заранее, но страница отклика известна: анкету откроют там.
  const unread = !stored && source && source.questions === null && source.formUrl;
  const state = unread ? 'unreadable' : 'none';
  return {
    data: view(deps, who, stored, { state, formUrl: source?.formUrl ?? null }),
    meta: { requestId: request.id },
  };
};

const putAnswers: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const parsed = answersSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_questionnaire_answers', 'Проверьте ответы.', false);
  }
  const stored = deps.forms.get(who.candidateId, who.vacancyId);
  if (!stored) {
    return sendError(reply, request, 404, 'questionnaire_not_found', 'Анкета не найдена.', false);
  }
  const answers = cleanAnswers(stored.questions, parsed.data.answers);
  deps.forms.saveAnswers(who.candidateId, who.vacancyId, answers);
  return {
    data: view(deps, who, { ...stored, answers }, { state: 'ready', formUrl: null }),
    meta: { requestId: request.id },
  };
};

const postSubmitted: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const at = new Date().toISOString();
  if (!deps.forms.markSubmitted(who.candidateId, who.vacancyId, at)) {
    return sendError(reply, request, 404, 'questionnaire_not_found', 'Анкета не найдена.', false);
  }
  return { data: { submittedAt: at }, meta: { requestId: request.id } };
};

export function registerQuestionnaireRoutes(app: FastifyInstance, deps: QuestionnaireRouteDeps): void {
  const repository =
    deps.questionnaireRepository ??
    new SqliteQuestionnaireRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
  if (!deps.questionnaireRepository) app.addHook('onClose', async () => repository.close());
  const bound: BoundDeps = {
    ...deps,
    forms: repository,
    reader: deps.questionnaireReader ?? poolReader(deps),
  };
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const base = '/api/v1/candidate/vacancies/:id/questionnaire';
  app.get(base, withDeps(bound, getQuestionnaire));
  app.put(`${base}/answers`, write, withDeps(bound, putAnswers));
  app.post(`${base}/submitted`, write, withDeps(bound, postSubmitted));
}
