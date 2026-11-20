/**
 * B645 (a03): тексты «О себе» и «Опыт» для LinkedIn пишет модель — пересказом подтверждённых фактов,
 * а не их копией. Модуль собирает вход, проверяет ответ и подставляет принятые тексты в предложения.
 * Ответа нет, он не прошёл проверки или не успел — предложения по разделу нет: исходные факты
 * как предложение не показываются.
 */
import { z } from 'zod';
import { LINKEDIN_ABOUT_MAX } from '../../shared/b640LinkedinProfile';
import { textLanguage, type ProfileLanguage } from '../domain/profileLanguage';
import {
  numbersAreGrounded,
  type LinkedinSectionFact,
  type LinkedinSectionItem,
  type SectionSuggestion,
  type SectionSuggestions,
  type SuggestionInput,
  type SuggestionMemory,
} from './sectionSuggestions';

export const LINKEDIN_REWRITE_PROMPT_REVISION = 'linkedin-profile-rewrite-2026-11-20';
/** Сколько ждёт чтение профиля; не успевший ответ дописывается в кэш для следующего открытия. */
export const LINKEDIN_REWRITE_BUDGET_MS = 20_000;
/** B645: экран a03 не ждёт модель дольше этого — разделы сразу, пересказ дочитывается следующим запросом. */
export const LINKEDIN_VIEW_WAIT_MS = 2_000;

const ABOUT_FACTS = 12;
const PLACES = 6;
const PLACE_FACTS = 8;
const ABOUT_MAX = Math.min(1500, LINKEDIN_ABOUT_MAX);
const PLACE_MAX = 450;
const PLACE_SENTENCES = 3;
const COPY_MIN = 20;
const PROFILE_DOMAINS: ReadonlySet<string> = new Set(['responsibility', 'outcome', 'role-evidence', 'skill']);
const FIRST_PERSON = /(?<![\p{L}])(я|мы|мой|моя|мои|наш|наша|I|we|my|our)(?![\p{L}])/iu;

export interface LinkedinRewritePlace {
  readonly id: string;
  readonly employer: string;
  readonly title: string;
  readonly facts: readonly LinkedinSectionFact[];
}
export interface LinkedinRewriteRequest {
  readonly language: ProfileLanguage;
  readonly targetRole: string;
  readonly aboutFacts: readonly LinkedinSectionFact[];
  readonly places: readonly LinkedinRewritePlace[];
}

export const answerText = z.object({ text: z.string().max(4000), factIds: z.array(z.string().max(200)).max(40) });
export const linkedinRewriteOutputSchema = z.object({
  about: answerText.nullable(),
  places: z.array(answerText.extend({ id: z.string().max(200) })).max(20),
});
export type LinkedinRewriteOutput = z.infer<typeof linkedinRewriteOutputSchema>;

export interface LinkedinRewriter {
  /** `null`, когда ни одна ступень не дала годного ответа. */
  linkedinProfile?(request: LinkedinRewriteRequest): Promise<LinkedinRewriteOutput | null>;
}

const isUsable = (memory: SuggestionMemory) =>
  (memory.status === 'confirmed' || memory.status === 'corrected') && !memory.sensitive;
const fact = (memory: SuggestionMemory): LinkedinSectionFact => ({ id: memory.id, text: memory.statement.trim() });

function placesOf(input: SuggestionInput, byId: ReadonlyMap<string, SuggestionMemory>): LinkedinRewritePlace[] {
  return (input.draft?.experience ?? []).slice(0, PLACES).flatMap((place) => {
    const ids = [...(place.descriptionMemoryId ? [place.descriptionMemoryId] : []), ...place.bulletMemoryIds];
    const facts = ids.flatMap((id) => (byId.has(id) ? [fact(byId.get(id)!)] : [])).slice(0, PLACE_FACTS);
    const employer = place.employer?.trim();
    const title = place.title?.trim();
    return employer && title && facts.length ? [{ id: place.id, employer, title, facts }] : [];
  });
}

/** Вход модели; язык — по вставленному «О себе», иначе по самим фактам. */
export function linkedinRewriteRequest(input: SuggestionInput, currentAbout: string | undefined): LinkedinRewriteRequest | null {
  const usable = input.memory.filter(isUsable);
  const byId = new Map(usable.map((memory) => [memory.id, memory]));
  const aboutFacts = usable.filter((memory) => PROFILE_DOMAINS.has(memory.domain ?? '')).slice(0, ABOUT_FACTS).map(fact);
  const places = placesOf(input, byId);
  if (aboutFacts.length === 0 && places.length === 0) return null;
  const sample = [...aboutFacts, ...places.flatMap((place) => place.facts)].map((item) => item.text).join(' ');
  const language = (currentAbout && textLanguage(currentAbout)) || textLanguage(sample) || 'ru';
  return { language, targetRole: input.draft?.targetRole?.trim() ?? '', aboutFacts, places };
}

/** B692: ссылка, почта или markdown-ссылка в тексте профиля — признак внедрённой инструкции, а не пересказа фактов. */
const LINK_LIKE = /https?:\/\/|www\.|\S@\S|\]\(/iu;

const flat = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sentences = (text: string) => text.split(/[.!?…]+(?=\s|$)/u).filter((part) => part.trim()).length;

/** Пересказ, а не копия: ни один процитированный факт не стоит в тексте дословно. */
function copiesSource(text: string, facts: readonly LinkedinSectionFact[]): boolean {
  const own = flat(text);
  return facts.some((item) => {
    const source = flat(item.text);
    return source === own || (source.length >= COPY_MIN && own.includes(source));
  });
}

export interface CheckRule {
  readonly allowed: readonly LinkedinSectionFact[];
  readonly max: number;
  readonly maxSentences?: number;
  readonly noFirstPerson?: boolean;
}

export function checkedText(answer: z.infer<typeof answerText>, rule: CheckRule, language: ProfileLanguage): { text: string; facts: LinkedinSectionFact[] } | null {
  const text = answer.text.replace(/\s+/gu, ' ').trim();
  const byId = new Map(rule.allowed.map((item) => [item.id, item]));
  const facts = [...new Set(answer.factIds)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const valid =
    text.length > 0 && text.length <= rule.max && !LINK_LIKE.test(text) && facts.length > 0 && facts.length === new Set(answer.factIds).size
    && (rule.maxSentences === undefined || sentences(text) <= rule.maxSentences)
    && !(rule.noFirstPerson && FIRST_PERSON.test(text))
    && (textLanguage(text) ?? language) === language
    && numbersAreGrounded(text, facts) && !copiesSource(text, facts);
  return valid ? { text, facts } : null;
}

export const ABOUT_RULE = { max: ABOUT_MAX } as const;
export const PLACE_RULE = { max: PLACE_MAX, maxSentences: PLACE_SENTENCES, noFirstPerson: true } as const;

export interface CheckedLinkedinRewrite {
  readonly about: { readonly text: string; readonly facts: readonly LinkedinSectionFact[] } | null;
  readonly places: ReadonlyMap<string, { readonly text: string; readonly facts: readonly LinkedinSectionFact[] }>;
}

/** Каждый текст опирается только на свои факты, без новых чисел, без копии источника, на языке профиля. */
export function checkLinkedinRewrite(request: LinkedinRewriteRequest, output: LinkedinRewriteOutput): CheckedLinkedinRewrite {
  const about = output.about ? checkedText(output.about, { ...ABOUT_RULE, allowed: request.aboutFacts }, request.language) : null;
  const places = new Map<string, { text: string; facts: LinkedinSectionFact[] }>();
  for (const answer of output.places) {
    const place = request.places.find((item) => item.id === answer.id);
    const rule = { ...PLACE_RULE, allowed: place?.facts ?? [] };
    const checked = place && !places.has(place.id) ? checkedText(answer, rule, request.language) : null;
    if (checked) places.set(answer.id, checked);
  }
  return { about, places };
}

const CACHE_LIMIT = 200;
/** B692: после сбоя модели минуту отвечаем без неё — открытия экрана не жгут вызовы. */
const FAILURE_PAUSE_MS = 60_000;
const cache = new Map<string, Promise<LinkedinRewriteOutput | null>>();
const failedAt = new Map<string, number>();

function cachedRewrite(rewriter: Required<LinkedinRewriter>, request: LinkedinRewriteRequest): Promise<LinkedinRewriteOutput | null> {
  const key = `${LINKEDIN_REWRITE_PROMPT_REVISION}:${JSON.stringify(request)}`;
  const known = cache.get(key);
  if (known) return known;
  const failed = failedAt.get(key);
  if (failed !== undefined && Date.now() - failed < FAILURE_PAUSE_MS) return Promise.resolve(null);
  failedAt.delete(key);
  const pending = rewriter.linkedinProfile(request).catch(() => null);
  // Неудача не кэшируется как ответ: после паузы следующее открытие попробует снова.
  void pending.then((output) => {
    if (output) return;
    cache.delete(key);
    if (failedAt.size >= CACHE_LIMIT) failedAt.delete(failedAt.keys().next().value!);
    failedAt.set(key, Date.now());
  });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, pending);
  return pending;
}

export function clearLinkedinRewriteCache(): void {
  cache.clear();
  failedAt.clear();
}

const LATE = Symbol('late');

/** Ответ к сроку или `LATE`: сам вызов не отменяется и дописывает кэш в фоне. */
async function withinBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => { timer = setTimeout(() => resolve(LATE), budgetMs); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function experienceOf(request: LinkedinRewriteRequest, checked: CheckedLinkedinRewrite): SectionSuggestion | null {
  const items: LinkedinSectionItem[] = request.places.flatMap((place) => {
    const text = checked.places.get(place.id);
    return text ? [{ id: place.id, label: `${place.employer} · ${place.title}`, text: text.text, facts: text.facts }] : [];
  });
  if (items.length === 0) return null;
  const text = items.map((item) => `${item.label}\n${item.text}`).join('\n\n');
  return { text, facts: items.flatMap((item) => item.facts), items };
}

/** `rewriting` — модель ещё пишет «О себе» и «Опыт»: ответ придёт в кэш, его отдаст следующее чтение. */
export type RewrittenSuggestions = SectionSuggestions & { readonly rewriting: boolean };

/** «О себе» и «Опыт» — только принятые тексты модели; заголовок и навыки остаются как были. */
export async function rewrittenSuggestions(
  base: SectionSuggestions,
  input: SuggestionInput,
  currentAbout: string | undefined,
  rewriter: LinkedinRewriter | undefined,
  budgetMs: number,
): Promise<RewrittenSuggestions> {
  const request = linkedinRewriteRequest(input, currentAbout);
  const call = rewriter?.linkedinProfile?.bind(rewriter);
  const answer = request && call ? await withinBudget(cachedRewrite({ linkedinProfile: call }, request), budgetMs) : null;
  const output = answer === LATE ? null : answer;
  const checked = request && output ? checkLinkedinRewrite(request, output) : null;
  return {
    ...base,
    rewriting: answer === LATE,
    about: checked?.about ? { text: checked.about.text, facts: [...checked.about.facts] } : null,
    experience: request && checked ? experienceOf(request, checked) : null,
  };
}
