/**
 * Города в письме отклика: только из профиля и условий поиска кандидата. 25.11 на проде письмо обещало
 * «готов рассмотреть роль в Москве, Екатеринбурге, Перми…» — города стояли в вакансии, а не у кандидата.
 */
import { CITY_COUNTRY, CITY_NAMES, RUSSIAN_CITY_DISTRICT } from '../../shared/locationGazetteer';
import { isCountryName, isRegionLabel, latinCityName } from '../../shared/placeNames';

export interface LetterPlaceSources {
  /** Профиль без отрицаний и условия поиска: их места письмо может назвать. */
  readonly candidate: readonly string[];
  /** Место вакансии: города, которых нет в справочнике. */
  readonly vacancyLocation?: string;
  /** Название вакансии, компания, получатель: город в них — часть названия, а не слова кандидата. */
  readonly vacancyNames: readonly string[];
}

interface Place {
  readonly name: string;
  readonly pattern: RegExp;
}

const ESCAPE = /[.*+?^${}()|[\]\\]/gu;
const SOFT_ENDING = /[аяьйоеиы]$/u;
const NOUN_ENDINGS = '(?:а|я|у|ю|е|и|ы|ь|о|й|ой|ей|ом|ем|ью|ого|его|ому|ему|ым|им|ый|ий)?';
const MIN_STEM_LENGTH = 2;

function wordPattern(word: string): string {
  const escaped = word.replace(ESCAPE, '\\$&');
  if (!/^\p{Script=Cyrillic}+$/u.test(word)) return escaped;
  // «Нижний» — «Нижнем»: у прилагательного отпадают обе буквы.
  const base = word.replace(/(?:ий|ый|ой)$/u, '');
  const stem = base === word ? word.replace(SOFT_ENDING, '') : base;
  return stem.length >= MIN_STEM_LENGTH ? `${stem}${NOUN_ENDINGS}` : escaped;
}

/** Падежи русского названия и буква «ё» как «е»; имя с заглавной буквы проверяет вызывающий. */
function namePattern(name: string): string {
  return plain(name)
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map(wordPattern)
    .join('[\\s-]+');
}

function plain(text: string): string {
  return text.replace(/ё/gu, 'е').replace(/Ё/gu, 'Е');
}

function placeOf(names: readonly string[]): Place {
  const pattern = names.map((name) => namePattern(name.toLocaleLowerCase('ru-RU'))).join('|');
  return {
    name: names[0] ?? '',
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'giu'),
  };
}

const SHORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  москва: ['мск'],
  'санкт-петербург': ['петербург', 'питер', 'спб'],
};

/** Одно место на всех языках: «Moscow» в профиле подтверждает «Москве» в письме. */
function knownPlaces(): Place[] {
  const aliases = new Map<string, Set<string>>();
  const add = (city: string, ...names: readonly string[]) => {
    const key = city.toLocaleLowerCase('ru-RU');
    aliases.set(key, new Set([...(aliases.get(key) ?? [key]), ...names]));
  };
  for (const city of Object.keys(RUSSIAN_CITY_DISTRICT)) add(city);
  for (const city of Object.keys(CITY_COUNTRY)) add(city);
  for (const [latin, city] of Object.entries(CITY_NAMES)) add(city, latin);
  return [...aliases].map(([city, names]) => {
    const latin = latinCityName(city)?.replace(/-/gu, ' ');
    return placeOf([...names, ...(SHORT_NAMES[city] ?? []), ...(latin ? [latin] : [])]);
  });
}

const PLACES = knownPlaces();

const REMOTE_WORK = /удал[её]н|дистанц|гибрид|remote|hybrid|anywhere/iu;

function vacancyPlaces(location: string | undefined): Place[] {
  return (location ?? '')
    .split(/[,;/|·()]/u)
    .map((part) => part.trim())
    .filter(
      (part) =>
        /^\p{Lu}\p{L}/u.test(part) &&
        !/\d/u.test(part) &&
        !REMOTE_WORK.test(part) &&
        !isCountryName(part) &&
        !isRegionLabel(part) &&
        !PLACES.some((place) => isMentioned(place, part)),
    )
    .map((part) => placeOf([part]));
}

/** Город адресата, а не кандидата: «команда в Перми», «офису в Омске». */
const ADDRESSEE_BEFORE =
  /(?:команд|офис|филиал|подразделени|компани|team|office|branch|company)\p{L}*\s+(?:в|во|из|in|at)\s+(?:г\.\s*)?$/iu;
const GREETING =
  /^\s*(?:здравствуйте|приветствую|добр(?:ый|ого|ое)|уважаем|dear|hello|hi(?!\p{L})|good\s+(?:morning|afternoon|evening|day))/iu;
const CLAIM =
  /готов\p{L}*[^.]*(?:рассм|работа|переех|переезд|релок)|рассматрива\p{L}*|рассмотр\p{L}*|переезд|переех|релокац|relocat|willing|open to|consider|based in/iu;

/** Готовность к переезду — тоже утверждение о кандидате, даже без города. */
const RELOCATION_CLAIM =
  /готов\p{L}*\s+(?:к\s+|на\s+)?(?:переезд|переех|релокац)|(?:рассматриваю|рассмотрю|возможен)\s+(?:переезд|релокац)|(?:willing|ready|open|able|prepared|happy)\s+(?:to|for)\s+relocat/iu;
const RELOCATION = /переезд|переех|релокац|relocat/iu;

function isMentioned(place: Place, text: string): boolean {
  return [...plain(text).matchAll(place.pattern)].length > 0;
}

function afterCompany(before: string, names: readonly string[]): boolean {
  const lead = before
    .replace(/(?:\s+(?:в|во|из|in)\s+|\s*[,(]\s*)(?:г\.\s*)?$/iu, '')
    .replace(/[»"”]+$/u, '');
  return lead !== before && names.some((name) => name.length > 1 && lead.endsWith(plain(name)));
}

function claimsPlace(sentence: string, place: Place, names: readonly string[]): boolean {
  return [...sentence.matchAll(place.pattern)].some((match) => {
    if (!/^\p{Lu}/u.test(match[0])) return false;
    const before = sentence.slice(0, match.index);
    const claim = CLAIM.test(sentence);
    return claim || !(ADDRESSEE_BEFORE.test(before) || afterCompany(before, names));
  });
}

/** Фраза называет место или обещает переезд, которых нет у кандидата. */
export function letterPlaceCheck(sources: LetterPlaceSources): (sentence: string) => boolean {
  const own = sources.candidate.join('\n');
  const names = sources.vacancyNames.filter((name) => name.trim().length > 1);
  const named = names.join('\n');
  const foreign = [...PLACES, ...vacancyPlaces(sources.vacancyLocation)].filter(
    (place) => !isMentioned(place, own),
  );
  const inNames = new Set(foreign.filter((place) => isMentioned(place, named)));
  const relocates = RELOCATION.test(own);
  return (sentence) => {
    if (GREETING.test(sentence) && !CLAIM.test(sentence)) return false;
    if (!relocates && RELOCATION_CLAIM.test(sentence)) return true;
    const text = plain(
      names.reduce((rest, name) => rest.split(name).join(' '.repeat(name.length)), sentence),
    );
    const whole = plain(sentence);
    return foreign.some((place) =>
      inNames.has(place)
        ? CLAIM.test(text) && claimsPlace(text, place, names)
        : claimsPlace(whole, place, names) && isMentioned(place, text),
    );
  };
}
