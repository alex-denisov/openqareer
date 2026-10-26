import {
  CITY_COUNTRY,
  CITY_NAMES,
  COUNTRY_NAMES,
  HOME_COUNTRY,
  RUSSIAN_CITY_DISTRICT,
  US_CITY_STATE,
  US_STATE_NAMES,
  US_STATES,
} from './locationGazetteer';
import { geoCity, geoCountry } from './geo/geoDirectory';

/**
 * Дерево «страна › регион › город» для фильтра «Локации» (B547).
 *
 * Ключ узла — путь из русских названий через « › ». Выбор хранится списком
 * ключей без потомков выбранных узлов: отметка региона выбирает все его
 * города, снятие города внутри выбранного региона раскрывает регион в
 * остальные города. Счётчики — число вакансий выдачи в узле, поэтому они
 * совпадают с тем, что покажет список после «Применить».
 */

export const LOCATION_PATH_SEPARATOR = ' › ';
export const UNKNOWN_REGION = 'Регион не указан';

export interface VacancyPlaceInput {
  readonly location?: string;
  readonly country?: string;
  readonly isRemote?: boolean;
  /** B446-r: сколько вакансий стоит за местом (сводка сервера); нет — одна. */
  readonly count?: number;
}

export interface LocationPath {
  readonly country: string;
  readonly region?: string;
  readonly city?: string;
}

export type LocationNodeKind = 'country' | 'region' | 'city';

export interface LocationTreeNode {
  readonly key: string;
  readonly label: string;
  readonly kind: LocationNodeKind;
  readonly country: string;
  readonly parentKey?: string;
  readonly count: number;
  readonly children: readonly LocationTreeNode[];
}

export interface LocationTree {
  readonly remote: number;
  readonly countries: readonly LocationTreeNode[];
  readonly nodes: ReadonlyMap<string, LocationTreeNode>;
}

export type LocationNodeState = 'checked' | 'mixed' | 'none';

const NOT_A_PLACE = /^(remote|удал[её]нно|anywhere|worldwide|hybrid|гибрид)$/iu;

const lower = (value: string) => value.toLocaleLowerCase('ru-RU');

function countryOf(part: string | undefined): string | undefined {
  return part ? (COUNTRY_NAMES[lower(part.trim())] ?? geoCountry(part)) : undefined;
}

/** Ручной справочник первым: его подписи — ключи уже сохранённых выборов. */
function cityLabel(raw: string, country?: string): string {
  return CITY_NAMES[lower(raw)] ?? geoCity(raw, country)?.label ?? raw;
}

function usState(part: string | undefined): string | undefined {
  if (!part) return undefined;
  const code = part.trim().toUpperCase();
  return US_STATES[code] ?? US_STATES[US_STATE_NAMES[lower(part.trim())] ?? ''];
}

function detectCountry(parts: string[], place: VacancyPlaceInput): string | undefined {
  const last = countryOf(parts.at(-1));
  if (last && parts.length > 1) {
    parts.pop();
    return last;
  }
  if (last) return last;
  const given = countryOf(place.country);
  if (given) return given;
  if (parts.length > 1 && usState(parts[1])) return 'США';
  if (parts[0] && RUSSIAN_CITY_DISTRICT[lower(cityLabel(parts[0]))]) return HOME_COUNTRY;
  if (parts[0]) return CITY_COUNTRY[cityLabel(parts[0])] ?? geoCity(parts[0])?.country;
  return undefined;
}

function regionFor(country: string, city: string | undefined, middle: string | undefined) {
  const directory = city ? geoCity(city, country)?.region : undefined;
  if (country === HOME_COUNTRY) {
    return (city && RUSSIAN_CITY_DISTRICT[lower(city)]) ?? directory ?? UNKNOWN_REGION;
  }
  if (country === 'США') return usState(middle) ?? (city && US_CITY_STATE[city]) ?? UNKNOWN_REGION;
  return directory ?? (middle && middle !== city ? middle : UNKNOWN_REGION);
}

export function parseVacancyLocation(place: VacancyPlaceInput): LocationPath | undefined {
  const parts = (place.location ?? '')
    .replace(/\([^)]*\)/gu, '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !NOT_A_PLACE.test(part));
  const country = detectCountry(parts, place);
  if (!country) return undefined;
  if (parts.length === 1 && countryOf(parts[0]) === country) return { country };
  if (!parts.length) return { country };
  const city = cityLabel(parts[0]!, country);
  return { country, region: regionFor(country, city, parts[1]), city };
}

export function locationPathKeys(path: LocationPath): string[] {
  const keys = [path.country];
  if (path.region) keys.push(keys[0] + LOCATION_PATH_SEPARATOR + path.region);
  if (path.region && path.city) keys.push(keys[1] + LOCATION_PATH_SEPARATOR + path.city);
  return keys;
}

interface MutableNode {
  key: string;
  label: string;
  kind: LocationNodeKind;
  country: string;
  parentKey?: string;
  count: number;
  children: Map<string, MutableNode>;
}

function addPath(root: Map<string, MutableNode>, path: LocationPath, weight = 1) {
  const labels = [path.country, path.region, path.city].filter(Boolean) as string[];
  const kinds: LocationNodeKind[] = ['country', 'region', 'city'];
  let level = root;
  let parentKey: string | undefined;
  labels.forEach((label, index) => {
    const key = parentKey ? parentKey + LOCATION_PATH_SEPARATOR + label : label;
    const existing = level.get(key);
    const node: MutableNode = existing ?? {
      key,
      label,
      kind: kinds[index]!,
      country: path.country,
      parentKey,
      count: 0,
      children: new Map(),
    };
    node.count += weight;
    level.set(key, node);
    level = node.children;
    parentKey = key;
  });
}

function freeze(
  nodes: Map<string, MutableNode>,
  index: Map<string, LocationTreeNode>,
): LocationTreeNode[] {
  return [...nodes.values()]
    .map((node) => {
      const frozen: LocationTreeNode = {
        key: node.key,
        label: node.label,
        kind: node.kind,
        country: node.country,
        parentKey: node.parentKey,
        count: node.count,
        children: freeze(node.children, index),
      };
      index.set(frozen.key, frozen);
      return frozen;
    })
    .sort(
      (left, right) =>
        Number(right.label === HOME_COUNTRY) - Number(left.label === HOME_COUNTRY) ||
        Number(left.label === UNKNOWN_REGION) - Number(right.label === UNKNOWN_REGION) ||
        right.count - left.count ||
        left.label.localeCompare(right.label, 'ru-RU'),
    );
}

export function buildLocationTree(places: readonly VacancyPlaceInput[]): LocationTree {
  const root = new Map<string, MutableNode>();
  let remote = 0;
  for (const place of places) {
    const weight = place.count ?? 1;
    if (place.isRemote) remote += weight;
    const path = parseVacancyLocation(place);
    if (path) addPath(root, path, weight);
  }
  const nodes = new Map<string, LocationTreeNode>();
  return { remote, countries: freeze(root, nodes), nodes };
}

const isWithin = (key: string, ancestor: string) =>
  key === ancestor || key.startsWith(ancestor + LOCATION_PATH_SEPARATOR);

export function locationNodeState(
  node: Pick<LocationTreeNode, 'key'>,
  selected: readonly string[],
): LocationNodeState {
  if (selected.some((key) => isWithin(node.key, key))) return 'checked';
  return selected.some((key) => isWithin(key, node.key)) ? 'mixed' : 'none';
}

export function selectedVacancyCount(node: LocationTreeNode, selected: readonly string[]): number {
  const state = locationNodeState(node, selected);
  if (state === 'none') return 0;
  if (state === 'checked') return node.count;
  return node.children.reduce((sum, child) => sum + selectedVacancyCount(child, selected), 0);
}

function expandAncestor(
  selected: readonly string[],
  ancestor: LocationTreeNode,
  target: LocationTreeNode,
): string[] {
  const next = selected.filter((key) => key !== ancestor.key);
  let current = ancestor;
  while (current.key !== target.key) {
    const step = current.children.find((child) => isWithin(target.key, child.key));
    if (!step) break;
    next.push(...current.children.filter((child) => child !== step).map((child) => child.key));
    current = step;
  }
  return next;
}

function collapseUp(
  selected: readonly string[],
  node: LocationTreeNode,
  tree: LocationTree,
): string[] {
  let next = [...selected];
  let parent = node.parentKey ? tree.nodes.get(node.parentKey) : undefined;
  while (
    parent &&
    parent.children.every((child) => locationNodeState(child, next) === 'checked') &&
    parent.children.reduce((sum, child) => sum + child.count, 0) === parent.count
  ) {
    const parentKey = parent.key;
    next = [...next.filter((key) => !isWithin(key, parentKey)), parentKey];
    parent = parent.parentKey ? tree.nodes.get(parent.parentKey) : undefined;
  }
  return next;
}

export function toggleLocationNode(
  selected: readonly string[],
  node: LocationTreeNode,
  tree: LocationTree,
): string[] {
  if (locationNodeState(node, selected) === 'checked') {
    const ancestorKey = selected.find((key) => key !== node.key && isWithin(node.key, key));
    const ancestor = ancestorKey ? tree.nodes.get(ancestorKey) : undefined;
    const withoutNode = selected.filter((key) => !isWithin(key, node.key));
    return ancestor ? expandAncestor(withoutNode, ancestor, node) : withoutNode;
  }
  const added = [...selected.filter((key) => !isWithin(key, node.key)), node.key];
  return collapseUp(added, node, tree);
}

/** Ключ выбора или старый текстовый выбор (подстрока места). */
export function matchesLocationSelection(
  place: VacancyPlaceInput,
  selected: readonly string[],
): boolean {
  if (!selected.length) return true;
  const path = parseVacancyLocation(place);
  const keys = path ? locationPathKeys(path) : [];
  const location = lower(place.location ?? '');
  return selected.some(
    (value) => keys.includes(value) || (!!location && location.includes(lower(value))),
  );
}

export interface LocationSearchHit {
  readonly node: LocationTreeNode;
  readonly kindLabel: string;
  readonly path: string;
}

function regionTitle(node: LocationTreeNode): string {
  return node.country === 'США' ? `штат ${node.label}` : node.label;
}

function describeHit(node: LocationTreeNode, tree: LocationTree): LocationSearchHit {
  if (node.kind === 'city') {
    const region = node.parentKey ? tree.nodes.get(node.parentKey) : undefined;
    const path =
      region && region.label !== UNKNOWN_REGION
        ? [node.country, regionTitle(region)]
        : [node.country];
    return { node, kindLabel: 'город', path: path.join(LOCATION_PATH_SEPARATOR) };
  }
  if (node.kind === 'region') {
    const kind =
      node.country === 'США' ? 'штат' : node.country === HOME_COUNTRY ? 'округ' : 'регион';
    return { node, kindLabel: `${kind}, все города`, path: node.country };
  }
  return { node, kindLabel: 'страна, все города', path: '' };
}

export function searchLocationTree(tree: LocationTree, query: string): LocationSearchHit[] {
  const needle = lower(query.trim());
  if (!needle) return [];
  const found = [...tree.nodes.values()].filter(
    (node) => node.label !== UNKNOWN_REGION && lower(node.label).includes(needle),
  );
  const groupCount = new Map<string, number>();
  for (const node of found)
    groupCount.set(node.label, Math.max(groupCount.get(node.label) ?? 0, node.count));
  const kindOrder: Record<LocationNodeKind, number> = { country: 0, region: 1, city: 2 };
  const groupKind = (label: string) =>
    Math.min(...found.filter((node) => node.label === label).map((node) => kindOrder[node.kind]));
  return found
    .sort(
      (left, right) =>
        groupCount.get(right.label)! - groupCount.get(left.label)! ||
        groupKind(left.label) - groupKind(right.label) ||
        left.label.localeCompare(right.label, 'ru-RU') ||
        kindOrder[right.kind] - kindOrder[left.kind],
    )
    .map((node) => describeHit(node, tree));
}
