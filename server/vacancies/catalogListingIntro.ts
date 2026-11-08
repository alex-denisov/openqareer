/**
 * SEO P2 (08.11): «О рынке» block of a city × role list. The text is a model
 * draft that passed `gateIntro` (no money sentences, every number in the list
 * facts); salary lines are printed here from period-proven ranges, one line per
 * currency and period, so a yearly and a monthly range never meet in one line.
 * Each block names its data date and sample. Lists without a published intro
 * print nothing.
 */
import introsJson from '../seo/data/listingIntros.json';
import { humanDate, type IntroSalaryRange, type ListingIntro } from '../seo/listingIntroText';
import { escapeHtml } from './catalogHtml';

const INTROS: ReadonlyMap<string, ListingIntro> = new Map(
  (introsJson as ListingIntro[]).map((intro) => [`${intro.place}|${intro.role}`, intro]),
);

export function listingIntroFor(place: string, role?: string): ListingIntro | undefined {
  return role ? INTROS.get(`${place}|${role}`) : undefined;
}

const SIGNS: Readonly<Record<string, string>> = {
  RUB: '₽',
  RUR: '₽',
  USD: '$',
  EUR: '€',
  GBP: '£',
  KZT: '₸',
};
const PERIODS: Readonly<Record<IntroSalaryRange['period'], string>> = {
  hour: 'в час',
  month: 'в месяц',
  year: 'в год',
};

const amount = (value: number) => value.toLocaleString('ru-RU');

export function salaryLine(range: IntroSalaryRange): string {
  const sign = SIGNS[range.currency] ?? range.currency;
  return (
    `<li><b>${escapeHtml(`${amount(range.medianLow)}–${amount(range.medianHigh)} ${sign}`)}</b> ` +
    `${PERIODS[range.period]} · по ${amount(range.sample)} вакансиям, где источник указал период</li>`
  );
}

export function listingIntroBlock(intro: ListingIntro | undefined, title: string): string {
  if (!intro) return '';
  const salary = intro.salary.length
    ? '<h3>Зарплатные вилки</h3><ul class="lv-intro-sal">' +
      intro.salary.map(salaryLine).join('') +
      '</ul><p class="lv-small">Медианы нижних и верхних границ вилок «от — до»; годовые, месячные и почасовые вилки считаются отдельно.</p>'
    : '';
  return (
    '<section class="lv-sec lv-intro"><div class="ps-wrap"><div class="lv-prose">' +
    `<h2>${escapeHtml(title)}</h2>` +
    intro.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('') +
    salary +
    `<p class="lv-small">Срез ${escapeHtml(humanDate(intro.date))} · вакансий в выборке: ${amount(intro.sample)}.</p>` +
    '</div></div></section>'
  );
}
