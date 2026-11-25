import { convertAmount, type CurrencyRates } from '../../../../../shared/currencyRates';
import type { MarketSalaryEstimateView } from '../../../../../shared/marketSalaryEstimate';

export interface ScalePart {
  /** Отступ от начала шкалы, % */
  readonly start: number;
  /** Ширина, % */
  readonly size: number;
}

export interface MoneyScale {
  readonly market?: ScalePart;
  readonly fork?: ScalePart;
  /** Ожидания кандидата: отступ точки от начала шкалы, %. */
  readonly me?: number;
  /** Где ожидания относительно вилки (нет вилки — относительно рынка). */
  readonly verdict?: 'below' | 'inside' | 'above';
  readonly verdictAgainst?: 'fork' | 'market';
}

export interface Expectation {
  readonly amount: number;
  readonly currency: string;
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
  if (!fork || !fork.currency || (fork.from === undefined && fork.to === undefined))
    return undefined;
  const convert = (value: number | undefined) =>
    value === undefined ? undefined : convertAmount(value, fork.currency!, currency, rates);
  const low = convert(fork.from ?? fork.to);
  const high = convert(fork.to ?? fork.from);
  return low === undefined || high === undefined
    ? undefined
    : [Math.min(low, high), Math.max(low, high)];
}

function verdictOf(me: number, range: readonly [number, number]): 'below' | 'inside' | 'above' {
  if (me < range[0]) return 'below';
  return me > range[1] ? 'above' : 'inside';
}

/**
 * Шкала «рынок, вилка и ваши ожидания»: общая ось с запасом 20 % с каждого края.
 * Нет ни рынка, ни вилки — шкалы нет; рынок без границ не рисуется.
 */
export function moneyScale(
  market: MarketSalaryEstimateView | undefined,
  fork: Fork | undefined,
  rates: CurrencyRates | undefined,
  expectation?: Expectation,
): MoneyScale | null {
  const marketRange: readonly [number, number] | undefined = market
    ? [market.low, market.high]
    : undefined;
  const currency = market?.currency ?? fork?.currency;
  if (!currency) return null;
  const mine = forkRange(fork, currency, rates);
  if (!marketRange && !mine) return null;
  const me = expectation
    ? convertAmount(expectation.amount, expectation.currency, currency, rates)
    : undefined;
  const values = [...(marketRange ?? []), ...(mine ?? []), ...(me === undefined ? [] : [me])];
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
  const against = mine ?? marketRange;
  return {
    ...(marketRange ? { market: part(marketRange[0], marketRange[1]) } : {}),
    ...(mine ? { fork: part(mine[0], mine[1]) } : {}),
    ...(me !== undefined && against
      ? {
          me: ((me - origin) / span) * 100,
          verdict: verdictOf(me, against),
          verdictAgainst: mine ? 'fork' : 'market',
        }
      : {}),
  };
}
