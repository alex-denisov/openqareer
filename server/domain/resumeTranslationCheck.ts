import type { ResumeLang } from '../../shared/resumeVacancyEdits';
import { speaksInFirstPerson } from './experienceFactRewrite';
import { addsPersonalAction } from './letterFactTranslation';
import { textLanguage } from './profileLanguage';

/**
 * Строка резюме: текст (пункт, «О себе»), должность, термин (город, степень, язык) или название
 * (навык, курс). В русском резюме названия латиницей не переводят.
 */
export type ResumeLineKind = 'text' | 'title' | 'term' | 'label';

export interface ResumeLine {
  readonly kind: ResumeLineKind;
  readonly text: string;
}

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN_WORD = /\p{Script=Latin}[\p{Script=Latin}'’]*[a-z]{2}/u;
const SHORT_MAX = 160;
const MIN_LENGTH_RATIO = 0.4;
const MAX_LENGTH_RATIO = 2.5;
const LENGTH_SLACK = 40;

export function needsTranslation({ kind, text }: ResumeLine, lang: ResumeLang): boolean {
  if (lang === 'en') return CYRILLIC.test(text);
  if (kind === 'label' || CYRILLIC.test(text)) return false;
  // Короткие латинские названия (Go, CTO) в русском резюме пишут так же.
  return kind === 'text' ? textLanguage(text) === 'en' : LATIN_WORD.test(text);
}

const THOUSANDS = /(?<![\d.,])\d{1,3}(?:([\s,])\d{3})(?:\1\d{3})*(?![\d]|[.,]\d{3})/gu;
const QUANTITY =
  /(\d+(?:[.,]\d+)*)(?:[\s-]*(%|percent|процент|(?:billion|bn|b|млрд|миллиард)(?![\p{L}\p{N}&])|(?:million|mln|mn|mm|m|млн|миллион)(?![\p{L}\p{N}&])|(?:thousand|k|тыс|тысяч)(?![\p{L}\p{N}&])|миллиард\p{L}*|миллион\p{L}*|тысяч\p{L}*))?/giu;

function scaleOf(unit: string | undefined): string {
  const value = unit?.toLocaleLowerCase() ?? '';
  if (/^(?:%|percent|процент)/u.test(value)) return '%';
  if (/^(?:b|млрд|миллиард)/u.test(value)) return 'B';
  if (/^(?:m|млн|миллион)/u.test(value)) return 'M';
  return value ? 'K' : '';
}

/** Числа строки с масштабом: «$230M», «230 млн» и «230 million» — одно и то же. */
export function quantitiesOf(text: string): string[] {
  const flat = text.replace(THOUSANDS, (match) => match.replace(/[\s,]/gu, ''));
  return [...flat.matchAll(QUANTITY)]
    .map(([, number, unit]) => `${(number ?? '').replaceAll(',', '.')}${scaleOf(unit)}`)
    .sort();
}

const CURRENCIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['USD', /\$|(?<!\p{L})(?:USD|dollars?|долл\p{L}*)(?!\p{L})/iu],
  ['EUR', /€|(?<!\p{L})(?:EUR|euros?|евро)(?!\p{L})/iu],
  ['RUB', /₽|(?<!\p{L})(?:RUB|RUR|roubles?|rubles?|руб|рубл\p{L}*)(?!\p{L})/iu],
];

const currenciesOf = (text: string) =>
  CURRENCIES.flatMap(([code, pattern]) => (pattern.test(text) ? [code] : []));

const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/** Перевод на нужном языке с теми же числами, валютами и названиями компаний, что в исходной строке. */
export function isFaithful(
  line: ResumeLine,
  text: string,
  lang: ResumeLang,
  companies: readonly string[],
): boolean {
  if (!text.trim()) return false;
  if (lang === 'en' ? CYRILLIC.test(text) : !CYRILLIC.test(text) || textLanguage(text) === 'en')
    return false;
  if (!same(quantitiesOf(line.text), quantitiesOf(text))) return false;
  if (!same(currenciesOf(line.text), currenciesOf(text))) return false;
  if (lang === 'en') return true;
  return companies.every((name) => !mentions(line.text, name) || mentions(text, name));
}

/** Первое слово — личное действие: «Improved», «Lead», «Выстроил», «Веду». */
const OWN_EN =
  /^(?!(?:need|seed|speed|feed)(?!\p{L}))(?:\p{L}{2,}ed|won|grew|ran|drove|set|made|took|wrote|oversaw|brought|head|lead|manage|build|run|own|drive|develop|launch|create|design|establish|oversee|coordinate|deliver|scale|grow)(?!\p{L})/iu;
const OWN_RU =
  /^(?!(?:отдел|персонал|портал|канал|капитал|филиал|школа|раздел|материал|функционал|потенциал|журнал)(?!\p{L}))(?:\p{L}{2,}(?:л|ла|ли|лся|лась|лись)|веду|руковожу|строю|\p{L}{3,}(?:аю|яю|ею))(?!\p{L})/iu;
/** «Внедрение», «руководитель» — дело или должность, а не действие кандидата. */
const ACTION_NOUN =
  /\p{L}*(?:ни[еяю]|нием|ниями|ниях|ний|тел[ьяюи]\p{L}*|ци[яиюей]\p{L}*)(?!\p{L})/giu;

function addsAction(source: string, text: string): boolean {
  if (OWN_EN.test(source) || OWN_RU.test(source)) return false;
  return addsPersonalAction(source, text.replace(ACTION_NOUN, '…'));
}

/** Ответ переводчика, прошедший проверку; `null` — строка остаётся исходной. */
export function checkedTranslation(
  line: ResumeLine,
  answer: string,
  lang: ResumeLang,
  companies: readonly string[],
): string | null {
  const text = answer.replace(/\s+/gu, ' ').trim();
  if (!isFaithful(line, text, lang, companies)) return null;
  if (line.kind !== 'text') return text.length <= SHORT_MAX ? text.replace(/\.$/u, '') : null;
  if (text.length > line.text.length * MAX_LENGTH_RATIO + LENGTH_SLACK) return null;
  if (text.length < line.text.length * MIN_LENGTH_RATIO) return null;
  if (speaksInFirstPerson(text) && !speaksInFirstPerson(line.text)) return null;
  return addsAction(line.text, text) ? null : text;
}

const LANGUAGE_CODES =
  'en ru de fr es it pt nl sv no da fi et lv lt pl cs sk hu ro bg sr hr sl mk el tr az hy ka kk ky uz tg tk tt ba uk be mn zh ja ko vi th id ms hi bn ur fa ar he'.split(
    ' ',
  );

function languageNames(lang: ResumeLang): ReadonlyMap<string, string> {
  const from = new Intl.DisplayNames([lang === 'ru' ? 'en' : 'ru'], { type: 'language' });
  const to = new Intl.DisplayNames([lang], { type: 'language' });
  return new Map(
    LANGUAGE_CODES.flatMap((code) => {
      const key = from.of(code)?.toLocaleLowerCase();
      const value = to.of(code);
      if (!key || !value) return [];
      return [[key, value.charAt(0).toLocaleUpperCase() + value.slice(1)] as const];
    }),
  );
}

const LANGUAGE_NAMES: Readonly<Record<ResumeLang, ReadonlyMap<string, string>>> = {
  ru: languageNames('ru'),
  en: languageNames('en'),
};

/** Название языка из словаря CLDR. */
export const languageName = (text: string, lang: ResumeLang) =>
  LANGUAGE_NAMES[lang].get(text.trim().toLocaleLowerCase());
