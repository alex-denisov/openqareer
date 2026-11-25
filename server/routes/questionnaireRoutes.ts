import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  QUESTIONNAIRE_ANSWER_MAX_LENGTH,
  QUESTIONNAIRE_MAX_QUESTIONS,
  type ApplicationQuestionnaire,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
} from '../../shared/applicationQuestionnaire';
import {
  SqliteQuestionnaireRepository,
  type StoredQuestionnaire,
} from '../candidate/sqliteQuestionnaireRepository';
import {
  DEFAULT_DECISION_PROFILE,
  type CandidateDecisionProfile,
} from '../../shared/workPreferences';
import { hhFormUrl } from '../../shared/hhCandidateSession';
import {
  answersToStore,
  atsQuestions,
  buildQuestionnaire,
  carryAnswers,
  hhQuestions,
  withKnownAnswers,
} from '../domain/applicationQuestionnaire';
import {
  linkedinProfileLink,
  type QuestionnaireProfileFacts,
} from '../domain/questionnaireProfileAnswers';
import { learnedWorkRights, mergeWorkRights, withdrawnCountries } from '../domain/workRightAnswers';
import type { SalaryMarketInput } from '../domain/salaryMarketAnswer';
import { getCurrencyRates } from '../currency/cbrRates';
import { readMarketSnapshot } from '../salaryMarket/readMarketSnapshot';
import { salaryGeography } from '../salaryMarket/salaryMarketGeography';
import { boardFormRef, readBoardFormQuestions } from '../vacancies/boardFormReader';
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

/** До возврата B641 варианты обрезались на этом числе: такой список мог сохраниться неполным. */
const LEGACY_OPTIONS_CUT = 30;
/** Прочитанное с этого момента уже не обрезано: список ровно из 30 вариантов — полный. */
const FULL_OPTIONS_SINCE = Date.parse('2026-11-25T00:00:00.000Z');

export function isQuestionnaireFresh(stored: StoredQuestionnaire, now: number): boolean {
  if (stored.submittedAt) return true;
  const readAt = new Date(stored.readAt).getTime();
  // Обрезанный список перечитывается сразу, а не через сутки.
  const cut =
    readAt < FULL_OPTIONS_SINCE &&
    stored.questions.some((question) => question.options?.length === LEGACY_OPTIONS_CUT);
  if (cut) return false;
  // Пустой ответ — только отметка «стёрто»: вопросы из-за него не закрепляются.
  if (stored.answers.some((answer) => answer.text)) return true;
  return now - readAt < QUESTIONS_TTL_MS;
}

/** Повторное чтение берёт свежие вопросы и не теряет те, на которые кандидат уже ответил. */
export function mergeReadQuestions(
  known: Pick<StoredQuestionnaire, 'questions' | 'answers'> | null,
  fresh: readonly QuestionnaireQuestion[],
): readonly QuestionnaireQuestion[] {
  const freshIds = new Set(fresh.map((question) => question.id));
  const answered = new Set(
    known?.answers.filter((answer) => answer.text).map((answer) => answer.questionId),
  );
  const kept = known?.questions.filter(({ id }) => answered.has(id) && !freshIds.has(id)) ?? [];
  return [...fresh.slice(0, QUESTIONNAIRE_MAX_QUESTIONS - kept.length), ...kept];
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

/** Вариантов во всей анкете: строка остаётся в пределах десятков килобайт. */
const HH_FORM_MAX_OPTIONS = 600;

/** Вопросы, прочитанные приложением в окне hh.ru кандидата. */
const hhFormSchema = z
  .object({
    url: z.string().max(FORM_URL_MAX_LENGTH),
    questions: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            required: z.boolean(),
            kind: z.enum(['text', 'choice']),
            options: z.array(z.string().min(1).max(200)).max(200).optional(),
            multiple: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(QUESTIONNAIRE_MAX_QUESTIONS),
  })
  .strict()
  .refine(
    ({ questions }) =>
      questions.reduce((sum, item) => sum + (item.options?.length ?? 0), 0) <= HH_FORM_MAX_OPTIONS,
  );

/** Вопросы формы работодателя: список стран в ней — около 250 вариантов. */
const ATS_FORM_MAX_OPTIONS = 1_500;
const limitNumber = z.number().finite().nullable();
const numberLimitsSchema = z
  .object({
    min: limitNumber,
    max: limitNumber,
    step: z.number().positive().nullable(),
    unit: z.string().max(20).nullable(),
  })
  .strict();
const atsFormSchema = z
  .object({
    url: z.string().max(FORM_URL_MAX_LENGTH),
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_\-[\]]{1,100}$/u),
            text: z.string().min(1).max(500),
            required: z.boolean(),
            kind: z.enum(['text', 'choice']),
            singleLine: z.boolean().optional(),
            numeric: z.boolean().optional(),
            limits: numberLimitsSchema.optional(),
            options: z.array(z.string().min(1).max(200)).max(300).optional(),
            multiple: z.boolean().optional(),
            known: z.string().max(QUESTIONNAIRE_ANSWER_MAX_LENGTH).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(QUESTIONNAIRE_MAX_QUESTIONS),
  })
  .strict()
  .refine(
    ({ questions }) =>
      questions.reduce((sum, item) => sum + (item.options?.length ?? 0), 0) <= ATS_FORM_MAX_OPTIONS,
  );

/** Ссылка на страницу анкеты: только https, без логина в адресе и разумной длины. */
function safeUrl(url: string | undefined): string | null {
  if (!url || url.length > FORM_URL_MAX_LENGTH) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Вопросы по записи подбора: заранее читаем Greenhouse, Recruitee и Teamtailor. */
export function poolReader(deps: RouteDeps): QuestionnaireReader {
  return async (vacancyId) => {
    const vacancy = deps.multiSourceEngine.getVacancy?.(vacancyId.replace(/^cluster-/u, ''));
    if (!vacancy) return null;
    const ref = greenhouseJobRef(vacancy);
    const formUrl = safeUrl(vacancy.url);
    if (ref) return { questions: await readGreenhouseQuestions(ref), formUrl };
    const form = boardFormRef(vacancy.url);
    return { questions: form ? await readBoardFormQuestions(form) : null, formUrl };
  };
}

export interface Signed {
  readonly candidateId: string;
  readonly vacancyId: string;
  /** Подтверждённая почта аккаунта: запасная, если в контактах профиля почты нет. */
  readonly accountEmail: string | null;
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
  return {
    candidateId: principal.candidate.id,
    vacancyId,
    accountEmail: principal.emailVerified === false ? null : principal.email,
  };
}

/** Название и компания вакансии из подбора: экрану не приходится писать «Вакансия». */
function vacancyLabel(
  deps: RouteDeps,
  vacancyId: string,
): { readonly vacancyTitle?: string; readonly vacancyCompany?: string } {
  const cluster = deps.multiSourceEngine.getActiveCluster?.(vacancyId);
  const vacancy = deps.multiSourceEngine.getVacancy?.(vacancyId.replace(/^cluster-/u, ''));
  const title = (cluster?.canonicalTitle ?? vacancy?.title ?? '').trim();
  const company = (cluster?.canonicalCompany ?? vacancy?.company ?? '').trim();
  return {
    ...(title ? { vacancyTitle: title } : {}),
    ...(company ? { vacancyCompany: company } : {}),
  };
}

/** Ссылка из контактов: с http(s) как есть, LinkedIn без схемы — полной, прочее не берём. */
function safeProfileLink(link: string): readonly string[] {
  const profile = linkedinProfileLink(link);
  if (profile) return [profile];
  return /^https?:\/\//u.test(link) ? [link] : [];
}

/** То, что в профиле записано дословно: контакты резюме и гражданство из условий поиска. */
function profileFacts(
  deps: RouteDeps,
  who: Signed,
  decision: CandidateDecisionProfile | null | undefined,
): QuestionnaireProfileFacts {
  const candidate = deps.candidateStore.getResumeCandidate(who.candidateId);
  const contact = candidate?.contact;
  const email = contact?.email?.trim() || who.accountEmail || undefined;
  return {
    ...(candidate?.fullName ? { fullName: candidate.fullName } : {}),
    ...(email ? { email } : {}),
    ...(contact?.phone ? { phone: contact.phone } : {}),
    ...(contact?.linkedinUrl ? { linkedinUrl: contact.linkedinUrl } : {}),
    ...(contact?.links ? { links: contact.links.flatMap(safeProfileLink) } : {}),
    ...(contact?.location ? { location: contact.location } : {}),
    ...(decision?.citizenship ? { citizenship: decision.citizenship } : {}),
    ...(decision?.workFormats.includes('relocation') ? { openToRelocation: true } : {}),
  };
}

/** Вакансия из подбора для вопроса о зарплате и праве на работу. */
function vacancyMarket(deps: RouteDeps, vacancyId: string): SalaryMarketInput | undefined {
  const cluster = deps.multiSourceEngine.getActiveCluster?.(vacancyId);
  const vacancy = deps.multiSourceEngine.getVacancy?.(vacancyId.replace(/^cluster-/u, ''));
  const title = cluster?.canonicalTitle ?? vacancy?.title;
  if (!title) return undefined;
  const source = vacancy?.provenance ?? cluster?.sources[0];
  const salary = vacancy?.salary ?? (cluster?.sources.length === 1 ? cluster.salary : undefined);
  return {
    vacancy: {
      title,
      location: vacancy?.location ?? cluster?.canonicalLocation ?? null,
      isRemote: vacancy?.isRemote ?? cluster?.isRemote ?? false,
      ...(salary ? { salary } : {}),
      ...(source ? { sourceName: source.sourceName ?? sourceHost(source.sourceUrl) } : {}),
      ...(source ? { observedAt: source.observedAt } : {}),
    },
    readSnapshot: (role) => readMarketSnapshot(deps.config.databasePath, role),
    rates: getCurrencyRates(),
  };
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function countryOf(market: SalaryMarketInput | undefined): string | undefined {
  if (!market) return undefined;
  return salaryGeography(market.vacancy.location, market.vacancy.isRemote).countryCode;
}

export function questionnaireView(
  deps: RouteDeps,
  who: Signed,
  stored: StoredQuestionnaire | null,
  fallback: { readonly state: ApplicationQuestionnaire['state']; readonly formUrl: string | null },
): ApplicationQuestionnaire {
  const decision = deps.candidateStore.decisionProfileRepo.get(who.candidateId);
  const market = vacancyMarket(deps, who.vacancyId);
  return buildQuestionnaire({
    vacancyId: who.vacancyId,
    workRights: decision?.workRights,
    vacancyCountry: countryOf(market),
    salaryMarket: market,
    ...vacancyLabel(deps, who.vacancyId),
    facts: profileFacts(deps, who, decision),
    state: stored ? 'ready' : fallback.state,
    formUrl: stored?.formUrl ?? fallback.formUrl,
    questions: stored?.questions ?? [],
    answers: stored?.answers ?? [],
    profile: decision,
    readAt: stored?.readAt ?? null,
    submittedAt: stored?.submittedAt ?? null,
  });
}

const getQuestionnaire: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const known = deps.forms.get(who.candidateId, who.vacancyId);
  // Список из окна приложения полнее открытого: его обновит само окно, иначе вопросы двоятся.
  const fromWindow = known?.questions.some(({ id }) => id.startsWith('ats-'));
  if (known && (fromWindow || isQuestionnaireFresh(known, Date.now()))) {
    return {
      data: questionnaireView(deps, who, known, { state: 'ready', formUrl: null }),
      meta: { requestId: request.id },
    };
  }
  const source = await deps.reader(who.vacancyId);
  // Пустой список тоже запоминаем: вакансию без анкеты не читаем у площадки при каждом заходе.
  if (source?.questions) {
    deps.forms.saveQuestions(who.candidateId, who.vacancyId, {
      questions: mergeReadQuestions(known, source.questions),
      formUrl: source.formUrl,
      readAt: new Date().toISOString(),
    });
  }
  const stored = deps.forms.get(who.candidateId, who.vacancyId);
  // Вопросы не отдаются заранее, но страница отклика известна: анкету откроют там.
  const unread = !stored && source && source.questions === null && source.formUrl;
  const state = unread ? 'unreadable' : 'none';
  return {
    data: questionnaireView(deps, who, stored, { state, formUrl: source?.formUrl ?? null }),
    meta: { requestId: request.id },
  };
};

/** Нетронутая рыночная цифра не сохраняется: она обновляется вместе с данными и со своим источником. */
function withoutLive(
  answers: readonly QuestionnaireAnswer[],
  shown: ApplicationQuestionnaire,
): readonly QuestionnaireAnswer[] {
  const live = new Map(
    shown.suggestions.filter((item) => item.live).map((item) => [item.questionId, item.text]),
  );
  return answers.filter((answer) => live.get(answer.questionId) !== answer.text);
}

/** Ответ кандидата о праве на работу остаётся в профиле для следующих анкет (B788). */
function rememberWorkRights(
  deps: RouteDeps,
  who: Signed,
  questions: readonly QuestionnaireQuestion[],
  answers: readonly QuestionnaireAnswer[],
  shown: ApplicationQuestionnaire,
): void {
  const before = new Map(shown.answers.map((answer) => [answer.questionId, answer.text]));
  const changed = new Map(
    answers
      .filter((answer) => before.get(answer.questionId) !== answer.text)
      .map((answer) => [answer.questionId, answer.text]),
  );
  const country = countryOf(vacancyMarket(deps, who.vacancyId));
  const learned = learnedWorkRights(questions, changed, country);
  const repo = deps.candidateStore.decisionProfileRepo;
  const profile = repo.get(who.candidateId) ?? DEFAULT_DECISION_PROFILE;
  const known = profile.workRights ?? [];
  const withdrawn = withdrawnCountries(questions, changed, known, country);
  const kept = known.filter((item) => !withdrawn.has(item.country));
  if (learned.length === 0 && kept.length === known.length) return;
  const workRights = mergeWorkRights(kept, learned);
  repo.put(who.candidateId, { ...profile, workRights }, new Date().toISOString());
}

const putAnswers: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const parsed = answersSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_questionnaire_answers',
      'Проверьте ответы.',
      false,
    );
  }
  const stored = deps.forms.get(who.candidateId, who.vacancyId);
  if (!stored) {
    return sendError(reply, request, 404, 'questionnaire_not_found', 'Анкета не найдена.', false);
  }
  const shown = questionnaireView(deps, who, stored, { state: 'ready', formUrl: null });
  const answers = withoutLive(answersToStore(stored.questions, parsed.data.answers), shown);
  rememberWorkRights(deps, who, stored.questions, answers, shown);
  deps.forms.saveAnswers(who.candidateId, who.vacancyId, answers);
  return {
    data: questionnaireView(deps, who, { ...stored, answers }, { state: 'ready', formUrl: null }),
    meta: { requestId: request.id },
  };
};

/** B641: анкета hh.ru видна только в сессии кандидата — её вопросы присылает приложение. */
const putHhForm: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const parsed = hhFormSchema.safeParse(request.body ?? {});
  const formUrl = parsed.success ? hhFormUrl(parsed.data.url) : null;
  const questions = parsed.success ? hhQuestions(parsed.data.questions) : [];
  if (!formUrl || questions.length === 0) {
    return sendError(
      reply,
      request,
      400,
      'invalid_hh_form',
      'Вопросы анкеты не прочитались.',
      false,
    );
  }
  const known = deps.forms.get(who.candidateId, who.vacancyId);
  deps.forms.saveQuestions(who.candidateId, who.vacancyId, {
    questions: mergeReadQuestions(known, questions),
    formUrl,
    readAt: new Date().toISOString(),
  });
  const stored = deps.forms.get(who.candidateId, who.vacancyId);
  return {
    data: questionnaireView(deps, who, stored, { state: 'none', formUrl: null }),
    meta: { requestId: request.id },
  };
};

/** B787: форма работодателя, прочитанная приложением, заменяет прежний список вопросов. */
const putAtsForm: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const parsed = atsFormSchema.safeParse(request.body ?? {});
  const formUrl = parsed.success ? safeUrl(parsed.data.url) : null;
  const questions = parsed.success ? atsQuestions(parsed.data.questions) : [];
  if (!parsed.success || !formUrl || questions.length === 0) {
    return sendError(
      reply,
      request,
      400,
      'invalid_ats_form',
      'Вопросы анкеты не прочитались.',
      false,
    );
  }
  const { candidateId, vacancyId } = who;
  const known = deps.forms.get(candidateId, vacancyId);
  deps.forms.saveQuestions(candidateId, vacancyId, {
    questions,
    formUrl,
    readAt: new Date().toISOString(),
  });
  const carried = carryAnswers(known?.questions ?? [], questions, known?.answers ?? []);
  const answers = withKnownAnswers(carried, parsed.data.questions);
  deps.forms.saveAnswers(candidateId, vacancyId, answers);
  const stored = deps.forms.get(candidateId, vacancyId);
  return {
    data: questionnaireView(deps, who, stored, { state: 'none', formUrl: null }),
    meta: { requestId: request.id },
  };
};

const postSubmitted: Handler = async (deps, request, reply) => {
  const who = signed(deps, request, reply);
  if (!who) return reply;
  const at = new Date().toISOString();
  const stored = deps.forms.get(who.candidateId, who.vacancyId);
  if (stored && !stored.submittedAt) {
    // Отправленное остаётся таким, каким ушло: рыночная цифра фиксируется.
    const sent = questionnaireView(deps, who, stored, { state: 'ready', formUrl: null });
    if (sent.suggestions.some((item) => item.live)) {
      const cleared = stored.answers.filter((answer) => !answer.text);
      deps.forms.saveAnswers(who.candidateId, who.vacancyId, [...sent.answers, ...cleared]);
    }
  }
  if (!deps.forms.markSubmitted(who.candidateId, who.vacancyId, at)) {
    return sendError(reply, request, 404, 'questionnaire_not_found', 'Анкета не найдена.', false);
  }
  return { data: { submittedAt: at }, meta: { requestId: request.id } };
};

export function registerQuestionnaireRoutes(
  app: FastifyInstance,
  deps: QuestionnaireRouteDeps,
): void {
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
  app.put(`${base}/ats-form`, write, withDeps(bound, putAtsForm));
  app.put(`${base}/hh-form`, write, withDeps(bound, putHhForm));
  app.post(`${base}/submitted`, write, withDeps(bound, postSubmitted));
}
