import type { UnifiedVacancy } from '../unifiedVacancy';
import { normalizeTextForComparison } from '../../vacancies/vacancyFingerprint';

/**
 * Та же ли вакансия у другого источника кластера. Строже сведения (#1176): отклик нельзя увести
 * на чужую форму, поэтому совпадают название, компания, место и текст; сомнение — «не та же».
 */
type Posting = Pick<
  UnifiedVacancy,
  'title' | 'company' | 'location' | 'description' | 'fullDescription' | 'status'
>;

/** Доля общих слов текстов: у копии одного объявления она выше, у шаблона другой роли ниже. */
const TEXT_SIMILARITY_MIN = 0.7;
const TEXT_WORDS_MIN = 40;
/** Для сверки объявления хватает начала; предел держит время разбора. */
const TEXT_MAX_LENGTH = 10_000;

const wordList = (text: string): readonly string[] =>
  normalizeTextForComparison(text)
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean);

const COMPANY_NOISE = new Set([
  'llc',
  'ltd',
  'inc',
  'corp',
  'gmbh',
  'ооо',
  'зао',
  'пао',
  'ао',
  'careers',
  'jobs',
]);

const companyKey = (company: string) =>
  wordList(company)
    .filter((word) => !COMPANY_NOISE.has(word))
    .join(' ');

function sameText(left: string, right: string): boolean {
  const a = new Set(wordList(left.slice(0, TEXT_MAX_LENGTH).replace(/<[^<>]+>/gu, ' ')));
  const b = new Set(wordList(right.slice(0, TEXT_MAX_LENGTH).replace(/<[^<>]+>/gu, ' ')));
  if (a.size < TEXT_WORDS_MIN || b.size < TEXT_WORDS_MIN) return false;
  const shared = [...a].filter((word) => b.has(word)).length;
  // Общие слова к короткому тексту: площадка сокращает объявление, но не переписывает его.
  return (
    shared / Math.min(a.size, b.size) >= TEXT_SIMILARITY_MIN &&
    Math.min(a.size, b.size) / Math.max(a.size, b.size) >= 0.3
  );
}

const textOf = (item: Posting) => item.fullDescription?.trim() || item.description;

/** Место не спорит: один из городов назван у обоих либо место не указано у одного. */
function placeAgrees(left: string | undefined, right: string | undefined): boolean {
  const places = (value: string | undefined) =>
    (value ?? '')
      .split(/[,;/|()]+/u)
      .map((part) => wordList(part).join(' '))
      .filter(Boolean);
  const [a, b] = [places(left), places(right)];
  if (a.length === 0 || b.length === 0) return true;
  const city = (from: readonly string[], to: readonly string[]) => to.includes(from[0]!);
  return city(a, b) || city(b, a);
}

export function sameTitle(left: string, right: string): boolean {
  const title = wordList(left).join(' ');
  return title !== '' && title === wordList(right).join(' ');
}

export function sameCompany(left: string, right: string): boolean {
  const company = companyKey(left);
  return company !== '' && company === companyKey(right);
}

type Place = { readonly location?: string; readonly isRemote?: boolean };

/** Место подтверждено: назван один город, обе удалённые или места не назвал никто. */
export function isShownPlace(shown: Place, posting: Place): boolean {
  if (shown.isRemote && posting.isRemote) return true;
  const [a, b] = [shown.location?.trim(), posting.location?.trim()];
  return Boolean(a) === Boolean(b) && placeAgrees(a, b);
}

/** Название и место одни и те же: запись — та вакансия, которую показывает карточка. */
export function isShownPosting(
  shown: Pick<Posting, 'title' | 'location'>,
  posting: Pick<Posting, 'title' | 'location'>,
): boolean {
  return sameTitle(shown.title, posting.title) && placeAgrees(shown.location, posting.location);
}

export function isSameVacancy(own: Posting, other: Posting): boolean {
  if (other.status !== 'active') return false;
  if (!sameCompany(own.company, other.company)) return false;
  return isShownPosting(own, other) && sameText(textOf(own), textOf(other));
}
