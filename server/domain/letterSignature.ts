/**
 * B624 (решение владельца 09.11): письмо подписано именем на языке самого письма. Имя переводит
 * модель цепочки письма: она возвращает его отдельной последней строкой после текста. Ни словаря,
 * ни второго поля в профиле. Не вернула или вернула не имя — остаётся имя из профиля.
 */
export type LetterTextLanguage = 'en' | 'ru';

/** Подпись строки, которую просит запрос; модель иногда переводит её на язык письма. */
export const SIGNATURE_LINE_LABEL = 'Имя для подписи:';

const SIGNATURE_LINE =
  /\n[ \t*_]*(?:имя для подписи|name for signature|signature name|signature)[ \t*_]*:[ \t*_]*([^\n]*?)[ \t*_]*$/iu;
const NAME_PART = /^\p{L}+(?:[-'’]\p{L}+)*$/u;
const MAX_NAME_CHARS = 80;
const MAX_NAME_PARTS = 4;

/**
 * Язык готового текста по буквам. Русское письмо руководителя бывает наполовину из латинских терминов
 * и названий, поэтому русским оно считается уже при трети кириллицы; в английском письме кириллица
 * встречается только в названиях.
 */
export function letterTextLanguage(text: string): LetterTextLanguage {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return cyrillic * 2 > latin ? 'ru' : 'en';
}

export interface SignatureSplit {
  readonly body: string;
  readonly name?: string;
}

/** Последняя строка «Имя для подписи: …» снимается с письма; без неё письмо не меняется. */
export function splitSignatureLine(content: string): SignatureSplit {
  const match = SIGNATURE_LINE.exec(content);
  if (!match) return { body: content };
  const body = content.slice(0, match.index).trim();
  const name = match[1]?.trim();
  return name ? { body, name } : { body };
}

/** Имя годится для подписи, только если это 1–4 слова из букв в письменности письма. */
export function letterSignatureName(
  name: string | undefined,
  language: LetterTextLanguage,
): string | undefined {
  const trimmed = name?.trim().replace(/\s+/gu, ' ') ?? '';
  if (!trimmed || trimmed.length > MAX_NAME_CHARS) return undefined;
  const parts = trimmed.split(' ');
  if (parts.length > MAX_NAME_PARTS || !parts.every((part) => NAME_PART.test(part))) return undefined;
  const ownScript = language === 'ru' ? /\p{Script=Cyrillic}/u : /\p{Script=Latin}/u;
  const otherScript = language === 'ru' ? /\p{Script=Latin}/u : /\p{Script=Cyrillic}/u;
  return ownScript.test(trimmed) && !otherScript.test(trimmed) ? trimmed : undefined;
}
