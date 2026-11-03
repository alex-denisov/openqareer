import { GLOBAL_REMOTE_SCOPE } from '../../shared/remoteScope';
import { areasIn } from './placeNames';
import { locationAreas } from './vacancyPlace';

/**
 * Область удалёнки из места и текста объявления, правилами (03.11).
 *
 * Место называет страну чаще всего («United States», «Москва», «Germany,
 * Remote»); голое «Remote» уточняет текст: «anywhere in the US», «must be
 * based in the UK», «UAE-based remote», «из любой точки России». Страна,
 * названная вне такой фразы («клиенты в США»), область не сужает. Ничего не
 * названо — `global`: работать можно откуда угодно.
 */
export interface RemoteScopeInput {
  readonly location?: string;
  readonly description?: string;
}

const GLOBAL_MARK =
  /worldwide|anywhere in the world|from anywhere(?! in)|all over the world|any country|globally|любой точки мира|любой стран|любого места/iu;

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
  if (GLOBAL_MARK.test(location)) return GLOBAL_REMOTE_SCOPE;
  const fromLocation = locationAreas(location);
  if (fromLocation.length > 0) return serialize(fromLocation);
  return serialize(descriptionAreas(input.description ?? ''));
}
