import { buildNodePath, crumbLabel, crumbTrail, matchNode, type B640Nav } from '../routes';
import { knownVacancy } from './vacancyNames';
import type { KnownVacancy } from './vacancyNames';

/** Звено пути: экран, с которого пришли, с его фильтрами в адресе. */
export interface Stop {
  readonly label: string;
  readonly path: string;
}

/** Что запись истории браузера помнит о переходе: переживает перезагрузку. */
export interface Journey {
  readonly trail?: readonly Stop[];
  readonly vacancy?: KnownVacancy;
}

/** Объекты, которые открывают из разных разделов: путь и раздел берутся у источника (B798). */
const OBJECT_CODES: ReadonlySet<string> = new Set(['v04', 'v10b', 'o02']);

const MAX_STOPS = 8;

/** Списки, которые остаются открытыми под объектом; o01 и o01c — один экран. */
const KEEP_KEYS: Readonly<Record<string, string>> = {
  s07: 's07',
  v06s: 'v06s',
  v10: 'v10',
  o01: 'o01',
  o01c: 'o01',
  a02: 'a02',
  d00: 'd00',
};

export function keepKeyOf(path: string): string | null {
  const code = matchNode(path)?.node.code;
  return code ? (KEEP_KEYS[code] ?? null) : null;
}

function isObject(path: string): boolean {
  return OBJECT_CODES.has(matchNode(path)?.node.code ?? '');
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readStops(value: unknown): readonly Stop[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const stops = value.filter(
    (stop): stop is Stop =>
      isText(stop?.label) && isText(stop?.path) && matchNode(stop.path) !== null,
  );
  return stops.length ? stops.map(({ label, path }) => ({ label, path })) : undefined;
}

function readVacancy(value: unknown): KnownVacancy | undefined {
  const vacancy = value as Partial<KnownVacancy> | null | undefined;
  if (!isText(vacancy?.vacancyId) || !isText(vacancy?.title)) return undefined;
  const { vacancyId, title, company } = vacancy as KnownVacancy;
  return { vacancyId, title, company: isText(company) ? company : '' };
}

/** Записи истории может поставить любой код страницы: лишнее и чужое отбрасывается. */
export function parseJourney(state: unknown): Journey {
  const raw = (state as { b640?: Record<string, unknown> } | null)?.b640;
  if (!raw || typeof raw !== 'object') return {};
  const trail = readStops(raw.trail);
  const vacancy = readVacancy(raw.vacancy);
  return { ...(trail ? { trail } : {}), ...(vacancy ? { vacancy } : {}) };
}

/** Родной путь экрана по карте кабинета, последнее звено — он сам. */
function nativeStops(address: string): readonly Stop[] {
  const match = matchNode(address);
  if (!match) return [];
  const nodes = crumbTrail(match.node.code);
  return nodes.flatMap((node, index) => {
    if (index === nodes.length - 1) return [{ label: crumbLabel(node), path: address }];
    try {
      return [{ label: crumbLabel(node), path: buildNodePath(node.code, match.params) }];
    } catch {
      return [];
    }
  });
}

function stopsTo(address: string, journey: Journey): readonly Stop[] {
  const native = nativeStops(address);
  if (!journey.trail || !native.length) return native;
  return [...journey.trail, native[native.length - 1]];
}

const pathnameOf = (address: string): string => address.split(/[?#]/u)[0];

/** Путь, с которым откроется `to`, если перейти на него с `from`. */
export function journeyTo(to: string, from: string, current: Journey): Journey {
  if (!isObject(to)) return {};
  const id = Object.values(matchNode(to)?.params ?? {})[0] ?? '';
  const vacancy = knownVacancy(id);
  const name = vacancy ? { vacancy } : {};
  const stops = stopsTo(from, current);
  const seen = stops.findIndex((stop) => pathnameOf(stop.path) === pathnameOf(to));
  const trail = (seen < 0 ? stops : stops.slice(0, seen)).slice(-MAX_STOPS);
  return trail.length ? { ...name, trail } : name;
}

/** Переход ведёт назад по пути: на экран, с которого сюда пришли. */
export function returnsTo(to: string, from: string, current: Journey): boolean {
  return stopsTo(from, current)
    .slice(0, -1)
    .some((stop) => stop.path === to);
}

/** Раздел в рейле: последний экран пути, который не объект. */
export function navOfTrail(trail: readonly Stop[] | undefined): B640Nav | null {
  const origin = trail?.filter((stop) => !isObject(stop.path)).at(-1);
  return origin ? (matchNode(origin.path)?.node.nav ?? null) : null;
}
