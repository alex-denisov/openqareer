import { languageKey } from '../../shared/languageNames';
import type { ResumeDocument } from './resumeStudioTypes';

const CEFR_ORDER = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
/** Слова, которые не добавляют к «языку и уровню» ничего нового. */
const FILLER = new Set(
  'язык языка языком знание владение уровень уровня уровне на не ниже от и выше минимум language level at least or higher above minimum knowledge of'.split(
    ' ',
  ),
);

/**
 * B713: «Английский B2» закрывает «English — C1». Сверка дословная не видела ни перевода
 * названия, ни уровня выше. Требование с чем-то ещё («английский и SQL») не трогаем.
 */
export function languageRequirementMet(
  normalizedRequirement: string,
  languages: ResumeDocument['languages'],
): boolean {
  const keys = new Set<string>();
  const levels: number[] = [];
  for (const token of normalizedRequirement.split(' ')) {
    const key = languageKey(token);
    const level = CEFR_ORDER.indexOf(token);
    if (key) keys.add(key);
    else if (level >= 0) levels.push(level);
    else if (!FILLER.has(token)) return false;
  }
  const [wanted] = keys;
  if (keys.size !== 1 || !wanted) return false;
  const required = levels.length > 0 ? Math.min(...levels) : null;
  return languages.some((language) => {
    if (languageKey(language.name?.value ?? '') !== wanted) return false;
    if (required === null || language.native?.value === 'native') return true;
    return CEFR_ORDER.indexOf(language.cefr?.value.toLowerCase() ?? '') >= required;
  });
}
