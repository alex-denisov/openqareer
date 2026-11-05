/**
 * Проверка письма от модели (04.11). Прежняя проверка (`generatedTextFactGate`) принимала
 * предложение, только если оно дословно совпало с подтверждённым фактом, поэтому ни одно письмо
 * с пересказом до кандидата не доходило: 10 из 10 на проде ушли в шаблон при живой модели.
 * Смысл пересказа детерминированно не проверить, поэтому здесь останавливается то, что можно
 * проверить и что вредит кандидату: чужие числа, чужие имена (и транслит работодателя), усиление
 * личной роли и самооценки. Кандидат всё равно читает письмо и одобряет его сам.
 */

export interface LetterGateSources {
  /** Язык письма: латиница в начале русской фразы — имя, а в английской — обычное слово. */
  readonly language: 'en' | 'ru';
  /** Формулировки фактов кандидата на языке письма. */
  readonly candidate: readonly string[];
  /** Места работы: должность, компания, годы. */
  readonly career: readonly string[];
  /** Текст вакансии подтверждает имена, но не то, что сделал кандидат. */
  readonly vacancy: readonly string[];
}

export type LetterGateRule = 'number' | 'name' | 'ownership' | 'praise';

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
function quantities(text: string): string[] {
  return [...text.matchAll(QUANTITY)].map(([, sign, before, value, after]) => {
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

function actionsOf(text: string): string[] {
  return (text.match(ACTION) ?? []).map((action) => action.toLocaleLowerCase());
}

/** Действия, совершённые самим автором фразы: «команда выросла» и «заказчик создал» сюда не входят. */
function statedActions(statement: string): string[] {
  return [...statement.matchAll(ACTION)]
    .filter((match) => OWN_ACTOR.test(statement.slice(0, match.index)))
    .map(([action]) => action.toLocaleLowerCase());
}

/** Какие личные действия профиль называет сам: должность считается, чужой глагол нет. */
function ownedActions(sources: LetterGateSources): Set<string> {
  return new Set([...sources.candidate.flatMap(statedActions), ...sources.career.flatMap(actionsOf)]);
}

/** Перевод не меняет субъект: где факт не называет личного действия, его нет и в переводе (G3d, письмо 6). */
export function addsPersonalAction(source: string, translation: string): boolean {
  if (FIRST_PERSON_GREW.test(translation)) return true;
  return statedActions(source).length === 0 && statedActions(translation).length > 0;
}

function hasStrengthenedRole(sentence: string, owned: ReadonlySet<string>): boolean {
  return actionsOf(sentence).some((action) => !owned.has(action)) || FIRST_PERSON_GREW.test(sentence);
}

const PRAISE = /обширн|многолетн|богат\p{L}*\s+опыт|глубок\p{L}*\s+(?:опыт|экспертиз|знани|понимани)|значительн\p{L}*\s+опыт|extensive|track record|proven|solid (?:background|experience)|sustained|seasoned|deep (?:expertise|experience|knowledge)|strong background|wealth of/iu;

/** «Не могу подтвердить…» и отрицания ничего не подтверждают. */
const DENIED = /(?:^|[\s,:])(?:не|нет|not|never)(?=\s)|cannot|can't|unable to confirm|did not/iu;

function sentencesOf(body: string): string[] {
  return body.split(/(?<=[.!?…])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
}

/** Название вакансии цитируется как есть: его числа и слова — не заслуги кандидата. */
function withoutVacancyText(sentence: string, vacancy: readonly string[]): string {
  return vacancy.reduce((text, part) => (part ? text.split(part).join(' ') : text), sentence);
}

export function reviewLetterBody(body: string, sources: LetterGateSources): LetterGateViolation[] {
  const backing: LetterGateSources = {
    ...sources,
    candidate: sources.candidate.filter((statement) => !DENIED.test(statement)),
  };
  const profile = [...backing.candidate, ...backing.career];
  const owned = ownedActions(backing);
  const profileText = profile.join(' ').toLocaleLowerCase();
  const names = new Set([...profile, ...backing.vacancy].flatMap(wordsOf));
  return sentencesOf(body).flatMap((sentence) => {
    const own = withoutVacancyText(sentence, backing.vacancy);
    const checks: readonly (readonly [LetterGateRule, boolean])[] = [
      ['number', hasForeignNumber(own, profile)],
      ['name', hasForeignName(sentence, names, sources.language) || hasForeignMonth(sentence, profileText)],
      ['ownership', hasStrengthenedRole(own, owned)],
      ['praise', PRAISE.test(own)],
    ];
    return checks.filter(([, failed]) => failed).map(([rule]) => ({ rule, sentence }));
  });
}
