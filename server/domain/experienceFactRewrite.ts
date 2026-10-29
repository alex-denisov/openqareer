/**
 * The consultant rewrites what the candidate said into resume bullets
 * (owner, 29.10): a fact from the conversation is a fragment of speech
 * («Стало семь», «Из семи сменились») and never lands in the profile as is.
 * The model groups the facts by workplace and writes a few achievement
 * bullets per place; this module chooses its input, checks its answer and
 * applies the accepted rewrite to the draft. Every bullet cites the facts it
 * came from, and the facts themselves stay untouched in memory.
 */
import { z } from 'zod';
import {
  MAX_BULLETS_PER_PLACE,
  MAX_FACT_REWRITES,
  MAX_REWRITE_BULLETS,
  type ResumeDraft,
  type ResumeFactRewriteBullet,
  type ResumeFactRewriteRecord,
} from './resumeDraft';

export const EXPERIENCE_FACT_REWRITE_PROMPT_REVISION = 'experience-fact-rewrite-2026-10-29c';

/** The memory fields this step reads; both the server and the client records have them. */
export interface RewriteMemory {
  readonly id: string;
  readonly kind: string;
  readonly domain: string;
  readonly statement: string;
  readonly status: string;
  readonly provenance?: { readonly kind: string };
}

const PLACEABLE_DOMAINS = new Set(['responsibility', 'outcome', 'role-evidence', 'skill']);
const CONVERSATION_ORIGINS = new Set(['candidate', 'consultant']);
const MAX_FACTS_PER_REQUEST = 150;
const MAX_BULLETS_PER_REWRITE_PLACE = 8;
const MIN_BULLET_LENGTH = 12;
const MAX_BULLET_LENGTH = 320;

export interface RewritePlace {
  readonly experienceId: string;
  readonly employer: string;
  readonly title: string;
  readonly period: string;
  readonly existingBullets: readonly string[];
}

export interface RewriteFact {
  readonly id: string;
  readonly domain: string;
  readonly statement: string;
}

export interface FactRewriteRequest {
  readonly places: readonly RewritePlace[];
  readonly facts: readonly RewriteFact[];
}

export interface ProposedBullet {
  readonly text: string;
  readonly sourceFactIds: readonly string[];
}

export interface ProposedPlace {
  readonly experienceId: string;
  readonly bullets: readonly ProposedBullet[];
}

export interface FactRewriteProposal {
  readonly id: string;
  readonly places: readonly ProposedPlace[];
  /** Facts no bullet uses: fragments, doubts, or facts that fit no workplace. */
  readonly leftOutFactIds: readonly string[];
  readonly sourceFactIds: readonly string[];
}

function linkedMemoryIds(draft: ResumeDraft): Set<string> {
  const lists = [
    draft.skills,
    draft.education,
    draft.courses,
    draft.tests,
    draft.recommendations,
    draft.languages,
    draft.certifications,
    draft.projects,
    draft.achievements,
  ];
  return new Set(
    [
      draft.candidate.aboutMemoryId,
      ...draft.experience.flatMap((entry) => [
        entry.chronologyMemoryId,
        entry.descriptionMemoryId,
        ...entry.bulletMemoryIds,
      ]),
      ...lists.flatMap((list) => (list ?? []).map((entry) => entry.evidenceMemoryId)),
    ].filter((id): id is string => Boolean(id)),
  );
}

/** Source facts of consultant bullets that are still in the resume. */
function rewrittenFactIds(draft: ResumeDraft, linked: ReadonlySet<string>): Set<string> {
  return new Set(
    (draft.factRewrites ?? []).flatMap((rewrite) =>
      rewrite.bullets
        .filter((bullet) => linked.has(bullet.memoryId))
        .flatMap((bullet) => bullet.sourceFactIds),
    ),
  );
}

/**
 * Confirmed conversation facts that are not in the resume, not already
 * rewritten into a bullet that is still there, and not declined.
 */
export function rewriteSourceFacts<T extends RewriteMemory>(
  draft: ResumeDraft,
  memory: readonly T[],
): T[] {
  const linked = linkedMemoryIds(draft);
  const rewritten = rewrittenFactIds(draft, linked);
  // A consultant bullet that lost its place (a re-import, a stale save) is
  // still the consultant's text, never input for another rewrite.
  const bullets = new Set(
    (draft.factRewrites ?? []).flatMap((rewrite) => rewrite.bullets.map((b) => b.memoryId)),
  );
  const declined = new Set(draft.declinedFactIds ?? []);
  return memory.filter(
    (item) =>
      item.kind === 'fact' &&
      (item.status === 'confirmed' || item.status === 'corrected') &&
      CONVERSATION_ORIGINS.has(item.provenance?.kind ?? '') &&
      PLACEABLE_DOMAINS.has(item.domain) &&
      !linked.has(item.id) &&
      !rewritten.has(item.id) &&
      !bullets.has(item.id) &&
      !declined.has(item.id),
  );
}

function periodOf(entry: ResumeDraft['experience'][number]): string {
  return [entry.startDate, entry.current ? 'по настоящее время' : entry.endDate]
    .filter(Boolean)
    .join(' — ');
}

export function buildFactRewriteRequest(
  draft: ResumeDraft,
  memory: readonly RewriteMemory[],
): FactRewriteRequest {
  const statements = new Map(memory.map((item) => [item.id, item.statement]));
  return {
    places: draft.experience.map((entry) => ({
      experienceId: entry.id,
      employer: entry.employer ?? '',
      title: entry.title ?? '',
      period: periodOf(entry),
      existingBullets: entry.bulletMemoryIds.map((id) => statements.get(id) ?? '').filter(Boolean),
    })),
    facts: rewriteSourceFacts(draft, memory)
      .slice(0, MAX_FACTS_PER_REQUEST)
      .map((item) => ({ id: item.id, domain: item.domain, statement: item.statement })),
  };
}

export const EXPERIENCE_FACT_REWRITE_INSTRUCTIONS = `Ты карьерный консультант. Кандидат рассказал о своём опыте в беседе; ниже его места работы из профиля и факты из беседы. Факты — это дословные обрывки речи. Перепиши их в пункты резюме для блока «Опыт».

Правила:
1. Пиши по-русски, в стиле достижений: одно предложение, начинается с глагола прошедшего времени совершенного вида («Сократил…», «Построил…», «Вырастил…»). Без «я», «мы», «наверное», «по-моему», «скорее всего».
2. Числа, проценты, суммы, названия компаний, продуктов и технологий бери только из фактов и пиши их цифрами, как в факте. Ничего не придумывай и не округляй.
3. Каждый содержательный факт должен войти хотя бы в один пункт. Результаты с числами — выручка, маржа, рост команды, SLA, снижение числа обращений, продажа компании — самое ценное, их не отбрасывай никогда. Связанные факты одного места объединяй в один пункт: «Команда расширилась с четырёх до одиннадцати» и «следил за нагрузкой каждого» — части одной истории. В sourceFactIds пункта перечисли все факты, из которых он собран.
4. Если в факте есть оговорка («не с нуля», «скорее всего», «были несущественные просадки»), возьми из него твёрдую часть и напиши её без оговорки, не преувеличивая: «Не с нуля построил DevOps, но привил практику всем подразделениям» → «Внедрил практику DevOps во всех подразделениях обслуживания».
5. В droppedFactIds клади только факты, в которых нет ничего для резюме: обрывки без смысла сами по себе («Стало семь», «Из семи сменились», «Блок второй рост сети»), сомнения целиком («не помню контекст»), споры о названии должности, мнения. Факт, который уже вошёл в пункт, не клади никуда больше.
6. Место работы выбирай по названию компании, продукту, отрасли, периоду, должности и уже имеющимся пунктам. В профиле компании могут называться нейтрально («Enterprise Energy IT Services», «Enterprise Public Cloud Platform»), а кандидат называет их по имени («Россети Цифра», «ВКТех»): сопоставь по отрасли и смыслу. Факты подряд обычно относятся к одному месту. Если место нельзя выбрать уверенно, положи id факта в unmatchedFactIds, а не в droppedFactIds.
7. existingBullets — пункты, которые уже есть в профиле. Они нужны, чтобы понять место и не повторяться; содержание и числа из них в новые пункты не переноси. Факт, который уже сказан в existingBullets своего места, положи в droppedFactIds.
8. На одно место — не больше восьми пунктов; если фактов больше, объединяй их. Пункт не длиннее 250 знаков.

Ответь только JSON: {"places":[{"experienceId":"...","bullets":[{"text":"...","sourceFactIds":["..."]}]}],"droppedFactIds":["..."],"unmatchedFactIds":["..."]}`;

export const EXPERIENCE_FACT_REWRITE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['places', 'droppedFactIds', 'unmatchedFactIds'],
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['experienceId', 'bullets'],
        properties: {
          experienceId: { type: 'string' },
          bullets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'sourceFactIds'],
              properties: {
                text: { type: 'string' },
                sourceFactIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    droppedFactIds: { type: 'array', items: { type: 'string' } },
    unmatchedFactIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const factRewriteModelOutputSchema = z.object({
  places: z
    .array(
      z.object({
        experienceId: z.string(),
        bullets: z.array(
          z.object({ text: z.string(), sourceFactIds: z.array(z.string()).max(60) }),
        ),
      }),
    )
    .max(60),
  droppedFactIds: z.array(z.string()).optional(),
  unmatchedFactIds: z.array(z.string()).optional(),
});

export type FactRewriteModelOutput = z.infer<typeof factRewriteModelOutputSchema>;

export function factRewriteUserMessage(request: FactRewriteRequest): string {
  return `<profile-and-facts>\n${JSON.stringify(request, null, 1)}\n</profile-and-facts>`;
}

/** Number words a bullet may turn into digits («до одиннадцати» → «до 11»). */
const NUMBER_STEMS: ReadonlyArray<[stem: string, value: string]> = [
  ['одиннадцат', '11'],
  ['двенадцат', '12'],
  ['двадцат', '20'],
  ['тридцат', '30'],
  ['сорок', '40'],
  ['пятьдесят', '50'],
  ['сто', '100'],
  ['дв', '2'],
  ['тр', '3'],
  ['четыр', '4'],
  ['пят', '5'],
  ['шест', '6'],
  ['сем', '7'],
  ['восем', '8'],
  ['девят', '9'],
  ['десят', '10'],
  ['одн', '1'],
  ['один', '1'],
];

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/gu)].map((match) => match[0].replace(',', '.'));
}

function numberWordsIn(text: string): string[] {
  const words = text
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .split(/[^\p{L}]+/u);
  return words.flatMap((word) =>
    NUMBER_STEMS.filter(([stem]) => word.startsWith(stem)).map(([, value]) => value),
  );
}

/** A bullet may only state numbers its own sources state (digits or words). */
function numbersAreSourced(text: string, sources: readonly string[]): boolean {
  const joined = sources.join(' ');
  const known = new Set([...numbersIn(joined), ...numberWordsIn(joined)]);
  return numbersIn(text).every((number) => known.has(number));
}

/** A resume bullet speaks without a subject: «я», «мы», «мой P&L» are the candidate's speech. */
const FIRST_PERSON =
  /(?:^|[^\p{L}])(?:я|мы|мой|моя|моё|мое|мои|моего|моей|моих|мне|меня|наш|наша|наше|наши|нашей|наших|нам|нас)(?=$|[^\p{L}])/iu;

function cleanBulletText(text: string): string {
  const flat = text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[-–—•*]\s*/u, '');
  return flat && !/[.!?…]$/u.test(flat) ? `${flat}.` : flat;
}

function checkedBullet(
  bullet: FactRewriteModelOutput['places'][number]['bullets'][number],
  statements: ReadonlyMap<string, string>,
): ProposedBullet | null {
  const sourceFactIds = [...new Set(bullet.sourceFactIds)].filter((id) => statements.has(id));
  const text = cleanBulletText(bullet.text);
  if (sourceFactIds.length === 0) return null;
  if (text.length < MIN_BULLET_LENGTH || text.length > MAX_BULLET_LENGTH) return null;
  const sources = sourceFactIds.map((id) => statements.get(id) ?? '');
  // The model's text is the only thing that reaches the profile: a bullet
  // that copies a fragment word for word is the raw speech the owner refused.
  if (sources.some((source) => cleanBulletText(source) === text)) return null;
  if (FIRST_PERSON.test(text) || !numbersAreSourced(text, sources)) return null;
  return { text, sourceFactIds };
}

/**
 * Keeps only bullets that cite facts of the request, sit in a known place and
 * state no number their sources do not state. A place the model named twice
 * is merged; every fact no kept bullet uses is left out.
 */
export function checkFactRewrite(
  request: FactRewriteRequest,
  output: FactRewriteModelOutput,
  id: string,
): FactRewriteProposal {
  const statements = new Map(request.facts.map((fact) => [fact.id, fact.statement]));
  const order = request.places.map((place) => place.experienceId);
  const byPlace = new Map<string, ProposedBullet[]>();
  for (const place of output.places) {
    if (!order.includes(place.experienceId)) continue;
    const checked = place.bullets
      .map((bullet) => checkedBullet(bullet, statements))
      .filter((bullet): bullet is ProposedBullet => bullet !== null);
    const merged = [...(byPlace.get(place.experienceId) ?? []), ...checked];
    byPlace.set(place.experienceId, merged.slice(0, MAX_BULLETS_PER_REWRITE_PLACE));
  }
  let room = MAX_REWRITE_BULLETS;
  const places = order
    .map((experienceId) => {
      const bullets = (byPlace.get(experienceId) ?? []).slice(0, room);
      room -= bullets.length;
      return { experienceId, bullets };
    })
    .filter((place) => place.bullets.length > 0);
  const used = new Set(places.flatMap((place) => place.bullets.flatMap((b) => b.sourceFactIds)));
  const sourceFactIds = request.facts.map((fact) => fact.id);
  return {
    id,
    places,
    leftOutFactIds: sourceFactIds.filter((factId) => !used.has(factId)),
    sourceFactIds,
  };
}

export interface AppliedFactRewrite {
  readonly draft: ResumeDraft;
  readonly record: ResumeFactRewriteRecord;
  readonly statements: readonly (ResumeFactRewriteBullet & { readonly text: string })[];
}

/**
 * Appends each bullet, as a new fact id from `newMemoryId`, to its place and
 * declines the facts no bullet used, so no fragment is offered again.
 */
export function applyFactRewrite(
  draft: ResumeDraft,
  proposal: FactRewriteProposal,
  newMemoryId: () => string,
  appliedAt: string,
): AppliedFactRewrite {
  const proposed = proposal.places.flatMap((place) =>
    place.bullets.map((bullet) => ({
      memoryId: newMemoryId(),
      experienceId: place.experienceId,
      sourceFactIds: bullet.sourceFactIds,
      text: bullet.text,
    })),
  );
  const experience = draft.experience.map((entry) => {
    const added = proposed.filter((bullet) => bullet.experienceId === entry.id);
    if (added.length === 0) return entry;
    const ids = [...entry.bulletMemoryIds, ...added.map((bullet) => bullet.memoryId)];
    return { ...entry, bulletMemoryIds: ids.slice(0, MAX_BULLETS_PER_PLACE) };
  });
  // A bullet a full place could not take becomes no fact at all.
  const placed = new Set(experience.flatMap((entry) => entry.bulletMemoryIds));
  const statements = proposed.filter((bullet) => placed.has(bullet.memoryId));
  const alreadyDeclined = new Set(draft.declinedFactIds ?? []);
  const declined = proposal.leftOutFactIds.filter((factId) => !alreadyDeclined.has(factId));
  const record: ResumeFactRewriteRecord = {
    id: proposal.id,
    appliedAt,
    bullets: statements.map(({ memoryId, experienceId, sourceFactIds }) => ({
      memoryId,
      experienceId,
      sourceFactIds,
    })),
    declinedFactIds: declined,
  };
  return {
    draft: {
      ...draft,
      experience,
      declinedFactIds: [...alreadyDeclined, ...declined],
      // Only the latest rewrites keep their record; older ones are long accepted.
      factRewrites: [...(draft.factRewrites ?? []), record].slice(-MAX_FACT_REWRITES),
    },
    record,
    statements,
  };
}

/** The rewrite records are the server's: a client save neither drops nor forges them. */
export function withStoredFactRewrites(
  incoming: ResumeDraft,
  stored: ResumeDraft | undefined,
): ResumeDraft {
  const { factRewrites: _sent, ...rest } = incoming;
  return stored?.factRewrites?.length ? { ...rest, factRewrites: stored.factRewrites } : rest;
}

/** Takes the rewrite's bullets out and offers the facts it declined again. */
export function revertFactRewrite(
  draft: ResumeDraft,
  rewriteId: string,
): { readonly draft: ResumeDraft; readonly bulletMemoryIds: readonly string[] } | null {
  const record = (draft.factRewrites ?? []).find((rewrite) => rewrite.id === rewriteId);
  if (!record) return null;
  const removed = new Set(record.bullets.map((bullet) => bullet.memoryId));
  const restored = new Set(record.declinedFactIds);
  return {
    draft: {
      ...draft,
      experience: draft.experience.map((entry) =>
        entry.bulletMemoryIds.some((id) => removed.has(id))
          ? { ...entry, bulletMemoryIds: entry.bulletMemoryIds.filter((id) => !removed.has(id)) }
          : entry,
      ),
      declinedFactIds: (draft.declinedFactIds ?? []).filter((id) => !restored.has(id)),
      factRewrites: (draft.factRewrites ?? []).filter((rewrite) => rewrite.id !== rewriteId),
    },
    bulletMemoryIds: [...removed],
  };
}

/** Memory id → when a still-present rewrite wrote it: these facts read «консультант». */
export function factRewriteEdits(
  draft: ResumeDraft | undefined,
): { readonly appliedChronologyMemoryId: string; readonly createdAt: string }[] {
  return (draft?.factRewrites ?? []).flatMap((rewrite) =>
    rewrite.bullets.map((bullet) => ({
      appliedChronologyMemoryId: bullet.memoryId,
      createdAt: rewrite.appliedAt,
    })),
  );
}
