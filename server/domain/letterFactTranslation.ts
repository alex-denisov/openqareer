import {
  BULLET_TRANSLATION_PROMPT_REVISION,
  type BulletTranslationOutput,
  type BulletTranslationRequest,
} from './experienceBulletLanguage';
import { checkedBullet } from './experienceFactRewrite';
import type { LetterResultFact } from './letterResults';

/**
 * Перевод пунктов мест работы для английского письма (G3b, 03.11). Шаблон
 * не переводит свободный текст, поэтому зовём тот же переводчик, что и для
 * пунктов «Опыта». `checkedBullet` не пропускает чисел, которых нет в факте,
 * `addsPersonalAction` — личного действия, которого факт не называет: перевод
 * «команда выросла» как «scaling the team» дошёл до письма (G3d, письмо 6).
 * Неудача — не ошибка: письмо выйдет без результата, как раньше, но никогда
 * с русским текстом или выдумкой.
 */

const ACTION = /(?<!\p{L})(?:созда|основал|основат|возглав|руковод|разработал|внедр|запуст|увелич|сниз|сократ|добил|постро|удво|утро|реализова|организова|управлял|масштабир|вырастил|нарастил|координир|курир|(?:led|leading|directing|managing|founded|founder|created|built|launched|increased|reduced|cut|achieved|implemented|authored|doubled|managed|delivered|scaled|expanded|organized|coordinated|oversaw|headed|spearheaded|directed|drove|scaling|building|creating|launching|increasing|reducing|cutting|achieving|implementing|doubling|delivering|expanding|organizing|coordinating|overseeing|heading|spearheading|driving|growing)(?!\p{L}))/giu;
const FIRST_PERSON_GREW = /(?<!\p{L})(?:i|we)\s+(?:\p{L}+\s+)?grew(?!\p{L})/iu;
/** Перед глаголом кандидата — начало фразы, «я» или союз; иначе действие совершил кто-то другой. */
const OWN_ACTOR = /(?:^|[,;:—–(.]\s*|(?<!\p{L})(?:я|мы|и|i|we|and)\s+)$/iu;

function statedActions(statement: string): string[] {
  return [...statement.matchAll(ACTION)]
    .filter((match) => OWN_ACTOR.test(statement.slice(0, match.index)))
    .map(([action]) => action.toLocaleLowerCase());
}

/** Перевод не меняет субъект: где факт не называет личного действия, его нет и в переводе (G3d, письмо 6). */
function addsPersonalAction(source: string, translation: string): boolean {
  if (FIRST_PERSON_GREW.test(translation)) return true;
  return statedActions(source).length === 0 && statedActions(translation).length > 0;
}

export interface LetterFactTranslator {
  translate?(request: BulletTranslationRequest): Promise<BulletTranslationOutput | null>;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, string>();

/** Новая редакция переводчика не отдаёт переводов старой. */
function cacheKey(statement: string): string {
  return `${BULLET_TRANSLATION_PROMPT_REVISION}:${statement}`;
}

function remember(statement: string, text: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey(statement), text);
}

function expiresIn(budgetMs: number): { promise: Promise<null>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/** id факта → английский текст; только прошедшие проверку переводы. */
export async function translateLetterFacts(
  translator: LetterFactTranslator | undefined,
  facts: readonly LetterResultFact[],
  budgetMs: number,
): Promise<ReadonlyMap<string, string>> {
  const known = new Map(
    facts.flatMap((fact) => {
      const text = cache.get(cacheKey(fact.statement));
      return text ? [[fact.id, text] as const] : [];
    }),
  );
  const missing = facts.filter((fact) => !known.has(fact.id));
  if (missing.length === 0 || !translator?.translate) return known;
  const request: BulletTranslationRequest = {
    bullets: missing.map((fact) => ({
      key: fact.id,
      language: 'en',
      text: fact.statement,
      facts: [fact.statement],
    })),
  };
  // A late answer still lands in the cache: the next letter quotes it at once.
  const answered = translator
    .translate(request)
    .then((output) => checkedTranslations(missing, output))
    .catch(() => new Map<string, string>());
  const deadline = expiresIn(budgetMs);
  const translated = await Promise.race([answered, deadline.promise]).finally(deadline.cancel);
  return new Map([...known, ...(translated ?? [])]);
}

function checkedTranslations(
  facts: readonly LetterResultFact[],
  output: BulletTranslationOutput | null,
): Map<string, string> {
  const answers = new Map((output?.bullets ?? []).map((bullet) => [bullet.key, bullet.text]));
  return new Map(
    facts.flatMap((fact) => {
      const text = answers.get(fact.id);
      if (!text) return [];
      const checked = checkedBullet({ text, sourceFactIds: ['0'] }, new Map([['0', fact.statement]]), 'en');
      if (!checked || addsPersonalAction(fact.statement, checked.text)) return [];
      remember(fact.statement, checked.text);
      return [[fact.id, checked.text] as const];
    }),
  );
}

/** Только для тестов: кэш общий на процесс. */
export function clearLetterFactTranslationCache(): void {
  cache.clear();
}
