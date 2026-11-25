/**
 * B803: во сколько раз уровень дороже рядового — медиана отношений внутри одного источника, страны и
 * функции. Считается из загруженных цифр; пар меньше трёх — множителя нет.
 */
import type { SalaryBenchmark } from './salaryBenchmark';

/** `функция|уровень`; `*` — по всем функциям. */
export type LevelMultipliers = ReadonlyMap<string, number>;

const MIN_BASE_ROWS = 3;
const MIN_PAIRS = 3;
/** Множитель не дальше двух уровней. */
const MAX_LEVEL_DISTANCE = 2;
const ANY = '*';

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function pushTo(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function middleOf(row: SalaryBenchmark): number {
  return row.median ?? ((row.low ?? 0) + (row.high ?? 0)) / 2;
}

export function levelMultipliers(rows: readonly SalaryBenchmark[]): LevelMultipliers {
  const cells = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.functionCode || row.levelRank === null || !row.country) continue;
    const place = [row.sourceName, row.country, row.currency, row.period, row.payBase].join('|');
    pushTo(cells, `${place}|${row.functionCode}|${row.levelRank}`, middleOf(row));
  }
  const ratios = new Map<string, number[]>();
  for (const [key, values] of cells) {
    const [functionCode = '', level = ''] = key.split('|').slice(-2);
    const base = cells.get(`${key.slice(0, key.lastIndexOf('|'))}|0`);
    if (level === '0' || !base || base.length < MIN_BASE_ROWS) continue;
    const ratio = median(values) / median(base);
    pushTo(ratios, `${functionCode}|${level}`, ratio);
    pushTo(ratios, `${ANY}|${level}`, ratio);
  }
  return new Map(
    [...ratios].flatMap(([key, values]) =>
      values.length >= MIN_PAIRS ? [[key, median(values)] as const] : [],
    ),
  );
}

function overBase(
  multipliers: Pick<LevelMultipliers, 'get'>,
  functionCode: string,
  level: number,
): number | undefined {
  if (level === 0) return 1;
  return multipliers.get(`${functionCode}|${level}`) ?? multipliers.get(`${ANY}|${level}`);
}

/** Отношение уровней функции; дальше двух уровней не переносим. */
export function levelRatio(
  multipliers: Pick<LevelMultipliers, 'get'>,
  functionCode: string,
  from: number,
  to: number,
): number | undefined {
  if (Math.abs(from - to) > MAX_LEVEL_DISTANCE) return undefined;
  const source = overBase(multipliers, functionCode, from);
  const target = overBase(multipliers, functionCode, to);
  return source && target ? target / source : undefined;
}
