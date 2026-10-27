/**
 * B569: «О вакансиях <роли> в <городе>» (mockup 08). Answers use only numbers
 * counted from the list; the salary answer exists only when a median does.
 */
import { interviewProfession, interviewProfessionPath } from '../../shared/interviewQuestions';
import { salaryRolePath } from '../../shared/salaryMarketPublic';
import { escapeHtml } from './catalogHtml';
import { dataDate, money, type Names } from './catalogListingNames';
import type { SalaryStats } from './catalogSalaryStats';
import type { CatalogPage } from './vacancyCatalogPage';

interface Item {
  readonly question: string;
  /** Trusted HTML: built from escaped parts below. */
  readonly answerHtml: string;
}

function plural(value: number, one: string, few: string, many: string): string {
  const tens = value % 100;
  const ones = value % 10;
  if (tens >= 11 && tens <= 14) return many;
  return ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many;
}

function items(page: CatalogPage, names: Names, stats?: SalaryStats): Item[] {
  const role = page.listing?.role;
  const list: Item[] = [
    {
      question:
        names.roleGen && names.placePrep
          ? `Сколько вакансий ${names.roleGen} сейчас в ${names.placePrep}?`
          : 'Сколько вакансий сейчас в этом разделе?',
      answerHtml: escapeHtml(
        `${page.total.toLocaleString('ru-RU')} в открытом каталоге на ${dataDate(page)}: с открытых площадок и сайтов работодателей. ` +
          'После регистрации видно больше — весь пул openqareer.',
      ),
    },
  ];
  if (stats?.median !== undefined) {
    const salaryPath = (role ? salaryRolePath(role) : undefined) ?? '/salaries';
    list.push({
      question:
        names.roleDat && names.placePrep
          ? `Сколько платят ${names.roleDat} в ${names.placePrep}?`
          : 'Сколько платят в этих вакансиях?',
      answerHtml:
        `Медиана вилок — ${escapeHtml(money(stats.median, stats.sign))}. ` +
        `<a href="${escapeHtml(salaryPath)}">Подробнее по городам</a>.`,
    });
  }
  list.push({
    question: 'Как откликнуться?',
    answerHtml: escapeHtml(
      'Отклик подаётся на сайте работодателя по ссылке из вакансии. В openqareer вы один раз задаёте правила — какие вакансии, от какой зарплаты, сколько откликов в день, — и на тарифе Pro сервис откликается сам, показывая каждый отправленный отклик.',
    ),
  });
  const profession = role ? interviewProfession(role) : undefined;
  if (profession) {
    const count = profession.questions.length;
    list.push({
      question: 'Какие вопросы зададут на собеседовании?',
      answerHtml:
        `<a href="${escapeHtml(interviewProfessionPath(profession.slug))}">${count} ${plural(count, 'вопрос', 'вопроса', 'вопросов')} на собеседовании ${escapeHtml(profession.genitive)}</a> ` +
        'с разбором сильного ответа и тем, что проверяет работодатель.',
    });
  }
  return list;
}

export function listingFaq(page: CatalogPage, names: Names, stats?: SalaryStats): string {
  if (page.total === 0) return '';
  const all = items(page, names, stats);
  const half = Math.ceil(all.length / 2);
  const render = (list: readonly Item[], offset: number) =>
    '<div>' +
    list
      .map(
        (item, index) =>
          `<details class="lv-q"${offset + index === 0 ? ' open' : ''}><summary>${escapeHtml(item.question)}</summary><div class="lv-a">${item.answerHtml}</div></details>`,
      )
      .join('') +
    '</div>';
  const title =
    names.roleGen && names.placePrep
      ? `О вакансиях ${names.roleGen} в ${names.placePrep}`
      : 'О вакансиях этого раздела';
  return (
    '<section class="lv-sec" aria-labelledby="cat-faq-h"><div class="ps-wrap">' +
    `<div class="lv-sh"><div><span class="ps-label">Вопросы</span><h2 id="cat-faq-h">${escapeHtml(title)}</h2></div></div>` +
    `<div class="lv-faq">${render(all.slice(0, half), 0)}${render(all.slice(half), half)}</div></div></section>`
  );
}
