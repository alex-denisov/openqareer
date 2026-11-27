import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  HH_APPLY_OUTCOMES,
  HH_CONSENTS_MAX,
  HH_COPY_KNOWN_MAX,
  HH_COPY_STAGES,
  HH_RESUME_ID,
  HH_RESUME_TEXT_MAX_LENGTH,
  HH_RESUME_TITLE_MAX_LENGTH,
  HH_RESUMES_MAX,
  HH_SECTION_PLACES_MAX,
  HH_SECTION_SKILLS_MAX,
  HH_SECTION_TEXT_MAX_LENGTH,
  HH_REVIEW_RESUMES_MAX,
  HH_REVIEW_TEXT_MAX_LENGTH,
  HH_VACANCY_ID,
  type HhResumeEdit,
  type HhResumeSnapshot,
} from '../../shared/hhCandidateSession';
import { APPLY_MANDATE_REQUIRED, APPLY_MANDATE_VERSION, hasApplyMandate } from '../candidate/applyMandate';
import type { SqliteApplyConsentJournal } from '../candidate/sqliteApplyConsentJournal';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { hhApplyGate, type HhApplyRefusal } from '../domain/hhApplyGate';
import { draftHhResumeEdits, hhResumeLanguage } from '../domain/hhResumeEdits';
import { localizeHhResumeEditsDetailed, type LocalizedHhEdits } from '../domain/hhResumeEditTranslation';
import { hasVariants, hhResumeVariantSubject } from '../domain/hhResumeVariant';
import { reviewHhResumes } from '../domain/hhResumeReview';
import { chooseHhResume, mergedContents, resumesForVacancy, saveHhCopy, titleRank, withoutOtherCopies } from './hhVacancyResume';
import { withHhEmployerNames } from '../domain/hhAboutCleanup';
import { cachedEdits, editsCacheKey, hhEditsInput, rememberEdits, readWithSections, selectedWithSections, type SelectedWithSections } from './hhResumeEditsInput';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolvePoolVacancyCluster } from '../vacancies/poolVacancyCluster';
import { sameVacancyTitle } from '../vacancies/vacancyIdentity';
import { resolveHhLoginNotice } from './b640HhSessionState';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B704: сессия кандидата hh.ru в приложении. Резюме читаются в окне hh.ru на машине
 * кандидата и сохраняются здесь запечатанными; отклик от его имени начинается только с его
 * подтверждения и в пределах суточного лимита, исход записывается один раз.
 */
type BoundDeps = RouteDeps & { readonly journal: SqliteApplyConsentJournal; readonly hh: SqliteHhSessionRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const resumeId = z.string().regex(HH_RESUME_ID);
const title = z.string().trim().min(1).max(HH_RESUME_TITLE_MAX_LENGTH);

const sectionText = z.string().trim().max(HH_SECTION_TEXT_MAX_LENGTH);
const sectionsSchema = z
  .object({
    title: z.string().trim().max(HH_RESUME_TITLE_MAX_LENGTH),
    about: sectionText,
    aboutRead: z.boolean().optional(),
    skills: z.array(z.string().trim().min(1).max(200)).max(HH_SECTION_SKILLS_MAX),
    places: z
      .array(
        z
          .object({ employer: z.string().trim().max(300), title: z.string().trim().max(300), period: z.string().trim().max(120), text: sectionText })
          .strict(),
      )
      .max(HH_SECTION_PLACES_MAX),
  })
  .strict();

const contentSchema = z
  .object({ id: resumeId, title, text: z.string().trim().min(1).max(HH_RESUME_TEXT_MAX_LENGTH), sections: sectionsSchema.optional() })
  .strict();

const snapshotSchema = z
  .object({
    resumes: z
      .array(
        z.object({ id: resumeId, title, updatedLabel: z.string().trim().max(120).optional() }).strict(),
      )
      .min(1)
      .max(HH_RESUMES_MAX),
    selected: contentSchema.nullable(),
    /** B678: содержимое остальных резюме списка для сверки с вакансией. */
    contents: z
      .array(contentSchema.extend({ text: z.string().trim().min(1).max(HH_REVIEW_TEXT_MAX_LENGTH) }))
      .max(HH_REVIEW_RESUMES_MAX)
      .optional(),
    /** Отклик на вакансию: прочитанное сохраняется, общий выбор резюме не меняется. */
    vacancyId: z.string().trim().min(1).max(512).optional(),
    /** B704: `false` — выбор из прочитанного раньше, hh.ru не читали. */
    contentRead: z.literal(false).optional(),
  })
  .strict()
  .refine((value) => !value.selected || value.resumes.some((item) => item.id === value.selected?.id), {
    message: 'selected_not_listed',
  })
  .refine(
    (value) => (value.contents ?? []).every((content) => value.resumes.some((item) => item.id === content.id)),
    { message: 'content_not_listed' },
  );

const reviewQuerySchema = z.object({ vacancyId: z.string().trim().min(1).max(512) });

/** `edits=1` — лист выбора резюме: счёт правок может звать переводчика, карточке вакансии он не нужен. */
const reviewCountsSchema = reviewQuerySchema.extend({ edits: z.literal('1').optional() });

const choiceSchema = z.object({ vacancyId: z.string().trim().min(1).max(512), resumeId }).strict();

const copySchema = z
  .object({
    vacancyId: z.string().trim().min(1).max(512),
    copy: z
      .object({
        sourceId: resumeId,
        knownIds: z.array(resumeId).min(1).max(HH_COPY_KNOWN_MAX),
        stage: z.enum(HH_COPY_STAGES),
        copyId: resumeId.optional(),
      })
      .strict()
      .refine((copy) => copy.knownIds.includes(copy.sourceId), { message: 'source_not_listed' })
      .refine((copy) => !copy.copyId || !copy.knownIds.includes(copy.copyId), { message: 'not_a_copy' })
      .refine((copy) => copy.stage === 'creating' || Boolean(copy.copyId), { message: 'copy_id_missing' })
      .nullable(),
  })
  .strict();

const attemptSchema = z
  .object({
    vacancyId: z.string().regex(HH_VACANCY_ID),
    resumeId,
    confirmed: z.literal(true),
    /** Название вакансии с экрана отклика: на вакансию hh.ru с другим названием отклик не уходит. */
    vacancyTitle: z.string().trim().min(1).max(500).optional(),
    /** Карточка платформы: пока отклик уходит, её цель не меняется (B787). */
    cardId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const resultSchema = z
  .object({
    outcome: z.enum(HH_APPLY_OUTCOMES),
    failureCode: z.string().regex(/^[a-z0-9_]{1,64}$/u).optional(),
    /** B708: вакансия, на странице которой виден отклик, завершённый кандидатом в окне hh.ru. */
    vacancyId: z.string().regex(HH_VACANCY_ID).optional(),
    /** B787: галочки согласия, поставленные в форме работодателя. */
    consents: z
      .array(z.object({ text: z.string().trim().min(1).max(500), url: z.url({ protocol: /^https$/u }).max(2048).nullish() }).strict())
      .max(HH_CONSENTS_MAX)
      .optional(),
    employer: z.string().trim().max(300).optional(),
    applicationId: z.string().min(1).max(100).optional(),
  })
  .strict();

const REFUSAL_REPLY: Readonly<Record<HhApplyRefusal, readonly [number, string]>> = {
  hh_resumes_not_read: [409, 'Сначала выберите резюме hh.ru.'],
  hh_resume_not_in_session: [409, 'Этого резюме нет среди ваших резюме на hh.ru. Выберите его заново.'],
  hh_copy_not_ready: [409, 'Резюме под вакансию ещё не готово. Повторите его создание.'],
  hh_apply_in_progress: [409, 'Отклик на эту вакансию уже отправляется.'],
  hh_already_applied: [409, 'Вы уже откликнулись на эту вакансию через hh.ru.'],
  hh_daily_limit_reached: [429, 'На сегодня отклики через hh.ru закончились. Завтра можно продолжить.'],
  hh_cooldown: [429, 'hh.ru просил проверку. Следующий отклик через hh.ru — через час.'],
};

export function hhCandidateOf(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const getResumes: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const snapshot = deps.hh.getSnapshot(candidateId);
  const query = reviewQuerySchema.safeParse(request.query ?? {});
  const vacancyId = query.success ? query.data.vacancyId : undefined;
  return { data: snapshot ? visibleResumes(deps, snapshot, vacancyId) : null, meta: { requestId: request.id } };
};

/** B678: тексты остальных резюме нужны только сверке на сервере, в интерфейс они не уходят. */
function visibleResumes(deps: RouteDeps, snapshot: HhResumeSnapshot, vacancyId: string | undefined) {
  const shown = vacancyId ? resumesForVacancy(deps, snapshot, vacancyId) : snapshot;
  const { contents: _contents, choices: _choices, copies, ...visible } = shown;
  const copy = vacancyId ? copies?.[vacancyId] : undefined;
  return copy ? { ...visible, copy } : visible;
}

/** Выбор резюме для одной вакансии: другие вакансии и общий выбор не меняются. */
const putChoice: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = choiceSchema.safeParse(request.body ?? {});
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_hh_choice', 'Выберите резюме hh.ru.', false);
  const { vacancyId, resumeId: chosen } = parsed.data;
  const snapshot = deps.hh.getSnapshot(candidateId);
  if (!snapshot?.resumes.some((item) => item.id === chosen)) {
    const [status, message] = REFUSAL_REPLY.hh_resume_not_in_session;
    return sendError(reply, request, status, 'hh_resume_not_in_session', message, false);
  }
  const next = chooseHhResume(snapshot, vacancyId, chosen);
  deps.hh.saveSnapshot(candidateId, next);
  return { data: visibleResumes(deps, next, vacancyId), meta: { requestId: request.id } };
};

/** B787: что известно о копии под вакансию; `null` — копии больше нет. */
const putCopy: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = copySchema.safeParse(request.body ?? {});
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_hh_copy', 'Резюме под вакансию не создано. Повторите.', false);
  const snapshot = deps.hh.getSnapshot(candidateId);
  if (!snapshot) {
    const [status, message] = REFUSAL_REPLY.hh_resumes_not_read;
    return sendError(reply, request, status, 'hh_resumes_not_read', message, false);
  }
  const { vacancyId, copy } = parsed.data;
  const next = saveHhCopy(snapshot, vacancyId, copy);
  deps.hh.saveSnapshot(candidateId, next);
  return { data: visibleResumes(deps, next, vacancyId), meta: { requestId: request.id } };
};

/** Общий выбор: прежний, если резюме ещё в списке; прочитанное заново обновляет его текст. */
function commonSelected(
  previous: HhResumeSnapshot | null,
  read: HhResumeSnapshot['selected'],
  listed: ReadonlySet<string>,
): HhResumeSnapshot['selected'] {
  const kept = previous?.selected && listed.has(previous.selected.id) ? previous.selected : null;
  return !kept || kept.id === read?.id ? read : kept;
}

const putResumes: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = snapshotSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_resumes', 'Резюме hh.ru не прочитались. Повторите.', false);
  }
  const { contents = [], contentRead, vacancyId, ...rest } = parsed.data;
  const previous = deps.hh.getSnapshot(candidateId);
  // B704: дата чтения меняется, только когда прочитано содержимое, а не выбор и не список.
  const read = contentRead !== false && parsed.data.contents?.length !== 0;
  const listed = new Set(rest.resumes.map((item) => item.id));
  const snapshot: HhResumeSnapshot = {
    ...rest,
    ...(vacancyId ? { selected: commonSelected(previous, rest.selected, listed) } : {}),
    ...mergedContents(previous, listed, vacancyId && rest.selected ? [rest.selected, ...contents.filter(({ id }) => id !== rest.selected?.id)] : contents),
    ...(previous?.choices ? { choices: previous.choices } : {}),
    ...(previous?.copies ? { copies: previous.copies } : {}),
    readAt: (read ? null : previous?.readAt) ?? new Date().toISOString(),
  };
  deps.hh.saveSnapshot(candidateId, snapshot);
  // B690: резюме прочитаны в окне hh.ru — вход жив, уведомление «вход истёк» больше не нужно.
  resolveHhLoginNotice(deps, request, candidateId);
  return { data: visibleResumes(deps, snapshot, vacancyId), meta: { requestId: request.id } };
};

/** B678: какое из прочитанных резюме hh.ru подходит вакансии платформы и чего в каждом не хватает. */
const getReview: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const query = reviewCountsSchema.safeParse(request.query ?? {});
  if (!query.success) {
    return sendError(reply, request, 400, 'invalid_hh_review', 'Не указана вакансия.', false);
  }
  const snapshot = deps.hh.getSnapshot(candidateId);
  if (!snapshot) {
    const [status, message] = REFUSAL_REPLY.hh_resumes_not_read;
    return sendError(reply, request, status, 'hh_resumes_not_read', message, false);
  }
  const { vacancyId, edits } = query.data;
  const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const review = reviewHhResumes(withoutOtherCopies(snapshot, vacancyId), cluster.skills, titleRank(cluster.canonicalTitle));
  if (!edits) return { data: { vacancyId, ...review }, meta: { requestId: request.id } };
  const counts = await editCounts(deps, candidateId, snapshot, cluster, vacancyId);
  const resumes = review.resumes.map((fit) => {
    const editCount = counts.get(fit.resumeId);
    return editCount === undefined ? fit : { ...fit, editCount };
  });
  return { data: { vacancyId, ...review, resumes }, meta: { requestId: request.id } };
};

/** На перевод «станет» на язык резюме — не дольше, чем кандидат ждёт открытия разбора. */
const EDITS_TRANSLATION_BUDGET_MS = 8_000;
const RESUMES_BODY_LIMIT = 1_048_576;

async function freshEdits(
  deps: RouteDeps,
  candidateId: string,
  selected: SelectedWithSections,
  cluster: VacancyCluster,
  vacancyId: string,
): Promise<LocalizedHhEdits> {
  const drafts = draftHhResumeEdits(hhEditsInput(deps, candidateId, selected, cluster, vacancyId));
  const language = hhResumeLanguage(selected.sections);
  const localized = await localizeHhResumeEditsDetailed(drafts, language, deps.experienceFactRewriter, EDITS_TRANSLATION_BUDGET_MS);
  if (language !== 'ru') return localized;
  const employers = selected.sections.places.map((place) => place.employer);
  const named = (edits: readonly HhResumeEdit[]) => withHhEmployerNames(edits, employers);
  return { ...localized, edits: named(localized.edits), settled: localized.settled.then(named) };
}

/**
 * B787: перевод не уложился в срок — неполный результат не кэшируется (иначе 10 минут правок нет),
 * а дошедший перевод кладётся в кэш: следующий запрос получит все правки сразу.
 */
const editsInFlight = new Map<string, Promise<readonly HhResumeEdit[]>>();

export function editsPending(key: string): boolean {
  return editsInFlight.has(key);
}

export async function hhResumeEditsOf(
  deps: RouteDeps,
  candidateId: string,
  resume: SelectedWithSections,
  cluster: VacancyCluster,
  vacancyId: string,
): Promise<readonly HhResumeEdit[]> {
  const key = editsCacheKey(candidateId, hhEditsInput(deps, candidateId, resume, cluster, vacancyId), vacancyId);
  const cached = cachedEdits(key);
  if (cached) return cached;
  if (editsInFlight.has(key)) return [];
  const localized = await freshEdits(deps, candidateId, resume, cluster, vacancyId);
  if (localized.complete) {
    rememberEdits(key, localized.edits);
    return localized.edits;
  }
  const settled = localized.settled
    .then((edits) => {
      rememberEdits(key, edits);
      return edits;
    })
    .catch((error: unknown) => {
      console.error('[hh-edits] translation failed', { error: error instanceof Error ? error.message : String(error) });
      return localized.edits;
    })
    .finally(() => editsInFlight.delete(key));
  editsInFlight.set(key, settled);
  return localized.edits;
}

/** B682: ключ вариантов у правок с «Другим вариантом»; считается по правке до перевода. */
export function withVariantSubjects(
  deps: RouteDeps,
  candidateId: string,
  resume: SelectedWithSections,
  cluster: VacancyCluster,
  vacancyId: string,
  edits: readonly HhResumeEdit[],
): HhResumeEdit[] {
  const drafts = draftHhResumeEdits(hhEditsInput(deps, candidateId, resume, cluster, vacancyId));
  const subjects = new Map(drafts.filter(hasVariants).map((draft) => [draft.id, hhResumeVariantSubject(vacancyId, resume.id, draft)]));
  return edits.map((edit) => {
    const subjectId = subjects.get(edit.id);
    return subjectId ? { ...edit, variantOf: { vacancyId, subjectId } } : edit;
  });
}

/** Число правок у каждого прочитанного резюме — то же, что откроет разбор; сбой одного сверку не роняет. */
async function editCounts(
  deps: BoundDeps,
  candidateId: string,
  snapshot: HhResumeSnapshot,
  cluster: VacancyCluster,
  vacancyId: string,
): Promise<ReadonlyMap<string, number>> {
  const counted = await Promise.allSettled(
    readWithSections(snapshot).map(async (resume) => {
      const edits = await hhResumeEditsOf(deps, candidateId, resume, cluster, vacancyId);
      return [resume.id, edits.length] as const;
    }),
  );
  return new Map(counted.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
}

/** B678: правки выбранного резюме hh.ru «было → станет» по подтверждённому профилю платформы. */
const getEdits: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const query = reviewQuerySchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_hh_review', 'Не указана вакансия.', false);
  const snapshot = deps.hh.getSnapshot(candidateId);
  const selected = selectedWithSections(snapshot && resumesForVacancy(deps, snapshot, query.data.vacancyId));
  if (!selected) {
    return sendError(reply, request, 409, 'hh_resume_sections_missing', 'Выберите резюме hh.ru ещё раз: его разделы не прочитаны.', false);
  }
  const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, query.data.vacancyId);
  if (!cluster) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const { vacancyId } = query.data;
  const found = await hhResumeEditsOf(deps, candidateId, selected, cluster, vacancyId);
  const edits = withVariantSubjects(deps, candidateId, selected, cluster, vacancyId, found);
  // B787: перевод ещё идёт — экран повторит запрос, а не покажет «правок нет».
  const pending = editsPending(editsCacheKey(candidateId, hhEditsInput(deps, candidateId, selected, cluster, vacancyId), vacancyId));
  return { data: { resumeId: selected.id, vacancyId, edits, ...(pending ? { pending } : {}) }, meta: { requestId: request.id } };
};

const postAttempt: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = attemptSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_apply', 'Подтвердите отклик и выберите резюме.', false);
  }
  const now = new Date();
  const { vacancyId, resumeId: chosen, vacancyTitle, cardId } = parsed.data;
  const record = deps.multiSourceEngine.getVacancy?.(`src-hh-search:${vacancyId}`);
  if (vacancyTitle && record && !sameVacancyTitle(vacancyTitle, record.title)) {
    return sendError(reply, request, 409, 'hh_vacancy_mismatch', 'На hh.ru по этому адресу другая вакансия. Отклик не отправлен.', false);
  }
  const gate = hhApplyGate({
    snapshot: deps.hh.getSnapshot(candidateId),
    resumeId: chosen,
    recent: deps.hh.recentAttempts(candidateId, now),
    forVacancy: deps.hh.attemptsFor(candidateId, vacancyId),
    now,
  });
  if (!gate.ok) {
    const [status, message] = REFUSAL_REPLY[gate.refusal];
    return sendError(reply, request, status, gate.refusal, message, false);
  }
  if (!hasApplyMandate(deps.capabilityConsentStore, candidateId)) {
    return sendError(reply, request, 403, APPLY_MANDATE_REQUIRED, 'Для отклика от вашего имени нужно ваше согласие.', false);
  }
  const attemptId = deps.hh.startAttempt(candidateId, { vacancyId, resumeId: chosen, cardId, now });
  return reply.status(201).send({
    data: { attemptId, remainingToday: gate.remainingToday, consent: true },
    meta: { requestId: request.id },
  });
};

const consentIds = (attemptId: string): readonly string[] =>
  Array.from({ length: HH_CONSENTS_MAX }, (_, position) => `${attemptId}:${position}`);

/** B787: галочки попадают в журнал, только если форма ушла или могла уйти; отклик начат по поручению. */
function journalConsents(
  journal: SqliteApplyConsentJournal,
  candidateId: string,
  attemptId: string,
  { consents = [], outcome, failureCode, employer, applicationId }: z.infer<typeof resultSchema>,
  now: Date,
): void {
  if (outcome === 'failed' && failureCode !== 'no_confirmation') return;
  const ids = consentIds(attemptId);
  consents.forEach(({ text, url }, position) => {
    const id = ids[position]!;
    journal.append(
      candidateId,
      {
        id,
        applicationId: applicationId && journal.ownsApplication(candidateId, applicationId) ? applicationId : null,
        host: 'hh.ru',
        employer: employer || 'hh.ru',
        checkboxText: text,
        policyUrl: url ?? null,
        policySha256: null,
        checkboxLabel: text,
        command: 'Отправить отклик',
      },
      { mandateVersion: APPLY_MANDATE_VERSION, now },
    );
    journal.appendResult(candidateId, id, outcome === 'failed' ? 'unconfirmed' : 'sent', now);
  });
}

const postResult: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const { attemptId } = request.params as { attemptId: string };
  const parsed = resultSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_apply_result', 'Исход отклика не записался.', false);
  }
  const stored = deps.hh.getAttempt(candidateId, attemptId);
  if (!stored) {
    return sendError(reply, request, 404, 'hh_apply_not_found', 'Такого отклика нет.', false);
  }
  const { outcome, failureCode, vacancyId } = parsed.data;
  const now = new Date();
  const otherVacancy = vacancyId !== undefined && vacancyId !== stored.vacancyId;
  // Журнал до исхода: прерванная запись повторится вместе с ним, номера записей те же.
  if (!otherVacancy && stored.outcome === null) journalConsents(deps.journal, candidateId, attemptId, parsed.data, now);
  const written =
    !otherVacancy &&
    (deps.hh.finishAttempt(candidateId, attemptId, { outcome, failureCode: failureCode ?? null, now }) ||
      (outcome === 'sent' &&
        vacancyId !== undefined &&
        deps.hh.markSentLater(candidateId, attemptId, { vacancyId, now })));
  if (!written) {
    return sendError(reply, request, 409, 'hh_apply_finished', 'Исход этого отклика уже записан.', false);
  }
  if (outcome === 'sent' && stored.outcome !== null) {
    for (const id of consentIds(attemptId)) deps.journal.appendResult(candidateId, id, 'sent', now);
  }
  return { data: { attemptId, outcome: parsed.data.outcome }, meta: { requestId: request.id } };
};

export function registerHhSessionRoutes(
  app: FastifyInstance,
  deps: RouteDeps & { readonly journal: SqliteApplyConsentJournal },
): void {
  const repository = new SqliteHhSessionRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  app.addHook('onClose', async () => repository.close());
  const bound: BoundDeps = { ...deps, hh: repository };
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const base = '/api/v1/candidate/hh';
  app.get(`${base}/resumes`, withDeps(bound, getResumes));
  // Снимок с разделами и текстами до 5 резюме кириллицей (2 байта на символ) больше общего предела 256 КБ.
  app.put(`${base}/resumes`, { ...write, bodyLimit: RESUMES_BODY_LIMIT }, withDeps(bound, putResumes));
  app.put(`${base}/resumes/choice`, write, withDeps(bound, putChoice));
  app.put(`${base}/resumes/copy`, write, withDeps(bound, putCopy));
  app.get(`${base}/resumes/review`, withDeps(bound, getReview));
  app.get(`${base}/resumes/edits`, withDeps(bound, getEdits));
  app.post(`${base}/applications`, write, withDeps(bound, postAttempt));
  app.post(`${base}/applications/:attemptId/result`, write, withDeps(bound, postResult));
}
