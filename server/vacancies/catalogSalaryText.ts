/** Money of one currency × period group, always with its period (09.11). */
import { money } from './catalogListingNames';
import { MAX_GROUPS, type SalaryGroup, type SalaryStats } from './catalogSalaryStats';

const SIGNS: Readonly<Record<string, string>> = {
  RUB: '₽',
  RUR: '₽',
  USD: '$',
  EUR: '€',
  GBP: '£',
  KZT: '₸',
};
const PERIODS: Readonly<Record<SalaryGroup['period'], string>> = {
  hour: 'в час',
  month: 'в месяц',
  year: 'в год',
};
const signOf = (group: SalaryGroup) => SIGNS[group.currency] ?? group.currency;
export const groupMedian = (group: SalaryGroup): string =>
  `${money(group.median, signOf(group))} ${PERIODS[group.period]}`;
export const groupSpread = (group: SalaryGroup): string =>
  `${group.low.toLocaleString('ru-RU')}–${money(group.high, signOf(group))} ${PERIODS[group.period]}`;

/** Groups a page prints: stored rows from an older maintenance pass may hold more. */
export const shownGroups = (stats?: SalaryStats): readonly SalaryGroup[] =>
  (stats?.groups ?? []).slice(0, MAX_GROUPS);
