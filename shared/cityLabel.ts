/**
 * Как площадка записала место — и как оно называется на карте.
 *
 * B203, прод 2026-09-06: карта считала «San Francisco» и «US - San Francisco»
 * разными хабами, а перечисление «Germany (Remote) ; Ireland (Remote) ; …»
 * ставила на карту одной точкой. Счёт по городу перестаёт быть счётом, если
 * один город посчитан дважды, а перечисление стран выдано за город.
 *
 * Правило одно на сервер и на экран, поэтому живёт в общем слое.
 */
import { isRegionLabel } from './placeNames';

/** Перечисление мест, а не место: такую строку картой показывать нельзя. */
const LIST_SEPARATORS = /[;|/]|\s+·\s+/;

/**
 * `US - `, `UK – `, `Germany - ` перед настоящим названием города. Пробелы
 * вокруг тире обязательны: у «Baden-Baden» и «Winston-Salem» тире внутри имени,
 * и срезать по нему — переименовать город.
 */
const COUNTRY_PREFIX = /^\p{L}{2}[\p{L}\s.]{0,18}?\s+[-–—]\s+(?=\p{L})/u;

/** `(Remote)`, `(Hybrid)`, `(On-site)` — формат работы, а не часть названия. */
const MODE_SUFFIX = /\s*\((?:remote|hybrid|on-?site|удал[её]нно|гибрид)\)\s*$/iu;

/** Форма работы перед местом: «Remote - Texas», «Hybrid Berlin». */
const MODE_PREFIX = /^(?:remote|hybrid|on-?site|удал[её]нно|гибрид)\s+(?=\p{L})/iu;

export function normalizeCityLabel(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (LIST_SEPARATORS.test(trimmed)) return undefined;

  const withoutMode = trimmed.replace(MODE_SUFFIX, '').replace(MODE_PREFIX, '').trim();
  const withoutPrefix = withoutMode.replace(COUNTRY_PREFIX, '').trim();
  const label = withoutPrefix || withoutMode;

  if (!label) return undefined;
  // «Remote», «Hybrid», «EMEA», «Home Office» — это не города, а способ работы
  // или надрегион: на карте у них нет точки, и хабом они быть не могут (B203).
  if (isRegionLabel(label)) return undefined;
  return label;
}
