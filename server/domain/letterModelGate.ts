/**
 * Проверка письма от модели (B601, 06.11). Письма принимает владелец, читая тексты, и прежняя проверка
 * отклоняла все письма, которые он принял: 3 из 3 с 22 срабатываниями, в основном на «усиление роли»
 * и незнакомые термины. Поэтому останавливаем только то, что проверяется надёжно и вредит кандидату:
 * цифру, которой нет в профиле, и компанию, которой нет ни в профиле, ни в вакансии. Стиль, самооценка
 * и термины направления не отклоняются. Цифры прописью и слово в начале фразы не проверяются.
 */

export interface LetterGateSources {
  /** Язык письма: латиница в начале русской фразы — имя, а в английской — обычное слово. */
  readonly language: 'en' | 'ru';
  /** Весь профиль кандидата построчно. */
  readonly candidate: readonly string[];
  /** Вакансия и получатель подтверждают имена, но не то, что сделал кандидат. */
  readonly vacancy: readonly string[];
  /**
   * `false` — опыта работы нет, резюме к отклику не приложится: письмо не должно упоминать резюме.
   * По умолчанию резюме приложено, и письмо обязано сказать об этом (B601, 08.11).
   */
  readonly resumeAttached?: boolean;
}

export type LetterGateRule = 'number' | 'name' | 'resume' | 'cyrillic';

export interface LetterGateViolation {
  readonly rule: LetterGateRule;
  readonly sentence: string;
}

type QuantityKind = 'percent' | 'multiple' | 'amount' | 'plain';

interface Quantity {
  readonly kind: QuantityKind;
  /** Число как написано: 230 в «230 млн». */
  readonly written: number;
  /** С учётом единицы: 230 000 000. */
  readonly value: number;
  readonly currency?: string;
}

const NUMBER = String.raw`\d{1,3}(?:[ \u00a0,.]\d{3})+(?!\d)|\d+(?:[.,]\d+)?`;
const CURRENCY = String.raw`[$€£₽]|usd|eur|gbp|rub(?:les?)?|руб\p{L}*|доллар\p{L}*|евро|dollars?|euros?`;
const SCALE = String.raw`млн|млрд|тыс|million|billion|thousand|mln|bn|[kKmMкК](?!\p{L})`;
const KIND = String.raw`%|процент\p{L}*|percent|раза?(?!\p{L})|times|[xXхХ](?!\p{L})`;
const QUANTITY = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,/])([-−](?=\d))?([$€£₽]|usd|eur)?\s?(${NUMBER})(?:\s?(${KIND}))?(?:\s?(${SCALE})\.?)?(?:\s?(${CURRENCY}))?(?![\p{L}\p{N}]|\/\d)`,
  'giu',
);

const SCALE_VALUES: Readonly<Record<string, number>> = {
  млн: 1e6, млрд: 1e9, тыс: 1e3, million: 1e6, billion: 1e9, thousand: 1e3, mln: 1e6, bn: 1e9, k: 1e3, m: 1e6, к: 1e3, м: 1e6,
};

function currencyOf(raw: string | undefined): string | undefined {
  const text = raw?.toLocaleLowerCase();
  if (!text) return undefined;
  if (text === '$' || text === 'usd' || text.startsWith('доллар') || text.startsWith('dollar')) return '$';
  if (text === '€' || text === 'eur' || text === 'евро' || text.startsWith('euro')) return '€';
  if (text === '£' || text === 'gbp') return '£';
  return '₽';
}

function numberOf(raw: string): number {
  const compact = raw.replace(/[ \u00a0]/gu, '');
  const grouped = /^\d{1,3}(?:[,.]\d{3})+$/u.test(compact);
  return Number(grouped ? compact.replace(/[,.]/gu, '') : compact.replace(',', '.'));
}

function kindOf(rawKind: string | undefined, money: boolean, scale: string | undefined): QuantityKind {
  const kind = rawKind?.toLocaleLowerCase();
  if (kind?.startsWith('%') || kind?.startsWith('процент') || kind === 'percent') return 'percent';
  if (kind) return 'multiple';
  return money || scale ? 'amount' : 'plain';
}

/**
 * Единица общая на диапазон: «с 23 до 68%» и «99,5–100%» называют проценты оба раза. 10.11 на проде
 * «from 91% to 97%» отклонялось при «с 91 до 97 %» в профиле: английские письма уходили к GLM и в 503.
 */
const SHARED_PERCENT_RANGE = new RegExp(String.raw`(${NUMBER})\s?[–—-]\s?(${NUMBER})\s?%`, 'gu');
const SHARED_PERCENT_TRANSITION = new RegExp(
  String.raw`(?<!\p{L})(с|со|от|from)(\s+)(${NUMBER})(\s+)(до|to)(\s+)(${NUMBER})\s?%`,
  'giu',
);

function withSharedPercent(text: string): string {
  return text
    .replace(SHARED_PERCENT_RANGE, '$1% – $2%')
    .replace(SHARED_PERCENT_TRANSITION, '$1$2$3%$4$5$6$7%');
}

function quantities(text: string): Quantity[] {
  return [...withSharedPercent(text).matchAll(QUANTITY)].map(([, sign, before, number = '', kind, scale, after]) => {
    const written = numberOf(number) * (sign ? -1 : 1);
    const unit = scale ? SCALE_VALUES[scale.toLocaleLowerCase()] ?? 1 : 1;
    const currency = currencyOf(before ?? after);
    return {
      kind: kindOf(kind, Boolean(currency), scale),
      written,
      value: Math.round(written * unit * 1000) / 1000,
      ...(currency ? { currency } : {}),
    };
  });
}

/** «Обращений −40%» — это снижение на 40%. Обратное неверно: «−20%» в профиле не подтверждает рост на 20%. */
function backedBy(wanted: Quantity, known: Quantity): boolean {
  if (wanted.value < 0 && known.value > 0) {
    return backedBy({ ...wanted, value: -wanted.value, written: -wanted.written }, known);
  }
  // Голое число могло потерять единицу в пересказе: «с 230 до 2 млрд» опирается на «230 million».
  if (wanted.kind === 'plain') return wanted.value === known.written || wanted.value === known.value;
  if (wanted.kind !== known.kind && !(wanted.kind === 'amount' && known.kind === 'plain')) return false;
  if (wanted.value !== known.value) return false;
  return !wanted.currency || !known.currency || wanted.currency === known.currency;
}

const TRANSITION = new RegExp(
  String.raw`(?:(?<!\p{L})(?:from|с|со|от)\s+~?(?:[£$€₽])?(${NUMBER})[^\d]{0,12}?\s(?:to|до)\s+~?(?:[£$€₽])?(${NUMBER}))|(?:(${NUMBER})\s?\S{0,3}\s?(?:→|->)\s?~?(?:[£$€₽])?(${NUMBER}))`,
  'giu',
);

function transitions(text: string): [number, number][] {
  return [...text.matchAll(TRANSITION)].map(([, from, to, arrowFrom, arrowTo]) =>
    [numberOf(from ?? arrowFrom ?? '0'), numberOf(to ?? arrowTo ?? '0')]);
}

/** «CSAT с 68% до 23%» при «с 23% до 68%» в профиле: каждое число есть, а смысл обратный. */
function reversesTransition(sentence: string, backing: string): boolean {
  const known = transitions(backing);
  return transitions(sentence).some(([from, to]) =>
    known.some(([knownFrom, knownTo]) => knownFrom === to && knownTo === from) &&
    !known.some(([knownFrom, knownTo]) => knownFrom === from && knownTo === to));
}

const WORD_MULTIPLES: readonly (readonly [RegExp, string])[] = [
  [/(?<!\p{L})(?:двух|дву)кратн\p{L}*/giu, '2 раза'],
  [/(?<!\p{L})тр[её]хкратн\p{L}*/giu, '3 раза'],
  [/(?<!\p{L})четыр[её]хкратн\p{L}*/giu, '4 раза'],
  [/(?<!\p{L})пятикратн\p{L}*/giu, '5 раз'],
  [/(?<!\p{L})десятикратн\p{L}*/giu, '10 раз'],
  [/(\d+)\s?-?\s?(?:кратн\p{L}*|fold)/giu, '$1 раз'],
  [/(?<!\p{L})в\s+(?:два|две)\s+раза(?!\p{L})/giu, '2 раза'],
  [/(?<!\p{L})в\s+три\s+раза(?!\p{L})/giu, '3 раза'],
  [/(?<!\p{L})в\s+четыре\s+раза(?!\p{L})/giu, '4 раза'],
  [/(?<!\p{L})в\s+пять\s+раз(?!\p{L})/giu, '5 раз'],
  [/(?<!\p{L})в\s+десять\s+раз(?!\p{L})/giu, '10 раз'],
];

function withWrittenMultiples(text: string): string {
  return WORD_MULTIPLES.reduce((rest, [pattern, plain]) => rest.replace(pattern, plain), text);
}

/**
 * Рост «в 4 раза» и сумма «до 2 млрд» могут быть разными цифрами за разные периоды (решение владельца
 * 06.11: в одну фразу не соединять). В одной фразе письма они законны, только если стоят в одной фразе профиля.
 */
function gluesGrowthToAmount(sentence: string, profileSentences: readonly string[]): boolean {
  const found = quantities(withWrittenMultiples(sentence));
  const multiples = found.filter((item) => item.kind === 'multiple');
  const amounts = found.filter((item) => item.kind === 'amount');
  if (multiples.length === 0 || amounts.length === 0) return false;
  return !profileSentences.some((source) => {
    const stated = quantities(withWrittenMultiples(source));
    return [...multiples, ...amounts].every((wanted) => stated.some((item) => backedBy(wanted, item)));
  });
}

function hasForeignNumber(sentence: string, known: readonly Quantity[], backing: string): boolean {
  return quantities(sentence).some((wanted) => !known.some((item) => backedBy(wanted, item))) ||
    reversesTransition(sentence, backing);
}

const WORD = /\p{L}[\p{L}\p{N}'’]*/gu;
const CYRILLIC_WORD = /^\p{Script=Cyrillic}+$/u;
/** Слова письма, а не имена: их пишут с большой буквы и без профиля. */
const PLAIN_CAPITALS = new Set([
  'i', "i'm", "i'd", "i've", "i'll", 'team', 'hiring', 'regards',
  'вы', 'вас', 'вам', 'вами', 'ваш', 'ваша', 'ваше', 'ваши', 'вашей', 'вашего', 'вашу', 'вашим', 'ваших', 'вашем', 'вашему',
]);
/** Аббревиатуры обычно термины (SLA, FinOps); эти — компании, и профиль должен их называть. */
const COMPANY_ABBREVIATIONS = new Set([
  'ibm', 'sap', 'hp', 'vk', 'epam', 'amd', 'pwc', 'kpmg', 'bcg', 'nvidia', 'мтс', 'втб', 'ржд', 'гпб', 'кпмг', 'мгтс', 'нлмк', 'ммк',
]);

function wordsOf(text: string): string[] {
  return (text.match(WORD) ?? []).map((word) => word.replace(/’/gu, "'").toLocaleLowerCase());
}

/** Русское слово склоняется: «Финтех Лабе» — это «Финтех Лаб», «Руководителя» — «Руководитель». */
function sameInflectedWord(word: string, known: string): boolean {
  if (!CYRILLIC_WORD.test(word) || known.length < 3) return false;
  const shared = [...word].findIndex((letter, index) => letter !== known[index]);
  const common = shared === -1 ? word.length : shared;
  return common >= Math.min(3, known.length - 1) && Math.max(word.length, known.length) - common <= 2;
}

const LETTER_SOUNDS: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'sh', з: 's', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'k', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'iu', я: 'ia', c: 'k', q: 'k', w: 'v', y: 'i', z: 's', j: 'i', x: 'ks',
};

/** Звучание без алфавита: «Россети» и Rosseti, «Цифра» и Tsifra, «Дубае» и Dubai сходятся. */
function soundOf(word: string): string {
  return [...word.replace(/ts/gu, 'c')]
    .map((letter) => LETTER_SOUNDS[letter] ?? letter)
    .join('')
    .replace(/(.)\1+/gu, '$1');
}

function editDistance(left: string, right: string): number {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  [...left].forEach((letter, leftIndex) => {
    const next = [leftIndex + 1];
    [...right].forEach((other, rightIndex) => {
      next.push(Math.min((row[rightIndex + 1] ?? 0) + 1, (next[rightIndex] ?? 0) + 1, (row[rightIndex] ?? 0) + (letter === other ? 0 : 1)));
    });
    row = next;
  });
  return row[right.length] ?? 0;
}

function sharedPrefix(left: string, right: string): number {
  const stop = [...left].findIndex((letter, index) => letter !== right[index]);
  return stop === -1 ? left.length : stop;
}

/** Имя с другого алфавита или в переводе: Корпоративный и Corporate, Университет и University. */
function sameSound(word: string, known: string): boolean {
  const [one, other] = [soundOf(word), soundOf(known)];
  if (one === other) return true;
  const shorter = Math.min(one.length, other.length);
  if (shorter < 4) return false;
  const prefix = sharedPrefix(one, other);
  return editDistance(one, other) <= Math.floor(shorter / 4) || (prefix >= 5 && prefix >= shorter * 0.6);
}

function isKnownName(word: string, known: ReadonlySet<string>): boolean {
  const lower = word.replace(/’/gu, "'").toLocaleLowerCase().replace(/'s$/u, '');
  return PLAIN_CAPITALS.has(lower) || known.has(lower) ||
    [...known].some((name) => sameInflectedWord(lower, name) || sameSound(lower, name));
}

/** Термин направления: аббревиатура, смешанный регистр или цифра внутри слова. */
function isTerm(word: string): boolean {
  if (COMPANY_ABBREVIATIONS.has(word.toLocaleLowerCase())) return false;
  // «KPIs», «SLAs»: множественное число аббревиатуры тоже термин (10.11).
  return /^\p{Lu}[\p{Lu}\p{N}]*$/u.test(word) || /^\p{Lu}{2,}s$/u.test(word) || /\p{Ll}\p{Lu}/u.test(word) || /\p{N}/u.test(word);
}

function hasForeignName(sentence: string, known: ReadonlySet<string>, language: 'en' | 'ru'): boolean {
  const words = sentence.match(WORD) ?? [];
  const [first = '', ...rest] = words;
  const capitals = rest.filter((word) => /^\p{Lu}/u.test(word) && !isTerm(word));
  const foreignFirst = language === 'ru' && /^\p{Script=Latin}/u.test(first) && !isTerm(first) && !isKnownName(first, known);
  return foreignFirst || capitals.some((word) => !isKnownName(word, known));
}

/** Отрицание ничего не подтверждает: «не увеличил выручку на 20%» — не повод писать про 20%. «Не только» не отрицание. */
const NEGATED = /(?:^|[\s,:])(?:не|нет|not|never)\s+(?!только|менее|более|just|only|less|more)\p{L}|cannot|can't|unable to confirm|did not/iu;

const RESUME_NOTE = /резюме|resum[eé]|\bcv\b/iu;

function sentencesOf(body: string): string[] {
  // После «млн.» и «руб.» фраза идёт дальше, если следующее слово не с большой буквы. Флага i нет: с ним \p{Lu} ловит и строчные.
  return body
    .split(/(?<=[.!?…])(?:(?<!(?:тыс|млн|млрд|руб|долл)\.)\s+|\s+(?=\p{Lu}))|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Название вакансии цитируется как есть: его числа и слова — не заслуги кандидата. */
function withoutVacancyText(sentence: string, vacancy: readonly string[]): string {
  return vacancy.reduce((text, part) => (part ? text.split(part).join(' ') : text), sentence);
}

/** Названия компаний из строк мест работы профиля («## Должность | Компания | …») и из вакансии. */
function companyNames(sources: LetterGateSources): string[] {
  const employers = sources.candidate.flatMap((line) => {
    const employer = line.startsWith('## ') ? line.slice(3).split(' | ')[1] : undefined;
    return employer ? [employer] : [];
  });
  return [...employers, ...sources.vacancy.filter((part) => part.length <= 80)];
}

/**
 * Приёмка B601: в английском письме кириллица только в названиях компаний. 10.11 GLM оставляла
 * «1С:Бухгалтерия 8.3» кириллицей; такое письмо уступает следующей ступени.
 */
function hasForeignCyrillic(sentence: string, companies: readonly string[]): boolean {
  const rest = companies.reduce((text, name) => (name ? text.split(name).join(' ') : text), sentence);
  return /\p{Script=Cyrillic}/u.test(rest);
}

export function reviewLetterBody(body: string, sources: LetterGateSources): LetterGateViolation[] {
  const profileSentences = sources.candidate.flatMap(sentencesOf).filter((sentence) => !NEGATED.test(sentence));
  const profile = profileSentences.join('\n');
  const known = quantities(profile);
  const names = new Set([...sources.candidate, ...sources.vacancy].flatMap(wordsOf));
  // Модель сама выбирает язык письма и может разойтись с определением по вакансии.
  const language = /\p{Script=Cyrillic}/u.test(body) ? sources.language : 'en';
  const sentences = sentencesOf(body);
  const checked = sentences.flatMap((sentence) => {
    const checks: readonly (readonly [LetterGateRule, boolean])[] = [
      ['number', hasForeignNumber(withoutVacancyText(sentence, sources.vacancy), known, profile) || gluesGrowthToAmount(sentence, profileSentences)],
      ['name', hasForeignName(sentence, names, language)],
    ];
    return checks.filter(([, failed]) => failed).map(([rule]) => ({ rule, sentence }));
  });
  const companies = companyNames(sources);
  const cyrillic = sources.language === 'en'
    ? sentences.filter((sentence) => hasForeignCyrillic(sentence, companies)).map((sentence) => ({ rule: 'cyrillic' as const, sentence }))
    : [];
  if (sources.resumeAttached === false) {
    const promised = sentences.filter((sentence) => RESUME_NOTE.test(sentence));
    return [...checked, ...cyrillic, ...promised.map((sentence) => ({ rule: 'resume' as const, sentence }))];
  }
  return RESUME_NOTE.test(body)
    ? [...checked, ...cyrillic]
    : [...checked, ...cyrillic, { rule: 'resume', sentence: sentences.at(-1) ?? '' }];
}
