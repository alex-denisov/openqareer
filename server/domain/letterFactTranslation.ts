import type { BulletTranslationOutput, BulletTranslationRequest } from './experienceBulletLanguage';
import { checkedBullet } from './experienceFactRewrite';
import type { LetterResultFact } from './letterResults';

/**
 * Перевод пунктов мест работы для английского письма (G3b, 03.11). Шаблон
 * не переводит свободный текст, поэтому зовём тот же переводчик, что и для
 * пунктов «Опыта»: он не усиливает утверждения, а `checkedBullet` не пропускает
 * чисел, которых нет в факте. Неудача — не ошибка: письмо выйдет без
 * результата, как раньше, но никогда с русским текстом или выдумкой.
 */

export interface LetterFactTranslator {
  translate?(request: BulletTranslationRequest): Promise<BulletTranslationOutput | null>;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, string>();

function remember(statement: string, text: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(statement, text);
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
      const text = cache.get(fact.statement);
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
  const deadline = expiresIn(budgetMs);
  const output = await Promise.race([
    translator.translate(request).catch(() => null),
    deadline.promise,
  ]).finally(deadline.cancel);
  const answers = new Map((output?.bullets ?? []).map((bullet) => [bullet.key, bullet.text]));
  const translated = missing.flatMap((fact) => {
    const text = answers.get(fact.id);
    if (!text) return [];
    const checked = checkedBullet({ text, sourceFactIds: ['0'] }, new Map([['0', fact.statement]]), 'en');
    if (!checked) return [];
    remember(fact.statement, checked.text);
    return [[fact.id, checked.text] as const];
  });
  return new Map([...known, ...translated]);
}

/** Только для тестов: кэш общий на процесс. */
export function clearLetterFactTranslationCache(): void {
  cache.clear();
}
