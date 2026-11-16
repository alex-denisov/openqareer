import { convertAmount, type CurrencyRates } from '../../../../../shared/currencyRates';
import type { MarketSalaryEstimate } from '../../../../../shared/marketSalaryEstimate';

export interface ScalePart {
  /** Отступ от начала шкалы, % */
  readonly start: number;
  /** Ширина, % */
  readonly size: number;
}

export interface MoneyScale {
  readonly market: ScalePart;
  readonly fork?: ScalePart;
}

interface Fork {
  readonly from?: number;
  readonly to?: number;
  readonly currency?: string;
}

const PAD = 0.2;
const MIN_SIZE = 2;

function forkRange(
  fork: Fork | undefined,
  currency: string,
  rates: CurrencyRates | undefined,
): readonly [number, number] | undefined {
  if (!fork || !fork.currency || (fork.from === undefined && fork.to === undefined)) return undefined;
  const convert = (value: number | undefined) =>
    value === undefined ? undefined : convertAmount(value, fork.currency!, currency, rates);
  const low = convert(fork.from ?? fork.to);
  const high = convert(fork.to ?? fork.from);
  return low === undefined || high === undefined ? undefined : [Math.min(low, high), Math.max(low, high)];
}

/** Шкала «рынок и вилка»: общая ось с запасом 20 % с каждого края. Нет оценки рынка — нет шкалы. */
export function moneyScale(
  market: MarketSalaryEstimate,
  fork: Fork | undefined,
  rates: CurrencyRates | undefined,
): MoneyScale | null {
  if (market.low === undefined || market.high === undefined) return null;
  const mine = forkRange(fork, market.currency, rates);
  const values = [market.low, market.high, ...(mine ?? [])];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max(high - low, 1) * PAD;
  const origin = low - pad;
  const span = high - low + pad * 2;
  const part = (from: number, to: number): ScalePart => {
    const start = ((from - origin) / span) * 100;
    const size = Math.max(((to - from) / span) * 100, MIN_SIZE);
    return { start: Math.min(start, 100 - size), size };
  };
  return { market: part(market.low, market.high), ...(mine ? { fork: part(mine[0], mine[1]) } : {}) };
}
