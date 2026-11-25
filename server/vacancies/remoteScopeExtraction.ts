import { GLOBAL_REMOTE_SCOPE } from '../../shared/remoteScope';
import { areasIn } from './placeNames';
import { saysWorkFromAnywhere } from './remoteScopeWorldwideText';
import { locationAreas } from './vacancyPlace';

/**
 * Область удалёнки из места и текста объявления, правилами (03.11).
 *
 * Место называет страну чаще всего («United States», «Москва», «Germany,
 * Remote»); голое «Remote» уточняет текст: «anywhere in the US», «must be
 * based in the UK», «UAE-based remote», «из любой точки России». Страна,
 * названная вне такой фразы («клиенты в США»), область не сужает. Ничего не
 * названо — `global`: работать можно откуда угодно. Текст «work from anywhere»
 * главнее поля места (`remoteScopeWorldwideText`).
 */
export interface RemoteScopeInput {
  readonly title?: string;
  readonly location?: string;
  readonly description?: string;
}

const GLOBAL_MARK =
  /worldwide|anywhere in the world|from anywhere(?! in)|all over the world|any country|globally|любой точки мира|любой стран|любого места/iu;

/** «Global», «Remote - Global», «Anywhere»: место целиком из пометок без страны. */
const GLOBAL_PLACE = /^(?:[\s,;|/()–—-]*(?:fully\s+)?(?:remote|global|anywhere)[\s,;|/()–—-]*)+$/iu;

/** Голое «Remote» не глобально: область уточняет текст. */
function isGlobalPlace(location: string): boolean {
  return GLOBAL_PLACE.test(location) && !/^(?:fully\s+)?remote$/iu.test(location);
}

/** Фразы, за которыми идёт область найма. */
const SCOPE_TRIGGERS: readonly RegExp[] = [
  /\b(?:anywhere|located|based|residing|reside|resident|living|live|work(?:ing)?|remote(?:ly)?|hire|hiring|candidates?)\s+(?:with)?in(?:side)?\s+/giu,
  /\bremote(?:ly)?\s+(?:from|within|across)\s+/giu,
  /\b(?:authori[sz]ed|eligible|permitted|able)\s+to\s+work\s+(?:in|from)\s+/giu,
  /(?<!\p{L})(?:из|по)\s+(?:любой\s+точки|любого\s+города|всей|всего)\s+/giu,
  /удал[её]нн?\p{L}*\s+(?:из|в)\s+/giu,
  /(?<!\p{L})граждан\p{L}*\s+/giu,
];
/** «UAE-based remote», «(EMEA only)»: область стоит перед пометкой. */
const SCOPE_SUFFIX =
  /([\p{L}.]+(?:\s[\p{L}.]+)?)[-\s]based\s+(?:remote|role|position|candidates?|applicants?)|([\p{L}.]+(?:\s[\p{L}.]+)?)\s+only\b/giu;
const WINDOW = 70;

/** «US Remote», «Remote: US», «Remote - United States»: страна вплотную к пометке (B794). */
const REMOTE_BESIDE_US =
  /\b(?:US|U\.S\.|USA|United States)\s*[-–—]?\s*[Rr]emote\b|\b[Rr]emote\s*[:(–—-]+\s*(?:the\s+)?(?:US|U\.S\.|USA|United States)(?![\p{L}-])/u;

/**
 * Найм только в США, страну текст не называет фразой о месте (B794): 401(k), E-Verify, гражданство
 * и спонсорство. На adenisov.test таких «удалённо из любой страны» было 113 из 259.
 */
const US_EMPLOYMENT =
  /\b401\s?\(?k\)?|\bE-Verify\b|\bprotected veterans?\b|\bU\.?S\.? citizen(?:s|ship)?\b|\bemployer in the (?:US|U\.S\.|United States)|\bacross (?:most of )?the (?:US|U\.S\.|United States)/iu;
/** Компания нанимает и в других странах: 401(k) там — льгота сотрудников из США. */
const HIRES_BEYOND_US =
  /\bworldwide\b|\bglobally distributed\b|\bfully distributed\b|\bemployer of record\b|\bEOR\b|\bcontractors? (?:outside|worldwide|globally)|\b(?:US|U\.S\.)(?:-based)? (?:employees|team members|only benefits)|\boutside (?:of )?the (?:US|U\.S\.|United States)/iu;

function employmentAreas(description: string): string[] {
  if (REMOTE_BESIDE_US.test(description)) return ['US'];
  return US_EMPLOYMENT.test(description) && !HIRES_BEYOND_US.test(description) ? ['US'] : [];
}

function windowAfter(text: string, end: number): string {
  const tail = text.slice(end, end + WINDOW);
  // «the U.S.»: точка внутри сокращения предложение не кончает.
  return tail.split(/[.;:!?\n](?:\s|$)/u)[0] ?? '';
}

function descriptionAreas(description: string): string[] {
  const found: string[] = [];
  for (const trigger of SCOPE_TRIGGERS) {
    for (const match of description.matchAll(trigger)) {
      found.push(...areasIn(` ${windowAfter(description, (match.index ?? 0) + match[0].length)} `));
    }
  }
  for (const match of description.matchAll(SCOPE_SUFFIX)) {
    found.push(...areasIn(` ${match[1] ?? match[2] ?? ''} `));
  }
  return found;
}

function serialize(areas: readonly string[]): string {
  const unique = [...new Set(areas)].sort();
  return unique.length > 0 ? unique.join(',') : GLOBAL_REMOTE_SCOPE;
}

/** Строка области для проекции: `global` или коды через запятую. */
export function extractRemoteScope(input: RemoteScopeInput): string {
  const location = input.location?.trim() ?? '';
  if (GLOBAL_MARK.test(location) || isGlobalPlace(location)) return GLOBAL_REMOTE_SCOPE;
  if (saysWorkFromAnywhere(input.title ?? '', input.description ?? '')) return GLOBAL_REMOTE_SCOPE;
  const fromLocation = locationAreas(location);
  if (fromLocation.length > 0) return serialize(fromLocation);
  const description = input.description ?? '';
  const named = descriptionAreas(description);
  return serialize(named.length > 0 ? named : employmentAreas(description));
}
