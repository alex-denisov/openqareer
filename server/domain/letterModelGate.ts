/**
 * Проверка письма от модели (04.11). Прежняя проверка (`generatedTextFactGate`) принимала
 * предложение, только если оно дословно совпало с подтверждённым фактом, поэтому ни одно письмо
 * с пересказом до кандидата не доходило: 10 из 10 на проде ушли в шаблон при живой модели.
 * Смысл пересказа детерминированно не проверить, поэтому здесь останавливается то, что можно
 * проверить и что вредит кандидату: чужие числа и чужие имена. Кандидат всё равно читает письмо
 * и одобряет его сам.
 */

export interface LetterGateSources {
  /** Язык письма: латиница в начале русской фразы — имя, а в английской — обычное слово. */
  readonly language: 'en' | 'ru';
  /** Формулировки фактов кандидата на языке письма. */
  readonly candidate: readonly string[];
  /** Места работы: должность, компания, годы. */
  readonly career: readonly string[];
  /** Название, компания, получатель и навыки вакансии: цитируются как есть и подтверждают имена. */
  readonly vacancy: readonly string[];
  /** Полный текст вакансии подтверждает имена только во фразах о роли, но не в рассказе о своём прошлом. */
  readonly vacancyText?: string;
}

export type LetterGateRule = 'number' | 'name' | 'language';

export interface LetterGateViolation {
  readonly rule: LetterGateRule;
  readonly sentence: string;
}

const QUANTITY = /((?<![\p{L}\p{N}])[-−])?([£$€₽])?(\d+(?:[.,]\d+)?)\s*(%|млн|млрд|тыс|million|billion|thousand|usd|eur|руб\p{L}*|₽|\$|€|£)?/giu;
const YEAR = /^(?:19|20)\d{2}$/u;
const UNIT_NAMES: Readonly<Record<string, string>> = {
  million: 'млн', billion: 'млрд', thousand: 'тыс', usd: '$', eur: '€', '₽': 'руб',
};

/** Единица неотделима от числа: 40 млн не доказывают 40 %, а $40 и 40$ — одно и то же. */
/** В диапазоне знак процента общий: «с 91 до 97 %» значит и 91 %, и 97 %. */
const PERCENT_RANGE = /(\d+(?:[.,]\d+)?)(\s*(?:до|to)\s*\d+(?:[.,]\d+)?\s*%)/giu;

function quantities(text: string): string[] {
  return [...text.replace(PERCENT_RANGE, '$1%$2').matchAll(QUANTITY)].map(([, sign, before, value, after]) => {
    const raw = (after ?? before ?? '').toLocaleLowerCase();
    const unit = raw.startsWith('руб') ? 'руб' : UNIT_NAMES[raw] ?? raw;
    return `${sign ? '-' : ''}${(value ?? '').replace(',', '.')}${unit}`;
  });
}

/** Каждое число есть в профиле; пара чисел из одного факта идёт в том же порядке, что и в нём. */
function hasForeignNumber(sentence: string, backing: readonly string[]): boolean {
  const numbers = quantities(sentence);
  const sourceLists = backing.map(quantities);
  const known = new Set(sourceLists.flat());
  if (numbers.some((value) => !known.has(value))) return true;
  return numbers.some((value, index) => {
    const next = numbers[index + 1];
    if (next === undefined || YEAR.test(value) || YEAR.test(next)) return false;
    const together = sourceLists.filter((list) => list.includes(value) && list.includes(next));
    return together.length > 0 && !together.some((list) => list.indexOf(value) < list.lastIndexOf(next));
  });
}

const WORD = /\p{L}[\p{L}\p{N}'’]*/gu;
const CYRILLIC_WORD = /^\p{Script=Cyrillic}+$/u;
/** Слова письма, а не имена: их пишут с большой буквы и без профиля. */
const PLAIN_CAPITALS = new Set(["i", "i'm", "i'd", "i've", "i'll", 'team', 'hiring', 'lead', 'manager', 'regards']);

function wordsOf(text: string): string[] {
  return (text.match(WORD) ?? []).map((word) => word.replace(/’/gu, "'").toLocaleLowerCase());
}

/** Русское слово склоняется: «Финтех Лабе» — это «Финтех Лаб», «Руководителя» — «Руководитель». */
function sameName(word: string, known: string): boolean {
  if (word === known) return true;
  if (!CYRILLIC_WORD.test(word) || known.length < 3) return false;
  const shared = [...word].findIndex((letter, index) => letter !== known[index]);
  const common = shared === -1 ? word.length : shared;
  return common >= 3 && Math.max(word.length, known.length) - common <= 2;
}

function isKnownName(word: string, known: ReadonlySet<string>): boolean {
  const lower = word.replace(/’/gu, "'").toLocaleLowerCase().replace(/'s$/u, '');
  return PLAIN_CAPITALS.has(lower) || known.has(lower) || [...known].some((name) => sameName(lower, name));
}

const OPENING = /^(\p{L}[\p{L}\p{N}'’]*)(?:\s+(\p{Lu}[\p{L}\p{N}'’]*))?/u;
/** Служебные слова начала фразы: «At Ритейл Системс» и «В Финтех Лаб» — не имя из двух слов. */
const OPENING_WORDS = new Set([
  'at', 'in', 'for', 'with', 'from', 'as', 'by', 'on', 'to', 'my', 'our', 'the', 'this', 'after', 'before', 'while',
  'during', 'since', 'currently', 'earlier', 'previously', 'now', 'today', 'dear', 'hello', 'hi', 'greetings',
  'в', 'во', 'на', 'из', 'при', 'для', 'с', 'со', 'до', 'после', 'как', 'мой', 'моя', 'наш', 'сейчас', 'ранее', 'прежде',
  'уважаемый', 'уважаемая', 'уважаемые', 'добрый', 'здравствуйте',
  'если', 'когда', 'чтобы', 'пока', 'хотя', 'где', 'зато', 'но', 'и', 'а', 'if', 'when', 'where', 'but', 'and', 'although',
]);

/**
 * Первое слово с заглавной пишут всегда, поэтому имя в нём видно не всегда. Проверяем надёжное:
 * латиницу в русском письме и начало имени из двух слов. Одно слово без словаря не отличить:
 * «Сбер доверил» и «Работал над» для проверки одинаковы.
 */
function hasForeignOpening(sentence: string, known: ReadonlySet<string>, language: 'en' | 'ru'): boolean {
  const [, first = '', second] = OPENING.exec(sentence) ?? [];
  if (!first || isKnownName(first, known)) return false;
  if (language === 'ru' && /^\p{Script=Latin}/u.test(first)) return true;
  return Boolean(second) && !OPENING_WORDS.has(first.toLocaleLowerCase()) &&
    !PLAIN_CAPITALS.has(second!.toLocaleLowerCase());
}

function hasForeignName(sentence: string, known: ReadonlySet<string>, language: 'en' | 'ru'): boolean {
  const capitals = (sentence.match(WORD) ?? []).slice(1).filter((word) => /^\p{Lu}/u.test(word));
  return capitals.some((word) => !isKnownName(word, known)) || hasForeignOpening(sentence, known, language);
}

const MONTH = /(?<!\p{L})(?:январ|феврал|март|апрел|мая|май|июн|июл|август|сентябр|октябр|ноябр|декабр|january|february|march|april|june|july|august|september|october|november|december)\p{L}*/giu;

/** Месяцев в данных модели нет: кандидат видел бы дату, которой не называл. */
function hasForeignMonth(sentence: string, backing: string): boolean {
  return (sentence.match(MONTH) ?? []).some((month) => !backing.includes(month.toLocaleLowerCase()));
}

const ACTION = /(?<!\p{L})(?:созда|основал|основат|возглав|руковод|разработал|внедр|запуст|увелич|сниз|сократ|добил|постро|удво|утро|реализова|организова|управлял|масштабир|вырастил|нарастил|координир|курир|(?:led|leading|directing|managing|founded|founder|created|built|launched|increased|reduced|cut|achieved|implemented|authored|doubled|managed|delivered|scaled|expanded|organized|coordinated|oversaw|headed|spearheaded|directed|drove|scaling|building|creating|launching|increasing|reducing|cutting|achieving|implementing|doubling|delivering|expanding|organizing|coordinating|overseeing|heading|spearheading|driving|growing)(?!\p{L}))/giu;
const FIRST_PERSON_GREW = /(?<!\p{L})(?:i|we)\s+(?:\p{L}+\s+)?grew(?!\p{L})/iu;
/** Перед глаголом кандидата — начало фразы, «я» или союз; иначе действие совершил кто-то другой. */
const OWN_ACTOR = /(?:^|[,;:—–(.]\s*|(?<!\p{L})(?:я|мы|и|i|we|and)\s+)$/iu;

/** «Срок сократился» называет итог, а не автора; прод 05.11: такие фразы уводили верное письмо в шаблон. */
const REFLEXIVE_ENDING = /^\p{L}*(?:ся|сь)(?!\p{L})/iu;
const NEGATED = /(?:(?<!\p{L})(?:не|ни|not|never)|n['’]t)(?:\s+(?!(?:только|просто|only|just)(?!\p{L}))\p{L}+)?\s+$/iu;
/** «Добился» — личное достижение, хотя глагол возвратный. */
const PERSONAL_REFLEXIVE = /^добил/iu;

function claimedActions(text: string): RegExpMatchArray[] {
  return [...text.matchAll(ACTION)].filter((match) => {
    const start = match.index ?? 0;
    const rest = text.slice(start);
    return (PERSONAL_REFLEXIVE.test(rest) || !REFLEXIVE_ENDING.test(rest)) && !NEGATED.test(text.slice(0, start));
  });
}

/** Действия, совершённые самим автором фразы: «команда выросла» и «заказчик создал» сюда не входят. */
function statedActions(statement: string): string[] {
  return claimedActions(statement)
    .filter((match) => OWN_ACTOR.test(statement.slice(0, match.index)))
    .map(([action]) => action.toLocaleLowerCase());
}

/** Перевод не меняет субъект: где факт не называет личного действия, его нет и в переводе (G3d, письмо 6). */
export function addsPersonalAction(source: string, translation: string): boolean {
  if (FIRST_PERSON_GREW.test(translation)) return true;
  return statedActions(source).length === 0 && statedActions(translation).length > 0;
}

const FIRST_PERSON = /(?<!\p{L})(?:я|мы|мне|меня|мной|мой|моя|моё|мои|моего|моей|моих|наш\p{L}*|i|i['’]\p{L}+|we|my|our)(?!\p{L})/iu;
const READER_JOB = /(?<!\p{L})(?:role|job|position|you|your|requires|needs|роль|роли|ролью|позици\p{L}*|ваш\p{L}*|вам|вас|требует|нужен|нужна)(?!\p{L})/iu;
/** Прошедшее время о себе: о нём говорит только профиль, а не текст вакансии. */
const OWN_PAST = /(?<!\p{L})(?:\p{L}{3,}(?:ал|ил|ял|ел)(?:а|и)?|(?:i|we)\s+(?:\p{L}+\s+)?(?:\p{L}+ed|was|were|led|built|ran))(?!\p{L})/iu;

function isOwnPastClaim(sentence: string): boolean {
  return OWN_PAST.test(sentence) && (FIRST_PERSON.test(sentence) || !READER_JOB.test(sentence));
}

/** Отрицание снимает своё предложение: «склад не успевал» не отменяет итог того же факта. */
const DENIED = /(?:^|[\s,:])(?:не|нет|not|never)(?=\s)|cannot|can't|unable to confirm|did not/iu;

export function sentencesOf(body: string): string[] {
  return body.split(/(?<=[.!?…])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
}

function affirmedSentences(statement: string): string[] {
  return sentencesOf(statement).filter((sentence) => !DENIED.test(sentence));
}

/** Название вакансии цитируется как есть: его числа и слова — не заслуги кандидата. */
function withoutVacancyText(sentence: string, vacancy: readonly string[]): string {
  return vacancy.reduce((text, part) => (part ? text.split(part).join(' ') : text), sentence);
}

const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Английское письмо из русского профиля пересказывает его своими словами: «CEO», «Board», «Moscow» и
 * латинское имя работодателя в профиле не найти. Здесь имена не сверяются, а единицы чисел сравниваются
 * без подписи («2 млрд ₽» и «2bn RUB»). Кириллица в таком письме — всегда ошибка.
 */
function isTranslatedLetter(sources: LetterGateSources): boolean {
  return sources.language === 'en' && [...sources.candidate, ...sources.career].some((text) => CYRILLIC.test(text));
}

const BARE_NUMBER = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?/gu;

function hasForeignBareNumber(sentence: string, backing: readonly string[]): boolean {
  const known = new Set(backing.join(' ').match(BARE_NUMBER)?.map((value) => value.replace(',', '.')) ?? []);
  return (sentence.match(BARE_NUMBER) ?? []).some((value) => !known.has(value.replace(',', '.')));
}

/**
 * Письмо проверяется только там, где ошибка видна без модели: чужие числа и чужие имена. Смысл пересказа
 * проверить надёжно не вышло (05.11): и правила, и проверка моделью отвергали верные фразы и мнения автора и
 * пропускали выдумки. Письмо остаётся черновиком: кандидат читает его перед отправкой.
 */
export function reviewLetterBody(body: string, sources: LetterGateSources): LetterGateViolation[] {
  const candidate = sources.candidate.flatMap(affirmedSentences);
  const profile = [...candidate, ...sources.career];
  const profileText = profile.join(' ').toLocaleLowerCase();
  const names = new Set([...profile, ...sources.vacancy].flatMap(wordsOf));
  const namesWithText = new Set([...names, ...wordsOf(sources.vacancyText ?? '')]);
  const translated = isTranslatedLetter(sources);
  return sentencesOf(body).flatMap((sentence) => {
    const ownPast = isOwnPastClaim(sentence);
    const own = withoutVacancyText(sentence, sources.vacancy);
    const backing = ownPast || !sources.vacancyText ? profile : [...profile, sources.vacancyText];
    const known = ownPast ? names : namesWithText;
    const checks: readonly (readonly [LetterGateRule, boolean])[] = [
      ['number', translated ? hasForeignBareNumber(own, backing) : hasForeignNumber(own, backing)],
      ['name', !translated && (hasForeignName(sentence, known, sources.language) || hasForeignMonth(sentence, profileText))],
      ['language', sources.language === 'en' && CYRILLIC.test(sentence)],
    ];
    return checks.filter(([, failed]) => failed).map(([rule]) => ({ rule, sentence }));
  });
}
