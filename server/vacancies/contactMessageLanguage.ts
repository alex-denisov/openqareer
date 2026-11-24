import { regionOfVacancy } from './vacancyGeography';

/** Вакансия черновика: название, выжимка текста и место — для выбора языка. */
export interface LanguageVacancy {
  readonly title: string;
  readonly summary?: string;
  readonly location?: string;
}

const LETTER = /\p{L}/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;
const LATIN_NAME = /^[\p{Script=Latin}\s'’.-]+$/u;
const MIN_LETTERS = 20;
const MAX_CYRILLIC_SHARE = 0.2;
const HOME_REGIONS = new Set(['ru', 'cis']);

function isEnglishText(text: string): boolean {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters < MIN_LETTERS) return false;
  return (text.match(CYRILLIC)?.length ?? 0) / letters < MAX_CYRILLIC_SHARE;
}

/**
 * B753 (решение CPO 23.11): рекрутёру Capital One ушёл русский текст. Английский — когда текст
 * вакансии английский или имя контакта латиницей, а вакансия вне России и СНГ; иначе русский.
 */
export function contactMessageLanguage(recipientName: string, vacancy: LanguageVacancy | null): 'en' | 'ru' {
  if (!vacancy) return 'ru';
  if (isEnglishText(`${vacancy.title}\n${vacancy.summary ?? ''}`)) return 'en';
  const region = regionOfVacancy({ location: vacancy.location });
  return LATIN_NAME.test(recipientName.trim()) && region && !HOME_REGIONS.has(region) ? 'en' : 'ru';
}
